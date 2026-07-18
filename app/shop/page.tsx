"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Product } from "@/types";
import { useCart, setPendingCartAdd, getPendingCartAdd, clearPendingCartAdd } from "@/lib/cart-context";
import { useProductWishlist, getPendingWishlistAdd, clearPendingWishlistAdd } from "@/lib/product-wishlist-context";
import Footer from "@/components/Footer";
import SiteHeader from "@/components/SiteHeader";

const CATEGORY_IMAGE: Record<string, string> = {
  "hair":      "/hair.png",
  "nails":     "/nails.png",
  "makeup":    "/makeup.png",
  "lashes":    "/lashes.png",
};
const CAT_LABEL: Record<string, string> = {
  "hair":   "Hair care",
  "nails":  "Nails",
  "makeup": "Makeup",
  "lashes": "Lashes",
};
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;

const SHOP_CATS = ["Hair care", "Nails", "Makeup", "Lashes"] as const;
type ShopCat = typeof SHOP_CATS[number];

const CAT_TO_DB: Record<ShopCat, string> = {
  "Hair care": "hair",
  "Nails":     "nails",
  "Makeup":    "makeup",
  "Lashes":    "lashes",
};

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
  activeFilters: ShopCat[];
  onFiltersChange: (filters: ShopCat[]) => void;
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

  const toggle = (cat: ShopCat) => {
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
          boxShadow: "0 16px 48px rgba(0,0,0,0.14)", padding: "1rem", minWidth: 220, zIndex: 9999,
        }}>
          <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>Filter by category</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
            {SHOP_CATS.map(cat => {
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

// ── Skeleton loader ────────────────────────────────────────────────────────────
function ProductSkeleton() {
  return (
    <div style={{ borderRadius: 16, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff" }}>
      <div style={{ height: 160, background: "linear-gradient(90deg,#f0eaf6 25%,#e8e0f0 50%,#f0eaf6 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
      <div style={{ padding: "1rem" }}>
        <div style={{ height: 12, background: "#f0eaf6", borderRadius: 6, width: "40%", marginBottom: "0.5rem" }} />
        <div style={{ height: 16, background: "#f0eaf6", borderRadius: 6, width: "70%", marginBottom: "0.4rem" }} />
        <div style={{ height: 12, background: "#f0eaf6", borderRadius: 6, width: "90%", marginBottom: "0.25rem" }} />
        <div style={{ height: 12, background: "#f0eaf6", borderRadius: 6, width: "60%", marginBottom: "0.75rem" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ height: 18, background: "#f0eaf6", borderRadius: 6, width: "25%" }} />
          <div style={{ height: 32, background: "#f0eaf6", borderRadius: 100, width: "35%" }} />
        </div>
      </div>
    </div>
  );
}

export default function ShopPage() {
  const supabase = createClient();
  const router = useRouter();
  const { addItem } = useCart();
  const { isWishlisted, toggle: toggleWishlist } = useProductWishlist();

  const [user, setUser]           = useState<User | null>(null);
  const [products, setProducts]   = useState<Product[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<ShopCat[]>([]);
  const [search, setSearch]       = useState("");
  const [showAuth, setShowAuth]   = useState(false);
  const [added, setAdded]         = useState<string | null>(null);
  const [showCartToast, setShowCartToast] = useState(false);
  const cartToastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nudge people to the cart after adding — the header cart icon is easy to
  // miss, especially on mobile.
  const promptCartToast = () => {
    setShowCartToast(true);
    if (cartToastTimeout.current) clearTimeout(cartToastTimeout.current);
    cartToastTimeout.current = setTimeout(() => setShowCartToast(false), 4000);
  };

  useEffect(() => () => { if (cartToastTimeout.current) clearTimeout(cartToastTimeout.current); }, []);

  // Auth listener
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch approved, active products from Supabase
  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fetchErr } = await supabase
          .from("products")
          .select("*")
          .eq("is_active", true)
          .eq("moderation_status", "approved")
          // Legacy rows have expires_at = null (grandfathered, no expiry).
          // Paid listings disappear once their package runs out — there's
          // no cron job flipping is_active, so this is enforced here.
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .order("created_at", { ascending: false });

        if (fetchErr) throw fetchErr;
        setProducts(data ?? []);
      } catch (err) {
        console.error("Failed to load products:", err);
        setError("Failed to load products. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = products.filter(p => {
    const matchCat =
      activeFilters.length === 0 ||
      activeFilters.some(f => CAT_TO_DB[f] === p.category);
    const q = search.toLowerCase();
    const matchQ = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  const handleAdd = (product: Product) => {
    if (!user) {
      // Remember what they were trying to add — re-applied once they sign in
      // and land back on this page (see the effect below).
      setPendingCartAdd(product.id, 1);
      setShowAuth(true);
      return;
    }
    addItem(product, 1);
    setAdded(product.id);
    setTimeout(() => setAdded(null), 1500);
    promptCartToast();
  };

  // Re-apply a pending "add to cart" click once the user is signed in and
  // products have loaded (e.g. after they logged in from the auth modal and
  // were redirected back to /shop).
  useEffect(() => {
    if (!user || products.length === 0) return;
    const pending = getPendingCartAdd();
    if (!pending) return;
    const product = products.find(p => p.id === pending.productId);
    if (product && product.stock_count > 0) {
      addItem(product, pending.quantity);
      setAdded(product.id);
      setTimeout(() => setAdded(null), 1500);
      promptCartToast();
    }
    clearPendingCartAdd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, products]);

  // Re-apply a pending "heart" click once the user is signed in and products
  // have loaded (mirrors the pending "add to cart" replay above).
  useEffect(() => {
    if (!user || products.length === 0) return;
    const pendingId = getPendingWishlistAdd();
    if (!pendingId) return;
    const product = products.find(p => p.id === pendingId);
    if (product) toggleWishlist(product);
    clearPendingWishlistAdd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, products]);

  const hasProducts = !loading && !error && products.length > 0;
  const isEmpty     = !loading && !error && products.length === 0;

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--white)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column" }}>
        <SiteHeader initialUser={user} />

        {/* Hero */}
        <div style={{ background: "linear-gradient(90deg,#9B7FB8 0%,#f4eff8 100%)", padding: "4rem 1.5rem 3.5rem", position: "relative" }}>
          <div style={{ maxWidth: 680, margin: "0 auto", position: "relative", zIndex: 1, textAlign: "center" }}>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "rgba(255,255,255,0.8)", textTransform: "uppercase", marginBottom: "0.5rem" }}>curated for you</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(2rem,5vw,3rem)", color: "#fff", marginBottom: "0.5rem" }}>Beauty Shop</h1>
            <p style={{ color: "rgba(255,255,255,0.85)", marginBottom: "1.75rem", fontSize: "1rem" }}>Professional beauty products, sourced by our artists.</p>
            <SearchWithFilter
              searchValue={search}
              onSearchChange={e => setSearch(e.target.value)}
              activeFilters={activeFilters}
              onFiltersChange={setActiveFilters}
              placeholder="Search products…"
            />
          </div>
        </div>

        <main style={{ maxWidth: 960, margin: "0 auto", padding: "2.5rem 1.5rem 4rem", flex: 1, width: "100%", boxSizing: "border-box" }}>

          {/* Error */}
          {error && (
            <div style={{ background: "#fff0f0", border: "1.5px solid rgba(220,50,50,0.2)", borderRadius: 14, padding: "1rem 1.5rem", marginBottom: "2rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ fontSize: "1.2rem" }}>⚠️</span>
              <div>
                <p style={{ fontWeight: 600, color: "#c0392b", margin: 0, fontSize: "0.9rem" }}>{error}</p>
                <button onClick={() => window.location.reload()} style={{ background: "none", border: "none", color: "#c0392b", fontSize: "0.82rem", cursor: "pointer", padding: 0, textDecoration: "underline", marginTop: "0.25rem" }}>Refresh page</button>
              </div>
            </div>
          )}

          {/* Coming soon */}
          {isEmpty && (
            <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 14, padding: "1rem 1.5rem", marginBottom: "2.5rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ fontSize: "1.2rem" }}>🛍️</span>
              <div>
                <p style={{ fontWeight: 600, color: "var(--plum)", margin: 0, fontSize: "0.9rem" }}>Shop coming soon!</p>
                <p style={{ color: "var(--grey)", margin: 0, fontSize: "0.85rem" }}>Our partners are loading their products. Sign up to be notified when products go live.</p>
              </div>
            </div>
          )}

          {/* No results */}
          {hasProducts && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
              <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔍</p>
              <p style={{ fontWeight: 600, color: "var(--onyx)", marginBottom: "0.25rem" }}>No products found</p>
              <p style={{ color: "var(--grey)", fontSize: "0.875rem" }}>Try adjusting your search or filters.</p>
              <button onClick={() => { setSearch(""); setActiveFilters([]); }} style={{ marginTop: "1rem", padding: "0.5rem 1.25rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.4)", background: "transparent", color: "var(--plum)", fontSize: "0.875rem", cursor: "pointer" }}>
                Clear search & filters
              </button>
            </div>
          )}

          {/* Product grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "1.25rem" }}>
            {loading && Array.from({ length: 8 }).map((_, i) => <ProductSkeleton key={i} />)}

            {!loading && filtered.map(p => {
              const inStock   = p.stock_count > 0;
              const catImage  = CATEGORY_IMAGE[p.category ?? ""] ?? "/umuhle-icon.png";
              const catLabel  = CAT_LABEL[p.category ?? ""] ?? p.category ?? "";
              const isAdded   = added === p.id;
              const wishlisted = isWishlisted(p.id);

              return (
                <div key={p.id} style={{ borderRadius: 16, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff", position: "relative", display: "flex", flexDirection: "column" }}>

                  {!inStock && (
                    <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: "#888", color: "#fff", borderRadius: 100, padding: "0.2rem 0.7rem", fontSize: "0.7rem", fontWeight: 700 }}>Out of stock</div>
                  )}

                  <button
                    onClick={() => toggleWishlist(p, () => setShowAuth(true))}
                    aria-label={wishlisted ? "Remove from wishlist" : "Save to wishlist"}
                    aria-pressed={wishlisted}
                    style={{ position: "absolute", top: 10, right: 10, zIndex: 2, background: "rgba(255,255,255,0.92)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={wishlisted ? "#E53935" : "none"} stroke="#E53935" strokeWidth="1.75"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  </button>

                  {/* Clickable image area → product detail */}
                  <Link href={`/shop/${p.id}`} style={{ textDecoration: "none", display: "block" }}>
                    <div style={{ height: 160, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                      {p.image_url ? (
                        <Image src={p.image_url} alt={p.name} fill sizes="240px" style={{ objectFit: "cover" }} />
                      ) : (
                        <Image src={catImage} alt={catLabel} width={100} height={100} style={{ objectFit: "contain", opacity: 0.85 }} />
                      )}
                    </div>
                  </Link>

                  <div style={{ padding: "1rem", flex: 1, display: "flex", flexDirection: "column" }}>
                    {catLabel && <p style={{ fontSize: "0.75rem", color: "var(--plum)", fontWeight: 500, marginBottom: "0.25rem" }}>{catLabel}</p>}

                    <Link href={`/shop/${p.id}`} style={{ textDecoration: "none" }}>
                      <h4 style={{ fontWeight: 500, marginBottom: "0.4rem", fontSize: "0.95rem", color: "var(--onyx)", cursor: "pointer" }}>{p.name}</h4>
                    </Link>

                    {p.description && (
                      <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.75rem", lineHeight: 1.4, flex: 1,
                        overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                        {p.description}
                      </p>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
                      <span style={{ fontWeight: 700, color: "var(--plum)" }}>{fmt(p.price)}</span>
                      <button
                        className="btn-plum"
                        style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", opacity: inStock ? 1 : 0.5, cursor: inStock ? "pointer" : "not-allowed",
                          background: isAdded ? "#2E7D32" : undefined, transition: "background 0.2s" }}
                        disabled={!inStock}
                        onClick={() => handleAdd(p)}
                      >
                        {isAdded ? "Added ✓" : inStock ? "Add to cart" : "Out of stock"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Partner CTA */}
          <div style={{ marginTop: "4rem", background: "linear-gradient(135deg,var(--plum-t) 0%,#fff 60%)", borderRadius: 20, padding: "3rem 2rem", textAlign: "center" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", color: "var(--onyx)", marginBottom: "0.75rem" }}>
              Are you a beauty <em style={{ color: "var(--plum)", fontStyle: "italic" }}>professional</em>?
            </h2>
            <p style={{ color: "var(--grey)", maxWidth: 400, margin: "0 auto 1.5rem", fontSize: "0.95rem" }}>
              List your products on Umuhle and reach thousands of customers across South Africa.
            </p>
            <Link href="?auth=register"><button className="btn-plum">Become a Partner</button></Link>
          </div>
        </main>

        <Footer />

        {/* Added-to-cart toast */}
        {showCartToast && (
          <div
            className="animate-fade-up"
            style={{
              position: "fixed",
              bottom: "max(1.25rem, env(safe-area-inset-bottom))",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 300,
              background: "#fff",
              borderRadius: 100,
              boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
              border: "1.5px solid rgba(155,127,184,0.15)",
              padding: "0.55rem 0.55rem 0.55rem 1.1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.65rem",
              maxWidth: "calc(100vw - 2rem)",
            }}
          >
            <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--onyx)", whiteSpace: "nowrap" }}>
              ✓ Added to cart
            </span>
            <button
              className="btn-plum"
              onClick={() => router.push("/cart")}
              style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}
            >
              View Cart
            </button>
            <button
              onClick={() => setShowCartToast(false)}
              aria-label="Dismiss"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--grey)", fontSize: "1.1rem", padding: "0.25rem", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        )}

        {/* Auth modal */}
        {showAuth && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAuth(false); }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 380, textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Sign in to shop</h3>
              <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Create an account to save items and checkout.</p>
              <Link href="?auth=login"><button className="btn-plum" style={{ width: "100%", marginBottom: "0.75rem" }} onClick={() => setShowAuth(false)}>Sign in</button></Link>
              <Link href="?auth=register"><button className="btn-outline" style={{ width: "100%" }} onClick={() => setShowAuth(false)}>Create account</button></Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
