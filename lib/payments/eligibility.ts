// lib/payments/eligibility.ts
//
// Single source of truth for which payment gateways a given payment is
// allowed to use. Two independent rules force Ozow exclusively:
//
//   1. PayFast's own minimum transaction amount — R5, well below anything
//      Umuhle actually charges, but the API still rejects lower amounts
//      outright, so this floor exists to fail fast client-side rather than
//      let a checkout bounce off PayFast with a cryptic error.
//   2. Umuhle-profit-only payments never need to go through PayFast at
//      all — there's no partner to pay out, so Ozow paying straight into
//      the business account is strictly simpler. This is always true for
//      "salon" (the annual salon subscription fee — never involves a
//      partner payout, see fulfillSalon in ./fulfillment.ts), and true
//      for "order" only when every line item is Umuhle's own stock
//      (products.is_umuhle_product). Ads and paid product listings used
//      to be in this always-profit-only list too, but were removed in
//      2026-08 — see lib/payments/split.ts's file header for how
//      products work now (free to list, optionally linked to a service
//      as an upsell).
//
// "booking" and "store_booking_deposit" are NEVER profit-only — a booking
// deposit belongs to the salon, not Umuhle, same as a full artist booking
// belongs to the artist — so both are eligible for PayFast whenever they
// clear the R5 minimum (in practice, always).
//
// Both the frontend gateway picker (app/checkout/page.tsx, the booking
// drawer in app/page.tsx, via app/api/payments/gateways/route.ts) AND every
// initiate route call into this, so the rule holds even if an initiate
// route is hit directly, bypassing the UI entirely.

import type { PaymentGateway } from "./gateways";
import { enabledGateways } from "./gateways";
import type { PaymentType } from "./types";

/** PayFast's minimum transaction amount. R5 in cents. */
export const PAYFAST_MINIMUM_CENTS = 500;

/**
 * Payment types that are ALWAYS 100% Umuhle revenue — no partner payout
 * ever happens for these (see fulfillment.ts), regardless of amount.
 */
const ALWAYS_UMUHLE_PROFIT_TYPES: readonly PaymentType[] = ["salon"];

export function isAlwaysUmuhleProfitType(type: PaymentType): boolean {
  return (ALWAYS_UMUHLE_PROFIT_TYPES as PaymentType[]).includes(type);
}

export interface GatewayEligibilityInput {
  type: PaymentType;
  amountCents: number;
  /**
   * Only meaningful for `type: "order"` — whether every line item in the
   * cart is Umuhle's own stock. Ignored for every other type: ad/
   * product_listing/salon are always profit-only regardless of this flag
   * (see isAlwaysUmuhleProfitType above), and booking/store_booking_deposit
   * are never profit-only, so this never applies to them either.
   */
  isUmuhleProfitOnly?: boolean;
}

/**
 * Every gateway this payment is allowed to use, filtered to gateways
 * currently switched on (lib/payments/gateways.ts), in stable display
 * order. Ozow is always included — it's the universal fallback with no
 * minimum and no profit-sharing concerns.
 */
export function getEligibleGateways(input: GatewayEligibilityInput): PaymentGateway[] {
  const profitOnly = isAlwaysUmuhleProfitType(input.type) || Boolean(input.isUmuhleProfitOnly);
  const belowMinimum = input.amountCents < PAYFAST_MINIMUM_CENTS;

  const eligible: PaymentGateway[] = profitOnly || belowMinimum ? ["ozow"] : ["payfast", "ozow"];
  return enabledGateways().filter((g) => eligible.includes(g));
}

export function isGatewayEligible(gateway: PaymentGateway, input: GatewayEligibilityInput): boolean {
  return getEligibleGateways(input).includes(gateway);
}

/**
 * Human-readable reason PayFast isn't offered, for error messages and UI
 * hints. Returns null if PayFast IS eligible for this payment.
 */
export function whyPayFastIneligible(input: GatewayEligibilityInput): string | null {
  if (isAlwaysUmuhleProfitType(input.type) || input.isUmuhleProfitOnly) {
    return "This payment goes entirely to Umuhle, so it's paid via Ozow instead of PayFast.";
  }
  if (input.amountCents < PAYFAST_MINIMUM_CENTS) {
    return `PayFast requires a minimum of R${(PAYFAST_MINIMUM_CENTS / 100).toFixed(0)} — please pay via Ozow instead.`;
  }
  return null;
}
