-- store_branches: physical branch locations under a partner_salons business.
-- Every existing salon is backfilled as its own primary branch so nothing
-- currently reading partner_salons breaks. Future work (banner/colours,
-- employees-per-branch, fallback booking, multi-branch pricing/CSV import)
-- builds on this table; the store detail page keeps reading partner_salons
-- directly until that phase migrates it over to branch-aware rendering.

create table if not exists public.store_branches (
  id uuid not null default gen_random_uuid(),
  salon_id uuid not null,
  name text not null,
  is_primary boolean not null default false,
  address text,
  suburb text,
  city text,
  latitude numeric,
  longitude numeric,
  phone text,
  email text,
  opening_hours jsonb default '{}'::jsonb,
  banner_url text,
  brand_color_primary text,
  brand_color_secondary text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  constraint store_branches_pkey primary key (id),
  constraint store_branches_salon_id_fkey foreign key (salon_id) references public.partner_salons(id)
);

create index if not exists store_branches_salon_id_idx on public.store_branches(salon_id);

-- Only one primary branch per salon
create unique index if not exists store_branches_one_primary_per_salon
  on public.store_branches(salon_id) where is_primary;

-- Backfill: give every existing salon a primary branch mirroring its
-- current location/contact/hours, skipped if it already has one.
insert into public.store_branches (salon_id, name, is_primary, address, suburb, city, latitude, longitude, phone, email, opening_hours, is_active)
select ps.id, ps.name, true, ps.address, ps.suburb, ps.city, ps.latitude, ps.longitude, ps.phone, ps.email, coalesce(ps.opening_hours, '{}'::jsonb), ps.is_active
from public.partner_salons ps
where not exists (
  select 1 from public.store_branches sb where sb.salon_id = ps.id and sb.is_primary
);
