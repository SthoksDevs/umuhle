// app/dashboard/page.tsx
//
// Root of the role-based dashboard split (see
// docs/role-based-dashboards-status.md). This used to be the entire
// 4,911-line dashboard — now it's just a role resolver: figure out which
// of customer/employee/artist/owner this session is, and redirect there,
// preserving the query string. That last part matters: /dashboard?tab=
// wishlist&sub=products style links are already baked into sent emails
// and WhatsApp templates (see lib/email.ts, lib/whatsapp.ts,
// lib/push-server.ts) and must keep resolving — see
// components/dashboard/DashboardShell.tsx, which still reads `tab`/`sub`
// itself via useSearchParams() once it's mounted at the resolved route.
//
// proxy.ts already redirects an unauthenticated visitor away from
// /dashboard* before this ever renders — the null-context branch below is
// a defensive fallback, not the expected path.

import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/context";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardRootPage({ searchParams }: Props) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/?auth=login");

  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) { for (const v of value) qs.append(key, v); }
    else qs.append(key, value);
  }
  const suffix = qs.toString();

  redirect(`/dashboard/${ctx.role}${suffix ? `?${suffix}` : ""}`);
}
