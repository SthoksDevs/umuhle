-- Redesigns public.referrals for the real referral mechanic (confirmed
-- 2026-08-20). The table existed but was wired to nothing — reward_amount
-- defaulted to a flat 1000 (R10) and trigger_ad_id pointed at ads, neither
-- of which matches the actual rule:
--
--   A referred PARTNER's (artist or business_partner — never a customer)
--   first qualifying income event triggers a ONE-TIME reward to whoever
--   referred them: 50% of Umuhle's commission/profit on that one event,
--   capped at R200 (20000 cents). Qualifying events: first completed
--   artist booking, first delivered order (summed across all of that
--   partner's line items in the order), or the R35 store registration
--   fee. Store booking deposits are NOT a separate trigger — a salon must
--   pay the R35 fee before it can go live, so that event always fires
--   first for a referred salon owner. Fires at the same moment the
--   partner's own payout/fee lands — not at initial payment success.
--   Locked in once triggered — a later refund of the source transaction
--   does not claw it back. Forward-only: not backfilled for partners
--   whose first income predates this migration.
--
-- Confirmed empty (0 rows) in production before this ran — see chat —
-- so it's safe to drop the old ad-linked column outright.

ALTER TABLE public.referrals
  DROP CONSTRAINT IF EXISTS referrals_trigger_ad_id_fkey,
  DROP COLUMN IF EXISTS trigger_ad_id,
  ALTER COLUMN reward_amount DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS source_type text
    CHECK (source_type = ANY (ARRAY['booking'::text, 'order'::text, 'salon'::text])),
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS commission_base_cents integer;

-- One reward per referred partner, ever — enforced in the database, not
-- just app code, since two of a partner's completion events could race
-- each other (e.g. their first booking and their salon fee landing the
-- same day).
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_id_unique
  ON public.referrals (referred_id);

COMMENT ON COLUMN public.referrals.reward_amount IS
  'Cents credited to the referrer''s wallet — 50% of commission_base_cents, capped at 20000 (R200).';
COMMENT ON COLUMN public.referrals.commission_base_cents IS
  'Umuhle''s commission/profit on the triggering transaction that reward_amount was calculated from.';
