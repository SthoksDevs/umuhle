"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import ProductForm, { productToForm, type ProductFormData } from "@/components/ProductForm";
import ProductDeleteButton from "@/components/dashboard/ProductDeleteButton";

/**
 * UMUHLE DASHBOARD REFACTOR — BATCH 2A: PRODUCTS
 *
 * Extracted from app/dashboard/page.tsx on 2026-08-23.
 *
 * Current responsibilities:
 * - Load and manage the partner's products.
 * - Create/edit products through ProductForm.
 * - Toggle Live/Hidden state.
 * - Delete/remove products through the authenticated backend endpoint.
 *
 * CONTINUATION NOTE:
 * - ProductDeleteButton is the only deletion UI; do not reintroduce direct
 *   browser-side product deletion.
 * - Historical package/listing-status fields remain in the row type only for
 *   compatibility with existing database rows; products are free to list and
 *   no longer expire.
 * - Next dashboard refactor batch: extract Stores/CSV import, then Orders.
 */

interface PartnerProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  stock_count: number;
  is_active: boolean;
  moderation_status: string;
  created_at: string;
  partner_id: string;
  weight_g: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  sell_scope: "province" | "south_africa";
  sell_provinces: string[];
  package: string | null;
  listing_status: string | null;
  listing_package_id: string | null;
  starts_at: string | null;
  expires_at: string | null;
}

const fmtShop = (cents: number) => `R${(cents / 100).toFixed(0)}`;

// Free to list — the old paid Starter/Growth/Business/Premium package gate
// has been removed. Products are permanent until the owner removes them.
function ProductsManager({ user, partnerProvince }: { user: { id: string }; partnerProvince?: string | null }) {
  const supabase = createClient();

  const [products, setProducts] = useState<PartnerProductRow[]>([]);
  const [prodLoading, setProdLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<PartnerProductRow | null>(null);

  const loadProducts = useCallback(async () => {
    setProdLoading(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("partner_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setProducts((data ?? []) as PartnerProductRow[]);
    setProdLoading(false);
  }, [supabase, user.id]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handleSaved = (saved: ProductFormData & { id: string }, _wasNew: boolean) => {
    const toRow = (base: PartnerProductRow | undefined): PartnerProductRow => ({
      ...(base ?? {} as PartnerProductRow),
      id: saved.id,
      name: saved.name,
      description: saved.description || null,
      price: Math.round(Number(saved.price) * 100),
      category: saved.category || null,
      stock_count: parseInt(saved.stock_count) || 0,
      image_url: saved.image_url ?? base?.image_url ?? null,
      weight_g: saved.weight_g ? parseInt(saved.weight_g) : null,
      length_cm: saved.length_cm ? parseFloat(saved.length_cm) : null,
      width_cm: saved.width_cm ? parseFloat(saved.width_cm) : null,
      height_cm: saved.height_cm ? parseFloat(saved.height_cm) : null,
      sell_scope: saved.sell_scope,
      sell_provinces: saved.sell_scope === "province" ? saved.sell_provinces : [],
      is_active: base?.is_active ?? false,
      moderation_status: base?.moderation_status ?? "scanning",
      created_at: base?.created_at ?? new Date().toISOString(),
      partner_id: base?.partner_id ?? user.id,
      package: base?.package ?? null,
      listing_status: base?.listing_status ?? null,
      starts_at: base?.starts_at ?? null,
      expires_at: base?.expires_at ?? null,
      listing_package_id: base?.listing_package_id ?? null,
    });

    setProducts(prev => {
      const exists = prev.find(p => p.id === saved.id);
      if (exists) return prev.map(p => p.id === saved.id ? toRow(p) : p);
      return [toRow(undefined), ...prev];
    });
    setShowForm(false);
    setEditTarget(null);
  };

  const toggleActive = async (p: PartnerProductRow) => {
    await supabase.from("products").update({ is_active: !p.is_active }).eq("id", p.id);
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_active: !x.is_active } : x));
  };

  const handleDeleted = (productId: string) => {
    // Whether the backend physically deleted the row or safely removed it
    // from sale, it should disappear from this owner's current product list.
    setProducts(prev => prev.filter(product => product.id !== productId));
  };

  const modBadge = (p: PartnerProductRow) => {
    if (!p.is_active) {
      return (
        <span style={{ background: "#F5F5F5", color: "#757575", borderRadius: 100, padding: "0.2rem 0.65rem", fontSize: "0.7rem", fontWeight: 600 }}>
          Hidden
        </span>
      );
    }
    const map: Record<string, { bg: string; color: string; label: string }> = {
      approved: { bg: "#E8F5E9", color: "#2E7D32", label: "Live" },
      scanning: { bg: "#FFF3E0", color: "#E65100", label: "Under review" },
      draft: { bg: "#F5F5F5", color: "#757575", label: "Draft" },
      needs_review: { bg: "#FFF3E0", color: "#E65100", label: "Needs review" },
      rejected: { bg: "#FFEBEE", color: "#C62828", label: "Rejected" },
    };
    const s = map[p.moderation_status] ?? map.draft;
    return (
      <span style={{ background: s.bg, color: s.color, borderRadius: 100, padding: "0.2rem 0.65rem", fontSize: "0.7rem", fontWeight: 600 }}>
        {s.label}
      </span>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: 0, maxWidth: 480 }}>
          Listing a product is free — it goes through a quick review before it appears in the shop.
        </p>
        {!showForm && !editTarget && (
          <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.55rem 1.25rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
            + Add product
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ marginBottom: "1.5rem" }}>
          <ProductForm
            partnerId={user.id}
            supabase={supabase}
            skipVerify={false}
            defaultProvince={partnerProvince}
            onSaved={handleSaved}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {editTarget && (
        <div style={{ marginBottom: "1.5rem" }}>
          <ProductForm
            initial={productToForm(editTarget)}
            partnerId={user.id}
            supabase={supabase}
            skipVerify={false}
            isLive={editTarget.is_active && editTarget.moderation_status === "approved"}
            defaultProvince={partnerProvince}
            onSaved={handleSaved}
            onCancel={() => setEditTarget(null)}
          />
        </div>
      )}

      {prodLoading ? (
        <p style={{ color: "var(--grey)" }}>Loading products…</p>
      ) : products.length === 0 && !showForm ? (
        <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🛍️</div>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: "0.5rem" }}>No products yet</p>
          <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Add your first product — it's free — to start selling on Umuhle.</p>
          <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.75rem 2rem" }}>Add a product</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {products.map(p => (
            <div key={p.id} style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.12)", padding: "1rem 1.25rem", display: "flex", gap: "1rem", alignItems: "center" }}>
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 8, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: "1.4rem" }}>🛍️</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.1rem" }}>
                  <p style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>{p.name}</p>
                  {modBadge(p)}
                </div>
                <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>
                  {fmtShop(p.price)} · {p.stock_count} in stock · <span style={{ textTransform: "capitalize" }}>{p.category ?? "—"}</span>
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0, alignItems: "flex-start" }}>
                <button
                  onClick={() => { setEditTarget(p); setShowForm(false); }}
                  style={{ padding: "0.35rem 0.85rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--plum)", fontWeight: 500, fontSize: "0.78rem", cursor: "pointer" }}
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleActive(p)}
                  style={{ padding: "0.35rem 0.85rem", borderRadius: 100, border: "none", background: p.is_active ? "#E8F5E9" : "#F5F5F5", color: p.is_active ? "#2E7D32" : "#757575", fontWeight: 500, fontSize: "0.78rem", cursor: "pointer" }}
                >
                  {p.is_active ? "Live" : "Hidden"}
                </button>
                <ProductDeleteButton
                  productId={p.id}
                  productName={p.name}
                  onDeleted={() => handleDeleted(p.id)}
                  style={{ padding: "0.35rem 0.85rem", borderRadius: 100, border: "1.5px solid #E8B4B4", color: "#C62828", background: "#fff" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProductsManager;
