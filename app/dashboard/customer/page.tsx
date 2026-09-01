"use client";

// app/dashboard/customer/page.tsx
//
// Thin route entry — see docs/role-based-dashboards-status.md. The
// Suspense boundary is required here (not inside DashboardShell itself)
// because DashboardShell reads useSearchParams(), which needs a Suspense
// boundary somewhere above it in the tree — mirrors the original
// monolith's own DashboardPage wrapper.

import { Suspense } from "react";
import Image from "next/image";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { ICON } from "@/lib/dashboard/format";

export default function CustomerDashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--white)" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    }>
      <DashboardShell role="customer" />
    </Suspense>
  );
}
