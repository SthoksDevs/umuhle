// app/api/cron/store-analytics/route.ts
//
// Weekly/monthly cron: emails every live store owner a performance summary
// — bookings, most-booked services, and (once GA4 is connected) page
// views, contact clicks, form submissions and a simple view→click→submit
// funnel. See lib/store-analytics.ts for where the numbers come from and
// the GA4 setup steps, and lib/email.ts (sendStoreAnalyticsReportEmail)
// for the email itself.
//
// Registered twice in vercel.json — same route, ?period=weekly and
// ?period=monthly on separate schedules.
//
// "Approved" mirrors the exact filter app/stores/page.tsx uses to decide
// which salons are publicly visible — same population, same definition of
// "live", so nobody gets a report for a store nobody can actually book.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendStoreAnalyticsReportEmail } from "@/lib/email";
import { getStoreBookingStats, getStoreGA4Metrics, periodRange, type ReportPeriod } from "@/lib/store-analytics";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const period = request.nextUrl.searchParams.get("period") as ReportPeriod | null;
  if (period !== "weekly" && period !== "monthly") {
    return NextResponse.json({ error: "Missing or invalid ?period= (expected weekly|monthly)" }, { status: 400 });
  }

  const supabase = serviceClient();
  const { sinceIso, untilIso } = periodRange(period);

  const { data: salons, error } = await supabase
    .from("partner_salons")
    .select("id, name, partner_id, partner:profiles!partner_salons_partner_id_fkey(email)")
    .eq("status", "approved");

  if (error) {
    console.error("[cron/store-analytics] salon query error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const sinceLabel = new Date(sinceIso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  const untilLabel = new Date(untilIso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

  const results = await Promise.allSettled(
    (salons ?? []).map(async (salon) => {
      const ownerEmail = (salon.partner as unknown as { email: string | null } | null)?.email;
      if (!ownerEmail) return { salon: salon.name, sent: false, reason: "No owner email on file" };

      const [bookingStats, ga4] = await Promise.all([
        getStoreBookingStats(supabase, salon.id, sinceIso, untilIso),
        getStoreGA4Metrics(salon.id, sinceIso, untilIso).catch((e) => {
          console.error(`[cron/store-analytics] GA4 fetch failed for ${salon.name}:`, e);
          return { configured: false as const };
        }),
      ]);

      await sendStoreAnalyticsReportEmail({
        toEmail: ownerEmail,
        storeName: salon.name,
        period,
        sinceLabel,
        untilLabel,
        bookingStats,
        ga4,
      });

      return { salon: salon.name, sent: true };
    })
  );

  const summary = results.map((r) => (r.status === "fulfilled" ? r.value : { sent: false, reason: String(r.reason) }));
  return NextResponse.json({ period, storeCount: (salons ?? []).length, summary });
}
