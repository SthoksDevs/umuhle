// lib/store-analytics.ts
// Data behind the weekly/monthly store-owner analytics email
// (app/api/cron/store-analytics/route.ts).
//
// Two independent sources, kept separate on purpose:
//
// 1. Booking stats — pulled straight from `store_bookings`. Always
//    available, no external setup needed.
//
// 2. GA4 metrics — page views, link clicks, form submissions, and a
//    simple view→click→submit funnel, pulled from the Google Analytics
//    Data API. Requires GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_KEY_JSON
//    to be set in Vercel; getStoreGA4Metrics() returns
//    { configured: false } and every caller degrades gracefully when
//    they're missing, rather than failing the whole report.
//
// GA4 setup (one-time, in Google Cloud + GA4, not in this repo):
//   1. Enable "Google Analytics Data API" on a Google Cloud project.
//   2. Create a service account, generate a JSON key.
//   3. In GA4 Admin → Property Access Management (property behind
//      G-95TVSZRYMT, see app/layout.tsx) → add the service account's
//      email as a Viewer.
//   4. In GA4 Admin → Custom definitions → Custom dimensions, create
//      event-scoped custom dimensions for the "store_id" and "link_type"
//      event parameters (gTag calls already send these — see
//      app/stores/[id]/page.tsx — but GA4 won't let you query an event
//      parameter via the Data API until it's registered as a custom
//      dimension here). Without this step, page views still work but
//      click/form-submit breakdowns will come back empty.
//   5. Set GA4_PROPERTY_ID (the numeric Property ID, Admin → Property
//      details — NOT the G-XXXX measurement ID) and
//      GA4_SERVICE_ACCOUNT_KEY_JSON (paste the whole downloaded JSON key
//      file as-is) as Vercel env vars.

import { GoogleAuth } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ReportPeriod = "weekly" | "monthly";

export function periodRange(period: ReportPeriod, now = new Date()) {
  const until = new Date(now);
  const since = new Date(now);
  if (period === "weekly") since.setDate(since.getDate() - 7);
  else since.setMonth(since.getMonth() - 1);
  // Full timestamps for query boundaries (so "until" includes everything up
  // to right now, not just up to midnight) — callers wanting a short display
  // label should format `since`/`until` themselves, e.g. toLocaleDateString.
  return { since, until, sinceIso: since.toISOString(), untilIso: until.toISOString() };
}

// ── Booking stats (always available) ───────────────────────────────────────

export interface StoreBookingStats {
  totalBookings: number;
  byStatus: Record<"pending" | "confirmed" | "completed" | "cancelled", number>;
  topServices: { service: string; count: number }[];
  topStaff: { name: string; count: number }[];
}

export async function getStoreBookingStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  salonId: string,
  sinceIso: string,
  untilIso: string
): Promise<StoreBookingStats> {
  const { data, error } = await supabase
    .from("store_bookings")
    .select("service, status, employee:branch_employees(name)")
    .eq("salon_id", salonId)
    .gte("created_at", sinceIso)
    .lte("created_at", untilIso);

  if (error) throw error;

  const rows = data ?? [];
  const byStatus: StoreBookingStats["byStatus"] = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  const serviceCounts = new Map<string, number>();
  const staffCounts = new Map<string, number>();

  for (const row of rows as unknown as { service: string; status: string; employee: { name: string } | null }[]) {
    if (row.status in byStatus) byStatus[row.status as keyof typeof byStatus]++;
    serviceCounts.set(row.service, (serviceCounts.get(row.service) ?? 0) + 1);
    if (row.employee?.name) staffCounts.set(row.employee.name, (staffCounts.get(row.employee.name) ?? 0) + 1);
  }

  const topServices = [...serviceCounts.entries()]
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count);

  const topStaff = [...staffCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { totalBookings: rows.length, byStatus, topServices, topStaff };
}

// ── GA4 metrics (needs credentials) ─────────────────────────────────────────

export interface StoreGA4Metrics {
  configured: true;
  pageViews: number;
  clicksByType: { linkType: string; count: number }[];
  formSubmits: number;
  funnel: { step: string; count: number }[] | null; // null if funnel query failed/unavailable
}
export type StoreGA4Result = StoreGA4Metrics | { configured: false };

function ga4Configured() {
  return Boolean(process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_KEY_JSON);
}

async function ga4Auth() {
  const credentials = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_KEY_JSON!);
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/analytics.readonly"] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("GA4: failed to mint access token from service account");
  return token;
}

async function ga4Fetch(path: string, token: string, body: unknown) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const res = await fetch(`https://analyticsdata.googleapis.com/${path}/properties/${propertyId}:${path.startsWith("v1alpha") ? "runFunnelReport" : "runReport"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA4 API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getStoreGA4Metrics(
  storeId: string,
  sinceIso: string,
  untilIso: string
): Promise<StoreGA4Result> {
  if (!ga4Configured()) return { configured: false };

  const token = await ga4Auth();
  const dateRanges = [{ startDate: sinceIso.slice(0, 10), endDate: untilIso.slice(0, 10) }];
  const storePath = `/stores/${storeId}`;

  const [pageViewsRes, clicksRes, submitsRes] = await Promise.all([
    ga4Fetch("v1beta", token, {
      dateRanges,
      metrics: [{ name: "screenPageViews" }],
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "CONTAINS", value: storePath } } },
    }),
    ga4Fetch("v1beta", token, {
      dateRanges,
      dimensions: [{ name: "customEvent:link_type" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "click" } } },
            { filter: { fieldName: "customEvent:store_id", stringFilter: { matchType: "EXACT", value: storeId } } },
          ],
        },
      },
    }),
    ga4Fetch("v1beta", token, {
      dateRanges,
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "form_submit" } } },
            { filter: { fieldName: "customEvent:store_id", stringFilter: { matchType: "EXACT", value: storeId } } },
          ],
        },
      },
    }),
  ]);

  const pageViews = Number(pageViewsRes.rows?.[0]?.metricValues?.[0]?.value ?? 0);
  const clicksByType = (clicksRes.rows ?? []).map((r: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }) => ({
    linkType: r.dimensionValues[0].value,
    count: Number(r.metricValues[0].value),
  }));
  const formSubmits = Number(submitsRes.rows?.[0]?.metricValues?.[0]?.value ?? 0);

  // Best-effort funnel (view → click → submit). runFunnelReport is alpha —
  // wrapped separately so a schema/availability change there doesn't take
  // down the rest of the report.
  let funnel: StoreGA4Metrics["funnel"] = null;
  try {
    const funnelRes = await ga4Fetch("v1alpha", token, {
      dateRange: dateRanges[0],
      funnel: {
        steps: [
          { name: "Viewed store page", filterExpression: { funnelEventFilter: { eventName: "page_view" } } },
          { name: "Clicked contact/booking link", filterExpression: { funnelEventFilter: { eventName: "click", funnelParameterFilterExpression: { funnelParameterFilter: { fieldName: "store_id", stringFilter: { matchType: "EXACT", value: storeId } } } } } },
          { name: "Submitted booking form", filterExpression: { funnelEventFilter: { eventName: "form_submit", funnelParameterFilterExpression: { funnelParameterFilter: { fieldName: "store_id", stringFilter: { matchType: "EXACT", value: storeId } } } } } },
        ],
      },
    });
    const rows = funnelRes.funnelTable?.rows ?? [];
    funnel = rows.map((r: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }, i: number) => ({
      step: r.dimensionValues?.[0]?.value ?? `Step ${i + 1}`,
      count: Number(r.metricValues?.[0]?.value ?? 0),
    }));
  } catch (e) {
    console.error("[store-analytics] funnel query failed, omitting from report:", e);
  }

  return { configured: true, pageViews, clicksByType, formSubmits, funnel };
}
