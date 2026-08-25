"use client";
// components/ProductForm.tsx
// Shared product add/edit form used in:
//   - app/dashboard/page.tsx  (store owners — saves with moderation_status: "scanning")
//   - app/admin/page.tsx      (superadmin Umuhle products — saves with moderation_status: "approved")
//
// Props:
//   initial      — existing product to edit, or null to add new
//   partnerId    — the owner's user ID
//   supabase     — client instance
//   skipVerify   — if true, sets moderation_status: "approved" and is_active: true immediately
//   onSaved      — called with the saved row after insert/update
//   onCancel     — called when user clicks Cancel

import { useState } from "react";
import { UPSELL_TAG_GROUPS, SA_PROVINCES } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProductType = "simple" | "variable";

export interface ProductVariant {
  id?: string;          // present on existing variants
  label: string;        // e.g. "250ml", "Black / S"
  price: string;        // rand string, e.g. "149.99"
  stock_count: string;
  sku: string;
}

export interface ProductFormData {
  id?: string;
  name: string;
  description: string;
  price: string;          // rand — only used for simple products
  category: string;
  tags: string[];          // upsell tags — drives "you might also like" on the booking form
  stock_count: string;    // only used for simple products
  product_type: ProductType;
  variants: ProductVariant[];
  weight_g: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  image_url?: string | null;
  // ── Local delivery & provincial sales ──
  // "province" ships only within sell_provinces (or the seller's own home
  // province if left empty — see the placeholder copy below); "south_africa"
  // ships nationwide. Enforced server-side for courier orders in
  // lib/orders.ts's createPendingOrder.
  sell_scope: "province" | "south_africa";
  sell_provinces: string[];
}

const CATEGORIES = ["hair", "nails", "makeup", "lashes", "skincare", "tools", "other"];

const emptyVariant = (): ProductVariant => ({
  label: "", price: "", stock_count: "0", sku: "",
});

const emptyForm = (): ProductFormData => ({
  name: "", description: "", price: "", category: "hair", tags: [],
  stock_count: "0", product_type: "simple", variants: [],
  weight_g: "", length_cm: "", width_cm: "", height_cm: "",
  image_url: null,
  sell_scope: "south_africa", sell_provinces: [],
});

export function productToForm(p: {
  id: string; name: string; description: string | null; price: number;
  category: string | null; tags?: string[] | null; stock_count: number; image_url: string | null;
  product_type?: string | null;
  weight_g?: number | null; length_cm?: number | null;
  width_cm?: number | null; height_cm?: number | null;
  sell_scope?: string | null; sell_provinces?: string[] | null;
  product_variants?: Array<{
    id: string; label: string; price: number; stock_count: number; sku: string | null;
  }> | null;
}): ProductFormData {
  return {
    id:           p.id,
    name:         p.name,
    description:  p.description ?? "",
    price:        (p.price / 100).toFixed(2),
    category:     p.category ?? "hair",
    tags:         p.tags ?? [],
    stock_count:  String(p.stock_count),
    product_type: (p.product_type as ProductType) ?? "simple",
    variants:     (p.product_variants ?? []).map(v => ({
      id:          v.id,
      label:       v.label,
      price:       (v.price / 100).toFixed(2),
      stock_count: String(v.stock_count),
      sku:         v.sku ?? "",
    })),
    weight_g:     p.weight_g  != null ? String(p.weight_g)  : "",
    length_cm:    p.length_cm != null ? String(p.length_cm) : "",
    width_cm:     p.width_cm  != null ? String(p.width_cm)  : "",
    height_cm:    p.height_cm != null ? String(p.height_cm) : "",
    image_url:    p.image_url,
    sell_scope:      (p.sell_scope as "province" | "south_africa") ?? "south_africa",
    sell_provinces:  p.sell_provinces ?? [],
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  initial?:    ProductFormData | null;
  partnerId:   string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any;
  skipVerify?: boolean;
  isLive?:     boolean;
  // wasNew is true only for a fresh insert (vs. an edit) — listing is free
  // for everyone now (see 2026-08 removal of the paid listing packages),
  // so callers no longer need to branch on this for payment purposes, but
  // it's kept since e.g. UpsellProductPicker uses it to know whether to
  // auto-select the just-created product.
  onSaved:     (row: ProductFormData & { id: string }, wasNew: boolean) => void;
  onCancel?:   () => void;
  // Seller's own profiles.province, if set — used only to pre-check that
  // one box the first time a brand-new product switches to "province"
  // scope. Never overrides an existing product's already-saved
  // sell_provinces.
  defaultProvince?: string | null;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export default function ProductForm({
  initial, partnerId, supabase, skipVerify = false, isLive = false, onSaved, onCancel,
  defaultProvince = null,
}: Props) {
  const [form,         setForm]         = useState<ProductFormData>(initial ?? emptyForm());
  const [imageFile,    setImageFile]    = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(initial?.image_url ?? "");
  const [imageError,   setImageError]   = useState("");
  const [isDragging,   setIsDragging]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");

  const isEdit     = Boolean(form.id);
  const isVariable = form.product_type === "variable";

  // ── Styles ─────────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.75rem 1rem", borderRadius: 12,
    border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box",
    background: "#fff",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.78rem", fontWeight: 600,
    color: "#888", marginBottom: "0.3rem", marginTop: "0.85rem",
  };
  const sectionLabel: React.CSSProperties = {
    ...labelStyle, marginTop: "1.5rem", color: "#9B7FB8",
    textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.72rem",
  };
  const smallInputStyle: React.CSSProperties = {
    ...inputStyle, padding: "0.55rem 0.75rem", fontSize: "0.85rem",
  };

  // ── Variant helpers ─────────────────────────────────────────────────────────

  const addVariant = () =>
    setForm(f => ({ ...f, variants: [...f.variants, emptyVariant()] }));

  const removeVariant = (i: number) =>
    setForm(f => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }));

  const updateVariant = (i: number, patch: Partial<ProductVariant>) =>
    setForm(f => ({
      ...f,
      variants: f.variants.map((v, idx) => idx === i ? { ...v, ...patch } : v),
    }));

  // ── Image ───────────────────────────────────────────────────────────────────

  const acceptImageFile = (f: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
      setImageError("Only PNG, JPG, or WEBP images are allowed.");
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setImageError("Image must be smaller than 2MB.");
      return;
    }
    setImageError("");
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    acceptImageFile(f);
    // allow re-selecting the same file later
    e.target.value = "";
  };

  const handleImageDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const f = e.dataTransfer.files?.[0];
    if (!f) return;

    acceptImageFile(f);
  };

  const handleImageDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleImageDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = (): string | null => {
    if (!form.name.trim()) return "Product name is required.";
    if (!isVariable) {
      if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 35)
        return "Price must be at least R35.";
    } else {
      if (form.variants.length === 0)
        return "Add at least one variant (e.g. size or colour).";
      for (const v of form.variants) {
        if (!v.label.trim()) return "All variants need a label (e.g. \"250ml\").";
        if (!v.price || isNaN(Number(v.price)) || Number(v.price) < 35)
          return "All variants need a price of at least R35.";
      }
    }
    return null;
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const validationErr = validate();
    if (validationErr) { setError(validationErr); return; }
    setError("");
    setSaving(true);

    try {
      // Upload image to the "product-images" bucket
      let imageUrl: string | null = form.image_url ?? null;
      if (imageFile) {
        const ext  = imageFile.name.split(".").pop();
        const folder = skipVerify ? "umuhle-products" : "partner-products";
        const path = `${folder}/${partnerId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("product-images")
          .upload(path, imageFile, { upsert: false });
        if (uploadErr) throw uploadErr;
        const { data: { publicUrl } } = supabase.storage
          .from("product-images")
          .getPublicUrl(path);
        imageUrl = publicUrl;
      }

      // For simple products, price comes from the form.
      // For variable products, set price = lowest variant price (for display/sorting).
      const basePrice = isVariable
        ? Math.min(...form.variants.map(v => Math.round(Number(v.price) * 100)))
        : Math.round(Number(form.price) * 100);

      const baseStock = isVariable
        ? form.variants.reduce((sum, v) => sum + (parseInt(v.stock_count) || 0), 0)
        : parseInt(form.stock_count) || 0;

      const payload = {
        partner_id:        partnerId,
        name:              form.name.trim(),
        description:       form.description.trim() || null,
        price:             basePrice,
        category:          form.category,
        tags:              form.tags,
        stock_count:       baseStock,
        product_type:      form.product_type,
        image_url:         imageUrl,
        weight_g:          form.weight_g   ? parseInt(form.weight_g)    : null,
        length_cm:         form.length_cm  ? parseFloat(form.length_cm) : null,
        width_cm:          form.width_cm   ? parseFloat(form.width_cm)  : null,
        height_cm:         form.height_cm  ? parseFloat(form.height_cm) : null,
        sell_scope:        form.sell_scope,
        // A "province" product with no provinces ticked falls back to the
        // seller's own home province at enforcement time (lib/orders.ts) —
        // so it's fine to save an empty array here rather than force a pick.
        sell_provinces:    form.sell_scope === "province" ? form.sell_provinces : [],
        moderation_status: skipVerify ? "approved" : "scanning",
        is_active:         skipVerify,
      };

      let data, err;
      if (isEdit && form.id) {
        // Editing never touches moderation_status/is_active for a partner's
        // own product — a partner tidying up a description shouldn't reset
        // it back into the review queue.
        const updatePayload = skipVerify
          ? payload
          : { ...payload, moderation_status: undefined, is_active: undefined };
        ({ data, error: err } = await supabase
          .from("products").update(updatePayload).eq("id", form.id).select().single());
      } else {
        // Brand-new product — free to list (see 2026-08 removal of the
        // paid listing fee). moderation_status/is_active above already
        // handle the review gate; nothing further needed here.
        ({ data, error: err } = await supabase
          .from("products").insert(payload).select().single());
      }
      if (err) throw err;

      const productId: string = data.id;

      // Upsert variants for variable products
      if (isVariable) {
        // Delete variants that were removed (on edit)
        if (isEdit) {
          const keptIds = form.variants.filter(v => v.id).map(v => v.id!);
          if (keptIds.length > 0) {
            await supabase
              .from("product_variants")
              .delete()
              .eq("product_id", productId)
              .not("id", "in", `(${keptIds.join(",")})`);
          } else {
            await supabase.from("product_variants").delete().eq("product_id", productId);
          }
        }

        for (const v of form.variants) {
          const variantPayload = {
            product_id:  productId,
            label:       v.label.trim(),
            price:       Math.round(Number(v.price) * 100),
            stock_count: parseInt(v.stock_count) || 0,
            sku:         v.sku.trim() || null,
          };
          if (v.id) {
            await supabase.from("product_variants").update(variantPayload).eq("id", v.id);
          } else {
            const { data: newV, error: vErr } = await supabase
              .from("product_variants").insert(variantPayload).select().single();
            if (vErr) throw vErr;
            v.id = newV.id;
          }
        }
      } else if (isEdit) {
        // Switching from variable to simple — remove all variants
        await supabase.from("product_variants").delete().eq("product_id", productId);
      }

      // IMPORTANT: do NOT spread raw DB \`data\` here — it contains price in cents,
      // which would overwrite form.price (rand string) and cause a double ×100 in
      // the caller's handleSaved. Only carry form values forward + the authoritative id.
      onSaved({ ...form, id: productId }, !isEdit && !skipVerify);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.15rem", marginBottom: "0.25rem" }}>
        {isEdit ? "Edit product" : skipVerify ? "New Umuhle Product" : "Add product"}
      </h3>
      {!skipVerify && !isEdit && (
        <p style={{ fontSize: "0.78rem", color: "#888", marginBottom: "0.75rem" }}>
          Next you&apos;ll choose a listing package (from R20 for 6 weeks) and pay — then it&apos;s reviewed before appearing in the shop.
        </p>
      )}

      {/* ── Product name & description ── */}
      <label style={labelStyle}>Product name *</label>
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="e.g. Argan Oil Treatment" style={inputStyle} />

      <label style={labelStyle}>Description</label>
      <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        placeholder="Describe the product…" rows={3}
        style={{ ...inputStyle, resize: "vertical" }} />

      {/* ── Category ── */}
      <div style={{ marginTop: "0.85rem" }}>
        <label style={{ ...labelStyle, marginTop: 0 }}>Category</label>
        <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          style={inputStyle}>
          {CATEGORIES.map(c => (
            <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>
          ))}
        </select>
      </div>

      {/* ── Upsell tags — which services should this product be suggested alongside? ── */}
      <div style={{ marginTop: "0.85rem" }}>
        <label style={{ ...labelStyle, marginTop: 0 }}>Suggest this product for…</label>
        <p style={{ fontSize: "0.78rem", color: "#8a8a8a", margin: "0 0 0.5rem" }}>
          Pick what this product is relevant to. It&apos;ll be offered to clients booking a matching service — e.g. tag extensions/wigs for a weave-install, not haircare for a big chop.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {UPSELL_TAG_GROUPS.map(group => (
            <div key={group.category}>
              <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#a0a0a0", textTransform: "uppercase", letterSpacing: "0.04em" }}>{group.label}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.3rem" }}>
                {group.tags.map(t => {
                  const on = form.tags.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, tags: on ? f.tags.filter(x => x !== t.id) : [...f.tags, t.id] }))}
                      style={{
                        borderRadius: 100, border: `1.5px solid ${on ? "var(--plum)" : "#E0E0E0"}`,
                        background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "#555",
                        padding: "0.3rem 0.75rem", fontSize: "0.78rem", fontWeight: 500, cursor: "pointer",
                      }}
                    >{t.label}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Product type radios ── */}
      <label style={sectionLabel}>Product type</label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.4rem" }}>
        {(["simple", "variable"] as ProductType[]).map(t => (
          <label key={t}
            style={{
              display: "flex", alignItems: "center", gap: "0.75rem",
              padding: "0.65rem 1rem", borderRadius: 14, cursor: "pointer",
              border: `1.5px solid ${form.product_type === t ? "var(--plum)" : "rgba(155,127,184,0.25)"}`,
              background: form.product_type === t ? "var(--plum-t)" : "#fff",
            }}>
            <input
              type="radio"
              name="product_type"
              value={t}
              checked={form.product_type === t}
              onChange={() => setForm(f => ({ ...f, product_type: t }))}
              style={{ width: 16, height: 16, accentColor: "var(--plum)", flexShrink: 0 }}
            />
            <span style={{
              fontWeight: form.product_type === t ? 600 : 400,
              fontSize: "0.85rem",
              color: form.product_type === t ? "var(--plum)" : "var(--grey)",
            }}>
              {t === "simple" ? "Simple (one price)" : "Variable (sizes / colours)"}
            </span>
          </label>
        ))}
      </div>

      {/* ── Simple: price + stock */}
      {!isVariable && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.85rem" }}>
          <div>
            <label style={{ ...labelStyle, marginTop: 0 }}>Price (R) * — R35 minimum</label>
            <input type="number" min="35" step="0.01" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              placeholder="149.99" style={inputStyle} />
          </div>
          <div>
            <label style={{ ...labelStyle, marginTop: 0 }}>Stock count</label>
            <input type="number" min="0" value={form.stock_count}
              onChange={e => setForm(f => ({ ...f, stock_count: e.target.value }))}
              style={inputStyle} />
          </div>
        </div>
      )}

      {/* ── Variable: variants repeater */}
      {isVariable && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "0.78rem", color: "#aaa", margin: "0 0 0.75rem" }}>
            Add a row per variation — e.g. by size (250ml / 500ml) or colour.
          </p>

          {/* Header row */}
          {form.variants.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.2fr 32px", gap: "0.5rem", marginBottom: "0.35rem" }}>
              {["Label *", "Price (R) * — min R35", "Stock", "SKU (optional)", ""].map((h, i) => (
                <span key={i} style={{ fontSize: "0.7rem", fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</span>
              ))}
            </div>
          )}

          {form.variants.map((v, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.2fr 32px", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" }}>
              <input value={v.label} placeholder="e.g. 250ml"
                onChange={e => updateVariant(i, { label: e.target.value })}
                style={smallInputStyle} />
              <input type="number" min="35" step="0.01" value={v.price} placeholder="49.99"
                onChange={e => updateVariant(i, { price: e.target.value })}
                style={smallInputStyle} />
              <input type="number" min="0" value={v.stock_count}
                onChange={e => updateVariant(i, { stock_count: e.target.value })}
                style={smallInputStyle} />
              <input value={v.sku} placeholder="optional"
                onChange={e => updateVariant(i, { sku: e.target.value })}
                style={smallInputStyle} />
              <button type="button" onClick={() => removeVariant(i)}
                style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #FFCDD2", background: "#FFF5F5", color: "#E53935", cursor: "pointer", fontWeight: 700, fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                ×
              </button>
            </div>
          ))}

          <button type="button" onClick={addVariant}
            style={{ marginTop: "0.25rem", padding: "0.5rem 1.1rem", borderRadius: 100, border: "1.5px dashed rgba(155,127,184,0.5)", background: "transparent", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", fontWeight: 500 }}>
            + Add variant
          </button>
        </div>
      )}

      {/* ── Product dimensions ── */}
      <label style={sectionLabel}>Dimensions</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.75rem", marginTop: "0.5rem" }}>
        <div>
          <label style={labelStyle}>Weight (g)</label>
          <input type="number" min="0" value={form.weight_g}
            onChange={e => setForm(f => ({ ...f, weight_g: e.target.value }))}
            placeholder="250" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Length (cm)</label>
          <input type="number" min="0" step="0.1" value={form.length_cm}
            onChange={e => setForm(f => ({ ...f, length_cm: e.target.value }))}
            placeholder="15" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Width (cm)</label>
          <input type="number" min="0" step="0.1" value={form.width_cm}
            onChange={e => setForm(f => ({ ...f, width_cm: e.target.value }))}
            placeholder="8" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Height (cm)</label>
          <input type="number" min="0" step="0.1" value={form.height_cm}
            onChange={e => setForm(f => ({ ...f, height_cm: e.target.value }))}
            placeholder="5" style={inputStyle} />
        </div>
      </div>

      {/* ── Sell To (local delivery & provincial sales) ── */}
      <label style={sectionLabel}>Sell to</label>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.5rem" }}>
        {([
          { value: "south_africa" as const, title: "Whole of South Africa", sub: "Ships nationwide" },
          { value: "province"     as const, title: "Selected provinces",    sub: "Only within provinces you pick" },
        ]).map(opt => (
          <button key={opt.value} type="button"
            onClick={() => setForm(f => ({
              ...f,
              sell_scope: opt.value,
              // First time a fresh product flips to "province", default to
              // the seller's own home province rather than leaving it blank
              // (an empty list already falls back to the seller's province
              // at enforcement time, but pre-ticking it makes that explicit
              // and lets them add more from there).
              sell_provinces:
                opt.value === "province" && f.sell_provinces.length === 0 && defaultProvince
                  ? [defaultProvince]
                  : f.sell_provinces,
            }))}
            style={{
              flex: 1, textAlign: "left", padding: "0.7rem 0.9rem", borderRadius: 12, cursor: "pointer",
              border: form.sell_scope === opt.value ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
              background: form.sell_scope === opt.value ? "rgba(155,127,184,0.08)" : "#fff",
            }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: form.sell_scope === opt.value ? "var(--plum)" : "#333" }}>
              {opt.title}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#999", marginTop: "0.15rem" }}>{opt.sub}</div>
          </button>
        ))}
      </div>

      {form.sell_scope === "province" && (
        <div style={{ marginTop: "0.6rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
            {SA_PROVINCES.map(prov => {
              const checked = form.sell_provinces.includes(prov);
              return (
                <label key={prov}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.4rem",
                    padding: "0.45rem 0.6rem", borderRadius: 10, cursor: "pointer",
                    border: checked ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
                    background: checked ? "rgba(155,127,184,0.08)" : "#fff",
                    fontSize: "0.78rem", color: checked ? "var(--plum)" : "#555",
                  }}>
                  <input type="checkbox" checked={checked}
                    onChange={() => setForm(f => ({
                      ...f,
                      sell_provinces: checked
                        ? f.sell_provinces.filter(p => p !== prov)
                        : [...f.sell_provinces, prov],
                    }))}
                    style={{ margin: 0 }} />
                  {prov}
                </label>
              );
            })}
          </div>
          {form.sell_provinces.length === 0 && (
            <p style={{ fontSize: "0.75rem", color: "#999", marginTop: "0.4rem" }}>
              {defaultProvince
                ? `No provinces picked yet — this will ship only within ${defaultProvince} until you tick some above.`
                : "No provinces picked yet — set your fulfillment address in Profile settings so this has a default, or tick provinces above."}
            </p>
          )}
        </div>
      )}

      {/* ── Product image ── */}
      <label style={sectionLabel}>Product image</label>
      <div style={{ marginTop: "0.5rem" }}>
        <label
          onDrop={handleImageDrop}
          onDragOver={handleImageDragOver}
          onDragLeave={handleImageDragLeave}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "0.5rem", textAlign: "center", cursor: "pointer",
            padding: imagePreview ? "1rem" : "1.75rem 1rem",
            borderRadius: 14,
            border: `1.5px dashed ${isDragging ? "var(--plum)" : "rgba(155,127,184,0.4)"}`,
            background: isDragging ? "var(--plum-t)" : "#FAFAFA",
            transition: "background 0.15s, border-color 0.15s",
          }}
        >
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt=""
              style={{ width: 80, height: 80, borderRadius: 10, objectFit: "cover", display: "block" }} />
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9B7FB8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
          <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--plum)" }}>
            {imagePreview ? "Click or drop to replace image" : "Drag & drop an image, or click to browse"}
          </span>
          <span style={{ fontSize: "0.72rem", color: "#aaa" }}>PNG, JPG or WEBP · Max 2MB</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} style={{ display: "none" }} />
        </label>
        {imageError && (
          <p style={{ color: "#E53935", fontSize: "0.78rem", marginTop: "0.4rem" }}>{imageError}</p>
        )}
      </div>

      {/* ── Live status warning ── */}
      {isEdit && isLive && (
        <div style={{
          background: "#FFF0F0", border: "1.5px solid #FFCDD2", borderRadius: 12,
          padding: "0.85rem 1rem", marginTop: "1.25rem",
        }}>
          <p style={{ color: "#C62828", fontSize: "0.82rem", fontWeight: 500, margin: 0 }}>
            This product is currently live. Saving changes will void its live status and send it back for review before it&apos;s visible in the shop again.
          </p>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <p style={{ color: "#E53935", fontSize: "0.85rem", marginTop: "0.75rem", background: "#FFF0F0", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          {error}
        </p>
      )}

      {/* ── Actions ── */}
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
        {onCancel && (
          <button type="button" onClick={onCancel}
            style={{ flex: 1, padding: "0.75rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--grey)", fontSize: "0.9rem", cursor: "pointer" }}>
            Cancel
          </button>
        )}
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="btn-plum"
          style={{ flex: 2, padding: "0.75rem", borderRadius: 100, fontSize: "0.9rem", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving…" : isEdit ? "Save changes" : skipVerify ? "Publish product" : "Continue to listing package →"}
        </button>
      </div>
    </div>
  );
}
