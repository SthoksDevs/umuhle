"use client";

import type { ReactNode } from "react";

/**
 * UMUHLE DASHBOARD REFACTOR — BATCH 4: MY BUSINESS HUB
 *
 * This component owns the navigation shell for business-management sections.
 * The individual sections remain independently reusable components.
 *
 * Role-based dashboards (see docs/role-based-dashboards-status.md): which of
 * stores/services/products/orders/analytics actually apply depends on the
 * account — a customer who opted into selling only needs Products+Orders,
 * an artist needs Services (+ Products/Orders if selling), an owner needs
 * Stores+Products+Orders+Analytics. The optional `sections` prop lets a
 * caller restrict which nav buttons (and content) show; omitting it keeps
 * the old "show all four" behavior for backward compatibility (analytics
 * is never included by default — it's opt-in via `sections` since it
 * didn't exist when that default was chosen).
 *
 * When `sections` resolves to exactly one entry — in practice, an artist
 * who hasn't also opted into selling — there's nothing to switch between,
 * so the Overview pill/panel (and the pill row itself) are skipped
 * entirely and the heading is retitled to match what's actually shown,
 * rather than the generic "My Business... stores, services, products"
 * copy that doesn't apply to a services-only account. See
 * DashboardShell.tsx's `businessIsServicesOnly`, which mirrors this same
 * check so the sidebar label and this panel's heading always agree.
 */
export type BusinessSection = "overview" | "stores" | "services" | "products" | "orders" | "analytics";

const SECTION_LABELS: Record<Exclude<BusinessSection, "overview">, string> = {
  stores: "Stores",
  services: "Services",
  products: "Products",
  orders: "Orders",
  analytics: "Analytics",
};

const ALL_SECTIONS: Exclude<BusinessSection, "overview">[] = ["stores", "services", "products", "orders"];

export default function MyBusinessTab({
  activeSection,
  onSectionChange,
  stores,
  services,
  products,
  orders,
  analytics,
  sections = ALL_SECTIONS,
}: {
  activeSection: BusinessSection;
  onSectionChange: (section: BusinessSection) => void;
  stores?: ReactNode;
  services?: ReactNode;
  products?: ReactNode;
  orders?: ReactNode;
  analytics?: ReactNode;
  sections?: Exclude<BusinessSection, "overview">[];
}) {
  const isServicesOnly = sections.length === 1 && sections[0] === "services";

  const title = isServicesOnly ? "My Services" : "My Business";
  const description = isServicesOnly
    ? "Manage the services you offer and your availability."
    : "Manage your stores, services, products and customer orders.";

  // With nothing to switch between, always show the one section's content
  // directly — otherwise `activeSection` would sit on its initial
  // "overview" value forever (there'd be no pill left to change it to
  // anything else) and render a blank generic panel instead of Services.
  const effectiveSection: BusinessSection = isServicesOnly ? "services" : activeSection;

  const visibleSections = [
    { id: "overview" as const, label: "Overview" },
    ...sections.map(id => ({ id, label: SECTION_LABELS[id] })),
  ];

  return (
    <section>
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.25rem" }}>
          {title}
        </h2>
        <p style={{ color: "var(--grey)", fontSize: "0.875rem", margin: 0 }}>
          {description}
        </p>
      </div>

      {!isServicesOnly && (
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem", marginBottom: "1.5rem" }}>
          {visibleSections.map(section => (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              style={{
                display: "flex", alignItems: "center", gap: "0.45rem",
                padding: "0.55rem 0.9rem", borderRadius: 100,
                border: "1.5px solid rgba(155,127,184,0.25)",
                background: activeSection === section.id ? "var(--plum)" : "#fff",
                color: activeSection === section.id ? "#fff" : "var(--onyx)",
                cursor: "pointer", whiteSpace: "nowrap", fontSize: "0.82rem",
                fontWeight: activeSection === section.id ? 600 : 400,
              }}
            >
              {section.label}
            </button>
          ))}
        </div>
      )}

      {!isServicesOnly && effectiveSection === "overview" && (
        <div style={{ background: "#fff", borderRadius: 18, padding: "1.5rem", border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 0 }}>Your business</h3>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", lineHeight: 1.6 }}>
            Manage your Umuhle stores, services, products and orders from one place.
          </p>
        </div>
      )}

      {effectiveSection === "stores" && stores}
      {effectiveSection === "services" && services}
      {effectiveSection === "products" && products}
      {effectiveSection === "orders" && orders}
      {effectiveSection === "analytics" && analytics}
    </section>
  );
}
