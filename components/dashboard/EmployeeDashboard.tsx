"use client";

// components/dashboard/EmployeeDashboard.tsx
//
// The Employee dashboard — deliberately not built on DashboardShell.tsx.
// Per the original brief, an employee's scope is: password + own
// availability + own assigned store bookings + reviews on those bookings
// — nothing store-wide, no personal-detail fields, no orders/wishlist/
// wallet. See "the core design decision" in
// docs/role-based-dashboards-status.md for why this is a separate
// component rather than another DashboardShell role.
//
// SCOPE NOTE: this covers the *default* employee scope only. The
// owner-grantable extras (can_manage_products/can_manage_calendar/
// can_view_analytics/can_view_revenue — see types/index.ts's
// BranchEmployee) are deliberately not wired to anything here yet; that's
// the deferred owner-side permissions UI tracked in the status doc, along
// with the invite flow that actually gets an employee into invite_status
// = 'active' in the first place.
//
// Password lives in Supabase Auth (auth.users), not a `profiles` column —
// see the design note in the migration write-up: an employee's profile row
// has nothing else worth locking down once address/personal-detail fields
// were deliberately kept off it, so there's no column-level security to
// build here, just an Auth password change.

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, BranchEmployee, BranchEmployeeAvailability } from "@/types";
import Image from "next/image";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { ICON } from "@/lib/dashboard/format";
import { STATUS_STYLES, type BookingWithRelations } from "@/lib/dashboard/types";
import BranchAnalytics from "@/components/dashboard/BranchAnalytics";

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type EmployeeTab = "bookings" | "availability" | "analytics" | "account";

// branch_employees joined with its parent branch's name + salon_id, for
// display, for the branch switcher when an employee works more than one
// branch, and for resolving which salon's analytics to show (see
// components/dashboard/BranchAnalytics.tsx, keyed by salonId not branchId
// — matches the existing GA4/store-analytics data model, which tracks per
// public store page, not per branch).
type MyAssignment = BranchEmployee & { branch: { id: string; name: string; salon_id: string } | null };

type MyBooking = BookingWithRelationsLite;
// store_bookings doesn't shape-match BookingWithRelations (that's the
// personal `bookings` table's artist/service joins) — a narrower local
// type for the store-booking fields this view actually reads.
type BookingWithRelationsLite = {
  id: string;
  client_name: string;
  client_phone: string;
  service: string;
  booking_date: string;
  booking_time: string;
  notes: string | null;
  status: string;
  branch_employee_id: string | null;
};

type ReviewRow = { id: string; store_booking_id: string; rating: number; comment: string | null; created_at: string };

export default function EmployeeDashboard() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [activeBranchEmployeeId, setActiveBranchEmployeeId] = useState<string | null>(null);
  const [tab, setTab] = useState<EmployeeTab>("bookings");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = "/?auth=login"; return; }
      setUser(user);
      const [{ data: profileRow }, { data: assignmentRows }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase
          .from("branch_employees")
          .select("*, branch:store_branches(id, name, salon_id)")
          .eq("profile_id", user.id)
          .eq("invite_status", "active")
          .order("display_order", { ascending: true }),
      ]);
      if (profileRow) setProfile(profileRow as Profile);
      const rows = (assignmentRows as MyAssignment[]) ?? [];
      setAssignments(rows);
      if (rows.length > 0) setActiveBranchEmployeeId(rows[0].id);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const activeAssignment = assignments.find(a => a.id === activeBranchEmployeeId) ?? null;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--white)" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    );
  }

  if (!user || !profile) return null;

  // No active branch_employees row (revoked, or the invite flow never
  // finished activating it — see status doc) — nothing to manage.
  if (assignments.length === 0) {
    return (
      <div className="dashboard-app">
        <SiteHeader initialUser={user} initialProfile={profile} />
        <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center", padding: "0 1.5rem" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem" }}>No active branch assignment</h1>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginTop: "0.5rem" }}>
            Your account isn&apos;t currently linked to a store branch. Ask the store owner to check your access.
          </p>
          <button onClick={handleSignOut} style={{ marginTop: "1.5rem", background: "none", border: "none", color: "var(--plum)", cursor: "pointer", fontSize: "0.85rem" }}>Sign out</button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="dashboard-app">
      <SiteHeader initialUser={user} initialProfile={profile} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem 4rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <p style={{ color: "var(--grey)", fontSize: "0.8rem", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>Welcome back</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.6rem", margin: "0.15rem 0 0" }}>{activeAssignment?.name ?? "Team member"}</h1>
            {activeAssignment && (
              <p style={{ color: "var(--grey)", fontSize: "0.85rem", margin: "0.2rem 0 0" }}>
                {activeAssignment.rank === "manager" ? "Manager" : "Staff"} at {activeAssignment.branch?.name ?? "your branch"}
              </p>
            )}
          </div>
          <button onClick={handleSignOut} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 100, padding: "0.5rem 1.1rem", color: "var(--onyx)", cursor: "pointer", fontSize: "0.82rem" }}>Sign out</button>
        </div>

        {assignments.length > 1 && (
          <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", marginBottom: "1.25rem" }}>
            {assignments.map(a => (
              <button key={a.id} onClick={() => setActiveBranchEmployeeId(a.id)}
                style={{ padding: "0.45rem 1rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", whiteSpace: "nowrap", cursor: "pointer", fontSize: "0.8rem",
                  background: activeBranchEmployeeId === a.id ? "var(--plum)" : "#fff", color: activeBranchEmployeeId === a.id ? "#fff" : "var(--onyx)" }}>
                {a.branch?.name ?? "Branch"}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {([
            { id: "bookings" as const, label: "My bookings" },
            { id: "availability" as const, label: "Availability" },
            ...(activeAssignment && (activeAssignment.can_view_analytics || activeAssignment.can_view_revenue)
              ? [{ id: "analytics" as const, label: "Analytics" }]
              : []),
            { id: "account" as const, label: "Account" },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: "0.55rem 1.1rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", cursor: "pointer", fontSize: "0.85rem", fontWeight: tab === t.id ? 600 : 400,
                background: tab === t.id ? "var(--plum)" : "transparent", color: tab === t.id ? "#fff" : "var(--onyx)" }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "bookings" && activeAssignment && <MyAssignedBookings branchEmployeeId={activeAssignment.id} />}
        {tab === "availability" && activeAssignment && <MyAvailability branchEmployeeId={activeAssignment.id} />}
        {tab === "analytics" && activeAssignment?.branch && <BranchAnalytics salonId={activeAssignment.branch.salon_id} />}
        {tab === "account" && <MyAccount user={user} />}
      </div>
      <Footer />
    </div>
  );
}

// ─── My bookings (store_bookings assigned to me) + reviews on them ────────────
// Distinct from MySalonTab.tsx's SalonBookingsInbox, which is the
// branch-wide inbox (all staff) gated behind can_manage_calendar — not
// wired up to any owner-side grant UI yet, so an employee only ever sees
// this scoped view regardless of rank.
function MyAssignedBookings({ branchEmployeeId }: { branchEmployeeId: string }) {
  const supabase = createClient();
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewRow>>({});
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: bookingRows } = await supabase
      .from("store_bookings")
      .select("id, client_name, client_phone, service, booking_date, booking_time, notes, status, branch_employee_id")
      .eq("branch_employee_id", branchEmployeeId)
      .order("booking_date", { ascending: false })
      .limit(100);
    const rows = (bookingRows as MyBooking[]) ?? [];
    setBookings(rows);

    if (rows.length > 0) {
      const { data: reviewRows } = await supabase
        .from("reviews")
        .select("id, store_booking_id, rating, comment, created_at")
        .in("store_booking_id", rows.map(r => r.id));
      const map: Record<string, ReviewRow> = {};
      for (const r of (reviewRows as ReviewRow[]) ?? []) if (r.store_booking_id) map[r.store_booking_id] = r;
      setReviews(map);
    } else {
      setReviews({});
    }
    setLoading(false);
  }, [branchEmployeeId]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: string) => {
    setActioningId(id);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token) {
      const res = await fetch(`/api/store-bookings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (res.ok) setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    }
    setActioningId(null);
  };

  if (loading) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading your bookings…</p>;
  if (bookings.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem", background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.12)" }}>
        <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>No bookings assigned to you yet.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {bookings.map(b => {
        const sc = STATUS_STYLES[b.status] ?? STATUS_STYLES.confirmed;
        const review = reviews[b.id];
        return (
          <div key={b.id} style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1rem 1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>{b.client_name}</p>
                <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: "2px 0 0" }}>
                  {b.booking_date} at {b.booking_time} · <span style={{ textTransform: "capitalize" }}>{b.service}</span>
                </p>
              </div>
              <span style={{ background: sc.bg, color: sc.color, borderRadius: 100, padding: "0.2rem 0.7rem", fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap" }}>{sc.label}</span>
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: "0 0 0.65rem" }}>
              📞 <a href={`tel:${b.client_phone}`} style={{ color: "var(--plum)" }}>{b.client_phone}</a>
              {" · "}
              <a href={`https://wa.me/${b.client_phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#25D366" }}>WhatsApp</a>
            </p>
            {b.notes && <p style={{ fontSize: "0.82rem", color: "#666", fontStyle: "italic", margin: "0 0 0.65rem" }}>&quot;{b.notes}&quot;</p>}
            {review && (
              <p style={{ fontSize: "0.82rem", color: "var(--onyx)", margin: "0 0 0.65rem", background: "var(--plum-t)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>
                {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}{review.comment && <> — &quot;{review.comment}&quot;</>}
              </p>
            )}
            {b.status === "pending" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={actioningId === b.id} onClick={() => updateStatus(b.id, "confirmed")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#E1F5EE", color: "#0F6E56", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", opacity: actioningId === b.id ? 0.6 : 1 }}>
                  Confirm
                </button>
                <button disabled={actioningId === b.id} onClick={() => updateStatus(b.id, "cancelled")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#FCEBEB", color: "#A32D2D", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", opacity: actioningId === b.id ? 0.6 : 1 }}>
                  Cancel
                </button>
              </div>
            )}
            {b.status === "confirmed" && (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button disabled={actioningId === b.id} onClick={() => updateStatus(b.id, "completed")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#E6F1FB", color: "#185FA5", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", opacity: actioningId === b.id ? 0.6 : 1 }}>
                  Mark completed
                </button>
                <button disabled={actioningId === b.id} onClick={() => updateStatus(b.id, "no_show")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#FCEBEB", color: "#A32D2D", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", opacity: actioningId === b.id ? 0.6 : 1 }}>
                  Customer no-show
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── My weekly availability ─────────────────────────────────────────────────
function MyAvailability({ branchEmployeeId }: { branchEmployeeId: string }) {
  const supabase = createClient();
  const [rows, setRows] = useState<BranchEmployeeAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newDay, setNewDay] = useState(1);
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("branch_employee_availability")
      .select("*")
      .eq("branch_employee_id", branchEmployeeId)
      .order("day_of_week", { ascending: true });
    setRows((data as BranchEmployeeAvailability[]) ?? []);
    setLoading(false);
  }, [branchEmployeeId]);

  useEffect(() => { load(); }, [load]);

  const addWindow = async () => {
    if (newStart >= newEnd) return;
    setSaving(true);
    await supabase.from("branch_employee_availability").insert({
      branch_employee_id: branchEmployeeId,
      day_of_week: newDay,
      start_time: newStart,
      end_time: newEnd,
    });
    await load();
    setSaving(false);
  };

  const removeWindow = async (id: string) => {
    setSaving(true);
    await supabase.from("branch_employee_availability").delete().eq("id", id);
    setRows(prev => prev.filter(r => r.id !== id));
    setSaving(false);
  };

  if (loading) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading availability…</p>;

  return (
    <div>
      <p style={{ color: "var(--grey)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Set the hours you&apos;re usually available. Add one window per working day.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {rows.length === 0 && <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>No availability set yet.</p>}
        {rows.map(r => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 12, padding: "0.65rem 1rem" }}>
            <span style={{ fontSize: "0.88rem" }}>{WEEKDAY_LABELS[r.day_of_week]} · {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</span>
            <button disabled={saving} onClick={() => removeWindow(r.id)} style={{ background: "none", border: "none", color: "#A32D2D", cursor: "pointer", fontSize: "0.8rem" }}>Remove</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", background: "var(--plum-t)", borderRadius: 12, padding: "0.85rem 1rem" }}>
        <select value={newDay} onChange={e => setNewDay(Number(e.target.value))} style={{ padding: "0.5rem", borderRadius: 8, border: "1.5px solid rgba(155,127,184,0.25)" }}>
          {WEEKDAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
        <input type="time" value={newStart} onChange={e => setNewStart(e.target.value)} style={{ padding: "0.5rem", borderRadius: 8, border: "1.5px solid rgba(155,127,184,0.25)" }} />
        <span>–</span>
        <input type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)} style={{ padding: "0.5rem", borderRadius: 8, border: "1.5px solid rgba(155,127,184,0.25)" }} />
        <button disabled={saving} onClick={addWindow} className="btn-plum" style={{ padding: "0.5rem 1.1rem", fontSize: "0.85rem" }}>Add</button>
      </div>
    </div>
  );
}

// ─── Account (password only — see file header for why) ─────────────────────
function MyAccount({ user }: { user: User }) {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const handleSave = async () => {
    setMessage(null);
    if (password.length < 8) { setMessage({ kind: "error", text: "Password must be at least 8 characters." }); return; }
    if (password !== confirm) { setMessage({ kind: "error", text: "Passwords don't match." }); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) { setMessage({ kind: "error", text: error.message }); return; }
    setPassword(""); setConfirm("");
    setMessage({ kind: "ok", text: "Password updated." });
  };

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.12)", padding: "1.5rem", maxWidth: 400 }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 0, fontSize: "1.1rem" }}>Change password</h3>
      <p style={{ color: "var(--grey)", fontSize: "0.82rem", marginBottom: "1.25rem" }}>{user.email}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <input type="password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)}
          style={{ padding: "0.7rem 0.9rem", borderRadius: 10, border: "1.5px solid rgba(155,127,184,0.25)", fontSize: "0.88rem" }} />
        <input type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)}
          style={{ padding: "0.7rem 0.9rem", borderRadius: 10, border: "1.5px solid rgba(155,127,184,0.25)", fontSize: "0.88rem" }} />
        {message && <p style={{ color: message.kind === "error" ? "#A32D2D" : "#0F6E56", fontSize: "0.82rem", margin: 0 }}>{message.text}</p>}
        <button disabled={saving} onClick={handleSave} className="btn-plum" style={{ padding: "0.7rem", fontSize: "0.88rem" }}>
          {saving ? "Saving…" : "Update password"}
        </button>
      </div>
    </div>
  );
}
