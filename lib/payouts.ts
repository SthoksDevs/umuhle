// lib/payouts.ts
//
// Marketplace payouts for bookings and product sales.
//
// Rules:
//   - Umuhle takes a 5.5% commission on every booking and every product
//     sale. The remaining 94.5% belongs to the artist / store partner.
//   - Ads and salon subscriptions never go through this module — that
//     revenue is 100% Umuhle's, always.
//   - The split is computed and stored as soon as payment clears (called
//     from the PayFast/HappyPay/Ozow webhook handlers), so it's visible
//     and auditable immediately. But it only turns into real money in the
//     artist/partner's wallet once the booking is marked "completed" or the
//     order is marked "delivered" — see creditBookingPayout /
//     creditOrderPayouts below.
//   - Even once credited, funds sit in `pending_balance` for
//     PAYOUT_HOLD_DAYS (mirrors the site's returns window) before becoming
//     withdrawable. That transition is handled entirely in Postgres by
//     recompute_wallet_balance() — see supabase/migrations/20260705_marketplace_payouts.sql —
//     so it happens automatically whenever the wallet is read, no cron
//     needed.
//
// Idempotency: crediting is guarded two ways — a `payout_credited_at`
// timestamp on the source row (fast, avoids redundant work) and a unique
// index on wallet_transactions(source_type, source_id) in the database
// (authoritative, safe against concurrent webhook retries).

import type { SupabaseClient } from "@supabase/supabase-js";

export const COMMISSION_RATE = 0.055; // 5.5%
export const PAYOUT_HOLD_DAYS = 7; // matches the 7-day returns window

export function splitCommission(grossCents: number): { commissionCents: number; payoutCents: number } {
  const gross = Math.max(Math.round(grossCents), 0);
  const commissionCents = Math.round(gross * COMMISSION_RATE);
  return { commissionCents, payoutCents: gross - commissionCents };
}

const fmtR = (cents: number) => `R${(cents / 100).toFixed(2)}`;

// ── Bookings ─────────────────────────────────────────────────────────────────

/**
 * Records the commission/payout split on a booking as soon as it's paid for.
 * Call this right after a booking is created from a paid booking_intent
 * (PayFast ITN is currently the only gateway that sells bookings).
 * Does not touch the wallet — that only happens on completion.
 */
export async function recordBookingSplit(supabase: SupabaseClient, bookingId: string, totalAmountCents: number) {
  const { commissionCents, payoutCents } = splitCommission(totalAmountCents);
  await supabase
    .from("bookings")
    .update({ commission_cents: commissionCents, payout_cents: payoutCents })
    .eq("id", bookingId)
    .is("commission_cents", null); // don't clobber if already set
}

/**
 * Credits the artist's wallet for a completed booking. Only fires once —
 * safe to call every time a booking's status is set to "completed".
 */
export async function creditBookingPayout(
  supabase: SupabaseClient,
  bookingId: string
): Promise<{ credited: boolean; reason?: string }> {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(`
      id, status, total_amount, commission_cents, payout_cents, payout_credited_at,
      artist:artists(profile_id, display_name)
    `)
    .eq("id", bookingId)
    .single();

  if (error || !booking) return { credited: false, reason: "Booking not found" };
  if (booking.status !== "completed") return { credited: false, reason: "Booking is not completed" };
  if (booking.payout_credited_at) return { credited: false, reason: "Already credited" };

  const artistRow = Array.isArray(booking.artist) ? booking.artist[0] : booking.artist;
  if (!artistRow?.profile_id) return { credited: false, reason: "Booking has no linked artist profile" };

  // Fall back to computing the split now if it wasn't recorded at payment time
  // (e.g. bookings that existed before this migration).
  const { commissionCents, payoutCents } =
    booking.payout_cents != null && booking.commission_cents != null
      ? { commissionCents: booking.commission_cents, payoutCents: booking.payout_cents }
      : splitCommission(booking.total_amount);

  const { data: creditedFlag, error: rpcError } = await supabase.rpc("credit_wallet_earning", {
    p_profile_id: artistRow.profile_id,
    p_amount_cents: payoutCents,
    p_description: `Booking payout${artistRow.display_name ? ` — ${artistRow.display_name}` : ""} (${fmtR(booking.total_amount)} less 5.5% Umuhle commission)`,
    p_source_type: "booking",
    p_source_id: bookingId,
    p_hold_days: PAYOUT_HOLD_DAYS,
  });

  if (rpcError) return { credited: false, reason: rpcError.message };
  if (!creditedFlag) return { credited: false, reason: "Already credited" };

  await supabase
    .from("bookings")
    .update({
      commission_cents: commissionCents,
      payout_cents: payoutCents,
      payout_credited_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  return { credited: true };
}

// ── Product orders ──────────────────────────────────────────────────────────

/**
 * Records the per-item commission/payout split on every item in an order,
 * prorating any order-wide coupon discount across items by their share of
 * the subtotal. Call this right after an order is marked "paid" — from all
 * three payment webhooks (PayFast, HappyPay, Ozow).
 * Does not touch any wallet — that only happens once the order is delivered.
 */
export async function recordOrderItemSplits(supabase: SupabaseClient, orderId: string) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, discount_cents")
    .eq("id", orderId)
    .single();
  if (!order) return;

  const { data: items } = await supabase
    .from("order_items")
    .select("id, quantity, unit_price, commission_cents, product:products(is_umuhle_product)")
    .eq("order_id", orderId);
  if (!items || items.length === 0) return;

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const discount = order.discount_cents ?? 0;

  for (const item of items) {
    if (item.commission_cents != null) continue; // already recorded
    const lineGross = item.unit_price * item.quantity;
    const lineDiscount = subtotal > 0 ? Math.round((lineGross / subtotal) * discount) : 0;
    const netGross = Math.max(lineGross - lineDiscount, 0);

    const product = Array.isArray(item.product) ? item.product[0] : item.product;
    // Products Umuhle sells directly are 100% Umuhle revenue — same as ads
    // and salon subscriptions — so there's no partner payout to record.
    const { commissionCents, payoutCents } = product?.is_umuhle_product
      ? { commissionCents: netGross, payoutCents: 0 }
      : splitCommission(netGross);

    await supabase
      .from("order_items")
      .update({ commission_cents: commissionCents, payout_cents: payoutCents })
      .eq("id", item.id)
      .is("commission_cents", null);
  }
}

/**
 * Credits every partner's wallet for their items in a delivered order.
 * Idempotent per line item — safe to call every time an order's status is
 * set to "delivered".
 */
export async function creditOrderPayouts(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ creditedItems: number; skipped: number }> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, discount_cents")
    .eq("id", orderId)
    .single();

  if (!order || order.status !== "delivered") return { creditedItems: 0, skipped: 0 };

  const { data: items } = await supabase
    .from("order_items")
    .select("id, quantity, unit_price, commission_cents, payout_cents, payout_credited_at, product:products(partner_id, name, is_umuhle_product)")
    .eq("order_id", orderId);

  if (!items || items.length === 0) return { creditedItems: 0, skipped: 0 };

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const discount = order.discount_cents ?? 0;

  let creditedItems = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.payout_credited_at) { skipped++; continue; }

    const product = Array.isArray(item.product) ? item.product[0] : item.product;
    if (!product?.partner_id || product.is_umuhle_product) { skipped++; continue; }

    const lineGross = item.unit_price * item.quantity;
    const { commissionCents, payoutCents } =
      item.commission_cents != null && item.payout_cents != null
        ? { commissionCents: item.commission_cents, payoutCents: item.payout_cents }
        : splitCommission(
            subtotal > 0 ? lineGross - Math.round((lineGross / subtotal) * discount) : lineGross
          );

    const { data: creditedFlag, error: rpcError } = await supabase.rpc("credit_wallet_earning", {
      p_profile_id: product.partner_id,
      p_amount_cents: payoutCents,
      p_description: `Order payout — ${product.name ?? "product"} × ${item.quantity} (${fmtR(lineGross)} less 5.5% Umuhle commission)`,
      p_source_type: "order_item",
      p_source_id: item.id,
      p_hold_days: PAYOUT_HOLD_DAYS,
    });

    if (rpcError || !creditedFlag) { skipped++; continue; }

    await supabase
      .from("order_items")
      .update({
        commission_cents: commissionCents,
        payout_cents: payoutCents,
        payout_credited_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    creditedItems++;
  }

  return { creditedItems, skipped };
}
