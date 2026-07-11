// components/SiteHeader.tsx
"use client";

import { useState, useEffect, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import { useCart } from "@/lib/cart-context";
import { useProductWishlist } from "@/lib/product-wishlist-context";
import AuthModal from "@/components/AuthModal";

const ICON = "/umuhle-icon.png";

// ── CHANGE: added Stores link ─────────────────────────────────────────────────
const NAV_LINKS = [
  { label: "Search",  href: "/" },
  { label: "Stores",  href: "/stores" },
  { label: "Shop",    href: "/shop" },
  { label: "Earn",    href: "/earn" },
];

interface SiteHeaderProps {
  initialUser?: User | null;
  initialProfile?: Profile | null;
  onSignInClick?: () => void;
  activePath?: string;
}

export default function SiteHeader({
  initialUser,
  initialProfile,
  onSignInClick,
}: SiteHeaderProps) {
  const supabase  = createClient();
  const pathname  = usePathname();
  const router    = useRouter();
  const { count: cartCount } = useCart();
  const { count: wishlistCount } = useProductWishlist();

  const [user, setUser]       = useState<User | null>(initialUser ?? null);
  const [profile, setProfile] = useState<Profile | null>(initialProfile ?? null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (initialUser !== undefined) return;
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

  useEffect(() => { if (initialUser !== undefined) setUser(initialUser ?? null); }, [initialUser]);
  useEffect(() => { if (initialProfile !== undefined) setProfile(initialProfile ?? null); }, [initialProfile]);

  const fetchProfile = async (id: string) => {
    const { data } = await supabase.from("profiles").select("full_name, avatar_url, phone").eq("id", id).single();
    if (data) setProfile(data as Profile);
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleSignInClick = () => {
    setMenuOpen(false);
    if (onSignInClick) {
      onSignInClick();
    } else {
      // Add ?auth=login to wherever we already are — AuthModal (rendered
      // below) reacts to this immediately, no navigation to "/" needed.
      router.push(`${pathname || "/"}?auth=login`);
    }
  };

  // Active check: /stores/[id] should also highlight the Stores link
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const navStyle = (href: string): React.CSSProperties => ({
    borderRadius: 100,
    padding: "0.4rem 1rem",
    color: isActive(href) ? "var(--plum)" : "var(--grey)",
    fontWeight: isActive(href) ? 500 : 400,
    fontSize: "0.875rem",
    textDecoration: "none",
    background: isActive(href) ? "var(--plum-t)" : "transparent",
    display: "inline-block",
    transition: "all 0.15s",
  });

  const WishlistIcon = () => (
    <button
      onClick={() => router.push("/dashboard?tab=wishlist&sub=products")}
      aria-label={`Wishlist — ${wishlistCount} saved product${wishlistCount !== 1 ? "s" : ""}`}
      style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: "0.3rem", color: "var(--grey)", display: "flex" }}
    >
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
      {wishlistCount > 0 && (
        <span style={{ position: "absolute", top: -2, right: -2, background: "var(--plum)", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {wishlistCount}
        </span>
      )}
    </button>
  );

  const CartIcon = () => (
    <button
      onClick={() => router.push("/cart")}
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
  );

  return (
    <>
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>

        <div className="nav-links-desktop" style={{ display: "flex", gap: "0.15rem" }}>
          {NAV_LINKS.map(({ label, href }) => (
            <Link key={href} href={href} style={navStyle(href)}>{label}</Link>
          ))}
          {user && <Link href="/dashboard" style={navStyle("/dashboard")}>Dashboard</Link>}
        </div>

        <div className="nav-actions-desktop" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {user && <WishlistIcon />}
          <CartIcon />
          {user ? (
            <>
              <span style={{ fontSize: "0.85rem", color: "var(--grey)" }}>
                {profile?.full_name?.split(" ")[0] ?? user.email}
              </span>
              <button className="btn-outline" style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }} onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <button className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.875rem" }} onClick={handleSignInClick}>Sign in</button>
          )}
        </div>

        <div className="nav-mobile-right" style={{ display: "none", alignItems: "center", gap: "0.5rem" }}>
          {user && <WishlistIcon />}
          <CartIcon />
          {!user && (
            <button className="btn-plum" style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }} onClick={handleSignInClick}>Sign in</button>
          )}
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
          {NAV_LINKS.map(({ label, href }) => (
            <Link key={href} href={href} onClick={() => setMenuOpen(false)} style={{ ...navStyle(href), display: "inline-block" }}>{label}</Link>
          ))}
          {user && (
            <Link href="/dashboard" onClick={() => setMenuOpen(false)} style={{ ...navStyle("/dashboard"), display: "inline-block" }}>Dashboard</Link>
          )}
          {user ? (
            <button className="btn-outline" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", marginTop: "0.5rem", textAlign: "left" }} onClick={handleSignOut}>Sign out</button>
          ) : (
            <button className="btn-plum" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", marginTop: "0.5rem", textAlign: "left" }} onClick={handleSignInClick}>Sign in</button>
          )}
        </div>
      )}

      {/* Present on every page that renders SiteHeader — this is the actual
          fix for "other pages redirect to the homepage": the modal no
          longer needs to live only on "/". Suspense is required because
          AuthModal reads useSearchParams(); fallback is null since there's
          nothing to show until we know whether ?auth= is set. */}
      <Suspense fallback={null}>
        <AuthModal />
      </Suspense>
    </>
  );
}