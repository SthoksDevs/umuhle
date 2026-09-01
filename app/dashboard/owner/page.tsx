"use client";

// app/dashboard/owner/page.tsx
// Thin route entry — see app/dashboard/customer/page.tsx for why the
// Suspense boundary lives here rather than inside DashboardShell.

import { Suspense } from "react";
import Image from "next/image";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { ICON } from "@/lib/dashboard/format";

export default function OwnerDashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--white)" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    }>
      <DashboardShell role="owner" />
    </Suspense>
  );
}
