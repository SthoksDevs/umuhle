-- 20260827_booking_renewals.sql
--
-- One row per client who answered the "how soon should we remind you"
-- survey question with an actual interval (skipping it, or a "no" on
-- would_rebook with no interval given, means no row — don't nudge someone
-- who didn't ask for a nudge). Created by app/api/reviews/route.ts at
-- survey-submission time; consumed by app/api/cron/renewal-nudge/route.ts.
--
-- Artist-only for now (artist_id required, no salon_id column) — same
-- reasoning as 20260827_satisfaction_survey.sql: client_to_salon reviews
-- have no booking reference to compute due_at from or renew against.

CREATE TABLE booking_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES profiles(id),
  artist_id uuid NOT NULL REFERENCES artists(id),
  service_id uuid REFERENCES services(id),
  source_booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  review_id uuid REFERENCES reviews(id) ON DELETE CASCADE,
  interval_days integer NOT NULL,
  due_at date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'nudged', 'booked', 'declined', 'expired')),
  suggested_date date,
  suggested_time time,
  nudge_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One renewal reminder per completed booking, not per review — a
  -- client can't accidentally get double-nudged if something ever
  -- retries the review insert.
  UNIQUE (source_booking_id)
);

CREATE INDEX booking_renewals_due_idx ON booking_renewals (status, due_at);

ALTER TABLE booking_renewals ENABLE ROW LEVEL SECURITY;

-- All access is server-side (review submission, the renewal cron, the
-- rebook deep-link) via the service role — no direct client reads/writes,
-- same posture as reviews' own moderation fields.
