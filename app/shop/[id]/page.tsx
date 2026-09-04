// /app/shop/[id]/page.tsx
// Product Details page

"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Product } from "@/types";
import { useCart } from "@/lib/cart-context";
import { useProductWishlist, getPendingWishlistAdd, clearPendingWishlistAdd } from "@/lib/product-wishlist-context";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import ReviewsList from "@/components/ReviewsList";

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

function HeartIcon({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "#E53935" : "none"} stroke="#E53935" strokeWidth="1.75">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}

const circleBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.92)",
  border: "none", display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.2)", padding: 0, flexShrink: 0,
};

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
  const { isWishlisted, toggle: toggleWishlist } = useProductWishlist();

  const [user, setUser]         = useState<User | null>(null);
  const [product, setProduct]   = useState<Product | null>(null);
  const [related, setRelated]   = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [showAuth, setShowAuth] = useState(false);
  const [added, setAdded]       = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize]   = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoom, setZoom]         = useState(1.5);
  // Pan offset (in screen px) for dragging the zoomed image around inside
  // the modal, so a user can inspect parts of the image that scroll off
  // the edge once zoomed in. Clamped to the currently-zoomed image bounds
  // so it can never be dragged fully out of view.
  const [pan, setPan]           = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const zoomBoxRef  = useRef<HTMLDivElement>(null);
  const dragStart   = useRef({ x: 0, y: 0 });

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
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .single();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setProduct(data as Product);
      setSelectedImage((data as Product).image_url ?? null);
      setSelectedColor((data as Product).colors?.[0] ?? null);
      setSelectedSize((data as Product).sizes?.[0] ?? null);

      // Related products: same category, exclude current
      const { data: rel } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .eq("moderation_status", "approved")
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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

  // Gallery = main image + any gallery images, deduped. gallery_urls isn't a
  // products column yet (checked July 2026) — this renders nothing extra
  // until that lands, but is ready for it.
  const images = useMemo(() => {
    if (!product) return [] as string[];
    const urls = [product.image_url, ...(product.gallery_urls ?? [])].filter((u): u is string => !!u);
    return Array.from(new Set(urls));
  }, [product]);

  const openZoom = (level: number) => { setZoom(level); setPan({ x: 0, y: 0 }); setZoomOpen(true); };

  // The image fills zoomBoxRef's box at zoom=1 (before scaling), so once
  // scaled up the box overflows its container by box-size * (zoom-1) on
  // each axis — half of that on either side is how far it can be panned
  // before revealing empty space past the image's edge.
  const clampPan = (p: { x: number; y: number }, z: number) => {
    const box = zoomBoxRef.current;
    if (!box || z <= 1) return { x: 0, y: 0 };
    const { width, height } = box.getBoundingClientRect();
    const maxX = (width * (z - 1)) / 2;
    const maxY = (height * (z - 1)) / 2;
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  };

  // Re-clamp whenever the zoom level changes (e.g. via the +/- controls)
  // so a pan that was valid at the old zoom can't leave empty space at
  // the new one.
  useEffect(() => {
    setPan(p => clampPan(p, zoom));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const handleDragStart = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const handleDragMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan(clampPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }, zoom));
  };
  const handleDragEnd = () => setIsDragging(false);

  const handleAddToCart = (prod?: Product) => {
    const target = prod ?? product;
    if (!target) return;
    // Guest checkout means adding to cart never needs an account — see
    // app/shop/page.tsx's handleAdd for the fuller explanation. Only
    // wishlist saving (toggleWishlist below) still requires signing in.
    addItem(target, prod ? 1 : quantity);
    if (!prod) {
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
  };

  // Re-apply a pending "heart" click once the user is signed in and the
  // product has loaded (mirrors the pending "add to cart" replay above).
  useEffect(() => {
    if (!user || !product) return;
    const pendingId = getPendingWishlistAdd();
    if (!pendingId || pendingId !== product.id) return;
    toggleWishlist(product);
    clearPendingWishlistAdd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, product]);

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--white)", display: "flex", flexDirection: "column" }}>
        <SiteHeader initialUser={user} />
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "2.5rem 1.5rem", flex: 1, width: "100%", boxSizing: "border-box" }}>
          <div className="product-detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" }}>
            <div className="product-image-section" style={{ borderRadius: 20, aspectRatio: "1/1", background: "linear-gradient(90deg,#f0eaf6 25%,#e8e0f0 50%,#f0eaf6 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
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

  const productIsWishlisted = isWishlisted(product.id);

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
          <div className="product-detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" }}>

            {/* Image section: fills width, clickable/zoomable, gallery rail
                floats left, wishlist heart + zoom controls float top-right. */}
            <div>
              <div className="product-image-section" style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "var(--plum-t)", aspectRatio: "1/1" }}>
                <button
                  type="button"
                  onClick={() => openZoom(1.5)}
                  aria-label="Open image"
                  style={{ position: "absolute", inset: 0, border: "none", padding: 0, background: "none", cursor: "zoom-in", width: "100%", height: "100%" }}
                >
                  {selectedImage ? (
                    <Image src={selectedImage} alt={product.name} fill style={{ objectFit: "cover" }} sizes="480px" priority />
                  ) : (
                    <span style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
                      <Image src={catImage} alt={catLabel} width={180} height={180} style={{ objectFit: "contain", opacity: 0.75 }} />
                    </span>
                  )}
                </button>

                {!inStock && (
                  <div style={{ position: "absolute", top: 16, left: 16, background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 100, padding: "0.3rem 0.9rem", fontSize: "0.75rem", fontWeight: 700, zIndex: 5 }}>Out of stock</div>
                )}

                {/* Gallery rail — only when there's more than one image; the
                    currently-shown image's block renders bigger than its
                    neighbours. */}
                {images.length > 1 && (
                  <div style={{ position: "absolute", top: 12, left: 12, display: "flex", flexDirection: "column", gap: 8, zIndex: 5 }}>
                    {images.map(img => {
                      const active = img === selectedImage;
                      const size = active ? 60 : 42;
                      return (
                        <button
                          key={img}
                          type="button"
                          onClick={() => setSelectedImage(img)}
                          aria-label="Show image"
                          aria-current={active}
                          style={{
                            position: "relative", width: size, height: size, borderRadius: 10, overflow: "hidden", padding: 0, flexShrink: 0,
                            border: active ? "2px solid #fff" : "2px solid rgba(255,255,255,0.65)",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.25)", cursor: "pointer", transition: "width 0.2s, height 0.2s", opacity: active ? 1 : 0.85,
                          }}
                        >
                          <Image src={img} alt="" fill style={{ objectFit: "cover" }} sizes="70px" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Wishlist heart, then zoom-in below it. Zoom-out only
                    appears inside the modal (opened via this + button) —
                    it doesn't make sense on the unzoomed base image. */}
                <div style={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 8, zIndex: 5 }}>
                  <button
                    type="button"
                    onClick={() => toggleWishlist(product, () => setShowAuth(true))}
                    aria-label={productIsWishlisted ? "Remove from wishlist" : "Save to wishlist"}
                    aria-pressed={productIsWishlisted}
                    style={circleBtn}
                  >
                    <HeartIcon filled={productIsWishlisted} />
                  </button>
                  <button type="button" onClick={() => openZoom(Math.min(3, zoom + 0.5))} aria-label="Zoom in" style={{ ...circleBtn, fontSize: "1.1rem", fontWeight: 700, color: "var(--plum)" }}>+</button>
                </div>
              </div>
            </div>

            {/* Details: name → description → category → price + save-for-later
                → stock → variations → qty → total → sticky add-to-cart */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

              <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(1.5rem,3vw,2rem)", color: "var(--onyx)", lineHeight: 1.2 }}>{product.name}</h1>

              {product.description && (
                <p style={{ color: "var(--grey)", lineHeight: 1.65, fontSize: "0.95rem" }}>{product.description}</p>
              )}

              {catLabel && (
                <span style={{ display: "inline-block", width: "fit-content", background: "var(--plum-t)", color: "var(--plum)", borderRadius: 100, padding: "0.3rem 0.9rem", fontSize: "0.75rem", fontWeight: 600 }}>{catLabel}</span>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                <p style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--plum)" }}>{fmt(product.price)}</p>
                <button
                  onClick={() => toggleWishlist(product, () => setShowAuth(true))}
                  aria-pressed={productIsWishlisted}
                  className="btn-outline"
                  style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                >
                  {productIsWishlisted ? "Saved" : "Save for later"}
                </button>
              </div>

              {/* Stock indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: inStock ? "#2E7D32" : "#888" }} />
                <span style={{ fontSize: "0.85rem", color: inStock ? "#2E7D32" : "var(--grey)", fontWeight: 500 }}>
                  {inStock ? `In stock (${product.stock_count} available)` : "Out of stock"}
                </span>
              </div>

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

              {/* Variations — only render once these fields actually exist on
                  a product (see the Product type note on gallery_urls/colors/sizes). */}
              {!!product.colors?.length && (
                <div>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--onyx)", marginBottom: "0.5rem" }}>Colour</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {product.colors.map(c => (
                      <button
                        key={c}
                        onClick={() => setSelectedColor(c)}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.35rem 0.75rem", borderRadius: 100, fontSize: "0.8rem", cursor: "pointer",
                          border: selectedColor === c ? "1.5px solid var(--plum)" : "1.5px solid rgba(155,127,184,0.3)",
                          background: selectedColor === c ? "var(--plum-t)" : "#fff", color: "var(--onyx)",
                        }}
                      >
                        <span style={{ width: 14, height: 14, borderRadius: "50%", background: c.toLowerCase(), border: "1px solid rgba(0,0,0,0.15)", display: "inline-block" }} />
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!!product.sizes?.length && (
                <div>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--onyx)", marginBottom: "0.5rem" }}>Size</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {product.sizes.map(s => (
                      <button
                        key={s}
                        onClick={() => setSelectedSize(s)}
                        style={{
                          padding: "0.35rem 0.9rem", borderRadius: 100, fontSize: "0.8rem", cursor: "pointer",
                          border: selectedSize === s ? "1.5px solid var(--plum)" : "1.5px solid rgba(155,127,184,0.3)",
                          background: selectedSize === s ? "var(--plum-t)" : "#fff", color: "var(--onyx)",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ borderTop: "1px solid rgba(155,127,184,0.12)", paddingTop: "1.25rem" }} />

              {inStock && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--grey)" }}>Quantity</span>
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
                  </div>

                  <p style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--onyx)" }}>
                    Total: <span style={{ color: "var(--plum)" }}>{fmt(product.price * quantity)}</span>
                  </p>
                </>
              )}

              {/* Go to cart shortcut if already in cart */}
              {inCart && !added && (
                <button
                  onClick={() => router.push("/cart")}
                  className="btn-outline"
                  style={{ padding: "0.65rem 1.5rem", fontSize: "0.875rem", width: "fit-content" }}
                >
                  View cart →
                </button>
              )}

              {/* Sticky until it reaches its natural spot at the end of this
                  column (native position:sticky — no JS/observer needed). */}
              <button
                className="btn-plum product-detail-cta"
                disabled={!inStock}
                style={{
                  padding: "1rem 1.5rem", fontSize: "1rem", fontWeight: 700, whiteSpace: "nowrap",
                  background: added ? "#2E7D32" : !inStock ? "#bbb" : undefined,
                  cursor: !inStock ? "not-allowed" : "pointer",
                  transition: "background 0.25s",
                  position: "sticky", bottom: 0,
                }}
                onClick={() => inStock && handleAddToCart()}
              >
                {added ? "Added to cart ✓" : !inStock ? "Sold out" : "Add to Cart"}
              </button>
            </div>
          </div>

          <ReviewsList productId={product.id} rating={product.rating} reviewCount={product.review_count} />

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

        {/* Auth modal — wishlist saving is the only action left on this
            page that requires an account (guests can add to cart and
            check out freely; see handleAddToCart above). */}
        {showAuth && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAuth(false); }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 380, textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Sign in to save</h3>
              <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Create an account to save items to your wishlist.</p>
              <Link href="?auth=login"><button className="btn-plum" style={{ width: "100%", marginBottom: "0.75rem" }} onClick={() => setShowAuth(false)}>Sign in</button></Link>
              <Link href="?auth=register"><button className="btn-outline" style={{ width: "100%" }} onClick={() => setShowAuth(false)}>Create account</button></Link>
            </div>
          </div>
        )}

        {/* Zoom / lightbox modal */}
        {zoomOpen && selectedImage && (
          <div className="modal-overlay" style={{ background: "rgba(10,8,12,0.92)" }} onClick={e => { if (e.target === e.currentTarget) setZoomOpen(false); }}>
            <button
              onClick={() => setZoomOpen(false)}
              aria-label="Close"
              style={{ position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 40, height: 40, borderRadius: "50%", fontSize: "1.4rem", cursor: "pointer", zIndex: 2 }}
            >×</button>
            <div ref={zoomBoxRef} style={{ width: "min(560px,90vw)", height: "min(560px,60vh)", position: "relative", overflow: "hidden" }}>
              <div
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                onPointerLeave={handleDragEnd}
                style={{
                  position: "relative", width: "100%", height: "100%",
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transition: isDragging ? "none" : "transform 0.2s",
                  transformOrigin: "center",
                  cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                  touchAction: "none",
                }}
              >
                <Image src={selectedImage} alt={product.name} fill style={{ objectFit: "contain" }} sizes="90vw" draggable={false} />
              </div>
            </div>
            <div style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "0.75rem", background: "rgba(255,255,255,0.12)", borderRadius: 100, padding: "0.4rem 0.6rem" }}>
              <button onClick={() => setZoom(z => Math.max(1, z - 0.5))} aria-label="Zoom out" style={{ ...circleBtn, background: "#fff" }}>−</button>
              <span style={{ color: "#fff", fontSize: "0.8rem", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(3, z + 0.5))} aria-label="Zoom in" style={{ ...circleBtn, background: "#fff" }}>+</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
