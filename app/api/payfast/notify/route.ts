// app/api/payfast/notify/route.ts
// PayFast Instant Transaction Notification (ITN) handler.
//
// This route's only job is PayFast-specific: verify the signature, then
// translate PayFast's payload into a gateway-agnostic PaymentEvent.
// Everything about what a completed/cancelled/failed booking, order, ad,
// salon subscription, or product listing actually does lives in
// lib/payments/fulfillment.ts and lib/payments/handlers/* — not here. See
// lib/payments/types.ts for why.

import { NextRequest, NextResponse } from "next/server";
import { validateITN } from "@/lib/payfast";
import { createServiceClient } from "@/lib/supabase/server";
import { processPaymentEvent, type PaymentType, type PaymentOutcome } from "@/lib/payments/fulfillment";

// PayFast's own status strings → our gateway-agnostic outcome. "PENDING"
// (and anything else PayFast might send) isn't a final state, so it isn't
// mapped — we just acknowledge and wait for the next notification.
const OUTCOME_MAP: Record<string, PaymentOutcome | undefined> = {
  COMPLETE: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
};

export async function POST(req: NextRequest) {
  console.log("[PayFast ITN] ── Incoming notification ──");

  const text = await req.text();
  const params = Object.fromEntries(new URLSearchParams(text));
  console.log("[PayFast ITN] Parsed params:", JSON.stringify(params, null, 2));

  // 1. Validate signature + PayFast server-side confirmation
  const isValid = await validateITN(params);
  if (!isValid) {
    console.error("[PayFast ITN] ❌ validateITN returned false — notification rejected.");
    return new NextResponse("INVALID", { status: 200 }); // Always 200 to PayFast
  }

  const paymentType = params.custom_str1 as PaymentType | undefined;
  const outcome = OUTCOME_MAP[params.payment_status];
  const paymentId = params.m_payment_id;
  const pfPaymentId = params.pf_payment_id;

  console.log("[PayFast ITN] type:", paymentType, "| status:", params.payment_status, "| paymentId:", paymentId);

  if (!paymentType || !paymentId) {
    console.warn("[PayFast ITN] Missing custom_str1 (type) or m_payment_id — nothing to do.");
    return new NextResponse("OK", { status: 200 });
  }

  if (!outcome) {
    console.log("[PayFast ITN] Status is PENDING or unrecognised — no action taken, awaiting a final notification.");
    return new NextResponse("OK", { status: 200 });
  }

  const supabase = await createServiceClient();

  const result = await processPaymentEvent(supabase, {
    type: paymentType,
    paymentId,
    outcome,
    gateway: "payfast",
    gatewayPaymentId: pfPaymentId,
  });

  if (!result.ok) {
    console.error("[PayFast ITN] Fulfillment error:", result.reason);
  }

  console.log("[PayFast ITN] ── Handler complete, returning 200 OK to PayFast ──");
  return new NextResponse("OK", { status: 200 });
}
