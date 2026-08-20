"use client";
// components/UpsellProductPicker.tsx
//
// Lets an artist or salon owner attach a small, curated set of their OWN
// products to a specific service as upsells — e.g. the hair oil they
// actually use for a silk press. Used inside both service-creation forms:
//   - PricedServicesManager (artist services)  — app/dashboard/page.tsx
//   - ServiceManager (salon services)          — app/dashboard/page.tsx
//
// This is deliberate and explicit (a service picks 2–4 specific products),
// layered on TOP of the existing tag-overlap "you might also like" system
// (services.tags / UPSELL_TAG_GROUPS, matched live at booking time in
// app/page.tsx) — not a replacement for it. Passing `serviceTags` here only
// changes which of the owner's own products get suggested first; it never
// restricts which products they can attach. Entirely optional — a service
// with nothing picked here just falls back to the existing tag matching,
// exactly as it worked before this component existed.
//
// The selection lives in the PARENT form's state (selectedProductIds +
// onChange) rather than being saved here directly — the service itself
// might not have an id yet (a brand-new, unsaved service), so persisting
// the join-table rows (service_upsell_products / salon_service_upsell_
// products) is the parent's job, done in the same submit that saves the
// service — see syncServiceUpsells() in app/dashboard/page.tsx.

import { useEffect, useState } from "react";
import ProductForm, { type ProductFormData } from "./ProductForm";
import { UPSELL_TAG_GROUPS } from "@/types";

interface OwnedProduct {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  tags: string[];
  is_active: boolean;
}

interface Props {
  ownerId: string; // profile id — whose products to show/create for
  serviceTags: string[]; // used only to sort suggestions first, see file header
  selectedProductIds: string[];
  onChange: (ids: string[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  maxSelected?: number;
}

export default function UpsellProductPicker({
  ownerId, serviceTags, selectedProductIds, onChange, supabase, maxSelected = 4,
}: Props) {
  const [products, setProducts] = useState<OwnedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("id, name, price, image_url, tags, is_active")
      .eq("partner_id", ownerId)
      .order("created_at", { ascending: false });
    setProducts((data ?? []) as OwnedProduct[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    if (selectedProductIds.includes(id)) {
      onChange(selectedProductIds.filter((x) => x !== id));
    } else if (selectedProductIds.length < maxSelected) {
      onChange([...selectedProductIds, id]);
    }
  };

  const handleProductCreated = (row: ProductFormData & { id: string }) => {
    setShowCreate(false);
    load();
    if (selectedProductIds.length < maxSelected) {
      onChange([...selectedProductIds, row.id]);
    }
  };

  const suggested = products.filter((p) => p.tags?.some((t) => serviceTags.includes(t)));
  const suggestedIds = new Set(suggested.map((p) => p.id));
  const rest = products.filter((p) => !suggestedIds.has(p.id));
  const visible = showAll ? [...suggested, ...rest] : suggested;
  const atMax = selectedProductIds.length >= maxSelected;

  const fmtR = (cents: number) => `R${(cents / 100).toFixed(0)}`;

  const row = (p: OwnedProduct) => {
    const checked = selectedProductIds.includes(p.id);
    const disabled = !checked && atMax;
    return (
      <label
        key={p.id}
        style={{
          display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.6rem",
          borderRadius: 10, border: `1.5px solid ${checked ? "var(--plum)" : "#E0E0E0"}`,
          background: checked ? "var(--plum-t)" : "#fff", cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(p.id)} style={{ accentColor: "var(--plum)" }} />
        {p.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "#F0F0F0", flexShrink: 0 }} />
        )}
        <span style={{ fontSize: "0.82rem", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
        <span style={{ fontSize: "0.78rem", color: "var(--grey)", flexShrink: 0 }}>{fmtR(p.price)}</span>
      </label>
    );
  };

  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>
        Upsell products for this service (optional — up to {maxSelected})
      </label>
      <p style={{ fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.5rem" }}>
        Shown to customers when they book this service. e.g. the hair oil you actually use for this style.
      </p>

      {loading ? (
        <p style={{ fontSize: "0.8rem", color: "var(--grey)" }}>Loading your products…</p>
      ) : products.length === 0 && !showCreate ? (
        <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.5rem" }}>
          You don&apos;t have any products yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.5rem" }}>
          {visible.map(row)}
          {!showAll && rest.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{ background: "none", border: "none", padding: "0.2rem 0", fontSize: "0.78rem", color: "var(--plum)", textDecoration: "underline", cursor: "pointer", textAlign: "left" }}
            >
              Show all my products ({rest.length} more)
            </button>
          )}
          {suggested.length === 0 && !showAll && products.length > 0 && (
            <p style={{ fontSize: "0.76rem", color: "var(--grey)" }}>
              Nothing matching this service&apos;s tags yet —{" "}
              <button type="button" onClick={() => setShowAll(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--plum)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                browse all your products
              </button> instead.
            </p>
          )}
        </div>
      )}

      {showCreate ? (
        <div style={{ marginTop: "0.5rem", padding: "1rem", borderRadius: 12, border: "1.5px dashed rgba(155,127,184,0.4)", background: "#fff" }}>
          <ProductForm
            partnerId={ownerId}
            supabase={supabase}
            skipVerify={false}
            initial={{
              id: undefined, name: "", description: "", price: "", category: serviceCategoryGuess(serviceTags),
              tags: serviceTags, stock_count: "1", product_type: "simple", variants: [],
              weight_g: "", length_cm: "", width_cm: "", height_cm: "", image_url: null,
            }}
            onSaved={handleProductCreated}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={atMax}
          style={{
            background: "none", border: "1.5px dashed rgba(155,127,184,0.5)", borderRadius: 10,
            padding: "0.5rem 0.9rem", fontSize: "0.8rem", color: "var(--plum)", cursor: atMax ? "not-allowed" : "pointer",
            opacity: atMax ? 0.5 : 1,
          }}
        >
          + Create a new product for this service
        </button>
      )}
    </div>
  );
}

// Best-effort guess at a starting category for a product created from
// within a service form — matches the tag group whose tags overlap most
// with the service's own tags, so the artist isn't stuck re-picking a
// category that's usually obvious from context. Just a starting value;
// ProductForm's own category field stays fully editable.
function serviceCategoryGuess(serviceTags: string[]): string {
  let best = "";
  let bestScore = 0;
  for (const group of UPSELL_TAG_GROUPS) {
    const score = group.tags.filter((t) => serviceTags.includes(t.id)).length;
    if (score > bestScore) { bestScore = score; best = group.category === "general" ? "" : group.category; }
  }
  return best;
}
