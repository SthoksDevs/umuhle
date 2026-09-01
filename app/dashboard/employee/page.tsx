"use client";

// app/dashboard/employee/page.tsx
//
// Thin route entry. EmployeeDashboard doesn't read useSearchParams()
// itself, so the Suspense boundary here is just for consistency with the
// other three role routes' loading fallback, not a hard requirement.

import { Suspense } from "react";
import Image from "next/image";
import EmployeeDashboard from "@/components/dashboard/EmployeeDashboard";
import { ICON } from "@/lib/dashboard/format";

export default function EmployeeDashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--white)" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    }>
      <EmployeeDashboard />
    </Suspense>
  );
}
