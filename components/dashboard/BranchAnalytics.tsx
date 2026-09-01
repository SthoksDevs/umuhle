"use client";

// components/dashboard/BranchAnalytics.tsx
//
// Store analytics + revenue — previously only existed as a weekly/monthly
// email cron report (lib/store-analytics.ts, app/api/cron/store-analytics),
// with no dashboard UI anywhere. This is that UI, calling the new
// app/api/store-analytics/[salonId]/route.ts wrapper around the same
// tested metric functions.
//
// Used from two places:
// - components/dashboard/MySalonTab.tsx — the owner, always (the route
//   always grants an owner both analytics and revenue).
// - components/dashboard/EmployeeDashboard.tsx — an employee, only if
//   granted can_view_analytics/can_view_revenue (the route enforces this
//   server-side and simply omits whichever section isn't granted; this
//   component renders whatever it gets back, so a partially-permitted
//   employee just sees one section, not an error).

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmt } from "@/lib/dashboard/format";

type ReportPeriod = "weekly" | "monthly";

interface StoreBookingStats {
  totalBookings: number;
  byStatus: Record<"pending" | "confirmed" | "completed" | "cancelled", number>;
  topServices: { service: string; count: number }[];
  topStaff: { name: string; count: number }[];
}
type GA4Result =
  | { configured: false }
  | { configured: true; pageViews: number; clicksByType: { linkType: string; count: number }[]; formSubmits: number; funnel: { step: string; count: number }[] | null };

interface BranchRevenue {
  branchId: string;
  branchName: string;
  bookingCount: number;
  grossDepositCents: number;
  payoutCents: number;
  pendingPayoutCents: number;
}

interface AnalyticsResponse {
  period: ReportPeriod;
  analytics: { bookingStats: StoreBookingStats; ga4: GA4Result } | null;
  revenue: { branches: BranchRevenue[]; totalPayoutCents: number; totalPendingPayoutCents: number } | null;
}

export default function BranchAnalytics({ salonId }: { salonId: string }) {
  const supabase = createClient();
  const [period, setPeriod] = useState<ReportPeriod>("weekly");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setError("Not signed in."); setLoading(false); return; }
    const res = await fetch(`/api/store-analytics/${salonId}?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Couldn't load analytics.");
      setLoading(false);
      return;
    }
    setData(await res.json());
    setLoading(false);
  }, [salonId, period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {(["weekly", "monthly"] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            style={{ padding: "0.45rem 1rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", cursor: "pointer", fontSize: "0.82rem", fontWeight: period === p ? 600 : 400,
              background: period === p ? "var(--plum)" : "transparent", color: period === p ? "#fff" : "var(--onyx)" }}>
            {p === "weekly" ? "Last 7 days" : "Last 30 days"}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading…</p>}
      {error && <p style={{ color: "#A32D2D", fontSize: "0.9rem" }}>{error}</p>}

      {data?.revenue && <RevenueSection revenue={data.revenue} />}
      {data?.analytics && <BookingStatsSection stats={data.analytics.bookingStats} />}
      {data?.analytics && <GA4Section ga4={data.analytics.ga4} />}
      {data && !data.revenue && !data.analytics && (
        <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>You don&apos;t have access to any analytics for this store yet.</p>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.12)", padding: "1.25rem", marginBottom: "1rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.05rem", margin: "0 0 0.85rem" }}>{title}</h3>
      {children}
    </div>
  );
}

function RevenueSection({ revenue }: { revenue: NonNullable<AnalyticsResponse["revenue"]> }) {
  return (
    <Card title="Revenue">
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "var(--grey)", fontSize: "0.78rem", margin: 0 }}>Paid out</p>
          <strong style={{ fontSize: "1.4rem" }}>{fmt(revenue.totalPayoutCents)}</strong>
        </div>
        <div>
          <p style={{ color: "var(--grey)", fontSize: "0.78rem", margin: 0 }}>Pending (booked, not yet completed)</p>
          <strong style={{ fontSize: "1.4rem", color: "var(--grey)" }}>{fmt(revenue.totalPendingPayoutCents)}</strong>
        </div>
      </div>
      {revenue.branches.length === 0 ? (
        <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>No branches yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {revenue.branches.map(b => (
            <div key={b.branchId} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "0.5rem 0", borderBottom: "1px solid rgba(155,127,184,0.1)" }}>
              <span>{b.branchName} <span style={{ color: "var(--grey)" }}>· {b.bookingCount} booking{b.bookingCount === 1 ? "" : "s"}</span></span>
              <span style={{ fontWeight: 600 }}>{fmt(b.payoutCents)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BookingStatsSection({ stats }: { stats: StoreBookingStats }) {
  return (
    <Card title="Bookings">
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "var(--grey)", fontSize: "0.78rem", margin: 0 }}>Total</p>
          <strong style={{ fontSize: "1.4rem" }}>{stats.totalBookings}</strong>
        </div>
        {(Object.keys(stats.byStatus) as (keyof StoreBookingStats["byStatus"])[]).map(k => (
          <div key={k}>
            <p style={{ color: "var(--grey)", fontSize: "0.78rem", margin: 0, textTransform: "capitalize" }}>{k}</p>
            <strong style={{ fontSize: "1.4rem" }}>{stats.byStatus[k]}</strong>
          </div>
        ))}
      </div>
      {stats.topServices.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Top services</p>
          {stats.topServices.slice(0, 5).map(s => (
            <div key={s.service} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "0.25rem 0", textTransform: "capitalize" }}>
              <span>{s.service}</span><span style={{ color: "var(--grey)" }}>{s.count}</span>
            </div>
          ))}
        </div>
      )}
      {stats.topStaff.length > 0 && (
        <div>
          <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Top staff</p>
          {stats.topStaff.slice(0, 5).map(s => (
            <div key={s.name} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "0.25rem 0" }}>
              <span>{s.name}</span><span style={{ color: "var(--grey)" }}>{s.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function GA4Section({ ga4 }: { ga4: GA4Result }) {
  if (!ga4.configured) {
    return (
      <Card title="Website">
        <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>
          Website analytics aren&apos;t connected yet. See lib/store-analytics.ts for setup — it needs a Google Analytics 4 service account, a one-time step outside this app.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Website">
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div><p style={{ color: "var(--grey)", fontSize: "0.78rem", margin: 0 }}>Page views</p><strong style={{ fontSize: "1.4rem" }}>{ga4.pageViews}</strong></div>
        <div><p style={{ color: "var(--grey)", fontSize: "0.78rem", margin: 0 }}>Form submits</p><strong style={{ fontSize: "1.4rem" }}>{ga4.formSubmits}</strong></div>
      </div>
      {ga4.funnel && (
        <div>
          <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Funnel</p>
          {ga4.funnel.map(f => (
            <div key={f.step} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "0.25rem 0" }}>
              <span>{f.step}</span><span style={{ color: "var(--grey)" }}>{f.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
