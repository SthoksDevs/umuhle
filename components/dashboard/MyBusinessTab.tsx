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
  const visibleSections = [
    { id: "overview" as const, label: "Overview" },
    ...sections.map(id => ({ id, label: SECTION_LABELS[id] })),
  ];

  return (
    <section>
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.25rem" }}>
          My Business
        </h2>
        <p style={{ color: "var(--grey)", fontSize: "0.875rem", margin: 0 }}>
          Manage your stores, services, products and customer orders.
        </p>
      </div>

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

      {activeSection === "overview" && (
        <div style={{ background: "#fff", borderRadius: 18, padding: "1.5rem", border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginTop: 0 }}>Your business</h3>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", lineHeight: 1.6 }}>
            Manage your Umuhle stores, services, products and orders from one place.
          </p>
        </div>
      )}

      {activeSection === "stores" && stores}
      {activeSection === "services" && services}
      {activeSection === "products" && products}
      {activeSection === "orders" && orders}
      {activeSection === "analytics" && analytics}
    </section>
  );
}
