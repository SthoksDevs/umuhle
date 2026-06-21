"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { useEffect } from "react";
import Footer from "@/components/Footer";

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;

const MOCK_PRODUCTS = [
  { id: "p1", name: "Moroccan Argan Oil",      price: 28900, category: "Hair care", description: "Nourishing argan oil for shine and strength." },
  { id: "p2", name: "Gel Top Coat",             price: 18900, category: "Nails",     description: "Long-lasting gel top coat for a glossy finish." },
  { id: "p3", name: "HD Setting Powder",        price: 34900, category: "Makeup",    description: "Finely milled powder for a flawless matte look." },
  { id: "p4", name: "Lash Adhesive Pro",        price: 12900, category: "Lashes",    description: "Strong-hold, latex-free lash glue." },
  { id: "p5", name: "Knotless Braid Kit",       price: 45900, category: "Hair care", description: "Everything you need for perfect knotless braids." },
  { id: "p6", name: "UV Gel Polish Set (12pc)", price: 29900, category: "Nails",     description: "Professional UV gel polish in 12 stunning shades." },
  { id: "p7", name: "Contour & Highlight Duo",  price: 22900, category: "Makeup",    description: "Sculpt and illuminate in one compact palette." },
  { id: "p8", name: "Mink Lash Collection",     price: 19900, category: "Lashes",    description: "Reusable mink lashes in 6 gorgeous styles." },
];

const CATEGORIES = ["All", "Hair care", "Nails", "Makeup", "Lashes"] as const;
type Cat = typeof CATEGORIES[number];

export default function ShopPage() {
  const supabase = createClient();
  const [user, setUser]         = useState<User | null>(null);
  const [activeCategory, setActiveCat] = useState<Cat>("All");
  const [showAuth, setShowAuth] = useState(false);
  const [added, setAdded]       = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = activeCategory === "All" ? MOCK_PRODUCTS : MOCK_PRODUCTS.filter(p => p.category === activeCategory);

  const handleAdd = (id: string) => {
    if (!user) { setShowAuth(true); return; }
    setAdded(id);
    setTimeout(() => setAdded(null), 1500);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--white)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>
        <div style={{ display: "flex", gap: "0.15rem" }}>
          {[["Search", "/"], ["Shop", "/shop"], ["Earn", "/earn"]].map(([label, href]) => (
            <Link key={label} href={href} style={{ borderRadius: 100, padding: "0.4rem 1rem", color: href === "/shop" ? "var(--plum)" : "var(--grey)", fontWeight: href === "/shop" ? 500 : 400, fontSize: "0.875rem", textDecoration: "none", background: href === "/shop" ? "var(--plum-t)" : "transparent" }}>
              {label}
            </Link>
          ))}
        </div>
        {user ? (
          <Link href="/dashboard" style={{ fontSize: "0.85rem", color: "var(--grey)", textDecoration: "none" }}>Dashboard</Link>
        ) : (
          <button className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }} onClick={() => setShowAuth(true)}>Sign in</button>
        )}
      </nav>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem 4rem", flex: 1, width: "100%", boxSizing: "border-box" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "0.5rem" }}>curated for you</p>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2.5rem", color: "var(--onyx)", marginBottom: "0.5rem" }}>Beauty Shop</h1>
        <p style={{ color: "var(--grey)", marginBottom: "2.5rem" }}>Professional beauty products, sourced by our artists.</p>

        {/* Category filter */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "2.5rem" }}>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setActiveCat(cat)} style={{ borderRadius: 100, padding: "0.5rem 1.25rem", background: activeCategory === cat ? "var(--plum)" : "var(--plum-t)", color: activeCategory === cat ? "#fff" : "var(--plum)", border: "none", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer", transition: "all 0.2s" }}>
              {cat}
            </button>
          ))}
        </div>

        {/* Out-of-stock notice */}
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 14, padding: "1rem 1.5rem", marginBottom: "2.5rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "1.2rem" }}>🛍️</span>
          <div>
            <p style={{ fontWeight: 600, color: "var(--plum)", margin: 0, fontSize: "0.9rem" }}>Shop coming soon!</p>
            <p style={{ color: "var(--grey)", margin: 0, fontSize: "0.85rem" }}>Our partners are loading their products. These are preview items — sign up to be notified when products go live.</p>
          </div>
        </div>

        {/* Product grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "1.25rem" }}>
          {filtered.map(p => (
            <div key={p.id} style={{ borderRadius: 16, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.15)", background: "#fff", position: "relative" }}>
              {/* Out of stock badge */}
              <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: "#888", color: "#fff", borderRadius: 100, padding: "0.2rem 0.7rem", fontSize: "0.7rem", fontWeight: 700 }}>Out of stock</div>
              <div style={{ height: 160, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Image src={ICON} alt={p.name} width={80} height={80} style={{ objectFit: "contain", opacity: 0.7 }} />
              </div>
              <div style={{ padding: "1rem" }}>
                <p style={{ fontSize: "0.75rem", color: "var(--plum)", fontWeight: 500, marginBottom: "0.25rem" }}>{p.category}</p>
                <h4 style={{ fontWeight: 500, marginBottom: "0.4rem", fontSize: "0.95rem" }}>{p.name}</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "0.75rem", lineHeight: 1.4 }}>{p.description}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: "var(--plum)" }}>{fmt(p.price)}</span>
                  <button
                    className="btn-plum"
                    style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", opacity: 0.5, cursor: "not-allowed" }}
                    disabled
                    onClick={() => handleAdd(p.id)}
                  >
                    {added === p.id ? "Added ✓" : "Out of stock"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Partner CTA */}
        <div style={{ marginTop: "4rem", background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)", borderRadius: 20, padding: "3rem 2rem", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", color: "var(--onyx)", marginBottom: "0.75rem" }}>
            Are you a beauty <em style={{ color: "var(--plum)", fontStyle: "italic" }}>professional</em>?
          </h2>
          <p style={{ color: "var(--grey)", maxWidth: 400, margin: "0 auto 1.5rem", fontSize: "0.95rem" }}>
            List your products on Umuhle and reach thousands of customers across South Africa.
          </p>
          <Link href="/?auth=register">
            <button className="btn-plum">Become a Partner</button>
          </Link>
        </div>
      </main>

      <Footer />

      {/* Simple sign-in prompt */}
      {showAuth && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAuth(false); }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 380, textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Sign in to shop</h3>
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Create an account to save items and checkout.</p>
            <Link href="/?auth=login"><button className="btn-plum" style={{ width: "100%", marginBottom: "0.75rem" }} onClick={() => setShowAuth(false)}>Sign in</button></Link>
            <Link href="/?auth=register"><button className="btn-outline" style={{ width: "100%" }} onClick={() => setShowAuth(false)}>Create account</button></Link>
          </div>
        </div>
      )}
    </div>
  );
}
