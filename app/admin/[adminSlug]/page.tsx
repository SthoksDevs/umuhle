// app/[adminSlug]/page.tsx
// This catch-all segment intercepts any single-segment path.
// The middleware checks whether the requested slug matches the stored admin_login_slug;
// if not, it rewrites to the 404 page. If it matches, this page renders.
//
// Flow:
//   1. Enter email + password  → POST /api/admin/otp  (verifies creds, sends OTP)
//   2. Enter 6-digit code      → PUT  /api/admin/otp  (verifies OTP, returns tokenHash)
//   3. Client exchanges tokenHash for a Supabase session, then redirects to /admin

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import AdminLoginClient from "./AdminLoginClient";

interface Props {
  params: Promise<{ adminSlug: string }>;
}

export const dynamic = "force-dynamic";

export default async function AdminSlugPage({ params }: Props) {
  const { adminSlug } = await params;

  // Server-side: fetch the real slug from Supabase using service role
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "admin_login_slug")
    .single();

  const storedSlug = data?.value ?? "ngenakuadmin";

  if (adminSlug !== storedSlug) {
    notFound();
  }

  return <AdminLoginClient />;
}
