"use client";

// components/dashboard/MySalonTab.tsx
//
// The "Stores" section of My Business: a partner's salon/store listing,
// its branches, services, staff roster and booking inbox. This is the
// Store Owner's core management surface — see docs/role-based-dashboards-status.md.
//
// NOTE ON SCOPE: BranchStaffManager/StaffForm below are relocated verbatim
// from the old monolith and still show the pre-migration display-only
// roster UI (name/photo/bio/specialties) — they do NOT yet expose the
// rank/permission columns or the invite flow added by
// supabase/migrations/20260830_role_based_dashboards.sql. Wiring an actual
// "grant this employee calendar/products/analytics/revenue access" UI here,
// plus the owner-side invite flow, is deliberately deferred — see the status
// doc for what's next.

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Booking, BranchEmployee } from "@/types";
import { UPSELL_TAG_GROUPS } from "@/types";
import StoreCsvImport from "@/components/dashboard/StoreCsvImport";
import UpsellProductPicker from "@/components/UpsellProductPicker";
import { syncServiceUpsells, loadServiceUpsellIds } from "@/lib/upsells";
import { fmt } from "@/lib/dashboard/format";
import AddressAutocomplete from "@/components/dashboard/AddressAutocomplete";

// ─── My Salon tab ──────────────────────────────────────────────────────────────
type DayHours = {
  closed: boolean;
  open: string;
  close: string;
};

type SpecialDay = {
  date: string;
  closed: boolean;
  open?: string;
  close?: string;
};

type OpeningHours = {
  weekly: {
    sunday: DayHours;
    monday: DayHours;
    tuesday: DayHours;
    wednesday: DayHours;
    thursday: DayHours;
    friday: DayHours;
    saturday: DayHours;
  };

  public_holidays: DayHours;

  special_days: SpecialDay[];
};
 
type SalonListing = {
  id?: string;
  name: string;
  description: string;
  address: string;
  suburb: string;
  city: string;
  postal_code: string;
  latitude?: number | null;
  longitude?: number | null;
  phone: string;
  email: string;
  website: string;
  opening_hours: OpeningHours;
  gallery_urls: string[];
  instagram_username: string;
  youtube_url: string;
  services: string[];
  status?: "pending" | "approved" | "rejected";
};
 
type StoreBooking = {
  id: string;
  client_name: string;
  client_phone: string;
  service: string;
  booking_date: string;
  booking_time: string;
  notes: string | null;
  status: string;
  created_at: string;
  branch_employee_id: string | null;
  employee: { name: string } | null;
};
 
type GalleryFile = { file: File; preview: string };
 
const WEEK_DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const ALL_SERVICES = ["hair","nails","makeup","lashes"];
 
const defaultDay: DayHours = {
  closed: false,
  open: "08:00",
  close: "17:00",
};

const emptySalon = (): SalonListing => ({
  name: "",
  description: "",
  address: "",
  suburb: "",
  city: "",
  postal_code: "",
  phone: "",
  email: "",
  website: "",

  opening_hours: {
    weekly: {
      sunday: {
        closed: true,
        open: "",
        close: "",
      },

      monday: { ...defaultDay },
      tuesday: { ...defaultDay },
      wednesday: { ...defaultDay },
      thursday: { ...defaultDay },
      friday: { ...defaultDay },

      saturday: {
        closed: false,
        open: "08:00",
        close: "13:00",
      },
    },

    public_holidays: {
      closed: true,
      open: "",
      close: "",
    },

    special_days: [],
  },

  gallery_urls: [],
  instagram_username: "",
  youtube_url: "",
  services: [],
});
 
// ── SalonForm ─────────────────────────────────────────────────────────────────
 
// ── AddressAutocomplete ──────────────────────────────────────────────────────
// A live, as-you-type South African address search (backed by OpenStreetMap
// Nominatim via app/api/geocode/suggest) — picking a result fills address,
// suburb, city, postal code AND latitude/longitude all at once, straight
// from a match Nominatim already resolved. This is what actually prevents
// the "geocode failed on save" problem, rather than just patching it: the
// coordinates never depend on re-parsing whatever ended up typed across
// five separate fields.
function SalonForm({
  initial,
  userId,
  onSaved,
  onCancel,
  isEdit,
}: {
  initial: SalonListing;
  userId: string;
  onSaved: (listing: SalonListing) => void;
  onCancel?: () => void;
  isEdit: boolean;
}) {
  const supabase = createClient();
  const [form, setForm] = useState<SalonListing>(initial);
  const [gallery, setGallery] = useState<GalleryFile[]>([]);
  const [galleryError, setGalleryError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // How many photos will incur R5 charges
  const chargeableCount = gallery.length; // all new uploads cost R5 each
 
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.75rem 1rem", borderRadius: 12,
    border: "1.5px solid #E0E0E0", fontSize: "0.9rem", outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.8rem", fontWeight: 600, color: "#888",
    display: "block", marginBottom: "0.3rem", marginTop: "0.85rem",
  };
 
  /*const toggleDay = (day: string) => {
    setForm(f => ({
      ...f,
      opening_hours: {
        ...f.opening_hours,
        days: f.opening_hours.days.includes(day)
          ? f.opening_hours.days.filter(d => d !== day)
          : [...f.opening_hours.days, day],
      },
    }));
  };*/
 
  const toggleService = (svc: string) => {
    setForm(f => ({
      ...f,
      services: f.services.includes(svc)
        ? f.services.filter(s => s !== svc)
        : [...f.services, svc],
    }));
  };
 
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid = files.filter(f => f.type.startsWith("image/"));
    // Max 10 total (5 existing + 5 new as a soft limit — each costs R5)
    const remaining = 10 - form.gallery_urls.length;
    if (gallery.length + valid.length > remaining) {
      setGalleryError(`Maximum ${remaining} new images allowed.`);
      return;
    }
    setGalleryError("");
    const newFiles = valid.slice(0, remaining - gallery.length).map(f => ({
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setGallery(prev => [...prev, ...newFiles]);
  };
 
  /** Upload gallery images to Supabase Storage and record R5 charges */
  const uploadGallery = async (): Promise<string[]> => {
    const urls: string[] = [...form.gallery_urls];
    for (const item of gallery) {
      const ext = item.file.name.split(".").pop();
      const path = `salons/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("salon-gallery")
        .upload(path, item.file, { upsert: false });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from("salon-gallery").getPublicUrl(path);
      urls.push(publicUrl);
 
      // Record R5 charge (status = pending until a gateway confirms it —
      // this was never actually wired up to PayFast or anything else; it
      // just logs the intent). Same shape as the R35 salon registration
      // fee if this ever gets built out — see lib/payments/eligibility.ts,
      // Ozow-only, since it'd be 100% Umuhle revenue.
      await supabase.from("photo_upload_charges").insert({
        owner_id: userId,
        salon_id: form.id ?? null,
        image_url: publicUrl,
        amount_cents: 500,
        status: "pending",
      });
    }
    return urls;
  };
 
  const handleSubmit = async () => {
    setError("");
    if (!form.name.trim()) { setError("Store name is required."); return; }
    if (!form.address.trim()) { setError("Address is required."); return; }
const openDays = Object.values(
  form.opening_hours.weekly
).filter((d) => !d.closed);

if (openDays.length === 0) {
  setError("Select at least one business day.");
  return;
}
    if (form.services.length === 0) { setError("Select at least one service."); return; }
 
    setSaving(true);
    try {
      const galleryUrls = await uploadGallery();

      // Best-effort geocode so the public store page can show the
      // "Find us here" map. Never blocks saving — if it fails or times
      // out, we just keep whatever coordinates the listing already had.
      let latitude = form.latitude ?? null;
      let longitude = form.longitude ?? null;
      try {
        const geoRes = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: form.address,
            suburb: form.suburb,
            city: form.city,
            postalCode: form.postal_code,
          }),
        });
        if (geoRes.ok) {
          const geo = await geoRes.json();
          if (geo.latitude && geo.longitude) {
            latitude = geo.latitude;
            longitude = geo.longitude;
          }
        }
      } catch {
        // Geocoding is a nice-to-have, not a save-blocker.
      }

      // Only brand-new listings (and ones still pending/rejected from a
      // prior submission) go back into the review queue. Once a listing
      // has been approved and is live, the owner's own edits — fixing a
      // phone number, updating the address, adding photos — must not
      // knock it back into "Under review" and off the Stores page.
      const status: "pending" | "approved" =
        isEdit && initial.status === "approved" ? "approved" : "pending";

      const payload = {
        name: form.name,
        description: form.description,
        address: form.address,
        suburb: form.suburb,
        city: form.city,
        postal_code: form.postal_code || null,
        latitude,
        longitude,
        phone: form.phone,
        email: form.email,
        website: form.website || null,
        opening_hours: form.opening_hours,
        gallery_urls: galleryUrls,
        instagram_username: form.instagram_username || null,
        youtube_url: form.youtube_url || null,
        services: form.services,
        partner_id: userId,
        status,
      };
 
      let data, err;
      if (form.id) {
        ({ data, error: err } = await supabase
          .from("partner_salons").update(payload).eq("id", form.id).select().single());
      } else {
        ({ data, error: err } = await supabase
          .from("partner_salons").insert(payload).select().single());
      }
      if (err) throw err;

      // First-time submission only — never on edits to an existing
      // listing. Fire-and-forget: the listing is already saved either way.
      if (!form.id && data) {
        const saved = data as SalonListing;
        fetch("/api/salons/submitted", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salonId: saved.id, salonName: saved.name }),
        }).catch(() => {});
      }

      setGallery([]);
      onSaved(data as SalonListing);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };
 
  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "1rem" }}>
        {isEdit ? "Edit listing" : "Add a store"}
      </h3>
 
      <label style={labelStyle}>Store name *</label>
      <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Beauty by Thandi" style={inputStyle} />
 
      <label style={labelStyle}>Description</label>
      <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Tell clients what makes your store special…" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
 
      <label style={labelStyle}>Search your address</label>
      <AddressAutocomplete onSelect={r => setForm(f => ({
        ...f,
        address: r.street || f.address,
        suburb: r.suburb || f.suburb,
        city: r.city || f.city,
        postal_code: r.postalCode || f.postal_code,
        latitude: r.latitude,
        longitude: r.longitude,
      }))} />
      <p style={{ fontSize: "0.75rem", color: "#aaa", marginTop: "0.3rem", marginBottom: "0.85rem" }}>
        Pick a match to fill in the fields below automatically — or just type them in yourself.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
        <div>
          <label style={labelStyle}>Suburb *</label>
          <input required value={form.suburb} onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))} placeholder="e.g. Sandton" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>City *</label>
          <input required value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Johannesburg" style={inputStyle} />
        </div>
      </div>
 
      <label style={labelStyle}>Full address *</label>
      <input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main Street, Sandton" style={inputStyle} />

      <label style={labelStyle}>Postal code</label>
      <input value={form.postal_code ?? ""} onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))} placeholder="e.g. 2196" style={{ ...inputStyle, maxWidth: 220 }} />
      <p style={{ fontSize: "0.75rem", color: "#aaa", marginTop: "0.3rem" }}>
        Helps us place your store accurately on the &ldquo;Find us here&rdquo; map on your public page.
      </p>
 
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
        <div>
          <label style={labelStyle}>Phone *</label>
          <input required type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="082 123 4567" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="hello@yourstore.co.za" style={inputStyle} />
        </div>
      </div>
 
      <label style={labelStyle}>Website</label>
      <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://yourstore.co.za" style={inputStyle} />
 
      {/* Services */}
      <label style={labelStyle}>Services offered *</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        {ALL_SERVICES.map(svc => {
          const on = form.services.includes(svc);
          return (
            <button key={svc} type="button" onClick={() => toggleService(svc)} style={{
              padding: "0.4rem 1rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer",
              border: "1.5px solid", borderColor: on ? "var(--plum)" : "rgba(155,127,184,0.25)",
              background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)",
              fontWeight: on ? 600 : 400, textTransform: "capitalize",
            }}>{svc}</button>
          );
        })}
      </div>
 
      {/* Business hours */}
<label style={labelStyle}>Business hours *</label>

<div
  style={{
    border: "1.5px solid #E0E0E0",
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 4,
  }}
>
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "0.85rem",
    }}
  >
    <thead>
      <tr style={{ background: "#fafaf8" }}>
        <th style={{ padding: "0.75rem", textAlign: "left" }}>Day</th>
        <th style={{ padding: "0.75rem", textAlign: "center" }}>Closed</th>
        <th style={{ padding: "0.75rem", textAlign: "left" }}>Open</th>
        <th style={{ padding: "0.75rem", textAlign: "left" }}>Close</th>
      </tr>
    </thead>

    <tbody>
      {(
        [
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ] as const
      ).map((day) => {
        const hours = form.opening_hours.weekly[day];

        return (
          <tr
            key={day}
            style={{
              borderTop: "1px solid #f0f0f0",
            }}
          >
            <td style={{ padding: "0.75rem", textTransform: "capitalize" }}>
              {day}
            </td>

            <td style={{ padding: "0.75rem", textAlign: "center" }}>
              <input
                type="checkbox"
                checked={hours.closed}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    opening_hours: {
                      ...f.opening_hours,
                      weekly: {
                        ...f.opening_hours.weekly,
                        [day]: {
                          ...hours,
                          closed: e.target.checked,
                        },
                      },
                    },
                  }))
                }
              />
            </td>

            <td style={{ padding: "0.75rem" }}>
              <input
                type="time"
                disabled={hours.closed}
                value={hours.open}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    opening_hours: {
                      ...f.opening_hours,
                      weekly: {
                        ...f.opening_hours.weekly,
                        [day]: {
                          ...hours,
                          open: e.target.value,
                        },
                      },
                    },
                  }))
                }
                style={{
                  ...inputStyle,
                  opacity: hours.closed ? 0.5 : 1,
                }}
              />
            </td>

            <td style={{ padding: "0.75rem" }}>
              <input
                type="time"
                disabled={hours.closed}
                value={hours.close}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    opening_hours: {
                      ...f.opening_hours,
                      weekly: {
                        ...f.opening_hours.weekly,
                        [day]: {
                          ...hours,
                          close: e.target.value,
                        },
                      },
                    },
                  }))
                }
                style={{
                  ...inputStyle,
                  opacity: hours.closed ? 0.5 : 1,
                }}
              />
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>

{/* Public holidays */}

<label style={{ ...labelStyle, marginTop: "1rem" }}>
  Public holidays
</label>

<div
  style={{
    border: "1.5px solid #E0E0E0",
    borderRadius: 12,
    padding: "1rem",
  }}
>
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "120px 1fr 1fr",
      gap: "0.75rem",
      alignItems: "center",
    }}
  >
    <label>
      <input
        type="checkbox"
        checked={form.opening_hours.public_holidays.closed}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              public_holidays: {
                ...f.opening_hours.public_holidays,
                closed: e.target.checked,
              },
            },
          }))
        }
      />
      {" "}Closed
    </label>

    <input
      type="time"
      disabled={form.opening_hours.public_holidays.closed}
      value={form.opening_hours.public_holidays.open}
      onChange={(e) =>
        setForm((f) => ({
          ...f,
          opening_hours: {
            ...f.opening_hours,
            public_holidays: {
              ...f.opening_hours.public_holidays,
              open: e.target.value,
            },
          },
        }))
      }
      style={inputStyle}
    />

    <input
      type="time"
      disabled={form.opening_hours.public_holidays.closed}
      value={form.opening_hours.public_holidays.close}
      onChange={(e) =>
        setForm((f) => ({
          ...f,
          opening_hours: {
            ...f.opening_hours,
            public_holidays: {
              ...f.opening_hours.public_holidays,
              close: e.target.value,
            },
          },
        }))
      }
      style={inputStyle}
    />
  </div>
</div>

{/* Special days */}

<label style={{ ...labelStyle, marginTop: "1rem" }}>
  Special days
</label>

<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
  {form.opening_hours.special_days.map((sd, idx) => (
    <div
      key={idx}
      style={{
        border: "1.5px solid #E0E0E0",
        borderRadius: 12,
        padding: "0.75rem",
        display: "grid",
        gridTemplateColumns: "1.2fr auto 1fr 1fr auto",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      <input
        type="date"
        value={sd.date}
        onChange={(e) => {
          const next = [...form.opening_hours.special_days];
          next[idx].date = e.target.value;

          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days: next,
            },
          }));
        }}
        style={inputStyle}
      />

      <label>
        <input
          type="checkbox"
          checked={sd.closed}
          onChange={(e) => {
            const next = [...form.opening_hours.special_days];
            next[idx].closed = e.target.checked;

            setForm((f) => ({
              ...f,
              opening_hours: {
                ...f.opening_hours,
                special_days: next,
              },
            }));
          }}
        />
        {" "}Closed
      </label>

      <input
        type="time"
        disabled={sd.closed}
        value={sd.open ?? ""}
        onChange={(e) => {
          const next = [...form.opening_hours.special_days];
          next[idx].open = e.target.value;

          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days: next,
            },
          }));
        }}
        style={inputStyle}
      />

      <input
        type="time"
        disabled={sd.closed}
        value={sd.close ?? ""}
        onChange={(e) => {
          const next = [...form.opening_hours.special_days];
          next[idx].close = e.target.value;

          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days: next,
            },
          }));
        }}
        style={inputStyle}
      />

      <button
        type="button"
        onClick={() =>
          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days:
                f.opening_hours.special_days.filter(
                  (_, i) => i !== idx
                ),
            },
          }))
        }
        style={{
          border: "none",
          background: "#FCEBEB",
          color: "#A32D2D",
          borderRadius: 8,
          padding: "0.5rem",
          cursor: "pointer",
        }}
      >
        Remove
      </button>
    </div>
  ))}

  <button
    type="button"
    onClick={() =>
      setForm((f) => ({
        ...f,
        opening_hours: {
          ...f.opening_hours,
          special_days: [
            ...f.opening_hours.special_days,
            {
              date: "",
              closed: true,
              open: "",
              close: "",
            },
          ],
        },
      }))
    }
    style={{
      padding: "0.75rem",
      borderRadius: 12,
      border: "1.5px dashed rgba(155,127,184,0.3)",
      background: "#fafaf8",
      cursor: "pointer",
      color: "var(--plum)",
    }}
  >
    + Add special day
  </button>
</div>
 
      {/* Instagram — FREE */}
      <label style={labelStyle}>
        Instagram username
        <span style={{ marginLeft: 8, background: "#E1F5EE", color: "#0F6E56", borderRadius: 100, padding: "1px 8px", fontSize: "0.72rem", fontWeight: 600 }}>FREE</span>
      </label>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "#C13584", fontSize: "0.9rem", pointerEvents: "none" }}>@</span>
        <input value={form.instagram_username}
          onChange={e => setForm(f => ({ ...f, instagram_username: e.target.value.replace(/^@/, "") }))}
          placeholder="yourstorehandle" style={{ ...inputStyle, paddingLeft: "2rem" }} />
      </div>
      <p style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
        Your latest Instagram posts will appear on your store page automatically — free of charge.
      </p>
 
      {/* YouTube */}
      <label style={labelStyle}>YouTube video URL</label>
      <input type="url" value={form.youtube_url}
        onChange={e => setForm(f => ({ ...f, youtube_url: e.target.value }))}
        placeholder="https://youtube.com/watch?v=..." style={inputStyle} />
      <p style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
        Paste any YouTube video URL — it will be embedded on your store page.
      </p>
 
      {/* Gallery — R5 per image */}
      <label style={labelStyle}>
        Gallery photos
        <span style={{ marginLeft: 8, background: "#FAEEDA", color: "#854F0B", borderRadius: 100, padding: "1px 8px", fontSize: "0.72rem", fontWeight: 600 }}>R5 each</span>
      </label>
      <div style={{ background: "#FFFBF0", border: "1.5px solid #F5D99A", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "0.75rem", fontSize: "0.82rem", color: "#6B4C00" }}>
        💡 <strong>Tip:</strong> Connect your Instagram above — it&apos;s free and keeps your gallery fresh automatically. Direct photo uploads are charged at <strong>R5 per image</strong> to manage storage costs.
      </div>
 
      {chargeableCount > 0 && (
        <div style={{ background: "#E6F1FB", border: "1.5px solid #B3D4F5", borderRadius: 12, padding: "0.65rem 1rem", marginBottom: "0.75rem", fontSize: "0.82rem", color: "#185FA5" }}>
          You are adding <strong>{chargeableCount}</strong> image{chargeableCount !== 1 ? "s" : ""} — a charge of <strong>R{chargeableCount * 5}</strong> will be logged. Our team will process the payment separately.
        </div>
      )}
 
      <button type="button"
        onClick={() => document.getElementById(`gallery-input-${form.id ?? "new"}`)?.click()}
        style={{ padding: "0.65rem 1.25rem", borderRadius: 12, border: "1.5px dashed rgba(155,127,184,0.4)", background: "#fafaf8", fontSize: "0.85rem", color: "var(--plum)", cursor: "pointer", width: "100%" }}>
        + Add photos (R5 each)
      </button>
      <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "0.25rem" }}>{gallery.length} new · {form.gallery_urls.length} existing</p>
      <input id={`gallery-input-${form.id ?? "new"}`} type="file" accept="image/*" multiple
        style={{ display: "none" }} onChange={handleFileChange} />
      {galleryError && <p style={{ color: "#E53935", fontSize: "0.8rem", marginTop: "0.35rem" }}>{galleryError}</p>}
 
      {/* Previews */}
      {gallery.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: "0.75rem" }}>
          {gallery.map((g, i) => (
            <div key={i} style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => setGallery(prev => prev.filter((_, idx) => idx !== i))}
                style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", borderRadius: "50%", width: 20, height: 20, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
          ))}
        </div>
      )}
 
      {form.gallery_urls.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <p style={{ fontSize: "0.75rem", color: "var(--grey)", marginBottom: 4 }}>Existing photos:</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
            {form.gallery_urls.map((url, i) => (
              <div key={i} style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button onClick={() => setForm(f => ({ ...f, gallery_urls: f.gallery_urls.filter((_, idx) => idx !== i) }))}
                  style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", borderRadius: "50%", width: 20, height: 20, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
 
      {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginTop: "0.75rem" }}>{error}</p>}
 
      <div style={{ display: "flex", gap: 10, marginTop: "1.25rem" }}>
        {onCancel && (
          <button onClick={onCancel} style={{ flex: 1, padding: "0.75rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--grey)", fontSize: "0.9rem", cursor: "pointer" }}>
            Cancel
          </button>
        )}
        <button onClick={handleSubmit} disabled={saving} className="btn-plum" style={{ flex: 2, padding: "0.75rem", borderRadius: 100, fontSize: "0.9rem", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Submit for review"}
        </button>
      </div>
      {!isEdit && (
        <p style={{ fontSize: "0.75rem", color: "#bbb", textAlign: "center", marginTop: "0.75rem" }}>
          Your listing will be reviewed before going live (usually within 24 hours).
        </p>
      )}
    </div>
  );
}
 
// ── Booking inbox for salon owners ────────────────────────────────────────────
 
function SalonBookingsInbox({ salonId }: { salonId: string }) {
  const supabase = createClient();
  const [bookings, setBookings] = useState<StoreBooking[]>([]);
  const [loading, setLoading] = useState(true);
 
  useEffect(() => {
    supabase
      .from("store_bookings")
      .select("*, employee:branch_employees(name)")
      .eq("salon_id", salonId)
      .order("booking_date", { ascending: true })
      .then(({ data }) => {
        setBookings((data as StoreBooking[]) ?? []);
        setLoading(false);
      });
  }, [salonId]);
 
  const updateStatus = async (id: string, status: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/store-bookings/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return;
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
  };
 
  const statusColors: Record<string, { bg: string; color: string }> = {
    pending:   { bg: "#FAEEDA", color: "#854F0B" },
    confirmed: { bg: "#E1F5EE", color: "#0F6E56" },
    completed: { bg: "#E6F1FB", color: "#185FA5" },
    cancelled: { bg: "#FCEBEB", color: "#A32D2D" },
  };
 
  if (loading) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading bookings…</p>;
  if (!bookings.length) return (
    <div style={{ textAlign: "center", padding: "2rem", color: "var(--grey)" }}>
      <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>No bookings yet.</p>
      <p style={{ fontSize: "0.85rem" }}>When clients book via your store page, requests appear here.</p>
    </div>
  );
 
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {bookings.map(b => {
        const sc = statusColors[b.status] ?? statusColors.pending;
        return (
          <div key={b.id} style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1rem 1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>{b.client_name}</p>
                <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: "2px 0 0" }}>
                  {b.booking_date} at {b.booking_time} · <span style={{ textTransform: "capitalize" }}>{b.service}</span>
                  {b.employee?.name && <> · with <strong>{b.employee.name}</strong></>}
                </p>
              </div>
              <span style={{ background: sc.bg, color: sc.color, borderRadius: 100, padding: "0.2rem 0.7rem", fontSize: "0.72rem", fontWeight: 600, textTransform: "capitalize", whiteSpace: "nowrap" }}>
                {b.status}
              </span>
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: "0 0 0.65rem" }}>
              📞 <a href={`tel:${b.client_phone}`} style={{ color: "var(--plum)" }}>{b.client_phone}</a>
              {" · "}
              <a href={`https://wa.me/${b.client_phone.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#25D366" }}>WhatsApp</a>
            </p>
            {b.notes && <p style={{ fontSize: "0.82rem", color: "#666", fontStyle: "italic", margin: "0 0 0.65rem" }}>&quot;{b.notes}&quot;</p>}
            {b.status === "pending" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => updateStatus(b.id, "confirmed")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#E1F5EE", color: "#0F6E56", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Confirm
                </button>
                <button onClick={() => updateStatus(b.id, "cancelled")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#FCEBEB", color: "#A32D2D", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            )}
            {b.status === "confirmed" && (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => updateStatus(b.id, "completed")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#E6F1FB", color: "#185FA5", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Mark completed
                </button>
                <button onClick={() => updateStatus(b.id, "no_show")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#FCEBEB", color: "#A32D2D", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Customer no-show
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
 
// ── Branch staff management for salon owners ───────────────────────────────────
// One branch per salon today (see supabase/migrations/20260802_store_branches_foundation.sql)
// so this always resolves the is_primary branch — multi-branch owners will
// get a branch switcher here once that phase ships.
//
// BranchStaffMember is just BranchEmployee (@/types) under its original
// local name here, rather than a hand-duplicated subset of its fields —
// duplicating a type that's actually the same shape is exactly the kind
// of drift that caused the courier-checkout-flag bug fixed 2026-08-31
// (three hand-synced copies of one value). This is where the
// profile_id/rank/can_*/invite_status columns (added by
// 20260830_role_based_dashboards.sql) actually get used in the UI for
// the first time — see EmployeeAccessPanel below.
type BranchStaffMember = BranchEmployee;

function BranchStaffManager({ salonId, salonServices }: { salonId: string; salonServices: string[] }) {
  const supabase = createClient();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [staff, setStaff] = useState<BranchStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BranchStaffMember | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [expandedAccessId, setExpandedAccessId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: branch } = await supabase
        .from("store_branches").select("id").eq("salon_id", salonId).eq("is_primary", true).maybeSingle();
      if (!branch) { setLoading(false); return; }
      setBranchId(branch.id);
      const { data } = await supabase
        .from("branch_employees").select("*").eq("branch_id", branch.id).order("display_order", { ascending: true });
      setStaff((data as BranchStaffMember[]) ?? []);
      setLoading(false);
    })();
  }, [salonId]);

  const handleSaved = (saved: BranchStaffMember) => {
    setStaff(prev => {
      const idx = prev.findIndex(s => s.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [...prev, saved];
    });
    setShowForm(false);
    setEditing(null);
  };

  const toggleActive = async (member: BranchStaffMember) => {
    const { data } = await supabase
      .from("branch_employees").update({ is_active: !member.is_active }).eq("id", member.id).select().single();
    if (data) handleSaved(data as BranchStaffMember);
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this staff member? Past bookings that mention them are kept.")) return;
    await supabase.from("branch_employees").delete().eq("id", id);
    setStaff(prev => prev.filter(s => s.id !== id));
  };

  const handleInvited = async () => {
    setShowInviteForm(false);
    // Re-fetch rather than trying to construct the new row client-side —
    // the invite route may have reused an existing account (see its
    // createOrReuseEmployeeAccount), and this way the list always matches
    // what's actually in the database.
    if (!branchId) return;
    const { data } = await supabase
      .from("branch_employees").select("*").eq("branch_id", branchId).order("display_order", { ascending: true });
    setStaff((data as BranchStaffMember[]) ?? []);
  };

  const handleAccessUpdated = (updated: BranchStaffMember) => {
    setStaff(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  if (loading) return <p style={{ color: "var(--grey)" }}>Loading…</p>;

  if (!branchId) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Save your store listing first, then add staff here.</p>;

  if (showForm || editing) return (
    <StaffForm
      branchId={branchId}
      salonServices={salonServices}
      initial={editing}
      onSaved={handleSaved}
      onCancel={() => { setShowForm(false); setEditing(null); }}
    />
  );

  if (showInviteForm) return (
    <InviteEmployeeForm branchId={branchId} onInvited={handleInvited} onCancel={() => setShowInviteForm(false)} />
  );

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "1rem" }}>
        Add the people clients can pick when booking. Hidden staff stay off the booking form but keep their history.
      </p>

      {staff.length === 0 && (
        <p style={{ fontSize: "0.9rem", color: "var(--grey)", marginBottom: "1rem" }}>No staff added yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
        {staff.map(member => (
          <div key={member.id} style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.15)", opacity: member.is_active ? 1 : 0.55 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.85rem 1rem" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", background: "#f3eef7", flexShrink: 0 }}>
                {member.photo_url && <img src={member.photo_url} alt={member.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0, display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                  {member.name}
                  {!member.is_active && <span style={{ color: "#999", fontWeight: 400, fontSize: "0.78rem" }}>hidden</span>}
                  {member.profile_id && <InviteStatusBadge status={member.invite_status} rank={member.rank} />}
                </p>
                {member.specialties.length > 0 && (
                  <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: "2px 0 0", textTransform: "capitalize" }}>{member.specialties.join(", ")}</p>
                )}
              </div>
              <button onClick={() => setEditing(member)} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>Edit</button>
              <button onClick={() => toggleActive(member)} style={{ background: "none", border: "none", color: "var(--grey)", fontSize: "0.8rem", cursor: "pointer" }}>{member.is_active ? "Hide" : "Unhide"}</button>
              <button onClick={() => remove(member.id)} style={{ background: "none", border: "none", color: "#A32D2D", fontSize: "0.8rem", cursor: "pointer" }}>Remove</button>
              {member.profile_id && member.invite_status !== "revoked" && (
                <button onClick={() => setExpandedAccessId(expandedAccessId === member.id ? null : member.id)}
                  style={{ background: "none", border: "none", color: "var(--grey)", fontSize: "0.8rem", cursor: "pointer" }}>
                  {expandedAccessId === member.id ? "Close access" : "Manage access"}
                </button>
              )}
            </div>
            {member.profile_id && expandedAccessId === member.id && (
              <EmployeeAccessPanel member={member} onUpdated={handleAccessUpdated} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.6rem 1.5rem", borderRadius: 100, fontWeight: 600, fontSize: "0.85rem" }}>
          + Add staff member
        </button>
        <button onClick={() => setShowInviteForm(true)}
          style={{ padding: "0.6rem 1.5rem", borderRadius: 100, fontWeight: 600, fontSize: "0.85rem", background: "#fff", border: "1.5px solid var(--plum)", color: "var(--plum)", cursor: "pointer" }}>
          + Invite employee
        </button>
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--grey)", marginTop: "0.6rem", maxWidth: 480 }}>
        &quot;Add staff member&quot; just adds a name clients see when booking. &quot;Invite employee&quot; creates an actual login so they can manage their own availability and bookings.
      </p>
    </div>
  );
}

// A branch can have at most 2 "manager" rank employees — enforced by the
// trg_branch_manager_cap DB trigger (supabase/migrations/20260830_role_based_dashboards.sql).
// This list is for the rank <select> below; the actual limit is
// server-side, this just avoids offering an option that'll immediately
// bounce.
const EMPLOYEE_RANKS: { value: "staff" | "manager"; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "manager", label: "Manager" },
];

const PERMISSION_FIELDS: { key: "can_manage_products" | "can_manage_calendar" | "can_view_analytics" | "can_view_revenue"; label: string; hint: string }[] = [
  { key: "can_manage_calendar", label: "Manage branch calendar", hint: "See and edit every staff member's bookings, not just their own" },
  { key: "can_manage_products", label: "Manage products", hint: "Add, edit, and remove products for sale" },
  { key: "can_view_analytics", label: "View analytics", hint: "Bookings and website traffic for this store" },
  { key: "can_view_revenue", label: "View revenue", hint: "Payout amounts, by branch" },
];

function InviteStatusBadge({ status, rank }: { status: string; rank: string }) {
  const statusStyle = status === "active"
    ? { bg: "#E8F5E9", color: "#2E7D32", label: "Active" }
    : status === "revoked"
    ? { bg: "#FAFAFA", color: "#757575", label: "Revoked" }
    : { bg: "#FFF3E0", color: "#E65100", label: "Invite pending" };
  return (
    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
      <span style={{ background: statusStyle.bg, color: statusStyle.color, borderRadius: 100, padding: "0.1rem 0.55rem", fontSize: "0.68rem", fontWeight: 600 }}>{statusStyle.label}</span>
      {rank === "manager" && <span style={{ background: "var(--plum-t)", color: "var(--plum)", borderRadius: 100, padding: "0.1rem 0.55rem", fontSize: "0.68rem", fontWeight: 600 }}>Manager</span>}
    </span>
  );
}

// Owner-only rank/permission editing + revoke, for one branch_employees
// row that already has a real login (profile_id set). Goes through
// PATCH /api/branch-employees/[id] — branch_employees has no client-side
// RLS write access, by design (see that route's file comment).
function EmployeeAccessPanel({ member, onUpdated }: { member: BranchStaffMember; onUpdated: (m: BranchStaffMember) => void }) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setSaving(false); setError("Not signed in."); return; }
    const res = await fetch(`/api/branch-employees/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) { setError(json?.error ?? "Couldn't save that change."); return; }
    onUpdated(json.branchEmployee as BranchStaffMember);
  };

  const revoke = () => {
    if (!confirm(`Revoke ${member.name}'s access? They'll no longer be able to sign in as a team member here.`)) return;
    patch({ invite_status: "revoked" });
  };

  return (
    <div style={{ borderTop: "1.5px solid rgba(155,127,184,0.12)", padding: "1rem", background: "var(--plum-t)" }}>
      <div style={{ marginBottom: "0.85rem" }}>
        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.35rem" }}>Rank</label>
        <select value={member.rank} disabled={saving} onChange={e => patch({ rank: e.target.value })}
          style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1.5px solid rgba(155,127,184,0.25)", fontSize: "0.85rem" }}>
          {EMPLOYEE_RANKS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <p style={{ fontSize: "0.72rem", color: "var(--grey)", margin: "0.35rem 0 0" }}>Up to 2 managers per branch.</p>
      </div>

      <div style={{ marginBottom: "0.85rem" }}>
        <p style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.5rem" }}>Access</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {PERMISSION_FIELDS.map(f => (
            <label key={f.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.82rem", cursor: saving ? "default" : "pointer" }}>
              <input type="checkbox" checked={Boolean(member[f.key])} disabled={saving} onChange={e => patch({ [f.key]: e.target.checked })} style={{ marginTop: "0.15rem" }} />
              <span>
                {f.label}
                <br /><span style={{ color: "var(--grey)", fontSize: "0.75rem" }}>{f.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {error && <p style={{ color: "#A32D2D", fontSize: "0.8rem", margin: "0 0 0.5rem" }}>{error}</p>}

      <button onClick={revoke} disabled={saving} style={{ background: "none", border: "none", color: "#A32D2D", fontSize: "0.8rem", cursor: "pointer", padding: 0 }}>
        Revoke access
      </button>
    </div>
  );
}

// Owner-only: create a real login for a team member (as opposed to "+ Add
// staff member" above, which just adds a display-only name). Goes through
// POST /api/branch-employees/invite — see that route for why this sends
// an email, not a WhatsApp message, and what happens if the email already
// has an Umuhle account.
function InviteEmployeeForm({ branchId, onInvited, onCancel }: { branchId: string; onInvited: () => void; onCancel: () => void }) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setSaving(false); setError("Not signed in."); return; }
    const res = await fetch("/api/branch-employees/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ branchId, name, phone, email }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) { setError(json?.error ?? "Couldn't send the invite."); return; }
    onInvited();
  };

  return (
    <form onSubmit={handleSubmit}>
      <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "1.25rem" }}>
        They&apos;ll get an email to set their own password. Once activated, they can manage their own availability and see their assigned bookings — nothing store-wide unless you grant it under &quot;Manage access&quot;.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", marginBottom: "1.25rem", maxWidth: 380 }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} required
            style={{ width: "100%", padding: "0.65rem 0.9rem", borderRadius: 10, border: "1.5px solid rgba(155,127,184,0.25)", fontSize: "0.88rem", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} required placeholder="082 123 4567"
            style={{ width: "100%", padding: "0.65rem 0.9rem", borderRadius: 10, border: "1.5px solid rgba(155,127,184,0.25)", fontSize: "0.88rem", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="Where their activation link goes"
            style={{ width: "100%", padding: "0.65rem 0.9rem", borderRadius: 10, border: "1.5px solid rgba(155,127,184,0.25)", fontSize: "0.88rem", boxSizing: "border-box" }} />
        </div>
      </div>
      {error && <p style={{ color: "#A32D2D", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button type="submit" disabled={saving} className="btn-plum" style={{ padding: "0.6rem 1.5rem", borderRadius: 100, fontWeight: 600, fontSize: "0.85rem" }}>
          {saving ? "Sending…" : "Send invite"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} style={{ background: "none", border: "none", color: "var(--grey)", fontSize: "0.85rem", cursor: "pointer" }}>Cancel</button>
      </div>
    </form>
  );
}

function StaffForm({ branchId, salonServices, initial, onSaved, onCancel }: {
  branchId: string;
  salonServices: string[];
  initial: BranchStaffMember | null;
  onSaved: (m: BranchStaffMember) => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [specialties, setSpecialties] = useState<string[]>(initial?.specialties ?? []);
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial?.photo_url ?? null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const services = salonServices.length ? salonServices : ALL_SERVICES;

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.75rem 1rem", borderRadius: 12,
    border: "1.5px solid #E0E0E0", fontSize: "0.9rem", outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.8rem", fontWeight: 600, color: "#888",
    display: "block", marginBottom: "0.3rem", marginTop: "0.85rem",
  };

  const toggleSpecialty = (s: string) => {
    setSpecialties(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  const save = async () => {
    setError("");
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    try {
      let finalPhotoUrl = initial?.photo_url ?? null;
      if (photoFile) {
        const ext = photoFile.name.split(".").pop();
        const path = `staff/${branchId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("salon-gallery").upload(path, photoFile, { upsert: false });
        if (uploadErr) throw uploadErr;
        finalPhotoUrl = supabase.storage.from("salon-gallery").getPublicUrl(path).data.publicUrl;
      }
      const payload = { branch_id: branchId, name: name.trim(), bio: bio.trim() || null, specialties, photo_url: finalPhotoUrl };
      let data, err;
      if (initial) {
        ({ data, error: err } = await supabase.from("branch_employees").update(payload).eq("id", initial.id).select().single());
      } else {
        ({ data, error: err } = await supabase.from("branch_employees").insert(payload).select().single());
      }
      if (err) throw err;
      onSaved(data as BranchStaffMember);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.1rem" }}>
        {initial ? "Edit staff member" : "Add staff member"}
      </h3>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", overflow: "hidden", background: "#f3eef7", flexShrink: 0 }}>
          {photoUrl && <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <label style={{ fontSize: "0.82rem", color: "var(--plum)", fontWeight: 600, cursor: "pointer" }}>
          {photoUrl ? "Change photo" : "Add photo (optional)"}
          <input type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: "none" }} />
        </label>
      </div>

      <label style={labelStyle}>Name *</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Xoli" style={inputStyle} />

      <label style={labelStyle}>Specialties</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {services.map(s => (
          <button key={s} type="button" onClick={() => toggleSpecialty(s)} style={{ padding: "0.4rem 1rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer", border: "1.5px solid", borderColor: specialties.includes(s) ? "var(--plum)" : "rgba(155,127,184,0.25)", background: specialties.includes(s) ? "var(--plum)" : "#fff", color: specialties.includes(s) ? "#fff" : "var(--grey)", fontWeight: specialties.includes(s) ? 600 : 400, textTransform: "capitalize" }}>{s}</button>
        ))}
      </div>
      <p style={{ fontSize: "0.75rem", color: "#aaa", margin: "0.4rem 0 0" }}>Leave blank to show them for every service.</p>

      <label style={labelStyle}>Short bio (optional)</label>
      <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2} placeholder="Specialises in balayage and curly cuts…" style={{ ...inputStyle, resize: "vertical" }} />

      {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginTop: "0.85rem" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: "1.1rem" }}>
        <button onClick={save} disabled={saving} className="btn-plum" style={{ padding: "0.7rem 1.75rem", borderRadius: 100, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} style={{ padding: "0.7rem 1.5rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", background: "#fff", cursor: "pointer", fontWeight: 500 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── ServiceManager ───────────────────────────────────────────────────────────
// Real, priced, individually-bookable services for a salon (see
// supabase/migrations/20260804_salon_services.sql) — separate from the
// coarse hair/nails/makeup/lashes category tags on the salon listing
// itself, which stay exactly as they were (stores-listing filters, staff
// specialty matching). A salon with zero rows here is unaffected: its
// public booking form just falls back to the old plain category picker,
// no price, no deposit — this screen is what turns the priced/deposit
// flow on, per service, once the owner adds one.

type SalonService = {
  id: string;
  salon_id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;                  // cents
  deposit_amount: number | null;  // cents — null = no deposit for this service
  is_active: boolean;
  display_order: number;
};

function ServiceManager({ salonId, salonCategories, ownerId }: { salonId: string; salonCategories: string[]; ownerId: string }) {
  const supabase = createClient();
  const [services, setServices] = useState<SalonService[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ id?: string; name: string; category: string; description: string; priceRand: string; depositRand: string; upsellProductIds: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const categories = salonCategories.length ? salonCategories : ALL_SERVICES;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("salon_services").select("*").eq("salon_id", salonId)
      .order("display_order", { ascending: true }).order("created_at", { ascending: true });
    setServices((data as SalonService[]) ?? []);
    setLoading(false);
  }, [salonId, supabase]);

  useEffect(() => { load(); }, [load]);

  const startAdd = () => { setError(""); setForm({ name: "", category: categories[0] ?? "hair", description: "", priceRand: "", depositRand: "", upsellProductIds: [] }); };
  const startEdit = async (s: SalonService) => {
    setError("");
    setForm({ id: s.id, name: s.name, category: s.category, description: s.description ?? "", priceRand: String(s.price / 100), depositRand: s.deposit_amount ? String(s.deposit_amount / 100) : "", upsellProductIds: [] });
    const ids = await loadServiceUpsellIds(supabase, "salon_service_upsell_products", "salon_service_id", s.id);
    setForm((f) => f && f.id === s.id ? { ...f, upsellProductIds: ids } : f);
  };

  const save = async () => {
    if (!form) return;
    const priceNum = parseFloat(form.priceRand);
    if (!form.name.trim()) { setError("Give the service a name."); return; }
    if (!Number.isFinite(priceNum) || priceNum <= 0) { setError("Enter a valid price."); return; }
    let depositCents: number | null = null;
    if (form.depositRand.trim()) {
      const depositNum = parseFloat(form.depositRand);
      if (!Number.isFinite(depositNum) || depositNum <= 0) { setError("Enter a valid deposit amount, or leave it blank for no deposit."); return; }
      if (depositNum < 35) { setError("Deposits must be at least R35 (or leave it blank for no deposit)."); return; }
      if (depositNum > priceNum) { setError("The deposit can't be more than the price."); return; }
      depositCents = Math.round(depositNum * 100);
    }
    setSaving(true); setError("");
    const payload = {
      salon_id: salonId,
      category: form.category,
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Math.round(priceNum * 100),
      deposit_amount: depositCents,
    };
    const { data: saved, error: err } = form.id
      ? await supabase.from("salon_services").update(payload).eq("id", form.id).select("id").single()
      : await supabase.from("salon_services").insert({ ...payload, is_active: true }).select("id").single();
    if (err || !saved) { setSaving(false); setError(err?.message ?? "Failed to save"); return; }
    await syncServiceUpsells(supabase, "salon_service_upsell_products", "salon_service_id", saved.id, form.upsellProductIds);
    setSaving(false);
    setForm(null);
    await load();
  };

  const toggleActive = async (s: SalonService) => {
    await supabase.from("salon_services").update({ is_active: !s.is_active }).eq("id", s.id);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this service? Customers won't be able to book it anymore.")) return;
    await supabase.from("salon_services").delete().eq("id", id);
    await load();
  };

  if (loading) return <p style={{ color: "var(--grey)" }}>Loading…</p>;

  if (form) return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.1rem" }}>
        {form.id ? "Edit service" : "Add a service"}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.9rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Service name *</label>
          <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))} placeholder="e.g. Ladies cut & blow wave" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Category</label>
          <select value={form.category} onChange={e => setForm(f => f && ({ ...f, category: e.target.value }))} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", textTransform: "capitalize" }}>
            {categories.map(c => <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Price (ZAR) *</label>
          <input type="number" min="0" step="1" value={form.priceRand} onChange={e => setForm(f => f && ({ ...f, priceRand: e.target.value }))} placeholder="150" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Deposit (ZAR, optional — R35 minimum if set)</label>
          <input type="number" min="35" step="1" value={form.depositRand} onChange={e => setForm(f => f && ({ ...f, depositRand: e.target.value }))} placeholder="Leave blank for no deposit" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
        </div>
      </div>

      <div style={{ marginBottom: "0.9rem" }}>
        <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Description (optional)</label>
        <textarea value={form.description} onChange={e => setForm(f => f && ({ ...f, description: e.target.value }))} rows={2} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", resize: "vertical" }} />
      </div>

      <UpsellProductPicker
        ownerId={ownerId}
        serviceTags={(UPSELL_TAG_GROUPS.find(g => g.category === form.category)?.tags ?? []).map(t => t.id)}
        selectedProductIds={form.upsellProductIds}
        onChange={(ids) => setForm(f => f && ({ ...f, upsellProductIds: ids }))}
        supabase={supabase}
      />

      {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginBottom: "0.9rem" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} disabled={saving} className="btn-plum" style={{ padding: "0.7rem 1.75rem", borderRadius: 100, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={() => { setForm(null); setError(""); }} style={{ padding: "0.7rem 1.5rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", background: "#fff", cursor: "pointer", fontWeight: 500 }}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "1rem" }}>
        Add the services clients can actually book and pay for — each with its own price, and an optional deposit to secure the booking upfront.
      </p>

      {services.length === 0 && (
        <p style={{ fontSize: "0.9rem", color: "var(--grey)", marginBottom: "1rem" }}>
          No priced services yet — until you add one, the booking form shows your service categories with no price or deposit, same as before.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.25rem" }}>
        {services.map(s => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.9rem 1.1rem", borderRadius: 12, border: "1.5px solid rgba(155,127,184,0.12)", background: "#fff", opacity: s.is_active ? 1 : 0.55 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{s.name}</p>
              <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--grey)", textTransform: "capitalize" }}>
                {fmt(s.price)}{s.deposit_amount ? ` · ${fmt(s.deposit_amount)} deposit` : ""} · {s.category}{!s.is_active ? " · Hidden" : ""}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
              <button type="button" onClick={() => toggleActive(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>
                {s.is_active ? "Hide" : "Unhide"}
              </button>
              <button type="button" onClick={() => startEdit(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>Edit</button>
              <button type="button" onClick={() => remove(s.id)} style={{ background: "none", border: "1.5px solid rgba(229,57,53,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "#E53935", cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={startAdd} className="btn-plum" style={{ padding: "0.6rem 1.5rem", borderRadius: 100, fontWeight: 600, fontSize: "0.85rem" }}>
        + Add a service
      </button>
    </div>
  );
}

// ── MySalonTab ────────────────────────────────────────────────────────────────
// This replaces the MySalonTab function in your dashboard/page.tsx
 
export default function MySalonTab({ user }: { user: { id: string } }) {
  const supabase = createClient();
  const [listings, setListings] = useState<SalonListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SalonListing | null>(null);
  const [innerTab, setInnerTab] = useState<"listing" | "staff" | "bookings">("listing");
 
  useEffect(() => {
    supabase
      .from("partner_salons")
      .select("*")
      .eq("partner_id", user.id)
      .then(({ data }) => {
        if (data) {
  const converted = (data as SalonListing[]).map((salon) => {
    const oh = salon.opening_hours as any;

    if (oh?.weekly) {
      return salon;
    }

    const days = oh?.days ?? [];

    const buildDay = (name: string): DayHours => ({
      closed: !days.includes(name),
      open: oh?.open ?? "08:00",
      close: oh?.close ?? "17:00",
    });

    return {
      ...salon,
      opening_hours: {
        weekly: {
          sunday: buildDay("Sunday"),
          monday: buildDay("Monday"),
          tuesday: buildDay("Tuesday"),
          wednesday: buildDay("Wednesday"),
          thursday: buildDay("Thursday"),
          friday: buildDay("Friday"),
          saturday: buildDay("Saturday"),
        },

        public_holidays: {
          closed: true,
          open: "",
          close: "",
        },

        special_days: [],
      },
    };
  });

  setListings(converted);
}
        setLoading(false);
      });
  }, [user.id]);
 
  const handleSaved = (saved: SalonListing) => {
    setListings(prev => {
      const idx = prev.findIndex(l => l.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [...prev, saved];
    });
    setShowForm(false);
    setEditing(null);
  };
 
  const statusMeta: Record<string, { bg: string; color: string; label: string; desc: string }> = {
    pending:  { bg: "#FAEEDA", color: "#854F0B", label: "Under review",  desc: "We'll review your listing within 24 hours." },
    approved: { bg: "#E1F5EE", color: "#0F6E56", label: "Live",          desc: "Your store is visible in Stores and can receive bookings." },
    rejected: { bg: "#FCEBEB", color: "#A32D2D", label: "Not approved",  desc: "Please edit your listing and resubmit." },
  };

  // CSV store import is now server-side. Keep this UI thin: the backend owns
  // validation, partner ownership and insertion. No auto-reload here —
  // StoreCsvImport shows a "pay to activate" prompt after a successful
  // import (bulk cliff-tier pricing, lib/salon-pricing.ts) and reloading
  // immediately would wipe that out before the partner can pay. The list
  // picks up the new (still pending-review, pending-payment) rows next time
  // this page loads, e.g. when they return from Ozow.
  const storeCsvImporter = (
    <div style={{ marginBottom: "1.25rem" }}>
      <StoreCsvImport />
    </div>
  );
 
  if (loading) return <p style={{ color: "var(--grey)" }}>Loading…</p>;
 
  // ── Add form (no existing listing) ──
  if (listings.length === 0 && (showForm || true)) {
    if (showForm) return (
      <SalonForm initial={emptySalon()} userId={user.id} onSaved={handleSaved}
        onCancel={() => setShowForm(false)} isEdit={false} />
    );
    return (
      <div>
        {storeCsvImporter}
        <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "2rem", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", marginBottom: "0.5rem" }}>List your store on Umuhle</p>
        <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
          Appear in the Stores page and receive appointment bookings directly.
        </p>
          <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.75rem 2rem", borderRadius: 100, fontWeight: 600 }}>
            Add your store
          </button>
        </div>
      </div>
    );
  }
 
  // ── Existing listing view ──
  const listing = listings[0];
  const sm = statusMeta[listing.status ?? "pending"] ?? statusMeta.pending;
 
  if (editing) {
    return (
      <SalonForm initial={editing} userId={user.id} onSaved={handleSaved}
        onCancel={() => setEditing(null)} isEdit />
    );
  }
 
  return (
    <div>
      {storeCsvImporter}
      {/* Status banner */}
      <div style={{ background: sm.bg, color: sm.color, borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontWeight: 700, margin: 0, fontSize: "0.9rem" }}>{sm.label}</p>
          <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.9 }}>{sm.desc}</p>
        </div>
        <button onClick={() => setEditing(listing)} style={{ background: "rgba(255,255,255,0.7)", border: "none", borderRadius: 100, padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", color: sm.color }}>
          Edit
        </button>
      </div>
 
      {/* Inner tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: "1.25rem", borderRadius: 100, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.2)", width: "fit-content" }}>
        {(["listing","staff","bookings"] as const).map((t, i, arr) => (
          <button key={t} onClick={() => setInnerTab(t)} style={{
            padding: "0.5rem 1.25rem", border: "none", cursor: "pointer", fontSize: "0.85rem",
            background: innerTab === t ? "var(--plum)" : "#fff",
            color: innerTab === t ? "#fff" : "var(--grey)",
            fontWeight: innerTab === t ? 600 : 400,
            borderRight: i < arr.length - 1 ? "1.5px solid rgba(155,127,184,0.2)" : "none",
          }}>
            {t === "listing" ? "Listing" : t === "staff" ? "Staff" : "Bookings"}
          </button>
        ))}
      </div>
 
      {innerTab === "listing" && (
        <>
        <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0.75rem" }}>{listing.name}</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "0.5rem" }}>
            📍 {listing.address}, {listing.suburb}{listing.postal_code ? `, ${listing.postal_code}` : ""}
          </p>
          {listing.services?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {listing.services.map(s => (
                <span key={s} style={{ padding: "0.25rem 0.75rem", borderRadius: 100, border: "1px solid rgba(155,127,184,0.3)", fontSize: "0.75rem", color: "var(--plum)", textTransform: "capitalize" }}>{s}</span>
              ))}
            </div>
          )}
          {listing.instagram_username && (
            <p style={{ fontSize: "0.82rem", color: "#C13584", marginBottom: "0.35rem" }}>
              📸 @{listing.instagram_username} <span style={{ background: "#E1F5EE", color: "#0F6E56", borderRadius: 100, padding: "1px 6px", fontSize: "0.7rem", fontWeight: 600, marginLeft: 4 }}>free feed</span>
            </p>
          )}
          {listing.youtube_url && (
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", marginBottom: "0.35rem" }}>▶ YouTube video linked</p>
          )}
          <p style={{ fontSize: "0.78rem", color: "#bbb", marginTop: "0.75rem" }}>
            {listing.gallery_urls?.length ?? 0} photos uploaded
          </p>
          {listing.status === "approved" && (
            <a href={`/stores/${listing.id}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-block", marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--plum)", fontWeight: 500 }}>
              View live page →
            </a>
          )}
        </div>

        {listing.id && (
          <div style={{ marginTop: "1.5rem" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0.75rem" }}>Services</h3>
            <ServiceManager salonId={listing.id} salonCategories={listing.services ?? []} ownerId={user.id} />
          </div>
        )}
        </>
      )}

      {innerTab === "staff" && listing.id && (
        <BranchStaffManager salonId={listing.id} salonServices={listing.services ?? []} />
      )}

      {innerTab === "bookings" && listing.id && (
        <SalonBookingsInbox salonId={listing.id} />
      )}
    </div>
  );
}
