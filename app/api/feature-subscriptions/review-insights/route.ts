// app/api/feature-subscriptions/review-insights/route.ts
//
// Starts (or reports) a provider's review_insights trial. 30-day free
// trial, no payment collected here — the checkout/renewal flow for
// converting a lapsed trial into a paid subscription isn't built yet
// (needs a real price decision + a PayFast flow of its own); this route
// only covers the free-trial-signup half of the feature.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TRIAL_DAYS = 30;
// Placeholder — snapshotted onto the row for whenever a real checkout
// flow exists, not charged today. Needs an actual pricing decision.
const PLACEHOLDER_PRICE_CENTS = 4900;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data } = await supabase
    .from("feature_subscriptions")
    .select("status, trial_ends_at, valid_until")
    .eq("profile_id", user.id)
    .eq("feature", "review_insights")
    .maybeSingle();

  return NextResponse.json({ subscription: data ?? null });
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: existing } = await supabase
    .from("feature_subscriptions")
    .select("id")
    .eq("profile_id", user.id)
    .eq("feature", "review_insights")
    .maybeSingle();
  if (existing) return NextResponse.json({ error: "You've already used your review insights trial." }, { status: 409 });

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  const { data, error } = await supabase
    .from("feature_subscriptions")
    .insert({
      profile_id: user.id,
      feature: "review_insights",
      status: "trialing",
      trial_ends_at: trialEndsAt.toISOString(),
      price_cents: PLACEHOLDER_PRICE_CENTS,
    })
    .select("status, trial_ends_at, valid_until")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subscription: data });
}
