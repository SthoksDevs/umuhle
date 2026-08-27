-- 20260827_no_show_nudge.sql
--
-- Adds the pieces needed for: a 15-minute WhatsApp nudge (with a
-- reschedule link) when a booking's scheduled start passes with no
-- check-in (artist never set in_progress), and a 60-minute automatic
-- no_show flip if still nothing's happened by then.
--
-- Reconciling with the reliability system already built (see the
-- 20260827_booking_reliability migration): that system's no_show_party
-- column normally records who a *human* explicitly reported as the
-- no-show. An automatic timeout can't know that — silence at the 60-
-- minute mark could mean the client never showed, the artist never
-- showed, or both sides just handled it outside the app and forgot to
-- update status. Defaulting to blaming a specific party from silence
-- alone isn't fair, but check-in (in_progress) is *set by the artist*
-- when they physically start the service — so its absence most directly
-- reflects "the artist couldn't start", which for a mobile-artist
-- booking (artist travels to the client) is the client not being
-- available far more often than the artist genuinely not showing up.
-- That also matches how this was originally described: "in the event
-- the customer did not check in on their booking, send a reminder".
--
-- So: the auto-flip attributes no_show_party = 'client' by default. If
-- it's actually the artist's fault, the client can still tap "Artist
-- didn't arrive" any time before the 60-minute mark — that explicit
-- report fires first and the auto-flip never runs for that booking. It's
-- only the truly-silent case (neither side reports anything at all) that
-- falls back to this default, and it's a reasonable one for this
-- business model, not an unappealable verdict — worth knowing about
-- rather than a hidden assumption.

ALTER TABLE bookings
  ADD COLUMN no_show_reminder_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN reschedule_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX bookings_reschedule_token_idx ON bookings (reschedule_token);
