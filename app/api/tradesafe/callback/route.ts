// app/api/tradesafe/callback/route.ts
//
// TradeSafe's webhook — fires every time a transaction's state changes
// (see docs.tradesafe.co.za/api/callbacks/). Unlike Ozow/PayFast, this URL
// is configured ONCE in TradeSafe's own dashboard (Getting Started → First
// Steps → "Register your application"), not generated per-checkout — so
// the secret that proves a request really came from TradeSafe is a single
// static value (TRADESAFE_WEBHOOK_SECRET) rather than the
// per-transaction gateway_webhook_secret pattern Ozow uses. Register this
// exact URL there:
//
//   https://umuhle.co.za/api/tradesafe/callback?secret=<TRADESAFE_WEBHOOK_SECRET>
//
// Our own payment `type` (booking/order) is round-tripped through
// TradeSafe's `reference` field (set at transactionCreate time — see
// buildReference()/parseReference() in lib/tradesafe.ts) since TradeSafe
// doesn't let the callback URL vary per-transaction the way Ozow's NotifyUrl
// does.
//
// Always returns 200 once the payload's been read, even on internal
// errors — otherwise TradeSafe has no way to know we're done with it and
// nothing here indicates it retries differently than that.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { isValidCallbackSecret, parseReference, TRADESAFE_CALLBACK_IPS } from "@/lib/tradesafe";
import type { PaymentEvent, PaymentOutcome, PaymentType } from "@/lib/payments/types";

interface TradeSafeCallbackPayload {
  url: string;
  data: {
    id: string;
    reference: string;
    state: string;
    balance: string;
    updated_at: string;
    allocations: { id: string; state: string; updated_at: string }[];
  };
}

export async function POST(req: NextRequest) {
  console.log("[TradeSafe Callback] ── Incoming callback ──");

  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (!isValidCallbackSecret(secret)) {
    console.error("[TradeSafe Callback] Invalid or missing secret");
    return new NextResponse("Invalid secret", { status: 200 });
  }

  // Soft check only — see TRADESAFE_CALLBACK_IPS's own comment on why this
  // isn't enforced (Vercel's edge network makes strict IP allow-listing
  // unreliable). Logged for visibility, not blocked on.
  const requestIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (requestIp && !TRADESAFE_CALLBACK_IPS.includes(requestIp)) {
    console.warn("[TradeSafe Callback] Request IP not in TradeSafe's documented list:", requestIp);
  }

  let payload: TradeSafeCallbackPayload;
  try {
    payload = await req.json();
  } catch {
    console.error("[TradeSafe Callback] Body wasn't valid JSON");
    return new NextResponse("Invalid body", { status: 200 });
  }
  console.log("[TradeSafe Callback] Parsed payload:", JSON.stringify(payload, null, 2));

  const parsed = parseReference(payload.data?.reference ?? "");
  if (!parsed) {
    console.error("[TradeSafe Callback] Couldn't parse reference:", payload.data?.reference);
    return new NextResponse("Unrecognised reference", { status: 200 });
  }

  const type = parsed.type as PaymentType;
  if (type !== "order" && type !== "booking" && type !== "store_booking_deposit") {
    // The only three types TradeSafe ever initiates — see
    // app/api/tradesafe/initiate/route.ts.
    console.error("[TradeSafe Callback] Unsupported payment type:", type);
    return new NextResponse("Unsupported payment type", { status: 200 });
  }

  const state = payload.data?.state;
  console.log("[TradeSafe Callback] Reference:", parsed.id, "| Type:", type, "| State:", state);

  // FUNDS_RECEIVED is the "paid" trigger — same point PayFast's COMPLETE /
  // Ozow's Complete used to fire fulfillPayment. Everything past that
  // (INITIATED, DELIVERED, FUNDS_RELEASED) is Umuhle's own escrow-release
  // lifecycle already being driven by lib/payments/fulfillment.ts and
  // app/api/order-items/confirm/[token]/route.ts, not a fresh payment
  // event — so those states are acknowledged and ignored here rather than
  // re-triggering fulfillment.
  const outcome: PaymentOutcome | null =
    state === "FUNDS_RECEIVED" ? "paid" :
    state === "CANCELLED" ? "cancelled" :
    state === "REFUNDED" ? "failed" :
    null;

  if (!outcome) {
    console.log("[TradeSafe Callback] State", state, "needs no fulfillment action — acknowledged.");
    return NextResponse.json({ ok: true });
  }

  const supabase = await createServiceClient();
  const event: PaymentEvent = {
    gateway: "tradesafe",
    type,
    outcome,
    referenceId: parsed.id,
    gatewayPaymentId: payload.data.id,
  };

  try {
    const result = await fulfillPayment(supabase, event);
    console.log("[TradeSafe Callback] fulfillPayment result:", JSON.stringify(result));
  } catch (err) {
    console.error("[TradeSafe Callback] Processing error (caught):", err);
  }

  console.log("[TradeSafe Callback] ── Handler complete, returning 200 OK ──");
  return NextResponse.json({ ok: true });
}
