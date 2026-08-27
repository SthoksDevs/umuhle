-- 20260827_store_booking_reliability.sql
--
-- Reliability tracking for store_bookings (fixed-location salon
-- appointments), the asymmetric counterpart to the 20260827_booking_
-- reliability.sql migration for mobile artists. A salon doesn't travel to
-- the customer, so there's no "salon no-show" the way there's an "artist
-- no-show" — the customer either shows up at the salon or doesn't. What a
-- salon *can* still do is fail to honour a confirmed booking (closed,
-- short-staffed, double-booked) — modelled as a salon-initiated
-- cancellation, same fairness principle, different event shape.
--
-- Client-side counters are NOT duplicated here — profiles.client_*_count
-- (from 20260827_booking_reliability.sql) already track a client across
-- both booking types, since account standing should reflect a client's
-- overall behaviour, not a separate score per booking type. Guest store
-- bookings (client_id null — the store booking form doesn't require
-- login) simply aren't attributable to any profile, same as they aren't
-- for reviews.

ALTER TABLE store_bookings DROP CONSTRAINT store_bookings_status_check;
ALTER TABLE store_bookings
  ADD CONSTRAINT store_bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));

ALTER TABLE store_bookings
  ADD COLUMN IF NOT EXISTS cancelled_by text CHECK (cancelled_by IN ('client', 'salon', 'admin')),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS late_cancellation boolean,
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz;

ALTER TABLE partner_salons
  ADD COLUMN IF NOT EXISTS completed_bookings_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visibility_reduced boolean NOT NULL DEFAULT false;

-- ── record_salon_booking_outcome ──
-- Mirrors record_artist_booking_outcome (see the other migration) —
-- p_outcome: 'completed' | 'cancelled' | 'late_cancelled' | 'no_show'.
-- partner_salons.partner_id is the owning profile directly (no separate
-- profile_id indirection like artists has).
CREATE OR REPLACE FUNCTION public.record_salon_booking_outcome(p_salon_id uuid, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_incidents_90d integer;
  v_partner_id uuid;
begin
  if p_outcome = 'completed' then
    update partner_salons set completed_bookings_count = completed_bookings_count + 1 where id = p_salon_id;
    return;
  elsif p_outcome = 'cancelled' then
    update partner_salons set cancelled_count = cancelled_count + 1 where id = p_salon_id;
  elsif p_outcome = 'late_cancelled' then
    update partner_salons set cancelled_count = cancelled_count + 1, late_cancelled_count = late_cancelled_count + 1 where id = p_salon_id;
  elsif p_outcome = 'no_show' then
    update partner_salons set no_show_count = no_show_count + 1 where id = p_salon_id;
  else
    return;
  end if;

  select count(*) into v_incidents_90d
  from store_bookings b
  where b.salon_id = p_salon_id
    and (
      (b.cancelled_by = 'salon' and b.late_cancellation = true and b.cancelled_at > now() - interval '90 days')
      or (b.status = 'no_show' and b.no_show_at > now() - interval '90 days')
    );
  -- (no_show here is always the customer's — see the comment above — so
  -- it still counts toward *this salon's* incident total the same way a
  -- late cancellation does: both are reasons a customer might have had a
  -- bad experience showing up, not something to hide from the salon's own
  -- reliability picture, even though the fault sits with the customer.)

  update partner_salons set visibility_reduced = (v_incidents_90d >= 3) where id = p_salon_id;

  if v_incidents_90d >= 5 then
    select partner_id into v_partner_id from partner_salons where id = p_salon_id;
    update profiles set account_status = 'pending_review' where id = v_partner_id and account_status = 'active';
  end if;
end;
$function$;

-- ── nearby_salons: same visibility deprioritisation as nearby_artists ──
CREATE OR REPLACE FUNCTION public.nearby_salons(user_lat double precision, user_lng double precision, radius_km double precision DEFAULT 50)
RETURNS TABLE(id uuid, distance_km double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  with candidates as (
    select
      s.id,
      s.visibility_reduced,
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
  order by visibility_reduced asc, distance_km asc;
$function$;
