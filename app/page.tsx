"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Artist, Profile, AccountType } from "@/types";
import { ACCOUNT_TYPES, ARTIST_CATEGORIES } from "@/types";
import Image from "next/image";
import Link from "next/link";
import Footer from "@/components/Footer";

// ── Pixel helpers ─────────────────────────────────────────────────────────────
declare global {
  interface Window {
    ttq?: { track: (e: string, p?: Record<string, unknown>) => void };
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
function gTag(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.gtag) window.gtag("event", event, params);
}

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
const CATEGORIES = ["All", "Hair", "Nails", "Makeup", "Lashes"] as const;
type Category = typeof CATEGORIES[number];
const CAT_ICONS: Record<string, string> = { hair: "✂", nails: "◈", makeup: "◉", lashes: "◎" };

type CartItem = { id: string; name: string; price: number };

// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const supabase = createClient();

  const [user, setUser]           = useState<User | null>(null);
  const [profile, setProfile]     = useState<Profile | null>(null);
  const [artists, setArtists]     = useState<Artist[]>([]);
  const [loading, setLoading]     = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("All");

  // Cart
  const [cart, setCart]           = useState<CartItem[]>([]);
  const [showCart, setShowCart]   = useState(false);

  // Auth modal
  const [showAuth, setShowAuth]   = useState(false);
  const [authMode, setAuthMode]   = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authForm, setAuthForm]   = useState({ email: "", password: "", name: "", phone: "" });
  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [artistCategory, setArtistCategory] = useState<string>("hair");

  // Booking
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);

  // ── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
      if (user) fetchProfile(user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setProfile(null);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "login") { setShowAuth(true); setAuthMode("login"); }
    if (params.get("auth") === "register") { setShowAuth(true); setAuthMode("register"); }
    // Clear error hash from OAuth failures so UI stays clean
    if (window.location.hash.includes("error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (data) setProfile(data as Profile);
  };

  // ── Fetch artists ────────────────────────────────────────────────────────
  const fetchArtists = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("artists")
      .select("*")
      .eq("is_active", true)
      .eq("moderation_status", "approved")
      .order("rating", { ascending: false })
      .limit(24);
    if (activeCategory !== "All") query = query.eq("category", activeCategory.toLowerCase());
    if (searchQuery.trim()) query = query.ilike("display_name", `%${searchQuery.trim()}%`);
    const { data } = await query;
    setArtists((data ?? []) as Artist[]);
    setLoading(false);
  }, [activeCategory, searchQuery]);

  useEffect(() => {
    const t = setTimeout(fetchArtists, 300);
    return () => clearTimeout(t);
  }, [fetchArtists]);

  // ── Auth handlers ────────────────────────────────────────────────────────
  const handleOAuth = async (provider: "google" | "facebook") => {
    setAuthLoading(true);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password });
        if (error) throw error;
        setShowAuth(false);
        gTag("login", { method: "email" });
        fbq("Login");
      } else {
        const { error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
          options: {
            data: {
              full_name: authForm.name,
              phone: authForm.phone,
              account_type: accountType,
              artist_category: accountType === "artist" ? artistCategory : null,
            },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        setAuthError("Check your email to confirm your account.");
        gTag("sign_up", { method: "email" });
        fbq("CompleteRegistration");
        ttq("CompleteRegistration");
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  const addToCart = (item: CartItem) => {
    setCart(prev => [...prev, item]);
    ttq("AddToCart", { contents: [{ content_id: item.id, content_name: item.name }], value: item.price / 100, currency: "ZAR" });
    fbq("AddToCart", { content_ids: [item.id], content_name: item.name, value: item.price / 100, currency: "ZAR" });
    gTag("add_to_cart", { currency: "ZAR", value: item.price / 100 });
  };
  void addToCart; // referenced by cart drawer

  const cartCount = cart.length;
  const cartTotal = cart.reduce((s, i) => s + i.price, 0);

  // ── Nav button style ─────────────────────────────────────────────────────
  const navLink = (active: boolean) => ({
    background: active ? "var(--plum-t)" : "transparent",
    border: "none",
    borderRadius: 100,
    padding: "0.4rem 1rem",
    color: active ? "var(--plum)" : "var(--grey)",
    fontWeight: active ? 500 : 400,
    fontSize: "0.875rem",
    textDecoration: "none" as const,
    transition: "all 0.2s",
    cursor: "pointer" as const,
    display: "inline-block" as const,
  });

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

      {/* ── Nav ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>

        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>

        <div style={{ display: "flex", gap: "0.15rem" }}>
          <Link href="/"     style={navLink(true)}>Search</Link>
          <Link href="/shop" style={navLink(false)}>Shop</Link>
          <Link href="/earn" style={navLink(false)}>Earn</Link>
          {user && <Link href="/dashboard" style={navLink(false)}>Dashboard</Link>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Cart */}
          <button
            onClick={() => setShowCart(true)}
            aria-label={`Cart — ${cartCount} item${cartCount !== 1 ? "s" : ""}`}
            style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: "0.3rem", color: "var(--grey)", display: "flex" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
            <button className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }} onClick={() => { setShowAuth(true); setAuthMode("login"); }}>Sign in</button>
          )}
        </div>
      </nav>

      {/* ── Page ── */}
      <div style={{ flex: 1 }}>
        <main style={{ minHeight: "80vh", background: "var(--white)" }}>

          {/* Hero */}
          <section style={{ background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)", padding: "5rem 1.5rem 3rem", textAlign: "center" }}>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "1rem" }}>beauty, near you</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.5rem,6vw,4.5rem)", fontWeight: 300, color: "var(--onyx)", lineHeight: 1.1, marginBottom: "1.25rem" }}>
              You are <em style={{ color: "var(--plum)", fontStyle: "italic" }}>beautiful</em>
            </h1>
            <p style={{ fontSize: "1.1rem", color: "var(--grey)", maxWidth: 480, margin: "0 auto" }}>
              Book trusted hair stylists, nail techs &amp; makeup artists — right in your neighbourhood.
            </p>
          </section>

          {/* Category pills */}
          <section style={{ padding: "2rem 1.5rem 0", maxWidth: 900, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{ flexShrink: 0, borderRadius: 100, padding: "0.5rem 1.25rem", background: activeCategory === cat ? "var(--plum)" : "var(--plum-t)", color: activeCategory === cat ? "#fff" : "var(--plum)", border: "none", fontWeight: 500, fontSize: "0.875rem", transition: "all 0.2s", cursor: "pointer" }}
                >
                  {cat}
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
              onChange={e => {
                setSearchQuery(e.target.value);
                if (e.target.value.length > 2) {
                  ttq("Search", { search_string: e.target.value });
                  fbq("Search", { search_string: e.target.value });
                  gTag("search", { search_term: e.target.value });
                }
              }}
              style={{ width: "100%", padding: "0.75rem 1.25rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", fontSize: "0.95rem", color: "var(--onyx)", background: "var(--plum-t)", boxSizing: "border-box" }}
            />
          </section>

          {/* Artist grid */}
          <section id="artists" style={{ padding: "2rem 1.5rem 4rem", maxWidth: 900, margin: "0 auto" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.5rem", marginBottom: "1.5rem", color: "var(--onyx)" }}>
              {activeCategory === "All" ? "All artists" : `${activeCategory} artists`}
              <span style={{ fontSize: "0.9rem", color: "var(--grey)", fontFamily: "var(--font-body)", fontWeight: 400, marginLeft: "0.5rem" }}>({artists.length})</span>
            </h2>

            {loading && (
              <p style={{ color: "var(--grey)", textAlign: "center", padding: "3rem 0" }}>
                Loading artists…
              </p>
            )}

            {!loading && artists.length === 0 && (
              <p style={{ color: "var(--grey)", textAlign: "center", padding: "3rem 0" }}>
                No artists found. Try a different search or category.
              </p>
            )}

            {!loading && artists.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "1.25rem" }}>
                {artists.map(artist => (
                  <ArtistCard
                    key={artist.id}
                    artist={artist}
                    onBook={() => {
                      if (!user) { setShowAuth(true); setAuthMode("login"); return; }
                      setSelectedArtist(artist);
                      ttq("ViewContent", { contents: [{ content_id: artist.id, content_name: artist.display_name }] });
                      fbq("ViewContent", { content_ids: [artist.id], content_name: artist.display_name });
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {/* ── Footer ── */}
      <Footer />

      {/* ── Cart drawer ── */}
      {showCart && (
        <div className="modal-overlay" onClick={() => setShowCart(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: "min(360px,100vw)", background: "#fff", boxShadow: "-4px 0 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", zIndex: 10000 }}>
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid rgba(155,127,184,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", margin: 0 }}>Your cart</h3>
              <button onClick={() => setShowCart(false)} style={{ background: "none", border: "none", fontSize: "1.4rem", color: "var(--light)", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem" }}>
              {cart.length === 0
                ? <p style={{ color: "var(--light)", textAlign: "center", marginTop: "2rem" }}>Your cart is empty.</p>
                : cart.map((item, i) => (
                  <div key={`${item.id}-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid rgba(155,127,184,0.08)" }}>
                    <div>
                      <p style={{ fontWeight: 500, fontSize: "0.9rem", margin: 0 }}>{item.name}</p>
                      <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: 0 }}>{fmt(item.price)}</p>
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
                <Link href="/shop" onClick={() => setShowCart(false)}>
                  <button className="btn-plum" style={{ width: "100%" }}>Go to Shop</button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Auth modal ── */}
      {showAuth && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setShowAuth(false); setAuthError(""); } }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.6rem", marginBottom: "0.25rem" }}>
              {authMode === "login" ? "Welcome back" : "Create account"}
            </h2>
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              {authMode === "login" ? "Sign in to book your next appointment." : "Join Umuhle — it's free."}
            </p>

            {/* OAuth */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <button onClick={() => handleOAuth("google")} disabled={authLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "1.5px solid #E0E0E0", background: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}>
                <svg width="20" height="20" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.7-6.7C35.8 2.4 30.2 0 24 0 14.8 0 6.9 5.4 3 13.3l7.8 6.1C12.6 13.1 17.9 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.5c-.5 2.8-2.1 5.2-4.5 6.8l7 5.4c4.1-3.8 6.5-9.4 6.5-16.2z"/>
                  <path fill="#FBBC05" d="M10.8 28.5A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.7-4.5L2.4 13.4A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8.2-6.2z"/>
                  <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.4-4.6 2.2-8.2 2.2-6.1 0-11.3-4.1-13.2-9.7l-8.2 6.2C6.9 42.6 14.8 48 24 48z"/>
                </svg>
                Continue with Google
              </button>
              <button onClick={() => handleOAuth("facebook")} disabled={authLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: 12, border: "none", background: "#1877F2", color: "#fff", fontWeight: 500, fontSize: "0.9rem", cursor: "pointer" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                  <path d="M24 12a12 12 0 1 0-13.875 11.85v-8.385H7.08V12h3.045V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.465h-2.796v8.385A12 12 0 0 0 24 12z"/>
                </svg>
                Continue with Facebook
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
              <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
              <span style={{ fontSize: "0.8rem", color: "var(--light)" }}>or</span>
              <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
            </div>

            <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {authMode === "register" && (
                <>
                  <input placeholder="Full name" value={authForm.name} onChange={e => setAuthForm(f => ({ ...f, name: e.target.value }))} required style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
                  <input placeholder="Phone number (e.g. 082 123 4567)" value={authForm.phone} onChange={e => setAuthForm(f => ({ ...f, phone: e.target.value }))} style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />

                  <div>
                    <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      I am signing up as
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
                      {ACCOUNT_TYPES.map(t => (
                        <button
                          type="button"
                          key={t.id}
                          onClick={() => setAccountType(t.id)}
                          style={{
                            padding: "0.6rem 0.4rem", borderRadius: 12, fontSize: "0.78rem", fontWeight: 500,
                            border: `1.5px solid ${accountType === t.id ? "var(--plum)" : "#E0E0E0"}`,
                            background: accountType === t.id ? "var(--plum-t)" : "#fff",
                            color: accountType === t.id ? "var(--plum)" : "var(--grey)", cursor: "pointer",
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {accountType === "artist" && (
                    <select
                      value={artistCategory}
                      onChange={e => setArtistCategory(e.target.value)}
                      style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", background: "#fff" }}
                    >
                      {ARTIST_CATEGORIES.map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <input type="email" placeholder="Email address" value={authForm.email} onChange={e => setAuthForm(f => ({ ...f, email: e.target.value }))} required style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
              <input type="password" placeholder="Password" value={authForm.password} onChange={e => setAuthForm(f => ({ ...f, password: e.target.value }))} required style={{ padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
              {authError && (
                <p style={{ color: authError.includes("Check your email") ? "var(--forest)" : "#E53935", fontSize: "0.85rem", margin: 0 }}>
                  {authError}
                </p>
              )}
              <button type="submit" className="btn-plum" style={{ marginTop: "0.25rem" }} disabled={authLoading}>
                {authLoading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p style={{ textAlign: "center", marginTop: "1.25rem", fontSize: "0.875rem", color: "var(--grey)" }}>
              {authMode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }} style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 500, cursor: "pointer" }}>
                {authMode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>

            <p style={{ textAlign: "center", marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--light)" }}>
              By continuing you agree to our{" "}
              <Link href="/terms-and-conditions" style={{ color: "var(--plum)" }} onClick={() => setShowAuth(false)}>Terms</Link>
              {" "}and{" "}
              <Link href="/privacy-policy" style={{ color: "var(--plum)" }} onClick={() => setShowAuth(false)}>Privacy Policy</Link>
            </p>
          </div>
        </div>
      )}

      {/* ── Booking modal ── */}
      {selectedArtist && (
        <BookingDrawer artist={selectedArtist} onClose={() => setSelectedArtist(null)} user={user!} />
      )}
    </div>
  );
}

// ─── Artist card ──────────────────────────────────────────────────────────────
function ArtistCard({ artist, onBook }: { artist: Artist; onBook: () => void }) {
  return (
    <div
      style={{ borderRadius: 18, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff", transition: "transform 0.2s, box-shadow 0.2s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 12px 40px rgba(155,127,184,0.15)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
    >
      <div style={{ height: 180, overflow: "hidden", position: "relative", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={artist.avatar_url ?? "/umuhle-icon.png"} alt={artist.display_name} width={100} height={100} style={{ objectFit: "contain", opacity: 0.85 }} />
        {artist.is_verified && <span style={{ position: "absolute", top: 10, right: 10, background: "var(--forest)", color: "#fff", borderRadius: 100, padding: "0.2rem 0.6rem", fontSize: "0.7rem", fontWeight: 600 }}>Verified</span>}
        <span style={{ position: "absolute", bottom: 10, left: 10, background: "rgba(255,255,255,0.9)", borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.75rem", fontWeight: 500, color: "var(--plum)", backdropFilter: "blur(4px)" }}>
          {CAT_ICONS[artist.category] ?? ""} {artist.category}
        </span>
      </div>
      <div style={{ padding: "1rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.05rem", marginBottom: "0.25rem" }}>{artist.display_name}</h3>
        <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.5rem" }}>{artist.suburb}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <span style={{ color: "#F4B400", fontSize: "0.85rem" }}>★ {artist.rating.toFixed(1)}</span>
          <span style={{ fontSize: "0.75rem", color: "var(--light)" }}>{artist.review_count} reviews</span>
        </div>
        <button className="btn-plum" style={{ width: "100%", padding: "0.6rem" }} onClick={onBook}>Book now</button>
      </div>
    </div>
  );
}

// ─── Booking drawer ───────────────────────────────────────────────────────────
function BookingDrawer({ artist, onClose, user }: { artist: Artist; onClose: () => void; user: User }) {
  const supabase = createClient();
  type Service = { id: string; name: string; price: number; duration_minutes: number };
  const [services, setServices]   = useState<Service[]>([]);
  const [selected, setSelected]   = useState<Service | null>(null);
  const [date, setDate]           = useState("");
  const [time, setTime]           = useState("");
  const [address, setAddress]     = useState("");
  const [pocName, setPocName]     = useState("");
  const [pocPhone, setPocPhone]   = useState("");
  const [step, setStep]           = useState<"services" | "datetime" | "confirm">("services");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");

  useEffect(() => {
    supabase.from("services").select("id, name, price, duration_minutes").eq("artist_id", artist.id).eq("is_active", true)
      .then(({ data }) => setServices((data ?? []) as Service[]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist.id]);

  const handleBook = async () => {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/payfast/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "booking", serviceId: selected.id, artistId: artist.id, bookingDate: date, bookingTime: time, meetingAddress: address, clientPocName: pocName, clientPocPhone: pocPhone }),
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
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const minDate = new Date(); minDate.setDate(minDate.getDate() + 1);
  const inputStyle: React.CSSProperties = { padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1.5rem" }}>
          <Image src={artist.avatar_url ?? "/umuhle-icon.png"} alt={artist.display_name} width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <div>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.2rem", margin: 0 }}>{artist.display_name}</h3>
            <p style={{ color: "var(--grey)", fontSize: "0.85rem", margin: 0 }}>{artist.suburb} · ★ {artist.rating.toFixed(1)}</p>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: "1.4rem", color: "var(--light)", lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>

        {step === "services" && (
          <>
            <h4 style={{ fontWeight: 500, marginBottom: "1rem" }}>Choose a service</h4>
            {services.length === 0 && <p style={{ color: "var(--grey)" }}>No services listed yet.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {services.map(svc => (
                <button key={svc.id} onClick={() => { setSelected(svc); setStep("datetime"); }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderRadius: 14, border: `1.5px solid ${selected?.id === svc.id ? "var(--plum)" : "rgba(155,127,184,0.2)"}`, background: "var(--plum-t)", textAlign: "left", cursor: "pointer" }}>
                  <div><div style={{ fontWeight: 500, fontSize: "0.95rem" }}>{svc.name}</div><div style={{ fontSize: "0.8rem", color: "var(--grey)", marginTop: 2 }}>{svc.duration_minutes} min</div></div>
                  <div style={{ fontWeight: 600, color: "var(--plum)", fontSize: "1rem" }}>{fmt(svc.price)}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "datetime" && (
          <>
            <button onClick={() => setStep("services")} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", marginBottom: "1rem" }}>Back</button>
            <h4 style={{ fontWeight: 500, marginBottom: "1rem" }}>Pick a date &amp; time</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <input type="date" value={date} min={minDate.toISOString().split("T")[0]} onChange={e => setDate(e.target.value)} style={inputStyle} />
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
              <input type="text" placeholder="Meeting address (optional)" value={address} onChange={e => setAddress(e.target.value)} style={inputStyle} />
              <div>
                <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "0.5rem" }}>Point of contact (optional)</p>
                <input type="text" placeholder="Contact name" value={pocName} onChange={e => setPocName(e.target.value)} style={{ ...inputStyle, marginBottom: "0.75rem" }} />
                <input type="tel" placeholder="Contact phone" value={pocPhone} onChange={e => setPocPhone(e.target.value)} style={inputStyle} />
              </div>
              <button className="btn-plum" disabled={!date || !time} onClick={() => setStep("confirm")}>Review booking</button>
            </div>
          </>
        )}

        {step === "confirm" && selected && (
          <>
            <button onClick={() => setStep("datetime")} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", marginBottom: "1rem" }}>Back</button>
            <h4 style={{ fontWeight: 500, marginBottom: "1.25rem" }}>Confirm booking</h4>
            <div style={{ background: "var(--surface)", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem" }}>
              {([["Artist", artist.display_name], ["Service", selected.name], ["Date", date], ["Time", time], ...(address ? [["Address", address]] : [])] as [string, string][]).map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontSize: "0.9rem" }}>
                  <span style={{ color: "var(--grey)" }}>{l}</span><span>{v}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px dashed rgba(155,127,184,0.3)", margin: "0.75rem 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontSize: "0.9rem" }}>
                <span style={{ color: "var(--grey)" }}>Total</span>
                <span style={{ fontWeight: 700, color: "var(--plum)" }}>{fmt(selected.price)}</span>
              </div>
            </div>
            {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
            <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "1.25rem" }}>
              You will be redirected to PayFast to complete payment securely. Once paid, you will receive a WhatsApp confirmation.
            </p>
            <button className="btn-plum" style={{ width: "100%", padding: "0.875rem" }} onClick={handleBook} disabled={loading}>
              {loading ? "Redirecting to PayFast…" : `Pay ${fmt(selected.price)} securely`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
