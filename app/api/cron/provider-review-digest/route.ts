// app/api/cron/provider-review-digest/route.ts
//
// Weekly. The paid half of the loyalty feature — "here's room for
// improvement: so-and-so mentioned X" for critical feedback, a simple
// count-up for positive feedback. Runs the trial/subscription lapse check
// first (no separate cron needed for something this small), then only
// digests reviews for whoever's still trialing or active afterward.
//
// A single profile_id-keyed query covers both artist and salon owners —
// reviews.reviewed_id is the receiving provider's profile id either way
// (client_to_artist and client_to_salon both work this way), even though
// the satisfaction-survey fields (would_rebook etc.) only ever populate
// for client_to_artist — see 20260827_satisfaction_survey.sql.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendProviderReviewDigestEmail } from "@/lib/email";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  // ── Lapse check ──
  await supabase.from("feature_subscriptions")
    .update({ status: "expired" })
    .eq("feature", "review_insights")
    .eq("status", "trialing")
    .lt("trial_ends_at", nowIso);
  await supabase.from("feature_subscriptions")
    .update({ status: "expired" })
    .eq("feature", "review_insights")
    .eq("status", "active")
    .lt("valid_until", today);

  const { data: subscribers, error } = await supabase
    .from("feature_subscriptions")
    .select("profile_id, profile:profiles!feature_subscriptions_profile_id_fkey(full_name, email)")
    .eq("feature", "review_insights")
    .in("status", ["trialing", "active"]);

  if (error) console.error("[provider-review-digest] subscriber fetch error:", error);

  let sent = 0;

  for (const sub of subscribers ?? []) {
    const profile = Array.isArray(sub.profile) ? sub.profile[0] : sub.profile;
    if (!profile?.email) continue;

    const { data: reviews, error: reviewError } = await supabase
      .from("reviews")
      .select("id, rating, comment, would_rebook, not_rebook_reason")
      .eq("reviewed_id", sub.profile_id)
      .in("review_type", ["client_to_artist", "client_to_salon"])
      .is("provider_digest_sent_at", null);

    if (reviewError) { console.error("[provider-review-digest] review fetch error:", reviewError); continue; }
    if (!reviews || reviews.length === 0) continue;

    const needsWork = reviews.filter(r => r.rating <= 3 || r.would_rebook === false)
      .map(r => ({ rating: r.rating, comment: r.comment, notRebookReason: r.not_rebook_reason }));
    const positive = reviews.filter(r => !(r.rating <= 3 || r.would_rebook === false))
      .map(r => ({ rating: r.rating, comment: r.comment }));

    try {
      await sendProviderReviewDigestEmail({
        toEmail: profile.email,
        toName: profile.full_name || "there",
        positive,
        needsWork,
        referenceId: sub.profile_id,
      });
      await supabase.from("reviews")
        .update({ provider_digest_sent_at: nowIso })
        .in("id", reviews.map(r => r.id));
      sent++;
    } catch (e) {
      console.error("[provider-review-digest] send error:", e);
    }
  }

  return NextResponse.json({ subscribers: subscribers?.length ?? 0, sent });
}
