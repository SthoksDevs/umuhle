-- branch_employees: staff a store owner lists against one of their branches,
-- so clients can pick a favourite artist when booking a store service.
--
-- artist_id is nullable on purpose: most rows here will be operational
-- staff records the owner typed in directly (no platform login needed).
-- It's there so the upcoming "artist affiliation" feature can link an
-- existing Umuhle artist profile to a branch by populating this column,
-- without a schema change later.

create table if not exists public.branch_employees (
  id uuid not null default gen_random_uuid(),
  branch_id uuid not null,
  artist_id uuid,
  name text not null,
  photo_url text,
  bio text,
  specialties text[] not null default '{}',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint branch_employees_pkey primary key (id),
  constraint branch_employees_branch_id_fkey foreign key (branch_id) references public.store_branches(id),
  constraint branch_employees_artist_id_fkey foreign key (artist_id) references public.artists(id)
);

create index if not exists branch_employees_branch_id_idx on public.branch_employees(branch_id);

-- A booking can now record which branch it was for and which staff member
-- (if any) the client asked for. Both nullable — "any available" bookings
-- and single-branch businesses (the common case today) still work exactly
-- as before with no client picking anything.
alter table public.store_bookings
  add column if not exists branch_id uuid references public.store_branches(id),
  add column if not exists branch_employee_id uuid references public.branch_employees(id);

create index if not exists store_bookings_branch_id_idx on public.store_bookings(branch_id);

-- Backfill: every existing store_booking gets its salon's primary branch,
-- so nothing existing is left with a null branch_id.
update public.store_bookings sb
set branch_id = pb.id
from public.store_branches pb
where pb.salon_id = sb.salon_id and pb.is_primary = true and sb.branch_id is null;
