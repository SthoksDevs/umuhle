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
const FILTERS = ["All","Hair","Nails","Makeup","Lashes","Open now"] as const;
type Filter = typeof FILTERS[number];

function FilterNav({ active, onChange }: { active: Filter; onChange: (f: Filter) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const check = () => setCanScroll(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    check(); el.addEventListener("scroll", check); window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, []);
  return (
    <div style={{ position: "relative", padding: "0 1.5rem" }}>
      <div ref={ref} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
        <div style={{ display: "flex", gap: 0, width: "max-content", minWidth: "90vw" }}>
          {FILTERS.map((f, i) => {
            const on = active === f; const first = i === 0; const last = i === FILTERS.length - 1;
            return (
              <button key={f} onClick={() => onChange(f)} style={{ flex: "0 0 auto", padding: "0.55rem 1.1rem", background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)", border: "1.5px solid", borderColor: on ? "var(--plum)" : "rgba(155,127,184,0.25)", borderRadius: first ? "100px 0 0 100px" : last ? "0 100px 100px 0" : "0", borderLeft: !first ? "none" : undefined, fontWeight: on ? 600 : 400, fontSize: "0.85rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                {f}
              </button>
            );
          })}
        </div>
      </div>
      {canScroll && <button onClick={() => ref.current?.scrollBy({ left: 160, behavior: "smooth" })} aria-label="Scroll" style={{ position: "absolute", right: "1.5rem", top: "50%", transform: "translateY(-50%)", background: "linear-gradient(to left,#fff 60%,transparent)", border: "none", cursor: "pointer", padding: "0.35rem 0.5rem 0.35rem 1.5rem", color: "var(--plum)", fontSize: "1.1rem" }}>›</button>}
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
  const [filter, setFilter] = useState<Filter>("All");

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
    const matchSvc = filter === "All" || filter === "Open now" || (s.services ?? []).includes(filter.toLowerCase());
    const matchOpen = filter !== "Open now" || isOpenNow(s).open;
    return matchQ && matchSvc && matchOpen;
  });

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8" }}>
      <SiteHeader initialUser={user} initialProfile={profile} />
      <div style={{ background: "linear-gradient(135deg,rgba(155,127,184,0.12) 0%,rgba(194,128,112,0.08) 100%)", padding: "3rem 1.5rem 2rem" }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "clamp(1.75rem,5vw,2.5rem)", marginBottom: "0.4rem", color: "#1a1a1a" }}>Beauty salons near you</h1>
          <p style={{ color: "var(--grey)", fontSize: "1rem", marginBottom: "1.5rem" }}>Book hair, nails, makeup or lashes at a verified Umuhle partner salon.</p>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", fontSize: "1.1rem", color: "var(--grey)", pointerEvents: "none" }}>🔍</span>
            <input type="search" placeholder="Search by salon name or suburb…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", padding: "0.85rem 1rem 0.85rem 2.75rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", background: "#fff", fontSize: "0.95rem", outline: "none" }} />
          </div>
        </div>
      </div>
      <div style={{ padding: "1rem 0", background: "#fff", borderBottom: "1px solid rgba(155,127,184,0.1)" }}>
        <FilterNav active={filter} onChange={setFilter} />
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
