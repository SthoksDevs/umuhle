"use client";
// app/stores/page.tsx — Stores archive page (uses partner_salons table)

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import { useGeolocation, type GeoStatus } from "@/lib/geolocation";
import { getProvince } from "@/lib/provinces";
import ProximityFilter from "@/components/ProximityFilter";

// Default/max reach of the "Filter by proximity" slider (5km steps, see
// components/ProximityFilter.tsx). Kept in sync with app/page.tsx's
// NEARBY_RADIUS_KM and nearby_salons()'s own radius_km default in
// supabase/migrations/20260727_proximity_and_push.sql.
const NEARBY_RADIUS_KM = 50;
const PROXIMITY_MIN_KM = 5;
const PROXIMITY_STEP_KM = 5;

// Radius used only to fetch same-province fallback candidates (see
// fetchProvinceFallback below) — wide enough to cover the whole country so
// we get every location-tagged salon back, then filter to the customer's
// own province client-side via lib/provinces.ts.
const PROVINCE_FALLBACK_RADIUS_KM = 2000;

import { isOpenNow, type OpeningHours } from "@/lib/opening-hours";

type Salon = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  phone: string | null;
  gallery_urls: string[] | null;
  instagram_username: string | null;
  opening_hours: OpeningHours | null;
  services: string[] | null;
  latitude: number | null;
  longitude: number | null;
};

// ── Store card ─────────────────────────────────────────────────────────────────
function StoreCard({ salon, farDistanceKm }: { salon: Salon; farDistanceKm?: number }) {
  const { open, label } = isOpenNow(salon.opening_hours);
  const cover = salon.gallery_urls?.[0] ?? null;
  const isFar = typeof farDistanceKm === "number";
  return (
    <Link href={`/stores/${salon.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div
        style={{ borderRadius: 18, overflow: "hidden", border: isFar ? "1.5px solid var(--nude)" : "1.5px solid rgba(155,127,184,0.15)", background: isFar ? "rgba(194,127,184,0.04)" : "#fff", transition: "transform 0.2s, box-shadow 0.2s", cursor: "pointer" }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = "translateY(-3px)"; el.style.boxShadow = "0 12px 40px rgba(155,127,184,0.15)"; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ""; el.style.boxShadow = ""; }}
      >
        <div style={{ height: 180, overflow: "hidden", position: "relative", background: "rgba(155,127,184,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {cover
            ? <Image src={cover} alt={salon.name} fill style={{ objectFit: "cover" }} />
            : <Image src="/umuhle-icon.png" alt="Umuhle" width={72} height={72} style={{ objectFit: "contain", opacity: 0.35 }} />
          }
          <span style={{ position: "absolute", top: 10, right: 10, background: open ? "rgba(43,107,69,0.9)" : "rgba(40,40,40,0.7)", color: "#fff", borderRadius: 100, padding: "0.2rem 0.65rem", fontSize: "0.72rem", fontWeight: 600, backdropFilter: "blur(4px)" }}>
            {open ? "Open" : "Closed"}
          </span>
          {salon.instagram_username && (
            <span style={{ position: "absolute", bottom: 10, right: 10, background: "rgba(255,255,255,0.9)", borderRadius: 100, padding: "0.2rem 0.65rem", fontSize: "0.7rem", fontWeight: 500, color: "#C13584", backdropFilter: "blur(4px)" }}>
              IG
            </span>
          )}
          {isFar && (
            <span style={{ position: "absolute", bottom: 10, left: 10, background: "var(--nude)", color: "#fff", borderRadius: 100, padding: "0.2rem 0.65rem", fontSize: "0.72rem", fontWeight: 600, backdropFilter: "blur(4px)" }}>
              ~{Math.round(farDistanceKm!)} km away
            </span>
          )}
        </div>
        <div style={{ padding: "1rem" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.05rem", marginBottom: "0.2rem" }}>{salon.name}</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.35rem" }}>📍 {salon.suburb}{salon.city ? `, ${salon.city}` : ""}</p>
          <p style={{ fontSize: "0.78rem", color: open ? "#2B6B45" : "#888", marginBottom: "0.6rem", fontWeight: 500 }}>{label}</p>
          {salon.services && salon.services.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: "0.75rem" }}>
              {salon.services.map(svc => (
                <span key={svc} style={{ fontSize: "0.7rem", padding: "0.2rem 0.55rem", borderRadius: 100, border: "1px solid rgba(155,127,184,0.3)", color: "var(--plum)", fontWeight: 500, textTransform: "capitalize" }}>{svc}</span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.78rem", color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{salon.address}</span>
            <span style={{ fontSize: "0.78rem", color: "var(--plum)", fontWeight: 600, padding: "0.3rem 0.85rem", borderRadius: 100, border: "1.5px solid var(--plum)", whiteSpace: "nowrap" }}>Book →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────
const FILTER_CATS = ["Hair","Nails","Makeup","Lashes","Open now"] as const;
type FilterCat = typeof FILTER_CATS[number];

// ── Merged search + filter bar ─────────────────────────────────────────────────
function SearchWithFilter({
  searchValue,
  onSearchChange,
  activeFilters,
  onFiltersChange,
  placeholder = "Search…",
  geoStatus,
  radiusKm,
  onRadiusChange,
  onRequestLocation,
}: {
  searchValue: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activeFilters: FilterCat[];
  onFiltersChange: (filters: FilterCat[]) => void;
  placeholder?: string;
  geoStatus: GeoStatus;
  radiusKm: number;
  onRadiusChange: (km: number) => void;
  onRequestLocation: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (cat: FilterCat) => {
    const next = activeFilters.includes(cat)
      ? activeFilters.filter(c => c !== cat)
      : [...activeFilters, cat];
    onFiltersChange(next);
  };

  const activeCount = activeFilters.length + (radiusKm !== NEARBY_RADIUS_KM ? 1 : 0);

  return (
    <div ref={dropRef} style={{ maxWidth: 600, margin: "0 auto", position: "relative" }}>
      <div style={{
        display: "flex", alignItems: "center", background: "#fff",
        borderRadius: 100, border: "2px solid rgba(255,255,255,0.4)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden",
      }}>
        <span style={{ paddingLeft: "1.1rem", color: "var(--grey)", fontSize: "1rem", flexShrink: 0 }}>🔍</span>
        <input
          type="text"
          placeholder={placeholder}
          value={searchValue}
          onChange={onSearchChange}
          style={{
            flex: 1, border: "none", outline: "none", padding: "0.85rem 0.75rem",
            fontSize: "0.95rem", color: "var(--onyx)", background: "transparent", minWidth: 0,
          }}
        />
        <div style={{ width: 1, height: 24, background: "rgba(155,127,184,0.2)", flexShrink: 0 }} />
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            padding: "0.7rem 1.1rem", border: "none", background: "transparent",
            cursor: "pointer", color: activeCount > 0 ? "var(--plum)" : "var(--grey)",
            fontSize: "0.875rem", fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap",
          }}
        >
          <svg width="15" height="13" viewBox="0 0 15 13" fill="none"><path d="M0 1h15M3 6.5h9M6 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          Filter{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.2)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.14)", padding: "1rem", minWidth: 220, zIndex: 9999,
        }}>
          <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>Filter by category</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
            {FILTER_CATS.map(cat => {
              const checked = activeFilters.includes(cat);
              return (
                <label key={cat} style={{ display: "flex", alignItems: "center", gap: "0.65rem", padding: "0.5rem 0.4rem", borderRadius: 10, cursor: "pointer", background: checked ? "var(--plum-t)" : "transparent", transition: "background 0.15s" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(cat)} style={{ accentColor: "var(--plum)", width: 16, height: 16, cursor: "pointer" }} />
                  <span style={{ fontSize: "0.9rem", color: checked ? "var(--plum)" : "var(--onyx)", fontWeight: checked ? 500 : 400 }}>{cat}</span>
                </label>
              );
            })}
          </div>

          <ProximityFilter
            geoStatus={geoStatus}
            radiusKm={radiusKm}
            onRadiusChange={onRadiusChange}
            onRequestLocation={onRequestLocation}
            minKm={PROXIMITY_MIN_KM}
            maxKm={NEARBY_RADIUS_KM}
            stepKm={PROXIMITY_STEP_KM}
            subject="salons"
          />

          {activeCount > 0 && (
            <button onClick={() => { onFiltersChange([]); onRadiusChange(NEARBY_RADIUS_KM); }} style={{ marginTop: "0.75rem", width: "100%", padding: "0.45rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "transparent", color: "var(--grey)", fontSize: "0.82rem", cursor: "pointer" }}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function StoresPage() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [salons, setSalons] = useState<Salon[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<FilterCat[]>([]);

  // Proximity — see lib/geolocation.ts, components/ProximityFilter.tsx and
  // app/page.tsx (same pattern). `radiusKm` is customer-controlled via the
  // "Filter by proximity" slider in the filter dropdown.
  const geo = useGeolocation();
  const [radiusKm, setRadiusKm] = useState(NEARBY_RADIUS_KM);
  const [distanceById, setDistanceById] = useState<Record<string, number> | null>(null);

  // Wait for the initial silent geolocation check (lib/geolocation.ts) to
  // settle before the very first fetch — same reasoning as app/page.tsx:
  // without this, a returning visitor with location already granted sees
  // an unfiltered list render, then get replaced moments later by their
  // real nearby list. Capped at 4s so a slow/unavailable GPS fix doesn't
  // block the page indefinitely.
  const [geoSettleTimedOut, setGeoSettleTimedOut] = useState(false);
  useEffect(() => {
    // Once autoCheckDone has already resolved, this fallback timer has
    // nothing left to do — without this guard it kept firing 4s after
    // EVERY mount regardless, flipping geoSettleTimedOut false->true and
    // (since it's a dep of the fetch effect below) triggering a second,
    // totally spurious re-fetch of the whole list a few seconds after the
    // first one, on every visit, independent of auth state.
    if (geo.autoCheckDone) return;
    const t = setTimeout(() => setGeoSettleTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [geo.autoCheckDone]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
      if (user) supabase.from("profiles").select("full_name,avatar_url,phone").eq("id", user.id).single().then(({ data }) => { if (data) setProfile(data as Profile); });
    });
  }, []);

  useEffect(() => {
    if (!geo.autoCheckDone && !geoSettleTimedOut) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      if (geo.status === "granted" && geo.coords) {
        const { data: nearby, error: nearbyErr } = await supabase.rpc("nearby_salons", {
          user_lat: geo.coords.latitude,
          user_lng: geo.coords.longitude,
          radius_km: radiusKm,
        });
        if (!nearbyErr) {
          const rows = (nearby ?? []) as { id: string; distance_km: number }[];
          if (cancelled) return;
          setDistanceById(Object.fromEntries(rows.map(r => [r.id, r.distance_km])));
          if (rows.length === 0) { setSalons([]); setLoading(false); return; }
          const { data } = await supabase
            .from("partner_salons")
            .select("id,name,description,address,suburb,city,phone,gallery_urls,instagram_username,opening_hours,services,latitude,longitude")
            .eq("status", "approved")
            .in("id", rows.map(r => r.id));
          if (cancelled) return;
          setSalons((data as Salon[]) ?? []);
          setLoading(false);
          return;
        }
        // RPC error — fall through to the unfiltered query below.
      }

      setDistanceById(null);
      const { data } = await supabase
        .from("partner_salons")
        .select("id,name,description,address,suburb,city,phone,gallery_urls,instagram_username,opening_hours,services,latitude,longitude")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setSalons((data as Salon[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [geo.status, geo.coords, radiusKm, geo.autoCheckDone, geoSettleTimedOut]);

  const matchesFilters = useCallback((s: Salon) => {
    const q = search.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || (s.suburb ?? "").toLowerCase().includes(q) || (s.city ?? "").toLowerCase().includes(q);
    const catFilters = activeFilters.filter(f => f !== "Open now");
    const matchSvc = catFilters.length === 0 || catFilters.some(f => (s.services ?? []).includes(f.toLowerCase()));
    const matchOpen = !activeFilters.includes("Open now") || isOpenNow(s.opening_hours).open;
    return matchQ && matchSvc && matchOpen;
  }, [search, activeFilters]);

  const filtered = salons
    .filter(matchesFilters)
    .sort((a, b) => {
      if (!distanceById) return 0;
      return (distanceById[a.id] ?? Infinity) - (distanceById[b.id] ?? Infinity);
    });

  // ── Province fallback (see lib/provinces.ts and app/page.tsx — same
  // pattern). Only kicks in once the customer has already widened the
  // proximity slider all the way to NEARBY_RADIUS_KM and still got zero
  // results — instead of a dead end we show what's elsewhere in their own
  // province, clearly flagged as further afield (warning-coloured card + a
  // "Xkm away" badge). Replaces the old "show all instead" escape hatch.
  const [provinceFallback, setProvinceFallback] = useState<{ salon: Salon; distanceKm: number }[]>([]);
  const [provinceName, setProvinceName] = useState<string | null>(null);

  const fetchProvinceFallback = useCallback(async () => {
    if (!(filtered.length === 0 && geo.status === "granted" && geo.coords && radiusKm === NEARBY_RADIUS_KM)) {
      setProvinceFallback([]);
      return;
    }
    const myProvince = getProvince(geo.coords);
    const { data: nearby, error: nearbyErr } = await supabase.rpc("nearby_salons", {
      user_lat: geo.coords.latitude,
      user_lng: geo.coords.longitude,
      radius_km: PROVINCE_FALLBACK_RADIUS_KM,
    });
    if (nearbyErr || !nearby) { setProvinceFallback([]); return; }
    const rows = (nearby ?? []) as { id: string; distance_km: number }[];
    if (rows.length === 0) { setProvinceFallback([]); return; }

    const { data } = await supabase
      .from("partner_salons")
      .select("id,name,description,address,suburb,city,phone,gallery_urls,instagram_username,opening_hours,services,latitude,longitude")
      .eq("status", "approved")
      .in("id", rows.map(r => r.id));

    const distanceBySalonId = Object.fromEntries(rows.map(r => [r.id, r.distance_km]));
    const inProvince = ((data ?? []) as Salon[])
      .filter(matchesFilters)
      .filter(s => s.latitude != null && s.longitude != null && getProvince({ latitude: s.latitude, longitude: s.longitude }) === myProvince)
      .sort((a, b) => (distanceBySalonId[a.id] ?? Infinity) - (distanceBySalonId[b.id] ?? Infinity))
      .slice(0, 8);

    setProvinceName(myProvince);
    setProvinceFallback(inProvince.map(s => ({ salon: s, distanceKm: distanceBySalonId[s.id] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, geo.status, geo.coords, radiusKm, matchesFilters]);

  useEffect(() => {
    fetchProvinceFallback();
  }, [fetchProvinceFallback]);

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8" }}>
      <SiteHeader initialUser={user} initialProfile={profile} />

      {/* Hero — overflow:visible so the filter dropdown is not clipped */}
      <div style={{
        background: "linear-gradient(90deg, #9B7FB8 0%, #f4eff8 100%)",
        padding: "4rem 1.5rem 3.5rem",
        position: "relative",
        /* NO overflow:hidden here — that was clipping the dropdown */
      }}>
        <div style={{ maxWidth: 680, margin: "0 auto", position: "relative", zIndex: 1, textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "clamp(1.75rem,5vw,2.5rem)", marginBottom: "0.4rem", color: "#fff" }}>Beauty stores near you</h1>
          <p style={{ color: "rgba(255,255,255,0.85)", fontSize: "1rem", marginBottom: "1.75rem" }}>Book hair, nails, makeup or lashes at a verified Umuhle partner store.</p>
          <SearchWithFilter
            searchValue={search}
            onSearchChange={e => setSearch(e.target.value)}
            activeFilters={activeFilters}
            onFiltersChange={setActiveFilters}
            placeholder="Search by store name or suburb…"
            geoStatus={geo.status}
            radiusKm={radiusKm}
            onRadiusChange={setRadiusKm}
            onRequestLocation={geo.request}
          />
        </div>
      </div>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "4rem", color: "var(--grey)" }}>Loading stores…</div>
        ) : filtered.length === 0 && geo.status === "granted" ? (
          <div style={{ textAlign: "center", padding: "4rem" }}>
            <p style={{ fontSize: "1.1rem", color: "var(--grey)" }}>
              No salons within {radiusKm}km of you right now.
              {radiusKm < NEARBY_RADIUS_KM && " Try widening your search radius in the filter above."}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "4rem" }}>
            <p style={{ fontSize: "1.1rem", color: "var(--grey)", marginBottom: "0.5rem" }}>No salons found.</p>
            <p style={{ fontSize: "0.9rem", color: "#bbb" }}>Try a different suburb or filter.</p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "1.25rem" }}>{filtered.length} salon{filtered.length !== 1 ? "s" : ""}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1.25rem" }}>
              {filtered.map(s => <StoreCard key={s.id} salon={s} />)}
            </div>
          </>
        )}

        {provinceFallback.length > 0 && (
          <div style={{ marginTop: filtered.length === 0 ? "0.5rem" : "3rem" }}>
            <p style={{ fontSize: "0.85rem", color: "var(--grey)", textAlign: "center", marginBottom: "1.25rem" }}>
              A little further afield, in {provinceName}:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1.25rem" }}>
              {provinceFallback.map(({ salon, distanceKm: farKm }) => (
                <StoreCard key={salon.id} salon={salon} farDistanceKm={farKm} />
              ))}
            </div>
          </div>
        )}

        {/* List a Store CTA */}
        <div style={{ marginTop: "3rem", background: "linear-gradient(135deg,var(--plum-t) 0%,#fff 60%)", borderRadius: 20, padding: "3rem 2rem", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", color: "var(--onyx)", marginBottom: "0.75rem" }}>
            Own a beauty <em style={{ color: "var(--plum)", fontStyle: "italic" }}>salon or store</em>?
          </h2>
          <p style={{ color: "var(--grey)", maxWidth: 420, margin: "0 auto 1.5rem", fontSize: "0.95rem" }}>
            List your store on Umuhle and get discovered by clients booking hair, nail, makeup and lash appointments near them.
          </p>
          <Link href="/register?type=business_partner"><button className="btn-plum">List a Store</button></Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
