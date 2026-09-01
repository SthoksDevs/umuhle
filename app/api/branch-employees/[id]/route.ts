// app/api/branch-employees/[id]/route.ts
//
// Owner-side management of an existing branch_employees row: rank
// (staff/manager), the four can_* permission flags, and revoking access
// (invite_status -> 'revoked'). See docs/role-based-dashboards-status.md
// — this is the "owner UI for granting the four can_manage_products/
// can_manage_calendar/can_view_analytics/can_view_revenue flags" that was
// deferred until the route split landed.
//
// Not callable by the employee themselves — branch_employees has no
// self-update RLS policy (see app/api/branch-employees/activate/route.ts's
// comment for why), and rank/permissions are owner-only decisions by
// design regardless.
//
// The "max 2 managers per branch" rule is NOT re-implemented here — it's
// already enforced in Postgres by the trg_branch_manager_cap trigger
// (supabase/migrations/20260830_role_based_dashboards.sql). This route
// just lets that trigger's error surface as a clean 400 instead of a raw
// 500.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const PATCHABLE_FIELDS = ["rank", "can_manage_products", "can_manage_calendar", "can_view_analytics", "can_view_revenue", "invite_status"] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row, error: rowError } = await service
    .from("branch_employees")
    .select("id, branch:store_branches(id, salon:partner_salons(partner_id))")
    .eq("id", id)
    .single();
  const branchRow = Array.isArray(row?.branch) ? row?.branch[0] : row?.branch;
  const salonRow = Array.isArray(branchRow?.salon) ? branchRow?.salon[0] : branchRow?.salon;
  if (rowError || !row || salonRow?.partner_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // Only accept known, owner-editable fields — anything else in the body
  // (e.g. profile_id, invited_by) is silently ignored rather than erroring,
  // same defensive posture as picking specific fields off a form.
  const patch: Record<string, unknown> = {};
  for (const field of PATCHABLE_FIELDS) {
    if (field in body) patch[field] = body[field];
  }
  if (patch.invite_status !== undefined && patch.invite_status !== "revoked" && patch.invite_status !== "active") {
    return NextResponse.json({ error: "invite_status can only be set to 'active' or 'revoked' here — see /api/branch-employees/activate for the pending->active transition" }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { data: updated, error: updateError } = await service
    .from("branch_employees")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    // Postgres RAISE EXCEPTION messages from the manager-cap trigger land
    // here as a normal query error — surface the message as-is, it's
    // already written for a human ("A branch can have at most 2 managers").
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }
  return NextResponse.json({ success: true, branchEmployee: updated });
}
