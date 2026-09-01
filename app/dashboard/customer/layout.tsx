// app/dashboard/customer/layout.tsx
//
// Server-side eligibility guard for the customer dashboard route — see
// docs/role-based-dashboards-status.md. Customer is the universal
// baseline every account can reach (e.g. an artist checking their own
// purchase history as a buyer), so isEligibleForRole always returns true
// here — this still checks auth and still redirects unauthenticated
// visitors, it just never redirects an authenticated one away.

import { redirect } from "next/navigation";
import { getDashboardContext, isEligibleForRole } from "@/lib/dashboard/context";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/?auth=login");
  if (!isEligibleForRole(ctx.profile, "customer")) redirect("/dashboard");
  return <>{children}</>;
}
