-- Bulk salon registration payments (cliff-tier pricing — lib/salon-pricing.ts).
-- salon_id on salon_subscription_payments becomes optional: going forward every
-- payment (single salon or a CSV batch of many) lists its salons in the new
-- junction table below instead, so fulfillment has one code path either way.
--
-- Applied directly against production via the Supabase MCP on 2026-08-24 —
-- matches the existing pattern for this repo (see
-- supabase/migrations/20260806_tradesafe_gateway.sql's header).

ALTER TABLE public.salon_subscription_payments
  ALTER COLUMN salon_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.salon_subscription_payment_salons (
  payment_id uuid NOT NULL REFERENCES public.salon_subscription_payments(id) ON DELETE CASCADE,
  salon_id   uuid NOT NULL REFERENCES public.partner_salons(id) ON DELETE CASCADE,
  PRIMARY KEY (payment_id, salon_id)
);

ALTER TABLE public.salon_subscription_payment_salons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salon_subs_salons: own read" ON public.salon_subscription_payment_salons
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.salon_subscription_payments p
    WHERE p.id = payment_id AND p.partner_id = auth.uid()
  ));

CREATE POLICY "salon_subs_salons: service role" ON public.salon_subscription_payment_salons
  FOR ALL
  USING (true);
