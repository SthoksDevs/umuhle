// app/api/payfast/notify/route.ts
// PayFast Instant Transaction Notification (ITN) handler.
//
// This route's only job is PayFast-specific transport: verify the ITN
// signature, translate PayFast's field names into a normalized
// PaymentEvent, and hand off to fulfillPayment() (lib/payments/fulfillment.ts)
// for the actual "what happens now" decision — which is identical no
// matter which gateway the payment came through. See that file for the
// booking/order/ad/salon/product_listing logic that used to live here.
//
// PayFast always expects a 200 response, even for invalid/rejected
// notifications — a non-200 makes it retry forever — so every path below
// returns 200.

import { NextRequest, NextResponse } from "next/server";
import { validateITN } from "@/lib/payfast";
import { createServiceClient } from "@/lib/supabase/server";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import type { PaymentEvent, PaymentOutcome, PaymentType } from "@/lib/payments/types";

export async function POST(req: NextRequest) {
  console.log("[PayFast ITN] ── Incoming notification ──");
  console.log("[PayFast ITN] Headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));

  const text = await req.text();
  console.log("[PayFast ITN] Raw request body:", text);

  const params = Object.fromEntries(new URLSearchParams(text));
  console.log("[PayFast ITN] Parsed params:", JSON.stringify(params, null, 2));

  // 1. Validate signature + PayFast server-side confirmation
  const isValid = await validateITN(params);
  if (!isValid) {
    console.error("[PayFast ITN] ❌ validateITN returned false — notification rejected. See logs above for signature comparison details.");
    return new NextResponse("INVALID", { status: 200 }); // Always 200 to PayFast
  }
  console.log("[PayFast ITN] ✅ Notification validated successfully. Processing payment type:", params.custom_str1, "| status:", params.payment_status);

  const paymentType = params.custom_str1 as PaymentType | undefined;
  const paymentStatus = params.payment_status; // "COMPLETE" | "CANCELLED" | "FAILED" | "PENDING"

  const outcome: PaymentOutcome | null =
    paymentStatus === "COMPLETE" ? "paid" :
    paymentStatus === "CANCELLED" ? "cancelled" :
    paymentStatus === "FAILED" ? "failed" :
    null; // PENDING or anything unrecognised — no action, matches prior behaviour

  if (!paymentType || !outcome) {
    console.log("[PayFast ITN] No action taken — type:", paymentType, "| status:", paymentStatus);
    return new NextResponse("OK", { status: 200 });
  }

  const event: PaymentEvent = {
    gateway: "payfast",
    type: paymentType,
    outcome,
    referenceId: params.m_payment_id,
    gatewayPaymentId: params.pf_payment_id,
  };

  try {
    const result = await fulfillPayment(await createServiceClient(), event);
    console.log("[PayFast ITN] fulfillPayment result:", JSON.stringify(result));
  } catch (err) {
    console.error("[PayFast ITN] Processing error (caught):", err);
    // Still return 200 — PayFast will retry on non-200 forever
  }

  console.log("[PayFast ITN] ── Handler complete, returning 200 OK to PayFast ──");
  return new NextResponse("OK", { status: 200 });
}
