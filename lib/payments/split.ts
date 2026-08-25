// lib/payments/split.ts
//
// Decides whether a payment can settle as an INSTANT PayFast split
// (money goes straight to the partner's own PayFast account at the moment
// of payment) instead of the default WALLET path (Umuhle gets the full
// amount, the partner's share (after Umuhle's service fee) sits in their
// wallet under a 2-day hold until withdrawal — see lib/payouts.ts).
//
// ⚠️  Real financial-risk tradeoff, not just a technical one: once a
// split fires, the money has left Umuhle's account immediately — there is
// no wallet balance left to claw back from if the booking is later
// cancelled, disputed, or refunded. The wallet path's hold period exists
// specifically to cover that window (see lib/payouts.ts's note on
// PAYOUT_HOLD_DAYS vs. the returns window). Instant splits trade that
// safety margin for the partner getting paid immediately. Worth deciding
// deliberately, e.g. only enabling `payfast_split_approved` for
// established partners rather than every new signup on day one.
//
// PayFast's own constraint (confirmed against developers.payfast.co.za):
// a single transaction can only split to ONE secondary merchant. That's
// naturally true for a booking (one artist) and a store booking deposit
// (one salon), but NOT guaranteed for a shop order — a cart can span
// several different sellers. isOrderSplitEligible() below is what
// enforces "only when every item belongs to the same seller".

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SplitTarget {
  merchantId: string;
  amountCents: number;
}

/**
 * Looks up whether `profileId` is set up to receive an instant split.
 * Returns null (→ fall back to the wallet path) unless BOTH the merchant
 * ID is on file AND payfast_split_approved is true. The approval flag is
 * admin-set (app/admin/partners page) once the merchant ID has actually
 * been added to Umuhle's "Allowed merchants" list in the PayFast
 * dashboard — see PAYFAST_MERCHANT_ID_HELP in lib/payments/merchant-id.ts.
 * An un-allow-listed merchant_id fails PayFast's WHOLE transaction, not
 * just the split, so this flag is a deliberate manual gate rather than
 * something a partner can switch on themselves by pasting an ID in.
 */
export async function getSplitTarget(
  supabase: SupabaseClient,
  profileId: string,
  payoutCents: number
): Promise<SplitTarget | null> {
  if (payoutCents <= 0) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("payfast_merchant_id, payfast_split_approved")
    .eq("id", profileId)
    .single();

  if (!profile?.payfast_merchant_id || !profile.payfast_split_approved) return null;

  return { merchantId: profile.payfast_merchant_id, amountCents: payoutCents };
}

/**
 * A cart can only split if every line item belongs to the SAME seller
 * profile (PayFast's one-secondary-merchant-per-transaction limit — see
 * file header). Returns that seller's profile_id if so, else null.
 * `sellerProfileIds` should be one entry per cart line, in any order,
 * already resolved from products.artist_id/partner_salon_id → profile_id
 * (is_umuhle_product lines should be excluded before calling this — an
 * Umuhle-stock line has no seller to split to, and eligibility.ts already
 * routes Umuhle-only carts to Ozow before this is ever reached).
 */
export function singleSellerProfileId(sellerProfileIds: (string | null | undefined)[]): string | null {
  const unique = new Set(sellerProfileIds.filter((id): id is string => Boolean(id)));
  return unique.size === 1 ? [...unique][0] : null;
}
