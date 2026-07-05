// app/api/ozow/notify/route.ts
// Ozow server-to-server payment notification (the source of truth — the
// browser Success/Cancel/Error redirect is display-only and never trusted
// to flip an order to "paid").
//
// Two checks before we trust it:
//   1. The per-order webhookSecret embedded in our own NotifyUrl querystring
//      — proves this callback targets this specific checkout attempt.
//   2. Ozow's own Hash field (see lib/ozow.ts → validateOzowResponse) —
//      proves the payload wasn't tampered with in transit.
//
// Always return 200 to Ozow once we've read the payload, even on internal
// errors — otherwise Ozow will keep retrying indefinitely.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateOzowResponse } from "@/lib/ozow";
import { sendOrderPaidEmail, sendOrderFailedEmail } from "@/lib/email";
import { recordOrderItemSplits } from "@/lib/payouts";

export async function POST(req: NextRequest) {
  console.log("[Ozow Notify] ── Incoming notification ──");

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("order_id");
  const secret = searchParams.get("secret");

  const contentType = req.headers.get("content-type") ?? "";
  let payload: Record<string, string>;
  if (contentType.includes("application/json")) {
    payload = await req.json();
  } else {
    const text = await req.text();
    payload = Object.fromEntries(new URLSearchParams(text));
  }
  console.log("[Ozow Notify] Parsed payload:", JSON.stringify(payload, null, 2));

  if (!orderId || !secret) {
    console.error("[Ozow Notify] Missing order_id/secret on NotifyUrl");
    return new NextResponse("Missing params", { status: 200 });
  }

  const supabase = await createServiceClient();

  const { data: order } = await supabase
    .from("orders")
    .select(`
      id, status, gateway_webhook_secret, total_amount, shipping_address,
      client:profiles!orders_client_id_fkey(full_name, email, phone)
    `)
    .eq("id", orderId)
    .single();

  if (!order) {
    console.error("[Ozow Notify] Order not found:", orderId);
    return new NextResponse("Order not found", { status: 200 });
  }
  if (order.gateway_webhook_secret !== secret) {
    console.error("[Ozow Notify] Webhook secret mismatch for order:", orderId);
    return new NextResponse("Invalid secret", { status: 200 });
  }

  if (!validateOzowResponse(payload)) {
    console.error("[Ozow Notify] Hash validation failed — see lib/ozow.ts comments before assuming this is spoofed; it may just mean NOTIFY_FIELD_ORDER needs adjusting against a real staging transaction.");
    return new NextResponse("Invalid hash", { status: 200 });
  }

  const status = payload.Status; // expect "Complete" | "Cancelled" | "Error" | "Pending"
  console.log("[Ozow Notify] Order:", orderId, "| Status:", status, "| Ozow TransactionId:", payload.TransactionId);

  if (order.status !== "pending_payment") {
    // Ozow retries notifications — stay idempotent.
    console.log("[Ozow Notify] Order already processed, status:", order.status);
    return NextResponse.json({ ok: true });
  }

  const clientRow = Array.isArray(order.client) ? order.client[0] : order.client;

  try {
    if (status === "Complete") {
      const { data: orderItems } = await supabase
        .from("order_items")
        .select("product_id, quantity, unit_price, product:products(name)")
        .eq("order_id", orderId);

      await supabase
        .from("orders")
        .update({ status: "paid", gateway_order_id: payload.TransactionId ?? order.id })
        .eq("id", orderId)
        .eq("status", "pending_payment");

      if (orderItems) {
        for (const item of orderItems) {
          await supabase.rpc("decrement_stock", {
            p_product_id: item.product_id,
            p_qty: item.quantity,
          });
        }
      }

      // Record each item's 5.5% commission / 94.5% partner payout split now
      // that payment has cleared. Wallets aren't credited until the order is
      // later marked "delivered" — see lib/payouts.ts.
      try {
        await recordOrderItemSplits(supabase, orderId);
      } catch (e) {
        console.error("[Ozow Notify] Failed to record order commission split:", e);
      }

      try {
        console.log("[Ozow Notify] Sending order paid email...");
        await sendOrderPaidEmail({
          orderId,
          clientName: clientRow?.full_name ?? "Unknown",
          clientEmail: clientRow?.email ?? "",
          totalAmount: order.total_amount,
          shippingAddress: order.shipping_address ?? undefined,
          items: (orderItems ?? []).map((i) => ({
            name: (Array.isArray(i.product) ? i.product[0] : i.product)?.name ?? "Product",
            quantity: i.quantity,
            unit_price: i.unit_price,
          })),
        });
        console.log("[Ozow Notify] Order paid email done.");
      } catch (e) {
        console.error("[Ozow Notify] Order paid email error:", e);
      }

      if (clientRow?.phone) {
        try {
          const { sendTextMessage } = await import("@/lib/whatsapp");
          await sendTextMessage(
            clientRow.phone,
            `*Order Confirmed!*\n\nHi ${clientRow.full_name ?? "there"}, your Umuhle order has been confirmed via Ozow.\n\nOrder ID: ${orderId}\nTotal: R${(order.total_amount / 100).toFixed(0)}\n\nWe'll send you delivery updates here. Thank you! 💜`
          );
        } catch (e) {
          console.error("[Ozow Notify] WhatsApp notify error:", e);
        }
      }
    } else if (status === "Cancelled" || status === "Error") {
      await supabase
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", orderId)
        .eq("status", "pending_payment");

      try {
        console.log("[Ozow Notify] Sending order failed/cancelled email...");
        await sendOrderFailedEmail({
          orderId,
          clientName: clientRow?.full_name ?? "Unknown",
          clientEmail: clientRow?.email ?? "",
          totalAmount: order.total_amount,
          reason: status === "Cancelled" ? "cancelled" : "failed",
        });
        console.log("[Ozow Notify] Order failed/cancelled email done.");
      } catch (e) {
        console.error("[Ozow Notify] Order failed email error:", e);
      }
    } else {
      console.log("[Ozow Notify] Status is Pending or unrecognised — no action taken, awaiting final notification.");
    }
  } catch (err) {
    console.error("[Ozow Notify] Processing error (caught):", err);
    // Still return 200 — Ozow will retry on non-200 forever.
  }

  console.log("[Ozow Notify] ── Handler complete, returning 200 OK ──");
  return NextResponse.json({ ok: true });
}
