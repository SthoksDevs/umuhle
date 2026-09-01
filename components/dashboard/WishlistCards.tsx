"use client";

// components/dashboard/WishlistCards.tsx
//
// Presentational cards for the "Wishlist" tab (both artist-wishlist and
// product-wishlist entries). Rendered directly by DashboardShell.tsx
// rather than through their own tab wrapper, since the wishlist tab's
// state (which sub-tab, loading, the lists themselves) lives in the shell
// — both are named exports, not default. Split out of the old
// app/dashboard/page.tsx monolith — see docs/role-based-dashboards-status.md.

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import type { Product } from "@/types";
import type { WishlistArtist } from "@/lib/dashboard/types";
import { ICON, fmt } from "@/lib/dashboard/format";
import StarRating from "@/components/StarRating";

// ─── Wishlist card ─────────────────────────────────────────────────────────────
export function WishlistCard({ item, onRemove }: { item: WishlistArtist; onRemove: (id: string) => void }) {
  const artist = item.artists;
  const [removing, setRemoving] = useState(false);
  const handleRemove = async () => {
    setRemoving(true);
    await fetch(`/api/wishlist?artistId=${artist.id}`, { method: "DELETE" });
    onRemove(artist.id);
  };
  return (
    <div style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, background: "#fff", overflow: "hidden", transition: "transform 0.2s, box-shadow 0.2s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 12px 40px rgba(155,127,184,0.15)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}>
      <div style={{ height: 160, overflow: "hidden", position: "relative", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={artist.avatar_url ?? ICON} alt={artist.display_name} width={80} height={80} style={{ objectFit: "contain", opacity: 0.85 }} />
        {artist.is_verified && <span style={{ position: "absolute", top: 10, right: 10, background: "var(--forest)", color: "#fff", borderRadius: 100, padding: "0.2rem 0.6rem", fontSize: "0.7rem", fontWeight: 600 }}>Verified</span>}
        <button onClick={handleRemove} disabled={removing} aria-label="Remove from wishlist"
          style={{ position: "absolute", top: 10, left: 10, background: "rgba(255,255,255,0.9)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#E53935" stroke="#E53935" strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div style={{ padding: "1rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", marginBottom: "0.2rem" }}>{artist.display_name}</h3>
        <p style={{ fontSize: "0.78rem", color: "var(--grey)", marginBottom: "0.5rem" }}>{artist.suburb} · {artist.category}</p>
        <div style={{ marginBottom: "0.75rem" }}>
          <StarRating rating={artist.rating ?? 0} reviewCount={artist.review_count ?? 0} size={12} />
        </div>
        <Link href={`/?artist=${artist.id}`}><button className="btn-plum" style={{ width: "100%", padding: "0.55rem", fontSize: "0.85rem" }}>Book now</button></Link>
      </div>
    </div>
  );
}

// ─── Product wishlist card ──────────────────────────────────────────────────────
export function ProductWishlistCard({ product, onRemove }: { product: Product; onRemove: (id: string) => Promise<void> }) {
  const { addItem } = useCart();
  const [removing, setRemoving] = useState(false);
  const [added, setAdded] = useState(false);
  const inStock = product.stock_count > 0;

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove(product.id);
  };

  const handleAddToCart = () => {
    addItem(product, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, background: "#fff", overflow: "hidden", transition: "transform 0.2s, box-shadow 0.2s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 12px 40px rgba(155,127,184,0.15)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}>
      <div style={{ position: "relative" }}>
        <Link href={`/shop/${product.id}`} style={{ textDecoration: "none" }}>
          <div style={{ height: 160, overflow: "hidden", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Image src={product.image_url ?? ICON} alt={product.name} width={80} height={80} style={{ objectFit: "contain", opacity: 0.85 }} />
            {!inStock && <span style={{ position: "absolute", top: 10, right: 10, background: "#888", color: "#fff", borderRadius: 100, padding: "0.2rem 0.6rem", fontSize: "0.7rem", fontWeight: 600 }}>Out of stock</span>}
          </div>
        </Link>
        <button onClick={handleRemove} disabled={removing} aria-label="Remove from wishlist"
          style={{ position: "absolute", top: 10, left: 10, background: "rgba(255,255,255,0.9)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#E53935" stroke="#E53935" strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div style={{ padding: "1rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", marginBottom: "0.2rem",
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" as const }}>{product.name}</h3>
        <p style={{ fontSize: "0.78rem", color: "var(--grey)", marginBottom: "0.5rem", textTransform: "capitalize" }}>{product.category}</p>
        <p style={{ fontWeight: 700, color: "var(--plum)", marginBottom: "0.75rem" }}>{fmt(product.price)}</p>
        <button className="btn-plum" style={{ width: "100%", padding: "0.55rem", fontSize: "0.85rem", opacity: inStock ? 1 : 0.5, cursor: inStock ? "pointer" : "not-allowed",
          background: added ? "#2E7D32" : undefined, transition: "background 0.2s" }}
          disabled={!inStock} onClick={handleAddToCart}>
          {added ? "Added ✓" : inStock ? "Add to cart" : "Out of stock"}
        </button>
      </div>
    </div>
  );
}
