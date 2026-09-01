// app/dashboard/employee/layout.tsx
//
// Server-side eligibility guard for the employee dashboard route — see
// docs/role-based-dashboards-status.md. Redirects back to /dashboard
// (which re-resolves the right role) for anyone whose profile isn't
// is_employee, rather than rendering EmployeeDashboard for them.

import { redirect } from "next/navigation";
import { getDashboardContext, isEligibleForRole } from "@/lib/dashboard/context";

export const dynamic = "force-dynamic";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/?auth=login");
  if (!isEligibleForRole(ctx.profile, "employee")) redirect("/dashboard");
  return <>{children}</>;
}
