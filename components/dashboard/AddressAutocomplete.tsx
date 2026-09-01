"use client";

// components/dashboard/AddressAutocomplete.tsx
//
// A live, as-you-type South African address search (backed by OpenStreetMap
// Nominatim via app/api/geocode/suggest) — picking a result fills address,
// suburb, city, postal code AND latitude/longitude all at once, straight
// from a match Nominatim already resolved. This is what actually prevents
// the "geocode failed on save" problem, rather than just patching it: the
// coordinates never depend on re-parsing whatever ended up typed across
// five separate fields.
//
// Used by both components/dashboard/ProfileTab.tsx (PartnerFulfillmentSettings)
// and components/dashboard/MySalonTab.tsx (SalonForm) — split out to its own
// file for that reason. Previously defined once inside the app/dashboard/page.tsx
// monolith, where both call sites lived in the same module.

import { useState, useEffect, useRef } from "react";

export type GeocodeSuggestion = { displayName: string; latitude: number; longitude: number; street: string; suburb: string; city: string; postalCode: string };

export default function AddressAutocomplete({ onSelect }: { onSelect: (r: GeocodeSuggestion) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 4) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults((data.results as GeocodeSuggestion[]) ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 450); // Nominatim's usage policy asks for ~1 request/second, max
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // lets the click below land first
        placeholder="Start typing your address…"
        style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", outline: "none" }}
      />
      {loading && <p style={{ fontSize: "0.75rem", color: "#aaa", marginTop: "0.3rem" }}>Searching…</p>}
      {open && results.length > 0 && (
        <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 12, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 260, overflowY: "auto" }}>
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onSelect(r); setQuery(r.displayName); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "0.65rem 0.9rem", border: "none", background: "none", cursor: "pointer", fontSize: "0.82rem", color: "var(--onyx)", borderBottom: i < results.length - 1 ? "1px solid rgba(155,127,184,0.1)" : "none" }}
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
