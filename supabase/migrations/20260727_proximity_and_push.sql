-- 20260727_proximity_and_push.sql
--
-- Two independent features, bundled in one migration because they shipped
-- together:
--
-- 1. PROXIMITY SEARCH — artists.latitude/longitude already existed but
--    nothing read them (see app/page.tsx's fetchArtists, which just sorted
--    by rating). This adds:
--      - artists.location_updated_at: artists are mobile (a home-visit hair
--        stylist isn't tied to one address), so their lat/long is now
--        refreshed from the browser each time they open the dashboard
--        (see app/dashboard/page.tsx's useArtistLocationPing). This column
--        is what lets an artist "disappear" from nearby search once their
--        location goes stale, instead of permanently squatting on whatever
--        spot they first granted permission from.
--      - nearby_artists() / nearby_salons(): plain-SQL Haversine distance
--        functions (no PostGIS/earthdistance extension needed — one CTE,
--        one WHERE clause). Both are STABLE SQL functions with default
--        (invoker) security, so they run under the caller's existing RLS —
--        same as the direct `.from("artists")` reads the client already
--        does today, no new grants of visibility.
--      - Salons (partner_salons) don't get a location_updated_at column:
--        their address is fixed (a shop), unlike an artist who might be
--        anywhere.
--
-- 2. PUSH NOTIFICATIONS — push_subscriptions table storing each browser's
--    Web Push subscription (endpoint + keys). This is the backbone only:
--    nothing sends a push yet (see lib/push-server.ts's sendPushToProfile,
--    which is written but not called from any flow). Wiring it into
--    booking/order events is a separate follow-up.

-- ── 1. Proximity search ─────────────────────────────────────────────────────

alter table public.artists
  add column if not exists location_updated_at timestamp with time zone;

-- Distance in km between (user_lat,user_lng) and each artist's stored
-- position. radius_km defaults to 50 per the homepage's "within 50km" rule.
-- max_location_age_hours defaults to 72 (3 days) — long enough that an
-- artist doesn't vanish just because they didn't open the dashboard
-- yesterday, short enough that a stale/abandoned account doesn't linger
-- indefinitely. Tune this constant here if 72h turns out wrong in practice.
create or replace function public.nearby_artists(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision default 50,
  max_location_age_hours integer default 72
)
returns table (id uuid, distance_km double precision)
language sql
stable
as $$
  with candidates as (
    select
      a.id,
      6371 * acos(
        greatest(-1::double precision, least(1::double precision,
          cos(radians(user_lat)) * cos(radians(a.latitude)) *
          cos(radians(a.longitude) - radians(user_lng)) +
          sin(radians(user_lat)) * sin(radians(a.latitude))
        ))
      ) as distance_km
    from public.artists a
    where a.latitude is not null
      and a.longitude is not null
      and a.is_active = true
      and a.moderation_status = 'approved'
      and a.location_updated_at is not null
      and a.location_updated_at > now() - (max_location_age_hours || ' hours')::interval
  )
  select id, distance_km
  from candidates
  where distance_km <= radius_km
  order by distance_km asc;
$$;

grant execute on function public.nearby_artists(double precision, double precision, double precision, integer) to anon, authenticated;

-- Salons: same distance math, no freshness window (fixed address), filtered
-- to match the exact clauses app/stores/page.tsx already uses today
-- (.eq("status","approved") — note this table also has a separate
-- moderation_status column that the live query doesn't filter on, so this
-- mirrors that rather than introducing a stricter filter).
create or replace function public.nearby_salons(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision default 50
)
returns table (id uuid, distance_km double precision)
language sql
stable
as $$
  with candidates as (
    select
      s.id,
      6371 * acos(
        greatest(-1::double precision, least(1::double precision,
          cos(radians(user_lat)) * cos(radians(s.latitude)) *
          cos(radians(s.longitude) - radians(user_lng)) +
          sin(radians(user_lat)) * sin(radians(s.latitude))
        ))
      ) as distance_km
    from public.partner_salons s
    where s.latitude is not null
      and s.longitude is not null
      and s.status = 'approved'
  )
  select id, distance_km
  from candidates
  where distance_km <= radius_km
  order by distance_km asc;
$$;

grant execute on function public.nearby_salons(double precision, double precision, double precision) to anon, authenticated;

-- ── 2. Push notification subscriptions ──────────────────────────────────────

create table if not exists public.push_subscriptions (
  id uuid not null default uuid_generate_v4(),
  profile_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamp with time zone not null default now(),
  constraint push_subscriptions_pkey primary key (id),
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_profile_id_fkey foreign key (profile_id) references public.profiles(id) on delete cascade
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  using (auth.uid() = profile_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  with check (auth.uid() = profile_id);

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  using (auth.uid() = profile_id);

-- Server-side sends (lib/push-server.ts) use the service-role key, which
-- bypasses RLS entirely — these policies only govern client-side access
-- (a user viewing/removing their own subscription rows).
