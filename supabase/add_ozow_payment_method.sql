-- Run this in the Supabase SQL editor to allow "ozow" as an orders.payment_method.
-- (supabase/schema.sql is a read-only reference dump, not an applied migration —
-- this is the actual statement that needs to run against your database.)

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method = ANY (ARRAY['payfast'::text, 'happypay'::text, 'google_pay'::text, 'ozow'::text]));
