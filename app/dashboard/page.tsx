"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, Booking, Artist, Order, OrderItem, Product, Wallet, WalletTransaction, Withdrawal, Province, OrderShipment, FulfillmentMethod } from "@/types";
import { UPSELL_TAG_GROUPS, upsellTagLabel, SA_PROVINCES } from "@/types";
import { getProvince } from "@/lib/provinces";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import UpsellProductPicker from "@/components/UpsellProductPicker";
import { syncServiceUpsells, loadServiceUpsellIds } from "@/lib/upsells";
import StarRating from "@/components/StarRating";
import ReviewModal, { type SubmittedReview } from "@/components/ReviewModal";
import { useCart } from "@/lib/cart-context";
import { useProductWishlist } from "@/lib/product-wishlist-context";
import { PAYOUT_HOLD_DAYS, getNextPayoutDate, formatPayoutDate } from "@/lib/payouts";
import { useGeolocation, type GeoStatus } from "@/lib/geolocation";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push-client";
import ProductsManager from "@/components/dashboard/ProductsManager";

// NOTE: This file is being progressively extracted into reusable dashboard
// components. Batch 2A (ProductsManager) has been completed. Do not re-add
// extracted product UI here. Next batches: Stores/CSV, Orders, Shipments.

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

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

// ── Dashboard navigation ───────────────────────────────────────────────────
// The old tab ids remain supported through deep-link aliases below.
type Tab = "dashboard" | "bookings" | "my-orders" | "wishlist" | "profile" | "my-stores" | "my-services" | "invite" | "my-shop" | "wallet";

const SERVICE_TYPES = [
  { id: "hair",   label: "Hair",  banner: "/banners/hair.jpg",   description: "From protective styles to blowouts, braids to colour — let clients know exactly what you specialise in." },
  { id: "nails",  label: "Nails",  banner: "/banners/nails.jpg",  description: "Gels, acrylics, nail art, manicures and more — list every nail style you offer so clients can find you." },
  { id: "makeup", label: "Makeup",  banner: "/banners/makeup.jpg", description: "Bridal, editorial, glam, natural — describe the makeup looks you create." },
  { id: "lashes", label: "Lashes",  banner: "/banners/lashes.jpg", description: "Classic, hybrid, volume, mega volume — tell clients which lash styles you do." },
] as const;

type ServiceTypeId = typeof SERVICE_TYPES[number]["id"];

type BookingWithRelations = Booking & {
  artist?: Artist & { profile?: Profile };
  client?: Pick<Profile, "full_name" | "avatar_url" | "phone">;
  service?: { name: string; duration_minutes: number };
};

// booking_id -> the review the current user already left for it, if any.
// Shared shape returned by GET /api/reviews?bookingIds=...
type MyReviewMap = Record<string, { rating: number; comment: string | null; created_at: string }>;

type WishlistArtist = {
  artist_id: string;
  artists: Artist;
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending_payment: { bg: "#FFF3E0", color: "#E65100",  label: "Awaiting payment" },
  confirmed:       { bg: "#E8F5E9", color: "#2E7D32",  label: "Confirmed" },
  in_progress:     { bg: "#E3F2FD", color: "#1565C0",  label: "In progress" },
  completed:       { bg: "#F3E5F5", color: "#6A1B9A",  label: "Completed" },
  cancelled:       { bg: "#FAFAFA", color: "#757575",  label: "Cancelled" },
  no_show:         { bg: "#FBE9E7", color: "#BF360C",  label: "No show" },
};

const ORDER_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending_payment: { bg: "#FFF3E0", color: "#E65100", label: "Awaiting payment" },
  paid:            { bg: "#E8F5E9", color: "#2E7D32", label: "Paid" },
  processing:      { bg: "#E3F2FD", color: "#1565C0", label: "Processing" },
  shipped:         { bg: "#EDE7F6", color: "#4527A0", label: "Shipped" },
  delivered:       { bg: "#E8F5E9", color: "#2E7D32", label: "Delivered" },
  cancelled:       { bg: "#FAFAFA", color: "#757575", label: "Cancelled" },
};

// ─── Scroll-arrow pill nav ─────────────────────────────────────────────────────
function PillNav<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
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

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -160, behavior: "smooth" });
  };

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 160, behavior: "smooth" });
  };

  return (
    <div style={{ position: "relative", marginBottom: "1.75rem" }}>
      <div
        ref={scrollRef}
        style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div style={{ display: "flex", gap: "0.25rem", background: "#fff", borderRadius: 100, padding: "0.3rem", border: "1.5px solid rgba(155,127,184,0.12)", width: "max-content", minWidth: "100%" }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              style={{
                borderRadius: 100, border: "none", cursor: "pointer",
                padding: "0.5rem 1.1rem", fontSize: "0.85rem", fontWeight: active === t.id ? 500 : 400,
                background: active === t.id ? "var(--plum)" : "transparent",
                color: active === t.id ? "#fff" : "var(--grey)",
                transition: "all 0.18s", whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {canScrollLeft && (
        <button
          onClick={scrollLeft}
          aria-label="Scroll tabs left"
          style={{
            position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
            background: "linear-gradient(to right, #fff 60%, transparent)",
            border: "none", cursor: "pointer", padding: "0.35rem 1.5rem 0.35rem 0.5rem",
            color: "var(--plum)", fontSize: "1rem", lineHeight: 1, display: "flex", alignItems: "center",
          }}
        >
          ‹
        </button>
      )}
      {canScrollRight && (
        <button
          onClick={scrollRight}
          aria-label="Scroll tabs right"
          style={{
            position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
            background: "linear-gradient(to left, #fff 60%, transparent)",
            border: "none", cursor: "pointer", padding: "0.35rem 0.5rem 0.35rem 1.5rem",
            color: "var(--plum)", fontSize: "1rem", lineHeight: 1, display: "flex", alignItems: "center",
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}

// ─── Booking card ─────────────────────────────────────────────────────────────
function BookingCard({ booking, myReview, onRate }: {
  booking: BookingWithRelations;
  myReview?: { rating: number; comment: string | null } | null;
  onRate?: () => void;
}) {
  const status = STATUS_STYLES[booking.status] ?? STATUS_STYLES.confirmed;
  const artist = booking.artist;
  const service = booking.service;

  return (
    <div style={{
      border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18,
      background: "#fff", padding: "1.25rem", display: "flex", gap: "1rem",
      alignItems: "flex-start", transition: "box-shadow 0.2s",
    }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 32px rgba(155,127,184,0.12)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = ""}
    >
      <div style={{ flexShrink: 0 }}>
        <Image src={artist?.avatar_url ?? ICON} alt={artist?.display_name ?? "Artist"} width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid var(--plum-t)" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", marginBottom: "0.1rem" }}>{artist?.display_name ?? "Artist"}</h3>
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: 0 }}>{service?.name ?? "Service"} · {service?.duration_minutes ?? 60} min</p>
          </div>
          <span style={{ borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.72rem", fontWeight: 600, background: status.bg, color: status.color, whiteSpace: "nowrap", flexShrink: 0 }}>{status.label}</span>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: "0.72rem", color: "var(--light)", marginBottom: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date</p>
            <p style={{ fontSize: "0.88rem", fontWeight: 500 }}>{formatDate(booking.booking_date)}</p>
          </div>
          <div>
            <p style={{ fontSize: "0.72rem", color: "var(--light)", marginBottom: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Time</p>
            <p style={{ fontSize: "0.88rem", fontWeight: 500 }}>{booking.booking_time}</p>
          </div>
          {booking.meeting_address && (
            <div>
              <p style={{ fontSize: "0.72rem", color: "var(--light)", marginBottom: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Location</p>
              <p style={{ fontSize: "0.88rem", fontWeight: 500 }}>{booking.meeting_address}</p>
            </div>
          )}
          <div>
            <p style={{ fontSize: "0.72rem", color: "var(--light)", marginBottom: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total</p>
            <p style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--plum)" }}>{fmt(booking.total_amount)}</p>
          </div>
        </div>

        {booking.status === "completed" && (myReview || onRate) && (
          <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px dashed rgba(155,127,184,0.2)" }}>
            {myReview ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--grey)" }}>Your review:</span>
                <StarRating rating={myReview.rating} showValue={false} size={14} />
              </div>
            ) : (
              <button onClick={onRate} className="btn-outline" style={{ padding: "0.4rem 0.85rem", fontSize: "0.78rem" }}>Rate this booking</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Remaining dashboard components continue below.
// This batch only removes the ProductsManager block; all unrelated sections
// remain unchanged in the full source. 
