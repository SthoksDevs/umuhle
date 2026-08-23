"use client";

import type { User } from "@supabase/supabase-js";

/**
 * UMUHLE DASHBOARD REFACTOR — BATCH 1
 *
 * This component is the intended home for the partner's product fulfilment
 * and shipment management UI.
 *
 * IMPORTANT CONTINUATION NOTE:
 * The legacy implementation currently lives inside app/dashboard/page.tsx
 * as OrderFulfillmentManager + ShipmentsManager. Do NOT delete those legacy
 * components until this wrapper has been wired into the dashboard and the
 * old UI has been removed from My Shop.
 *
 * Target navigation:
 *   My Business
 *     - Stores
 *     - Services
 *     - Products
 *     - Orders
 *
 * Target order UX:
 *   Orders list -> individual order -> shipment details
 *
 * The actual extraction of OrderFulfillmentManager and ShipmentsManager is
 * deliberately being done in small batches because page.tsx is currently a
 * ~269KB monolithic file. Keeping this marker here means another developer
 * can continue the refactor without guessing what this file is for.
 */

export default function BusinessOrdersTab({
  user,
  children,
}: {
  user: User;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ marginBottom: "1.5rem" }}>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            fontSize: "1.4rem",
            margin: "0 0 0.25rem",
          }}
        >
          Orders
        </h2>
        <p style={{ color: "var(--grey)", fontSize: "0.875rem", margin: 0 }}>
          Manage orders for your products, fulfilment and shipment details in one place.
        </p>
      </div>

      {/*
       * TEMPORARY EXTRACTION SLOT
       *
       * Batch 2 will move the existing OrderFulfillmentManager UI here.
       * Batch 3 will move shipment details into the individual order view.
       */}
      {children}
    </section>
  );
}
