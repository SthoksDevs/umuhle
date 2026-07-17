// app/api/order-items/confirm/[token]/route.ts
//
// Public, unauthenticated — deliberately so, since the customer clicking
// this link from an email/WhatsApp message is never logged into Umuhle as
// that specific session. Security comes from the token itself being an
// unguessable random UUID (see confirm_token in
// 20260717_order_item_fulfillment.sql), the same trust model already used
// for gateway_webhook_secret elsewhere in this codebase — see
// lib/payments/webhook-secret.ts for the equivalent pattern on the
// payment-gateway side.
//
// GET  -> display info for the confirm-receipt page (product, order ref,
//         whether it's already been confirmed).
// POST -> actually confirms receipt: stamps delivered_at and credits the
//         partner's wallet via creditOrderItemPayout(). Idempotent — a
//         second POST on an already-confirmed item just reports that back,
//         no double-crediting (creditOrderItemPayout is itself idempotent
//         too, as a second line of defence).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { creditOrderItemPayout } from "@/lib/payouts";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const service = serviceClient();
  const { data: item, error } = await service
    .from("order_items")
    .select(`
      id, order_id, quantity, shipped_at, delivered_at,
      product:products(name, image_url),
      order:orders(contact_name, client:profiles!client_id(full_name))
    `)
    .eq("confirm_token", params.token)
    .single();

  if (error || !item) return NextResponse.json({ error: "This confirmation link isn't valid." }, { status: 404 });

  const product = Array.isArray(item.product) ? item.product[0] : item.product;
  const order = Array.isArray(item.order) ? item.order[0] : item.order;
  const client = order ? (Array.isArray(order.client) ? order.client[0] : order.client) : null;

  return NextResponse.json({
    productName: product?.name ?? "Product",
    productImage: product?.image_url ?? null,
    quantity: item.quantity,
    orderId: item.order_id,
    clientName: order?.contact_name ?? client?.full_name ?? null,
    delivered: Boolean(item.delivered_at),
  });
}

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const service = serviceClient();
  const { data: item, error } = await service
    .from("order_items")
    .select("id, shipped_at, delivered_at")
    .eq("confirm_token", params.token)
    .single();

  if (error || !item) return NextResponse.json({ error: "This confirmation link isn't valid." }, { status: 404 });
  if (!item.shipped_at) return NextResponse.json({ error: "This item hasn't been marked as dispatched yet." }, { status: 400 });

  if (item.delivered_at) {
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  }

  // Delivery is a fact independent of whether crediting succeeds — stamp it
  // first, unconditionally, rather than making it depend on the payout
  // step below. A partner payout hiccup shouldn't make a customer's honest
  // "yes, I got it" click look like it silently failed.
  const { error: updateError } = await service
    .from("order_items")
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", item.id)
    .is("delivered_at", null);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  let credited = false;
  let creditReason: string | undefined;
  try {
    const result = await creditOrderItemPayout(service, item.id);
    credited = result.credited;
    creditReason = result.reason;
  } catch (e) {
    console.error(`[order-items/confirm/${params.token}] crediting error:`, e);
    creditReason = e instanceof Error ? e.message : "Unknown error";
  }

  return NextResponse.json({ ok: true, credited, creditReason });
}
