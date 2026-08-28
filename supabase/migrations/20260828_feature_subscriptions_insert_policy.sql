-- 20260828_feature_subscriptions_insert_policy.sql
--
-- Missed in the original 20260827_feature_subscriptions migration — that
-- one only added a SELECT policy, but app/api/feature-subscriptions/
-- review-insights/route.ts inserts using the caller's own session (not
-- the service role), which RLS would otherwise reject outright.
--
-- Restricted to status = 'trialing' so a signed-in user can only ever
-- self-insert a *trial* row, whether through the route above or by
-- calling the Supabase REST API directly with their own session token —
-- there's no way to self-grant 'active' status without going through an
-- actual payment flow later.

CREATE POLICY "Users can start own trial" ON feature_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = profile_id AND status = 'trialing');
