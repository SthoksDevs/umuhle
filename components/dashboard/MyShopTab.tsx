"use client";

// components/dashboard/MyShopTab.tsx
//
// The "Products" section of My Business — a thin wrapper around the
// already-extracted ProductsManager. Shown for owners always, for artists
// and customers only when profile.is_seller. Split out of the old
// app/dashboard/page.tsx monolith — see docs/role-based-dashboards-status.md.
// (The monolith also had a dead, unused `fmtShop` helper sitting next to
// this component and a leftover unused `PartnerProductRow` interface right
// after it — both dropped as dead code rather than carried over; see the
// status doc.)

import ProductsManager from "@/components/dashboard/ProductsManager";

export default function MyShopTab({ user, partnerProvince }: { user: { id: string }; partnerProvince?: string | null }) {
  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.25rem" }}>Shop</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        <strong>Sell your products on Umuhle</strong><br />
        Add products to your shop for free.
      </p>
      <ProductsManager user={user} partnerProvince={partnerProvince} />
    </div>
  );
}
