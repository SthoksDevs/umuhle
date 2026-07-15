// app/api/cron/resend-emails/route.ts
//
// Daily cron: retries emails that failed to send (e.g. the SMTP timeouts
// seen on a slow connection — "SMTP verify failed: connect ETIMEDOUT…" in
// the Emails tab). See lib/email.ts's resendFailedEmail() for the actual
// retry mechanism; this route is just the schedule + the query deciding
// which rows are eligible.
//
// Registered in vercel.json. Vercel Cron only ever sends a GET request and
// automatically attaches `Authorization: Bearer $CRON_SECRET` when that env
// var is set — see https://vercel.com/docs/cron-jobs.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resendFailedEmail, type FailedEmailRow } from "@/lib/email";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Policy lives here, not in lib/email.ts — that module only knows how to
// safely replay one row.
const MAX_RETRIES = 5;      // give up on a permanently-bad address after this many failed resends
const MAX_AGE_DAYS = 14;    // don't keep retrying a failure this stale — the underlying order/booking has long since been dealt with by other means
const BATCH_LIMIT = 50;     // rows per run, to keep this comfortably inside a serverless function's duration limit

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = serviceClient();
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await supabase
    .from("email_log")
    .select("id, to_address, subject, template, reference_id, html_body, text_body, retry_count")
    .eq("status", "failed")
    .is("resent_at", null)
    .lt("retry_count", MAX_RETRIES)
    .gte("sent_at", cutoff)
    // Rows logged before this feature shipped have no stored body to
    // replay — html_body not null is a reliable proxy for "eligible".
    .not("html_body", "is", null)
    .order("sent_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[cron/resend-emails] query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let resent = 0;
  let stillFailing = 0;
  const failures: Array<{ id: string; reason?: string }> = [];

  // Sequential, not parallel — this is a low-volume marketplace, and
  // hammering the SMTP server with dozens of simultaneous connections is
  // exactly the kind of thing that causes the timeouts this job exists to
  // clean up after.
  for (const row of (candidates ?? []) as FailedEmailRow[]) {
    const outcome = await resendFailedEmail(row);
    if (outcome.ok) {
      resent++;
    } else {
      stillFailing++;
      failures.push({ id: outcome.id, reason: outcome.reason });
    }
  }

  return NextResponse.json({
    attempted: (candidates ?? []).length,
    resent,
    stillFailing,
    failures,
  });
}
