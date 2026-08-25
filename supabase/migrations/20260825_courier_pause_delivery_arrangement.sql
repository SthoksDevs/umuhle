-- 20260825_courier_pause_delivery_arrangement.sql
--
-- Ship Logic-quoted courier is being paused platform-wide for now (see
-- NEXT_PUBLIC_COURIER_CHECKOUT_ENABLED, lib/shiplogic.ts) while rates are
-- too high and The Courier Guy's direct application is pending. None of
-- the courier code/schema is being removed — this migration only adds
-- what's needed for a partner to tell customers how they'll handle
-- delivery in the meantime.
--
--   1. profiles.delivery_arrangement_method/_note — a partner's own
--      statement of how they'll get a courier-fulfilled order to the
--      customer while there's no live rate/booking (see
--      app/dashboard/page.tsx's PartnerFulfillmentSettings). Only
--      meaningful when allow_courier is true; unused for collection-only
--      partners.
--
--   2. order_shipments.delivery_arrangement_method/_note — the same,
--      snapshotted onto each courier shipment at order time (lib/orders.ts),
--      same reasoning as the existing origin_* snapshot: a partner
--      changing their arrangement later shouldn't retroactively change
--      what an already-placed order was told.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS delivery_arrangement_method text
    CHECK (delivery_arrangement_method IN ('personal_delivery', 'postnet_to_postnet', 'pudo_paxi', 'own_arrangement', 'custom')),
  ADD COLUMN IF NOT EXISTS delivery_arrangement_note text;

ALTER TABLE order_shipments
  ADD COLUMN IF NOT EXISTS delivery_arrangement_method text
    CHECK (delivery_arrangement_method IN ('personal_delivery', 'postnet_to_postnet', 'pudo_paxi', 'own_arrangement', 'custom')),
  ADD COLUMN IF NOT EXISTS delivery_arrangement_note text;
