-- 20260804_salon_services.sql
--
-- Real, priced, individually-bookable services per salon — replacing the
-- flat per-salon deposit from 20260803_store_booking_deposits.sql with a
-- proper per-service price + deposit (e.g. a R150 haircut needing a R75
-- deposit, while a R450 colour needs a different one).
--
-- partner_salons.services stays exactly as-is — it's the coarse
-- hair/nails/makeup/lashes category tags used for the stores-listing
-- filter and staff specialty matching, unrelated to this. This is a new,
-- separate table for what a salon actually sells and charges for.
--
-- Backward compatible: a salon with zero rows here is unaffected — its
-- public booking form falls back to the old plain category picker, no
-- price, no deposit — until its owner adds a real service via the new
-- "Manage services" dashboard screen.

create table if not exists public.salon_services (
  id uuid not null default gen_random_uuid(),
  salon_id uuid not null references public.partner_salons(id) on delete cascade,
  category text not null check (category = any (array['hair'::text, 'nails'::text, 'makeup'::text, 'lashes'::text])),
  name text not null,
  description text,
  price integer not null,           -- cents
  deposit_amount integer,           -- cents, null = no deposit required for this service
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint salon_services_pkey primary key (id)
);

create index if not exists salon_services_salon_id_idx on public.salon_services (salon_id);

alter table public.salon_services enable row level security;

-- Mirrors "partner_salons: public read" — anyone can see an active service
-- belonging to an approved, active salon (needed both for the public
-- booking form and for the PayFast initiate route, which reads this as
-- the logged-in customer, not the salon owner).
create policy "salon_services: public read" on public.salon_services
  for select
  using (
    is_active = true
    and exists (
      select 1 from public.partner_salons ps
      where ps.id = salon_services.salon_id
        and ps.status = 'approved'
        and ps.is_active = true
    )
  );

create policy "salon_services: owner manage" on public.salon_services
  for all
  using (
    exists (
      select 1 from public.partner_salons ps
      where ps.id = salon_services.salon_id
        and ps.partner_id = auth.uid()
    )
  );

create policy "salon_services: admin manage" on public.salon_services
  for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- store_bookings: link to the specific service booked, and snapshot its
-- price, so a later price edit doesn't rewrite what a past customer saw.
-- deposit_amount already exists (previous migration) and keeps doing the
-- same job — what THIS booking's deposit was — just sourced from
-- salon_services.deposit_amount now instead of partner_salons.deposit_amount.
alter table public.store_bookings
  add column if not exists service_id uuid references public.salon_services(id) on delete set null,
  add column if not exists service_price integer;

-- `service` used to be locked to the four coarse categories (hair/nails/
-- makeup/lashes) because that's all the old booking form could ever send.
-- Now it also needs to hold a real service name like "Ladies cut & blow
-- wave" for salons on the new structured-services flow, so the fixed-enum
-- check no longer fits — service_id (above) is the real reference now;
-- this column stays as a free-text snapshot label for display.
alter table public.store_bookings drop constraint if exists store_bookings_service_check;
