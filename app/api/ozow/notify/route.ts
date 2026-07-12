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
// Once both checks pass, this route's job is done — it normalizes the
// payload into a PaymentEvent and hands off to fulfillPayment()
// (lib/payments/fulfillment.ts) for the actual decision, same as PayFast
// and HappyPay. Always returns 200 to Ozow once we've read the payload,
// even on internal errors — otherwise Ozow will keep retrying indefinitely.
//
// `type` defaults to "order" — the only payment type Ozow initiates today
// (see app/api/ozow/initiate/route.ts). `id` falls back to the legacy
// `order_id` param name, same rationale as the HappyPay webhook routes.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateOzowResponse } from "@/lib/ozow";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import type { PaymentEvent, PaymentOutcome, PaymentType } from "@/lib/payments/types";

export async function POST(req: NextRequest) {
  console.log("[Ozow Notify] ── Incoming notification ──");

  const { searchParams } = new URL(req.url);
  const referenceId = searchParams.get("id") ?? searchParams.get("order_id");
  const secret = searchParams.get("secret");
  const type = (searchParams.get("type") ?? "order") as PaymentType;

  const contentType = req.headers.get("content-type") ?? "";
  let payload: Record<string, string>;
  if (contentType.includes("application/json")) {
    payload = await req.json();
  } else {
    const text = await req.text();
    payload = Object.fromEntries(new URLSearchParams(text));
  }
  console.log("[Ozow Notify] Parsed payload:", JSON.stringify(payload, null, 2));

  if (!referenceId || !secret) {
    console.error("[Ozow Notify] Missing id/secret on NotifyUrl");
    return new NextResponse("Missing params", { status: 200 });
  }
  if (type !== "order") {
    // Only "order" has a gateway_webhook_secret column to check against
    // today — see the note in lib/payments/gateways.ts about Ozow only
    // selling shop orders for now.
    console.error("[Ozow Notify] Unsupported payment type:", type);
    return new NextResponse("Unsupported payment type", { status: 200 });
  }

  const supabase = await createServiceClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, gateway_webhook_secret")
    .eq("id", referenceId)
    .single();

  if (!order) {
    console.error("[Ozow Notify] Order not found:", referenceId);
    return new NextResponse("Order not found", { status: 200 });
  }
  if (order.gateway_webhook_secret !== secret) {
    console.error("[Ozow Notify] Webhook secret mismatch for order:", referenceId);
    return new NextResponse("Invalid secret", { status: 200 });
  }
  if (!validateOzowResponse(payload)) {
    console.error("[Ozow Notify] Hash validation failed — see lib/ozow.ts comments before assuming this is spoofed; it may just mean NOTIFY_FIELD_ORDER needs adjusting against a real staging transaction.");
    return new NextResponse("Invalid hash", { status: 200 });
  }

  const status = payload.Status; // expect "Complete" | "Cancelled" | "Error" | "Pending"
  console.log("[Ozow Notify] Order:", referenceId, "| Status:", status, "| Ozow TransactionId:", payload.TransactionId);

  const outcome: PaymentOutcome | null =
    status === "Complete" ? "paid" :
    status === "Cancelled" ? "cancelled" :
    status === "Error" ? "failed" :
    null;

  if (!outcome) {
    console.log("[Ozow Notify] Status is Pending or unrecognised — no action taken, awaiting final notification.");
    return NextResponse.json({ ok: true });
  }

  const event: PaymentEvent = {
    gateway: "ozow",
    type: "order",
    outcome,
    referenceId,
    gatewayPaymentId: payload.TransactionId,
  };

  try {
    const result = await fulfillPayment(supabase, event);
    console.log("[Ozow Notify] fulfillPayment result:", JSON.stringify(result));
  } catch (err) {
    console.error("[Ozow Notify] Processing error (caught):", err);
    // Still return 200 — Ozow will retry on non-200 forever.
  }

  console.log("[Ozow Notify] ── Handler complete, returning 200 OK ──");
  return NextResponse.json({ ok: true });
}
