"use client";
// app/stores/page.tsx — Stores archive page (uses partner_salons table)

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";

type OpeningHours = { days: string[]; open: string; close: string };

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

// ── Open/closed logic ─────────────────────────────────────────────────────────
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function isOpenNow(s: Salon): { open: boolean; label: string } {
  const oh = s.opening_hours;
  if (!oh?.days?.length) return { open: false, label: "Hours not listed" };
  const now = new Date();
  const dayName = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oH, oM] = (oh.open ?? "08:00").split(":").map(Number);
  const [cH, cM] = (oh.close ?? "17:00").split(":").map(Number);
  const open = oh.days.includes(dayName) && cur >= oH * 60 + oM && cur < cH * 60 + cM;
  if (open) return { open: true, label: `Open · closes ${oh.close}` };
  const todayIdx = DAYS.indexOf(dayName);
  for (let i = 1; i <= 7; i++) {
    const ni = (todayIdx + i) % 7;
    if (oh.days.includes(DAYS[ni])) {
      return { open: false, label: i === 1 ? `Closed · opens tomorrow ${oh.open}` : `Closed · opens ${DAYS[ni].slice(0,3)} ${oh.open}` };
    }
  }
  return { open: false, label: "Closed" };
}

// ── Store card ─────────────────────────────────────────────────────────────────
function StoreCard({ salon }: { salon: Salon }) {
  const { open, label } = isOpenNow(salon);
  const cover = salon.gallery_urls?.[0] ?? null;
  return (
    <Link href={`/stores/${salon.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div
        style={{ borderRadius: 18, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff", transition: "transform 0.2s, box-shadow 0.2s", cursor: "pointer" }}
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
}: {
  searchValue: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activeFilters: FilterCat[];
  onFiltersChange: (filters: FilterCat[]) => void;
  placeholder?: string;
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

  const activeCount = activeFilters.length;

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
          boxShadow: "0 16px 48px rgba(0,0,0,0.14)", padding: "1rem", minWidth: 220, zIndex: 100,
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
          {activeCount > 0 && (
            <button onClick={() => onFiltersChange([])} style={{ marginTop: "0.75rem", width: "100%", padding: "0.45rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "transparent", color: "var(--grey)", fontSize: "0.82rem", cursor: "pointer" }}>
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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
      if (user) supabase.from("profiles").select("full_name,avatar_url,phone").eq("id", user.id).single().then(({ data }) => { if (data) setProfile(data as Profile); });
    });
  }, []);

  useEffect(() => {
    supabase.from("partner_salons").select("id,name,description,address,suburb,city,phone,gallery_urls,instagram_username,opening_hours,services,latitude,longitude").eq("status","approved").order("created_at",{ascending:false})
      .then(({ data }) => { setSalons((data as Salon[]) ?? []); setLoading(false); });
  }, []);

  const filtered = salons.filter(s => {
    const q = search.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || (s.suburb ?? "").toLowerCase().includes(q) || (s.city ?? "").toLowerCase().includes(q);
    const catFilters = activeFilters.filter(f => f !== "Open now");
    const matchSvc = catFilters.length === 0 || catFilters.some(f => (s.services ?? []).includes(f.toLowerCase()));
    const matchOpen = !activeFilters.includes("Open now") || isOpenNow(s).open;
    return matchQ && matchSvc && matchOpen;
  });

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8" }}>
      <SiteHeader initialUser={user} initialProfile={profile} />
      {/* Gradient hero with merged search+filter */}
      <div style={{ background: "linear-gradient(135deg, #6B4F8A 0%, #9B7FB8 40%, #C28070 80%, #D4956B 100%)", padding: "4rem 1.5rem 3rem", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.18)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 680, margin: "0 auto", position: "relative", zIndex: 1, textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "clamp(1.75rem,5vw,2.5rem)", marginBottom: "0.4rem", color: "#fff" }}>Beauty salons near you</h1>
          <p style={{ color: "rgba(255,255,255,0.85)", fontSize: "1rem", marginBottom: "1.75rem" }}>Book hair, nails, makeup or lashes at a verified Umuhle partner salon.</p>
          <SearchWithFilter
            searchValue={search}
            onSearchChange={e => setSearch(e.target.value)}
            activeFilters={activeFilters}
            onFiltersChange={setActiveFilters}
            placeholder="Search by salon name or suburb…"
          />
        </div>
      </div>
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "4rem", color: "var(--grey)" }}>Loading salons…</div>
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
      </main>
      <Footer />
    </div>
  );
}
