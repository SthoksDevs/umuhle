"use client";
// components/ListingPackagePicker.tsx
//
// The payment step that follows product creation (or an expired-listing
// renewal). Reuses the exact same Starter/Growth/Business/Premium tiers as
// the old standalone ad packages — see LISTING_PACKAGES in types/index.ts —
// then redirects to PayFast via the same hidden-form POST pattern used
// elsewhere in the app (see BookingDrawer.handleBook in app/page.tsx).
//
// Props:
//   productId    — the product this payment is for (already exists in DB
//                  with listing_status "pending_payment" or "expired")
//   productName  — shown in the heading
//   mode         — "new" | "renew" (copy differs slightly)
//   onCancel     — called if the partner backs out without paying

import { useState } from "react";
import { LISTING_PACKAGES, type ListingPackageId } from "@/types";

interface Props {
  productId:   string;
  productName: string;
  mode?:       "new" | "renew";
  onCancel?:   () => void;
}

export default function ListingPackagePicker({ productId, productName, mode = "new", onCancel }: Props) {
  const [selected,  setSelected]  = useState<ListingPackageId>("starter");
  const [submitting, setSubmitting] = useState(false);
  const [error,     setError]     = useState("");

  const handlePay = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/payfast/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "product_listing", productId, packageId: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment initiation failed");

      const form = document.createElement("form");
      form.method = "POST"; form.action = data.payfastUrl;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const inp = document.createElement("input");
        inp.type = "hidden"; inp.name = k; inp.value = v;
        form.appendChild(inp);
      });
      document.body.appendChild(form);
      form.submit();
      // Intentionally leave submitting=true — page is navigating away.
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.15rem", marginBottom: "0.25rem" }}>
        {mode === "renew" ? "Renew this listing" : "Choose a listing package"}
      </h3>
      <p style={{ fontSize: "0.82rem", color: "#888", marginBottom: "1.25rem" }}>
        {mode === "renew"
          ? <>&ldquo;{productName}&rdquo; has expired. Pick a package to bring it back to the shop.</>
          : <>&ldquo;{productName}&rdquo; is saved as a draft. Pick a package to publish it — every listing on Umuhle, product or ad, runs on the same simple pricing.</>}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {LISTING_PACKAGES.map((pkg) => (
          <label key={pkg.id}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
              padding: "0.85rem 1.1rem", borderRadius: 14, cursor: "pointer",
              border: `1.5px solid ${selected === pkg.id ? "var(--plum)" : "rgba(155,127,184,0.25)"}`,
              background: selected === pkg.id ? "var(--plum-t)" : "#fff",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <input
                type="radio"
                name="listing_package"
                value={pkg.id}
                checked={selected === pkg.id}
                onChange={() => setSelected(pkg.id)}
                style={{ width: 16, height: 16, accentColor: "var(--plum)", flexShrink: 0 }}
              />
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem", color: selected === pkg.id ? "var(--plum)" : "#333" }}>
                  {pkg.name}
                  {pkg.id === "starter" && (
                    <span style={{ marginLeft: 8, background: "#FAEEDA", color: "#854F0B", borderRadius: 100, padding: "1px 8px", fontSize: "0.68rem", fontWeight: 600 }}>
                      Minimum
                    </span>
                  )}
                </p>
                <p style={{ margin: "0.1rem 0 0", fontSize: "0.76rem", color: "var(--grey)" }}>
                  Live in the shop for {pkg.label}
                </p>
              </div>
            </div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "var(--plum)", whiteSpace: "nowrap" }}>
              R{(pkg.price / 100).toFixed(0)}
            </p>
          </label>
        ))}
      </div>

      <p style={{ fontSize: "0.72rem", color: "#aaa", marginTop: "0.85rem", lineHeight: 1.5 }}>
        This package covers <strong>this product only</strong>. Starter is the minimum — R20 keeps it listed for
        6 weeks. Longer packages cost more but mean you&apos;re not renewing every 6 weeks if it&apos;s a steady seller.
      </p>

      {error && (
        <p style={{ color: "#E53935", fontSize: "0.85rem", marginTop: "0.75rem", background: "#FFF0F0", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={submitting}
            style={{ flex: 1, padding: "0.75rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--grey)", fontSize: "0.9rem", cursor: submitting ? "not-allowed" : "pointer" }}>
            {mode === "renew" ? "Not now" : "Save as draft, pay later"}
          </button>
        )}
        <button type="button" onClick={handlePay} disabled={submitting}
          className="btn-plum"
          style={{ flex: 2, padding: "0.75rem", borderRadius: 100, fontSize: "0.9rem", fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Redirecting to payment…" : `Pay R${(LISTING_PACKAGES.find(p => p.id === selected)!.price / 100).toFixed(0)} with PayFast`}
        </button>
      </div>
    </div>
  );
}
