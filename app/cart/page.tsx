"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart-context";
import Image from "next/image";
import Link from "next/link";
import Footer from "@/components/Footer";

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
const CART_NAV_LINKS: [string, string][] = [["Search", "/"], ["Shop", "/shop"], ["Earn", "/earn"]];

export default function CartPage() {
  const { items, count, subtotal, removeItem, setQuantity } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="page-shell" style={{ background: "var(--white)", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>

        <div className="nav-links-desktop" style={{ display: "flex", gap: "0.15rem" }}>
          {CART_NAV_LINKS.map(([l, h]) => (
            <Link key={l} href={h} style={{ borderRadius: 100, padding: "0.4rem 1rem", color: "var(--grey)", fontSize: "0.875rem", textDecoration: "none" }}>{l}</Link>
          ))}
        </div>

        <div className="nav-actions-desktop" style={{ display: "flex", alignItems: "center" }}>
          <Link href="/shop" aria-label="Continue shopping" style={{ display: "flex", alignItems: "center", color: "var(--plum)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
          </Link>
        </div>

        <div className="nav-mobile-right" style={{ display: "none", alignItems: "center", gap: "0.5rem" }}>
          <Link href="/shop" aria-label="Continue shopping" style={{ display: "flex", alignItems: "center", color: "var(--plum)", padding: "0.3rem" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
          </Link>
          <button
            aria-label="Open menu"
            onClick={() => setMenuOpen(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "0.3rem", color: "var(--grey)", display: "flex", flexDirection: "column", gap: 5, alignItems: "center", justifyContent: "center" }}
          >
            <span style={{ display: "block", width: 22, height: 2, background: "var(--grey)", borderRadius: 2, transition: "all 0.2s", transform: menuOpen ? "rotate(45deg) translate(5px,5px)" : "none" }} />
            <span style={{ display: "block", width: 22, height: 2, background: "var(--grey)", borderRadius: 2, transition: "all 0.2s", opacity: menuOpen ? 0 : 1 }} />
            <span style={{ display: "block", width: 22, height: 2, background: "var(--grey)", borderRadius: 2, transition: "all 0.2s", transform: menuOpen ? "rotate(-45deg) translate(5px,-5px)" : "none" }} />
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="mobile-menu" style={{ position: "sticky", top: 60, zIndex: 99, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0.75rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {CART_NAV_LINKS.map(([l, h]) => (
            <Link key={l} href={h} onClick={() => setMenuOpen(false)} style={{ borderRadius: 100, padding: "0.4rem 1rem", color: "var(--grey)", fontSize: "0.875rem", textDecoration: "none", display: "inline-block" }}>{l}</Link>
          ))}
        </div>
      )}

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "3rem 1.5rem 5rem", flex: 1, width: "100%", boxSizing: "border-box" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", marginBottom: "0.5rem" }}>Your cart</h1>
        <p style={{ color: "var(--grey)", marginBottom: "2.5rem" }}>{count} item{count !== 1 ? "s" : ""}</p>

        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>Your cart is empty</p>
            <p style={{ color: "var(--grey)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>Browse our shop to find beauty products you'll love.</p>
            <Link href="/shop"><button className="btn-plum">Browse shop</button></Link>
          </div>
        ) : (
          <div className="cart-layout-grid">
            {/* Items */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {items.map(line => (
                <div key={line.product.id} className="cart-line-item" style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.25rem", display: "flex", gap: "1rem", alignItems: "center" }}>
                  <div style={{ width: 72, height: 72, borderRadius: 12, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Image src={line.product.image_url ?? ICON} alt={line.product.name} width={56} height={56} style={{ objectFit: "contain", opacity: 0.8 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500, marginBottom: "0.2rem" }}>{line.product.name}</p>
                    <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.75rem", textTransform: "capitalize" }}>{line.product.category}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 100, padding: "0.2rem 0.5rem" }}>
                        <button onClick={() => setQuantity(line.product.id, line.quantity - 1)} style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 700, fontSize: "1.1rem", cursor: "pointer", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                        <span style={{ fontSize: "0.9rem", fontWeight: 500, minWidth: 20, textAlign: "center" }}>{line.quantity}</span>
                        <button onClick={() => setQuantity(line.product.id, line.quantity + 1)} style={{ background: "none", border: "none", color: "var(--plum)", fontWeight: 700, fontSize: "1.1rem", cursor: "pointer", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                      </div>
                      <button onClick={() => removeItem(line.product.id)} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.8rem", cursor: "pointer", textDecoration: "underline" }}>Remove</button>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontWeight: 700, color: "var(--plum)", fontSize: "1rem" }}>{fmt(line.product.price * line.quantity)}</p>
                    {line.quantity > 1 && <p style={{ fontSize: "0.75rem", color: "var(--light)" }}>{fmt(line.product.price)} each</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="cart-summary" style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem", minWidth: 240, position: "sticky", top: 80 }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Order summary</h3>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
                <span style={{ color: "var(--grey)" }}>Subtotal</span>
                <span>{fmt(subtotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
                <span style={{ color: "var(--grey)" }}>Shipping</span>
                <span style={{ color: "var(--forest)" }}>Calculated at checkout</span>
              </div>
              <div style={{ borderTop: "1px dashed rgba(155,127,184,0.3)", margin: "1rem 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.25rem", fontWeight: 700 }}>
                <span>Total</span>
                <span style={{ color: "var(--plum)" }}>{fmt(subtotal)}</span>
              </div>
              <Link href="/checkout">
                <button className="btn-plum" style={{ width: "100%", padding: "0.875rem" }}>Proceed to checkout</button>
              </Link>
              <Link href="/shop">
                <button className="btn-outline" style={{ width: "100%", padding: "0.75rem", marginTop: "0.75rem" }}>Continue shopping</button>
              </Link>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}