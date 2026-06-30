"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Product } from "@/types";
import { useCart, setPendingCartAdd, getPendingCartAdd, clearPendingCartAdd } from "@/lib/cart-context";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const CATEGORY_IMAGE: Record<string, string> = {
  "hair":   "/hair.png",
  "nails":  "/nails.png",
  "makeup": "/makeup.png",
  "lashes": "/lashes.png",
};
const CAT_LABEL: Record<string, string> = {
  "hair":   "Hair care",
  "nails":  "Nails",
  "makeup": "Makeup",
  "lashes": "Lashes",
};
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;

// ── Related product card ───────────────────────────────────────────────────────
function RelatedCard({ product, onAdd }: { product: Product; onAdd: (p: Product) => void }) {
  const inStock = product.stock_count > 0;
  const catLabel = CAT_LABEL[product.category ?? ""] ?? product.category ?? "";
  const catImage = CATEGORY_IMAGE[product.category ?? ""] ?? "/umuhle-icon.png";

  return (
    <Link href={`/shop/${product.id}`} style={{ textDecoration: "none" }}>
      <div style={{ borderRadius: 14, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff", transition: "box-shadow 0.2s", cursor: "pointer" }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 8px 24px rgba(155,127,184,0.18)")}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}>
        <div style={{ height: 130, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {product.image_url ? (
            <Image src={product.image_url} alt={product.name} fill sizes="200px" style={{ objectFit: "cover" }} />
          ) : (
            <Image src={catImage} alt={catLabel} width={80} height={80} style={{ objectFit: "contain", opacity: 0.85 }} />
          )}
        </div>
        <div style={{ padding: "0.85rem" }}>
          {catLabel && <p style={{ fontSize: "0.7rem", color: "var(--plum)", fontWeight: 500, marginBottom: "0.2rem" }}>{catLabel}</p>}
          <p style={{ fontWeight: 500, fontSize: "0.88rem", color: "var(--onyx)", marginBottom: "0.6rem",
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
            {product.name}
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, color: "var(--plum)", fontSize: "0.9rem" }}>{fmt(product.price)}</span>
            <button
              className="btn-plum"
              style={{ padding: "0.3rem 0.75rem", fontSize: "0.75rem", opacity: inStock ? 1 : 0.5, cursor: inStock ? "pointer" : "not-allowed" }}
              disabled={!inStock}
              onClick={e => { e.preventDefault(); onAdd(product); }}
            >
              {inStock ? "Add" : "Sold out"}
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Main product detail page ───────────────────────────────────────────────────
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const { addItem, items } = useCart();

  const [user, setUser]         = useState<User | null>(null);
  const [product, setProduct]   = useState<Product | null>(null);
  const [related, setRelated]   = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [showAuth, setShowAuth] = useState(false);
  const [added, setAdded]       = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch product + related
  useEffect(() => {
    if (!id) return;

    async function load() {
      setLoading(true);
      setNotFound(false);

      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("id", id)
        .eq("is_active", true)
        .eq("moderation_status", "approved")
        .single();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setProduct(data as Product);
      setSelectedImage((data as Product).image_url ?? null);

      // Related products: same category, exclude current
      const { data: rel } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .eq("moderation_status", "approved")
        .eq("category", data.category ?? "")
        .neq("id", id)
        .limit(4);

      setRelated(rel ?? []);
      setLoading(false);
    }

    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const inCart    = items.some(l => l.product.id === id);
  const inStock   = (product?.stock_count ?? 0) > 0;
  const maxQty    = Math.min(product?.stock_count ?? 1, 10);
  const catLabel  = CAT_LABEL[product?.category ?? ""] ?? product?.category ?? "";
  const catImage  = CATEGORY_IMAGE[product?.category ?? ""] ?? "/umuhle-icon.png";

  const handleAddToCart = (prod?: Product) => {
    const target = prod ?? product;
    if (!target) return;
    if (!user) {
      // Remember what they were trying to add — re-applied once they sign in
      // and land back on this product page (see the effect below).
      setPendingCartAdd(target.id, prod ? 1 : quantity);
      setShowAuth(true);
      return;
    }
    addItem(target, prod ? 1 : quantity);
    if (!prod) {
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
  };

  // Re-apply a pending "add to cart" click once the user is signed in and the
  // product has loaded (e.g. after logging in from the auth modal and being
  // redirected back to this same product page).
  useEffect(() => {
    if (!user || !product) return;
    const pending = getPendingCartAdd();
    if (!pending || pending.productId !== product.id) return;
    if (product.stock_count > 0) {
      addItem(product, pending.quantity);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
    clearPendingCartAdd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, product]);

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--white)", display: "flex", flexDirection: "column" }}>
        <SiteHeader initialUser={user} />
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "2.5rem 1.5rem", flex: 1, width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" }}>
            <div style={{ borderRadius: 20, height: 420, background: "linear-gradient(90deg,#f0eaf6 25%,#e8e0f0 50%,#f0eaf6 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {[40, 60, 100, 80, 60].map((w, i) => (
                <div key={i} style={{ height: i === 0 ? 14 : i === 1 ? 28 : i === 2 ? 16 : 20, background: "#f0eaf6", borderRadius: 6, width: `${w}%` }} />
              ))}
            </div>
          </div>
        </main>
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        <Footer />
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────────
  if (notFound || !product) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--white)", display: "flex", flexDirection: "column" }}>
        <SiteHeader initialUser={user} />
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "5rem 1.5rem", flex: 1, width: "100%", boxSizing: "border-box", textAlign: "center" }}>
          <p style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>🛍️</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", marginBottom: "0.5rem" }}>Product not found</h1>
          <p style={{ color: "var(--grey)", marginBottom: "2rem" }}>This product may have been removed or is no longer available.</p>
          <Link href="/shop"><button className="btn-plum">Browse shop</button></Link>
        </main>
        <Footer />
      </div>
    );
  }

  // ── Product detail ───────────────────────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      <div style={{ minHeight: "100vh", background: "var(--white)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column" }}>
        <SiteHeader initialUser={user} />

        <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem 4rem", flex: 1, width: "100%", boxSizing: "border-box" }}>

          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", color: "var(--grey)", marginBottom: "1.75rem" }}>
            <Link href="/shop" style={{ color: "var(--plum)", textDecoration: "none" }}>Shop</Link>
            <span>›</span>
            {catLabel && <><Link href={`/shop?cat=${product.category}`} style={{ color: "var(--plum)", textDecoration: "none" }}>{catLabel}</Link><span>›</span></>}
            <span style={{ color: "var(--onyx)" }}>{product.name}</span>
          </div>

          {/* Main layout */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" }}>

            {/* Left: image */}
            <div>
              <div style={{ borderRadius: 20, overflow: "hidden", background: "var(--plum-t)", aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginBottom: "0.75rem" }}>
                {selectedImage ? (
                  <Image src={selectedImage} alt={product.name} fill style={{ objectFit: "cover" }} sizes="480px" priority />
                ) : (
                  <Image src={catImage} alt={catLabel} width={180} height={180} style={{ objectFit: "contain", opacity: 0.75 }} />
                )}
                {!inStock && (
                  <div style={{ position: "absolute", top: 16, left: 16, background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 100, padding: "0.3rem 0.9rem", fontSize: "0.75rem", fontWeight: 700 }}>Out of stock</div>
                )}
              </div>
            </div>

            {/* Right: details */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

              {/* Category badge */}
              {catLabel && (
                <div>
                  <span style={{ display: "inline-block", background: "var(--plum-t)", color: "var(--plum)", borderRadius: 100, padding: "0.3rem 0.9rem", fontSize: "0.75rem", fontWeight: 600 }}>{catLabel}</span>
                </div>
              )}

              {/* Name + price */}
              <div>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(1.5rem,3vw,2rem)", color: "var(--onyx)", marginBottom: "0.5rem", lineHeight: 1.2 }}>{product.name}</h1>
                <p style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--plum)" }}>{fmt(product.price)}</p>
              </div>

              {/* Stock indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: inStock ? "#2E7D32" : "#888" }} />
                <span style={{ fontSize: "0.85rem", color: inStock ? "#2E7D32" : "var(--grey)", fontWeight: 500 }}>
                  {inStock ? `In stock (${product.stock_count} available)` : "Out of stock"}
                </span>
              </div>

              {/* Description */}
              {product.description && (
                <p style={{ color: "var(--grey)", lineHeight: 1.65, fontSize: "0.95rem" }}>{product.description}</p>
              )}

              <div style={{ borderTop: "1px solid rgba(155,127,184,0.12)", paddingTop: "1.25rem" }} />

              {/* Quantity + add to cart */}
              {inStock && (
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 100, padding: "0.3rem 0.6rem" }}>
                    <button
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 700, fontSize: "1.2rem", cursor: "pointer", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" }}
                    >−</button>
                    <span style={{ fontSize: "1rem", fontWeight: 600, minWidth: 24, textAlign: "center" }}>{quantity}</span>
                    <button
                      onClick={() => setQuantity(q => Math.min(maxQty, q + 1))}
                      style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 700, fontSize: "1.2rem", cursor: "pointer", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" }}
                    >+</button>
                  </div>
                  <button
                    className="btn-plum"
                    style={{ flex: 1, padding: "0.75rem 1.5rem", fontSize: "0.95rem",
                      background: added ? "#2E7D32" : undefined,
                      transition: "background 0.25s" }}
                    onClick={() => handleAddToCart()}
                  >
                    {added ? "Added to cart ✓" : `Add ${quantity > 1 ? `${quantity} ` : ""}to cart — ${fmt(product.price * quantity)}`}
                  </button>
                </div>
              )}

              {/* Go to cart shortcut if already in cart */}
              {inCart && !added && (
                <button
                  onClick={() => router.push("/cart")}
                  className="btn-outline"
                  style={{ padding: "0.65rem 1.5rem", fontSize: "0.875rem" }}
                >
                  View cart →
                </button>
              )}

              {/* Partner info */}
              {product.partner && (
                <div style={{ background: "var(--plum-t)", borderRadius: 14, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "1.3rem" }}>🏪</span>
                  <div>
                    <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: "0 0 0.1rem" }}>Sold by</p>
                    <p style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--onyx)", margin: 0 }}>{(product.partner as { full_name?: string }).full_name ?? "Umuhle Partner"}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Related products */}
          {related.length > 0 && (
            <div style={{ marginTop: "4rem" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", color: "var(--onyx)", marginBottom: "1.25rem" }}>
                More in <em style={{ color: "var(--plum)", fontStyle: "italic" }}>{catLabel}</em>
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: "1rem" }}>
                {related.map(r => (
                  <RelatedCard key={r.id} product={r} onAdd={handleAddToCart} />
                ))}
              </div>
            </div>
          )}
        </main>

        <Footer />

        {/* Auth modal */}
        {showAuth && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAuth(false); }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 380, textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Sign in to shop</h3>
              <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Create an account to save items and checkout.</p>
              <Link href={`/?auth=login&next=${encodeURIComponent(`/shop/${id}`)}`}><button className="btn-plum" style={{ width: "100%", marginBottom: "0.75rem" }} onClick={() => setShowAuth(false)}>Sign in</button></Link>
              <Link href={`/?auth=register&next=${encodeURIComponent(`/shop/${id}`)}`}><button className="btn-outline" style={{ width: "100%" }} onClick={() => setShowAuth(false)}>Create account</button></Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}