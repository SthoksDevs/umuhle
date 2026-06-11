"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Artist, Profile, Booking } from "@/types";
import { v4 as uuidv4 } from "uuid";

// ─── Mock data (replace with Supabase queries once artists sign up) ───────────
const MOCK_ARTISTS: Artist[] = [
  {
    id: "a1",
    profile_id: "p1",
    display_name: "Zanele Mokoena",
    bio: "Natural hair specialist with 8 years experience. Braids, locs, and protective styles.",
    category: "hair",
    location: "Sandton, JHB",
    suburb: "Sandton",
    city: "Johannesburg",
    avatar_url: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&q=80",
    cover_url: null,
    rating: 4.9,
    review_count: 124,
    is_verified: true,
    is_active: true,
    created_at: "",
  },
  {
    id: "a2",
    profile_id: "p2",
    display_name: "Nomvula Dlamini",
    bio: "Nail art & gel extensions. Trendy designs, clean finish. Walk-ins welcome.",
    category: "nails",
    location: "Rosebank, JHB",
    suburb: "Rosebank",
    city: "Johannesburg",
    avatar_url: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=400&q=80",
    cover_url: null,
    rating: 4.7,
    review_count: 89,
    is_verified: true,
    is_active: true,
    created_at: "",
  },
  {
    id: "a3",
    profile_id: "p3",
    display_name: "Lerato Sithole",
    bio: "Bridal & event makeup. Airbrush certified. Serving JHB & PTA.",
    category: "makeup",
    location: "Midrand, JHB",
    suburb: "Midrand",
    city: "Johannesburg",
    avatar_url: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400&q=80",
    cover_url: null,
    rating: 5.0,
    review_count: 56,
    is_verified: true,
    is_active: true,
    created_at: "",
  },
  {
    id: "a4",
    profile_id: "p4",
    display_name: "Thandi Nkosi",
    bio: "Skincare treatments, facials & hydrafacials. Glow guaranteed.",
    category: "skincare",
    location: "Fourways, JHB",
    suburb: "Fourways",
    city: "Johannesburg",
    avatar_url: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80",
    cover_url: null,
    rating: 4.8,
    review_count: 73,
    is_verified: false,
    is_active: true,
    created_at: "",
  },
];

const MOCK_SERVICES: Record<string, { id: string; name: string; price: number; duration_minutes: number }[]> = {
  a1: [
    { id: "s1a", name: "Box Braids (medium)", price: 85000, duration_minutes: 240 },
    { id: "s1b", name: "Knotless Braids", price: 95000, duration_minutes: 300 },
    { id: "s1c", name: "Loc Retwist", price: 35000, duration_minutes: 90 },
  ],
  a2: [
    { id: "s2a", name: "Gel Manicure", price: 28000, duration_minutes: 60 },
    { id: "s2b", name: "Acrylic Set", price: 45000, duration_minutes: 90 },
    { id: "s2c", name: "Nail Art (per nail)", price: 5000, duration_minutes: 15 },
  ],
  a3: [
    { id: "s3a", name: "Full Glam Makeup", price: 120000, duration_minutes: 90 },
    { id: "s3b", name: "Natural Day Look", price: 75000, duration_minutes: 60 },
    { id: "s3c", name: "Bridal Package", price: 220000, duration_minutes: 180 },
  ],
  a4: [
    { id: "s4a", name: "Classic Facial", price: 65000, duration_minutes: 60 },
    { id: "s4b", name: "Hydrafacial", price: 120000, duration_minutes: 75 },
    { id: "s4c", name: "Microdermabrasion", price: 85000, duration_minutes: 60 },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
const stars = (n: number) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
const CATEGORIES = ["All", "Hair", "Nails", "Makeup", "Skincare", "Lashes"];
const CATEGORY_EMOJIS: Record<string, string> = {
  hair: "✂️", nails: "💅", makeup: "💄", skincare: "✨", lashes: "👁️",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function Home() {
  const supabase = createClient();

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<"home" | "shop" | "dashboard">("home");
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  // Auth form
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "", phone: "" });

  // Booking state
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [selectedService, setSelectedService] = useState<{ id: string; name: string; price: number; duration_minutes: number } | null>(null);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [bookingStep, setBookingStep] = useState<"services" | "datetime" | "confirm">("services");
  const [bookingLoading, setBookingLoading] = useState(false);

  // Dashboard state
  const [partnerBookings, setPartnerBookings] = useState<Booking[]>([]);

  // ─── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) fetchProfile(user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) setProfile(data);
  };

  // ─── Auth actions ──────────────────────────────────────────────────────────
  const handleEmailAuth = async () => {
    setAuthLoading(true);
    setAuthError("");

    if (authMode === "register") {
      const { error } = await supabase.auth.signUp({
        email: authForm.email,
        password: authForm.password,
        options: {
          data: { full_name: authForm.name, phone: authForm.phone },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) setAuthError(error.message);
      else setShowAuthModal(false);
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: authForm.email,
        password: authForm.password,
      });
      if (error) setAuthError(error.message);
      else setShowAuthModal(false);
    }
    setAuthLoading(false);
  };

  const handleOAuth = async (provider: "google" | "facebook") => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setActiveTab("home");
  };

  // ─── Booking / PayFast ────────────────────────────────────────────────────
  const handleBookNow = (artist: Artist) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setSelectedArtist(artist);
    setSelectedService(null);
    setBookingStep("services");
    setBookingDate("");
    setBookingTime("");
    setBookingNotes("");
  };

  const handleConfirmBooking = async () => {
    if (!user || !selectedArtist || !selectedService || !bookingDate || !bookingTime) return;
    setBookingLoading(true);

    try {
      const bookingId = uuidv4();

      const res = await fetch("/api/payfast/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          serviceId: selectedService.id,
          artistId: selectedArtist.id,
          bookingDate,
          bookingTime,
          notes: bookingNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment initiation failed");

      // Build and submit PayFast form (redirect to PayFast)
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.payfastUrl;

      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    } catch (err: any) {
      alert(err.message ?? "Something went wrong. Please try again.");
      setBookingLoading(false);
    }
  };

  // ─── Filtered artists ─────────────────────────────────────────────────────
  const filtered = MOCK_ARTISTS.filter((a) => {
    const matchCat =
      activeCategory === "All" ||
      a.category === activeCategory.toLowerCase();
    const matchSearch =
      !searchQuery ||
      a.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.suburb.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Nav ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(155,127,184,0.15)",
        padding: "0 1.5rem", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 60,
      }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.4rem", letterSpacing: "0.12em", color: "var(--plum)" }}>
          umuhle
        </span>

        <div style={{ display: "flex", gap: "0.25rem" }}>
          {(["home", "shop", "dashboard"] as const).map((tab) => (
            (tab === "dashboard" && !user) ? null : (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: activeTab === tab ? "var(--plum-t)" : "transparent",
                  border: "none", borderRadius: 100, padding: "0.4rem 1rem",
                  color: activeTab === tab ? "var(--plum)" : "var(--grey)",
                  fontWeight: activeTab === tab ? 500 : 400,
                  fontSize: "0.875rem", textTransform: "capitalize",
                  transition: "all 0.2s",
                }}
              >
                {tab}
              </button>
            )
          ))}
        </div>

        <div>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--grey)" }}>
                {profile?.full_name?.split(" ")[0] ?? user.email}
              </span>
              <button className="btn-outline" style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }} onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <button className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }} onClick={() => setShowAuthModal(true)}>
              Sign in
            </button>
          )}
        </div>
      </nav>

      {/* ── Pages ── */}
      {activeTab === "home" && (
        <main style={{ minHeight: "100vh", background: "var(--white)" }}>
          {/* Hero */}
          <section style={{
            background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)",
            padding: "5rem 1.5rem 3rem", textAlign: "center",
          }}>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "1rem" }}>
              beauty, near you
            </p>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.5rem, 6vw, 4.5rem)", fontWeight: 300, color: "var(--onyx)", lineHeight: 1.1, marginBottom: "1.25rem" }}>
              You are <em style={{ color: "var(--plum)", fontStyle: "italic" }}>beautiful</em>
            </h1>
            <p style={{ fontSize: "1.1rem", color: "var(--grey)", maxWidth: 480, margin: "0 auto 2rem" }}>
              Book trusted hair stylists, nail techs & makeup artists — right in your neighbourhood.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn-plum" onClick={() => document.getElementById("artists")?.scrollIntoView({ behavior: "smooth" })}>
                Find an artist
              </button>
              <button className="btn-outline" onClick={() => { setAuthMode("register"); setShowAuthModal(true); }}>
                Join as a partner
              </button>
            </div>
          </section>

          {/* Category pills */}
          <section style={{ padding: "2rem 1.5rem 0", maxWidth: 900, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    flexShrink: 0, borderRadius: 100, padding: "0.5rem 1.25rem",
                    background: activeCategory === cat ? "var(--plum)" : "var(--plum-t)",
                    color: activeCategory === cat ? "#fff" : "var(--plum)",
                    border: "none", fontWeight: 500, fontSize: "0.875rem",
                    transition: "all 0.2s",
                  }}
                >
                  {CATEGORY_EMOJIS[cat.toLowerCase()] ?? ""} {cat}
                </button>
              ))}
            </div>
          </section>

          {/* Search */}
          <section style={{ padding: "1.25rem 1.5rem 0", maxWidth: 900, margin: "0 auto" }}>
            <input
              type="text"
              placeholder="Search by name or area…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%", padding: "0.75rem 1.25rem",
                borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)",
                fontSize: "0.95rem", color: "var(--onyx)",
                background: "var(--plum-t)",
              }}
            />
          </section>

          {/* Artist grid */}
          <section id="artists" style={{ padding: "2rem 1.5rem 4rem", maxWidth: 900, margin: "0 auto" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.5rem", marginBottom: "1.5rem", color: "var(--onyx)" }}>
              {activeCategory === "All" ? "All artists" : `${activeCategory} artists`}
              <span style={{ fontSize: "0.9rem", color: "var(--grey)", fontFamily: "var(--font-body)", fontWeight: 400, marginLeft: "0.5rem" }}>
                ({filtered.length})
              </span>
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "1.25rem" }}>
              {filtered.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} onBook={handleBookNow} />
              ))}
              {filtered.length === 0 && (
                <p style={{ color: "var(--grey)", gridColumn: "1/-1", textAlign: "center", padding: "3rem 0" }}>
                  No artists found. Try a different search or category.
                </p>
              )}
            </div>
          </section>
        </main>
      )}

      {activeTab === "shop" && <ShopPage user={user} onSignIn={() => setShowAuthModal(true)} />}

      {activeTab === "dashboard" && user && (
        <DashboardPage user={user} profile={profile} />
      )}

      {/* ── Auth Modal ── */}
      {showAuthModal && (
        <div className="modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 20, padding: "2rem",
              width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)",
            }}
          >
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.6rem", marginBottom: "0.25rem" }}>
              {authMode === "login" ? "Welcome back" : "Create account"}
            </h2>
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              {authMode === "login" ? "Sign in to book your next appointment." : "Join Umuhle — it's free."}
            </p>

            {/* OAuth */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <button
                onClick={() => handleOAuth("google")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
                  padding: "0.75rem", borderRadius: 12, border: "1.5px solid #E0E0E0",
                  background: "#fff", fontWeight: 500, fontSize: "0.9rem",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.7-6.7C35.8 2.4 30.2 0 24 0 14.8 0 6.9 5.4 3 13.3l7.8 6.1C12.6 13.1 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.5c-.5 2.8-2.1 5.2-4.5 6.8l7 5.4c4.1-3.8 6.5-9.4 6.5-16.2z"/><path fill="#FBBC05" d="M10.8 28.5A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.7-4.5L2.4 13.4A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8.2-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.4-4.6 2.2-8.2 2.2-6.1 0-11.3-4.1-13.2-9.7l-8.2 6.2C6.9 42.6 14.8 48 24 48z"/></svg>
                Continue with Google
              </button>
              <button
                onClick={() => handleOAuth("facebook")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
                  padding: "0.75rem", borderRadius: 12, border: "none",
                  background: "#1877F2", color: "#fff", fontWeight: 500, fontSize: "0.9rem",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M24 12a12 12 0 1 0-13.875 11.85v-8.385H7.08V12h3.045V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.465h-2.796v8.385A12 12 0 0 0 24 12z"/></svg>
                Continue with Facebook
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
              <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
              <span style={{ fontSize: "0.8rem", color: "var(--light)" }}>or</span>
              <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
            </div>

            {/* Email form */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {authMode === "register" && (
                <>
                  <input
                    placeholder="Full name"
                    value={authForm.name}
                    onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                    style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
                  />
                  <input
                    placeholder="Phone number (e.g. 082 123 4567)"
                    value={authForm.phone}
                    onChange={(e) => setAuthForm({ ...authForm, phone: e.target.value })}
                    style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
                  />
                </>
              )}
              <input
                type="email"
                placeholder="Email address"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
              />
              <input
                type="password"
                placeholder="Password"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()}
                style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
              />
              {authError && (
                <p style={{ color: "#E53935", fontSize: "0.85rem" }}>{authError}</p>
              )}
              <button className="btn-plum" style={{ marginTop: "0.25rem" }} onClick={handleEmailAuth} disabled={authLoading}>
                {authLoading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </div>

            <p style={{ textAlign: "center", marginTop: "1.25rem", fontSize: "0.875rem", color: "var(--grey)" }}>
              {authMode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}
                style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 500, cursor: "pointer" }}
              >
                {authMode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* ── Booking Modal ── */}
      {selectedArtist && (
        <div className="modal-overlay" onClick={() => setSelectedArtist(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 20, padding: "2rem",
              width: "100%", maxWidth: 500, maxHeight: "90vh",
              overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.15)",
            }}
          >
            {/* Artist header */}
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1.5rem" }}>
              <img
                src={selectedArtist.avatar_url ?? ""}
                alt={selectedArtist.display_name}
                style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }}
              />
              <div>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.2rem" }}>
                  {selectedArtist.display_name}
                </h3>
                <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>
                  {selectedArtist.suburb} · ⭐ {selectedArtist.rating}
                </p>
              </div>
              <button
                onClick={() => setSelectedArtist(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", fontSize: "1.4rem", color: "var(--light)", lineHeight: 1 }}
              >×</button>
            </div>

            {/* Step: select service */}
            {bookingStep === "services" && (
              <>
                <h4 style={{ fontWeight: 500, marginBottom: "1rem" }}>Choose a service</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {(MOCK_SERVICES[selectedArtist.id] ?? []).map((svc) => (
                    <button
                      key={svc.id}
                      onClick={() => { setSelectedService(svc); setBookingStep("datetime"); }}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "1rem 1.25rem", borderRadius: 14,
                        border: "1.5px solid rgba(155,127,184,0.2)",
                        background: "var(--plum-t)", textAlign: "left",
                        transition: "all 0.15s",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500, fontSize: "0.95rem" }}>{svc.name}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--grey)", marginTop: 2 }}>{svc.duration_minutes} min</div>
                      </div>
                      <div style={{ fontWeight: 600, color: "var(--plum)", fontSize: "1rem" }}>{fmt(svc.price)}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Step: pick date/time */}
            {bookingStep === "datetime" && selectedService && (
              <>
                <button onClick={() => setBookingStep("services")} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", marginBottom: "1rem" }}>
                  ← Back
                </button>
                <h4 style={{ fontWeight: 500, marginBottom: "1rem" }}>Pick a date & time</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <input
                    type="date"
                    value={bookingDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setBookingDate(e.target.value)}
                    style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
                  />
                  <input
                    type="time"
                    value={bookingTime}
                    onChange={(e) => setBookingTime(e.target.value)}
                    style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }}
                  />
                  <textarea
                    placeholder="Any notes for the artist? (optional)"
                    value={bookingNotes}
                    onChange={(e) => setBookingNotes(e.target.value)}
                    rows={3}
                    style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", resize: "none" }}
                  />
                  <button
                    className="btn-plum"
                    disabled={!bookingDate || !bookingTime}
                    onClick={() => setBookingStep("confirm")}
                  >
                    Review booking →
                  </button>
                </div>
              </>
            )}

            {/* Step: confirm & pay */}
            {bookingStep === "confirm" && selectedService && (
              <>
                <button onClick={() => setBookingStep("datetime")} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", marginBottom: "1rem" }}>
                  ← Back
                </button>
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
                <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "1.25rem" }}>
                  You'll be redirected to PayFast to complete payment securely. Once paid, you'll receive a WhatsApp confirmation.
                </p>
                <button
                  className="btn-plum"
                  style={{ width: "100%", padding: "0.875rem" }}
                  onClick={handleConfirmBooking}
                  disabled={bookingLoading}
                >
                  {bookingLoading ? "Redirecting to PayFast…" : `Pay ${fmt(selectedService.price)} securely →`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ArtistCard({ artist, onBook }: { artist: Artist; onBook: (a: Artist) => void }) {
  return (
    <div style={{
      borderRadius: 18, overflow: "hidden",
      border: "1.5px solid rgba(155,127,184,0.15)",
      background: "#fff", transition: "transform 0.2s, box-shadow 0.2s",
      cursor: "pointer",
    }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 12px 40px rgba(155,127,184,0.15)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
    >
      <div style={{ height: 180, overflow: "hidden", position: "relative" }}>
        <img
          src={artist.avatar_url ?? ""}
          alt={artist.display_name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {artist.is_verified && (
          <span style={{
            position: "absolute", top: 10, right: 10,
            background: "var(--forest)", color: "#fff",
            borderRadius: 100, padding: "0.2rem 0.6rem",
            fontSize: "0.7rem", fontWeight: 600,
          }}>✓ Verified</span>
        )}
        <span style={{
          position: "absolute", bottom: 10, left: 10,
          background: "rgba(255,255,255,0.9)", borderRadius: 100,
          padding: "0.2rem 0.75rem", fontSize: "0.75rem", fontWeight: 500,
          color: "var(--plum)", backdropFilter: "blur(4px)",
        }}>
          {CATEGORY_EMOJIS[artist.category]} {artist.category}
        </span>
      </div>
      <div style={{ padding: "1rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.05rem", marginBottom: "0.25rem" }}>
          {artist.display_name}
        </h3>
        <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.5rem" }}>{artist.suburb}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <span style={{ color: "#F4B400", fontSize: "0.85rem" }}>★ {artist.rating}</span>
          <span style={{ fontSize: "0.75rem", color: "var(--light)" }}>{artist.review_count} reviews</span>
        </div>
        <button
          className="btn-plum"
          style={{ width: "100%", padding: "0.6rem" }}
          onClick={() => onBook(artist)}
        >
          Book now
        </button>
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

function ShopPage({ user, onSignIn }: { user: User | null; onSignIn: () => void }) {
  const PRODUCTS = [
    { id: "p1", name: "Moroccan Argan Oil", price: 28900, image: "https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=400&q=80", category: "Hair care" },
    { id: "p2", name: "Gel Top Coat", price: 18900, image: "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&q=80", category: "Nails" },
    { id: "p3", name: "HD Setting Powder", price: 34900, image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&q=80", category: "Makeup" },
    { id: "p4", name: "Vitamin C Serum", price: 45900, image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80", category: "Skincare" },
  ];

  return (
    <main style={{ minHeight: "100vh", padding: "2rem 1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", marginBottom: "0.5rem" }}>
        Beauty Shop
      </h1>
      <p style={{ color: "var(--grey)", marginBottom: "2rem" }}>
        Professional products, curated by our artists.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "1.25rem" }}>
        {PRODUCTS.map((p) => (
          <div key={p.id} style={{ borderRadius: 16, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff" }}>
            <img src={p.image} alt={p.name} style={{ width: "100%", height: 160, objectFit: "cover" }} />
            <div style={{ padding: "1rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--plum)", fontWeight: 500, marginBottom: "0.25rem" }}>{p.category}</p>
              <h4 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>{p.name}</h4>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, color: "var(--plum)" }}>R{(p.price / 100).toFixed(0)}</span>
                <button
                  className="btn-plum"
                  style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }}
                  onClick={() => user ? alert("Cart feature coming soon!") : onSignIn()}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function DashboardPage({ user, profile }: { user: User; profile: Profile | null }) {
  const supabase = createClient();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("bookings")
      .select(`
        id, booking_date, booking_time, status, total_amount, notes,
        service:services(name, price),
        artist:artists(display_name, suburb)
      `)
      .eq("client_id", user.id)
      .order("booking_date", { ascending: false });

    setBookings(data ?? []);
    setLoading(false);
  };

  const statusColors: Record<string, string> = {
    confirmed: "var(--forest)",
    pending_payment: "#F59E0B",
    completed: "var(--plum)",
    cancelled: "#EF4444",
    no_show: "var(--light)",
  };

  return (
    <main style={{ minHeight: "100vh", padding: "2rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", marginBottom: "0.25rem" }}>
        My Bookings
      </h1>
      <p style={{ color: "var(--grey)", marginBottom: "2rem" }}>
        Welcome back, {profile?.full_name?.split(" ")[0] ?? "there"} 👋
      </p>

      {loading && <p style={{ color: "var(--grey)" }}>Loading…</p>}

      {!loading && bookings.length === 0 && (
        <div style={{ textAlign: "center", padding: "4rem 0" }}>
          <p style={{ fontSize: "3rem", marginBottom: "1rem" }}>📅</p>
          <p style={{ color: "var(--grey)" }}>No bookings yet. Find an artist and book your first appointment!</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {bookings.map((b: any) => (
          <div key={b.id} style={{
            borderRadius: 16, padding: "1.25rem",
            border: "1.5px solid rgba(155,127,184,0.15)",
            background: "#fff",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{b.service?.name ?? "Service"}</h4>
                <p style={{ fontSize: "0.85rem", color: "var(--grey)" }}>
                  with {b.artist?.display_name} · {b.artist?.suburb}
                </p>
                <p style={{ fontSize: "0.85rem", color: "var(--onyx)", marginTop: "0.5rem" }}>
                  📅 {b.booking_date} at {b.booking_time}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{
                  display: "inline-block", padding: "0.2rem 0.75rem",
                  borderRadius: 100, fontSize: "0.75rem", fontWeight: 600,
                  background: `${statusColors[b.status]}20`,
                  color: statusColors[b.status],
                }}>
                  {b.status.replace("_", " ")}
                </span>
                <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--plum)", marginTop: "0.5rem" }}>
                  R{(b.total_amount / 100).toFixed(0)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
