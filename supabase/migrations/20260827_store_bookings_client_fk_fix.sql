-- 20260827_store_bookings_client_fk_fix.sql
--
-- app/api/notifications/route.ts's store-booking reminder query embeds
-- client:profiles!client_id(whatsapp_comms_enabled) — but store_bookings.
-- client_id's FK pointed at auth.users, not profiles, so PostgREST
-- couldn't resolve the relationship (PGRST200, "no matches found") and the
-- reminder cron has been silently failing for every store booking since
-- 2026-08-23. profiles.id is itself FK'd to auth.users.id 1:1 (verified
-- zero orphaned client_id values before running this), so retargeting is
-- safe and doesn't change which rows are valid.

ALTER TABLE store_bookings DROP CONSTRAINT store_bookings_client_id_fkey;
ALTER TABLE store_bookings
  ADD CONSTRAINT store_bookings_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE SET NULL;
