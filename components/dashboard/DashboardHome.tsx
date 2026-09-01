"use client";

// components/dashboard/DashboardHome.tsx
//
// The "dashboard" tab's landing page — welcome banner, quick stats, quick
// actions. Split out of the old app/dashboard/page.tsx monolith, where its
// stats/actions unconditionally assumed a store owner ("+ Add a store" in
// the header, a "My Stores" stat card, quick actions for stores/services/
// products regardless of account type) — exactly the "one dashboard for
// everyone" problem this whole split exists to fix. Now driven by the
// `businessSections` DashboardShell already computes for MyBusinessTab, so
// this stays in sync with what My Business actually shows for the current
// role rather than duplicating that logic. See
// docs/role-based-dashboards-status.md.

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import type { Tab } from "@/lib/dashboard/types";
import type { BusinessSection } from "@/components/dashboard/MyBusinessTab";

const SECTION_QUICK_ACTION: Partial<Record<BusinessSection, string>> = {
  stores: "+ Add a store",
  services: "+ Add a service",
  products: "+ Add a product",
};

export default function DashboardHome({ user, profile, businessSections, onNavigate }: {
  user: User;
  profile: Profile;
  businessSections: BusinessSection[];
  onNavigate: (tab: Tab, section?: BusinessSection) => void;
}) {
  const supabase = createClient();
  const [stats, setStats] = useState({ bookings: 0, orders: 0, stores: 0 });
  const showStores = businessSections.includes("stores");
  const showMyBusiness = businessSections.length > 0;

  useEffect(() => {
    let mounted = true;
    const queries = [
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("client_id", user.id),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("client_id", user.id),
    ];
    if (showStores) {
      queries.push(supabase.from("partner_salons").select("id", { count: "exact", head: true }).eq("partner_id", user.id));
    }
    Promise.all(queries).then(([b, o, s]) => {
      if (mounted) setStats({ bookings: b.count ?? 0, orders: o.count ?? 0, stores: s?.count ?? 0 });
    });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, showStores]);

  const cards = [
    { label: "Bookings", value: stats.bookings, action: "bookings" as Tab },
    { label: "Orders",   value: stats.orders,   action: "my-orders" as Tab },
    ...(showStores ? [{ label: "My Stores", value: stats.stores, action: "my-business" as Tab, section: "stores" as BusinessSection }] : []),
  ];

  return (
    <section>
      <div className="dashboard-welcome">
        <div>
          <p className="dashboard-eyebrow">Welcome back</p>
          <h1>{profile.full_name?.split(" ")[0] ?? "Beautiful"}</h1>
          <p>{user.email}</p>
        </div>
        {showStores && <button className="btn-plum" onClick={() => onNavigate("my-business", "stores")}>+ Add store</button>}
      </div>
      <div className="dashboard-stat-grid">
        {cards.map(c => (
          <button key={c.label} className="dashboard-stat-card" onClick={() => onNavigate(c.action, c.section)}>
            <span>{c.label}</span>
            <strong>{c.value}</strong>
            <small>Open {c.label.toLowerCase()} →</small>
          </button>
        ))}
      </div>
      <div className="dashboard-home-grid">
        {showMyBusiness && (
          <div className="dashboard-card">
            <h2>Quick actions</h2>
            <div className="quick-actions">
              {businessSections
                .filter((s): s is keyof typeof SECTION_QUICK_ACTION => s in SECTION_QUICK_ACTION)
                .map(s => (
                  <button key={s} onClick={() => onNavigate("my-business", s)}>{SECTION_QUICK_ACTION[s]}</button>
                ))}
              <button onClick={() => onNavigate("bookings")}>View bookings</button>
            </div>
          </div>
        )}
        {showMyBusiness && (
          <div className="dashboard-card">
            <h2>My business</h2>
            <p>Manage your {[showStores && "locations", businessSections.includes("services") && "services", businessSections.includes("products") && "products"].filter(Boolean).join(", ")} and orders from one place.</p>
            <button className="text-link" onClick={() => onNavigate("my-business", businessSections[0])}>Manage My Business →</button>
          </div>
        )}
      </div>
    </section>
  );
}
