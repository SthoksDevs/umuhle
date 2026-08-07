-- Bookings have a real completion hook (app/api/bookings/[id]/status/route.ts,
-- status -> "completed" triggers creditBookingPayout) — the same shape as
-- orders' delivery-confirmation hook, so TradeSafe escrow release can wire
-- into it the same way. store_bookings gets the equivalent treatment in
-- 20260806_store_booking_deposit_payouts.sql, once deposits were confirmed
-- to belong to the salon (see lib/payments/eligibility.ts).
ALTER TABLE public.booking_intents ADD COLUMN IF NOT EXISTS tradesafe_allocation_id text;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tradesafe_allocation_id text,
  ADD COLUMN IF NOT EXISTS tradesafe_delivery_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS tradesafe_released_at timestamptz;
