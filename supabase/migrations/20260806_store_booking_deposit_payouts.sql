-- Store booking deposits belong to the salon, not Umuhle (confirmed by
-- Thokozane 2026-08-06) — they need the same commission/payout split and
-- wallet-crediting bookings already get (see lib/payouts.ts), and the same
-- TradeSafe escrow lifecycle orders/bookings get. Previously excluded from
-- TradeSafe entirely on the assumption the deposit was Umuhle's — that
-- assumption was wrong; see lib/payments/eligibility.ts.
ALTER TABLE public.store_bookings
  ADD COLUMN IF NOT EXISTS commission_cents integer,
  ADD COLUMN IF NOT EXISTS payout_cents integer,
  ADD COLUMN IF NOT EXISTS payout_credited_at timestamptz,
  ADD COLUMN IF NOT EXISTS tradesafe_allocation_id text,
  ADD COLUMN IF NOT EXISTS tradesafe_delivery_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS tradesafe_released_at timestamptz;

-- credit_wallet_earning's caller passes source_type='store_booking_deposit'
-- (see creditStoreBookingDepositPayout in lib/payouts.ts) — wallet_transactions
-- had a CHECK constraint enumerating the allowed values that didn't include it.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_source_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_source_type_check
  CHECK (source_type = ANY (ARRAY['booking'::text, 'order_item'::text, 'referral'::text, 'withdrawal'::text, 'adjustment'::text, 'store_booking_deposit'::text]));
