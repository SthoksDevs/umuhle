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
// Once verified, this route's job is done — it translates Ozow's status
// string into a gateway-agnostic PaymentEvent and hands off to
// processPaymentEvent(). What "order paid" actually does (stock, splits,
// email, WhatsApp) lives in lib/payments/handlers/order.ts, shared with
// every other gateway.
//
// Always return 200 to Ozow once we've read the payload, even on internal
// errors — otherwise Ozow will keep retrying indefinitely.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateOzowResponse } from "@/lib/ozow";
import { processPaymentEvent } from "@/lib/payments/fulfillment";
import type { PaymentOutcome } from "@/lib/payments/fulfillment";

const OUTCOME_MAP: Record<string, PaymentOutcome | undefined> = {
  Complete: "completed",
  Cancelled: "cancelled",
  Error: "failed",
};

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
    .select("id, gateway_webhook_secret")
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
  const outcome = OUTCOME_MAP[status];
  console.log("[Ozow Notify] Order:", orderId, "| Status:", status, "| Ozow TransactionId:", payload.TransactionId);

  if (!outcome) {
    console.log("[Ozow Notify] Status is Pending or unrecognised — no action taken, awaiting final notification.");
    return NextResponse.json({ ok: true });
  }

  const result = await processPaymentEvent(supabase, {
    type: "order",
    paymentId: orderId,
    outcome,
    gateway: "ozow",
    gatewayPaymentId: payload.TransactionId,
  });

  if (!result.ok) {
    console.error("[Ozow Notify] Fulfillment error:", result.reason);
  }

  console.log("[Ozow Notify] ── Handler complete, returning 200 OK ──");
  return NextResponse.json({ ok: true });
}
