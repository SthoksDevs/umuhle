// app/api/vendor/order-items/[id]/ship/route.ts
//
// Lets a partner mark ONE of their own line items as dispatched — not the
// whole order. A single order can span multiple partners; this only ever
// touches the one order_items row the caller actually owns (via
// product.partner_id), and only ever notifies the customer about that one
// item.
//
// Deliberately a server route rather than a direct client-side RLS-gated
// update (order_items has no partner UPDATE policy, only the SELECT one
// added in 20260717_order_item_fulfillment.sql) — this needs to atomically
// generate the confirm token, persist it, and fire the email/WhatsApp
// notification, and doing that from the client would mean trusting the
// client to also call the notification step. Same reasoning that put order
// status updates behind app/api/admin/orders/[id]/status/route.ts instead
// of a direct client-side write.
//
// Idempotent: calling this again on an already-shipped item just returns
// its current state — no new token, no duplicate email/WhatsApp.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { sendOrderItemShippedEmail } from "@/lib/email";
import { notifyOrderItemShipped } from "@/lib/whatsapp";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Order-level states an item can be dispatched out of. A brand-new order
// that hasn't paid yet, or one that's been cancelled, has nothing to ship.
const SHIPPABLE_ORDER_STATUSES = ["paid", "processing", "shipped"];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const itemId = params.id;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: item, error: itemError } = await service
    .from("order_items")
    .select(`
      id, order_id, quantity, shipped_at, delivered_at, confirm_token,
      product:products(id, name, partner_id),
      order:orders(id, status, client_id, contact_name, contact_whatsapp,
        client:profiles!client_id(full_name, email, phone))
    `)
    .eq("id", itemId)
    .single();

  if (itemError || !item) return NextResponse.json({ error: "Order item not found" }, { status: 404 });

  const product = Array.isArray(item.product) ? item.product[0] : item.product;
  const order = Array.isArray(item.order) ? item.order[0] : item.order;

  if (!product || product.partner_id !== user.id) {
    // Same response for "doesn't exist" and "exists but isn't yours" —
    // no need to reveal which to a caller probing item ids that aren't theirs.
    return NextResponse.json({ error: "Order item not found" }, { status: 404 });
  }
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!SHIPPABLE_ORDER_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: `Can't dispatch an item on an order that's "${order.status}"` }, { status: 400 });
  }

  // Already shipped — idempotent no-op, don't regenerate the token or
  // re-fire the notification (a partner double-clicking the button
  // shouldn't spam the customer with a second "on its way" message).
  if (item.shipped_at) {
    return NextResponse.json({
      ok: true,
      item: { id: item.id, shipped_at: item.shipped_at, delivered_at: item.delivered_at },
      alreadyShipped: true,
    });
  }

  const confirmToken = item.confirm_token ?? randomUUID();
  const shippedAt = new Date().toISOString();

  const { error: updateError } = await service
    .from("order_items")
    .update({ shipped_at: shippedAt, confirm_token: confirmToken })
    .eq("id", itemId)
    .is("shipped_at", null); // guards against a concurrent double-submit

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const client = Array.isArray(order.client) ? order.client[0] : order.client;
  const clientName = order.contact_name ?? client?.full_name ?? "there";
  const clientPhone = order.contact_whatsapp ?? client?.phone ?? null;

  // Best-effort — a notification failure shouldn't undo the dispatch itself,
  // same reasoning as the payout-crediting try/catch in the admin status route.
  try {
    if (client?.email) {
      await sendOrderItemShippedEmail({
        orderId: order.id,
        clientName,
        clientEmail: client.email,
        productName: product.name,
        quantity: item.quantity,
        confirmToken,
      });
    }
    if (clientPhone) {
      await notifyOrderItemShipped({
        clientName,
        clientPhone,
        orderId: order.id,
        productName: product.name,
        quantity: item.quantity,
        confirmToken,
      });
    }
  } catch (e) {
    console.error(`[vendor/order-items/${itemId}/ship] notification error:`, e);
  }

  return NextResponse.json({
    ok: true,
    item: { id: item.id, shipped_at: shippedAt, delivered_at: null },
  });
}
