"use client";
// components/ListingPackagePicker.tsx
//
// The payment step that follows product creation (or an expired-listing
// renewal). Uses the exact same Starter/Growth/Business/Premium tiers the
// old standalone ad packages used — see LISTING_PACKAGES in types/index.ts.
//
// A package's "Products" count is real: buying Growth (R45) means 3 product
// slots, each live for 3 months from whenever it's actually used — not "R45
// keeps 1 product listed for longer". So before offering to buy a new
// package, this checks whether the partner already has unused slots from a
// past purchase and lets them spend one for free (via the use_listing_slot
// RPC — see the 2026-07-10 migration).
//
// Props:
//   productId    — the product this payment is for (already exists in DB
//                  with listing_status "pending_payment" or "expired")
//   productName  — shown in the heading
//   mode         — "new" | "renew" (copy differs slightly)
//   onCancel     — called if the partner backs out without paying
//   onUsedSlot   — called after successfully spending an existing slot
//                  (parent should refresh its product list)

import { useState, useEffect, useCallback } from "react";
import { LISTING_PACKAGES, type ListingPackageId, type ListingPackageRow } from "@/types";
import { createClient } from "@/lib/supabase/client";

interface Props {
  productId:   string;
  productName: string;
  mode?:       "new" | "renew";
  onCancel?:   () => void;
  onUsedSlot?: () => void;
}

export default function ListingPackagePicker({ productId, productName, mode = "new", onCancel, onUsedSlot }: Props) {
  const supabase = createClient();
  const [selected,   setSelected]   = useState<ListingPackageId>("starter");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");

  const [banks,       setBanks]       = useState<ListingPackageRow[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [spendingId,  setSpendingId]  = useState<string | null>(null);

  const loadBanks = useCallback(async () => {
    setBanksLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBanksLoading(false); return; }
    const { data } = await supabase
      .from("listing_packages")
      .select("*")
      .eq("partner_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    setBanks(((data ?? []) as ListingPackageRow[]).filter(b => b.slots_used < b.slots_total));
    setBanksLoading(false);
  }, [supabase]);

  useEffect(() => { loadBanks(); }, [loadBanks]);

  const handleUseSlot = async (bank: ListingPackageRow) => {
    setSpendingId(bank.id);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("use_listing_slot", {
        p_package_id: bank.id,
        p_product_id: productId,
      });
      if (rpcError) throw rpcError;
      if (!data) throw new Error("That slot isn't available anymore — try another option below.");
      onUsedSlot?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't use that slot. Please try again.");
      loadBanks(); // refresh in case it was already spent elsewhere
    } finally {
      setSpendingId(null);
    }
  };

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

  const PKG_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", business: "Business", premium: "Premium" };

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.15rem", marginBottom: "0.25rem" }}>
        {mode === "renew" ? "Renew this listing" : "Choose a listing package"}
      </h3>
      <p style={{ fontSize: "0.82rem", color: "#888", marginBottom: "1.25rem" }}>
        {mode === "renew"
          ? <>&ldquo;{productName}&rdquo; has expired. Use a spare slot or pick a package to bring it back to the shop.</>
          : <>&ldquo;{productName}&rdquo; is saved as a draft. Use a spare slot or pick a package to publish it.</>}
      </p>

      {/* ── Existing, already-paid slots ── */}
      {!banksLoading && banks.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
            Already paid for — use a spare slot
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {banks.map(bank => {
              const remaining = bank.slots_total - bank.slots_used;
              return (
                <div key={bank.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.75rem 1.1rem", borderRadius: 14, border: "1.5px solid rgba(46,125,50,0.25)", background: "#F3FAF3" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#2E7D32" }}>{PKG_LABEL[bank.package] ?? bank.package} package</p>
                    <p style={{ margin: "0.1rem 0 0", fontSize: "0.74rem", color: "var(--grey)" }}>
                      {remaining} of {bank.slots_total} product slot{bank.slots_total > 1 ? "s" : ""} left · live for {bank.weeks} weeks each
                    </p>
                  </div>
                  <button type="button" onClick={() => handleUseSlot(bank)} disabled={spendingId !== null}
                    style={{ padding: "0.45rem 1rem", borderRadius: 100, border: "none", background: "#2E7D32", color: "#fff", fontWeight: 600, fontSize: "0.78rem", cursor: spendingId ? "not-allowed" : "pointer", whiteSpace: "nowrap", opacity: spendingId && spendingId !== bank.id ? 0.5 : 1 }}>
                    {spendingId === bank.id ? "Using…" : "Use this slot — free"}
                  </button>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#aaa", margin: "0.6rem 0 0" }}>Or buy a new package below:</p>
        </div>
      )}

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
                  {pkg.ads} product{pkg.ads > 1 ? "s" : ""} · {pkg.label} each
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
        This payment covers &ldquo;{productName}&rdquo; now. If the package has more than 1 product slot, the
        rest are banked on your account — spend them on other products any time from My Shop, no extra charge.
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
