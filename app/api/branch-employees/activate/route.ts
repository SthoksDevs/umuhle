// app/api/branch-employees/activate/route.ts
//
// Called by app/activate-employee/page.tsx right after the employee sets
// their password (supabase.auth.updateUser({password})) — flips their
// invite_status from 'pending' to 'active'.
//
// Why not just let the employee update their own row directly? The
// 20260830_employee_self_access_rls.sql migration deliberately only
// granted branch_employees a SELF SELECT policy, not UPDATE — an
// employee being able to write to their own invite_status (or worse,
// rank/can_* columns, which live on the same row) via a direct RLS-backed
// client call is a bigger surface than needed for "one specific
// pending->active transition, once, right after setting a password".
// Routing it through a service-role endpoint keeps that transition as
// the only thing this identity can ever do to the row client-side.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rows, error: updateError } = await service
    .from("branch_employees")
    .update({ invite_status: "active" })
    .eq("profile_id", user.id)
    .eq("invite_status", "pending")
    .select("id");

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    // Not an error worth surfacing loudly — either there was nothing
    // pending (already activated, e.g. a double-click) or this account
    // was never invited as an employee. Either way there's nothing to do.
    return NextResponse.json({ activated: 0 });
  }
  return NextResponse.json({ activated: rows.length });
}
