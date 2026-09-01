"use client";

// components/dashboard/BranchAnalyticsSection.tsx
//
// Thin wrapper around BranchAnalytics.tsx for the owner's My Business >
// Analytics section specifically — an owner can have more than one salon
// (partner_salons is one-to-many from partner_id, same as
// MySalonTab.tsx's own `listings` array), so this resolves which one(s)
// and shows a picker if there's more than one, before handing off to
// BranchAnalytics. The employee-dashboard case doesn't need this wrapper:
// an employee only ever has one active branch's salon in view, resolved
// directly in EmployeeDashboard.tsx.

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import BranchAnalytics from "@/components/dashboard/BranchAnalytics";

export default function BranchAnalyticsSection({ user }: { user: { id: string } }) {
  const supabase = createClient();
  const [salons, setSalons] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("partner_salons").select("id, name").eq("partner_id", user.id).then(({ data }) => {
      const rows = data ?? [];
      setSalons(rows);
      if (rows.length > 0) setSelectedId(rows[0].id);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  if (loading) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading…</p>;
  if (salons.length === 0) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Add a store first to see analytics.</p>;

  return (
    <div>
      {salons.length > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {salons.map(s => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              style={{ padding: "0.45rem 1rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", cursor: "pointer", fontSize: "0.82rem",
                background: selectedId === s.id ? "var(--plum)" : "transparent", color: selectedId === s.id ? "#fff" : "var(--onyx)" }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      {selectedId && <BranchAnalytics salonId={selectedId} />}
    </div>
  );
}
