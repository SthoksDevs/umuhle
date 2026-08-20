-- Restore PayFast as the primary gateway (replaces TradeSafe) + drop the
-- R50 minimum in favour of PayFast's real R5 minimum.
--
-- No CHECK constraint changes needed: the 2026-08-06 TradeSafe migration
-- (supabase/migrations/20260806_tradesafe_gateway.sql) already kept
-- 'payfast' in every payment_method CHECK constraint's allowed list, so
-- it's still a valid value today. This migration only flips the DEFAULT
-- back, so new rows default to PayFast again instead of TradeSafe.
--
-- tradesafe_allocation_id / tradesafe_delivery_started_at /
-- tradesafe_released_at / tradesafe_transaction_id columns are left in
-- place, frozen, for historical rows — same pattern already used for
-- payfast_payment_id (see lib/payments/fulfillment.ts's file header).
-- Nothing in the app writes to them anymore as of this migration.

ALTER TABLE public.orders ALTER COLUMN payment_method SET DEFAULT 'payfast';
ALTER TABLE public.booking_intents ALTER COLUMN payment_method SET DEFAULT 'payfast';

-- store_bookings.payment_method has never had a DEFAULT or CHECK
-- constraint (see supabase/schema.sql) — every write already sets it
-- explicitly (see app/api/payfast/initiate/route.ts's
-- initiateStoreBookingDeposit), so nothing to change here.


-- ── PayFast split payments ──────────────────────────────────────────────
-- See lib/payments/split.ts for the full reasoning. Summary:
--   payfast_merchant_id     — the partner's own PayFast merchant ID,
--                              collected during onboarding.
--   payfast_split_approved  — admin-set. TKZ must first add this
--                              merchant ID to Umuhle's "Allowed merchants"
--                              list in the PayFast dashboard (this appears
--                              to be a manual, per-merchant dashboard step
--                              — confirm with PayFast support whether an
--                              API exists before assuming this scales
--                              unattended) — only flip this to true once
--                              that's confirmed done, or PayFast will
--                              reject the whole transaction, not just the
--                              split.
--   payout_via              — 'wallet' (default, unchanged behaviour) or
--                              'instant_split' — set at payment-initiate
--                              time, tells creditBookingPayout /
--                              creditStoreBookingDepositPayout /
--                              creditOrderItemPayout (lib/payouts.ts) to
--                              skip wallet crediting for money that
--                              already went straight to the partner.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payfast_merchant_id text,
  ADD COLUMN IF NOT EXISTS payfast_split_approved boolean NOT NULL DEFAULT false;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payout_via text NOT NULL DEFAULT 'wallet'
    CHECK (payout_via IN ('wallet', 'instant_split'));

ALTER TABLE public.store_bookings
  ADD COLUMN IF NOT EXISTS payout_via text NOT NULL DEFAULT 'wallet'
    CHECK (payout_via IN ('wallet', 'instant_split'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payout_via text NOT NULL DEFAULT 'wallet'
    CHECK (payout_via IN ('wallet', 'instant_split'));

-- booking_intents carries the decision made at initiate time through to
-- fulfillment.ts, which copies it onto the final `bookings` row.
ALTER TABLE public.booking_intents
  ADD COLUMN IF NOT EXISTS payout_via text NOT NULL DEFAULT 'wallet'
    CHECK (payout_via IN ('wallet', 'instant_split'));

