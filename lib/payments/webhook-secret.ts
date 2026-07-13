// lib/payments/webhook-secret.ts
//
// HappyPay and Ozow don't sign their webhook payloads the way PayFast's ITN
// does (PayFast: MD5 signature, checked twice — see generateItnSignature()
// and validateITN() in lib/payfast.ts). Instead, both gateways are handed a
// one-time random secret embedded in the webhook/notify URL itself when the
// order or booking is created, and simply echo it back via a `?secret=`
// query param. Both routes verified this identically against the `orders`
// table alone; this generalizes that lookup to whichever table the
// payment's `type` actually lives in, so the same check now also covers
// bookings.
//
// Deliberately kept OUT of fulfillment.ts — see the note at the top of that
// file: nothing in there should need to know what a webhook secret is.
// This is purely a transport-layer concern shared by two gateways.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentType } from "./types";

// Only the types HappyPay/Ozow can actually initiate today (see
// app/api/happypay/initiate/route.ts and app/api/ozow/initiate/route.ts)
// have a gateway_webhook_secret column at all.
const SECRET_TABLE: Partial<Record<PaymentType, string>> = {
  order: "orders",
  booking: "booking_intents",
};

/**
 * Looks up the stored gateway_webhook_secret for the given payment type +
 * reference id and compares it to the secret the gateway echoed back.
 * Returns false for an unsupported type, a missing row, or a mismatched
 * secret alike — callers don't need to distinguish which, they just reject.
 */
export async function verifyWebhookSecret(
  supabase: SupabaseClient,
  type: PaymentType,
  referenceId: string,
  secret: string | null
): Promise<boolean> {
  const table = SECRET_TABLE[type];
  if (!table || !secret) return false;

  const { data } = await supabase
    .from(table)
    .select("gateway_webhook_secret")
    .eq("id", referenceId)
    .single();

  const stored = data?.gateway_webhook_secret;
  return Boolean(stored) && stored === secret;
}
