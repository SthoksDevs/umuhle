-- 20260828_branch_specific_salon_reviews.sql
--
-- TKZ's call: a salon review should be specific to the branch a customer
-- actually visited, not blended across every branch a business runs — the
-- same way an artist review is specific to one booking, not a single
-- lifetime rating of the artist. store_bookings already captures exactly
-- which branch (and which staff member, via branch_employee_id) a
-- customer visited, so this was just never wired up to reviews.
--
-- One existing row (72c6c1c0-...) predates this and is TKZ's own test
-- data (reviewer_id = reviewed_id — a self-review) — backfilled from the
-- one completed store_booking that matches the same client/salon before
-- the review's created_at, rather than left as an unexplained exception
-- to the new constraint.
--
-- This also DROPS reviews_salon_reviewer_unique (one review per client
-- PER SALON, ever) in favour of one per client PER VISIT — that's the
-- actual behaviour change here: a returning customer can now leave a new
-- review each time they visit a branch, same as they already could for a
-- returning artist booking.
--
-- Deliberately NOT extending the satisfaction-survey columns (would_
-- rebook etc., see 20260827_satisfaction_survey.sql) or the renewal
-- engine to client_to_salon here — that's a real next step this now
-- makes possible (there's finally a booking reference to hang a renewal
-- off), but TKZ asked to hold off on that for now.

ALTER TABLE reviews
  ADD COLUMN store_booking_id uuid REFERENCES store_bookings(id),
  ADD COLUMN branch_id uuid REFERENCES store_branches(id);

UPDATE reviews
SET store_booking_id = 'c348f692-ab04-4056-8f10-07ff9c2f28c8',
    branch_id = '0f52dedf-8094-4adf-afb6-8e87fbacf7d2'
WHERE id = '72c6c1c0-5e22-4145-b3f4-96b145e07c97';

ALTER TABLE reviews DROP CONSTRAINT reviews_target_shape_check;
ALTER TABLE reviews ADD CONSTRAINT reviews_target_shape_check CHECK (
  (review_type IN ('client_to_artist', 'artist_to_client')
    AND booking_id IS NOT NULL AND product_id IS NULL AND salon_id IS NULL
    AND order_item_id IS NULL AND store_booking_id IS NULL AND branch_id IS NULL)
  OR (review_type = 'client_to_product'
    AND product_id IS NOT NULL AND order_item_id IS NOT NULL AND booking_id IS NULL
    AND salon_id IS NULL AND store_booking_id IS NULL AND branch_id IS NULL)
  OR (review_type = 'client_to_salon'
    AND salon_id IS NOT NULL AND store_booking_id IS NOT NULL AND branch_id IS NOT NULL
    AND booking_id IS NULL AND product_id IS NULL AND order_item_id IS NULL)
);

ALTER TABLE reviews DROP CONSTRAINT reviews_salon_reviewer_unique;
ALTER TABLE reviews ADD CONSTRAINT reviews_store_booking_reviewer_unique UNIQUE (store_booking_id, reviewer_id);

-- review_invites mirrors reviews' shape (see lib/review-invites.ts) — same
-- extension needed there so a salon review invite can carry which visit
-- it's for through to the actual reviews row created on submission (see
-- app/api/reviews/invite/[token]/route.ts).
ALTER TABLE review_invites
  ADD COLUMN store_booking_id uuid REFERENCES store_bookings(id),
  ADD COLUMN branch_id uuid REFERENCES store_branches(id);

-- Same test-data situation as the reviews row above — two unused invite
-- tokens from the same test session, backfilled from the same matching
-- completed booking.
UPDATE review_invites
SET store_booking_id = 'c348f692-ab04-4056-8f10-07ff9c2f28c8',
    branch_id = '0f52dedf-8094-4adf-afb6-8e87fbacf7d2'
WHERE review_type = 'client_to_salon';

ALTER TABLE review_invites DROP CONSTRAINT review_invites_target_shape_check;
ALTER TABLE review_invites ADD CONSTRAINT review_invites_target_shape_check CHECK (
  (review_type IN ('client_to_artist', 'artist_to_client')
    AND booking_id IS NOT NULL AND order_item_id IS NULL AND salon_id IS NULL
    AND store_booking_id IS NULL AND branch_id IS NULL)
  OR (review_type = 'client_to_product'
    AND order_item_id IS NOT NULL AND booking_id IS NULL AND salon_id IS NULL
    AND store_booking_id IS NULL AND branch_id IS NULL)
  OR (review_type = 'client_to_salon'
    AND salon_id IS NOT NULL AND store_booking_id IS NOT NULL AND branch_id IS NOT NULL
    AND booking_id IS NULL AND order_item_id IS NULL)
);
