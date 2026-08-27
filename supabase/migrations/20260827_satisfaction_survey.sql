-- 20260827_satisfaction_survey.sql
--
-- Extends the existing post-booking review (booking -> completed already
-- fires a client_to_artist review invite today) with four loyalty-facing
-- questions, per TKZ's brief: would they rebook, why not if not, how soon
-- to remind them, and an NPS-style recommend score.
--
-- Scoped to client_to_artist only for now, not client_to_salon too —
-- reviews_target_shape_check already requires client_to_salon reviews to
-- have booking_id NULL (they're a general "review this salon" action, not
-- tied to a specific store_bookings row the way client_to_artist reviews
-- are tied to a bookings row), so there's nothing for the renewal engine
-- (booking_renewals.source_booking_id, see the next migration) to hang
-- off for a salon review. Collecting rebook/NPS answers for salon reviews
-- too is a reasonable future addition, just without renewal-row creation
-- attached until store_bookings has an equivalent booking reference.

ALTER TABLE reviews
  ADD COLUMN would_rebook boolean,
  ADD COLUMN not_rebook_reason text,
  ADD COLUMN rebook_interval_days integer,
  ADD COLUMN nps_score smallint;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_not_rebook_reason_check
    CHECK (not_rebook_reason IS NULL OR not_rebook_reason = ANY (ARRAY[
      'price', 'quality', 'punctuality', 'communication', 'cleanliness', 'other'
    ]));

ALTER TABLE reviews
  ADD CONSTRAINT reviews_rebook_interval_check
    CHECK (rebook_interval_days IS NULL OR (rebook_interval_days > 0 AND rebook_interval_days <= 730));

ALTER TABLE reviews
  ADD CONSTRAINT reviews_nps_score_check
    CHECK (nps_score IS NULL OR nps_score BETWEEN 0 AND 10);

-- Mirrors the existing reviews_target_shape_check convention: these four
-- questions only make sense on a client_to_artist review (see comment
-- above re: client_to_salon).
ALTER TABLE reviews
  ADD CONSTRAINT reviews_survey_scope_check
    CHECK (
      review_type = 'client_to_artist'
      OR (would_rebook IS NULL AND not_rebook_reason IS NULL
          AND rebook_interval_days IS NULL AND nps_score IS NULL)
    );
