// lib/payments/eligibility.ts
//
// Single source of truth for which payment gateways a given payment is
// allowed to use. Two independent rules force Ozow exclusively:
//
//   1. TradeSafe's own R50 minimum transaction amount (confirmed against
//      TradeSafe's docs) — anything below that, TradeSafe's API rejects
//      outright, so there's no point offering it.
//   2. Umuhle-profit-only payments never need to sit in TradeSafe's escrow
//      and be split out later — there's no partner to protect, the money
//      is Umuhle's the moment it clears. Ozow pays straight into the
//      business account, which is strictly simpler for these. This is
//      always true for "ad", "product_listing" and "salon" (they never
//      involve a partner payout — see fulfillAd/fulfillProductListing/
//      fulfillSalon in ./fulfillment.ts), and true for "order" only when
//      every line item is Umuhle's own stock (products.is_umuhle_product).
//
// "booking" and "store_booking_deposit" are NEVER profit-only — a booking
// deposit belongs to the salon, not Umuhle (confirmed 2026-08-06), same as
// a full artist booking belongs to the artist — so both are eligible for
// TradeSafe whenever they clear the R50 minimum. Both release TradeSafe's
// escrow at the moment the partner marks the booking "completed" — see
// acceptAllocationDelivery calls in app/api/bookings/[id]/status/route.ts
// and app/api/store-bookings/[id]/status/route.ts, and the payout-crediting
// they trigger alongside it in lib/payouts.ts.
//
// Both the frontend gateway picker (app/checkout/page.tsx, the booking
// drawer in app/page.tsx, via app/api/payments/gateways/route.ts) AND every
// initiate route call into this, so the rule holds even if an initiate
// route is hit directly, bypassing the UI entirely.

import type { PaymentGateway } from "./gateways";
import { enabledGateways } from "./gateways";
import type { PaymentType } from "./types";

/** TradeSafe's minimum transaction amount. R50 in cents. */
export const TRADESAFE_MINIMUM_CENTS = 5000;

/**
 * Payment types that are ALWAYS 100% Umuhle revenue — no partner payout
 * ever happens for these (see fulfillment.ts), regardless of amount.
 */
const ALWAYS_UMUHLE_PROFIT_TYPES: readonly PaymentType[] = ["ad", "product_listing", "salon"];

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
  const belowMinimum = input.amountCents < TRADESAFE_MINIMUM_CENTS;

  const eligible: PaymentGateway[] = profitOnly || belowMinimum ? ["ozow"] : ["tradesafe", "ozow"];
  return enabledGateways().filter((g) => eligible.includes(g));
}

export function isGatewayEligible(gateway: PaymentGateway, input: GatewayEligibilityInput): boolean {
  return getEligibleGateways(input).includes(gateway);
}

/**
 * Human-readable reason TradeSafe isn't offered, for error messages and UI
 * hints. Returns null if TradeSafe IS eligible for this payment.
 */
export function whyTradeSafeIneligible(input: GatewayEligibilityInput): string | null {
  if (isAlwaysUmuhleProfitType(input.type) || input.isUmuhleProfitOnly) {
    return "This payment goes entirely to Umuhle, so it's paid via Ozow instead of TradeSafe's escrow.";
  }
  if (input.amountCents < TRADESAFE_MINIMUM_CENTS) {
    return `TradeSafe requires a minimum of R${(TRADESAFE_MINIMUM_CENTS / 100).toFixed(0)} — please pay via Ozow instead.`;
  }
  return null;
}
