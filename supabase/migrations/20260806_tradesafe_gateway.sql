-- TradeSafe payment gateway (replaces PayFast) + Ozow taking over PayFast's
-- remaining scope (ad / product_listing / salon / store_booking_deposit —
-- see lib/payments/eligibility.ts for why those stay Ozow-only forever).
-- See lib/tradesafe.ts, app/api/tradesafe/*, app/api/ozow/* for usage.
--
-- Applied directly against production via the Supabase MCP on 2026-08-06 —
-- this file exists for the repo's own record, same as the is_umuhle_product
-- change referenced in lib/payouts.ts never got its own committed file.

-- 1. Escrow lifecycle tracking on orders. TradeSafe holds funds until we
--    tell it delivery is accepted (see lib/tradesafe.ts's
--    allocationStartDelivery/allocationAcceptDelivery), unlike PayFast/Ozow
--    which pay out directly. These track that per-order state so we only
--    ever call the release mutations once.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tradesafe_transaction_id text,
  ADD COLUMN IF NOT EXISTS tradesafe_allocation_id text,
  ADD COLUMN IF NOT EXISTS tradesafe_delivery_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS tradesafe_released_at timestamptz;

-- 2. Generic gateway reference + webhook secret columns for the four
--    payment types that only ever went through PayFast before (ads,
--    products' listing fee, listing_packages, salon_subscription_payments)
--    and now go through Ozow exclusively — they never had a
--    gateway_order_id/gateway_webhook_secret column because they never
--    needed the URL-secret verification pattern PayFast's MD5 ITN signature
--    didn't need. Mirrors what orders/bookings/booking_intents already have.
ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS gateway_order_id text,
  ADD COLUMN IF NOT EXISTS gateway_webhook_secret text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gateway_order_id text,
  ADD COLUMN IF NOT EXISTS gateway_webhook_secret text;

ALTER TABLE public.listing_packages
  ADD COLUMN IF NOT EXISTS gateway_order_id text;

ALTER TABLE public.salon_subscription_payments
  ADD COLUMN IF NOT EXISTS gateway_order_id text,
  ADD COLUMN IF NOT EXISTS gateway_webhook_secret text;

ALTER TABLE public.store_bookings
  ADD COLUMN IF NOT EXISTS gateway_webhook_secret text;

-- 3. payment_method CHECK constraints: add 'tradesafe'. Historical values
--    stay in the allowed list too (CHECK only applies to future writes —
--    existing rows are never re-validated — this just avoids hard-failing
--    any forgotten code path that might still reference an old value).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method = ANY (ARRAY['tradesafe'::text, 'ozow'::text, 'payfast'::text, 'happypay'::text, 'google_pay'::text]));
ALTER TABLE public.orders ALTER COLUMN payment_method SET DEFAULT 'tradesafe';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method = ANY (ARRAY['tradesafe'::text, 'ozow'::text, 'payfast'::text, 'happypay'::text]));

ALTER TABLE public.booking_intents DROP CONSTRAINT IF EXISTS booking_intents_payment_method_check;
ALTER TABLE public.booking_intents ADD CONSTRAINT booking_intents_payment_method_check
  CHECK (payment_method = ANY (ARRAY['tradesafe'::text, 'ozow'::text, 'payfast'::text, 'happypay'::text]));
ALTER TABLE public.booking_intents ALTER COLUMN payment_method SET DEFAULT 'tradesafe';
