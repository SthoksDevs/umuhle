"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Artist, Profile } from "@/types";
import Image from "next/image";
import Link from "next/link";

// ── Analytics helpers ─────────────────────────────────────────────────────────
declare global {
  interface Window {
    ttq?: { track: (e: string, p?: Record<string, unknown>) => void };
    fbq?: (cmd: string, event: string, params?: Record<string, unknown>) => void;
    gtag?: (...a: unknown[]) => void;
  }
}
const track = {
  ttq: (e: string, p?: Record<string, unknown>) => typeof window !== "undefined" && window.ttq?.track(e, p),
  fbq: (e: string, p?: Record<string, unknown>) => typeof window !== "undefined" && window.fbq?.("track", e, p),
  gtag: (e: string, p?: Record<string, unknown>) => typeof window !== "undefined" && window.gtag?.("event", e, p),
};

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
const CATEGORIES = ["All", "Hair", "Nails", "Makeup", "Lashes"] as const;
type Category = typeof CATEGORIES[number];

const SOCIALS = [
  { label: "Facebook",  href: "https://web.facebook.com/umuhlebeautiful" },
  { label: "Instagram", href: "https://www.instagram.com/umuhle_beautiful/" },
  { label: "TikTok",    href: "http://tiktok.com/@umuhle_beautiful" },
  { label: "WhatsApp",  href: "https://wa.me/27733014819" },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const supabase = createClient();

  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Search state
  const [artists, setArtists]           = useState<Artist[]>([]);
  const [loading, setLoading]           = useState(false);
  const [searchQuery, setSearchQuery]   = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("All");

  // Auth modal
  const [showAuth, setShowAuth]   = useState(false);
  const [authMode, setAuthMode]   = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authForm, setAuthForm]   = useState({ email: "", password: "", name: "", phone: "" });

  // Selected artist for booking preview
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

  // Open auth modal if ?auth=login in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "login") { setShowAuth(true); setAuthMode("login"); }
    if (params.get("auth") === "register") { setShowAuth(true); setAuthMode("register"); }
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

    if (activeCategory !== "All") {
      query = query.eq("category", activeCategory.toLowerCase());
    }
    if (searchQuery.trim()) {
      query = query.ilike("display_name", `%${searchQuery.trim()}%`);
    }

    const { data } = await query;
    setArtists((data ?? []) as Artist[]);
    setLoading(false);
  }, [activeCategory, searchQuery]);

  useEffect(() => {
    const t = setTimeout(fetchArtists, 300);
    return () => clearTimeout(t);
  }, [fetchArtists]);

  // ── Auth handlers ────────────────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) throw error;
        setShowAuth(false);
        track.gtag("login", { method: "email" });
        track.fbq("Login");
      } else {
        const { error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
          options: {
            data: { full_name: authForm.name, phone: authForm.phone },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        setAuthError("Check your email to confirm your account.");
        track.gtag("sign_up", { method: "email" });
        track.fbq("CompleteRegistration");
        track.ttq("CompleteRegistration");
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#1a1025] text-white">

      {/* ── Top nav ── */}
      <header className="sticky top-0 z-50 bg-[#1a1025]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src={ICON} alt="Umuhle" width={28} height={28} className="rounded-full object-cover" />
            <span className="font-semibold text-sm tracking-wide">umuhle</span>
          </Link>

          {/* Nav links */}
          <nav className="hidden sm:flex items-center gap-6 text-sm">
            <Link href="/"        className="text-white/70 hover:text-white transition-colors">Search</Link>
            <Link href="/shop"    className="text-white/70 hover:text-white transition-colors">Shop</Link>
            <Link href="/earn"    className="text-white/70 hover:text-white transition-colors">Earn</Link>
          </nav>

          {/* Auth */}
          <div className="flex items-center gap-2">
            {user ? (
              <div className="flex items-center gap-2">
                <Link href="/dashboard" className="text-sm text-white/70 hover:text-white transition-colors hidden sm:block">
                  Dashboard
                </Link>
                <button
                  onClick={handleSignOut}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setShowAuth(true); setAuthMode("login"); }}
                className="bg-[#c9a96e] text-[#1a1025] text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-[#d4b87a] transition-colors"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-4 pt-16 pb-10 text-center">
        <p className="text-[#c9a96e] text-xs tracking-[0.3em] uppercase mb-3">South Africa&apos;s Beauty Marketplace</p>
        <h1 className="text-4xl sm:text-5xl font-light mb-4 leading-tight">
          Find your perfect<br />
          <em className="italic text-[#c9a96e]">beauty artist</em>
        </h1>
        <p className="text-white/50 text-sm max-w-md mx-auto mb-8">
          Book hair stylists, nail technicians, makeup artists and more — wherever you are in South Africa.
        </p>

        {/* Search bar */}
        <div className="max-w-lg mx-auto relative">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search artists, styles, locations…"
            className="w-full bg-white/10 border border-white/20 rounded-full px-5 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#c9a96e] transition-colors"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 text-sm">⌕</span>
        </div>
      </section>

      {/* ── Category tabs ── */}
      <section className="max-w-6xl mx-auto px-4 pb-6">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-[#c9a96e] text-[#1a1025]"
                  : "bg-white/10 text-white/60 hover:bg-white/15"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* ── Artist grid ── */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white/5 rounded-2xl h-56 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && artists.length === 0 && (
          <div className="text-center py-20">
            <p className="text-white/40 text-sm">No artists found. Try a different search or category.</p>
          </div>
        )}

        {!loading && artists.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {artists.map(artist => (
              <ArtistCard
                key={artist.id}
                artist={artist}
                onBook={() => {
                  if (!user) { setShowAuth(true); setAuthMode("login"); return; }
                  setSelectedArtist(artist);
                  track.fbq("InitiateCheckout", { content_name: artist.display_name });
                  track.ttq("InitiateCheckout");
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Bottom nav (mobile) ── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#1a1025] border-t border-white/10">
        <div className="grid grid-cols-4 h-14">
          {[
            { label: "Search", href: "/",          icon: "⌕" },
            { label: "Shop",   href: "/shop",       icon: "🛍" },
            { label: "Earn",   href: "/earn",        icon: "💰" },
            { label: user ? "Account" : "Sign in", href: user ? "/dashboard" : "#", icon: "👤" },
          ].map(item => (
            item.href === "#" ? (
              <button
                key={item.label}
                onClick={() => { setShowAuth(true); setAuthMode("login"); }}
                className="flex flex-col items-center justify-center gap-0.5 text-white/50 hover:text-white transition-colors"
              >
                <span className="text-lg leading-none">{item.icon}</span>
                <span className="text-[10px]">{item.label}</span>
              </button>
            ) : (
              <Link
                key={item.label}
                href={item.href}
                className="flex flex-col items-center justify-center gap-0.5 text-white/50 hover:text-white transition-colors"
              >
                <span className="text-lg leading-none">{item.icon}</span>
                <span className="text-[10px]">{item.label}</span>
              </Link>
            )
          ))}
        </div>
      </nav>

      {/* ── Footer ── */}
      <footer className="border-t border-white/10 py-10 pb-20 sm:pb-10">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 text-xs text-white/40">
          <div className="flex items-center gap-2">
            <Image src={ICON} alt="Umuhle" width={20} height={20} className="rounded-full object-cover opacity-60" />
            <span>© {new Date().getFullYear()} Umuhle (Pty) Ltd</span>
          </div>
          <div className="flex flex-wrap gap-4">
            {SOCIALS.map(s => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="hover:text-white/70 transition-colors">{s.label}</a>
            ))}
            <Link href="/privacy-policy" className="hover:text-white/70 transition-colors">Privacy</Link>
            <Link href="/terms-and-conditions" className="hover:text-white/70 transition-colors">Terms</Link>
          </div>
        </div>
      </footer>

      {/* ── Auth modal ── */}
      {showAuth && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowAuth(false); }}
        >
          <div className="bg-[#231535] rounded-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-base">
                {authMode === "login" ? "Welcome back" : "Create account"}
              </h2>
              <button onClick={() => setShowAuth(false)} className="text-white/40 hover:text-white text-xl leading-none">×</button>
            </div>

            {/* Google */}
            <button
              onClick={handleGoogleLogin}
              disabled={authLoading}
              className="w-full flex items-center justify-center gap-2 bg-white text-[#1a1025] rounded-xl py-2.5 text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3 text-white/20 text-xs">
              <div className="flex-1 h-px bg-white/10" />or<div className="flex-1 h-px bg-white/10" />
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-3">
              {authMode === "register" && (
                <>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={authForm.name}
                    onChange={e => setAuthForm(f => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#c9a96e]"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number (optional)"
                    value={authForm.phone}
                    onChange={e => setAuthForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#c9a96e]"
                  />
                </>
              )}
              <input
                type="email"
                placeholder="Email address"
                value={authForm.email}
                onChange={e => setAuthForm(f => ({ ...f, email: e.target.value }))}
                required
                className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#c9a96e]"
              />
              <input
                type="password"
                placeholder="Password"
                value={authForm.password}
                onChange={e => setAuthForm(f => ({ ...f, password: e.target.value }))}
                required
                className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#c9a96e]"
              />

              {authError && (
                <p className={`text-xs px-1 ${authError.includes("Check your email") ? "text-green-400" : "text-red-400"}`}>
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-[#c9a96e] text-[#1a1025] font-semibold rounded-xl py-2.5 text-sm hover:bg-[#d4b87a] transition-colors disabled:opacity-50"
              >
                {authLoading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="text-center text-xs text-white/40">
              {authMode === "login" ? (
                <>Don&apos;t have an account? <button onClick={() => { setAuthMode("register"); setAuthError(""); }} className="text-[#c9a96e] hover:underline">Sign up</button></>
              ) : (
                <>Already have an account? <button onClick={() => { setAuthMode("login"); setAuthError(""); }} className="text-[#c9a96e] hover:underline">Sign in</button></>
              )}
            </p>

            <p className="text-center text-[10px] text-white/25 leading-relaxed">
              By continuing you agree to our{" "}
              <Link href="/terms-and-conditions" className="underline hover:text-white/50" onClick={() => setShowAuth(false)}>Terms</Link>
              {" "}and{" "}
              <Link href="/privacy-policy" className="underline hover:text-white/50" onClick={() => setShowAuth(false)}>Privacy Policy</Link>
            </p>
          </div>
        </div>
      )}

      {/* ── Booking preview drawer ── */}
      {selectedArtist && (
        <BookingDrawer
          artist={selectedArtist}
          onClose={() => setSelectedArtist(null)}
          user={user!}
        />
      )}
    </div>
  );
}

// ─── Artist card ──────────────────────────────────────────────────────────────
function ArtistCard({ artist, onBook }: { artist: Artist; onBook: () => void }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition-colors group">
      <div className="relative h-40 bg-white/5">
        <Image
          src={artist.avatar_url ?? "/umuhle-icon.png"}
          alt={artist.display_name}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          onError={e => { (e.target as HTMLImageElement).src = "/umuhle-icon.png"; }}
        />
        {artist.is_verified && (
          <span className="absolute top-2 right-2 bg-[#c9a96e] text-[#1a1025] text-[10px] font-bold px-2 py-0.5 rounded-full">
            ✓ Verified
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-semibold text-sm leading-tight">{artist.display_name}</h3>
          <span className="text-xs text-white/50 shrink-0 ml-2">⭐ {artist.rating.toFixed(1)}</span>
        </div>
        <p className="text-xs text-[#c9a96e] capitalize mb-1">{artist.category}</p>
        <p className="text-xs text-white/40 mb-1">{artist.suburb ? `${artist.suburb}, ` : ""}{artist.city}</p>
        <p className="text-xs text-white/50 line-clamp-2 mb-3">{artist.bio}</p>
        <button
          onClick={onBook}
          className="w-full bg-[#c9a96e] text-[#1a1025] text-xs font-semibold py-2 rounded-xl hover:bg-[#d4b87a] transition-colors"
        >
          Book now
        </button>
      </div>
    </div>
  );
}

// ─── Booking drawer ───────────────────────────────────────────────────────────
function BookingDrawer({ artist, onClose, user }: { artist: Artist; onClose: () => void; user: User }) {
  const supabase = createClient();
  type Service = { id: string; name: string; price: number; duration_minutes: number };
  const [services, setServices]     = useState<Service[]>([]);
  const [selected, setSelected]     = useState<Service | null>(null);
  const [date, setDate]             = useState("");
  const [time, setTime]             = useState("");
  const [address, setAddress]       = useState("");
  const [pocName, setPocName]       = useState("");
  const [pocPhone, setPocPhone]     = useState("");
  const [step, setStep]             = useState<"services" | "datetime" | "confirm">("services");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  useEffect(() => {
    supabase
      .from("services")
      .select("id, name, price, duration_minutes")
      .eq("artist_id", artist.id)
      .eq("is_active", true)
      .then(({ data }) => setServices((data ?? []) as Service[]));
  }, [artist.id]);

  const handleBook = async () => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/payfast/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "booking",
          serviceId: selected.id,
          artistId: artist.id,
          bookingDate: date,
          bookingTime: time,
          meetingAddress: address,
          clientPocName: pocName,
          clientPocPhone: pocPhone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment initiation failed");

      // Submit PayFast form
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);
  const minDateStr = minDate.toISOString().split("T")[0];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#231535] rounded-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Book {artist.display_name}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Step: Services */}
        {step === "services" && (
          <div className="space-y-2">
            <p className="text-xs text-white/40 mb-3">Select a service</p>
            {services.length === 0 && <p className="text-xs text-white/30">No services listed yet.</p>}
            {services.map(s => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                  selected?.id === s.id
                    ? "border-[#c9a96e] bg-[#c9a96e]/10"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-[#c9a96e] font-semibold text-sm">{fmt(s.price)}</span>
                </div>
                <p className="text-xs text-white/40 mt-0.5">~{s.duration_minutes} min</p>
              </button>
            ))}
            <button
              disabled={!selected}
              onClick={() => setStep("datetime")}
              className="w-full bg-[#c9a96e] text-[#1a1025] font-semibold rounded-xl py-2.5 text-sm mt-2 disabled:opacity-40 hover:bg-[#d4b87a] transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step: Date & time */}
        {step === "datetime" && (
          <div className="space-y-3">
            <p className="text-xs text-white/40">Choose date &amp; time</p>
            <input
              type="date"
              min={minDateStr}
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#c9a96e]"
            />
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#c9a96e]"
            />
            <input
              type="text"
              placeholder="Meeting address (optional)"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#c9a96e]"
            />
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-white/40 mb-2">Point of contact (optional)</p>
              <input
                type="text"
                placeholder="Contact name"
                value={pocName}
                onChange={e => setPocName(e.target.value)}
                className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#c9a96e] mb-2"
              />
              <input
                type="tel"
                placeholder="Contact phone"
                value={pocPhone}
                onChange={e => setPocPhone(e.target.value)}
                className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#c9a96e]"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("services")} className="flex-1 border border-white/20 rounded-xl py-2.5 text-sm text-white/60 hover:border-white/40">Back</button>
              <button
                disabled={!date || !time}
                onClick={() => setStep("confirm")}
                className="flex-1 bg-[#c9a96e] text-[#1a1025] font-semibold rounded-xl py-2.5 text-sm disabled:opacity-40 hover:bg-[#d4b87a] transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step: Confirm */}
        {step === "confirm" && selected && (
          <div className="space-y-4">
            <div className="bg-white/5 rounded-xl p-4 space-y-2 text-sm">
              <Row label="Service"  value={selected.name} />
              <Row label="Artist"   value={artist.display_name} />
              <Row label="Date"     value={date} />
              <Row label="Time"     value={time} />
              {address && <Row label="Address" value={address} />}
              <div className="border-t border-white/10 pt-2 mt-2">
                <Row label="Total" value={fmt(selected.price)} highlight />
              </div>
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("datetime")} className="flex-1 border border-white/20 rounded-xl py-2.5 text-sm text-white/60 hover:border-white/40">Back</button>
              <button
                onClick={handleBook}
                disabled={loading}
                className="flex-1 bg-[#c9a96e] text-[#1a1025] font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 hover:bg-[#d4b87a] transition-colors"
              >
                {loading ? "Redirecting…" : "Pay now"}
              </button>
            </div>
            <p className="text-[10px] text-white/25 text-center">Redirecting to PayFast — secure payment</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/50 text-xs">{label}</span>
      <span className={`text-xs font-medium ${highlight ? "text-[#c9a96e] font-semibold" : "text-white"}`}>{value}</span>
    </div>
  );
}
