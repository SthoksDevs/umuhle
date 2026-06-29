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
import { createClient } from "@supabase/supabase-js";

export interface ProductFormData {
  id?: string;
  name: string;
  description: string;
  price: string;           // rand, e.g. "149.99"
  category: string;
  stock_count: string;
  weight_g: string;        // grams
  length_cm: string;
  width_cm: string;
  height_cm: string;
  image_url?: string | null;
}

const CATEGORIES = ["hair", "nails", "makeup", "lashes", "skincare", "tools", "other"];

const emptyForm = (): ProductFormData => ({
  name: "", description: "", price: "", category: "hair",
  stock_count: "0", weight_g: "", length_cm: "", width_cm: "", height_cm: "",
  image_url: null,
});

export function productToForm(p: {
  id: string; name: string; description: string | null; price: number;
  category: string | null; stock_count: number; image_url: string | null;
  weight_g?: number | null; length_cm?: number | null;
  width_cm?: number | null; height_cm?: number | null;
}): ProductFormData {
  return {
    id:          p.id,
    name:        p.name,
    description: p.description ?? "",
    price:       (p.price / 100).toFixed(2),
    category:    p.category ?? "hair",
    stock_count: String(p.stock_count),
    weight_g:    p.weight_g != null ? String(p.weight_g) : "",
    length_cm:   p.length_cm != null ? String(p.length_cm) : "",
    width_cm:    p.width_cm  != null ? String(p.width_cm)  : "",
    height_cm:   p.height_cm != null ? String(p.height_cm) : "",
    image_url:   p.image_url,
  };
}

interface Props {
  initial?:    ProductFormData | null;
  partnerId:   string;
  // Accept either a typed Supabase client or any compatible object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any;
  skipVerify?: boolean;   // true = admin path, publishes immediately
  onSaved:     (row: ProductFormData & { id: string }) => void;
  onCancel?:   () => void;
}

export default function ProductForm({ initial, partnerId, supabase, skipVerify = false, onSaved, onCancel }: Props) {
  const [form,         setForm]         = useState<ProductFormData>(initial ?? emptyForm());
  const [imageFile,    setImageFile]    = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(initial?.image_url ?? "");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");

  const isEdit = Boolean(form.id);

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
    ...labelStyle, marginTop: "1.25rem", color: "#9B7FB8",
    textTransform: "uppercase", letterSpacing: "0.06em",
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    setError("");
    if (!form.name.trim()) { setError("Product name is required."); return; }
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) {
      setError("A valid price is required."); return;
    }

    setSaving(true);
    try {
      // Upload new image if provided
      let imageUrl: string | null = form.image_url ?? null;
      if (imageFile) {
        const ext  = imageFile.name.split(".").pop();
        const path = `${skipVerify ? "umuhle-products" : "partner-products"}/${partnerId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("products")
          .upload(path, imageFile, { upsert: false });
        if (uploadErr) throw uploadErr;
        const { data: { publicUrl } } = supabase.storage.from("products").getPublicUrl(path);
        imageUrl = publicUrl;
      }

      const payload = {
        partner_id:        partnerId,
        name:              form.name.trim(),
        description:       form.description.trim() || null,
        price:             Math.round(Number(form.price) * 100),
        category:          form.category,
        stock_count:       parseInt(form.stock_count) || 0,
        image_url:         imageUrl,
        weight_g:          form.weight_g   ? parseInt(form.weight_g)      : null,
        length_cm:         form.length_cm  ? parseFloat(form.length_cm)   : null,
        width_cm:          form.width_cm   ? parseFloat(form.width_cm)    : null,
        height_cm:         form.height_cm  ? parseFloat(form.height_cm)   : null,
        moderation_status: skipVerify ? "approved" : "scanning",
        is_active:         skipVerify,
      };

      let data, err;
      if (isEdit && form.id) {
        // On edit, don't overwrite moderation_status if not admin
        const updatePayload = skipVerify
          ? payload
          : { ...payload, moderation_status: undefined, is_active: undefined };
        ({ data, error: err } = await supabase
          .from("products").update(updatePayload).eq("id", form.id).select().single());
      } else {
        ({ data, error: err } = await supabase
          .from("products").insert(payload).select().single());
      }
      if (err) throw err;

      onSaved({ ...form, ...data, id: data.id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.15rem", marginBottom: "0.25rem" }}>
        {isEdit ? "Edit product" : skipVerify ? "New Umuhle Product" : "Add product"}
      </h3>
      {!skipVerify && !isEdit && (
        <p style={{ fontSize: "0.78rem", color: "#888", marginBottom: "0.75rem" }}>
          Your product will be reviewed before appearing in the shop.
        </p>
      )}

      {/* Basic info */}
      <label style={labelStyle}>Product name *</label>
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="e.g. Argan Oil Treatment" style={inputStyle} />

      <label style={labelStyle}>Description</label>
      <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        placeholder="Describe the product…" rows={3}
        style={{ ...inputStyle, resize: "vertical" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label style={labelStyle}>Price (R) *</label>
          <input type="number" min="0" step="0.01" value={form.price}
            onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
            placeholder="149.99" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Category</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            style={{ ...inputStyle }}>
            {CATEGORIES.map(c => (
              <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Stock count</label>
          <input type="number" min="0" value={form.stock_count}
            onChange={e => setForm(f => ({ ...f, stock_count: e.target.value }))}
            style={inputStyle} />
        </div>
      </div>

      {/* Delivery dimensions */}
      <label style={sectionLabel}>📦 Delivery dimensions</label>
      <p style={{ fontSize: "0.75rem", color: "#aaa", marginBottom: "0.5rem" }}>
        Required by courier services (e.g. Bob Go, Pargo) to calculate shipping rates.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label style={labelStyle}>Weight (g)</label>
          <input type="number" min="0" value={form.weight_g}
            onChange={e => setForm(f => ({ ...f, weight_g: e.target.value }))}
            placeholder="e.g. 250" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Length (cm)</label>
          <input type="number" min="0" step="0.1" value={form.length_cm}
            onChange={e => setForm(f => ({ ...f, length_cm: e.target.value }))}
            placeholder="e.g. 15" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Width (cm)</label>
          <input type="number" min="0" step="0.1" value={form.width_cm}
            onChange={e => setForm(f => ({ ...f, width_cm: e.target.value }))}
            placeholder="e.g. 8" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Height (cm)</label>
          <input type="number" min="0" step="0.1" value={form.height_cm}
            onChange={e => setForm(f => ({ ...f, height_cm: e.target.value }))}
            placeholder="e.g. 5" style={inputStyle} />
        </div>
      </div>

      {/* Product image */}
      <label style={labelStyle}>Product image</label>
      {imagePreview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagePreview} alt="" style={{ width: 80, height: 80, borderRadius: 10, objectFit: "cover", marginBottom: 8, display: "block" }} />
      )}
      <input type="file" accept="image/*" onChange={handleImageChange} style={{ fontSize: "0.85rem" }} />

      {error && (
        <p style={{ color: "#E53935", fontSize: "0.85rem", marginTop: "0.75rem", background: "#FFF0F0", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
        {onCancel && (
          <button onClick={onCancel}
            style={{ flex: 1, padding: "0.75rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--grey)", fontSize: "0.9rem", cursor: "pointer" }}>
            Cancel
          </button>
        )}
        <button onClick={handleSubmit} disabled={saving}
          className="btn-plum"
          style={{ flex: 2, padding: "0.75rem", borderRadius: 100, fontSize: "0.9rem", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving…" : isEdit ? "Save changes" : skipVerify ? "Publish product" : "Submit for review"}
        </button>
      </div>
    </div>
  );
}