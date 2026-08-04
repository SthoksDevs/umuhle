-- 20260804_salon_postal_code.sql
--
-- Adds the postal code field the dashboard's "Add/edit store" form was
-- missing. It's used together with address/suburb/city as the query sent
-- to /api/geocode, which fills partner_salons.latitude/longitude (columns
-- that already existed but were never populated for salon listings) so
-- the public store page's "Find us here" map has something to render.

alter table public.partner_salons
  add column if not exists postal_code text;
