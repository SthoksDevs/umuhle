// lib/payments/webhook-secret.ts
//
// Ozow doesn't sign its webhook payloads the way PayFast's ITN did
// (PayFast: MD5 signature, checked twice — see generateItnSignature() and
// validateITN(), both since removed along with lib/payfast.ts). Instead
// Ozow is handed a one-time random secret embedded in the webhook/notify
// URL itself when the order/booking/ad/etc. is created, and simply echoes
// it back via a `?secret=` query param. This generalizes that lookup to
// whichever table the payment's `type` actually lives in.
//
// TradeSafe uses a different model entirely — one static secret for the
// whole callback URL, configured once in TradeSafe's own dashboard rather
// than per-transaction — see isValidCallbackSecret() in lib/tradesafe.ts.
// This file is Ozow-only.
//
// Deliberately kept OUT of fulfillment.ts — see the note at the top of that
// file: nothing in there should need to know what a webhook secret is.
// This is purely a transport-layer concern.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentType } from "./types";

// Every type Ozow can initiate today (see app/api/ozow/initiate/route.ts)
// has a gateway_webhook_secret column — ad/product_listing/salon/
// store_booking_deposit picked theirs up in the same migration that moved
// them off PayFast onto Ozow exclusively (see lib/payments/eligibility.ts).
const SECRET_TABLE: Partial<Record<PaymentType, string>> = {
  order: "orders",
  booking: "booking_intents",
  ad: "ads",
  product_listing: "products",
  salon: "salon_subscription_payments",
  store_booking_deposit: "store_bookings",
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
