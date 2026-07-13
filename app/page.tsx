"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Artist, Profile } from "@/types";
import Image from "next/image";
import Link from "next/link";
import Footer from "@/components/Footer";
import SiteHeader from "@/components/SiteHeader";
import StarRating from "@/components/StarRating";
import { gTag, fbq, ttq } from "@/lib/analytics";

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
const CATEGORIES = ["All", "Hair", "Nails", "Makeup", "Lashes"] as const;
type Category = typeof CATEGORIES[number];
const CAT_ICONS: Record<string, string> = { hair: "✂", nails: "◈", makeup: "◉", lashes: "◎" };

type CartItem = { id: string; name: string; price: number };

// ── Booking payment gateway picker ──────────────────────────────────────────
// Mirrors the PayMethod pattern in app/checkout/page.tsx, minus google_pay
// (not part of lib/payments/gateways.ts's pause system, and not wired up
// for bookings — see BookingDrawer below).
type BookingPayMethod = "payfast" | "ozow" | "happypay";
const BOOKING_GATEWAY_LABEL: Record<BookingPayMethod, string> = {
  payfast: "PayFast", ozow: "Ozow", happypay: "HappyPay",
};

// ── Pending "add to wishlist" intent ────────────────────────────────────────
// Same idea as the cart's pending-add: if a logged-out visitor taps the heart
// on an artist card, we remember which artist they meant, send them through
// auth, and replay the save once they're signed in.
const PENDING_WISHLIST_KEY = "umuhle_pending_wishlist_add";
function setPendingWishlistAdd(artistId: string) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(PENDING_WISHLIST_KEY, artistId); } catch { /* ignore */ }
}
function getPendingWishlistAdd(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem(PENDING_WISHLIST_KEY); } catch { return null; }
}
function clearPendingWishlistAdd() {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(PENDING_WISHLIST_KEY); } catch { /* ignore */ }
}

// ─── Category pill nav with scroll arrow ──────────────────────────────────────
function CategoryPillNav({ active, onChange }: { active: Category; onChange: (c: Category) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);
    return () => { el.removeEventListener("scroll", checkScroll); window.removeEventListener("resize", checkScroll); };
  }, []);

  return (
    <div style={{ position: "relative", padding: "0 1.5rem" }}>
      <div ref={scrollRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <div style={{ display: "flex", gap: "0", width: "max-content", minWidth: "90vw" }}>
          {CATEGORIES.map((cat, i) => {
            const isActive = active === cat;
            const isFirst = i === 0;
            const isLast = i === CATEGORIES.length - 1;
            return (
              <button
                key={cat}
                onClick={() => onChange(cat)}
                style={{
                  flex: "0 0 auto",
                  padding: "0.55rem 1.25rem",
                  background: isActive ? "var(--plum)" : "#fff",
                  color: isActive ? "#fff" : "var(--grey)",
                  border: "1.5px solid",
                  borderColor: isActive ? "var(--plum)" : "rgba(155,127,184,0.25)",
                  borderRadius: isFirst ? "100px 0 0 100px" : isLast ? "0 100px 100px 0" : "0",
                  borderLeft: !isFirst ? "none" : undefined,
                  fontWeight: isActive ? 600 : 400,
                  fontSize: "0.85rem",
                  transition: "all 0.18s",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.01em",
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>
      {canScrollRight && (
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: "smooth" })}
          aria-label="Scroll categories"
          style={{
            position: "absolute", right: "1.5rem", top: "50%", transform: "translateY(-50%)",
            background: "linear-gradient(to left, #fff 60%, transparent)",
            border: "none", cursor: "pointer", padding: "0.35rem 0.5rem 0.35rem 1.5rem",
            color: "var(--plum)", fontSize: "1.1rem", lineHeight: 1, display: "flex", alignItems: "center",
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}

// ─── Merged search + filter bar ───────────────────────────────────────────────
function SearchWithFilter<T extends string>({
  searchValue,
  onSearchChange,
  activeCategories,
  onCategoryChange,
  categories,
  placeholder = "Search…",
}: {
  searchValue: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activeCategories: T[];
  onCategoryChange: (cats: T[]) => void;
  categories: readonly T[];
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

  const toggleCat = (cat: T) => {
    const next = activeCategories.includes(cat)
      ? activeCategories.filter(c => c !== cat)
      : [...activeCategories, cat];
    onCategoryChange(next);
  };

  const activeCount = activeCategories.length;

  return (
    <div ref={dropRef} style={{ maxWidth: 600, margin: "0 auto", position: "relative" }}>
      <div style={{
        display: "flex", alignItems: "center", background: "#fff",
        borderRadius: 100, border: "2px solid rgba(255,255,255,0.4)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden",
        backdropFilter: "blur(8px)",
      }}>
        {/* Search icon */}
        <span style={{ paddingLeft: "1.1rem", color: "var(--grey)", fontSize: "1rem", flexShrink: 0 }}>🔍</span>

        {/* Text input */}
        <input
          type="text"
          placeholder={placeholder}
          value={searchValue}
          onChange={onSearchChange}
          style={{
            flex: 1, border: "none", outline: "none", padding: "0.85rem 0.75rem",
            fontSize: "0.95rem", color: "var(--onyx)", background: "transparent",
            minWidth: 0,
          }}
        />

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: "rgba(155,127,184,0.2)", flexShrink: 0 }} />

        {/* Filter button */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            padding: "0.7rem 1.1rem", border: "none", background: "transparent",
            cursor: "pointer", color: activeCount > 0 ? "var(--plum)" : "var(--grey)",
            fontSize: "0.875rem", fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap",
          }}
        >
          <svg width="15" height="13" viewBox="0 0 15 13" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 1h15M3 6.5h9M6 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          Filter{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.2)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.14)", padding: "1rem", minWidth: 220,
          zIndex: 9999,
        }}>
          <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>Filter by category</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
            {categories.map(cat => {
              const checked = activeCategories.includes(cat);
              return (
                <label key={cat} style={{ display: "flex", alignItems: "center", gap: "0.65rem", padding: "0.5rem 0.4rem", borderRadius: 10, cursor: "pointer", background: checked ? "var(--plum-t)" : "transparent", transition: "background 0.15s" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCat(cat)}
                    style={{ accentColor: "var(--plum)", width: 16, height: 16, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "0.9rem", color: checked ? "var(--plum)" : "var(--onyx)", fontWeight: checked ? 500 : 400 }}>{cat}</span>
                </label>
              );
            })}
          </div>
          {activeCount > 0 && (
            <button
              onClick={() => { onCategoryChange([]); }}
              style={{ marginTop: "0.75rem", width: "100%", padding: "0.45rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "transparent", color: "var(--grey)", fontSize: "0.82rem", cursor: "pointer" }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const supabase = createClient();
  const router = useRouter();

  const [user, setUser]           = useState<User | null>(null);
  const [profile, setProfile]     = useState<Profile | null>(null);
  const [artists, setArtists]     = useState<Artist[]>([]);
  const [loading, setLoading]     = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState<Category[]>([]);

  // Cart
  const [cart, setCart]           = useState<CartItem[]>([]);
  const [showCart, setShowCart]   = useState(false);

  // Wishlist — artist IDs the signed-in user has saved
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());

  // Mobile nav - handled by SiteHeader

  // Booking
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);

  // ── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
      if (user) fetchProfile(user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        // Only redirect on a fresh sign-in or OAuth callback — not on INITIAL_SESSION
        // (which fires for already-logged-in users visiting the homepage)
        if (
          (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
          window.location.pathname === "/auth/callback"
        ) {
          window.location.href = "/dashboard";
        }
      } else {
        setProfile(null);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the signed-in user's wishlist (for heart states on artist cards), and
  // replay any pending "add to wishlist" click that happened while logged out.
  useEffect(() => {
    if (!user) { setWishlistIds(new Set()); return; }
    (async () => {
      let ids = new Set<string>();
      try {
        const res = await fetch("/api/wishlist");
        if (res.ok) {
          const data = await res.json();
          ids = new Set<string>((data.items ?? []).map((i: { artist_id: string }) => i.artist_id));
        }
      } catch { /* ignore — heart states just won't be pre-filled */ }

      const pending = getPendingWishlistAdd();
      if (pending && !ids.has(pending)) {
        try {
          await fetch("/api/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artistId: pending }),
          });
          ids.add(pending);
        } catch { /* ignore — user can just tap the heart again */ }
      }
      if (pending) clearPendingWishlistAdd();
      setWishlistIds(ids);
    })();
  }, [user]);

  const toggleWishlist = useCallback(async (artistId: string) => {
    if (!user) {
      // Remember the intent, keep them on the homepage after they sign in
      // (rather than dropping them on the dashboard), then replay the save.
      setPendingWishlistAdd(artistId);
      router.push("/?auth=login");
      return;
    }
    const wasSaved = wishlistIds.has(artistId);
    setWishlistIds(prev => {
      const next = new Set(prev);
      if (wasSaved) next.delete(artistId); else next.add(artistId);
      return next;
    });
    try {
      if (wasSaved) {
        await fetch(`/api/wishlist?artistId=${artistId}`, { method: "DELETE" });
      } else {
        await fetch("/api/wishlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistId }),
        });
      }
    } catch {
      // Revert the optimistic update if the request failed
      setWishlistIds(prev => {
        const next = new Set(prev);
        if (wasSaved) next.add(artistId); else next.delete(artistId);
        return next;
      });
    }
  }, [user, wishlistIds]);

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
    if (activeCategories.length > 0) query = query.in("category", activeCategories.map(c => c.toLowerCase()));
    if (searchQuery.trim()) query = query.ilike("display_name", `%${searchQuery.trim()}%`);
    const { data } = await query;
    setArtists((data ?? []) as Artist[]);
    setLoading(false);
  }, [activeCategories, searchQuery]);

  useEffect(() => {
    const t = setTimeout(fetchArtists, 300);
    return () => clearTimeout(t);
  }, [fetchArtists]);

  const addToCart = (item: CartItem) => {
    setCart(prev => [...prev, item]);
    ttq("AddToCart", { contents: [{ content_id: item.id, content_name: item.name }], value: item.price / 100, currency: "ZAR" });
    fbq("AddToCart", { content_ids: [item.id], content_name: item.name, value: item.price / 100, currency: "ZAR" });
    gTag("add_to_cart", { currency: "ZAR", value: item.price / 100 });
  };
  void addToCart; // referenced by cart drawer

  const cartCount = cart.length;
  const cartTotal = cart.reduce((s, i) => s + i.price, 0);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

      <SiteHeader
        initialUser={user}
        initialProfile={profile}
      />

      {/* ── Page ── */}
      <div style={{ flex: 1 }}>
        <main style={{ minHeight: "80vh", background: "var(--white)" }}>

          {/* Hero — no overflow:hidden so filter dropdown is never clipped */}
          <section style={{ background: "linear-gradient(90deg, #9B7FB8 0%, #f4eff8 100%)", padding: "5rem 1.5rem 3.5rem", textAlign: "center", position: "relative" }}>
            <div style={{ position: "relative", zIndex: 1 }}>
              <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "rgba(255,255,255,0.8)", textTransform: "uppercase", marginBottom: "1rem" }}>Beauty. Confidence. You.</p>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.5rem,6vw,4.5rem)", fontWeight: 300, color: "#fff", lineHeight: 1.1, marginBottom: "1.25rem" }}>
                You are <em style={{ color: "rgba(255,255,255,0.9)", fontStyle: "italic", fontWeight: 400 }}>beautiful</em>
              </h1>
              <p style={{ fontSize: "1.05rem", color: "rgba(255,255,255,0.85)", maxWidth: 480, margin: "0 auto 2rem" }}>
                Book trusted hair stylists, nail techs &amp; makeup artists — right in your neighbourhood.
              </p>

              {/* Merged search + filter bar */}
              <SearchWithFilter
                searchValue={searchQuery}
                onSearchChange={e => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.length > 2) {
                    ttq("Search", { search_string: e.target.value });
                    fbq("Search", { search_string: e.target.value });
                    gTag("search", { search_term: e.target.value });
                  }
                }}
                activeCategories={activeCategories}
                onCategoryChange={(cats: Category[]) => setActiveCategories(cats)}
                categories={CATEGORIES.filter(c => c !== "All")}
                placeholder="Search any style or area…"
              />
            </div>
          </section>

          {/* Artist grid */}
          <section id="artists" style={{ padding: "2rem 1.5rem 4rem", maxWidth: 900, margin: "0 auto" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.5rem", marginBottom: "1.5rem", color: "var(--onyx)" }}>
              {activeCategories.length === 0 ? "All artists" : `${activeCategories.join(" · ")} artists`}
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
                    isWishlisted={wishlistIds.has(artist.id)}
                    onToggleWishlist={() => toggleWishlist(artist.id)}
                    onBook={() => {
                      if (!user) { router.push("/?auth=login"); return; }
                      setSelectedArtist(artist);
                      ttq("ViewContent", { contents: [{ content_id: artist.id, content_name: artist.display_name }] });
                      fbq("ViewContent", { content_ids: [artist.id], content_name: artist.display_name });
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Become an Artist CTA */}
          <section style={{ padding: "0 1.5rem 4rem", maxWidth: 900, margin: "0 auto" }}>
            <div style={{ background: "linear-gradient(135deg,var(--plum-t) 0%,#fff 60%)", borderRadius: 20, padding: "3rem 2rem", textAlign: "center" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", color: "var(--onyx)", marginBottom: "0.75rem" }}>
                Are you a beauty <em style={{ color: "var(--plum)", fontStyle: "italic" }}>artist</em>?
              </h2>
              <p style={{ color: "var(--grey)", maxWidth: 420, margin: "0 auto 1.5rem", fontSize: "0.95rem" }}>
                Join Umuhle and get discovered by clients across South Africa looking for hair, nail, makeup and lash artists.
              </p>
              <Link href="/?auth=register"><button className="btn-plum">Become an Artist</button></Link>
            </div>
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

      {/* ── Booking modal ── */}
      {selectedArtist && (
        <BookingDrawer
          artist={selectedArtist}
          onClose={() => setSelectedArtist(null)}
          user={user!}
          isWishlisted={wishlistIds.has(selectedArtist.id)}
          onToggleWishlist={() => toggleWishlist(selectedArtist.id)}
        />
      )}
    </div>
  );
}

// ─── Artist card ──────────────────────────────────────────────────────────────
function ArtistCard({ artist, onBook, isWishlisted, onToggleWishlist }: { artist: Artist; onBook: () => void; isWishlisted: boolean; onToggleWishlist: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const handleHeartClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    await onToggleWishlist();
    setBusy(false);
  };
  return (
    <div
      style={{ borderRadius: 18, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff", transition: "transform 0.2s, box-shadow 0.2s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 12px 40px rgba(155,127,184,0.15)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
    >
      <div style={{ height: 180, overflow: "hidden", position: "relative", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={artist.avatar_url ?? "/umuhle-icon.png"} alt={artist.display_name} width={100} height={100} style={{ objectFit: "contain", opacity: 0.85 }} />
        {artist.is_verified && <span style={{ position: "absolute", top: 10, right: 10, background: "var(--forest)", color: "#fff", borderRadius: 100, padding: "0.2rem 0.6rem", fontSize: "0.7rem", fontWeight: 600 }}>Verified</span>}
        <button
          onClick={handleHeartClick}
          disabled={busy}
          aria-label={isWishlisted ? "Remove from wishlist" : "Save to wishlist"}
          aria-pressed={isWishlisted}
          style={{ position: "absolute", top: 10, left: 10, background: "rgba(255,255,255,0.9)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill={isWishlisted ? "#E53935" : "none"} stroke="#E53935" strokeWidth="1.75">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        <span style={{ position: "absolute", bottom: 10, left: 10, background: "rgba(255,255,255,0.9)", borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.75rem", fontWeight: 500, color: "var(--plum)", backdropFilter: "blur(4px)" }}>
          {CAT_ICONS[artist.category] ?? ""} {artist.category}
        </span>
      </div>
      <div style={{ padding: "1rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.05rem", marginBottom: "0.25rem" }}>{artist.display_name}</h3>
        <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.5rem" }}>{artist.suburb}</p>
        <div style={{ marginBottom: "0.75rem" }}>
          <StarRating rating={artist.rating} reviewCount={artist.review_count} size={13} />
        </div>
        <button className="btn-plum" style={{ width: "100%", padding: "0.6rem" }} onClick={onBook}>Book now</button>
      </div>
    </div>
  );
}

// ─── Booking drawer ───────────────────────────────────────────────────────────
type ArtistReview = { id: string; rating: number; comment: string | null; created_at: string; reviewer?: { full_name: string; avatar_url: string | null } };

function BookingDrawer({ artist, onClose, user, isWishlisted, onToggleWishlist }: { artist: Artist; onClose: () => void; user: User; isWishlisted: boolean; onToggleWishlist: () => Promise<void> }) {
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
  const [reviews, setReviews]     = useState<ArtistReview[]>([]);
  const [payMethod, setPayMethod] = useState<BookingPayMethod>("payfast");
  // Defaults to "everything on" so there's no flash of a shorter list while
  // /api/payments/gateways is loading — mirrors app/checkout/page.tsx.
  const [availableGateways, setAvailableGateways] = useState<Set<BookingPayMethod>>(
    new Set<BookingPayMethod>(["payfast", "ozow", "happypay"])
  );

  useEffect(() => {
    supabase.from("services").select("id, name, price, duration_minutes").eq("artist_id", artist.id).eq("is_active", true)
      .then(({ data }) => setServices((data ?? []) as Service[]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist.id]);

  useEffect(() => {
    if (!artist.review_count) { setReviews([]); return; }
    fetch(`/api/reviews?artistId=${artist.id}&limit=5`)
      .then(res => res.ok ? res.json() : { reviews: [] })
      .then(data => setReviews(data.reviews ?? []))
      .catch(() => setReviews([]));
  }, [artist.id, artist.review_count]);

  useEffect(() => {
    fetch("/api/payments/gateways")
      .then((res) => res.json())
      .then((data: { gateways: string[] }) => {
        setAvailableGateways(new Set<BookingPayMethod>(data.gateways as BookingPayMethod[]));
      })
      .catch(() => {
        // If this fails, keep showing every method rather than hiding all
        // payment options over a transient network error.
      });
  }, []);

  // If the pre-selected default (or a previous selection) turns out to be
  // paused, fall back to whatever's actually available.
  useEffect(() => {
    if (availableGateways.has(payMethod)) return;
    const fallback = (["payfast", "ozow", "happypay"] as BookingPayMethod[]).find((m) => availableGateways.has(m));
    if (fallback) setPayMethod(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableGateways]);

  const handlePayFast = async () => {
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

  const handleOzow = async () => {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/ozow/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "booking", serviceId: selected.id, artistId: artist.id, bookingDate: date, bookingTime: time, meetingAddress: address, clientPocName: pocName, clientPocPhone: pocPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ozow payment failed");
      window.location.href = data.redirectUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const handleHappyPay = async () => {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/happypay/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "booking", serviceId: selected.id, artistId: artist.id, bookingDate: date, bookingTime: time, meetingAddress: address, clientPocName: pocName, clientPocPhone: pocPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "HappyPay payment failed");
      window.location.href = data.redirectUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const handleBookingPay = payMethod === "payfast" ? handlePayFast : payMethod === "ozow" ? handleOzow : handleHappyPay;

  const minDate = new Date(); minDate.setDate(minDate.getDate() + 1);
  const inputStyle: React.CSSProperties = { padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1.5rem" }}>
          <Image src={artist.avatar_url ?? "/umuhle-icon.png"} alt={artist.display_name} width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <div>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.2rem", margin: 0 }}>{artist.display_name}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.2rem" }}>
              <span style={{ color: "var(--grey)", fontSize: "0.85rem" }}>{artist.suburb}</span>
              <span style={{ color: "var(--light)" }}>·</span>
              <StarRating rating={artist.rating} reviewCount={artist.review_count} size={12} />
            </div>
          </div>
          <button
            onClick={() => onToggleWishlist()}
            aria-label={isWishlisted ? "Remove from wishlist" : "Save to wishlist"}
            aria-pressed={isWishlisted}
            style={{ marginLeft: "auto", background: "none", border: "none", display: "flex", alignItems: "center", cursor: "pointer", padding: "0.25rem" }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill={isWishlisted ? "#E53935" : "none"} stroke="#E53935" strokeWidth="1.75">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.4rem", color: "var(--light)", lineHeight: 1, cursor: "pointer" }}>×</button>
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

            {reviews.length > 0 && (
              <div style={{ marginTop: "1.75rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(155,127,184,0.15)" }}>
                <h4 style={{ fontWeight: 500, marginBottom: "1rem", fontSize: "0.95rem" }}>What clients say</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {reviews.map(r => (
                    <div key={r.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
                        <Image src={r.reviewer?.avatar_url ?? ICON} alt="" width={28} height={28} style={{ borderRadius: "50%", objectFit: "cover" }} />
                        <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{r.reviewer?.full_name?.split(" ")[0] ?? "Umuhle client"}</span>
                        <StarRating rating={r.rating} showValue={false} size={11} />
                      </div>
                      {r.comment && <p style={{ fontSize: "0.85rem", color: "var(--grey)", lineHeight: 1.5, margin: 0, paddingLeft: "2.2rem" }}>{r.comment}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
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

            <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "0.5rem" }}>Payment method</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.25rem" }}>
              {([
                { id: "payfast" as BookingPayMethod, label: "PayFast", sub: "Card, EFT, Instant EFT, SnapScan & more" },
                { id: "ozow" as BookingPayMethod, label: "Ozow", sub: "Instant EFT — pay straight from your bank app" },
                { id: "happypay" as BookingPayMethod, label: "HappyPay", sub: "Buy now, pay later — split into instalments" },
              ]).filter((opt) => availableGateways.has(opt.id)).map((opt) => (
                <button key={opt.id} onClick={() => setPayMethod(opt.id)}
                  style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.85rem 1rem", borderRadius: 12, border: `1.5px solid ${payMethod === opt.id ? "var(--plum)" : "rgba(155,127,184,0.2)"}`, background: payMethod === opt.id ? "var(--plum-t)" : "#fff", textAlign: "left", cursor: "pointer" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${payMethod === opt.id ? "var(--plum)" : "#E0E0E0"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {payMethod === opt.id && <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--plum)" }} />}
                  </div>
                  <div>
                    <p style={{ fontWeight: 500, fontSize: "0.9rem", margin: 0 }}>{opt.label}</p>
                    <p style={{ fontSize: "0.75rem", color: "var(--grey)", margin: 0 }}>{opt.sub}</p>
                  </div>
                </button>
              ))}
            </div>

            {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
            <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "1.25rem" }}>
              You will be redirected to {BOOKING_GATEWAY_LABEL[payMethod]} to complete payment securely. Once paid, you will receive a WhatsApp confirmation.
            </p>
            <button className="btn-plum" style={{ width: "100%", padding: "0.875rem" }} onClick={handleBookingPay} disabled={loading}>
              {loading
                ? "Redirecting…"
                : payMethod === "happypay"
                  ? "Pay later with HappyPay"
                  : `Pay ${fmt(selected.price)} with ${BOOKING_GATEWAY_LABEL[payMethod]}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}