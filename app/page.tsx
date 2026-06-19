"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Artist, Profile, Booking } from "@/types";
import { v4 as uuidv4 } from "uuid";
import Image from "next/image";

// ── Pixel helpers (typed) ───────────────────────────────────────────────────
declare global {
  interface Window {
    ttq?: { track: (e: string, p?: Record<string, unknown>) => void; identify: (p: Record<string, unknown>) => void; };
    fbq?: (cmd: string, event: string, params?: Record<string, unknown>) => void;
    gtag?: (...a: unknown[]) => void;
  }
}
function ttq(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.ttq) window.ttq.track(event, params);
}
function fbq(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.fbq) window.fbq("track", event, params);
}
function gtag(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.gtag) window.gtag("event", event, params);
}

// ── Umuhle icon (replaces all Unsplash images) ────────────────────────────
const ICON = "/umuhle-icon.png";

// ── Mock data ─────────────────────────────────────────────────────────────
const MOCK_ARTISTS: Artist[] = [
  { id: "a1", profile_id: "p1", display_name: "Zanele Mokoena", bio: "Natural hair specialist with 8 years experience. Braids, locs, and protective styles.", category: "hair", location: "Sandton, JHB", suburb: "Sandton", city: "Johannesburg", avatar_url: ICON, cover_url: null, rating: 4.9, review_count: 124, is_verified: true, is_active: true, created_at: "" },
  { id: "a2", profile_id: "p2", display_name: "Nomvula Dlamini", bio: "Nail art & gel extensions. Trendy designs, clean finish. Walk-ins welcome.", category: "nails", location: "Rosebank, JHB", suburb: "Rosebank", city: "Johannesburg", avatar_url: ICON, cover_url: null, rating: 4.7, review_count: 89, is_verified: true, is_active: true, created_at: "" },
  { id: "a3", profile_id: "p3", display_name: "Lerato Sithole", bio: "Bridal & event makeup. Airbrush certified. Serving JHB & PTA.", category: "makeup", location: "Midrand, JHB", suburb: "Midrand", city: "Johannesburg", avatar_url: ICON, cover_url: null, rating: 5.0, review_count: 56, is_verified: true, is_active: true, created_at: "" },
];

const MOCK_SERVICES: Record<string, { id: string; name: string; price: number; duration_minutes: number }[]> = {
  a1: [{ id: "s1a", name: "Box Braids (medium)", price: 85000, duration_minutes: 240 }, { id: "s1b", name: "Knotless Braids", price: 95000, duration_minutes: 300 }, { id: "s1c", name: "Loc Retwist", price: 35000, duration_minutes: 90 }],
  a2: [{ id: "s2a", name: "Gel Manicure", price: 28000, duration_minutes: 60 }, { id: "s2b", name: "Acrylic Set", price: 45000, duration_minutes: 90 }, { id: "s2c", name: "Nail Art (per nail)", price: 5000, duration_minutes: 15 }],
  a3: [{ id: "s3a", name: "Full Glam Makeup", price: 120000, duration_minutes: 90 }, { id: "s3b", name: "Natural Day Look", price: 75000, duration_minutes: 60 }, { id: "s3c", name: "Bridal Package", price: 220000, duration_minutes: 180 }],
};

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
// Skincare removed
const CATEGORIES = ["All", "Hair", "Nails", "Makeup", "Lashes"];
const CAT_ICONS: Record<string, string> = { hair: "✂", nails: "◈", makeup: "◉", lashes: "◎" };

// ── Cart type ─────────────────────────────────────────────────────────────
type CartItem = { id: string; name: string; price: number };

// ── Social links (footer only) ────────────────────────────────────────────
const SOCIALS = [
  { label: "Facebook",  href: "https://web.facebook.com/umuhlebeautiful" },
  { label: "Instagram", href: "https://www.instagram.com/umuhle_beautiful/" },
  { label: "TikTok",    href: "http://tiktok.com/@umuhle_beautiful" },
  { label: "WhatsApp",  href: "https://wa.me/27733014819" },
];

// ── Ad packages ──────────────────────────────────────────────────────────
const AD_PACKAGES = [
  { id: "starter",  name: "Starter",  price: 20,  ads: 1,  duration: "6 weeks",  featured: false },
  { id: "standard", name: "Standard", price: 45,  ads: 3,  duration: "2 months", featured: false },
  { id: "growth",   name: "Growth",   price: 75,  ads: 6,  duration: "3 months", featured: true  },
  { id: "pro",      name: "Pro",      price: 115, ads: 10, duration: "6 months", featured: false },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const supabase = createClient();

  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  type Tab = "home" | "shop" | "earn" | "dashboard";
  const [activeTab, setActiveTab]           = useState<Tab>("home");
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery]       = useState("");
  const [showAuthModal, setShowAuthModal]   = useState(false);
  const [authMode, setAuthMode]             = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading]       = useState(false);
  const [authError, setAuthError]           = useState("");
  const [authForm, setAuthForm]             = useState({ email: "", password: "", name: "", phone: "" });

  // Cart
  const [cart, setCart]       = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  // Booking
  const [selectedArtist, setSelectedArtist]   = useState<Artist | null>(null);
  const [selectedService, setSelectedService] = useState<{ id: string; name: string; price: number; duration_minutes: number } | null>(null);
  const [bookingDate, setBookingDate]         = useState("");
  const [bookingTime, setBookingTime]         = useState("");
  const [bookingNotes, setBookingNotes]       = useState("");
  const [bookingStep, setBookingStep]         = useState<"services" | "datetime" | "confirm">("services");
  const [bookingLoading, setBookingLoading]   = useState(false);

  // ── Auth listener ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) fetchProfile(user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (data) setProfile(data);
  };

  // ── Auth actions ───────────────────────────────────────────────────────
  const handleEmailAuth = async () => {
    setAuthLoading(true); setAuthError("");
    if (authMode === "register") {
      const { error } = await supabase.auth.signUp({
        email: authForm.email, password: authForm.password,
        options: { data: { full_name: authForm.name, phone: authForm.phone }, emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) { setAuthError(error.message); }
      else {
        setShowAuthModal(false);
        ttq("CompleteRegistration");
        fbq("CompleteRegistration");
        gtag("sign_up", { method: "email" });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password });
      if (error) { setAuthError(error.message); }
      else { setShowAuthModal(false); gtag("login", { method: "email" }); }
    }
    setAuthLoading(false);
  };

  const handleOAuth = async (provider: "google" | "facebook") => {
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) setAuthError(error.message);
  };

  const handleSignOut = async () => { await supabase.auth.signOut(); setProfile(null); setActiveTab("home"); };

  // ── Cart ───────────────────────────────────────────────────────────────
  const addToCart = (item: CartItem) => {
    setCart(prev => [...prev, item]);
    ttq("AddToCart", { contents: [{ content_id: item.id, content_name: item.name, content_type: "product" }], value: item.price / 100, currency: "ZAR" });
    fbq("AddToCart",  { content_ids: [item.id], content_name: item.name, value: item.price / 100, currency: "ZAR" });
    gtag("add_to_cart", { currency: "ZAR", value: item.price / 100 });
  };
  const cartCount = cart.length;
  const cartTotal = cart.reduce((s, i) => s + i.price, 0);

  // ── Booking / PayFast ─────────────────────────────────────────────────
  const handleBookNow = (artist: Artist) => {
    if (!user) { setShowAuthModal(true); return; }
    setSelectedArtist(artist); setSelectedService(null);
    setBookingStep("services"); setBookingDate(""); setBookingTime(""); setBookingNotes("");
    ttq("ViewContent", { contents: [{ content_id: artist.id, content_name: artist.display_name, content_type: "product" }], currency: "ZAR" });
    fbq("ViewContent", { content_ids: [artist.id], content_name: artist.display_name, currency: "ZAR" });
  };

  const handleConfirmBooking = async () => {
    if (!user || !selectedArtist || !selectedService || !bookingDate || !bookingTime) return;
    setBookingLoading(true);
    try {
      const bookingId = uuidv4();
      ttq("InitiateCheckout", { contents: [{ content_id: selectedService.id, content_name: selectedService.name, content_type: "product" }], value: selectedService.price / 100, currency: "ZAR" });
      fbq("InitiateCheckout", { content_ids: [selectedService.id], value: selectedService.price / 100, currency: "ZAR" });
      gtag("begin_checkout", { currency: "ZAR", value: selectedService.price / 100 });

      const res = await fetch("/api/payfast/initiate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, serviceId: selectedService.id, artistId: selectedArtist.id, bookingDate, bookingTime, notes: bookingNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment initiation failed");

      const form = document.createElement("form");
      form.method = "POST"; form.action = data.payfastUrl;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const inp = document.createElement("input"); inp.type = "hidden"; inp.name = k; inp.value = v; form.appendChild(inp);
      });
      document.body.appendChild(form); form.submit();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBookingLoading(false);
    }
  };

  // ── Filtered artists ──────────────────────────────────────────────────
  const filtered = MOCK_ARTISTS.filter(a => {
    const matchCat = activeCategory === "All" || a.category === activeCategory.toLowerCase();
    const matchQ   = !searchQuery || a.display_name.toLowerCase().includes(searchQuery.toLowerCase()) || a.suburb.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchQ;
  });

  // ── Shared nav button style ───────────────────────────────────────────
  const navBtn = (tab: Tab) => ({
    background: activeTab === tab ? "var(--plum-t)" : "transparent",
    border: "none", borderRadius: 100, padding: "0.4rem 1rem",
    color: activeTab === tab ? "var(--plum)" : "var(--grey)",
    fontWeight: activeTab === tab ? 500 : 400,
    fontSize: "0.875rem", textTransform: "capitalize" as const,
    transition: "all 0.2s", cursor: "pointer" as const,
  });

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

      {/* ── Nav ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>

        {/* Logo */}
        <button onClick={() => setActiveTab("home")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", padding: 0 }}>
          <Image src="/umuhle-icon.png" alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </button>

        {/* Centre nav links */}
        <div style={{ display: "flex", gap: "0.15rem" }}>
          <button style={navBtn("home")}      onClick={() => setActiveTab("home")}>Search</button>
          <button style={navBtn("shop")}      onClick={() => { setActiveTab("shop"); ttq("ViewContent", { content_name: "Shop" }); }}>Shop</button>
          <button style={navBtn("earn")}      onClick={() => setActiveTab("earn")}>Earn</button>
          {user && <button style={navBtn("dashboard")} onClick={() => setActiveTab("dashboard")}>Dashboard</button>}
        </div>

        {/* Right: cart + auth */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Cart icon */}
          <button onClick={() => setShowCart(true)} aria-label={`Cart — ${cartCount} item${cartCount !== 1 ? "s" : ""}`} style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: "0.3rem", color: "var(--grey)", display: "flex" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            {cartCount > 0 && (
              <span style={{ position: "absolute", top: -2, right: -2, background: "var(--plum)", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {cartCount}
              </span>
            )}
          </button>

          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--grey)" }}>{profile?.full_name?.split(" ")[0] ?? user.email}</span>
              <button className="btn-outline" style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }} onClick={handleSignOut}>Sign out</button>
            </div>
          ) : (
            <button className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }} onClick={() => setShowAuthModal(true)}>Sign in</button>
          )}
        </div>
      </nav>

      {/* ── Page content ── */}
      <div style={{ flex: 1 }}>

        {/* HOME / SEARCH */}
        {activeTab === "home" && (
          <main style={{ minHeight: "80vh", background: "var(--white)" }}>
            <section style={{ background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)", padding: "5rem 1.5rem 3rem", textAlign: "center" }}>
              <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "1rem" }}>beauty, near you</p>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.5rem,6vw,4.5rem)", fontWeight: 300, color: "var(--onyx)", lineHeight: 1.1, marginBottom: "1.25rem" }}>
                You are <em style={{ color: "var(--plum)", fontStyle: "italic" }}>beautiful</em>
              </h1>
              <p style={{ fontSize: "1.1rem", color: "var(--grey)", maxWidth: 480, margin: "0 auto 2rem" }}>
                Book trusted hair stylists, nail techs & makeup artists — right in your neighbourhood.
              </p>
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn-plum" onClick={() => document.getElementById("artists")?.scrollIntoView({ behavior: "smooth" })}>Find an artist</button>
                <button className="btn-outline" onClick={() => { setAuthMode("register"); setShowAuthModal(true); }}>Join as a partner</button>
              </div>
            </section>

            {/* Category pills */}
            <section style={{ padding: "2rem 1.5rem 0", maxWidth: 900, margin: "0 auto" }}>
              <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
                {CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => setActiveCategory(cat)} style={{ flexShrink: 0, borderRadius: 100, padding: "0.5rem 1.25rem", background: activeCategory === cat ? "var(--plum)" : "var(--plum-t)", color: activeCategory === cat ? "#fff" : "var(--plum)", border: "none", fontWeight: 500, fontSize: "0.875rem", transition: "all 0.2s", cursor: "pointer" }}>
                    {CAT_ICONS[cat.toLowerCase()] ? `${CAT_ICONS[cat.toLowerCase()]} ` : ""}{cat}
                  </button>
                ))}
              </div>
            </section>

            {/* Search */}
            <section style={{ padding: "1.25rem 1.5rem 0", maxWidth: 900, margin: "0 auto" }}>
              <input type="text" placeholder="Search by name or area…" value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); if (e.target.value.length > 2) { ttq("Search", { search_string: e.target.value }); fbq("Search", { search_string: e.target.value }); gtag("search", { search_term: e.target.value }); } }}
                style={{ width: "100%", padding: "0.75rem 1.25rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", fontSize: "0.95rem", color: "var(--onyx)", background: "var(--plum-t)" }} />
            </section>

            {/* Artist grid */}
            <section id="artists" style={{ padding: "2rem 1.5rem 4rem", maxWidth: 900, margin: "0 auto" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.5rem", marginBottom: "1.5rem", color: "var(--onyx)" }}>
                {activeCategory === "All" ? "All artists" : `${activeCategory} artists`}
                <span style={{ fontSize: "0.9rem", color: "var(--grey)", fontFamily: "var(--font-body)", fontWeight: 400, marginLeft: "0.5rem" }}>({filtered.length})</span>
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "1.25rem" }}>
                {filtered.map(a => <ArtistCard key={a.id} artist={a} onBook={handleBookNow} />)}
                {filtered.length === 0 && <p style={{ color: "var(--grey)", gridColumn: "1/-1", textAlign: "center", padding: "3rem 0" }}>No artists found. Try a different search or category.</p>}
              </div>
            </section>
          </main>
        )}

        {/* SHOP */}
        {activeTab === "shop" && <ShopPage user={user} onSignIn={() => setShowAuthModal(true)} onAddToCart={addToCart} />}

        {/* EARN */}
        {activeTab === "earn" && <EarnPage user={user} profile={profile} onSignIn={() => setShowAuthModal(true)} />}

        {/* DASHBOARD */}
        {activeTab === "dashboard" && user && <DashboardPage user={user} profile={profile} />}
      </div>

      {/* ── Footer with socials ── */}
      <footer style={{ borderTop: "1px solid rgba(155,127,184,0.15)", background: "var(--white)", padding: "2rem 1.5rem" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Image src="/umuhle-icon.png" alt="Umuhle" width={24} height={24} style={{ borderRadius: "50%" }} />
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.1rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--light)", letterSpacing: "0.05em", marginRight: "0.25rem" }}>Follow us</span>
            {SOCIALS.map(s => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.78rem", color: "var(--grey)", textDecoration: "none", padding: "0.25rem 0.75rem", borderRadius: 100, border: "1px solid rgba(155,127,184,0.25)", transition: "all 0.2s" }}>
                {s.label}
              </a>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--light)" }}>© {new Date().getFullYear()} Umuhle. All rights reserved.</p>
        </div>
      </footer>

      {/* ── Cart Drawer ── */}
      {showCart && (
        <div className="modal-overlay" onClick={() => setShowCart(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: "min(360px,100vw)", background: "#fff", boxShadow: "-4px 0 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", zIndex: 10000 }}>
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid rgba(155,127,184,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem" }}>Your cart</h3>
              <button onClick={() => setShowCart(false)} style={{ background: "none", border: "none", fontSize: "1.4rem", color: "var(--light)", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem" }}>
              {cart.length === 0
                ? <p style={{ color: "var(--light)", textAlign: "center", marginTop: "2rem" }}>Your cart is empty.</p>
                : cart.map((item, i) => (
                  <div key={`${item.id}-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid rgba(155,127,184,0.08)" }}>
                    <div>
                      <p style={{ fontWeight: 500, fontSize: "0.9rem" }}>{item.name}</p>
                      <p style={{ fontSize: "0.8rem", color: "var(--grey)" }}>{fmt(item.price)}</p>
                    </div>
                    <button onClick={() => setCart(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "1.1rem", cursor: "pointer" }}>×</button>
                  </div>
                ))
              }
            </div>
            {cart.length > 0 && (
              <div style={{ padding: "1.25rem 1.5rem", borderTop: "1px solid rgba(155,127,184,0.15)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem", fontWeight: 600 }}>
                  <span>Total</span><span>{fmt(cartTotal)}</span>
                </div>
                <button className="btn-plum" style={{ width: "100%" }} onClick={() => { ttq("InitiateCheckout", { value: cartTotal / 100, currency: "ZAR" }); fbq("InitiateCheckout", { value: cartTotal / 100, currency: "ZAR" }); alert("Checkout coming soon!"); }}>
                  Checkout →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Auth Modal ── */}
      {showAuthModal && (
        <div className="modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.6rem", marginBottom: "0.25rem" }}>{authMode === "login" ? "Welcome back" : "Create account"}</h2>
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>{authMode === "login" ? "Sign in to book your next appointment." : "Join Umuhle — it's free."}</p>

            {/* OAuth */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <button onClick={() => handleOAuth("google")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "1.5px solid #E0E0E0", background: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}>
                <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.7-6.7C35.8 2.4 30.2 0 24 0 14.8 0 6.9 5.4 3 13.3l7.8 6.1C12.6 13.1 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.5c-.5 2.8-2.1 5.2-4.5 6.8l7 5.4c4.1-3.8 6.5-9.4 6.5-16.2z"/><path fill="#FBBC05" d="M10.8 28.5A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.7-4.5L2.4 13.4A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8.2-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.4-4.6 2.2-8.2 2.2-6.1 0-11.3-4.1-13.2-9.7l-8.2 6.2C6.9 42.6 14.8 48 24 48z"/></svg>
                Continue with Google
              </button>
              <button onClick={() => handleOAuth("facebook")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "none", background: "#1877F2", color: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M24 12a12 12 0 1 0-13.875 11.85v-8.385H7.08V12h3.045V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.465h-2.796v8.385A12 12 0 0 0 24 12z"/></svg>
                Continue with Facebook
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
              <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} /><span style={{ fontSize: "0.8rem", color: "var(--light)" }}>or</span><div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {authMode === "register" && (
                <>
                  <input placeholder="Full name" value={authForm.name} onChange={e => setAuthForm({ ...authForm, name: e.target.value })} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
                  <input placeholder="Phone number (e.g. 082 123 4567)" value={authForm.phone} onChange={e => setAuthForm({ ...authForm, phone: e.target.value })} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
                </>
              )}
              <input type="email" placeholder="Email address" value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
              <input type="password" placeholder="Password" value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} onKeyDown={e => e.key === "Enter" && handleEmailAuth()} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
              {authError && <p style={{ color: "#E53935", fontSize: "0.85rem" }}>{authError}</p>}
              <button className="btn-plum" style={{ marginTop: "0.25rem" }} onClick={handleEmailAuth} disabled={authLoading}>
                {authLoading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </div>

            <p style={{ textAlign: "center", marginTop: "1.25rem", fontSize: "0.875rem", color: "var(--grey)" }}>
              {authMode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }} style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 500, cursor: "pointer" }}>
                {authMode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* ── Booking Modal ── */}
      {selectedArtist && (
        <div className="modal-overlay" onClick={() => setSelectedArtist(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1.5rem" }}>
              <Image src={selectedArtist.avatar_url ?? ICON} alt={selectedArtist.display_name} width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover" }} />
              <div>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.2rem" }}>{selectedArtist.display_name}</h3>
                <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>{selectedArtist.suburb} · ★ {selectedArtist.rating}</p>
              </div>
              <button onClick={() => setSelectedArtist(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: "1.4rem", color: "var(--light)", lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>

            {bookingStep === "services" && (
              <>
                <h4 style={{ fontWeight: 500, marginBottom: "1rem" }}>Choose a service</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {(MOCK_SERVICES[selectedArtist.id] ?? []).map(svc => (
                    <button key={svc.id} onClick={() => { setSelectedService(svc); setBookingStep("datetime"); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.2)", background: "var(--plum-t)", textAlign: "left", cursor: "pointer", transition: "all 0.15s" }}>
                      <div><div style={{ fontWeight: 500, fontSize: "0.95rem" }}>{svc.name}</div><div style={{ fontSize: "0.8rem", color: "var(--grey)", marginTop: 2 }}>{svc.duration_minutes} min</div></div>
                      <div style={{ fontWeight: 600, color: "var(--plum)", fontSize: "1rem" }}>{fmt(svc.price)}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {bookingStep === "datetime" && selectedService && (
              <>
                <button onClick={() => setBookingStep("services")} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", marginBottom: "1rem" }}>← Back</button>
                <h4 style={{ fontWeight: 500, marginBottom: "1rem" }}>Pick a date & time</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <input type="date" value={bookingDate} min={new Date().toISOString().split("T")[0]} onChange={e => setBookingDate(e.target.value)} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
                  <input type="time" value={bookingTime} onChange={e => setBookingTime(e.target.value)} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
                  <textarea placeholder="Any notes for the artist? (optional)" value={bookingNotes} onChange={e => setBookingNotes(e.target.value)} rows={3} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", resize: "none" }} />
                  <button className="btn-plum" disabled={!bookingDate || !bookingTime} onClick={() => setBookingStep("confirm")}>Review booking →</button>
                </div>
              </>
            )}

            {bookingStep === "confirm" && selectedService && (
              <>
                <button onClick={() => setBookingStep("datetime")} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", marginBottom: "1rem" }}>← Back</button>
                <h4 style={{ fontWeight: 500, marginBottom: "1.25rem" }}>Confirm booking</h4>
                <div style={{ background: "var(--surface)", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem" }}>
                  <Row label="Artist" value={selectedArtist.display_name} />
                  <Row label="Service" value={selectedService.name} />
                  <Row label="Date" value={bookingDate} />
                  <Row label="Time" value={bookingTime} />
                  {bookingNotes && <Row label="Notes" value={bookingNotes} />}
                  <div style={{ borderTop: "1px dashed rgba(155,127,184,0.3)", margin: "0.75rem 0" }} />
                  <Row label="Total" value={fmt(selectedService.price)} bold />
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "1.25rem" }}>You'll be redirected to PayFast to complete payment securely. Once paid, you'll receive a WhatsApp confirmation.</p>
                <button className="btn-plum" style={{ width: "100%", padding: "0.875rem" }} onClick={handleConfirmBooking} disabled={bookingLoading}>
                  {bookingLoading ? "Redirecting to PayFast…" : `Pay ${fmt(selectedService.price)} securely →`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ArtistCard({ artist, onBook }: { artist: Artist; onBook: (a: Artist) => void }) {
  const CAT_ICONS: Record<string, string> = { hair: "✂", nails: "◈", makeup: "◉", lashes: "◎" };
  return (
    <div style={{ borderRadius: 18, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff", transition: "transform 0.2s, box-shadow 0.2s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 12px 40px rgba(155,127,184,0.15)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}>
      <div style={{ height: 180, overflow: "hidden", position: "relative", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={artist.avatar_url ?? "/umuhle-icon.png"} alt={artist.display_name} width={100} height={100} style={{ objectFit: "contain", opacity: 0.85 }} />
        {artist.is_verified && <span style={{ position: "absolute", top: 10, right: 10, background: "var(--forest)", color: "#fff", borderRadius: 100, padding: "0.2rem 0.6rem", fontSize: "0.7rem", fontWeight: 600 }}>✓ Verified</span>}
        <span style={{ position: "absolute", bottom: 10, left: 10, background: "rgba(255,255,255,0.9)", borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.75rem", fontWeight: 500, color: "var(--plum)", backdropFilter: "blur(4px)" }}>
          {CAT_ICONS[artist.category] ?? ""} {artist.category}
        </span>
      </div>
      <div style={{ padding: "1rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.05rem", marginBottom: "0.25rem" }}>{artist.display_name}</h3>
        <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.5rem" }}>{artist.suburb}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <span style={{ color: "#F4B400", fontSize: "0.85rem" }}>★ {artist.rating}</span>
          <span style={{ fontSize: "0.75rem", color: "var(--light)" }}>{artist.review_count} reviews</span>
        </div>
        <button className="btn-plum" style={{ width: "100%", padding: "0.6rem" }} onClick={() => onBook(artist)}>Book now</button>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontSize: "0.9rem" }}>
      <span style={{ color: "var(--grey)" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: bold ? "var(--plum)" : "var(--onyx)" }}>{value}</span>
    </div>
  );
}

function ShopPage({ user, onSignIn, onAddToCart }: { user: User | null; onSignIn: () => void; onAddToCart: (i: CartItem) => void }) {
  const PRODUCTS = [
    { id: "p1", name: "Moroccan Argan Oil",  price: 28900, category: "Hair care" },
    { id: "p2", name: "Gel Top Coat",         price: 18900, category: "Nails"     },
    { id: "p3", name: "HD Setting Powder",    price: 34900, category: "Makeup"    },
    { id: "p4", name: "Lash Adhesive Pro",    price: 12900, category: "Lashes"    },
    { id: "p5", name: "Knotless Braid Kit",   price: 45900, category: "Hair care" },
    { id: "p6", name: "UV Gel Polish Set",    price: 29900, category: "Nails"     },
  ];
  return (
    <main style={{ minHeight: "80vh", padding: "2rem 1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", marginBottom: "0.5rem" }}>Beauty Shop</h1>
      <p style={{ color: "var(--grey)", marginBottom: "2rem" }}>Professional products, curated by our artists.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "1.25rem" }}>
        {PRODUCTS.map(p => (
          <div key={p.id} style={{ borderRadius: 16, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff" }}>
            <div style={{ height: 160, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Image src="/umuhle-icon.png" alt={p.name} width={80} height={80} style={{ objectFit: "contain", opacity: 0.7 }} />
            </div>
            <div style={{ padding: "1rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--plum)", fontWeight: 500, marginBottom: "0.25rem" }}>{p.category}</p>
              <h4 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>{p.name}</h4>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, color: "var(--plum)" }}>R{(p.price / 100).toFixed(0)}</span>
                <button className="btn-plum" style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }} onClick={() => user ? onAddToCart({ id: p.id, name: p.name, price: p.price }) : onSignIn()}>Add to cart</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function EarnPage({ user, profile, onSignIn }: { user: User | null; profile: Profile | null; onSignIn: () => void }) {
  const [copied, setCopied] = useState(false);
  const referralCode = (profile as unknown as Record<string, string>)?.referral_code ?? null;
  const handleCopy = () => { if (!referralCode) return; navigator.clipboard.writeText(referralCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <main style={{ minHeight: "80vh", padding: "2rem 1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "0.75rem" }}>Referral Programme</p>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2.2rem", marginBottom: "1rem" }}>Earn with <em style={{ color: "var(--plum)", fontStyle: "italic" }}>umuhle</em></h1>
      <p style={{ color: "var(--grey)", maxWidth: 500, marginBottom: "2rem", lineHeight: 1.7 }}>Share your unique code with any beauty professional. When they sign up and create a paid Ad, you earn <strong>R10</strong>. No limit on referrals. Withdraw once you reach R100.</p>

      {user && referralCode ? (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.4)", borderRadius: 16, padding: "1.25rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2.5rem", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: "0.8rem", color: "var(--plum)", marginBottom: 4 }}>Your referral code</p>
            <p style={{ fontFamily: "monospace", fontSize: "1.8rem", fontWeight: 700, letterSpacing: "0.12em" }}>{referralCode}</p>
          </div>
          <button className="btn-plum" onClick={handleCopy}>{copied ? "Copied!" : "Copy code"}</button>
        </div>
      ) : (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.2)", borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "2.5rem" }}>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>
            {user ? "Your code is being generated — refresh in a moment." : <><button onClick={onSignIn} style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 500, cursor: "pointer" }}>Sign in</button> to see your referral code.</>}
          </p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "1rem", marginBottom: "2.5rem" }}>
        {[["01","Get your code","Your unique code is on your dashboard."],["02","Share it","Send to any beauty professional."],["03","They advertise","They sign up, enter your code, pay for an Ad."],["04","Earn R10","R10 lands in your wallet per qualifying referral."]].map(([step, title, desc]) => (
          <div key={step} style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 14, padding: "1.25rem", background: "#fff" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--plum)", letterSpacing: "0.08em", marginBottom: 8 }}>STEP {step}</p>
            <p style={{ fontWeight: 500, marginBottom: 4 }}>{title}</p>
            <p style={{ fontSize: "0.85rem", color: "var(--grey)", lineHeight: 1.5 }}>{desc}</p>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--surface)", borderRadius: 14, padding: "1.25rem", marginBottom: "2.5rem" }}>
        <p style={{ fontWeight: 500, marginBottom: "0.75rem" }}>Earning rules</p>
        {[["Reward per merchant","R10.00"],["Triggered when","Merchant pays for first Ad"],["Minimum withdrawal","R100.00"],["Who can refer","Any user or merchant"],["Code entry","During merchant sign-up only"]].map(([l,v]) => <Row key={l} label={l} value={v} />)}
      </div>

      <p style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "1rem" }}>Ad packages</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: "1rem" }}>
        {AD_PACKAGES.map(pkg => (
          <div key={pkg.id} style={{ position: "relative", border: pkg.featured ? "2px solid var(--plum)" : "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.25rem", background: "#fff" }}>
            {pkg.featured && <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--plum)", color: "#fff", fontSize: "0.7rem", fontWeight: 700, padding: "3px 12px", borderRadius: 100, whiteSpace: "nowrap" }}>MOST POPULAR</span>}
            <p style={{ fontWeight: 600, marginBottom: 4 }}>{pkg.name}</p>
            <p style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--plum)", marginBottom: 2 }}>R{pkg.price}</p>
            <p style={{ fontSize: "0.8rem", color: "var(--grey)" }}>{pkg.ads} Ad{pkg.ads > 1 ? "s" : ""} · {pkg.duration}</p>
          </div>
        ))}
      </div>
    </main>
  );
}

function DashboardPage({ user, profile }: { user: User; profile: Profile | null }) {
  const supabase = createClient();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const referralCode = (profile as unknown as Record<string, string>)?.referral_code;
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchBookings(); }, []);
  const fetchBookings = async () => {
    setLoading(true);
    const { data } = await supabase.from("bookings").select("id,booking_date,booking_time,status,total_amount,notes,service:services(name,price),artist:artists(display_name,suburb)").eq("client_id", user.id).order("booking_date", { ascending: false });
    setBookings((data ?? []) as unknown as Booking[]);
    setLoading(false);
  };

  const STATUS_COLORS: Record<string, string> = { confirmed: "var(--forest)", pending_payment: "#F59E0B", completed: "var(--plum)", cancelled: "#EF4444", no_show: "var(--light)" };

  return (
    <main style={{ minHeight: "80vh", padding: "2rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", marginBottom: "0.25rem" }}>My Dashboard</h1>
      <p style={{ color: "var(--grey)", marginBottom: "2rem" }}>Welcome back, {profile?.full_name?.split(" ")[0] ?? "there"}</p>

      {referralCode && (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.4)", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "2rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: "0.75rem", color: "var(--plum)", marginBottom: 2 }}>Your referral code</p>
            <p style={{ fontFamily: "monospace", fontSize: "1.4rem", fontWeight: 700, letterSpacing: "0.1em" }}>{referralCode}</p>
          </div>
          <button className="btn-plum" style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }} onClick={() => { navigator.clipboard.writeText(referralCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied!" : "Copy"}</button>
          <p style={{ fontSize: "0.8rem", color: "var(--grey)", flex: 1 }}>Share this code — earn R10 for every merchant you bring.</p>
        </div>
      )}

      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.5rem", marginBottom: "1.5rem" }}>My Bookings</h2>
      {loading && <p style={{ color: "var(--grey)" }}>Loading…</p>}
      {!loading && bookings.length === 0 && <div style={{ textAlign: "center", padding: "4rem 0" }}><p style={{ color: "var(--grey)" }}>No bookings yet. Find an artist and book your first appointment!</p></div>}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {(bookings as unknown as Record<string, unknown>[]).map(b => (
          <div key={b.id as string} style={{ borderRadius: 16, padding: "1.25rem", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{(b.service as Record<string,string>)?.name ?? "Service"}</h4>
                <p style={{ fontSize: "0.85rem", color: "var(--grey)" }}>with {(b.artist as Record<string,string>)?.display_name} · {(b.artist as Record<string,string>)?.suburb}</p>
                <p style={{ fontSize: "0.85rem", color: "var(--onyx)", marginTop: "0.5rem" }}>📅 {b.booking_date as string} at {b.booking_time as string}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ display: "inline-block", padding: "0.2rem 0.75rem", borderRadius: 100, fontSize: "0.75rem", fontWeight: 600, background: `${STATUS_COLORS[b.status as string]}20`, color: STATUS_COLORS[b.status as string] }}>{(b.status as string).replace("_", " ")}</span>
                <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--plum)", marginTop: "0.5rem" }}>R{((b.total_amount as number) / 100).toFixed(0)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
