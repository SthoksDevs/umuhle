-- Umuhle's service fee replaces the old flat 5.5% commission: it's now a
-- flat R5, or 10% of the price — whichever is higher (confirmed
-- 2026-08-25; see lib/payouts.ts's splitCommission()). Below R50 the R5
-- floor wins (10% of R50 is exactly R5); at and above R50 the 10% cut
-- takes over.
--
-- Because that R5 floor is a bigger bite of a cheap item than of an
-- expensive one, nothing the fee is computed against can be listed below
-- R35 (3500 cents):
--   - products.price / product_variants.price — a product's own price
--   - services.price — an artist's bookable service price
--   - salon_services.deposit_amount — the only part of a salon booking
--     that ever passes through Umuhle (the balance of the service price
--     is settled directly between salon and client, so salon_services.price
--     itself is intentionally left unconstrained here — see lib/payouts.ts's
--     header comment on store booking deposits).
--
-- Checked against production data before adding these (2026-08-25): zero
-- existing rows violate any of these floors, so no NOT VALID / backfill
-- step is needed.

alter table public.products
  add constraint products_price_min check (price >= 3500);

alter table public.product_variants
  add constraint product_variants_price_min check (price >= 3500);

alter table public.services
  add constraint services_price_min check (price >= 3500);

alter table public.salon_services
  add constraint salon_services_deposit_min check (deposit_amount is null or deposit_amount >= 3500);
