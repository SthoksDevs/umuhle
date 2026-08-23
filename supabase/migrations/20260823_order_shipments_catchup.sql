-- 20260823_order_shipments_catchup.sql
--
-- CATCH-UP MIGRATION — not a new feature. order_shipments (and the
-- fulfillment columns on order_items it depends on: shipped_at,
-- delivered_at, confirm_token, shipment_id) already exist in the live
-- Supabase project, but no migration file for them was ever committed —
-- they're referenced throughout the app (lib/orders.ts, the vendor "ship"
-- route, app/dashboard/page.tsx's OrderFulfillmentManager/ShipmentsManager)
-- with comments pointing at a "local_delivery_and_provincial_sales"
-- migration and "20260717_order_item_fulfillment.sql" that don't actually
-- exist in this repo. This file reconstructs both from the live schema so
-- migration history matches reality again, using IF NOT EXISTS / DROP+
-- CREATE guards throughout so it's a safe no-op against the already-live
-- database and a correct from-scratch build on a fresh one.
--
-- Written while wiring up the actual Ship Logic (The Courier Guy) API
-- integration on top of this table — see 20260823_courier_guy_shipping.sql
-- for the genuinely new pieces (orders.shipping_fee_cents, tracking-sync
-- cron).

-- ── order_items: fulfillment columns ────────────────────────────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shipped_at    timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS delivered_at  timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS confirm_token text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shipment_id   uuid;

-- ── order_shipments ──────────────────────────────────────────────────────────
-- One row per partner per order — one parcel/waybill. A single cart can
-- span several partners (possibly in different cities); each gets its own
-- shipment row rather than the order carrying one flat shipping address,
-- which is what makes multi-partner carts workable for courier booking.
CREATE TABLE IF NOT EXISTS order_shipments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_id                  uuid NOT NULL REFERENCES profiles(id),
  fulfillment_method          text NOT NULL CHECK (fulfillment_method IN ('collection', 'courier')),
  status                      text NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'ready_for_collection', 'collected', 'booked', 'in_transit', 'delivered', 'cancelled')),
  -- Origin snapshot — partner's dispatch/pickup address at order time,
  -- frozen here so a partner moving premises later doesn't retroactively
  -- change an in-flight parcel's recorded origin.
  origin_address              text,
  origin_suburb               text,
  origin_city                 text,
  origin_province             text,
  origin_postal_code          text,
  origin_latitude             numeric,
  origin_longitude            numeric,
  -- Destination snapshot — null for collection.
  destination_address_line1   text,
  destination_address_line2   text,
  destination_suburb          text,
  destination_city            text,
  destination_province        text,
  destination_postal_code     text,
  destination_latitude        numeric,
  destination_longitude       numeric,
  -- Aggregate parcel, derived from the products riding in this shipment.
  parcel_weight_g             integer,
  parcel_length_cm            numeric,
  parcel_width_cm             numeric,
  parcel_height_cm            numeric,
  -- Courier booking — populated by lib/shiplogic.ts once a shipment is
  -- booked (app/api/vendor/shipments/[id]/book); hand-editable as a
  -- fallback via app/dashboard/page.tsx's ShipmentsManager.
  courier_provider            text,
  waybill_number              text,
  tracking_url                text,
  courier_reference           text,
  courier_booked_at           timestamptz,
  collected_at                timestamptz,
  delivered_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  -- Rate quote captured at checkout (lib/orders.ts) — the price the
  -- customer actually paid, and the service level a later booking should
  -- honour rather than re-shop at ship time.
  service_level_code          text,
  service_level_name          text,
  quoted_rate_cents           integer,
  rate_quoted_at              timestamptz,
  last_rate_quote             jsonb,
  -- Tracking sync — courier_status is the provider's own raw status
  -- string; `status` above is our normalised ShipmentStatus.
  courier_status              text,
  courier_synced_at           timestamptz,
  courier_error               text,
  UNIQUE (order_id, partner_id)
);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_shipment_id_fkey
  FOREIGN KEY (shipment_id) REFERENCES order_shipments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_shipments_order_id      ON order_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_shipments_partner_id    ON order_shipments(partner_id);
CREATE INDEX IF NOT EXISTS idx_order_shipments_waybill       ON order_shipments(waybill_number) WHERE waybill_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_shipments_partner_status_idx ON order_shipments(partner_id, status);

ALTER TABLE order_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_shipments: admin all" ON order_shipments;
CREATE POLICY "order_shipments: admin all" ON order_shipments FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

DROP POLICY IF EXISTS "order_shipments: client read" ON order_shipments;
CREATE POLICY "order_shipments: client read" ON order_shipments FOR SELECT
  USING (order_id IN (SELECT id FROM orders WHERE orders.client_id = auth.uid()));

DROP POLICY IF EXISTS "order_shipments: partner manage own" ON order_shipments;
CREATE POLICY "order_shipments: partner manage own" ON order_shipments FOR ALL
  USING (partner_id = auth.uid());

DROP POLICY IF EXISTS "order_shipments: service role" ON order_shipments;
CREATE POLICY "order_shipments: service role" ON order_shipments FOR ALL
  TO service_role USING (true) WITH CHECK (true);
