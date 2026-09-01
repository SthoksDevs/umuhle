// app/api/store-analytics/[salonId]/route.ts
//
// Dashboard-facing analytics + revenue for a store owner's salon — see
// docs/role-based-dashboards-status.md ("store analytics / branch
// revenue" was previously an email-cron-only report with no dashboard UI
// anywhere). Reuses lib/store-analytics.ts's getStoreBookingStats/
// getStoreGA4Metrics (already tested via the weekly/monthly cron email)
// rather than recomputing those metrics a second way — this route is a
// dashboard-shaped wrapper around the same functions, plus a new revenue
// aggregation that the cron report never needed.
//
// Callable by the salon's own owner (partner_salons.partner_id), via a
// Bearer token — same auth pattern as
// app/api/store-bookings/[id]/status/route.ts. Also callable by an active
// employee of one of this salon's branches, but only returns the sections
// they're actually granted: analytics needs can_view_analytics, revenue
// needs can_view_revenue. An employee with neither gets 403 — this route
// is the enforcement point for those two flags (see types/index.ts's
// BranchEmployee; nothing else in the codebase checks them yet).
//
// Revenue is the sum of store_bookings.payout_cents (the owner's actual
// take-home after Umuhle's commission, computed by
// creditStoreBookingDepositPayout in lib/payouts.ts) for bookings with a
// paid deposit in the requested period, grouped by branch.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStoreBookingStats, getStoreGA4Metrics, periodRange, type ReportPeriod } from "@/lib/store-analytics";
import { splitCommission } from "@/lib/payouts";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

interface BranchRevenue {
  branchId: string;
  branchName: string;
  bookingCount: number;
  grossDepositCents: number;
  payoutCents: number;
  pendingPayoutCents: number; // paid deposits not yet credited to the wallet
}

export async function GET(req: NextRequest, props: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await props.params;

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: salon, error: salonError } = await service
    .from("partner_salons")
    .select("id, name, partner_id")
    .eq("id", salonId)
    .single();
  if (salonError || !salon) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const isOwner = salon.partner_id === user.id;

  let canViewAnalytics = isOwner;
  let canViewRevenue = isOwner;
  if (!isOwner) {
    const { data: branchIdRows } = await service.from("store_branches").select("id").eq("salon_id", salonId);
    const branchIds = (branchIdRows ?? []).map(b => b.id as string);
    if (branchIds.length > 0) {
      const { data: employeeRow } = await service
        .from("branch_employees")
        .select("can_view_analytics, can_view_revenue")
        .eq("profile_id", user.id)
        .eq("invite_status", "active")
        .in("branch_id", branchIds)
        .maybeSingle();
      canViewAnalytics = !!employeeRow?.can_view_analytics;
      canViewRevenue = !!employeeRow?.can_view_revenue;
    }
  }
  if (!canViewAnalytics && !canViewRevenue) {
    return NextResponse.json({ error: "Not authorized to view this store's analytics" }, { status: 403 });
  }

  const period = (req.nextUrl.searchParams.get("period") as ReportPeriod | null) ?? "weekly";
  if (period !== "weekly" && period !== "monthly") {
    return NextResponse.json({ error: "Invalid ?period= (expected weekly|monthly)" }, { status: 400 });
  }
  const { sinceIso, untilIso } = periodRange(period);

  const [analytics, revenue] = await Promise.all([
    canViewAnalytics
      ? Promise.all([
          getStoreBookingStats(service, salonId, sinceIso, untilIso),
          getStoreGA4Metrics(salonId, sinceIso, untilIso).catch(e => {
            console.error(`[store-analytics] GA4 fetch failed for ${salon.name}:`, e);
            return { configured: false as const };
          }),
        ]).then(([bookingStats, ga4]) => ({ bookingStats, ga4 }))
      : Promise.resolve(null),
    canViewRevenue ? computeBranchRevenue(service, salonId, sinceIso, untilIso) : Promise.resolve(null),
  ]);

  return NextResponse.json({ period, sinceIso, untilIso, analytics, revenue });
}

async function computeBranchRevenue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createClient<any, any, any>>,
  salonId: string,
  sinceIso: string,
  untilIso: string
): Promise<{ branches: BranchRevenue[]; totalPayoutCents: number; totalPendingPayoutCents: number }> {
  const { data: branches } = await supabase.from("store_branches").select("id, name").eq("salon_id", salonId);

  const { data: bookings } = await supabase
    .from("store_bookings")
    .select("branch_id, deposit_amount, deposit_status, commission_cents, payout_cents, payout_credited_at")
    .eq("salon_id", salonId)
    .eq("deposit_status", "paid")
    .gte("created_at", sinceIso)
    .lte("created_at", untilIso);

  const byBranch = new Map<string, BranchRevenue>();
  for (const b of (branches ?? []) as { id: string; name: string }[]) {
    byBranch.set(b.id, { branchId: b.id, branchName: b.name, bookingCount: 0, grossDepositCents: 0, payoutCents: 0, pendingPayoutCents: 0 });
  }

  let totalPayoutCents = 0;
  let totalPendingPayoutCents = 0;
  for (const row of (bookings ?? []) as { branch_id: string | null; deposit_amount: number | null; commission_cents: number | null; payout_cents: number | null; payout_credited_at: string | null }[]) {
    if (!row.branch_id) continue;
    const entry = byBranch.get(row.branch_id);
    if (!entry) continue;
    entry.bookingCount += 1;
    entry.grossDepositCents += row.deposit_amount ?? 0;
    // Only bookings that actually completed and got credited (payout_cents
    // set by creditStoreBookingDepositPayout) count as real payout;
    // everything else with a paid deposit is still "pending" — the
    // customer paid, but the booking hasn't completed yet.
    if (row.payout_credited_at && row.payout_cents != null) {
      entry.payoutCents += row.payout_cents;
      totalPayoutCents += row.payout_cents;
    } else {
      const estimatedPayout = row.payout_cents ?? splitCommission(row.deposit_amount ?? 0).payoutCents; // matches lib/payouts.ts's actual flat-R5-or-10% split, for a display-only estimate until the booking completes and this gets finalized by creditStoreBookingDepositPayout
      entry.pendingPayoutCents += estimatedPayout;
      totalPendingPayoutCents += estimatedPayout;
    }
  }

  return { branches: [...byBranch.values()], totalPayoutCents, totalPendingPayoutCents };
}
