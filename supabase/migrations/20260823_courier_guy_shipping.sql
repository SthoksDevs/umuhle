-- 20260823_courier_guy_shipping.sql
--
-- The Courier Guy (Ship Logic) integration — the genuinely new schema
-- pieces. order_shipments already carried all the columns a courier API
-- needed (see 20260823_order_shipments_catchup.sql for the record of that
-- table); this migration only adds what was actually missing:
--
--   1. orders.shipping_fee_cents — the live courier quote gets added into
--      orders.total_amount at checkout (lib/orders.ts) so the customer is
--      actually charged for shipping, but total_amount alone doesn't say
--      how much of that was shipping vs. products. This column keeps that
--      split visible on receipts/admin views without re-deriving it.
--
--   2. courier-tracking-sync pg_cron job — periodically refreshes
--      order_shipments.status for anything booked-but-not-yet-delivered,
--      via app/api/cron/sync-courier-tracking. Same pattern as the
--      existing "booking-reminders" job: net.http_get with the shared
--      cron_secret pulled from Supabase Vault, so the secret never sits in
--      the job definition as plaintext.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee_cents integer NOT NULL DEFAULT 0;

SELECT cron.schedule(
  'courier-tracking-sync',
  '*/30 * * * *', -- every 30 min — booking reminders need 15-min precision, tracking status doesn't
  $$
  SELECT net.http_get(
    url := 'https://umuhle.co.za/api/cron/sync-courier-tracking',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    )
  );
  $$
);
