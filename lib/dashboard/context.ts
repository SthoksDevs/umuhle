// lib/dashboard/context.ts
//
// Server-side dashboard role resolution — the getEmployeeContext()-style
// helper flagged as follow-up work in the original role-based-dashboards
// migration writeup, now built as part of the route split itself since
// every layout guard needs it. See docs/role-based-dashboards-status.md.

import { createClient } from "@/lib/supabase/server";
import type { Profile, BranchEmployeeRank } from "@/types";

// The four separated dashboard "spaces". Does not include "admin" — Umuhle
// admins are routed to /admin by proxy.ts and never hit this resolver in
// practice, but resolveDashboardRole() still falls through sensibly if it
// ever does (see below).
export type DashboardRole = "customer" | "employee" | "artist" | "owner";

export interface EmployeeAssignment {
  branchEmployeeId: string;
  branchId: string;
  rank: BranchEmployeeRank;
  permissions: {
    canManageProducts: boolean;
    canManageCalendar: boolean;
    canViewAnalytics: boolean;
    canViewRevenue: boolean;
  };
}

export interface DashboardContext {
  user: { id: string; email: string | null };
  profile: Profile;
  role: DashboardRole;
  // Only populated when role === "employee" (and only "active" invite_status
  // rows — a "pending" row means the invite hasn't been accepted yet via
  // the not-yet-built invite flow, and shouldn't grant dashboard access).
  employeeAssignments: EmployeeAssignment[];
}

// Priority when a profile qualifies for more than one route (e.g. an artist
// who is also a store owner): employee > owner > artist > customer.
// Employee is highest because, per the original brief, an employee account
// is scoped down to almost nothing else — see EmployeeDashboard.tsx — so if
// is_employee is set that's what the account is *for*. Below that, owner
// outranks artist somewhat arbitrarily (running a store is the "bigger"
// role) — profiles with both flags are expected to be rare; this only
// decides where the root /dashboard redirect lands, not what the resulting
// DashboardShell shows (that's still driven by the individual is_* flags).
export function resolveDashboardRole(
  profile: Pick<Profile, "is_employee" | "is_partner" | "is_artist">
): DashboardRole {
  if (profile.is_employee) return "employee";
  if (profile.is_partner) return "owner";
  if (profile.is_artist) return "artist";
  return "customer";
}

// Is this profile allowed to *view* this specific role's route directly
// (as opposed to being redirected there by default)? Customer is the
// universal baseline every account can reach — e.g. an artist checking
// their own purchase history as a buyer — the other three require the
// matching flag. Used by each app/dashboard/<role>/layout.tsx guard.
export function isEligibleForRole(
  profile: Pick<Profile, "is_employee" | "is_partner" | "is_artist">,
  role: DashboardRole
): boolean {
  switch (role) {
    case "employee": return profile.is_employee;
    case "owner": return profile.is_partner;
    case "artist": return profile.is_artist;
    case "customer": return true;
  }
}

// Resolves the current session into a DashboardContext, or null if there's
// no logged-in user. proxy.ts already redirects unauthenticated visitors
// away from /dashboard* before any of these pages render, so `null` here
// is a defensive case (direct navigation edge cases, expired session
// between proxy and render) rather than the expected path — callers should
// still redirect on null rather than assume it can't happen.
export async function getDashboardContext(): Promise<DashboardContext | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profileRow) return null;

  const profile = profileRow as Profile;
  const role = resolveDashboardRole(profile);

  let employeeAssignments: EmployeeAssignment[] = [];
  if (role === "employee") {
    const { data: rows } = await supabase
      .from("branch_employees")
      .select("id, branch_id, rank, can_manage_products, can_manage_calendar, can_view_analytics, can_view_revenue")
      .eq("profile_id", user.id)
      .eq("invite_status", "active");

    employeeAssignments = (rows ?? []).map(r => ({
      branchEmployeeId: r.id as string,
      branchId: r.branch_id as string,
      rank: r.rank as BranchEmployeeRank,
      permissions: {
        canManageProducts: r.can_manage_products as boolean,
        canManageCalendar: r.can_manage_calendar as boolean,
        canViewAnalytics: r.can_view_analytics as boolean,
        canViewRevenue: r.can_view_revenue as boolean,
      },
    }));
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    profile,
    role,
    employeeAssignments,
  };
}
