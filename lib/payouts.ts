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
//     PAYOUT_HOLD_DAYS before becoming withdrawable. That transition is
//     handled entirely in Postgres by recompute_wallet_balance() — see
//     supabase/migrations/20260705_marketplace_payouts.sql — so it happens
//     automatically whenever the wallet is read, no cron needed.
//   - As of July 2026, PAYOUT_HOLD_DAYS is 2 (previously 7) and admin pays
//     out approved withdrawals on Mondays, Wednesdays and Fridays — see
//     PAYOUT_DAYS_OF_WEEK / getNextPayoutDate() below. The 7-day figure
//     used to be chosen deliberately to match the customer returns window
//     (app/returns/page.tsx) so a partner couldn't cash out before a return
//     could claw the sale back. At 2 days that's no longer true — a return
//     filed on day 3–7 after delivery can now land after the payout is
//     already available, or even paid. Flagging so it's a conscious
//     tradeoff rather than a side effect.
//
// Idempotency: crediting is guarded two ways — a `payout_credited_at`
// timestamp on the source row (fast, avoids redundant work) and a unique
// index on wallet_transactions(source_type, source_id) in the database
// (authoritative, safe against concurrent webhook retries).

import type { SupabaseClient } from "@supabase/supabase-js";

export const COMMISSION_RATE = 0.055; // 5.5%
export const PAYOUT_HOLD_DAYS = 2; // turnaround target (was 7) — see note above re: returns-window overlap

export function splitCommission(grossCents: number): { commissionCents: number; payoutCents: number } {
  const gross = Math.max(Math.round(grossCents), 0);
  const commissionCents = Math.round(gross * COMMISSION_RATE);
  return { commissionCents, payoutCents: gross - commissionCents };
}

const fmtR = (cents: number) => `R${(cents / 100).toFixed(2)}`;

// ── Payout schedule ──────────────────────────────────────────────────────────
//
// Admin runs payouts on Mondays, Wednesdays and Fridays. This is an
// operational cadence for display purposes only — it is not enforced by the
// database or the admin Payments tab, which still lets staff mark a
// withdrawal "paid" on any day. getNextPayoutDate() just answers "when's
// the next scheduled run", for copy like "next payout run: Wednesday, 8 July".

export const PAYOUT_DAYS_OF_WEEK = [1, 3, 5] as const; // Mon, Wed, Fri (0 = Sun ... 6 = Sat)

/** The next date (today counts, if today is a payout day) on the Mon/Wed/Fri cycle. */
export function getNextPayoutDate(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (!(PAYOUT_DAYS_OF_WEEK as readonly number[]).includes(d.getDay())) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** e.g. "Wednesday, 8 July" */
export function formatPayoutDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
}

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

  if (!creditedFlag) {
    // The database says this (source_type, source_id) was already credited
    // — but this booking's own payout_credited_at is still null, or we
    // wouldn't have gotten this far (see the guard above). That mismatch
    // means an earlier attempt got as far as crediting the wallet but never
    // came back to flag it here, e.g. a crash between the two steps.
    // Resync rather than leaving it stuck showing "Payout pending…"
    // forever for money that's actually already sitting in the wallet.
    await supabase
      .from("bookings")
      .update({ commission_cents: commissionCents, payout_cents: payoutCents, payout_credited_at: new Date().toISOString() })
      .eq("id", bookingId)
      .is("payout_credited_at", null);
    return { credited: false, reason: "Already credited" };
  }

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

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id, quantity, unit_price, commission_cents, product:products(is_umuhle_product)")
    .eq("order_id", orderId);
  if (itemsError) {
    // A failed query (e.g. a selected column missing from the live schema)
    // must not be mistaken for "no items" — that's how this silently
    // stopped pre-computing splits at sale time for a long stretch before.
    console.error(`[recordOrderItemSplits] order_items query failed for order ${orderId}:`, itemsError.message);
    return;
  }
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

export interface OrderPayoutItemResult {
  itemId: string;
  productName: string;
  status: "credited" | "skipped";
  reason?: string;
}

/**
 * Credits every partner's wallet for their items in a delivered order.
 * Idempotent per line item — safe to call every time an order's status is
 * set to "delivered" (including re-saving "delivered" again as a manual
 * retry — see the admin order detail page's "Retry wallet crediting").
 *
 * Returns a per-item breakdown (not just two counts) so the admin UI can
 * show exactly what happened instead of a silent "skipped: 1" with no way
 * to tell why.
 */
export async function creditOrderPayouts(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ creditedItems: number; skipped: number; results: OrderPayoutItemResult[]; error?: string }> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, discount_cents")
    .eq("id", orderId)
    .single();

  if (!order || order.status !== "delivered") return { creditedItems: 0, skipped: 0, results: [] };

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id, quantity, unit_price, commission_cents, payout_cents, payout_credited_at, product:products(partner_id, name, is_umuhle_product)")
    .eq("order_id", orderId);

  if (itemsError) {
    // This is the bug that produced "0 credited, 0 skipped" for every
    // delivered order: a failed query (e.g. a column the schema doesn't
    // have) was indistinguishable from "no items". Surface it instead —
    // see 20260716_add_is_umuhle_product.sql for the root cause this
    // specific error was hiding.
    console.error(`[creditOrderPayouts] order_items query failed for order ${orderId}:`, itemsError.message);
    return { creditedItems: 0, skipped: 0, results: [], error: `Query failed: ${itemsError.message}` };
  }
  if (!items || items.length === 0) return { creditedItems: 0, skipped: 0, results: [] };

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const discount = order.discount_cents ?? 0;

  let creditedItems = 0;
  let skipped = 0;
  const results: OrderPayoutItemResult[] = [];

  for (const item of items) {
    const product = Array.isArray(item.product) ? item.product[0] : item.product;
    const productName = product?.name ?? "product";

    if (item.payout_credited_at) {
      skipped++;
      results.push({ itemId: item.id, productName, status: "skipped", reason: "Already credited" });
      continue;
    }

    if (!product?.partner_id) {
      skipped++;
      results.push({ itemId: item.id, productName, status: "skipped", reason: "No partner linked to this product" });
      continue;
    }
    if (product.is_umuhle_product) {
      skipped++;
      results.push({ itemId: item.id, productName, status: "skipped", reason: "Umuhle-direct product — no partner payout" });
      continue;
    }

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
      p_description: `Order payout — ${productName} × ${item.quantity} (${fmtR(lineGross)} less 5.5% Umuhle commission)`,
      p_source_type: "order_item",
      p_source_id: item.id,
      p_hold_days: PAYOUT_HOLD_DAYS,
    });

    if (rpcError) {
      skipped++;
      results.push({ itemId: item.id, productName, status: "skipped", reason: rpcError.message });
      continue;
    }

    if (!creditedFlag) {
      // Same resync as creditBookingPayout: the wallet already has this
      // credit from an earlier attempt, but this item's own flag never got
      // set. Fix the flag rather than leaving it looking un-paid forever.
      await supabase
        .from("order_items")
        .update({ commission_cents: commissionCents, payout_cents: payoutCents, payout_credited_at: new Date().toISOString() })
        .eq("id", item.id)
        .is("payout_credited_at", null);
      skipped++;
      results.push({ itemId: item.id, productName, status: "skipped", reason: "Already credited" });
      continue;
    }

    await supabase
      .from("order_items")
      .update({
        commission_cents: commissionCents,
        payout_cents: payoutCents,
        payout_credited_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    creditedItems++;
    results.push({ itemId: item.id, productName, status: "credited" });
  }

  return { creditedItems, skipped, results };
}
