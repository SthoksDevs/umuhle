"use client";

// components/ProximityFilter.tsx
//
// "Filter by proximity" section embedded inside the filter dropdown on:
//   - app/page.tsx        (customer homepage — artists)
//   - app/stores/page.tsx (customer stores page — salons)
//
// Replaces the old page-level "Showing artists/salons within 50km of you.
// Show all instead" banner. The radius is now a draggable slider the
// customer sets themselves (5km steps, capped at maxKm) — there's no more
// "show all" escape hatch, since maxKm already returns everything
// nearby_artists()/nearby_salons() would (see
// supabase/migrations/20260727_proximity_and_push.sql).
//
// Also owns the "please turn on location" prompt that used to live in the
// banner, so opening the filter is the one place a customer both grants
// location and adjusts how far it searches.

import type { GeoStatus } from "@/lib/geolocation";

export default function ProximityFilter({
  geoStatus,
  radiusKm,
  onRadiusChange,
  onRequestLocation,
  minKm = 5,
  maxKm = 50,
  stepKm = 5,
  subject = "results",
}: {
  geoStatus: GeoStatus;
  radiusKm: number;
  onRadiusChange: (km: number) => void;
  onRequestLocation: () => void;
  minKm?: number;
  maxKm?: number;
  stepKm?: number;
  subject?: string;
}) {
  const labelStyle: React.CSSProperties = {
    fontSize: "0.72rem", fontWeight: 600, color: "var(--grey)",
    textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem",
  };
  const hintStyle: React.CSSProperties = { fontSize: "0.85rem", color: "var(--grey)", margin: "0 0 0.6rem", lineHeight: 1.4 };
  const btnStyle: React.CSSProperties = { padding: "0.4rem 1rem", fontSize: "0.8rem" };

  return (
    <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(155,127,184,0.15)" }}>
      <p style={labelStyle}>Filter by proximity</p>

      {geoStatus === "granted" && (
        <div>
          <div style={{ fontSize: "0.9rem", color: "var(--onyx)", fontWeight: 500, marginBottom: "0.6rem" }}>
            Within {radiusKm} km
          </div>
          <input
            type="range"
            min={minKm}
            max={maxKm}
            step={stepKm}
            value={radiusKm}
            onChange={e => onRadiusChange(Number(e.target.value))}
            aria-label={`Search radius in kilometers, up to ${maxKm}`}
            style={{ width: "100%", accentColor: "var(--plum)", cursor: "pointer", display: "block" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--grey)", marginTop: "0.25rem" }}>
            <span>{minKm} km</span>
            <span>{maxKm} km</span>
          </div>
        </div>
      )}

      {geoStatus === "checking" && (
        <p style={{ ...hintStyle, margin: 0 }}>Finding your location…</p>
      )}

      {geoStatus === "idle" && (
        <div>
          <p style={hintStyle}>Turn on location to filter {subject} by distance.</p>
          <button onClick={onRequestLocation} className="btn-outline" style={btnStyle}>
            Use my location
          </button>
        </div>
      )}

      {geoStatus === "denied" && (
        <p style={{ ...hintStyle, margin: 0 }}>
          Location access is blocked. Enable it in your browser&apos;s site settings to filter by proximity.
        </p>
      )}

      {geoStatus === "unavailable" && (
        <div>
          <p style={hintStyle}>Couldn&apos;t pin your location just now.</p>
          <button onClick={onRequestLocation} className="btn-outline" style={btnStyle}>
            Try again
          </button>
        </div>
      )}

      {geoStatus === "unsupported" && (
        <p style={{ ...hintStyle, margin: 0 }}>Your browser doesn&apos;t support location filtering.</p>
      )}
    </div>
  );
}
