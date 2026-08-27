-- 20260827_feature_subscriptions.sql
--
-- Generalised paid-feature subscription, first (only, for now) feature:
-- the provider review-insights digest (Section 4 of the loyalty spec).
-- Keyed off profiles.id so one table covers both independent artists and
-- salon partners — a subscription is about who's paying, not which
-- provider-type shape a booking/review is (unlike reviews/booking_renewals,
-- which do need that split).
--
-- Reuses the same non-recurring "pay for a period, valid_until lapses,
-- renew again" pattern already established for salon_subscription_payments
-- rather than introducing PayFast recurring billing.

CREATE TABLE feature_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id),
  feature text NOT NULL DEFAULT 'review_insights'
    CHECK (feature = ANY (ARRAY['review_insights'])), -- extensible if more paid features get added later
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status = ANY (ARRAY['trialing', 'active', 'past_due', 'cancelled', 'expired'])),
  trial_ends_at timestamptz,
  valid_until date,
  price_cents integer NOT NULL,
  payfast_payment_id text,
  gateway_order_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, feature)
);

ALTER TABLE reviews
  ADD COLUMN provider_digest_sent_at timestamptz;

ALTER TABLE feature_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own feature subscriptions" ON feature_subscriptions;
CREATE POLICY "Users can view own feature subscriptions" ON feature_subscriptions
  FOR SELECT USING (auth.uid() = profile_id);
-- Inserts/updates (starting a trial, recording payment, cron lapses) are
-- all server-side via the service role — no client-side write policy.
