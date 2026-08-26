// app/api/legal/accept/route.ts
//
// Called from the re-acceptance modal (app/dashboard/page.tsx) when a
// signed-in user's stored terms_version/privacy_version has fallen behind
// lib/legal.ts's current versions. Always accepts the *current* versions —
// there's no partial acceptance of an older version once a newer one is
// live. Updates the fast-check snapshot on profiles and appends to
// terms_acceptance_log for the audit trail.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from "@/lib/legal";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      terms_accepted: true,
      terms_accepted_at: now,
      terms_version: CURRENT_TERMS_VERSION,
      privacy_version: CURRENT_PRIVACY_VERSION,
    })
    .eq("id", user.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { error: logError } = await supabase.from("terms_acceptance_log").insert({
    user_id: user.id,
    terms_version: CURRENT_TERMS_VERSION,
    privacy_version: CURRENT_PRIVACY_VERSION,
    user_agent: req.headers.get("user-agent") || null,
  });
  // Non-fatal — the profiles row above is the one thing that actually
  // unblocks the user, and log inserts are covered by their own RLS
  // policy so a failure here would be unusual (not a reason to re-block).
  if (logError) console.error("terms_acceptance_log insert failed:", logError.message);

  return NextResponse.json({
    terms_version: CURRENT_TERMS_VERSION,
    privacy_version: CURRENT_PRIVACY_VERSION,
    terms_accepted_at: now,
  });
}
