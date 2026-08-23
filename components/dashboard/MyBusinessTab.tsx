"use client";

import type { ReactNode } from "react";

/**
 * UMUHLE DASHBOARD REFACTOR — BATCH 4: MY BUSINESS HUB
 *
 * This component owns the navigation shell for business-management sections.
 * The individual sections remain independently reusable components.
 *
 * CONTINUATION MARKER:
 * - Stores is the next area to extract from page.tsx.
 * - Products and Orders are already extracted.
 * - Do not create a standalone Shipments dashboard destination.
 */
export type BusinessSection = "overview" | "stores" | "services" | "products" | "orders";

export default function MyBusinessTab({
  activeSection,
  onSectionChange,
  stores,
  services,
  products,
  orders,
}: {
  activeSection: BusinessSection;
  onSectionChange: (section: BusinessSection) => void;
  stores: ReactNode;
  services: ReactNode;
  products: ReactNode;
  orders: ReactNode;
}) {
  const sections = [
    { id: "overview" as const, label: "Overview" },
    { id: "stores" as const, label: "Stores" },
    { id: "services" as const, label: "Services" },
    { id: "products" as const, label: "Products" },
    { id: "orders" as const, label: "Orders" },
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
        {sections.map(section => (
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
    </section>
  );
}
