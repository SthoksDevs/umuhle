"use client";

// components/dashboard/MyServicesTab.tsx
//
// The "Services" section of My Business: an artist's own bookable, priced
// service catalog (as opposed to MySalonTab.tsx's store-level services,
// which belong to a partner's branch listing). Split out of the old
// app/dashboard/page.tsx monolith — see docs/role-based-dashboards-status.md.

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import { UPSELL_TAG_GROUPS, upsellTagLabel } from "@/types";
import UpsellProductPicker from "@/components/UpsellProductPicker";
import { syncServiceUpsells, loadServiceUpsellIds } from "@/lib/upsells";
import { fmt } from "@/lib/dashboard/format";

const SERVICE_TYPES = [
  { id: "hair",   label: "Hair",  banner: "/banners/hair.jpg",   description: "From protective styles to blowouts, braids to colour — let clients know exactly what you specialise in." },
  { id: "nails",  label: "Nails",  banner: "/banners/nails.jpg",  description: "Gels, acrylics, nail art, manicures and more — list every nail style you offer so clients can find you." },
  { id: "makeup", label: "Makeup",  banner: "/banners/makeup.jpg", description: "Bridal, editorial, glam, natural — describe the makeup looks you create." },
  { id: "lashes", label: "Lashes",  banner: "/banners/lashes.jpg", description: "Classic, hybrid, volume, mega volume — tell clients which lash styles you do." },
] as const;

type ServiceTypeId = typeof SERVICE_TYPES[number]["id"];

// ─── My Services tab ───────────────────────────────────────────────────────────
// Each service category has a repeater for style + price pairs. Saving here
// writes both to artist_service_styles (search tags) and services (the
// priced, bookable rows the frontend booking widget actually reads) in one
// step — price is captured at the moment a service is added, not after.
type StyleEntry = { style: string; priceRand: string; tags: string[] };
type ServiceStyles = Record<ServiceTypeId, StyleEntry[]>;

type ArtistService = {
  id: string;
  name: string;
  description: string | null;
  price: number; // cents
  duration_minutes: number;
  category: ServiceTypeId | null;
  tags: string[];
  is_active: boolean;
};

type ServiceFormState = {
  id: string | null; // null = creating new
  name: string;
  description: string;
  priceRand: string; // controlled input, e.g. "350"
  duration_minutes: number;
  category: ServiceTypeId | "";
  tags: string[];
  upsellProductIds: string[]; // see components/UpsellProductPicker.tsx
};

const EMPTY_SERVICE_FORM: ServiceFormState = { id: null, name: "", description: "", priceRand: "", duration_minutes: 60, category: "", tags: [], upsellProductIds: [] };

// Lets an artist create the actual bookable, priced line items clients pay
// for — distinct from the style tags above, which are just search/discovery
// metadata. Reads/writes app/dashboard's `services` table directly (RLS
// already scopes writes to `artist_id IN (artists owned by auth.uid())`).
function PricedServicesManager({ user, categories, refreshSignal }: { user: User; categories: ServiceTypeId[]; refreshSignal?: number }) {
  const supabase = createClient();
  const [artistId, setArtistId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ArtistService[]>([]);
  const [form, setForm] = useState<ServiceFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadServices = useCallback(async (aid: string) => {
    const { data } = await supabase
      .from("services")
      .select("id, name, description, price, duration_minutes, category, tags, is_active")
      .eq("artist_id", aid)
      .order("name");
    setServices((data ?? []) as ArtistService[]);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("artists").select("id").eq("profile_id", user.id).maybeSingle();
      if (cancelled) return;
      if (data?.id) {
        setArtistId(data.id);
        await loadServices(data.id);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user.id, supabase, loadServices, refreshSignal]);

  const startAdd = () => { setError(""); setForm({ ...EMPTY_SERVICE_FORM, category: categories[0] ?? "" }); };
  const startEdit = async (s: ArtistService) => {
    setError("");
    setForm({ id: s.id, name: s.name, description: s.description ?? "", priceRand: String(s.price / 100), duration_minutes: s.duration_minutes, category: s.category ?? "", tags: s.tags ?? [], upsellProductIds: [] });
    const ids = await loadServiceUpsellIds(supabase, "service_upsell_products", "service_id", s.id);
    setForm((f) => f && f.id === s.id ? { ...f, upsellProductIds: ids } : f);
  };

  const handleSaveForm = async () => {
    if (!artistId || !form) return;
    const priceNum = parseFloat(form.priceRand);
    if (!form.name.trim()) { setError("Give the service a name."); return; }
    if (!Number.isFinite(priceNum) || priceNum < 35) { setError("Price must be at least R35."); return; }
    if (!form.duration_minutes || form.duration_minutes <= 0) { setError("Enter a valid duration."); return; }

    setSaving(true); setError("");
    const payload = {
      artist_id: artistId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Math.round(priceNum * 100),
      duration_minutes: form.duration_minutes,
      category: form.category || null,
      tags: form.tags,
    };
    const { data: saved, error: err } = form.id
      ? await supabase.from("services").update(payload).eq("id", form.id).select("id").single()
      : await supabase.from("services").insert({ ...payload, is_active: true }).select("id").single();
    if (err || !saved) { setSaving(false); setError(err?.message ?? "Failed to save"); return; }
    await syncServiceUpsells(supabase, "service_upsell_products", "service_id", saved.id, form.upsellProductIds);
    setSaving(false);
    setForm(null);
    await loadServices(artistId);
  };

  const handleDelete = async (id: string) => {
    if (!artistId) return;
    if (!confirm("Remove this service? Clients will no longer be able to book it.")) return;
    await supabase.from("services").delete().eq("id", id);
    await loadServices(artistId);
  };

  const handleToggleActive = async (s: ArtistService) => {
    if (!artistId) return;
    await supabase.from("services").update({ is_active: !s.is_active }).eq("id", s.id);
    await loadServices(artistId);
  };

  if (loading) return null;

  if (!artistId) {
    return (
      <div style={{ marginTop: "2.5rem", padding: "1rem 1.25rem", borderRadius: 14, background: "var(--plum-t)", color: "var(--plum)", fontSize: "0.85rem" }}>
        Save your service categories above first — then you can add priced services clients can book and pay for.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "2.5rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Manage your services</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Fine-tune duration or description for a service, hide one temporarily, or add an extra (like a bundle or package) that isn&apos;t tied to a style tag above.
      </p>

      {services.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.25rem" }}>
          {services.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.9rem 1.1rem", borderRadius: 12, border: "1.5px solid rgba(155,127,184,0.12)", background: "#fff", opacity: s.is_active ? 1 : 0.55 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{s.name}</p>
                <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--grey)" }}>
                  {fmt(s.price)} · {s.duration_minutes} min{s.category ? ` · ${s.category}` : ""}{!s.is_active ? " · Hidden" : ""}
                </p>
                {s.tags?.length > 0 && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.72rem", color: "var(--plum)" }}>
                    Suggests: {s.tags.map(upsellTagLabel).join(", ")}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button type="button" onClick={() => handleToggleActive(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>
                  {s.is_active ? "Hide" : "Unhide"}
                </button>
                <button type="button" onClick={() => startEdit(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>Edit</button>
                <button type="button" onClick={() => handleDelete(s.id)} style={{ background: "none", border: "1.5px solid rgba(229,57,53,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "#E53935", cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form ? (
        <div style={{ padding: "1.1rem 1.25rem", borderRadius: 14, border: "1.5px solid var(--plum)", background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Service name</label>
              <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))} placeholder="e.g. Silk press & trim" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Category</label>
              <select value={form.category} onChange={e => setForm(f => f && ({ ...f, category: e.target.value as ServiceTypeId }))} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }}>
                {categories.map(c => <option key={c} value={c}>{SERVICE_TYPES.find(t => t.id === c)?.label ?? c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Price (ZAR, R35 minimum)</label>
              <input type="number" min="35" step="1" value={form.priceRand} onChange={e => setForm(f => f && ({ ...f, priceRand: e.target.value }))} placeholder="350" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Duration</label>
              <select value={form.duration_minutes} onChange={e => setForm(f => f && ({ ...f, duration_minutes: parseInt(e.target.value, 10) }))} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }}>
                {Array.from(new Set([15, 30, 45, 60, 90, 120, 150, 180, 240, form.duration_minutes])).sort((a, b) => a - b).map(m => (
                  <option key={m} value={m}>{m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ""}`}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Description (optional)</label>
            <textarea value={form.description} onChange={e => setForm(f => f && ({ ...f, description: e.target.value }))} rows={2} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Style tags (optional)</label>
            <p style={{ fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.4rem" }}>
              Used to suggest related products from any seller at booking time — separate from the specific products you pick below.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {[
                ...(UPSELL_TAG_GROUPS.find(g => g.category === form.category)?.tags ?? []),
                ...(UPSELL_TAG_GROUPS.find(g => g.category === "general")?.tags ?? []),
              ].map(t => {
                const on = form.tags.includes(t.id);
                return (
                  <button
                    key={t.id} type="button"
                    onClick={() => setForm(f => f && ({ ...f, tags: on ? f.tags.filter(x => x !== t.id) : [...f.tags, t.id] }))}
                    style={{ borderRadius: 100, border: `1.5px solid ${on ? "var(--plum)" : "#E0E0E0"}`, background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)", padding: "0.2rem 0.65rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
                  >{t.label}</button>
                );
              })}
            </div>
          </div>
          <UpsellProductPicker
            ownerId={user.id}
            serviceTags={form.tags}
            selectedProductIds={form.upsellProductIds}
            onChange={(ids) => setForm(f => f && ({ ...f, upsellProductIds: ids }))}
            supabase={supabase}
          />
          {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button type="button" onClick={handleSaveForm} disabled={saving} className="btn-plum" style={{ padding: "0.55rem 1.4rem", fontSize: "0.85rem" }}>{saving ? "Saving…" : form.id ? "Save changes" : "Add service"}</button>
            <button type="button" onClick={() => setForm(null)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.55rem 1.2rem", fontSize: "0.85rem", color: "var(--grey)", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={startAdd} className="btn-outline" style={{ padding: "0.6rem 1.4rem", fontSize: "0.85rem" }}>+ Add a service</button>
      )}
    </div>
  );
}

export default function MyServicesTab({ profile, user, onUpdate }: { profile: Profile; user: User; onUpdate: (p: Profile) => void }) {
  const supabase = createClient();
  const [selected, setSelected] = useState<string[]>(profile.artist_category ? [profile.artist_category] : []);
  const [styles, setStyles] = useState<ServiceStyles>({ hair: [], nails: [], makeup: [], lashes: [] });
  const [styleInputs, setStyleInputs] = useState<Record<ServiceTypeId, StyleEntry>>({
    hair: { style: "", priceRand: "", tags: [] }, nails: { style: "", priceRand: "", tags: [] }, makeup: { style: "", priceRand: "", tags: [] }, lashes: { style: "", priceRand: "", tags: [] },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadingStyles, setLoadingStyles] = useState(true);
  const [servicesSyncedAt, setServicesSyncedAt] = useState(0);

  // Load existing style tags, then best-effort match each one against an
  // existing priced `services` row (by name + category) so a price/tags
  // already set don't get wiped out or shown blank on reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: styleRows } = await supabase
        .from("artist_service_styles")
        .select("category, style")
        .eq("user_id", user.id);

      const { data: artistRow } = await supabase.from("artists").select("id").eq("profile_id", user.id).maybeSingle();
      let svcByKey = new Map<string, { price: number; tags: string[] }>();
      if (artistRow?.id) {
        const { data: svcRows } = await supabase.from("services").select("name, category, price, tags").eq("artist_id", artistRow.id);
        svcByKey = new Map((svcRows ?? []).map(r => [`${r.category}::${r.name.trim().toLowerCase()}`, { price: r.price as number, tags: (r.tags as string[] | null) ?? [] }]));
      }

      if (cancelled) return;
      if (styleRows) {
        const grouped: ServiceStyles = { hair: [], nails: [], makeup: [], lashes: [] };
        for (const row of styleRows as { category: ServiceTypeId; style: string }[]) {
          if (!grouped[row.category]) continue;
          const match = svcByKey.get(`${row.category}::${row.style.trim().toLowerCase()}`);
          grouped[row.category].push({ style: row.style, priceRand: match ? String(match.price / 100) : "", tags: match?.tags ?? [] });
        }
        setStyles(grouped);
      }
      setLoadingStyles(false);
    })();
    return () => { cancelled = true; };
  }, [user.id, supabase]);

  const toggle = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const addStyle = (cat: ServiceTypeId) => {
    const val = styleInputs[cat].style.trim();
    const priceRand = styleInputs[cat].priceRand;
    const tags = styleInputs[cat].tags;
    if (!val) return;
    if (!priceRand || !(parseFloat(priceRand) >= 35)) { setError(`"${val}" needs a price of at least R35.`); return; }
    if (styles[cat].some(e => e.style.toLowerCase() === val.toLowerCase())) { setStyleInputs(i => ({ ...i, [cat]: { style: "", priceRand: "", tags: [] } })); return; }
    setError("");
    setStyles(s => ({ ...s, [cat]: [...s[cat], { style: val, priceRand, tags }] }));
    setStyleInputs(i => ({ ...i, [cat]: { style: "", priceRand: "", tags: [] } }));
  };

  const removeStyle = (cat: ServiceTypeId, idx: number) => {
    setStyles(s => ({ ...s, [cat]: s[cat].filter((_, i) => i !== idx) }));
  };

  const updateStylePrice = (cat: ServiceTypeId, idx: number, priceRand: string) => {
    setStyles(s => ({ ...s, [cat]: s[cat].map((e, i) => i === idx ? { ...e, priceRand } : e) }));
  };

  const toggleEntryTag = (cat: ServiceTypeId, idx: number, tagId: string) => {
    setStyles(s => ({ ...s, [cat]: s[cat].map((e, i) => i === idx ? { ...e, tags: e.tags.includes(tagId) ? e.tags.filter(t => t !== tagId) : [...e.tags, tagId] } : e) }));
  };

  const toggleInputTag = (cat: ServiceTypeId, tagId: string) => {
    setStyleInputs(i => ({ ...i, [cat]: { ...i[cat], tags: i[cat].tags.includes(tagId) ? i[cat].tags.filter(t => t !== tagId) : [...i[cat].tags, tagId] } }));
  };

  // Relevant upsell tag options for a given service category — its own
  // group plus the cross-category "general" group (gift sets, tools).
  const tagOptionsFor = (cat: ServiceTypeId) => [
    ...(UPSELL_TAG_GROUPS.find(g => g.category === cat)?.tags ?? []),
    ...(UPSELL_TAG_GROUPS.find(g => g.category === "general")?.tags ?? []),
  ];

  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      // Every listed style needs a price of at least R35 before we save anything.
      for (const cat of selected as ServiceTypeId[]) {
        for (const entry of styles[cat]) {
          if (!entry.priceRand || !(parseFloat(entry.priceRand) >= 35)) {
            throw new Error(`"${entry.style}" needs a price of at least R35.`);
          }
        }
      }

      const primary = selected[0] ?? null;

      // Update profile category
      const { data, error: err } = await supabase
        .from("profiles")
        .update({ artist_category: primary as Profile["artist_category"], is_artist: primary !== null, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select()
        .single();
      if (err) throw err;

      // Upsert styles: delete existing, re-insert
      await supabase.from("artist_service_styles").delete().eq("user_id", user.id);
      const rows: { user_id: string; category: ServiceTypeId; style: string }[] = [];
      for (const cat of selected as ServiceTypeId[]) {
        for (const entry of styles[cat]) {
          rows.push({ user_id: user.id, category: cat, style: entry.style });
        }
      }
      if (rows.length > 0) {
        const { error: insertErr } = await supabase.from("artist_service_styles").insert(rows);
        if (insertErr) throw insertErr;
      }

      // Keep the public "artists" listing row in sync — this is what the
      // homepage and search actually read from, separate from `profiles`.
      let artistId: string | null = null;
      if (primary) {
        const { data: artistRow, error: artistErr } = await supabase
          .from("artists")
          .upsert(
            {
              profile_id: user.id,
              display_name: profile.full_name,
              category: primary,
              avatar_url: profile.avatar_url,
              is_active: true,
            },
            { onConflict: "profile_id" }
          )
          .select("id")
          .single();
        if (artistErr) throw artistErr;
        artistId = artistRow?.id ?? null;
      } else {
        // No category selected — hide any existing listing rather than deleting it
        await supabase.from("artists").update({ is_active: false }).eq("profile_id", user.id);
      }

      // Sync the priced, bookable `services` rows the frontend booking
      // widget actually reads — this is the step that used to be missing,
      // leaving style tags with no corresponding bookable/priced entry.
      if (artistId) {
        const { data: existing } = await supabase
          .from("services")
          .select("id, name, category")
          .eq("artist_id", artistId);
        const existingByKey = new Map((existing ?? []).map(r => [`${r.category}::${(r.name as string).trim().toLowerCase()}`, r.id as string]));
        const matchedIds = new Set<string>();

        for (const cat of selected as ServiceTypeId[]) {
          for (const entry of styles[cat]) {
            const name = entry.style.trim();
            const price = Math.round(parseFloat(entry.priceRand) * 100);
            const key = `${cat}::${name.toLowerCase()}`;
            const existingId = existingByKey.get(key);
            if (existingId) {
              matchedIds.add(existingId);
              await supabase.from("services").update({ price, is_active: true, category: cat, tags: entry.tags }).eq("id", existingId);
            } else {
              await supabase.from("services").insert({ artist_id: artistId, name, price, duration_minutes: 60, category: cat, tags: entry.tags, is_active: true });
            }
          }
        }

        // Anything that existed before but wasn't in this save (style
        // removed/renamed) gets hidden rather than deleted, since a
        // booking may already reference it.
        const toHide = (existing ?? []).map(r => r.id as string).filter(id => !matchedIds.has(id));
        if (toHide.length > 0) {
          await supabase.from("services").update({ is_active: false }).in("id", toHide);
        }
        setServicesSyncedAt(Date.now());
      }

      if (data) { onUpdate(data as Profile); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  if (loadingStyles) return <div style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>My Services</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Select the beauty services you offer and list the styles you specialise in, each with its own price. Clients search by style and book directly at the price you set here.
      </p>

      {/* 4 category sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {SERVICE_TYPES.map(s => {
          const active = selected.includes(s.id);
          return (
            <div key={s.id} style={{ borderRadius: 20, overflow: "hidden", border: `2px solid ${active ? "var(--plum)" : "rgba(155,127,184,0.12)"}`, background: "#fff", boxShadow: active ? "0 8px 30px rgba(155,127,184,0.18)" : "0 4px 20px rgba(0,0,0,0.04)", transition: "all 0.2s ease" }}>
              {/* Banner */}
              <div className="service-banner" style={{ backgroundImage: `url(${s.banner})`, }}>
                <div className="service-banner-content">
                  <h2 className="service-banner-title">
                    {s.label}
                  </h2>

                  <p className="service-banner-subtitle">
                    {s.id === "hair" && "Styles that celebrate you."}
                    {s.id === "nails" && "Beautiful nails. Every detail."}
                    {s.id === "makeup" && "Enhance your beauty. Express your glow."}
                    {s.id === "lashes" && "Lashes that lift. Confidence that lasts."}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: "1.25rem 1.5rem", background: "#fff" }}>
                {/* Toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                  <p style={{ fontSize: "0.85rem", color: "var(--grey)", margin: 0, maxWidth: 420, lineHeight: 1.5 }}>{s.description}</p>
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    style={{
                      flexShrink: 0, marginLeft: "1rem",
                      borderRadius: 100, border: `1.5px solid ${active ? "var(--plum)" : "rgba(155,127,184,0.3)"}`,
                      background: active ? "var(--plum)" : "#fff",
                      color: active ? "#fff" : "var(--grey)",
                      padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s",
                    }}
                  >
                    {active ? "Selected ✓" : "Select"}
                  </button>
                </div>

                {/* Styles repeater — shown when selected */}
                {active && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {s.label} styles you offer
                    </label>
                    {/* Tag list — each entry shows its price and upsell tags, editable inline */}
                    {styles[s.id].length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
                        {styles[s.id].map((entry, idx) => (
                          <div key={idx} style={{ background: "var(--plum-t)", borderRadius: 10, padding: "0.4rem 0.5rem 0.5rem 0.9rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: 500, color: "var(--plum)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.style}</span>
                              <span style={{ fontSize: "0.8rem", color: "var(--plum)", flexShrink: 0 }}>R</span>
                              <input
                                type="number" min="35" step="1" value={entry.priceRand}
                                onChange={e => updateStylePrice(s.id, idx, e.target.value)}
                                placeholder="price"
                                style={{ width: 70, flexShrink: 0, padding: "0.3rem 0.5rem", borderRadius: 8, border: !entry.priceRand ? "1.5px solid #E53935" : "1.5px solid rgba(155,127,184,0.3)", fontSize: "0.82rem" }}
                              />
                              <button
                                type="button"
                                onClick={() => removeStyle(s.id, idx)}
                                style={{ flexShrink: 0, background: "none", border: "none", color: "var(--plum)", cursor: "pointer", padding: "0.2rem", fontSize: "0.85rem", lineHeight: 1, display: "flex", alignItems: "center" }}
                                aria-label={`Remove ${entry.style}`}
                              >✕</button>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.4rem" }}>
                              {tagOptionsFor(s.id).map(t => {
                                const on = entry.tags.includes(t.id);
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => toggleEntryTag(s.id, idx, t.id)}
                                    style={{
                                      borderRadius: 100, border: `1.5px solid ${on ? "var(--plum)" : "rgba(155,127,184,0.3)"}`,
                                      background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)",
                                      padding: "0.15rem 0.6rem", fontSize: "0.72rem", fontWeight: 500, cursor: "pointer",
                                    }}
                                  >{t.label}</button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Add input — name + price together, so a service is never saved without a price */}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        value={styleInputs[s.id].style}
                        onChange={e => setStyleInputs(i => ({ ...i, [s.id]: { ...i[s.id], style: e.target.value } }))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStyle(s.id); } }}
                        placeholder={`e.g. ${s.id === "hair" ? "Dreadlocks" : s.id === "nails" ? "Gel extensions" : s.id === "makeup" ? "Bridal glam" : "Volume lashes"}`}
                        style={{ flex: 1, padding: "0.6rem 0.9rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.88rem" }}
                      />
                      <input
                        type="number" min="35" step="1"
                        value={styleInputs[s.id].priceRand}
                        onChange={e => setStyleInputs(i => ({ ...i, [s.id]: { ...i[s.id], priceRand: e.target.value } }))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStyle(s.id); } }}
                        placeholder="R price (min 35)"
                        style={{ width: 100, flexShrink: 0, padding: "0.6rem 0.9rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.88rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => addStyle(s.id)}
                        style={{ flexShrink: 0, background: "var(--plum)", color: "#fff", border: "none", borderRadius: 10, padding: "0.6rem 1rem", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" }}
                      >Add</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--light)", marginRight: "0.15rem" }}>Suggest with:</span>
                      {tagOptionsFor(s.id).map(t => {
                        const on = styleInputs[s.id].tags.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => toggleInputTag(s.id, t.id)}
                            style={{
                              borderRadius: 100, border: `1.5px solid ${on ? "var(--plum)" : "#E0E0E0"}`,
                              background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)",
                              padding: "0.15rem 0.6rem", fontSize: "0.72rem", fontWeight: 500, cursor: "pointer",
                            }}
                          >{t.label}</button>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: "0.73rem", color: "var(--light)", marginTop: "0.35rem" }}>Press Enter or click Add. Each service needs a price — clients book and pay this amount directly. Tag what products go with it (e.g. Weave install → Extensions) so relevant products show up when a client books.</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "1.75rem" }}>
        {selected.length === 0 && <p style={{ fontSize: "0.82rem", color: "var(--nude)", marginBottom: "1rem" }}>Select at least one service you offer.</p>}
        {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
        {saved && <p style={{ color: "var(--forest)", fontSize: "0.85rem", marginBottom: "1rem" }}>Services saved.</p>}
        <button onClick={handleSave} className="btn-plum" disabled={saving || selected.length === 0} style={{ padding: "0.75rem 2rem" }}>{saving ? "Saving…" : "Save services"}</button>
        <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "1rem" }}>Your listed services and styles help clients find you when searching on Umuhle.</p>
      </div>

      <PricedServicesManager user={user} categories={selected as ServiceTypeId[]} refreshSignal={servicesSyncedAt} />
    </div>
  );
}

// ─── Invite tab ────────────────────────────────────────────────────────────────
