-- 20260803_store_booking_deposits.sql
--
-- Optional deposit support for salon/store bookings (app/stores/[id] booking
-- form). Fully backward compatible: every new column is nullable or
-- defaults to the "no deposit" state, so existing salons and existing
-- store_bookings rows are unaffected until deposit_amount is set on a salon.
--
-- partner_salons.deposit_amount: cents, same convention as every other
-- money column in this schema (ads.price, orders.total_amount, etc).
-- NULL/0 = this salon doesn't offer a deposit — the booking form falls
-- back to the original free "Request booking" flow untouched.
--
-- store_bookings gains the same shape of payment-tracking columns the
-- orders table already has, so lib/payments/fulfillment.ts can update a
-- booking the same way it already updates an order on PayFast's ITN.

alter table public.partner_salons
  add column if not exists deposit_amount integer;

alter table public.store_bookings
  add column if not exists deposit_amount integer,
  add column if not exists deposit_status text not null default 'none'
    check (deposit_status = any (array['none'::text, 'pending'::text, 'paid'::text, 'failed'::text])),
  add column if not exists payment_method text,
  add column if not exists gateway_order_id text,
  add column if not exists deposit_paid_at timestamp with time zone;

create index if not exists store_bookings_deposit_status_idx
  on public.store_bookings (deposit_status);
