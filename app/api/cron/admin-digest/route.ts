// app/api/cron/admin-digest/route.ts
//
// Daily cron: emails the super admin one summary of everything waiting for
// a decision, so nothing sits unnoticed in a tab nobody happened to check
// that day. Each section below mirrors a "pending" filter that already
// exists somewhere in the admin dashboard (Salons/Products/Ads tabs,
// Payments' pending withdrawals) — same filters, so the counts here always
// match what admin would see by clicking into that tab.
//
// Registered in vercel.json to run once a day, per the request that this
// specific job send "once a day".

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAdminPendingDigestEmail, type PendingDigestSection } from "@/lib/email";

// Matches ADMIN_EMAIL in lib/email.ts and SUPER_ADMIN_EMAIL in
// app/admin/page.tsx — same address, each file already hardcodes it locally.
const SUPER_ADMIN_EMAIL = "info@umuhle.co.za";
const SITE = "https://umuhle.co.za";

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

  const supabase = serviceClient();

  const [salonsRes, productsRes, adsRes, withdrawalsRes] = await Promise.all([
    // Matches SalonsTab's pending filter.
    supabase.from("partner_salons").select("id, name, created_at").eq("status", "pending").order("created_at", { ascending: true }),
    // Matches ProductsReviewTab's pending filter.
    supabase.from("products").select("id, name, is_umuhle_product, created_at").in("moderation_status", ["scanning", "needs_review", "draft"]).order("created_at", { ascending: true }),
    // Matches AdsReviewTab's pending filter.
    supabase.from("ads").select("id, title, created_at").eq("moderation_status", "draft").neq("status", "expired").order("created_at", { ascending: true }),
    // Matches PaymentsTab's pending-withdrawals filter.
    supabase.from("withdrawals").select("id, amount, bank_name, account_holder, created_at").eq("status", "pending").order("created_at", { ascending: true }),
  ]);

  if (salonsRes.error || productsRes.error || adsRes.error || withdrawalsRes.error) {
    console.error("[cron/admin-digest] query error:", salonsRes.error ?? productsRes.error ?? adsRes.error ?? withdrawalsRes.error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const salons = salonsRes.data ?? [];
  // Umuhle-direct products are auto-managed and never show approve/reject
  // actions in ProductsReviewTab — excluded here for the same reason.
  const products = (productsRes.data ?? []).filter((p) => !p.is_umuhle_product);
  const ads = adsRes.data ?? [];
  const withdrawals = withdrawalsRes.data ?? [];

  const sections: PendingDigestSection[] = [
    {
      label: "Stores awaiting verification",
      count: salons.length,
      items: salons.map((s) => ({ title: s.name, href: `${SITE}/admin?tab=salons` })),
    },
    {
      label: "Products awaiting moderation",
      count: products.length,
      items: products.map((p) => ({ title: p.name, href: `${SITE}/admin?tab=products` })),
    },
    {
      label: "Ads awaiting moderation",
      count: ads.length,
      items: ads.map((a) => ({ title: a.title, href: `${SITE}/admin?tab=ads` })),
    },
    {
      label: "Withdrawal requests awaiting payout",
      count: withdrawals.length,
      items: withdrawals.map((w) => ({
        title: `R${(w.amount / 100).toFixed(2)} — ${w.account_holder}`,
        subtitle: w.bank_name,
        href: `${SITE}/admin?tab=payments`,
      })),
    },
  ];

  const totalCount = sections.reduce((sum, s) => sum + s.count, 0);
  if (totalCount === 0) {
    // Deliberately no "all clear!" email — silence is the normal case for a
    // young marketplace and shouldn't cost admin an email every morning.
    return NextResponse.json({ sent: false, reason: "Nothing pending today.", totalCount: 0 });
  }

  await sendAdminPendingDigestEmail({ toEmail: SUPER_ADMIN_EMAIL, sections });

  return NextResponse.json({
    sent: true,
    totalCount,
    breakdown: sections.map((s) => ({ label: s.label, count: s.count })),
  });
}
