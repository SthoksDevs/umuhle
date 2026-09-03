"use client";

// components/dashboard/DashboardShell.tsx
//
// The shared shell behind /dashboard/customer, /dashboard/artist and
// /dashboard/owner (NOT /dashboard/employee — that's a wholly separate
// EmployeeDashboard.tsx, since per the brief an employee account has
// almost nothing in common with the other three). One component,
// parameterized by `role`, rather than three near-duplicates — almost
// every tab (bookings/my-orders/wishlist/profile/wallet/invite) is
// genuinely identical across customer/artist/owner; only My Business
// differs, and only in which of its sections are visible. See the "core
// design decision" in docs/role-based-dashboards-status.md.
//
// This is the renamed, role-aware version of the old app/dashboard/page.tsx
// monolith's DashboardContent. Deliberately keeps its existing client-side
// self-fetch of user+profile via supabase.auth.getUser() rather than
// moving that server-side — that fetch is load-bearing for the WhatsApp
// nudge timing / first-visit tour trigger / legal-reacceptance modal logic
// below it, and rewriting that flow is out of scope for this pass.

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import Image from "next/image";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import OrdersManager from "@/components/dashboard/OrdersManager";
import MyBusinessTab, { type BusinessSection } from "@/components/dashboard/MyBusinessTab";
import { useProductWishlist } from "@/lib/product-wishlist-context";
import { needsLegalReacceptance } from "@/lib/legal";
import DashboardTour from "@/components/DashboardTour";
import { useGeolocation, type GeoStatus } from "@/lib/geolocation";
import { ICON } from "@/lib/dashboard/format";
import type { Tab, WishlistArtist } from "@/lib/dashboard/types";
import type { DashboardRole } from "@/lib/dashboard/context";

import DashboardHome from "@/components/dashboard/DashboardHome";
import BookingsTab from "@/components/dashboard/BookingsTab";
import MyOrdersTab from "@/components/dashboard/MyOrdersTab";
import { WishlistCard, ProductWishlistCard } from "@/components/dashboard/WishlistCards";
import ProfileTab from "@/components/dashboard/ProfileTab";
import InviteTab from "@/components/dashboard/InviteTab";
import WalletTab from "@/components/dashboard/WalletTab";
import MySalonTab from "@/components/dashboard/MySalonTab";
import MyServicesTab from "@/components/dashboard/MyServicesTab";
import MyShopTab from "@/components/dashboard/MyShopTab";
import BranchAnalyticsSection from "@/components/dashboard/BranchAnalyticsSection";


// Refreshes the logged-in artist's stored lat/long from the browser so
// nearby_artists() (supabase/migrations/20260727_proximity_and_push.sql)
// reflects where they actually are today, not wherever they first granted
// permission. Runs once when the dashboard loads (artists only) and again
// every 15 minutes for as long as the tab stays open — that's enough for
// "near me today, gone tomorrow if they've moved", without a background/
// native location service (that's a mobile-app-era upgrade).
const ARTIST_LOCATION_PING_INTERVAL_MS = 15 * 60 * 1000;

function useArtistLocationPing(user: User | null, isArtist: boolean): GeoStatus {
  const supabase = createClient();
  const geo = useGeolocation();

  useEffect(() => {
    if (!user || !isArtist) return;
    geo.request();
    const interval = setInterval(() => geo.request(), ARTIST_LOCATION_PING_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isArtist]);

  useEffect(() => {
    if (!user || !isArtist || geo.status !== "granted" || !geo.coords) return;
    supabase
      .from("artists")
      .update({
        latitude: geo.coords.latitude,
        longitude: geo.coords.longitude,
        location_updated_at: new Date().toISOString(),
      })
      .eq("profile_id", user.id)
      .then(({ error }) => {
        if (error) console.error("Failed to update artist location:", error.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isArtist, geo.status, geo.coords]);

  return geo.status;
}
export default function DashboardShell({ role }: { role: DashboardRole }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab]         = useState<Tab>("dashboard");
  const [businessSection, setBusinessSection] = useState<BusinessSection>("overview");
  const [loading, setLoading] = useState(true);

  const [wishlist, setWishlist]   = useState<WishlistArtist[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [wishlistSubTab, setWishlistSubTab] = useState<"artists" | "products">("artists");
  const { items: productWishlist, loading: productWishlistLoading, remove: removeProductFromWishlist } = useProductWishlist();

  // Deep-link support, e.g. /dashboard?tab=wishlist&sub=products (used by the
  // header's heart icon)
  useEffect(() => {
    const raw = searchParams.get("tab");
    // "my-products" no longer exists — it merged into "my-shop". Keep old
    // bookmarks/links working instead of landing on a blank pane.
    const legacyBusinessTabs: Record<string, typeof businessSection> = {
      "my-store": "stores",
      "my-services": "services",
      "my-shop": "products",
    };
    const mappedBusiness = raw ? legacyBusinessTabs[raw] : undefined;
    if (mappedBusiness) {
      setBusinessSection(mappedBusiness);
      setTab("my-business");
    } else if (raw === "my-business" || raw === "my-orders") {
      setTab(raw as Tab);
    } else if (raw === "my-products") {
      setBusinessSection("products");
      setTab("my-business");
    } else if (raw) {
      setTab(raw as Tab);
    }
    const sub = searchParams.get("sub");
    if (sub === "products" || sub === "artists") setWishlistSubTab(sub);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [showWhatsAppNudge, setShowWhatsAppNudge] = useState(false);
  const [acceptingLegal, setAcceptingLegal] = useState(false);
  const [legalError, setLegalError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Proximity backbone — no-ops for non-artists (isArtist gate inside the hook).
  const artistLocationStatus = useArtistLocationPing(user, profile?.is_artist ?? false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/?auth=login"); return; }
      setUser(user);
      fetchProfile(user.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (data) {
      const p = data as Profile;
      setProfile(p);
      // Admins don't need the "add your WhatsApp number" onboarding nudge,
      // and the legal re-acceptance modal (if needed) takes priority — no
      // point stacking two modals.
      if (!p.phone && !p.is_admin && !needsLegalReacceptance(p)) setTimeout(() => setShowWhatsAppNudge(true), 1500);
      // First-visit spotlight tour — see components/DashboardTour.tsx.
      // Fires after the nudge above so they're not stacked; skipping the
      // tour still marks it done via handleTourClose, so this only ever
      // auto-opens once per account.
      if (!p.has_completed_dashboard_tour) {
        setTimeout(() => { setSidebarOpen(true); setTourOpen(true); }, p.phone || p.is_admin ? 1200 : 2800);
      }
    }
    setLoading(false);
  };

  const startTour = () => { setSidebarOpen(true); setTourOpen(true); };

  const handleTourClose = () => {
    setTourOpen(false);
    setSidebarOpen(false);
    if (profile && !profile.has_completed_dashboard_tour) {
      const updated = { ...profile, has_completed_dashboard_tour: true };
      setProfile(updated);
      supabase.from("profiles").update({ has_completed_dashboard_tour: true }).eq("id", profile.id).then(() => {});
    }
  };

  // Terms/Privacy updated since this profile last accepted (or it never
  // has, for accounts created before this existed / via OAuth, which
  // doesn't carry the signup-time metadata AuthModal sets — see
  // lib/legal.ts). Logs to terms_acceptance_log via the API route, not a
  // direct profiles update, so there's a proper audit trail entry.
  const handleAcceptLegal = async () => {
    setAcceptingLegal(true);
    setLegalError("");
    try {
      const res = await fetch("/api/legal/accept", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setProfile(p => p ? { ...p, terms_accepted: true, terms_accepted_at: data.terms_accepted_at, terms_version: data.terms_version, privacy_version: data.privacy_version } : p);
    } catch (err: unknown) {
      setLegalError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAcceptingLegal(false);
    }
  };

  const fetchWishlist = useCallback(async () => {
    if (!user) return;
    setWishlistLoading(true);
    const res = await fetch("/api/wishlist");
    if (res.ok) { const data = await res.json(); setWishlist(data.items ?? []); }
    setWishlistLoading(false);
  }, [user]);

  useEffect(() => {
    if (tab === "wishlist" && user) fetchWishlist();
  }, [tab, user, fetchWishlist]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--white)" }}>
        <div style={{ textAlign: "center" }}>
          <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%", marginBottom: "1rem" }} />
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) return null;

  // Which My Business sections apply to this role — see "core design
  // decision" in docs/role-based-dashboards-status.md. Route-driven (not a
  // union of every flag the profile happens to have): an owner who's also
  // an artist manages Services from /dashboard/artist, not here.
  const businessSections: Exclude<BusinessSection, "overview">[] =
    role === "owner" ? ["stores", "products", "orders", "analytics"]
    : role === "artist" ? ["services", ...(profile.is_seller ? (["products", "orders"] as const) : [])]
    : profile.is_seller ? ["products", "orders"] // customer, opted into selling
    : [];
  const showMyBusiness = businessSections.length > 0;

  const TAB_CONFIG: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard",   label: "Dashboard",   icon: "⌂" },
    { id: "bookings",    label: "Bookings",    icon: "▣" },
    { id: "my-orders",   label: "Orders",      icon: "▤" },
    { id: "wishlist",    label: "Saved",       icon: "♡" },
    ...(showMyBusiness ? [{ id: "my-business" as Tab, label: "My Business", icon: "▥" }] : []),
    { id: "invite",      label: "Referrals",   icon: "↗" },
    { id: "wallet",      label: "Wallet",      icon: "R" },
    { id: "profile",     label: "Account",     icon: "○" },
  ];

  // Sidebar groups — order controls how items are grouped/headed in the left
  // nav. Groups (and ids within a group) that end up empty after filtering
  // against TAB_CONFIG are dropped so an empty "My business" heading never
  // renders for a role/account that doesn't have it.
  const rawGroups: { title: string; ids: Tab[] }[] = [
    { title: "",             ids: ["dashboard"] },
    { title: "My activity",  ids: ["bookings", "my-orders", "wishlist"] },
    { title: "My business",  ids: ["my-business"] },
    { title: "Money",        ids: ["wallet", "invite"] },
    { title: "Account",      ids: ["profile"] },
  ];
  const groups: { title: string; ids: Tab[] }[] = rawGroups
    .map(g => ({ ...g, ids: g.ids.filter(id => TAB_CONFIG.some(t => t.id === id)) }))
    .filter(g => g.ids.length > 0);
  const navItem = (id: Tab) => TAB_CONFIG.find(x => x.id === id)!;

  // Closes the mobile sidebar drawer on navigation; a no-op on desktop.
  const setActiveTab = (next: Tab) => { setTab(next); setSidebarOpen(false); };
  // Used by DashboardHome's quick-action cards, which also need to land on a
  // specific My Business section (e.g. "+ Add store" -> My Business > Stores).
  const goToTab = (next: Tab, section?: BusinessSection) => {
    if (section) setBusinessSection(section);
    setActiveTab(next);
  };

  return (
    <div className="dashboard-app">
      <SiteHeader initialUser={user} initialProfile={profile} />

      {/* ── WhatsApp incomplete nudge ── */}
      {/* ── Terms/Privacy re-acceptance — blocking, not dismissible via
           backdrop click, since this is a required gate rather than a
           nudge. Takes priority over the WhatsApp nudge below (rendered
           first, so it's on top if both would otherwise show). ── */}
      {profile && needsLegalReacceptance(profile) && (
        <div className="modal-overlay">
          <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)", textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📋</div>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Our Terms &amp; Privacy Policy have been updated</h3>
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
              Please have a look and confirm you're happy to continue on Umuhle under the current version.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.5rem" }}>
              <Link href="/terms-and-conditions" target="_blank" style={{ color: "var(--plum)", fontSize: "0.85rem" }}>Read Terms &amp; Conditions →</Link>
              <Link href="/privacy-policy" target="_blank" style={{ color: "var(--plum)", fontSize: "0.85rem" }}>Read Privacy Policy →</Link>
            </div>
            {legalError && <p style={{ color: "#E53935", fontSize: "0.8rem", marginBottom: "1rem" }}>{legalError}</p>}
            <button className="btn-plum" onClick={handleAcceptLegal} disabled={acceptingLegal} style={{ width: "100%", padding: "0.75rem" }}>
              {acceptingLegal ? "Please wait…" : "I agree — continue"}
            </button>
          </div>
        </div>
      )}

      {showWhatsAppNudge && (
        <div className="modal-overlay" onClick={() => setShowWhatsAppNudge(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 380, boxShadow: "0 24px 80px rgba(0,0,0,0.15)", textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📱</div>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Just one more thing</h3>
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>Add a WhatsApp number so we can reach you with booking contact details and keep your account secure. Email handles everything else — you can turn on WhatsApp updates any time from your profile.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <button className="btn-plum" onClick={() => { setShowWhatsAppNudge(false); setTab("profile"); }} style={{ width: "100%", padding: "0.75rem" }}>Add WhatsApp number</button>
              <button onClick={() => setShowWhatsAppNudge(false)} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.85rem", cursor: "pointer" }}>Remind me later</button>
            </div>
          </div>
        </div>
      )}

      {/* ── First-visit spotlight tour ── */}
      <DashboardTour open={tourOpen} onClose={handleTourClose} />

      {/* ── Mobile top bar: opens the sidebar drawer ── */}
      <div className="dashboard-mobile-top">
        <button onClick={() => setSidebarOpen(true)} aria-label="Open dashboard menu">☰</button>
        <span>Dashboard</span>
        <button onClick={() => setActiveTab("profile")} aria-label="Open account">○</button>
      </div>
      {sidebarOpen && <div className="dashboard-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* ── Left sidebar nav ── */}
      <aside className={`dashboard-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <nav className="dashboard-sidebar-nav">
          {groups.map(group => (
            <div key={group.title || "home"} className="dashboard-nav-group">
              {group.title && <div className="dashboard-nav-heading">{group.title}</div>}
              {group.ids.map(id => {
                const item = navItem(id);
                return (
                  <button key={id} data-tour-id={id} className={`dashboard-nav-item ${tab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>
                    <span className="dashboard-nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <button onClick={startTour} style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "none", border: "none", padding: "0.6rem 0.75rem", color: "var(--light)", fontSize: "0.82rem", cursor: "pointer", textAlign: "left" }}>
          <span style={{ width: 18, textAlign: "center" }}>?</span>
          <span>Take a tour</span>
        </button>
        <button className="dashboard-nav-item dashboard-signout" onClick={handleSignOut}>
          <span className="dashboard-nav-icon">↪</span>
          <span>Sign out</span>
        </button>
      </aside>

      <main className="dashboard-main">
        {/* ── Dashboard home ── */}
        {tab === "dashboard" && <DashboardHome user={user} profile={profile} businessSections={businessSections} onNavigate={goToTab} />}

        {/* ── Bookings tab ── */}
        {tab === "bookings" && <BookingsTab user={user} profile={profile} onUpdateProfile={p => { setProfile(p); if (p.phone) setShowWhatsAppNudge(false); }} />}

        {/* ── My Orders tab ── */}
        {tab === "my-orders" && <MyOrdersTab user={user} />}

        {/* ── Wishlist tab ── */}
        {tab === "wishlist" && (
          <section>
            {/* Artists / Products sub-tabs */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
              {([
                { id: "artists" as const,  label: "Artists",  count: wishlist.length },
                { id: "products" as const, label: "Products", count: productWishlist.length },
              ]).map(t => (
                <button key={t.id} onClick={() => setWishlistSubTab(t.id)}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1.1rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", cursor: "pointer",
                    background: wishlistSubTab === t.id ? "var(--plum)" : "transparent", color: wishlistSubTab === t.id ? "#fff" : "var(--onyx)", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.15s" }}>
                  {t.label} <span style={{ opacity: 0.8 }}>({t.count})</span>
                </button>
              ))}
            </div>

            {/* ── Saved artists ── */}
            {wishlistSubTab === "artists" && (
              <>
                {wishlistLoading && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "1.25rem" }}>{[...Array(4)].map((_, i) => <div key={i} style={{ height: 280, borderRadius: 18, background: "var(--plum-t)" }} />)}</div>}
                {!wishlistLoading && wishlist.length === 0 && (
                  <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>💜</div>
                    <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>Your wishlist is empty</h3>
                    <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>Save your favourite artists to quickly book them again.</p>
                    <Link href="/"><button className="btn-plum" style={{ padding: "0.75rem 2rem" }}>Discover artists</button></Link>
                  </div>
                )}
                {!wishlistLoading && wishlist.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "1.25rem" }}>
                    {wishlist.map(item => <WishlistCard key={item.artist_id} item={item} onRemove={(id) => setWishlist(prev => prev.filter(w => w.artist_id !== id))} />)}
                  </div>
                )}
              </>
            )}

            {/* ── Saved products ── */}
            {wishlistSubTab === "products" && (
              <>
                {productWishlistLoading && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "1.25rem" }}>{[...Array(4)].map((_, i) => <div key={i} style={{ height: 280, borderRadius: 18, background: "var(--plum-t)" }} />)}</div>}
                {!productWishlistLoading && productWishlist.length === 0 && (
                  <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🛍️</div>
                    <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>No saved products yet</h3>
                    <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>Tap the heart on any shop product to save it here for later.</p>
                    <Link href="/shop"><button className="btn-plum" style={{ padding: "0.75rem 2rem" }}>Browse shop</button></Link>
                  </div>
                )}
                {!productWishlistLoading && productWishlist.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "1.25rem" }}>
                    {productWishlist.map(item => (
                      <ProductWishlistCard key={item.product_id} product={item.products} onRemove={removeProductFromWishlist} />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── Profile tab ── */}
        {tab === "profile" && <section><ProfileTab profile={profile} user={user} locationStatus={artistLocationStatus} onUpdate={(p) => { setProfile(p); if (p.phone) setShowWhatsAppNudge(false); }} /></section>}

        {/* ── Invite tab ── */}
        {tab === "invite" && <section><InviteTab profile={profile} /></section>}

        {/* ── Wallet tab ── */}
        {tab === "wallet" && <section><WalletTab user={user} /></section>}

        {/* ── My Business: Stores, Services, Products and Orders ── */}
        {tab === "my-business" && showMyBusiness && (
          <MyBusinessTab
            activeSection={businessSection}
            onSectionChange={setBusinessSection}
            sections={businessSections}
            stores={businessSections.includes("stores") ? <section><MySalonTab user={user} /></section> : undefined}
            services={businessSections.includes("services") ? <section><MyServicesTab profile={profile} user={user} onUpdate={(p) => setProfile(p)} /></section> : undefined}
            products={businessSections.includes("products") ? <MyShopTab user={user} partnerProvince={profile.province} /> : undefined}
            orders={businessSections.includes("orders") ? <OrdersManager user={user} /> : undefined}
            analytics={businessSections.includes("analytics") ? <BranchAnalyticsSection user={user} /> : undefined}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the app router — wrap the
// real dashboard content so /dashboard?tab=wishlist deep links keep working.