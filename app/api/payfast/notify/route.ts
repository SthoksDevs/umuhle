// app/api/payfast/notify/route.ts
// PayFast's Instant Transaction Notification (ITN) — server-to-server, the
// source of truth (the browser return_url redirect is display-only and
// never trusted to flip a payment to "paid"). Register this URL with
// PayFast as the notify_url — it's already sent per-transaction by
// buildPaymentParams() in lib/payfast.ts, so no dashboard configuration is
// needed the way PayFast's static callback URL required.
//
// Two checks before we trust it — both inside validateITN() (lib/payfast.ts):
//   1. Our own MD5 signature over the posted fields, using PAYFAST_PASSPHRASE.
//   2. A second, server-to-server round trip back to PayFast's own
//      /eng/query/validate endpoint, confirming PayFast really sent this.
//
// Once both pass, this route's only job is to normalize the payload into a
// PaymentEvent and hand off to fulfillPayment() (lib/payments/fulfillment.ts)
// for the actual decision — same shared path Ozow's notify route uses.
// Always returns 200 once the payload's been read, even on internal
// errors — otherwise PayFast will retry indefinitely.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateITN } from "@/lib/payfast";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import type { PaymentEvent, PaymentOutcome, PaymentType } from "@/lib/payments/types";

const SUPPORTED_TYPES: PaymentType[] = ["order", "booking", "store_booking_deposit"];

export async function POST(req: NextRequest) {
  console.log("[PayFast Notify] ── Incoming ITN ──");

  const text = await req.text();
  const payload = Object.fromEntries(new URLSearchParams(text)) as Record<string, string>;
  console.log("[PayFast Notify] Parsed payload:", JSON.stringify(payload, null, 2));

  const referenceId = payload.m_payment_id;
  const type = (payload.custom_str1 || "order") as PaymentType;

  if (!referenceId) {
    console.error("[PayFast Notify] Missing m_payment_id");
    return new NextResponse("Missing m_payment_id", { status: 200 });
  }
  if (!SUPPORTED_TYPES.includes(type)) {
    console.error("[PayFast Notify] Unsupported payment type:", type);
    return new NextResponse("Unsupported payment type", { status: 200 });
  }

  const isValid = await validateITN(payload);
  if (!isValid) {
    console.error("[PayFast Notify] ITN validation failed — signature mismatch or PayFast couldn't confirm this transaction.");
    return new NextResponse("Invalid ITN", { status: 200 });
  }

  const status = payload.payment_status; // "COMPLETE" | "FAILED" | "CANCELLED"
  console.log("[PayFast Notify] Reference:", referenceId, "| Type:", type, "| Status:", status);

  const outcome: PaymentOutcome | null =
    status === "COMPLETE"   ? "paid" :
    status === "CANCELLED"  ? "cancelled" :
    status === "FAILED"     ? "failed" :
    null;

  if (!outcome) {
    console.log("[PayFast Notify] Status", status, "needs no fulfillment action — acknowledged.");
    return NextResponse.json({ ok: true });
  }

  const supabase = await createServiceClient();
  const event: PaymentEvent = {
    gateway: "payfast",
    type,
    outcome,
    referenceId,
    gatewayPaymentId: payload.pf_payment_id,
  };

  try {
    const result = await fulfillPayment(supabase, event);
    console.log("[PayFast Notify] fulfillPayment result:", JSON.stringify(result));
  } catch (err) {
    console.error("[PayFast Notify] Processing error (caught):", err);
  }

  console.log("[PayFast Notify] ── Handler complete, returning 200 OK ──");
  return NextResponse.json({ ok: true });
}
