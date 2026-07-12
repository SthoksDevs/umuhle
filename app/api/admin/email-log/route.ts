// app/api/admin/email-log/route.ts
//
// Serves rows from `email_log` to the admin dashboard's Emails tab.
//
// Why this route exists: every email-sending function in lib/email.ts writes
// to `email_log` using the SERVICE-ROLE Supabase client, so inserts always
// succeed regardless of RLS. But the admin dashboard previously read this
// table directly from the browser using the ANON-KEY client bound to the
// logged-in admin's session — which is subject to RLS. With no SELECT policy
// granting admins read access to `email_log`, that query silently returned
// zero/partial rows even though the data was really there. Routing the read
// through this service-role-backed endpoint (same trusted-server pattern
// used by app/api/admin/otp/route.ts) fixes that gap without having to
// touch RLS policies at all.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const service = serviceClient();
  const { data: { user }, error: userError } = await service.auth.getUser(token);
  if (userError || !user) return null;

  const { data: profile } = await service
    .from("profiles")
    .select("is_admin, account_status")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin || profile?.account_status !== "active") return null;

  return service;
}

// ── GET: list recent emails (optionally filtered by status) ─────────────────
export async function GET(req: NextRequest) {
  const service = await requireAdmin(req);
  if (!service) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status"); // "sent" | "failed" | null

  let query = service
    .from("email_log")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(200);

  if (status === "sent" || status === "failed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("admin/email-log GET error:", error);
    return NextResponse.json({ error: "Failed to load email log." }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}
