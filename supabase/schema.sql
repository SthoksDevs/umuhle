-- ═══════════════════════════════════════════════════
--  Umuhle Database Schema
--  Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- ── Enable UUID extension ────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Profiles ─────────────────────────────────────────
-- Extends Supabase auth.users
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  phone        text,
  avatar_url   text,
  role         text not null default 'client' check (role in ('client', 'partner', 'admin')),
  created_at   timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', null),
    coalesce(new.raw_user_meta_data->>'avatar_url', null)
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(excluded.full_name, profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Artists ──────────────────────────────────────────
create table if not exists public.artists (
  id             uuid primary key default uuid_generate_v4(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  display_name   text not null,
  bio            text,
  category       text not null check (category in ('hair','nails','makeup','skincare','lashes')),
  location       text,
  suburb         text,
  city           text,
  avatar_url     text,
  cover_url      text,
  rating         numeric(3,2) not null default 0,
  review_count   integer not null default 0,
  is_verified    boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ── Services ─────────────────────────────────────────
create table if not exists public.services (
  id                 uuid primary key default uuid_generate_v4(),
  artist_id          uuid not null references public.artists(id) on delete cascade,
  name               text not null,
  description        text,
  price              integer not null,  -- ZAR cents
  duration_minutes   integer not null default 60,
  category           text,
  is_active          boolean not null default true
);

-- ── Availability ─────────────────────────────────────
create table if not exists public.availability (
  id            uuid primary key default uuid_generate_v4(),
  artist_id     uuid not null references public.artists(id) on delete cascade,
  day_of_week   integer not null check (day_of_week between 0 and 6), -- 0=Sun
  start_time    time not null,
  end_time      time not null
);

-- ── Portfolio ─────────────────────────────────────────
create table if not exists public.portfolio_images (
  id           uuid primary key default uuid_generate_v4(),
  artist_id    uuid not null references public.artists(id) on delete cascade,
  image_url    text not null,
  caption      text,
  created_at   timestamptz not null default now()
);

-- ── Bookings ─────────────────────────────────────────
create table if not exists public.bookings (
  id                    uuid primary key default uuid_generate_v4(),
  client_id             uuid not null references public.profiles(id),
  artist_id             uuid not null references public.artists(id),
  service_id            uuid not null references public.services(id),
  booking_date          date not null,
  booking_time          time not null,
  status                text not null default 'pending_payment'
                          check (status in ('pending_payment','confirmed','completed','cancelled','no_show')),
  total_amount          integer not null,  -- ZAR cents
  payfast_payment_id    text,
  notes                 text,
  created_at            timestamptz not null default now()
);

-- ── Reviews ──────────────────────────────────────────
create table if not exists public.reviews (
  id           uuid primary key default uuid_generate_v4(),
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  client_id    uuid not null references public.profiles(id),
  artist_id    uuid not null references public.artists(id),
  rating       integer not null check (rating between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now(),
  unique (booking_id) -- one review per booking
);

-- Auto-update artist rating after review
create or replace function public.update_artist_rating()
returns trigger language plpgsql as $$
begin
  update public.artists
  set
    rating       = (select avg(rating)::numeric(3,2) from public.reviews where artist_id = new.artist_id),
    review_count = (select count(*)                  from public.reviews where artist_id = new.artist_id)
  where id = new.artist_id;
  return new;
end;
$$;

drop trigger if exists on_review_created on public.reviews;
create trigger on_review_created
  after insert or update on public.reviews
  for each row execute function public.update_artist_rating();

-- ── Products ─────────────────────────────────────────
create table if not exists public.products (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  description  text,
  price        integer not null,  -- ZAR cents
  image_url    text,
  category     text,
  stock_count  integer not null default 0,
  is_active    boolean not null default true
);

-- ── Orders ───────────────────────────────────────────
create table if not exists public.orders (
  id                   uuid primary key default uuid_generate_v4(),
  client_id            uuid not null references public.profiles(id),
  items                jsonb not null default '[]',
  total_amount         integer not null,
  status               text not null default 'pending_payment'
                         check (status in ('pending_payment','paid','shipped','delivered','cancelled')),
  shipping_address     text,
  payfast_payment_id   text,
  created_at           timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════
--  Row Level Security (RLS)
-- ═══════════════════════════════════════════════════

-- Profiles: users see/edit only their own
alter table public.profiles enable row level security;
create policy "profiles: self read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: self update" on public.profiles for update using (auth.uid() = id);
-- Allow service role full access (for ITN webhook)
create policy "profiles: service role" on public.profiles for all using (true) with check (true);

-- Artists: public read, partners manage their own
alter table public.artists enable row level security;
create policy "artists: public read"    on public.artists for select using (is_active = true);
create policy "artists: partner manage" on public.artists for all using (profile_id = auth.uid());
create policy "artists: service role"   on public.artists for all using (true);

-- Services: public read, artist owner manages
alter table public.services enable row level security;
create policy "services: public read" on public.services for select using (is_active = true);
create policy "services: owner manage" on public.services for all
  using (artist_id in (select id from public.artists where profile_id = auth.uid()));

-- Bookings: clients see their own, artists see bookings for them
alter table public.bookings enable row level security;
create policy "bookings: client read" on public.bookings for select using (client_id = auth.uid());
create policy "bookings: client insert" on public.bookings for insert with check (client_id = auth.uid());
create policy "bookings: artist read" on public.bookings for select
  using (artist_id in (select id from public.artists where profile_id = auth.uid()));
create policy "bookings: service role" on public.bookings for all using (true);

-- Reviews: public read, client inserts their own
alter table public.reviews enable row level security;
create policy "reviews: public read" on public.reviews for select using (true);
create policy "reviews: client insert" on public.reviews for insert with check (client_id = auth.uid());

-- Portfolio: public read
alter table public.portfolio_images enable row level security;
create policy "portfolio: public read" on public.portfolio_images for select using (true);
create policy "portfolio: artist manage" on public.portfolio_images for all
  using (artist_id in (select id from public.artists where profile_id = auth.uid()));

-- Products: public read
alter table public.products enable row level security;
create policy "products: public read" on public.products for select using (is_active = true);

-- ═══════════════════════════════════════════════════
--  Storage buckets
-- ═══════════════════════════════════════════════════
-- Run in Supabase Storage section or via dashboard:
-- Bucket: "avatars"   — public read, authenticated write
-- Bucket: "portfolio" — public read, authenticated write
-- Bucket: "products"  — public read, service-role write

-- ═══════════════════════════════════════════════════
--  Sample data (optional — delete for production)
-- ═══════════════════════════════════════════════════
-- Uncomment to seed a test artist:
-- insert into public.artists (profile_id, display_name, bio, category, suburb, city, is_verified)
-- values ('YOUR_USER_UUID', 'Test Artist', 'Test bio', 'hair', 'Sandton', 'Johannesburg', true);
