// lib/referrals.ts
//
// One-time referral bonus for a referred PARTNER's (artist or
// business_partner) first qualifying income event. Fires at completion
// (booking completed / order delivered / salon fee paid) — matches
// partner payout timing, not initial payment success. One-time, locked
// in once triggered, forward-only (no backfill).
//
// Confirmed 2026-08-20: store booking deposits are deliberately NOT a
// trigger source here. A salon must pay the R35 registration fee before
// it can go live and accept bookings at all, so for any referred salon
// owner the "salon" event will always fire first — a store-booking-deposit
// hook would only ever find the reward already claimed. Only fulfillSalon
// (for salon owners) and creditBookingPayout (for artists) are wired to
// the "booking"/"salon" source types; creditStoreBookingDepositPayout is
// intentionally left untouched.

import type { SupabaseClient } from "@supabase/supabase-js";

export const REFERRAL_REWARD_RATE = 0.5;
export const REFERRAL_REWARD_CAP_CENTS = 20000; // R200

const fmtR = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export type ReferralSourceType = "booking" | "order" | "salon";

const SOURCE_LABEL: Record<ReferralSourceType, string> = {
  booking: "first booking",
  order: "first product sale",
  salon: "store registration",
};

function computeReferralReward(commissionBaseCents: number): number {
  return Math.min(Math.round(commissionBaseCents * REFERRAL_REWARD_RATE), REFERRAL_REWARD_CAP_CENTS);
}

/**
 * Call once, right where a referred partner's own payout/fee event
 * completes. Safe on every retry — no-ops (not an error) if the partner
 * wasn't referred, a referral reward already fired for them (any source,
 * ever), or commissionBaseCents <= 0.
 */
export async function maybeTriggerReferralReward(
  supabase: SupabaseClient,
  params: {
    referredPartnerId: string;
    sourceType: ReferralSourceType;
    sourceId: string;
    commissionBaseCents: number;
  }
): Promise<{ triggered: boolean; reason?: string }> {
  const { referredPartnerId, sourceType, sourceId, commissionBaseCents } = params;
  if (!commissionBaseCents || commissionBaseCents <= 0) {
    return { triggered: false, reason: "No commission to base a reward on" };
  }

  const { data: partner } = await supabase
    .from("profiles")
    .select("referred_by")
    .eq("id", referredPartnerId)
    .single();

  if (!partner?.referred_by) return { triggered: false, reason: "Not a referred partner" };

  const rewardCents = computeReferralReward(commissionBaseCents);
  if (rewardCents <= 0) return { triggered: false, reason: "Computed reward was zero" };

  // Insert first — the unique index on referred_id (see
  // supabase/migrations/20260820_referral_rewards.sql) is the real guard
  // against double-firing, not this function. A unique_violation here
  // means some other completion event already claimed this partner's
  // one-time reward.
  const { data: row, error: insertError } = await supabase
    .from("referrals")
    .insert({
      referrer_id: partner.referred_by,
      referred_id: referredPartnerId,
      source_type: sourceType,
      source_id: sourceId,
      commission_base_cents: commissionBaseCents,
      reward_amount: rewardCents,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return { triggered: false, reason: "Referral reward already claimed for this partner" };
    }
    return { triggered: false, reason: insertError.message };
  }

  const { data: creditedFlag, error: rpcError } = await supabase.rpc("credit_wallet_earning", {
    p_profile_id: partner.referred_by,
    p_amount_cents: rewardCents,
    p_description: `Referral bonus — your referral's ${SOURCE_LABEL[sourceType]} (${fmtR(rewardCents)})`,
    p_source_type: "referral",
    p_source_id: row.id,
    p_hold_days: 0,
  });

  if (rpcError || !creditedFlag) {
    // The one-time claim (the referrals row) is locked in either way —
    // only the wallet credit failed. Leave status "pending" so this is
    // easy to find and retry manually instead of silently losing it.
    console.error(`[maybeTriggerReferralReward] wallet credit failed for referral ${row.id}:`, rpcError?.message);
    return { triggered: false, reason: rpcError?.message ?? "Wallet credit did not apply" };
  }

  await supabase
    .from("referrals")
    .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
    .eq("id", row.id);

  return { triggered: true };
}

/**
 * Sums Umuhle's commission across every line item ONE partner has in ONE
 * order — the "whole order value belonging to partner" referral basis,
 * not a single line item. commission_cents is fixed at payment time
 * (recordOrderItemSplits), so this total is stable regardless of how many
 * of the partner's items have actually been marked delivered yet.
 */
export async function sumOrderCommissionForPartner(
  supabase: SupabaseClient,
  orderId: string,
  partnerId: string
): Promise<number> {
  const { data: items } = await supabase
    .from("order_items")
    .select("commission_cents, product:products(partner_id)")
    .eq("order_id", orderId);

  return (items ?? []).reduce((sum, item) => {
    const product = Array.isArray(item.product) ? item.product[0] : item.product;
    if (product?.partner_id !== partnerId) return sum;
    return sum + (item.commission_cents ?? 0);
  }, 0);
}
