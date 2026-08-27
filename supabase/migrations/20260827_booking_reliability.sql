-- 20260827_booking_reliability.sql
--
-- Appointment-honouring / reliability tracking for the mobile-artist
-- booking flow (bookings table — client books an artist directly).
-- Scoped to this flow only for now; store_bookings (salon/branch
-- appointments) doesn't have a no_show status yet and has its own
-- deposit mechanics, so extending the same enforcement there is a
-- separate follow-up rather than being folded in here.
--
-- Design:
--   1. bookings gets who-cancelled / who-no-showed + a snapshotted
--      late_cancellation flag (< 24h notice), decided once at the time of
--      the event rather than recomputed later.
--   2. artists/profiles get running counters (completed / cancelled /
--      late-cancelled / no-show) — cheap to read for the reliability
--      dashboard and the score in lib/reliability.ts.
--   3. record_artist_booking_outcome / record_client_booking_outcome are
--      the only things allowed to touch those counters (SECURITY DEFINER,
--      same pattern as credit_wallet_earning) — they also recompute a
--      rolling 90-day incident count straight from bookings each time,
--      so visibility_reduced naturally clears once old incidents age out
--      rather than needing a manual reset.
--   4. Thresholds (see the doc TKZ shared): 3 incidents/90d -> reduced
--      search visibility, 5 -> flagged for admin review via the existing
--      profiles.account_status = 'pending_review' value.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancelled_by text CHECK (cancelled_by IN ('client', 'artist', 'admin')),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS late_cancellation boolean,
  ADD COLUMN IF NOT EXISTS no_show_party text CHECK (no_show_party IN ('client', 'artist')),
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz;

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS completed_bookings_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visibility_reduced boolean NOT NULL DEFAULT false;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS client_completed_bookings_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_late_cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_no_show_count integer NOT NULL DEFAULT 0;

-- ── record_artist_booking_outcome ──
-- p_outcome: 'completed' | 'cancelled' | 'late_cancelled' | 'no_show'
CREATE OR REPLACE FUNCTION public.record_artist_booking_outcome(p_artist_id uuid, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_incidents_90d integer;
  v_profile_id uuid;
begin
  if p_outcome = 'completed' then
    update artists set completed_bookings_count = completed_bookings_count + 1 where id = p_artist_id;
    return;
  elsif p_outcome = 'cancelled' then
    update artists set cancelled_count = cancelled_count + 1 where id = p_artist_id;
  elsif p_outcome = 'late_cancelled' then
    update artists set cancelled_count = cancelled_count + 1, late_cancelled_count = late_cancelled_count + 1 where id = p_artist_id;
  elsif p_outcome = 'no_show' then
    update artists set no_show_count = no_show_count + 1 where id = p_artist_id;
  else
    return;
  end if;

  select count(*) into v_incidents_90d
  from bookings b
  where b.artist_id = p_artist_id
    and (
      (b.cancelled_by = 'artist' and b.late_cancellation = true and b.cancelled_at > now() - interval '90 days')
      or (b.no_show_party = 'artist' and b.no_show_at > now() - interval '90 days')
    );

  update artists set visibility_reduced = (v_incidents_90d >= 3) where id = p_artist_id;

  if v_incidents_90d >= 5 then
    select profile_id into v_profile_id from artists where id = p_artist_id;
    update profiles set account_status = 'pending_review' where id = v_profile_id and account_status = 'active';
  end if;
end;
$function$;

-- ── record_client_booking_outcome ──
CREATE OR REPLACE FUNCTION public.record_client_booking_outcome(p_client_id uuid, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_incidents_90d integer;
begin
  if p_outcome = 'completed' then
    update profiles set client_completed_bookings_count = client_completed_bookings_count + 1 where id = p_client_id;
    return;
  elsif p_outcome = 'cancelled' then
    update profiles set client_cancelled_count = client_cancelled_count + 1 where id = p_client_id;
  elsif p_outcome = 'late_cancelled' then
    update profiles set client_cancelled_count = client_cancelled_count + 1, client_late_cancelled_count = client_late_cancelled_count + 1 where id = p_client_id;
  elsif p_outcome = 'no_show' then
    update profiles set client_no_show_count = client_no_show_count + 1 where id = p_client_id;
  else
    return;
  end if;

  select count(*) into v_incidents_90d
  from bookings b
  where b.client_id = p_client_id
    and (
      (b.cancelled_by = 'client' and b.late_cancellation = true and b.cancelled_at > now() - interval '90 days')
      or (b.no_show_party = 'client' and b.no_show_at > now() - interval '90 days')
    );

  -- No visibility concept for clients — just the same admin-review
  -- threshold as artists, for the fairness TKZ asked for.
  if v_incidents_90d >= 5 then
    update profiles set account_status = 'pending_review' where id = p_client_id and account_status = 'active';
  end if;
end;
$function$;

-- ── nearby_artists: deprioritise (not hide) flagged artists ──
-- Same radius/candidates as before; visibility_reduced artists still
-- appear, just sorted after everyone else within that radius.
CREATE OR REPLACE FUNCTION public.nearby_artists(user_lat double precision, user_lng double precision, radius_km double precision DEFAULT 50, max_location_age_hours integer DEFAULT 72)
RETURNS TABLE(id uuid, distance_km double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  with candidates as (
    select
      a.id,
      a.visibility_reduced,
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
  order by visibility_reduced asc, distance_km asc;
$function$;
