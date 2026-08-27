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
import ProductForm, { productToForm, type ProductFormData } from "@/components/ProductForm";
import ProductsManager from "@/components/dashboard/ProductsManager";
import OrdersManager from "@/components/dashboard/OrdersManager";
import MyBusinessTab, { type BusinessSection } from "@/components/dashboard/MyBusinessTab";
import StoreCsvImport from "@/components/dashboard/StoreCsvImport";
import UpsellProductPicker from "@/components/UpsellProductPicker";
import { syncServiceUpsells, loadServiceUpsellIds } from "@/lib/upsells";
import StarRating from "@/components/StarRating";
import ReviewModal, { type SubmittedReview } from "@/components/ReviewModal";
import { useCart } from "@/lib/cart-context";
import { useProductWishlist } from "@/lib/product-wishlist-context";
import { PAYOUT_HOLD_DAYS, getNextPayoutDate, formatPayoutDate } from "@/lib/payouts";
import { useGeolocation, type GeoStatus } from "@/lib/geolocation";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push-client";
import { normalizePhone, isValidSAMobile } from "@/lib/phone";
import DashboardTour from "@/components/DashboardTour";
import { DELIVERY_ARRANGEMENT_OPTIONS, type DeliveryArrangementMethod } from "@/lib/deliveryArrangement";
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, needsLegalReacceptance } from "@/lib/legal";
import { computeReliabilityScore } from "@/lib/reliability";

// Mirrors lib/shiplogic.ts's isCourierCheckoutEnabled() — see
// app/checkout/page.tsx's copy of the same flag for why this is a plain env
// read here rather than an import (lib/shiplogic.ts pulls in server-only
// fetch code that shouldn't ship in the client bundle).
const COURIER_CHECKOUT_ENABLED = process.env.NEXT_PUBLIC_COURIER_CHECKOUT_ENABLED !== "false";

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

// Dashboard navigation: business management is grouped under My Business.
// Legacy my-store/my-services/my-shop query links are mapped to the relevant
// My Business subsection so existing bookmarks continue to work.
type Tab = "dashboard" | "bookings" | "my-orders" | "wishlist" | "profile" | "my-business" | "invite" | "wallet";

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

// ─── Booking card ─────────────────────────────────────────────────────────────
function BookingCard({ booking, myReview, onRate, onCancel, onReportNoShow, actionLoading }: {
  booking: BookingWithRelations;
  myReview?: { rating: number; comment: string | null } | null;
  onRate?: () => void;
  onCancel?: () => void;
  onReportNoShow?: () => void;
  actionLoading?: boolean;
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

        {booking.status === "confirmed" && (onCancel || onReportNoShow) && (
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px dashed rgba(155,127,184,0.2)" }}>
            {onCancel && (
              <button onClick={onCancel} disabled={actionLoading} className="btn-outline" style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem" }}>
                Cancel booking
              </button>
            )}
            {onReportNoShow && (
              <button onClick={onReportNoShow} disabled={actionLoading} className="btn-outline" style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem", borderColor: "#E53935", color: "#E53935" }}>
                Artist didn't arrive
              </button>
            )}
          </div>
        )}

        {booking.status === "completed" && (myReview || onRate) && (
          <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px dashed rgba(155,127,184,0.2)" }}>
            {myReview ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--grey)" }}>Your review:</span>
                <StarRating rating={myReview.rating} showValue={false} size={13} />
              </div>
            ) : (
              <button onClick={onRate} className="btn-outline" style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem" }}>
                Rate your artist
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Wishlist card ─────────────────────────────────────────────────────────────
function WishlistCard({ item, onRemove }: { item: WishlistArtist; onRemove: (id: string) => void }) {
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
function ProductWishlistCard({ product, onRemove }: { product: Product; onRemove: (id: string) => Promise<void> }) {
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

// ─── Profile tab ───────────────────────────────────────────────────────────────
function ProfileTab({ profile, user, locationStatus, onUpdate }: { profile: Profile; user: User; locationStatus: GeoStatus; onUpdate: (p: Profile) => void }) {
  const supabase = createClient();
  const [form, setForm] = useState({ full_name: profile.full_name ?? "", phone: profile.phone ?? "" });
  const [whatsappCommsEnabled, setWhatsappCommsEnabled] = useState(profile.whatsapp_comms_enabled ?? false);
  const [pushState, setPushState] = useState<"idle" | "loading" | "subscribed" | "denied" | "unsupported" | "error">("idle");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [phoneChanged, setPhoneChanged] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const originalPhone = profile.phone ?? "";

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const handlePhoneChange = (val: string) => {
    setForm(f => ({ ...f, phone: val }));
    setPhoneChanged(normalizePhone(val) !== normalizePhone(originalPhone));
    setOtpSent(false); setOtpVerified(false); setOtpError(""); setOtpCode("");
  };

  // Real OTP now (umuhle_number_otp — see lib/whatsapp.ts + app/api/auth/
  // phone-otp), replacing the old best-effort "mark verified on send"
  // flow. Same send/verify endpoints AuthModal uses for signup.
  const handleSendOtp = async () => {
    if (!isValidSAMobile(form.phone)) { setOtpError("Enter a valid South African WhatsApp number."); return; }
    setOtpSending(true); setOtpError("");
    try {
      const res = await fetch("/api/auth/phone-otp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: form.phone }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setOtpSent(true); setResendCooldown(60);
    } catch (err: unknown) { setOtpError(err instanceof Error ? err.message : "Failed to send code"); }
    finally { setOtpSending(false); }
  };

  const handleVerifyOtpCode = async () => {
    if (otpCode.length !== 6) { setOtpError("Enter the 6-digit code."); return; }
    setOtpVerifying(true); setOtpError("");
    try {
      const res = await fetch("/api/auth/phone-otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: form.phone, code: otpCode }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Incorrect code");
      setOtpVerified(true);
      // "The security one" — umuhle_account's verify-account link. Always
      // sent regardless of whatsapp_comms_enabled (see lib/whatsapp.ts).
      // Fire-and-forget: a failed send here shouldn't block saving the
      // number itself.
      fetch("/api/auth/notify-account-created", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.full_name, phone: form.phone }),
      }).catch(() => {});
    } catch (err: unknown) { setOtpError(err instanceof Error ? err.message : "Incorrect code"); }
    finally { setOtpVerifying(false); }
  };
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Image must be under 5MB."); return; }
    setAvatarUploading(true); setError("");
    try {
      const ext = file.name.split(".").pop();
      const path = `avatars/${user.id}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("profiles").upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from("profiles").getPublicUrl(path);
      const bust = `${publicUrl}?t=${Date.now()}`;
      setAvatarUrl(bust);
      const { data, error: updateErr } = await supabase.from("profiles").update({ avatar_url: bust, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
      if (updateErr) throw updateErr;
      if (data) onUpdate(data as Profile);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setAvatarUploading(false); }
  };
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.phone.trim()) { setError("A WhatsApp number is required."); return; }
    if (phoneChanged && !otpVerified) { setError("Please verify your new WhatsApp number before saving."); return; }
    setSaving(true); setError(""); setSaved(false);
    const updates: Record<string, unknown> = {
      full_name: form.full_name,
      phone: normalizePhone(form.phone),
      whatsapp_comms_enabled: whatsappCommsEnabled,
      updated_at: new Date().toISOString(),
    };
    if (phoneChanged && otpVerified) updates.whatsapp_verified_at = new Date().toISOString();
    const { data, error: err } = await supabase.from("profiles").update(updates).eq("id", user.id).select().single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    if (data) { onUpdate(data as Profile); setSaved(true); setPhoneChanged(false); setOtpVerified(false); setOtpSent(false); setOtpCode(""); setTimeout(() => setSaved(false), 3000); }
  };
  const handleCopyReferral = () => {
    if (!profile.referral_code) return;
    navigator.clipboard.writeText(profile.referral_code);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // Push notifications — backbone only (see lib/push-client.ts,
  // lib/push-server.ts). Nothing sends a push yet; this just lets someone
  // opt in/out so the subscription rows are ready for when a flow does.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setPushState(sub ? "subscribed" : "idle");
    }).catch(() => setPushState("idle"));
  }, []);

  const handleEnableNotifications = async () => {
    setPushState("loading");
    const result = await subscribeToPush();
    setPushState(result === "subscribed" ? "subscribed" : result);
  };

  const handleDisableNotifications = async () => {
    setPushState("loading");
    await unsubscribeFromPush();
    setPushState("idle");
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Your profile</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem" }}>Manage your personal details.</p>
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "2rem" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <Image src={avatarUrl || ICON} alt="Profile" width={72} height={72} style={{ borderRadius: "50%", objectFit: "cover", border: "2.5px solid var(--plum-t)", background: "var(--plum-t)" }} />
          {avatarUploading && <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(155,127,184,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: "#fff", fontSize: "0.7rem" }}>…</span></div>}
        </div>
        <div>
          <label htmlFor="avatar-upload" style={{ display: "inline-block", cursor: "pointer" }}>
            <span className="btn-outline" style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", display: "inline-block" }}>{avatarUploading ? "Uploading…" : "Change photo"}</span>
          </label>
          <input id="avatar-upload" type="file" accept="image/*" onChange={handleAvatarUpload} disabled={avatarUploading} style={{ display: "none" }} />
          <p style={{ fontSize: "0.72rem", color: "var(--light)", marginTop: "0.3rem" }}>JPG, PNG or WEBP · max 5MB</p>
        </div>
      </div>
      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Full name</label>
          <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Your full name" style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Email</label>
          <input value={user.email ?? ""} disabled style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", background: "#FAFAFA", color: "var(--light)", cursor: "not-allowed" }} />
          <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "0.35rem" }}>Email cannot be changed.</p>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>WhatsApp number{otpVerified && <span style={{ marginLeft: "0.5rem", color: "var(--forest)", fontSize: "0.72rem" }}>✓ Verified</span>}{!phoneChanged && profile.whatsapp_verified_at && <span style={{ marginLeft: "0.5rem", color: "var(--forest)", fontSize: "0.72rem" }}>✓ Verified</span>}</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input value={form.phone} onChange={e => handlePhoneChange(e.target.value)} placeholder="e.g. 082 123 4567" type="tel" required style={{ flex: 1, padding: "0.75rem 1rem", borderRadius: 12, border: `1.5px solid ${phoneChanged && !otpVerified ? "var(--nude)" : "#E0E0E0"}`, fontSize: "0.9rem" }} />
            {phoneChanged && !otpVerified && (
              <button type="button" onClick={handleSendOtp} disabled={otpSending || resendCooldown > 0} style={{ flexShrink: 0, background: "var(--plum)", color: "#fff", border: "none", borderRadius: 12, padding: "0 1rem", fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
                {otpSending ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : otpSent ? "Resend" : "Send code"}
              </button>
            )}
          </div>
          {phoneChanged && otpSent && !otpVerified && (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <input
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                style={{ flex: 1, padding: "0.65rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", letterSpacing: "0.2em", textAlign: "center" }}
              />
              <button type="button" onClick={handleVerifyOtpCode} disabled={otpVerifying || otpCode.length !== 6} className="btn-plum" style={{ flexShrink: 0, padding: "0 1.25rem", fontSize: "0.82rem" }}>
                {otpVerifying ? "Verifying…" : "Verify"}
              </button>
            </div>
          )}
          {otpError && <p style={{ color: "#E53935", fontSize: "0.8rem", marginTop: "0.4rem" }}>{otpError}</p>}
          {!phoneChanged && <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "0.35rem" }}>Used for booking notifications and account security. Changing your number requires verification.</p>}
        </div>
        <div style={{ background: "#FAFAFA", borderRadius: 12, padding: "1rem", border: "1.5px solid #E0E0E0" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.7rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={whatsappCommsEnabled}
              onChange={e => setWhatsappCommsEnabled(e.target.checked)}
              style={{ marginTop: "0.2rem", width: 16, height: 16, flexShrink: 0, accentColor: "var(--plum)" }}
            />
            <span>
              <span style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, color: "var(--onyx)" }}>Send me WhatsApp updates</span>
              <span style={{ display: "block", fontSize: "0.78rem", color: "var(--grey)", marginTop: "0.2rem" }}>
                Booking reminders, order updates and review requests. Off by default — we&apos;ll use email instead. Security codes and appointment contact alerts always go out regardless of this setting.
              </span>
            </span>
          </label>
        </div>
        {error && <p style={{ color: "#E53935", fontSize: "0.85rem" }}>{error}</p>}
        {saved && <p style={{ color: "var(--forest)", fontSize: "0.85rem" }}>Profile updated successfully.</p>}
        <button type="submit" className="btn-plum" disabled={saving} style={{ alignSelf: "flex-start", padding: "0.75rem 2rem" }}>{saving ? "Saving…" : "Save changes"}</button>
      </form>
      {profile.referral_code && (
        <div style={{ marginTop: "2.5rem", background: "var(--plum-t)", borderRadius: 16, padding: "1.25rem" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--plum)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Your referral code</p>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 500, letterSpacing: "0.1em", color: "var(--plum)" }}>{profile.referral_code}</span>
            <button onClick={handleCopyReferral} style={{ background: copied ? "var(--forest)" : "var(--plum)", color: "#fff", border: "none", borderRadius: 8, padding: "0.35rem 0.75rem", fontSize: "0.78rem", fontWeight: 500, cursor: "pointer", transition: "background 0.2s" }}>{copied ? "Copied ✓" : "Copy"}</button>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginTop: "0.5rem" }}>Share with friends. Earn rewards when they book through Umuhle.</p>
        </div>
      )}

      {profile.is_artist && (
        <div style={{ marginTop: "1.5rem", background: "#FAFAFA", borderRadius: 16, padding: "1.25rem", border: "1.5px solid #E0E0E0" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--onyx)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>📍 Location</p>
          <p style={{ fontSize: "0.85rem", color: "var(--grey)" }}>
            {locationStatus === "granted" && "We're using your current location so nearby customers can find you. This updates automatically while you have the dashboard open."}
            {locationStatus === "checking" && "Getting your current location…"}
            {(locationStatus === "denied" || locationStatus === "idle") && "Location access isn't on, so you won't show up in customers' \"near me\" results yet. Your browser will prompt you for permission — allow it to start appearing nearby."}
            {locationStatus === "unavailable" && "Couldn't get a location fix just now — this is usually temporary (weak signal, or your device is still acquiring one) rather than a permissions problem. We'll keep trying automatically."}
            {locationStatus === "unsupported" && "Your browser doesn't support location — you'll still show up in the full artist list, just not sorted by distance."}
          </p>
        </div>
      )}

      <div style={{ marginTop: "1.5rem", background: "#FAFAFA", borderRadius: 16, padding: "1.25rem", border: "1.5px solid #E0E0E0" }}>
        <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--onyx)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>🔔 Browser notifications</p>
        <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "0.75rem" }}>
          {pushState === "subscribed" ? "Enabled on this device." : "Get notified in your browser about bookings and orders, even when Umuhle isn't open."}
        </p>
        {pushState === "subscribed" ? (
          <button onClick={handleDisableNotifications} className="btn-outline" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}>Turn off</button>
        ) : pushState === "unsupported" ? null : (
          <button onClick={handleEnableNotifications} disabled={pushState === "loading"} className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}>
            {pushState === "loading" ? "Enabling…" : pushState === "denied" ? "Blocked — check browser settings" : "Enable notifications"}
          </button>
        )}
      </div>

      {profile.is_partner && <PartnerFulfillmentSettings profile={profile} onUpdate={onUpdate} />}
    </div>
  );
}

// ── PartnerFulfillmentSettings ───────────────────────────────────────────────
// Where a partner's orders dispatch from, and how customers get them —
// courier, in-person collection, or both. Feeds two things downstream:
// the origin snapshot on each order_shipments row (lib/orders.ts), and the
// default sell_provinces a "province"-scoped product falls back to when
// the seller hasn't picked specific ones (components/ProductForm.tsx).
function PartnerFulfillmentSettings({ profile, onUpdate }: { profile: Profile; onUpdate: (p: Profile) => void }) {
  const supabase = createClient();
  const [address, setAddress] = useState(profile.address ?? "");
  const [suburb, setSuburb] = useState(profile.suburb ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [province, setProvince] = useState<Province | "">(profile.province ?? "");
  const [postalCode, setPostalCode] = useState(profile.postal_code ?? "");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    profile.latitude != null && profile.longitude != null
      ? { latitude: profile.latitude, longitude: profile.longitude }
      : null
  );
  const [allowCollection, setAllowCollection] = useState(profile.allow_collection);
  const [allowCourier, setAllowCourier] = useState(profile.allow_courier);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryArrangementMethod | "">(
    (profile.delivery_arrangement_method as DeliveryArrangementMethod | null) ?? ""
  );
  const [deliveryNote, setDeliveryNote] = useState(profile.delivery_arrangement_note ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Courier's paused platform-wide (see lib/shiplogic.ts) — a partner who
  // still offers it needs to say how delivery will actually work so
  // checkout doesn't leave customers guessing. Irrelevant once courier's
  // back on, or if this partner only offers collection anyway.
  const arrangementRequired = !COURIER_CHECKOUT_ENABLED && allowCourier;

  const handleAddressSelect = (r: GeocodeSuggestion) => {
    setAddress(r.street || r.displayName);
    setSuburb(r.suburb);
    setCity(r.city);
    setPostalCode(r.postalCode);
    setCoords({ latitude: r.latitude, longitude: r.longitude });
    // Nominatim doesn't return a province, so guess it from the pin using
    // the same nearest-centroid classifier used elsewhere (lib/provinces.ts)
    // — a reasonable default, editable below if it's ever wrong near a border.
    setProvince(getProvince({ latitude: r.latitude, longitude: r.longitude }) as Province);
  };

  const handleSave = async () => {
    if (!allowCollection && !allowCourier) {
      setError("Turn on at least one of courier or collection — otherwise customers have no way to actually get an order from you.");
      return;
    }
    if (arrangementRequired && !deliveryMethod) {
      setError("Courier's paused for now — choose how you'll handle delivery so customers know what to expect.");
      return;
    }
    if (arrangementRequired && deliveryMethod === "custom" && !deliveryNote.trim()) {
      setError("Add a short message for customers describing how delivery will work.");
      return;
    }
    setSaving(true); setError(""); setSaved(false);
    const { data, error: err } = await supabase
      .from("profiles")
      .update({
        address: address.trim() || null,
        suburb: suburb.trim() || null,
        city: city.trim() || null,
        province: province || null,
        postal_code: postalCode.trim() || null,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        allow_collection: allowCollection,
        allow_courier: allowCourier,
        // Cleared entirely once collection-only, so a stale arrangement
        // doesn't linger from before they turned courier off.
        delivery_arrangement_method: allowCourier ? deliveryMethod || null : null,
        delivery_arrangement_note: allowCourier ? deliveryNote.trim() || null : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .select()
      .single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    if (data) { onUpdate(data as Profile); setSaved(true); setTimeout(() => setSaved(false), 3000); }
  };

  const toggleCardStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, textAlign: "left", padding: "0.8rem 1rem", borderRadius: 14, cursor: "pointer",
    border: active ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
    background: active ? "rgba(155,127,184,0.08)" : "#fff",
  });
  const smallLabel: React.CSSProperties = { display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#888", marginBottom: "0.3rem" };
  const smallInput: React.CSSProperties = { width: "100%", padding: "0.65rem 0.85rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", boxSizing: "border-box" };

  return (
    <div style={{ background: "#fff", border: "1.5px solid var(--plum-t)", borderRadius: 18, padding: "1.5rem", marginTop: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.05rem", marginBottom: "0.4rem" }}>Fulfillment</h3>
      <p style={{ color: "var(--grey)", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1.1rem" }}>
        Where your orders dispatch from, and how customers can get them. This also sets the default area for any product you list as &quot;province only&quot; without picking specific provinces.
      </p>

      <label style={smallLabel}>Pickup / dispatch address</label>
      <AddressAutocomplete onSelect={handleAddressSelect} />
      {address && (
        <p style={{ fontSize: "0.78rem", color: "var(--grey)", marginTop: "0.4rem" }}>
          {[address, suburb, city].filter(Boolean).join(", ")}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
        <div>
          <label style={smallLabel}>Suburb</label>
          <input value={suburb} onChange={e => setSuburb(e.target.value)} style={smallInput} />
        </div>
        <div>
          <label style={smallLabel}>City</label>
          <input value={city} onChange={e => setCity(e.target.value)} style={smallInput} />
        </div>
        <div>
          <label style={smallLabel}>Province</label>
          <select value={province} onChange={e => setProvince(e.target.value as Province)} style={smallInput}>
            <option value="">Select…</option>
            {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={smallLabel}>Postal code</label>
          <input value={postalCode} onChange={e => setPostalCode(e.target.value)} style={smallInput} />
        </div>
      </div>

      <label style={{ ...smallLabel, marginTop: "1.1rem", color: "#9B7FB8", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.72rem" }}>
        How customers get their order
      </label>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.5rem" }}>
        <button type="button" onClick={() => setAllowCourier(v => !v)} style={toggleCardStyle(allowCourier)}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: allowCourier ? "var(--plum)" : "#333" }}>🚚 Courier</div>
          <div style={{ fontSize: "0.72rem", color: "#999", marginTop: "0.15rem" }}>Shipped to their address</div>
        </button>
        <button type="button" onClick={() => setAllowCollection(v => !v)} style={toggleCardStyle(allowCollection)}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: allowCollection ? "var(--plum)" : "#333" }}>🏠 Collection</div>
          <div style={{ fontSize: "0.72rem", color: "#999", marginTop: "0.15rem" }}>They fetch it from you</div>
        </button>
      </div>

      {arrangementRequired && (
        <div style={{ marginTop: "1.1rem", background: "#FFF8E1", border: "1.5px solid #F0C766", borderRadius: 14, padding: "1.1rem" }}>
          <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#8A6100", marginBottom: "0.3rem" }}>🚚 Courier is paused for now</p>
          <p style={{ fontSize: "0.8rem", color: "#7A5A00", lineHeight: 1.5, marginBottom: "0.9rem" }}>
            We're not quoting or charging Ship Logic courier rates at checkout right now. Customers will still be able to choose delivery and give you their address — pick how you'll actually get it to them.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {DELIVERY_ARRANGEMENT_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                style={{
                  display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.65rem 0.85rem", borderRadius: 10, cursor: "pointer",
                  border: deliveryMethod === opt.id ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
                  background: deliveryMethod === opt.id ? "rgba(155,127,184,0.08)" : "#fff",
                }}
              >
                <input
                  type="radio"
                  name="delivery-arrangement"
                  checked={deliveryMethod === opt.id}
                  onChange={() => setDeliveryMethod(opt.id)}
                  style={{ marginTop: "0.2rem" }}
                />
                <span>
                  <span style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#333" }}>{opt.label}</span>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "#888", marginTop: "0.1rem" }}>{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
          <label style={{ ...smallLabel, marginTop: "0.9rem" }}>
            {deliveryMethod === "custom" ? "Message for customers *" : "Add a note for customers (optional)"}
          </label>
          <textarea
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
            placeholder={deliveryMethod === "custom" ? "e.g. \"I'll message you on WhatsApp within a day to arrange a time.\"" : "Extra detail shown alongside the option above"}
            rows={2}
            style={{ ...smallInput, resize: "vertical" }}
          />
        </div>
      )}

      {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginTop: "0.75rem" }}>{error}</p>}
      {saved && <p style={{ color: "var(--forest)", fontSize: "0.85rem", marginTop: "0.75rem" }}>Fulfillment settings saved.</p>}
      <button onClick={handleSave} disabled={saving} className="btn-plum" style={{ marginTop: "1rem", padding: "0.65rem 1.6rem", fontSize: "0.85rem", opacity: saving ? 0.6 : 1 }}>
        {saving ? "Saving…" : "Save fulfillment settings"}
      </button>
    </div>
  );
}


// ─── My Salon tab ──────────────────────────────────────────────────────────────
type DayHours = {
  closed: boolean;
  open: string;
  close: string;
};

type SpecialDay = {
  date: string;
  closed: boolean;
  open?: string;
  close?: string;
};

type OpeningHours = {
  weekly: {
    sunday: DayHours;
    monday: DayHours;
    tuesday: DayHours;
    wednesday: DayHours;
    thursday: DayHours;
    friday: DayHours;
    saturday: DayHours;
  };

  public_holidays: DayHours;

  special_days: SpecialDay[];
};
 
type SalonListing = {
  id?: string;
  name: string;
  description: string;
  address: string;
  suburb: string;
  city: string;
  postal_code: string;
  latitude?: number | null;
  longitude?: number | null;
  phone: string;
  email: string;
  website: string;
  opening_hours: OpeningHours;
  gallery_urls: string[];
  instagram_username: string;
  youtube_url: string;
  services: string[];
  status?: "pending" | "approved" | "rejected";
};
 
type StoreBooking = {
  id: string;
  client_name: string;
  client_phone: string;
  service: string;
  booking_date: string;
  booking_time: string;
  notes: string | null;
  status: string;
  created_at: string;
  branch_employee_id: string | null;
  employee: { name: string } | null;
};
 
type GalleryFile = { file: File; preview: string };
 
const WEEK_DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const ALL_SERVICES = ["hair","nails","makeup","lashes"];
 
const defaultDay: DayHours = {
  closed: false,
  open: "08:00",
  close: "17:00",
};

const emptySalon = (): SalonListing => ({
  name: "",
  description: "",
  address: "",
  suburb: "",
  city: "",
  postal_code: "",
  phone: "",
  email: "",
  website: "",

  opening_hours: {
    weekly: {
      sunday: {
        closed: true,
        open: "",
        close: "",
      },

      monday: { ...defaultDay },
      tuesday: { ...defaultDay },
      wednesday: { ...defaultDay },
      thursday: { ...defaultDay },
      friday: { ...defaultDay },

      saturday: {
        closed: false,
        open: "08:00",
        close: "13:00",
      },
    },

    public_holidays: {
      closed: true,
      open: "",
      close: "",
    },

    special_days: [],
  },

  gallery_urls: [],
  instagram_username: "",
  youtube_url: "",
  services: [],
});
 
// ── SalonForm ─────────────────────────────────────────────────────────────────
 
// ── AddressAutocomplete ──────────────────────────────────────────────────────
// A live, as-you-type South African address search (backed by OpenStreetMap
// Nominatim via app/api/geocode/suggest) — picking a result fills address,
// suburb, city, postal code AND latitude/longitude all at once, straight
// from a match Nominatim already resolved. This is what actually prevents
// the "geocode failed on save" problem, rather than just patching it: the
// coordinates never depend on re-parsing whatever ended up typed across
// five separate fields.
type GeocodeSuggestion = { displayName: string; latitude: number; longitude: number; street: string; suburb: string; city: string; postalCode: string };

function AddressAutocomplete({ onSelect }: { onSelect: (r: GeocodeSuggestion) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 4) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults((data.results as GeocodeSuggestion[]) ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 450); // Nominatim's usage policy asks for ~1 request/second, max
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // lets the click below land first
        placeholder="Start typing your address…"
        style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", outline: "none" }}
      />
      {loading && <p style={{ fontSize: "0.75rem", color: "#aaa", marginTop: "0.3rem" }}>Searching…</p>}
      {open && results.length > 0 && (
        <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 12, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 260, overflowY: "auto" }}>
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onSelect(r); setQuery(r.displayName); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "0.65rem 0.9rem", border: "none", background: "none", cursor: "pointer", fontSize: "0.82rem", color: "var(--onyx)", borderBottom: i < results.length - 1 ? "1px solid rgba(155,127,184,0.1)" : "none" }}
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SalonForm({
  initial,
  userId,
  onSaved,
  onCancel,
  isEdit,
}: {
  initial: SalonListing;
  userId: string;
  onSaved: (listing: SalonListing) => void;
  onCancel?: () => void;
  isEdit: boolean;
}) {
  const supabase = createClient();
  const [form, setForm] = useState<SalonListing>(initial);
  const [gallery, setGallery] = useState<GalleryFile[]>([]);
  const [galleryError, setGalleryError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // How many photos will incur R5 charges
  const chargeableCount = gallery.length; // all new uploads cost R5 each
 
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.75rem 1rem", borderRadius: 12,
    border: "1.5px solid #E0E0E0", fontSize: "0.9rem", outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.8rem", fontWeight: 600, color: "#888",
    display: "block", marginBottom: "0.3rem", marginTop: "0.85rem",
  };
 
  /*const toggleDay = (day: string) => {
    setForm(f => ({
      ...f,
      opening_hours: {
        ...f.opening_hours,
        days: f.opening_hours.days.includes(day)
          ? f.opening_hours.days.filter(d => d !== day)
          : [...f.opening_hours.days, day],
      },
    }));
  };*/
 
  const toggleService = (svc: string) => {
    setForm(f => ({
      ...f,
      services: f.services.includes(svc)
        ? f.services.filter(s => s !== svc)
        : [...f.services, svc],
    }));
  };
 
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid = files.filter(f => f.type.startsWith("image/"));
    // Max 10 total (5 existing + 5 new as a soft limit — each costs R5)
    const remaining = 10 - form.gallery_urls.length;
    if (gallery.length + valid.length > remaining) {
      setGalleryError(`Maximum ${remaining} new images allowed.`);
      return;
    }
    setGalleryError("");
    const newFiles = valid.slice(0, remaining - gallery.length).map(f => ({
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setGallery(prev => [...prev, ...newFiles]);
  };
 
  /** Upload gallery images to Supabase Storage and record R5 charges */
  const uploadGallery = async (): Promise<string[]> => {
    const urls: string[] = [...form.gallery_urls];
    for (const item of gallery) {
      const ext = item.file.name.split(".").pop();
      const path = `salons/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("salon-gallery")
        .upload(path, item.file, { upsert: false });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from("salon-gallery").getPublicUrl(path);
      urls.push(publicUrl);
 
      // Record R5 charge (status = pending until a gateway confirms it —
      // this was never actually wired up to PayFast or anything else; it
      // just logs the intent). Same shape as the R35 salon registration
      // fee if this ever gets built out — see lib/payments/eligibility.ts,
      // Ozow-only, since it'd be 100% Umuhle revenue.
      await supabase.from("photo_upload_charges").insert({
        owner_id: userId,
        salon_id: form.id ?? null,
        image_url: publicUrl,
        amount_cents: 500,
        status: "pending",
      });
    }
    return urls;
  };
 
  const handleSubmit = async () => {
    setError("");
    if (!form.name.trim()) { setError("Store name is required."); return; }
    if (!form.address.trim()) { setError("Address is required."); return; }
const openDays = Object.values(
  form.opening_hours.weekly
).filter((d) => !d.closed);

if (openDays.length === 0) {
  setError("Select at least one business day.");
  return;
}
    if (form.services.length === 0) { setError("Select at least one service."); return; }
 
    setSaving(true);
    try {
      const galleryUrls = await uploadGallery();

      // Best-effort geocode so the public store page can show the
      // "Find us here" map. Never blocks saving — if it fails or times
      // out, we just keep whatever coordinates the listing already had.
      let latitude = form.latitude ?? null;
      let longitude = form.longitude ?? null;
      try {
        const geoRes = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: form.address,
            suburb: form.suburb,
            city: form.city,
            postalCode: form.postal_code,
          }),
        });
        if (geoRes.ok) {
          const geo = await geoRes.json();
          if (geo.latitude && geo.longitude) {
            latitude = geo.latitude;
            longitude = geo.longitude;
          }
        }
      } catch {
        // Geocoding is a nice-to-have, not a save-blocker.
      }

      // Only brand-new listings (and ones still pending/rejected from a
      // prior submission) go back into the review queue. Once a listing
      // has been approved and is live, the owner's own edits — fixing a
      // phone number, updating the address, adding photos — must not
      // knock it back into "Under review" and off the Stores page.
      const status: "pending" | "approved" =
        isEdit && initial.status === "approved" ? "approved" : "pending";

      const payload = {
        name: form.name,
        description: form.description,
        address: form.address,
        suburb: form.suburb,
        city: form.city,
        postal_code: form.postal_code || null,
        latitude,
        longitude,
        phone: form.phone,
        email: form.email,
        website: form.website || null,
        opening_hours: form.opening_hours,
        gallery_urls: galleryUrls,
        instagram_username: form.instagram_username || null,
        youtube_url: form.youtube_url || null,
        services: form.services,
        partner_id: userId,
        status,
      };
 
      let data, err;
      if (form.id) {
        ({ data, error: err } = await supabase
          .from("partner_salons").update(payload).eq("id", form.id).select().single());
      } else {
        ({ data, error: err } = await supabase
          .from("partner_salons").insert(payload).select().single());
      }
      if (err) throw err;

      // First-time submission only — never on edits to an existing
      // listing. Fire-and-forget: the listing is already saved either way.
      if (!form.id && data) {
        const saved = data as SalonListing;
        fetch("/api/salons/submitted", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salonId: saved.id, salonName: saved.name }),
        }).catch(() => {});
      }

      setGallery([]);
      onSaved(data as SalonListing);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };
 
  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "1rem" }}>
        {isEdit ? "Edit listing" : "Add a store"}
      </h3>
 
      <label style={labelStyle}>Store name *</label>
      <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Beauty by Thandi" style={inputStyle} />
 
      <label style={labelStyle}>Description</label>
      <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Tell clients what makes your store special…" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
 
      <label style={labelStyle}>Search your address</label>
      <AddressAutocomplete onSelect={r => setForm(f => ({
        ...f,
        address: r.street || f.address,
        suburb: r.suburb || f.suburb,
        city: r.city || f.city,
        postal_code: r.postalCode || f.postal_code,
        latitude: r.latitude,
        longitude: r.longitude,
      }))} />
      <p style={{ fontSize: "0.75rem", color: "#aaa", marginTop: "0.3rem", marginBottom: "0.85rem" }}>
        Pick a match to fill in the fields below automatically — or just type them in yourself.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
        <div>
          <label style={labelStyle}>Suburb *</label>
          <input required value={form.suburb} onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))} placeholder="e.g. Sandton" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>City *</label>
          <input required value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Johannesburg" style={inputStyle} />
        </div>
      </div>
 
      <label style={labelStyle}>Full address *</label>
      <input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main Street, Sandton" style={inputStyle} />

      <label style={labelStyle}>Postal code</label>
      <input value={form.postal_code ?? ""} onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))} placeholder="e.g. 2196" style={{ ...inputStyle, maxWidth: 220 }} />
      <p style={{ fontSize: "0.75rem", color: "#aaa", marginTop: "0.3rem" }}>
        Helps us place your store accurately on the &ldquo;Find us here&rdquo; map on your public page.
      </p>
 
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
        <div>
          <label style={labelStyle}>Phone *</label>
          <input required type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="082 123 4567" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="hello@yourstore.co.za" style={inputStyle} />
        </div>
      </div>
 
      <label style={labelStyle}>Website</label>
      <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://yourstore.co.za" style={inputStyle} />
 
      {/* Services */}
      <label style={labelStyle}>Services offered *</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        {ALL_SERVICES.map(svc => {
          const on = form.services.includes(svc);
          return (
            <button key={svc} type="button" onClick={() => toggleService(svc)} style={{
              padding: "0.4rem 1rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer",
              border: "1.5px solid", borderColor: on ? "var(--plum)" : "rgba(155,127,184,0.25)",
              background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)",
              fontWeight: on ? 600 : 400, textTransform: "capitalize",
            }}>{svc}</button>
          );
        })}
      </div>
 
      {/* Business hours */}
<label style={labelStyle}>Business hours *</label>

<div
  style={{
    border: "1.5px solid #E0E0E0",
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 4,
  }}
>
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "0.85rem",
    }}
  >
    <thead>
      <tr style={{ background: "#fafaf8" }}>
        <th style={{ padding: "0.75rem", textAlign: "left" }}>Day</th>
        <th style={{ padding: "0.75rem", textAlign: "center" }}>Closed</th>
        <th style={{ padding: "0.75rem", textAlign: "left" }}>Open</th>
        <th style={{ padding: "0.75rem", textAlign: "left" }}>Close</th>
      </tr>
    </thead>

    <tbody>
      {(
        [
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ] as const
      ).map((day) => {
        const hours = form.opening_hours.weekly[day];

        return (
          <tr
            key={day}
            style={{
              borderTop: "1px solid #f0f0f0",
            }}
          >
            <td style={{ padding: "0.75rem", textTransform: "capitalize" }}>
              {day}
            </td>

            <td style={{ padding: "0.75rem", textAlign: "center" }}>
              <input
                type="checkbox"
                checked={hours.closed}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    opening_hours: {
                      ...f.opening_hours,
                      weekly: {
                        ...f.opening_hours.weekly,
                        [day]: {
                          ...hours,
                          closed: e.target.checked,
                        },
                      },
                    },
                  }))
                }
              />
            </td>

            <td style={{ padding: "0.75rem" }}>
              <input
                type="time"
                disabled={hours.closed}
                value={hours.open}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    opening_hours: {
                      ...f.opening_hours,
                      weekly: {
                        ...f.opening_hours.weekly,
                        [day]: {
                          ...hours,
                          open: e.target.value,
                        },
                      },
                    },
                  }))
                }
                style={{
                  ...inputStyle,
                  opacity: hours.closed ? 0.5 : 1,
                }}
              />
            </td>

            <td style={{ padding: "0.75rem" }}>
              <input
                type="time"
                disabled={hours.closed}
                value={hours.close}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    opening_hours: {
                      ...f.opening_hours,
                      weekly: {
                        ...f.opening_hours.weekly,
                        [day]: {
                          ...hours,
                          close: e.target.value,
                        },
                      },
                    },
                  }))
                }
                style={{
                  ...inputStyle,
                  opacity: hours.closed ? 0.5 : 1,
                }}
              />
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>

{/* Public holidays */}

<label style={{ ...labelStyle, marginTop: "1rem" }}>
  Public holidays
</label>

<div
  style={{
    border: "1.5px solid #E0E0E0",
    borderRadius: 12,
    padding: "1rem",
  }}
>
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "120px 1fr 1fr",
      gap: "0.75rem",
      alignItems: "center",
    }}
  >
    <label>
      <input
        type="checkbox"
        checked={form.opening_hours.public_holidays.closed}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              public_holidays: {
                ...f.opening_hours.public_holidays,
                closed: e.target.checked,
              },
            },
          }))
        }
      />
      {" "}Closed
    </label>

    <input
      type="time"
      disabled={form.opening_hours.public_holidays.closed}
      value={form.opening_hours.public_holidays.open}
      onChange={(e) =>
        setForm((f) => ({
          ...f,
          opening_hours: {
            ...f.opening_hours,
            public_holidays: {
              ...f.opening_hours.public_holidays,
              open: e.target.value,
            },
          },
        }))
      }
      style={inputStyle}
    />

    <input
      type="time"
      disabled={form.opening_hours.public_holidays.closed}
      value={form.opening_hours.public_holidays.close}
      onChange={(e) =>
        setForm((f) => ({
          ...f,
          opening_hours: {
            ...f.opening_hours,
            public_holidays: {
              ...f.opening_hours.public_holidays,
              close: e.target.value,
            },
          },
        }))
      }
      style={inputStyle}
    />
  </div>
</div>

{/* Special days */}

<label style={{ ...labelStyle, marginTop: "1rem" }}>
  Special days
</label>

<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
  {form.opening_hours.special_days.map((sd, idx) => (
    <div
      key={idx}
      style={{
        border: "1.5px solid #E0E0E0",
        borderRadius: 12,
        padding: "0.75rem",
        display: "grid",
        gridTemplateColumns: "1.2fr auto 1fr 1fr auto",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      <input
        type="date"
        value={sd.date}
        onChange={(e) => {
          const next = [...form.opening_hours.special_days];
          next[idx].date = e.target.value;

          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days: next,
            },
          }));
        }}
        style={inputStyle}
      />

      <label>
        <input
          type="checkbox"
          checked={sd.closed}
          onChange={(e) => {
            const next = [...form.opening_hours.special_days];
            next[idx].closed = e.target.checked;

            setForm((f) => ({
              ...f,
              opening_hours: {
                ...f.opening_hours,
                special_days: next,
              },
            }));
          }}
        />
        {" "}Closed
      </label>

      <input
        type="time"
        disabled={sd.closed}
        value={sd.open ?? ""}
        onChange={(e) => {
          const next = [...form.opening_hours.special_days];
          next[idx].open = e.target.value;

          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days: next,
            },
          }));
        }}
        style={inputStyle}
      />

      <input
        type="time"
        disabled={sd.closed}
        value={sd.close ?? ""}
        onChange={(e) => {
          const next = [...form.opening_hours.special_days];
          next[idx].close = e.target.value;

          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days: next,
            },
          }));
        }}
        style={inputStyle}
      />

      <button
        type="button"
        onClick={() =>
          setForm((f) => ({
            ...f,
            opening_hours: {
              ...f.opening_hours,
              special_days:
                f.opening_hours.special_days.filter(
                  (_, i) => i !== idx
                ),
            },
          }))
        }
        style={{
          border: "none",
          background: "#FCEBEB",
          color: "#A32D2D",
          borderRadius: 8,
          padding: "0.5rem",
          cursor: "pointer",
        }}
      >
        Remove
      </button>
    </div>
  ))}

  <button
    type="button"
    onClick={() =>
      setForm((f) => ({
        ...f,
        opening_hours: {
          ...f.opening_hours,
          special_days: [
            ...f.opening_hours.special_days,
            {
              date: "",
              closed: true,
              open: "",
              close: "",
            },
          ],
        },
      }))
    }
    style={{
      padding: "0.75rem",
      borderRadius: 12,
      border: "1.5px dashed rgba(155,127,184,0.3)",
      background: "#fafaf8",
      cursor: "pointer",
      color: "var(--plum)",
    }}
  >
    + Add special day
  </button>
</div>
 
      {/* Instagram — FREE */}
      <label style={labelStyle}>
        Instagram username
        <span style={{ marginLeft: 8, background: "#E1F5EE", color: "#0F6E56", borderRadius: 100, padding: "1px 8px", fontSize: "0.72rem", fontWeight: 600 }}>FREE</span>
      </label>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "#C13584", fontSize: "0.9rem", pointerEvents: "none" }}>@</span>
        <input value={form.instagram_username}
          onChange={e => setForm(f => ({ ...f, instagram_username: e.target.value.replace(/^@/, "") }))}
          placeholder="yourstorehandle" style={{ ...inputStyle, paddingLeft: "2rem" }} />
      </div>
      <p style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
        Your latest Instagram posts will appear on your store page automatically — free of charge.
      </p>
 
      {/* YouTube */}
      <label style={labelStyle}>YouTube video URL</label>
      <input type="url" value={form.youtube_url}
        onChange={e => setForm(f => ({ ...f, youtube_url: e.target.value }))}
        placeholder="https://youtube.com/watch?v=..." style={inputStyle} />
      <p style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
        Paste any YouTube video URL — it will be embedded on your store page.
      </p>
 
      {/* Gallery — R5 per image */}
      <label style={labelStyle}>
        Gallery photos
        <span style={{ marginLeft: 8, background: "#FAEEDA", color: "#854F0B", borderRadius: 100, padding: "1px 8px", fontSize: "0.72rem", fontWeight: 600 }}>R5 each</span>
      </label>
      <div style={{ background: "#FFFBF0", border: "1.5px solid #F5D99A", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "0.75rem", fontSize: "0.82rem", color: "#6B4C00" }}>
        💡 <strong>Tip:</strong> Connect your Instagram above — it&apos;s free and keeps your gallery fresh automatically. Direct photo uploads are charged at <strong>R5 per image</strong> to manage storage costs.
      </div>
 
      {chargeableCount > 0 && (
        <div style={{ background: "#E6F1FB", border: "1.5px solid #B3D4F5", borderRadius: 12, padding: "0.65rem 1rem", marginBottom: "0.75rem", fontSize: "0.82rem", color: "#185FA5" }}>
          You are adding <strong>{chargeableCount}</strong> image{chargeableCount !== 1 ? "s" : ""} — a charge of <strong>R{chargeableCount * 5}</strong> will be logged. Our team will process the payment separately.
        </div>
      )}
 
      <button type="button"
        onClick={() => document.getElementById(`gallery-input-${form.id ?? "new"}`)?.click()}
        style={{ padding: "0.65rem 1.25rem", borderRadius: 12, border: "1.5px dashed rgba(155,127,184,0.4)", background: "#fafaf8", fontSize: "0.85rem", color: "var(--plum)", cursor: "pointer", width: "100%" }}>
        + Add photos (R5 each)
      </button>
      <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "0.25rem" }}>{gallery.length} new · {form.gallery_urls.length} existing</p>
      <input id={`gallery-input-${form.id ?? "new"}`} type="file" accept="image/*" multiple
        style={{ display: "none" }} onChange={handleFileChange} />
      {galleryError && <p style={{ color: "#E53935", fontSize: "0.8rem", marginTop: "0.35rem" }}>{galleryError}</p>}
 
      {/* Previews */}
      {gallery.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: "0.75rem" }}>
          {gallery.map((g, i) => (
            <div key={i} style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => setGallery(prev => prev.filter((_, idx) => idx !== i))}
                style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", borderRadius: "50%", width: 20, height: 20, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
          ))}
        </div>
      )}
 
      {form.gallery_urls.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <p style={{ fontSize: "0.75rem", color: "var(--grey)", marginBottom: 4 }}>Existing photos:</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
            {form.gallery_urls.map((url, i) => (
              <div key={i} style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button onClick={() => setForm(f => ({ ...f, gallery_urls: f.gallery_urls.filter((_, idx) => idx !== i) }))}
                  style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", borderRadius: "50%", width: 20, height: 20, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
 
      {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginTop: "0.75rem" }}>{error}</p>}
 
      <div style={{ display: "flex", gap: 10, marginTop: "1.25rem" }}>
        {onCancel && (
          <button onClick={onCancel} style={{ flex: 1, padding: "0.75rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--grey)", fontSize: "0.9rem", cursor: "pointer" }}>
            Cancel
          </button>
        )}
        <button onClick={handleSubmit} disabled={saving} className="btn-plum" style={{ flex: 2, padding: "0.75rem", borderRadius: 100, fontSize: "0.9rem", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Submit for review"}
        </button>
      </div>
      {!isEdit && (
        <p style={{ fontSize: "0.75rem", color: "#bbb", textAlign: "center", marginTop: "0.75rem" }}>
          Your listing will be reviewed before going live (usually within 24 hours).
        </p>
      )}
    </div>
  );
}
 
// ── Booking inbox for salon owners ────────────────────────────────────────────
 
function SalonBookingsInbox({ salonId }: { salonId: string }) {
  const supabase = createClient();
  const [bookings, setBookings] = useState<StoreBooking[]>([]);
  const [loading, setLoading] = useState(true);
 
  useEffect(() => {
    supabase
      .from("store_bookings")
      .select("*, employee:branch_employees(name)")
      .eq("salon_id", salonId)
      .order("booking_date", { ascending: true })
      .then(({ data }) => {
        setBookings((data as StoreBooking[]) ?? []);
        setLoading(false);
      });
  }, [salonId]);
 
  const updateStatus = async (id: string, status: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/store-bookings/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return;
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
  };
 
  const statusColors: Record<string, { bg: string; color: string }> = {
    pending:   { bg: "#FAEEDA", color: "#854F0B" },
    confirmed: { bg: "#E1F5EE", color: "#0F6E56" },
    completed: { bg: "#E6F1FB", color: "#185FA5" },
    cancelled: { bg: "#FCEBEB", color: "#A32D2D" },
  };
 
  if (loading) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading bookings…</p>;
  if (!bookings.length) return (
    <div style={{ textAlign: "center", padding: "2rem", color: "var(--grey)" }}>
      <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>No bookings yet.</p>
      <p style={{ fontSize: "0.85rem" }}>When clients book via your store page, requests appear here.</p>
    </div>
  );
 
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {bookings.map(b => {
        const sc = statusColors[b.status] ?? statusColors.pending;
        return (
          <div key={b.id} style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1rem 1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>{b.client_name}</p>
                <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: "2px 0 0" }}>
                  {b.booking_date} at {b.booking_time} · <span style={{ textTransform: "capitalize" }}>{b.service}</span>
                  {b.employee?.name && <> · with <strong>{b.employee.name}</strong></>}
                </p>
              </div>
              <span style={{ background: sc.bg, color: sc.color, borderRadius: 100, padding: "0.2rem 0.7rem", fontSize: "0.72rem", fontWeight: 600, textTransform: "capitalize", whiteSpace: "nowrap" }}>
                {b.status}
              </span>
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: "0 0 0.65rem" }}>
              📞 <a href={`tel:${b.client_phone}`} style={{ color: "var(--plum)" }}>{b.client_phone}</a>
              {" · "}
              <a href={`https://wa.me/${b.client_phone.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#25D366" }}>WhatsApp</a>
            </p>
            {b.notes && <p style={{ fontSize: "0.82rem", color: "#666", fontStyle: "italic", margin: "0 0 0.65rem" }}>&quot;{b.notes}&quot;</p>}
            {b.status === "pending" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => updateStatus(b.id, "confirmed")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#E1F5EE", color: "#0F6E56", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Confirm
                </button>
                <button onClick={() => updateStatus(b.id, "cancelled")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#FCEBEB", color: "#A32D2D", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            )}
            {b.status === "confirmed" && (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => updateStatus(b.id, "completed")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#E6F1FB", color: "#185FA5", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Mark completed
                </button>
                <button onClick={() => updateStatus(b.id, "no_show")}
                  style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#FCEBEB", color: "#A32D2D", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                  Customer no-show
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
 
// ── Branch staff management for salon owners ───────────────────────────────────
// One branch per salon today (see supabase/migrations/20260802_store_branches_foundation.sql)
// so this always resolves the is_primary branch — multi-branch owners will
// get a branch switcher here once that phase ships.

type BranchStaffMember = {
  id: string;
  branch_id: string;
  name: string;
  photo_url: string | null;
  bio: string | null;
  specialties: string[];
  is_active: boolean;
  display_order: number;
};

function BranchStaffManager({ salonId, salonServices }: { salonId: string; salonServices: string[] }) {
  const supabase = createClient();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [staff, setStaff] = useState<BranchStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BranchStaffMember | null>(null);

  useEffect(() => {
    (async () => {
      const { data: branch } = await supabase
        .from("store_branches").select("id").eq("salon_id", salonId).eq("is_primary", true).maybeSingle();
      if (!branch) { setLoading(false); return; }
      setBranchId(branch.id);
      const { data } = await supabase
        .from("branch_employees").select("*").eq("branch_id", branch.id).order("display_order", { ascending: true });
      setStaff((data as BranchStaffMember[]) ?? []);
      setLoading(false);
    })();
  }, [salonId]);

  const handleSaved = (saved: BranchStaffMember) => {
    setStaff(prev => {
      const idx = prev.findIndex(s => s.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [...prev, saved];
    });
    setShowForm(false);
    setEditing(null);
  };

  const toggleActive = async (member: BranchStaffMember) => {
    const { data } = await supabase
      .from("branch_employees").update({ is_active: !member.is_active }).eq("id", member.id).select().single();
    if (data) handleSaved(data as BranchStaffMember);
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this staff member? Past bookings that mention them are kept.")) return;
    await supabase.from("branch_employees").delete().eq("id", id);
    setStaff(prev => prev.filter(s => s.id !== id));
  };

  if (loading) return <p style={{ color: "var(--grey)" }}>Loading…</p>;

  if (!branchId) return <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Save your store listing first, then add staff here.</p>;

  if (showForm || editing) return (
    <StaffForm
      branchId={branchId}
      salonServices={salonServices}
      initial={editing}
      onSaved={handleSaved}
      onCancel={() => { setShowForm(false); setEditing(null); }}
    />
  );

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "1rem" }}>
        Add the people clients can pick when booking. Hidden staff stay off the booking form but keep their history.
      </p>

      {staff.length === 0 && (
        <p style={{ fontSize: "0.9rem", color: "var(--grey)", marginBottom: "1rem" }}>No staff added yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
        {staff.map(member => (
          <div key={member.id} style={{ display: "flex", alignItems: "center", gap: "0.85rem", background: "#fff", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.15)", padding: "0.85rem 1rem", opacity: member.is_active ? 1 : 0.55 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", background: "#f3eef7", flexShrink: 0 }}>
              {member.photo_url && <img src={member.photo_url} alt={member.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
                {member.name}{!member.is_active && <span style={{ color: "#999", fontWeight: 400 }}> · hidden</span>}
              </p>
              {member.specialties.length > 0 && (
                <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: "2px 0 0", textTransform: "capitalize" }}>{member.specialties.join(", ")}</p>
              )}
            </div>
            <button onClick={() => setEditing(member)} style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>Edit</button>
            <button onClick={() => toggleActive(member)} style={{ background: "none", border: "none", color: "var(--grey)", fontSize: "0.8rem", cursor: "pointer" }}>{member.is_active ? "Hide" : "Unhide"}</button>
            <button onClick={() => remove(member.id)} style={{ background: "none", border: "none", color: "#A32D2D", fontSize: "0.8rem", cursor: "pointer" }}>Remove</button>
          </div>
        ))}
      </div>

      <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.6rem 1.5rem", borderRadius: 100, fontWeight: 600, fontSize: "0.85rem" }}>
        + Add staff member
      </button>
    </div>
  );
}

function StaffForm({ branchId, salonServices, initial, onSaved, onCancel }: {
  branchId: string;
  salonServices: string[];
  initial: BranchStaffMember | null;
  onSaved: (m: BranchStaffMember) => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [specialties, setSpecialties] = useState<string[]>(initial?.specialties ?? []);
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial?.photo_url ?? null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const services = salonServices.length ? salonServices : ALL_SERVICES;

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.75rem 1rem", borderRadius: 12,
    border: "1.5px solid #E0E0E0", fontSize: "0.9rem", outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.8rem", fontWeight: 600, color: "#888",
    display: "block", marginBottom: "0.3rem", marginTop: "0.85rem",
  };

  const toggleSpecialty = (s: string) => {
    setSpecialties(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  const save = async () => {
    setError("");
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    try {
      let finalPhotoUrl = initial?.photo_url ?? null;
      if (photoFile) {
        const ext = photoFile.name.split(".").pop();
        const path = `staff/${branchId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("salon-gallery").upload(path, photoFile, { upsert: false });
        if (uploadErr) throw uploadErr;
        finalPhotoUrl = supabase.storage.from("salon-gallery").getPublicUrl(path).data.publicUrl;
      }
      const payload = { branch_id: branchId, name: name.trim(), bio: bio.trim() || null, specialties, photo_url: finalPhotoUrl };
      let data, err;
      if (initial) {
        ({ data, error: err } = await supabase.from("branch_employees").update(payload).eq("id", initial.id).select().single());
      } else {
        ({ data, error: err } = await supabase.from("branch_employees").insert(payload).select().single());
      }
      if (err) throw err;
      onSaved(data as BranchStaffMember);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.1rem" }}>
        {initial ? "Edit staff member" : "Add staff member"}
      </h3>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", overflow: "hidden", background: "#f3eef7", flexShrink: 0 }}>
          {photoUrl && <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <label style={{ fontSize: "0.82rem", color: "var(--plum)", fontWeight: 600, cursor: "pointer" }}>
          {photoUrl ? "Change photo" : "Add photo (optional)"}
          <input type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: "none" }} />
        </label>
      </div>

      <label style={labelStyle}>Name *</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Xoli" style={inputStyle} />

      <label style={labelStyle}>Specialties</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {services.map(s => (
          <button key={s} type="button" onClick={() => toggleSpecialty(s)} style={{ padding: "0.4rem 1rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer", border: "1.5px solid", borderColor: specialties.includes(s) ? "var(--plum)" : "rgba(155,127,184,0.25)", background: specialties.includes(s) ? "var(--plum)" : "#fff", color: specialties.includes(s) ? "#fff" : "var(--grey)", fontWeight: specialties.includes(s) ? 600 : 400, textTransform: "capitalize" }}>{s}</button>
        ))}
      </div>
      <p style={{ fontSize: "0.75rem", color: "#aaa", margin: "0.4rem 0 0" }}>Leave blank to show them for every service.</p>

      <label style={labelStyle}>Short bio (optional)</label>
      <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2} placeholder="Specialises in balayage and curly cuts…" style={{ ...inputStyle, resize: "vertical" }} />

      {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginTop: "0.85rem" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: "1.1rem" }}>
        <button onClick={save} disabled={saving} className="btn-plum" style={{ padding: "0.7rem 1.75rem", borderRadius: 100, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} style={{ padding: "0.7rem 1.5rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", background: "#fff", cursor: "pointer", fontWeight: 500 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── ServiceManager ───────────────────────────────────────────────────────────
// Real, priced, individually-bookable services for a salon (see
// supabase/migrations/20260804_salon_services.sql) — separate from the
// coarse hair/nails/makeup/lashes category tags on the salon listing
// itself, which stay exactly as they were (stores-listing filters, staff
// specialty matching). A salon with zero rows here is unaffected: its
// public booking form just falls back to the old plain category picker,
// no price, no deposit — this screen is what turns the priced/deposit
// flow on, per service, once the owner adds one.

type SalonService = {
  id: string;
  salon_id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;                  // cents
  deposit_amount: number | null;  // cents — null = no deposit for this service
  is_active: boolean;
  display_order: number;
};

function ServiceManager({ salonId, salonCategories, ownerId }: { salonId: string; salonCategories: string[]; ownerId: string }) {
  const supabase = createClient();
  const [services, setServices] = useState<SalonService[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ id?: string; name: string; category: string; description: string; priceRand: string; depositRand: string; upsellProductIds: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const categories = salonCategories.length ? salonCategories : ALL_SERVICES;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("salon_services").select("*").eq("salon_id", salonId)
      .order("display_order", { ascending: true }).order("created_at", { ascending: true });
    setServices((data as SalonService[]) ?? []);
    setLoading(false);
  }, [salonId, supabase]);

  useEffect(() => { load(); }, [load]);

  const startAdd = () => { setError(""); setForm({ name: "", category: categories[0] ?? "hair", description: "", priceRand: "", depositRand: "", upsellProductIds: [] }); };
  const startEdit = async (s: SalonService) => {
    setError("");
    setForm({ id: s.id, name: s.name, category: s.category, description: s.description ?? "", priceRand: String(s.price / 100), depositRand: s.deposit_amount ? String(s.deposit_amount / 100) : "", upsellProductIds: [] });
    const ids = await loadServiceUpsellIds(supabase, "salon_service_upsell_products", "salon_service_id", s.id);
    setForm((f) => f && f.id === s.id ? { ...f, upsellProductIds: ids } : f);
  };

  const save = async () => {
    if (!form) return;
    const priceNum = parseFloat(form.priceRand);
    if (!form.name.trim()) { setError("Give the service a name."); return; }
    if (!Number.isFinite(priceNum) || priceNum <= 0) { setError("Enter a valid price."); return; }
    let depositCents: number | null = null;
    if (form.depositRand.trim()) {
      const depositNum = parseFloat(form.depositRand);
      if (!Number.isFinite(depositNum) || depositNum <= 0) { setError("Enter a valid deposit amount, or leave it blank for no deposit."); return; }
      if (depositNum < 35) { setError("Deposits must be at least R35 (or leave it blank for no deposit)."); return; }
      if (depositNum > priceNum) { setError("The deposit can't be more than the price."); return; }
      depositCents = Math.round(depositNum * 100);
    }
    setSaving(true); setError("");
    const payload = {
      salon_id: salonId,
      category: form.category,
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Math.round(priceNum * 100),
      deposit_amount: depositCents,
    };
    const { data: saved, error: err } = form.id
      ? await supabase.from("salon_services").update(payload).eq("id", form.id).select("id").single()
      : await supabase.from("salon_services").insert({ ...payload, is_active: true }).select("id").single();
    if (err || !saved) { setSaving(false); setError(err?.message ?? "Failed to save"); return; }
    await syncServiceUpsells(supabase, "salon_service_upsell_products", "salon_service_id", saved.id, form.upsellProductIds);
    setSaving(false);
    setForm(null);
    await load();
  };

  const toggleActive = async (s: SalonService) => {
    await supabase.from("salon_services").update({ is_active: !s.is_active }).eq("id", s.id);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this service? Customers won't be able to book it anymore.")) return;
    await supabase.from("salon_services").delete().eq("id", id);
    await load();
  };

  if (loading) return <p style={{ color: "var(--grey)" }}>Loading…</p>;

  if (form) return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.1rem" }}>
        {form.id ? "Edit service" : "Add a service"}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.9rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Service name *</label>
          <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))} placeholder="e.g. Ladies cut & blow wave" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Category</label>
          <select value={form.category} onChange={e => setForm(f => f && ({ ...f, category: e.target.value }))} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", textTransform: "capitalize" }}>
            {categories.map(c => <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Price (ZAR) *</label>
          <input type="number" min="0" step="1" value={form.priceRand} onChange={e => setForm(f => f && ({ ...f, priceRand: e.target.value }))} placeholder="150" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Deposit (ZAR, optional — R35 minimum if set)</label>
          <input type="number" min="35" step="1" value={form.depositRand} onChange={e => setForm(f => f && ({ ...f, depositRand: e.target.value }))} placeholder="Leave blank for no deposit" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
        </div>
      </div>

      <div style={{ marginBottom: "0.9rem" }}>
        <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Description (optional)</label>
        <textarea value={form.description} onChange={e => setForm(f => f && ({ ...f, description: e.target.value }))} rows={2} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", resize: "vertical" }} />
      </div>

      <UpsellProductPicker
        ownerId={ownerId}
        serviceTags={(UPSELL_TAG_GROUPS.find(g => g.category === form.category)?.tags ?? []).map(t => t.id)}
        selectedProductIds={form.upsellProductIds}
        onChange={(ids) => setForm(f => f && ({ ...f, upsellProductIds: ids }))}
        supabase={supabase}
      />

      {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginBottom: "0.9rem" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} disabled={saving} className="btn-plum" style={{ padding: "0.7rem 1.75rem", borderRadius: 100, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={() => { setForm(null); setError(""); }} style={{ padding: "0.7rem 1.5rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", background: "#fff", cursor: "pointer", fontWeight: 500 }}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "1rem" }}>
        Add the services clients can actually book and pay for — each with its own price, and an optional deposit to secure the booking upfront.
      </p>

      {services.length === 0 && (
        <p style={{ fontSize: "0.9rem", color: "var(--grey)", marginBottom: "1rem" }}>
          No priced services yet — until you add one, the booking form shows your service categories with no price or deposit, same as before.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.25rem" }}>
        {services.map(s => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.9rem 1.1rem", borderRadius: 12, border: "1.5px solid rgba(155,127,184,0.12)", background: "#fff", opacity: s.is_active ? 1 : 0.55 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{s.name}</p>
              <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--grey)", textTransform: "capitalize" }}>
                {fmt(s.price)}{s.deposit_amount ? ` · ${fmt(s.deposit_amount)} deposit` : ""} · {s.category}{!s.is_active ? " · Hidden" : ""}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
              <button type="button" onClick={() => toggleActive(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>
                {s.is_active ? "Hide" : "Unhide"}
              </button>
              <button type="button" onClick={() => startEdit(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>Edit</button>
              <button type="button" onClick={() => remove(s.id)} style={{ background: "none", border: "1.5px solid rgba(229,57,53,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "#E53935", cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={startAdd} className="btn-plum" style={{ padding: "0.6rem 1.5rem", borderRadius: 100, fontWeight: 600, fontSize: "0.85rem" }}>
        + Add a service
      </button>
    </div>
  );
}

// ── MySalonTab ────────────────────────────────────────────────────────────────
// This replaces the MySalonTab function in your dashboard/page.tsx
 
function MySalonTab({ user }: { user: { id: string } }) {
  const supabase = createClient();
  const [listings, setListings] = useState<SalonListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SalonListing | null>(null);
  const [innerTab, setInnerTab] = useState<"listing" | "staff" | "bookings">("listing");
 
  useEffect(() => {
    supabase
      .from("partner_salons")
      .select("*")
      .eq("partner_id", user.id)
      .then(({ data }) => {
        if (data) {
  const converted = (data as SalonListing[]).map((salon) => {
    const oh = salon.opening_hours as any;

    if (oh?.weekly) {
      return salon;
    }

    const days = oh?.days ?? [];

    const buildDay = (name: string): DayHours => ({
      closed: !days.includes(name),
      open: oh?.open ?? "08:00",
      close: oh?.close ?? "17:00",
    });

    return {
      ...salon,
      opening_hours: {
        weekly: {
          sunday: buildDay("Sunday"),
          monday: buildDay("Monday"),
          tuesday: buildDay("Tuesday"),
          wednesday: buildDay("Wednesday"),
          thursday: buildDay("Thursday"),
          friday: buildDay("Friday"),
          saturday: buildDay("Saturday"),
        },

        public_holidays: {
          closed: true,
          open: "",
          close: "",
        },

        special_days: [],
      },
    };
  });

  setListings(converted);
}
        setLoading(false);
      });
  }, [user.id]);
 
  const handleSaved = (saved: SalonListing) => {
    setListings(prev => {
      const idx = prev.findIndex(l => l.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [...prev, saved];
    });
    setShowForm(false);
    setEditing(null);
  };
 
  const statusMeta: Record<string, { bg: string; color: string; label: string; desc: string }> = {
    pending:  { bg: "#FAEEDA", color: "#854F0B", label: "Under review",  desc: "We'll review your listing within 24 hours." },
    approved: { bg: "#E1F5EE", color: "#0F6E56", label: "Live",          desc: "Your store is visible in Stores and can receive bookings." },
    rejected: { bg: "#FCEBEB", color: "#A32D2D", label: "Not approved",  desc: "Please edit your listing and resubmit." },
  };

  // CSV store import is now server-side. Keep this UI thin: the backend owns
  // validation, partner ownership and insertion. No auto-reload here —
  // StoreCsvImport shows a "pay to activate" prompt after a successful
  // import (bulk cliff-tier pricing, lib/salon-pricing.ts) and reloading
  // immediately would wipe that out before the partner can pay. The list
  // picks up the new (still pending-review, pending-payment) rows next time
  // this page loads, e.g. when they return from Ozow.
  const storeCsvImporter = (
    <div style={{ marginBottom: "1.25rem" }}>
      <StoreCsvImport />
    </div>
  );
 
  if (loading) return <p style={{ color: "var(--grey)" }}>Loading…</p>;
 
  // ── Add form (no existing listing) ──
  if (listings.length === 0 && (showForm || true)) {
    if (showForm) return (
      <SalonForm initial={emptySalon()} userId={user.id} onSaved={handleSaved}
        onCancel={() => setShowForm(false)} isEdit={false} />
    );
    return (
      <div>
        {storeCsvImporter}
        <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "2rem", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", marginBottom: "0.5rem" }}>List your store on Umuhle</p>
        <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
          Appear in the Stores page and receive appointment bookings directly.
        </p>
          <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.75rem 2rem", borderRadius: 100, fontWeight: 600 }}>
            Add your store
          </button>
        </div>
      </div>
    );
  }
 
  // ── Existing listing view ──
  const listing = listings[0];
  const sm = statusMeta[listing.status ?? "pending"] ?? statusMeta.pending;
 
  if (editing) {
    return (
      <SalonForm initial={editing} userId={user.id} onSaved={handleSaved}
        onCancel={() => setEditing(null)} isEdit />
    );
  }
 
  return (
    <div>
      {storeCsvImporter}
      {/* Status banner */}
      <div style={{ background: sm.bg, color: sm.color, borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontWeight: 700, margin: 0, fontSize: "0.9rem" }}>{sm.label}</p>
          <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.9 }}>{sm.desc}</p>
        </div>
        <button onClick={() => setEditing(listing)} style={{ background: "rgba(255,255,255,0.7)", border: "none", borderRadius: 100, padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", color: sm.color }}>
          Edit
        </button>
      </div>
 
      {/* Inner tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: "1.25rem", borderRadius: 100, overflow: "hidden", border: "1.5px solid rgba(155,127,184,0.2)", width: "fit-content" }}>
        {(["listing","staff","bookings"] as const).map((t, i, arr) => (
          <button key={t} onClick={() => setInnerTab(t)} style={{
            padding: "0.5rem 1.25rem", border: "none", cursor: "pointer", fontSize: "0.85rem",
            background: innerTab === t ? "var(--plum)" : "#fff",
            color: innerTab === t ? "#fff" : "var(--grey)",
            fontWeight: innerTab === t ? 600 : 400,
            borderRight: i < arr.length - 1 ? "1.5px solid rgba(155,127,184,0.2)" : "none",
          }}>
            {t === "listing" ? "Listing" : t === "staff" ? "Staff" : "Bookings"}
          </button>
        ))}
      </div>
 
      {innerTab === "listing" && (
        <>
        <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0.75rem" }}>{listing.name}</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "0.5rem" }}>
            📍 {listing.address}, {listing.suburb}{listing.postal_code ? `, ${listing.postal_code}` : ""}
          </p>
          {listing.services?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {listing.services.map(s => (
                <span key={s} style={{ padding: "0.25rem 0.75rem", borderRadius: 100, border: "1px solid rgba(155,127,184,0.3)", fontSize: "0.75rem", color: "var(--plum)", textTransform: "capitalize" }}>{s}</span>
              ))}
            </div>
          )}
          {listing.instagram_username && (
            <p style={{ fontSize: "0.82rem", color: "#C13584", marginBottom: "0.35rem" }}>
              📸 @{listing.instagram_username} <span style={{ background: "#E1F5EE", color: "#0F6E56", borderRadius: 100, padding: "1px 6px", fontSize: "0.7rem", fontWeight: 600, marginLeft: 4 }}>free feed</span>
            </p>
          )}
          {listing.youtube_url && (
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", marginBottom: "0.35rem" }}>▶ YouTube video linked</p>
          )}
          <p style={{ fontSize: "0.78rem", color: "#bbb", marginTop: "0.75rem" }}>
            {listing.gallery_urls?.length ?? 0} photos uploaded
          </p>
          {listing.status === "approved" && (
            <a href={`/stores/${listing.id}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-block", marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--plum)", fontWeight: 500 }}>
              View live page →
            </a>
          )}
        </div>

        {listing.id && (
          <div style={{ marginTop: "1.5rem" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0.75rem" }}>Services</h3>
            <ServiceManager salonId={listing.id} salonCategories={listing.services ?? []} ownerId={user.id} />
          </div>
        )}
        </>
      )}

      {innerTab === "staff" && listing.id && (
        <BranchStaffManager salonId={listing.id} salonServices={listing.services ?? []} />
      )}

      {innerTab === "bookings" && listing.id && (
        <SalonBookingsInbox salonId={listing.id} />
      )}
    </div>
  );
}

// ─── My Services tab ───────────────────────────────────────────────────────────
// Each service category has a repeater for style + price pairs. Saving here
// writes both to artist_service_styles (search tags) and services (the
// priced, bookable rows the frontend booking widget actually reads) in one
// step — price is captured at the moment a service is added, not after.
type StyleEntry = { style: string; priceRand: string; tags: string[] };
type ServiceStyles = Record<ServiceTypeId, StyleEntry[]>;

type ArtistService = {
  id: string;
  name: string;
  description: string | null;
  price: number; // cents
  duration_minutes: number;
  category: ServiceTypeId | null;
  tags: string[];
  is_active: boolean;
};

type ServiceFormState = {
  id: string | null; // null = creating new
  name: string;
  description: string;
  priceRand: string; // controlled input, e.g. "350"
  duration_minutes: number;
  category: ServiceTypeId | "";
  tags: string[];
  upsellProductIds: string[]; // see components/UpsellProductPicker.tsx
};

const EMPTY_SERVICE_FORM: ServiceFormState = { id: null, name: "", description: "", priceRand: "", duration_minutes: 60, category: "", tags: [], upsellProductIds: [] };

// Lets an artist create the actual bookable, priced line items clients pay
// for — distinct from the style tags above, which are just search/discovery
// metadata. Reads/writes app/dashboard's `services` table directly (RLS
// already scopes writes to `artist_id IN (artists owned by auth.uid())`).
function PricedServicesManager({ user, categories, refreshSignal }: { user: User; categories: ServiceTypeId[]; refreshSignal?: number }) {
  const supabase = createClient();
  const [artistId, setArtistId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ArtistService[]>([]);
  const [form, setForm] = useState<ServiceFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadServices = useCallback(async (aid: string) => {
    const { data } = await supabase
      .from("services")
      .select("id, name, description, price, duration_minutes, category, tags, is_active")
      .eq("artist_id", aid)
      .order("name");
    setServices((data ?? []) as ArtistService[]);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("artists").select("id").eq("profile_id", user.id).maybeSingle();
      if (cancelled) return;
      if (data?.id) {
        setArtistId(data.id);
        await loadServices(data.id);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user.id, supabase, loadServices, refreshSignal]);

  const startAdd = () => { setError(""); setForm({ ...EMPTY_SERVICE_FORM, category: categories[0] ?? "" }); };
  const startEdit = async (s: ArtistService) => {
    setError("");
    setForm({ id: s.id, name: s.name, description: s.description ?? "", priceRand: String(s.price / 100), duration_minutes: s.duration_minutes, category: s.category ?? "", tags: s.tags ?? [], upsellProductIds: [] });
    const ids = await loadServiceUpsellIds(supabase, "service_upsell_products", "service_id", s.id);
    setForm((f) => f && f.id === s.id ? { ...f, upsellProductIds: ids } : f);
  };

  const handleSaveForm = async () => {
    if (!artistId || !form) return;
    const priceNum = parseFloat(form.priceRand);
    if (!form.name.trim()) { setError("Give the service a name."); return; }
    if (!Number.isFinite(priceNum) || priceNum < 35) { setError("Price must be at least R35."); return; }
    if (!form.duration_minutes || form.duration_minutes <= 0) { setError("Enter a valid duration."); return; }

    setSaving(true); setError("");
    const payload = {
      artist_id: artistId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Math.round(priceNum * 100),
      duration_minutes: form.duration_minutes,
      category: form.category || null,
      tags: form.tags,
    };
    const { data: saved, error: err } = form.id
      ? await supabase.from("services").update(payload).eq("id", form.id).select("id").single()
      : await supabase.from("services").insert({ ...payload, is_active: true }).select("id").single();
    if (err || !saved) { setSaving(false); setError(err?.message ?? "Failed to save"); return; }
    await syncServiceUpsells(supabase, "service_upsell_products", "service_id", saved.id, form.upsellProductIds);
    setSaving(false);
    setForm(null);
    await loadServices(artistId);
  };

  const handleDelete = async (id: string) => {
    if (!artistId) return;
    if (!confirm("Remove this service? Clients will no longer be able to book it.")) return;
    await supabase.from("services").delete().eq("id", id);
    await loadServices(artistId);
  };

  const handleToggleActive = async (s: ArtistService) => {
    if (!artistId) return;
    await supabase.from("services").update({ is_active: !s.is_active }).eq("id", s.id);
    await loadServices(artistId);
  };

  if (loading) return null;

  if (!artistId) {
    return (
      <div style={{ marginTop: "2.5rem", padding: "1rem 1.25rem", borderRadius: 14, background: "var(--plum-t)", color: "var(--plum)", fontSize: "0.85rem" }}>
        Save your service categories above first — then you can add priced services clients can book and pay for.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "2.5rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Manage your services</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Fine-tune duration or description for a service, hide one temporarily, or add an extra (like a bundle or package) that isn&apos;t tied to a style tag above.
      </p>

      {services.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.25rem" }}>
          {services.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.9rem 1.1rem", borderRadius: 12, border: "1.5px solid rgba(155,127,184,0.12)", background: "#fff", opacity: s.is_active ? 1 : 0.55 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{s.name}</p>
                <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--grey)" }}>
                  {fmt(s.price)} · {s.duration_minutes} min{s.category ? ` · ${s.category}` : ""}{!s.is_active ? " · Hidden" : ""}
                </p>
                {s.tags?.length > 0 && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.72rem", color: "var(--plum)" }}>
                    Suggests: {s.tags.map(upsellTagLabel).join(", ")}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button type="button" onClick={() => handleToggleActive(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>
                  {s.is_active ? "Hide" : "Unhide"}
                </button>
                <button type="button" onClick={() => startEdit(s)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "var(--grey)", cursor: "pointer" }}>Edit</button>
                <button type="button" onClick={() => handleDelete(s.id)} style={{ background: "none", border: "1.5px solid rgba(229,57,53,0.3)", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.75rem", color: "#E53935", cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form ? (
        <div style={{ padding: "1.1rem 1.25rem", borderRadius: 14, border: "1.5px solid var(--plum)", background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Service name</label>
              <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))} placeholder="e.g. Silk press & trim" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Category</label>
              <select value={form.category} onChange={e => setForm(f => f && ({ ...f, category: e.target.value as ServiceTypeId }))} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }}>
                {categories.map(c => <option key={c} value={c}>{SERVICE_TYPES.find(t => t.id === c)?.label ?? c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Price (ZAR, R35 minimum)</label>
              <input type="number" min="35" step="1" value={form.priceRand} onChange={e => setForm(f => f && ({ ...f, priceRand: e.target.value }))} placeholder="350" style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Duration</label>
              <select value={form.duration_minutes} onChange={e => setForm(f => f && ({ ...f, duration_minutes: parseInt(e.target.value, 10) }))} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem" }}>
                {Array.from(new Set([15, 30, 45, 60, 90, 120, 150, 180, 240, form.duration_minutes])).sort((a, b) => a - b).map(m => (
                  <option key={m} value={m}>{m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ""}`}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Description (optional)</label>
            <textarea value={form.description} onChange={e => setForm(f => f && ({ ...f, description: e.target.value }))} rows={2} style={{ width: "100%", padding: "0.55rem 0.8rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.3rem" }}>Style tags (optional)</label>
            <p style={{ fontSize: "0.75rem", color: "var(--grey)", marginBottom: "0.4rem" }}>
              Used to suggest related products from any seller at booking time — separate from the specific products you pick below.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {[
                ...(UPSELL_TAG_GROUPS.find(g => g.category === form.category)?.tags ?? []),
                ...(UPSELL_TAG_GROUPS.find(g => g.category === "general")?.tags ?? []),
              ].map(t => {
                const on = form.tags.includes(t.id);
                return (
                  <button
                    key={t.id} type="button"
                    onClick={() => setForm(f => f && ({ ...f, tags: on ? f.tags.filter(x => x !== t.id) : [...f.tags, t.id] }))}
                    style={{ borderRadius: 100, border: `1.5px solid ${on ? "var(--plum)" : "#E0E0E0"}`, background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)", padding: "0.2rem 0.65rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
                  >{t.label}</button>
                );
              })}
            </div>
          </div>
          <UpsellProductPicker
            ownerId={user.id}
            serviceTags={form.tags}
            selectedProductIds={form.upsellProductIds}
            onChange={(ids) => setForm(f => f && ({ ...f, upsellProductIds: ids }))}
            supabase={supabase}
          />
          {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button type="button" onClick={handleSaveForm} disabled={saving} className="btn-plum" style={{ padding: "0.55rem 1.4rem", fontSize: "0.85rem" }}>{saving ? "Saving…" : form.id ? "Save changes" : "Add service"}</button>
            <button type="button" onClick={() => setForm(null)} style={{ background: "none", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 8, padding: "0.55rem 1.2rem", fontSize: "0.85rem", color: "var(--grey)", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={startAdd} className="btn-outline" style={{ padding: "0.6rem 1.4rem", fontSize: "0.85rem" }}>+ Add a service</button>
      )}
    </div>
  );
}

function MyServicesTab({ profile, user, onUpdate }: { profile: Profile; user: User; onUpdate: (p: Profile) => void }) {
  const supabase = createClient();
  const [selected, setSelected] = useState<string[]>(profile.artist_category ? [profile.artist_category] : []);
  const [styles, setStyles] = useState<ServiceStyles>({ hair: [], nails: [], makeup: [], lashes: [] });
  const [styleInputs, setStyleInputs] = useState<Record<ServiceTypeId, StyleEntry>>({
    hair: { style: "", priceRand: "", tags: [] }, nails: { style: "", priceRand: "", tags: [] }, makeup: { style: "", priceRand: "", tags: [] }, lashes: { style: "", priceRand: "", tags: [] },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadingStyles, setLoadingStyles] = useState(true);
  const [servicesSyncedAt, setServicesSyncedAt] = useState(0);

  // Load existing style tags, then best-effort match each one against an
  // existing priced `services` row (by name + category) so a price/tags
  // already set don't get wiped out or shown blank on reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: styleRows } = await supabase
        .from("artist_service_styles")
        .select("category, style")
        .eq("user_id", user.id);

      const { data: artistRow } = await supabase.from("artists").select("id").eq("profile_id", user.id).maybeSingle();
      let svcByKey = new Map<string, { price: number; tags: string[] }>();
      if (artistRow?.id) {
        const { data: svcRows } = await supabase.from("services").select("name, category, price, tags").eq("artist_id", artistRow.id);
        svcByKey = new Map((svcRows ?? []).map(r => [`${r.category}::${r.name.trim().toLowerCase()}`, { price: r.price as number, tags: (r.tags as string[] | null) ?? [] }]));
      }

      if (cancelled) return;
      if (styleRows) {
        const grouped: ServiceStyles = { hair: [], nails: [], makeup: [], lashes: [] };
        for (const row of styleRows as { category: ServiceTypeId; style: string }[]) {
          if (!grouped[row.category]) continue;
          const match = svcByKey.get(`${row.category}::${row.style.trim().toLowerCase()}`);
          grouped[row.category].push({ style: row.style, priceRand: match ? String(match.price / 100) : "", tags: match?.tags ?? [] });
        }
        setStyles(grouped);
      }
      setLoadingStyles(false);
    })();
    return () => { cancelled = true; };
  }, [user.id, supabase]);

  const toggle = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const addStyle = (cat: ServiceTypeId) => {
    const val = styleInputs[cat].style.trim();
    const priceRand = styleInputs[cat].priceRand;
    const tags = styleInputs[cat].tags;
    if (!val) return;
    if (!priceRand || !(parseFloat(priceRand) >= 35)) { setError(`"${val}" needs a price of at least R35.`); return; }
    if (styles[cat].some(e => e.style.toLowerCase() === val.toLowerCase())) { setStyleInputs(i => ({ ...i, [cat]: { style: "", priceRand: "", tags: [] } })); return; }
    setError("");
    setStyles(s => ({ ...s, [cat]: [...s[cat], { style: val, priceRand, tags }] }));
    setStyleInputs(i => ({ ...i, [cat]: { style: "", priceRand: "", tags: [] } }));
  };

  const removeStyle = (cat: ServiceTypeId, idx: number) => {
    setStyles(s => ({ ...s, [cat]: s[cat].filter((_, i) => i !== idx) }));
  };

  const updateStylePrice = (cat: ServiceTypeId, idx: number, priceRand: string) => {
    setStyles(s => ({ ...s, [cat]: s[cat].map((e, i) => i === idx ? { ...e, priceRand } : e) }));
  };

  const toggleEntryTag = (cat: ServiceTypeId, idx: number, tagId: string) => {
    setStyles(s => ({ ...s, [cat]: s[cat].map((e, i) => i === idx ? { ...e, tags: e.tags.includes(tagId) ? e.tags.filter(t => t !== tagId) : [...e.tags, tagId] } : e) }));
  };

  const toggleInputTag = (cat: ServiceTypeId, tagId: string) => {
    setStyleInputs(i => ({ ...i, [cat]: { ...i[cat], tags: i[cat].tags.includes(tagId) ? i[cat].tags.filter(t => t !== tagId) : [...i[cat].tags, tagId] } }));
  };

  // Relevant upsell tag options for a given service category — its own
  // group plus the cross-category "general" group (gift sets, tools).
  const tagOptionsFor = (cat: ServiceTypeId) => [
    ...(UPSELL_TAG_GROUPS.find(g => g.category === cat)?.tags ?? []),
    ...(UPSELL_TAG_GROUPS.find(g => g.category === "general")?.tags ?? []),
  ];

  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      // Every listed style needs a price of at least R35 before we save anything.
      for (const cat of selected as ServiceTypeId[]) {
        for (const entry of styles[cat]) {
          if (!entry.priceRand || !(parseFloat(entry.priceRand) >= 35)) {
            throw new Error(`"${entry.style}" needs a price of at least R35.`);
          }
        }
      }

      const primary = selected[0] ?? null;

      // Update profile category
      const { data, error: err } = await supabase
        .from("profiles")
        .update({ artist_category: primary as Profile["artist_category"], is_artist: primary !== null, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select()
        .single();
      if (err) throw err;

      // Upsert styles: delete existing, re-insert
      await supabase.from("artist_service_styles").delete().eq("user_id", user.id);
      const rows: { user_id: string; category: ServiceTypeId; style: string }[] = [];
      for (const cat of selected as ServiceTypeId[]) {
        for (const entry of styles[cat]) {
          rows.push({ user_id: user.id, category: cat, style: entry.style });
        }
      }
      if (rows.length > 0) {
        const { error: insertErr } = await supabase.from("artist_service_styles").insert(rows);
        if (insertErr) throw insertErr;
      }

      // Keep the public "artists" listing row in sync — this is what the
      // homepage and search actually read from, separate from `profiles`.
      let artistId: string | null = null;
      if (primary) {
        const { data: artistRow, error: artistErr } = await supabase
          .from("artists")
          .upsert(
            {
              profile_id: user.id,
              display_name: profile.full_name,
              category: primary,
              avatar_url: profile.avatar_url,
              is_active: true,
            },
            { onConflict: "profile_id" }
          )
          .select("id")
          .single();
        if (artistErr) throw artistErr;
        artistId = artistRow?.id ?? null;
      } else {
        // No category selected — hide any existing listing rather than deleting it
        await supabase.from("artists").update({ is_active: false }).eq("profile_id", user.id);
      }

      // Sync the priced, bookable `services` rows the frontend booking
      // widget actually reads — this is the step that used to be missing,
      // leaving style tags with no corresponding bookable/priced entry.
      if (artistId) {
        const { data: existing } = await supabase
          .from("services")
          .select("id, name, category")
          .eq("artist_id", artistId);
        const existingByKey = new Map((existing ?? []).map(r => [`${r.category}::${(r.name as string).trim().toLowerCase()}`, r.id as string]));
        const matchedIds = new Set<string>();

        for (const cat of selected as ServiceTypeId[]) {
          for (const entry of styles[cat]) {
            const name = entry.style.trim();
            const price = Math.round(parseFloat(entry.priceRand) * 100);
            const key = `${cat}::${name.toLowerCase()}`;
            const existingId = existingByKey.get(key);
            if (existingId) {
              matchedIds.add(existingId);
              await supabase.from("services").update({ price, is_active: true, category: cat, tags: entry.tags }).eq("id", existingId);
            } else {
              await supabase.from("services").insert({ artist_id: artistId, name, price, duration_minutes: 60, category: cat, tags: entry.tags, is_active: true });
            }
          }
        }

        // Anything that existed before but wasn't in this save (style
        // removed/renamed) gets hidden rather than deleted, since a
        // booking may already reference it.
        const toHide = (existing ?? []).map(r => r.id as string).filter(id => !matchedIds.has(id));
        if (toHide.length > 0) {
          await supabase.from("services").update({ is_active: false }).in("id", toHide);
        }
        setServicesSyncedAt(Date.now());
      }

      if (data) { onUpdate(data as Profile); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  if (loadingStyles) return <div style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>My Services</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Select the beauty services you offer and list the styles you specialise in, each with its own price. Clients search by style and book directly at the price you set here.
      </p>

      {/* 4 category sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {SERVICE_TYPES.map(s => {
          const active = selected.includes(s.id);
          return (
            <div key={s.id} style={{ borderRadius: 20, overflow: "hidden", border: `2px solid ${active ? "var(--plum)" : "rgba(155,127,184,0.12)"}`, background: "#fff", boxShadow: active ? "0 8px 30px rgba(155,127,184,0.18)" : "0 4px 20px rgba(0,0,0,0.04)", transition: "all 0.2s ease" }}>
              {/* Banner */}
              <div className="service-banner" style={{ backgroundImage: `url(${s.banner})`, }}>
                <div className="service-banner-content">
                  <h2 className="service-banner-title">
                    {s.label}
                  </h2>

                  <p className="service-banner-subtitle">
                    {s.id === "hair" && "Styles that celebrate you."}
                    {s.id === "nails" && "Beautiful nails. Every detail."}
                    {s.id === "makeup" && "Enhance your beauty. Express your glow."}
                    {s.id === "lashes" && "Lashes that lift. Confidence that lasts."}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: "1.25rem 1.5rem", background: "#fff" }}>
                {/* Toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                  <p style={{ fontSize: "0.85rem", color: "var(--grey)", margin: 0, maxWidth: 420, lineHeight: 1.5 }}>{s.description}</p>
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    style={{
                      flexShrink: 0, marginLeft: "1rem",
                      borderRadius: 100, border: `1.5px solid ${active ? "var(--plum)" : "rgba(155,127,184,0.3)"}`,
                      background: active ? "var(--plum)" : "#fff",
                      color: active ? "#fff" : "var(--grey)",
                      padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s",
                    }}
                  >
                    {active ? "Selected ✓" : "Select"}
                  </button>
                </div>

                {/* Styles repeater — shown when selected */}
                {active && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {s.label} styles you offer
                    </label>
                    {/* Tag list — each entry shows its price and upsell tags, editable inline */}
                    {styles[s.id].length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
                        {styles[s.id].map((entry, idx) => (
                          <div key={idx} style={{ background: "var(--plum-t)", borderRadius: 10, padding: "0.4rem 0.5rem 0.5rem 0.9rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: 500, color: "var(--plum)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.style}</span>
                              <span style={{ fontSize: "0.8rem", color: "var(--plum)", flexShrink: 0 }}>R</span>
                              <input
                                type="number" min="35" step="1" value={entry.priceRand}
                                onChange={e => updateStylePrice(s.id, idx, e.target.value)}
                                placeholder="price"
                                style={{ width: 70, flexShrink: 0, padding: "0.3rem 0.5rem", borderRadius: 8, border: !entry.priceRand ? "1.5px solid #E53935" : "1.5px solid rgba(155,127,184,0.3)", fontSize: "0.82rem" }}
                              />
                              <button
                                type="button"
                                onClick={() => removeStyle(s.id, idx)}
                                style={{ flexShrink: 0, background: "none", border: "none", color: "var(--plum)", cursor: "pointer", padding: "0.2rem", fontSize: "0.85rem", lineHeight: 1, display: "flex", alignItems: "center" }}
                                aria-label={`Remove ${entry.style}`}
                              >✕</button>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.4rem" }}>
                              {tagOptionsFor(s.id).map(t => {
                                const on = entry.tags.includes(t.id);
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => toggleEntryTag(s.id, idx, t.id)}
                                    style={{
                                      borderRadius: 100, border: `1.5px solid ${on ? "var(--plum)" : "rgba(155,127,184,0.3)"}`,
                                      background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)",
                                      padding: "0.15rem 0.6rem", fontSize: "0.72rem", fontWeight: 500, cursor: "pointer",
                                    }}
                                  >{t.label}</button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Add input — name + price together, so a service is never saved without a price */}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        value={styleInputs[s.id].style}
                        onChange={e => setStyleInputs(i => ({ ...i, [s.id]: { ...i[s.id], style: e.target.value } }))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStyle(s.id); } }}
                        placeholder={`e.g. ${s.id === "hair" ? "Dreadlocks" : s.id === "nails" ? "Gel extensions" : s.id === "makeup" ? "Bridal glam" : "Volume lashes"}`}
                        style={{ flex: 1, padding: "0.6rem 0.9rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.88rem" }}
                      />
                      <input
                        type="number" min="35" step="1"
                        value={styleInputs[s.id].priceRand}
                        onChange={e => setStyleInputs(i => ({ ...i, [s.id]: { ...i[s.id], priceRand: e.target.value } }))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStyle(s.id); } }}
                        placeholder="R price (min 35)"
                        style={{ width: 100, flexShrink: 0, padding: "0.6rem 0.9rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.88rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => addStyle(s.id)}
                        style={{ flexShrink: 0, background: "var(--plum)", color: "#fff", border: "none", borderRadius: 10, padding: "0.6rem 1rem", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" }}
                      >Add</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--light)", marginRight: "0.15rem" }}>Suggest with:</span>
                      {tagOptionsFor(s.id).map(t => {
                        const on = styleInputs[s.id].tags.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => toggleInputTag(s.id, t.id)}
                            style={{
                              borderRadius: 100, border: `1.5px solid ${on ? "var(--plum)" : "#E0E0E0"}`,
                              background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)",
                              padding: "0.15rem 0.6rem", fontSize: "0.72rem", fontWeight: 500, cursor: "pointer",
                            }}
                          >{t.label}</button>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: "0.73rem", color: "var(--light)", marginTop: "0.35rem" }}>Press Enter or click Add. Each service needs a price — clients book and pay this amount directly. Tag what products go with it (e.g. Weave install → Extensions) so relevant products show up when a client books.</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "1.75rem" }}>
        {selected.length === 0 && <p style={{ fontSize: "0.82rem", color: "var(--nude)", marginBottom: "1rem" }}>Select at least one service you offer.</p>}
        {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
        {saved && <p style={{ color: "var(--forest)", fontSize: "0.85rem", marginBottom: "1rem" }}>Services saved.</p>}
        <button onClick={handleSave} className="btn-plum" disabled={saving || selected.length === 0} style={{ padding: "0.75rem 2rem" }}>{saving ? "Saving…" : "Save services"}</button>
        <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "1rem" }}>Your listed services and styles help clients find you when searching on Umuhle.</p>
      </div>

      <PricedServicesManager user={user} categories={selected as ServiceTypeId[]} refreshSignal={servicesSyncedAt} />
    </div>
  );
}

// ─── Invite tab ────────────────────────────────────────────────────────────────
function InviteTab({ profile }: { profile: Profile }) {
  const [copied, setCopied] = useState(false);
  const referralLink = profile.referral_code
    ? `https://umuhle.co.za/?referral-code=${profile.referral_code}`
    : null;

  const handleCopy = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = () => {
    if (!referralLink) return;
    if (navigator.share) {
      navigator.share({ title: "Join me on Umuhle", text: "Book beauty artists near you on Umuhle!", url: referralLink }).catch(() => {});
    } else {
      handleCopy();
    }
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Invite &amp; Earn</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem", lineHeight: 1.6 }}>
        Share your personal invite link with friends. When they sign up and book through Umuhle, you earn a reward.
      </p>

      {referralLink ? (
        <>
          {/* Link display */}
          <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 16, padding: "1.25rem 1.5rem", marginBottom: "1.25rem" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--plum)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Your invite link</p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "#fff", borderRadius: 12, padding: "0.65rem 0.9rem", border: "1.5px solid rgba(155,127,184,0.2)", flexWrap: "wrap" }}>
              <span style={{ flex: 1, fontSize: "0.85rem", color: "var(--grey)", wordBreak: "break-all", fontFamily: "monospace" }}>{referralLink}</span>
              <button
                onClick={handleCopy}
                style={{ flexShrink: 0, background: copied ? "var(--forest)" : "var(--plum)", color: "#fff", border: "none", borderRadius: 8, padding: "0.4rem 0.9rem", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer", transition: "background 0.2s", whiteSpace: "nowrap" }}
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          </div>

          {/* Referral code */}
          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem" }}>Your referral code</p>
            <span style={{ fontFamily: "var(--font-display)", fontSize: "2rem", fontWeight: 500, color: "var(--plum)", letterSpacing: "0.15em" }}>{profile.referral_code}</span>
          </div>

          {/* Share button */}
          <button onClick={handleShare} className="btn-plum" style={{ padding: "0.75rem 2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            Share invite
          </button>

          {/* How it works */}
          <div style={{ marginTop: "2.5rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.08em" }}>How it works</p>
            {[
              "Share your unique invite link with a friend.",
              "They sign up using your link.",
              "When they make their first booking, you earn a reward.",
            ].map((step, i) => (
              <div key={i} style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
                <p style={{ fontSize: "0.88rem", color: "var(--grey)", margin: 0, lineHeight: 1.5 }}>
                  {i + 1}. {step}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ background: "var(--plum-t)", borderRadius: 16, padding: "2rem", textAlign: "center" }}>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Your referral code is being generated. Check back shortly.</p>
        </div>
      )}
    </div>
  );
}

// ─── Wallet tab ────────────────────────────────────────────────────────────────
// Reads from the existing wallets / wallet_transactions / withdrawals tables
// (already used by the admin panel to process payouts). Matches the R100
// minimum withdrawal called out on the public Earn page.
const MIN_WITHDRAWAL_CENTS = 10000; // R100

function WalletTab({ user }: { user: User }) {
  const supabase = createClient();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    // Recalculates available/pending/total_earned straight from the ledger —
    // this is what moves a credit from "pending" into "available" once its
    // payout hold window has passed. Pure recalculation, so it's always safe
    // to call and needs no cron job.
    await supabase.rpc("recompute_wallet_balance", { p_profile_id: user.id });

    const { data: walletData, error: walletErr } = await supabase
      .from("wallets")
      .select("*")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (walletErr) {
      setLoadError("Couldn't load your wallet. Please try again shortly.");
      setLoading(false);
      return;
    }
    setWallet((walletData as Wallet) ?? null);

    if (walletData) {
      const { data: txData } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq("wallet_id", walletData.id)
        .order("created_at", { ascending: false })
        .limit(30);
      setTransactions((txData as WalletTransaction[]) ?? []);
    } else {
      setTransactions([]);
    }

    const { data: wdData } = await supabase
      .from("withdrawals")
      .select("*")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setWithdrawals((wdData as Withdrawal[]) ?? []);

    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const availableBalance = wallet?.available_balance ?? 0;
  const pendingBalance = wallet?.pending_balance ?? 0;
  const totalEarned = wallet?.total_earned ?? 0;
  const hasOpenRequest = withdrawals.some(w => w.status === "pending" || w.status === "approved");
  const canRequest = !!wallet && availableBalance >= MIN_WITHDRAWAL_CENTS && !hasOpenRequest;

  const handleSubmitRequest = async () => {
    if (!wallet || !canRequest) return;
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
      setFormError("Please fill in all your bank details.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const { error: insertError } = await supabase.from("withdrawals").insert({
      profile_id: user.id,
      amount: availableBalance,
      bank_name: bankName.trim(),
      account_number: accountNumber.trim(),
      account_holder: accountHolder.trim(),
      status: "pending",
    });
    setSubmitting(false);
    if (insertError) {
      setFormError("Couldn't submit your request. Please try again.");
      return;
    }
    setShowRequestForm(false);
    setBankName(""); setAccountNumber(""); setAccountHolder("");
    setNotice(`Withdrawal request submitted. Payouts run Mondays, Wednesdays and Fridays — next payout run is ${formatPayoutDate(getNextPayoutDate())}.`);
    load();
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "1.25rem" }}>Wallet</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {[...Array(2)].map((_, i) => <div key={i} style={{ height: i === 0 ? 150 : 90, borderRadius: 20, background: "var(--plum-t)", animation: "pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Wallet</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
        Your earnings from completed bookings and delivered orders land here (Umuhle keeps a service fee — R5 flat, or 10% on amounts above R50 — and you keep the rest), along with any referral rewards. New earnings sit in <strong>Pending</strong> for {PAYOUT_HOLD_DAYS} days after completion before moving to your available balance — withdraw once that reaches R100. Payouts are processed every Monday, Wednesday and Friday.
      </p>

      {loadError && (
        <div style={{ background: "#FBE9E7", border: "1.5px solid rgba(191,54,12,0.25)", borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "#BF360C" }}>
          {loadError}
        </div>
      )}

      {notice && (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "var(--onyx)" }}>
          {notice}
        </div>
      )}

      {/* Balance card */}
      <div style={{ background: "linear-gradient(135deg, var(--plum) 0%, var(--plum-d) 100%)", borderRadius: 20, padding: "1.75rem", marginBottom: "1.25rem", color: "#fff" }}>
        <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.85, marginBottom: "0.4rem" }}>Available balance</p>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", fontWeight: 500, marginBottom: "1.25rem" }}>{fmt(availableBalance)}</p>
        <div style={{ display: "flex", gap: "1.75rem" }}>
          <div>
            <p style={{ fontSize: "0.7rem", opacity: 0.75, marginBottom: 2 }}>Pending</p>
            <p style={{ fontSize: "0.95rem", fontWeight: 500 }}>{fmt(pendingBalance)}</p>
            {pendingBalance > 0 && (
              <p style={{ fontSize: "0.65rem", opacity: 0.7, marginTop: 2 }}>in {PAYOUT_HOLD_DAYS}-day payout window</p>
            )}
          </div>
          <div>
            <p style={{ fontSize: "0.7rem", opacity: 0.75, marginBottom: 2 }}>Total earned</p>
            <p style={{ fontSize: "0.95rem", fontWeight: 500 }}>{fmt(totalEarned)}</p>
          </div>
        </div>
      </div>

      {/* Withdraw action / status */}
      {hasOpenRequest ? (
        <div style={{ background: "var(--plum-t)", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "2rem", fontSize: "0.85rem", color: "var(--onyx)" }}>
          You have a withdrawal request being processed. Payouts run Mondays, Wednesdays and Fridays — next payout run is {formatPayoutDate(getNextPayoutDate())}.
        </div>
      ) : (
        <div style={{ marginBottom: "2rem" }}>
          <button
            className="btn-plum"
            disabled={!canRequest}
            onClick={() => setShowRequestForm(true)}
            style={{ padding: "0.75rem 2rem", opacity: canRequest ? 1 : 0.5, cursor: canRequest ? "pointer" : "not-allowed" }}
          >
            Request withdrawal
          </button>
          {!canRequest && (
            <p style={{ fontSize: "0.8rem", color: "var(--light)", marginTop: "0.6rem" }}>
              You need at least R100 available to request a withdrawal.
            </p>
          )}
        </div>
      )}

      {/* Instant payouts via PayFast */}
      <PayFastMerchantSection userId={user.id} />

      {/* Request form modal */}
      {showRequestForm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowRequestForm(false); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.35rem" }}>Request withdrawal</h3>
            <p style={{ color: "var(--grey)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>You&apos;re requesting <strong>{fmt(availableBalance)}</strong>.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bank *</label>
                <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Capitec" style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Account number *</label>
                <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Account holder name *</label>
                <input value={accountHolder} onChange={e => setAccountHolder(e.target.value)} style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
              </div>
              {formError && <p style={{ color: "#E53935", fontSize: "0.8rem" }}>{formError}</p>}
              <button className="btn-plum" onClick={handleSubmitRequest} disabled={submitting} style={{ width: "100%", padding: "0.75rem" }}>
                {submitting ? "Submitting…" : "Submit request"}
              </button>
              <button onClick={() => setShowRequestForm(false)} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.85rem", cursor: "pointer", textAlign: "center" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.85rem" }}>Transaction history</p>
      {transactions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>👛</div>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>No transactions yet. Completed bookings, delivered orders, and referrals will show up here.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {transactions.map(t => {
            const clearsAt = t.clears_at ? new Date(t.clears_at) : null;
            const isPending = t.type === "credit" && clearsAt !== null && clearsAt.getTime() > Date.now();
            const daysLeft = isPending && clearsAt ? Math.max(1, Math.ceil((clearsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
            return (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", borderRadius: 14, padding: "0.9rem 1.1rem", border: "1.5px solid rgba(155,127,184,0.12)" }}>
                <div>
                  <p style={{ fontSize: "0.88rem", color: "var(--onyx)", marginBottom: 2 }}>{t.description}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--light)" }}>
                    {new Date(t.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                    {isPending && <span style={{ color: "#E65100" }}> · available in {daysLeft} day{daysLeft === 1 ? "" : "s"}</span>}
                  </p>
                </div>
                <p style={{ fontSize: "0.95rem", fontWeight: 600, color: t.type === "credit" ? "var(--forest)" : "var(--onyx)" }}>
                  {t.type === "credit" ? "+" : "−"}{fmt(t.amount)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PayFast instant payouts (split payments) ──────────────────────────────────
// Collects the artist/store partner's own PayFast merchant ID so PayFast can
// pay them directly at the moment of payment, instead of the wallet's
// pending → 2-day-hold → manual withdrawal path — see lib/payments/split.ts
// for the full mechanics and the constraints this is built around.
//
// ⚠️  Enabling this is TWO steps, and only the first is self-serve:
//   1. The partner pastes their merchant ID here (this component).
//   2. TKZ adds that merchant ID to Umuhle's own "Allowed merchants" list
//      in the PayFast dashboard (this appears to require a manual,
//      per-merchant step there — no public API for it was found; confirm
//      with PayFast support before assuming this can be automated) and
//      then flips payfast_split_approved for that profile, e.g. via the
//      admin panel.
// Until step 2 happens, this partner keeps earning through the wallet
// exactly as before — nothing about their current payouts changes just by
// saving an ID here.

function PayFastMerchantSection({ userId }: { userId: string }) {
  const supabase = createClient();
  const [merchantId, setMerchantId] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("payfast_merchant_id, payfast_split_approved")
        .eq("id", userId)
        .single();
      setSavedId(data?.payfast_merchant_id ?? null);
      setMerchantId(data?.payfast_merchant_id ?? "");
      setApproved(Boolean(data?.payfast_split_approved));
      setLoading(false);
    })();
  }, [userId, supabase]);

  const handleSave = async () => {
    const trimmed = merchantId.trim();
    if (!trimmed) return;
    setSaving(true);
    // A new/changed ID always needs re-approving — see the file header.
    const { error } = await supabase
      .from("profiles")
      .update({ payfast_merchant_id: trimmed, payfast_split_approved: false })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setNotice("Couldn't save your merchant ID. Please try again.");
      return;
    }
    setSavedId(trimmed);
    setApproved(false);
    setNotice("Saved. We'll activate instant payouts once it's confirmed on our end — usually within a few days.");
  };

  if (loading) return null;

  return (
    <div style={{ background: "#fff", border: "1.5px solid var(--plum-t)", borderRadius: 18, padding: "1.5rem", marginBottom: "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.05rem" }}>Instant payouts via PayFast</h3>
        {savedId && (
          <span style={{
            fontSize: "0.7rem", fontWeight: 600, padding: "0.25rem 0.65rem", borderRadius: 999,
            background: approved ? "#E6F4EA" : "var(--plum-t)", color: approved ? "#1E7B34" : "var(--onyx)",
          }}>
            {approved ? "Active" : "Pending approval"}
          </span>
        )}
      </div>
      <p style={{ color: "var(--grey)", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1rem" }}>
        {approved
          ? "Your bookings and single-seller orders now pay you directly and instantly — no 2-day hold, no manual withdrawal. (Multi-seller cart orders still go through your wallet above, since a single payment can only split to one PayFast account.)"
          : "Add your own PayFast merchant ID and, once we've confirmed it on our end, eligible bookings and orders will pay you the moment the customer pays — instead of sitting in your wallet's pending balance."}
      </p>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.5rem" }}>
        <input
          type="text"
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value)}
          placeholder="e.g. 10000100"
          style={{ flex: 1, padding: "0.7rem 0.9rem", borderRadius: 12, border: "1.5px solid var(--plum-t)", fontSize: "0.9rem" }}
        />
        <button
          className="btn-plum"
          disabled={saving || !merchantId.trim() || merchantId.trim() === savedId}
          onClick={handleSave}
          style={{ padding: "0.7rem 1.4rem", opacity: saving || !merchantId.trim() || merchantId.trim() === savedId ? 0.5 : 1 }}
        >
          {saving ? "Saving…" : savedId ? "Update" : "Save"}
        </button>
      </div>

      {notice && <p style={{ fontSize: "0.8rem", color: "var(--onyx)", marginTop: "0.4rem" }}>{notice}</p>}

      <button
        onClick={() => setShowHelp((s) => !s)}
        style={{ background: "none", border: "none", padding: 0, marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--plum)", textDecoration: "underline", cursor: "pointer" }}
      >
        {showHelp ? "Hide" : "Don't have a PayFast merchant ID?"}
      </button>

      {showHelp && (
        <div style={{ marginTop: "0.85rem", padding: "1rem 1.1rem", background: "var(--plum-t)", borderRadius: 14, fontSize: "0.82rem", lineHeight: 1.7, color: "var(--onyx)" }}>
          <p style={{ marginBottom: "0.6rem" }}>
            Your merchant ID is free and comes with a PayFast account — it&apos;s the same account you&apos;d use to accept payments anywhere else, not something specific to Umuhle.
          </p>
          <ol style={{ paddingLeft: "1.1rem", marginBottom: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <li>
              Sign up for a free PayFast account at{" "}
              <a href="https://www.payfast.io" target="_blank" rel="noopener noreferrer" style={{ color: "var(--plum)" }}>payfast.io</a>
              {" "}(business or individual, whichever fits you).
            </li>
            <li>
              Once you&apos;re logged in, your Merchant ID is shown on your Dashboard, or under Settings → Integration. PayFast&apos;s own guide:{" "}
              <a href="https://payfast.io/faq/merchant-faqs/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--plum)" }}>Merchant FAQs</a>.
            </li>
            <li>Paste that number above and save.</li>
          </ol>
          <p style={{ opacity: 0.85 }}>
            Curious how the instant-pay part works under the hood? See PayFast&apos;s{" "}
            <a href="https://payfast.io/features/split-payments/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--plum)" }}>Split Payments</a> page.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Point of Contact popup ────────────────────────────────────────────────────
// State for PoC WhatsApp acceptance flow
type PocStatus = "idle" | "sent" | "confirmed";

function PocPopup({ onSave, onDismiss }: { onSave: (name: string, phone: string) => void; onDismiss: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [pocConsentData, setPocConsentData] = useState(false);
  const [pocConsentContact, setPocConsentContact] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [pocStatus, setPocStatus] = useState<PocStatus>("idle");
  const [waError, setWaError] = useState("");

  const canSubmit = name.trim() && phone.trim() && pocConsentData && pocConsentContact;

  const handleSendWhatsApp = async () => {
    if (!name.trim() || !phone.trim()) return;
    setSendingWa(true); setWaError("");
    try {
      const res = await fetch("/api/poc/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send WhatsApp message");
      setPocStatus("sent");
    } catch (err: unknown) {
      setWaError(err instanceof Error ? err.message : "Failed to send. Please check the number and try again.");
    } finally {
      setSendingWa(false);
    }
  };

  const handleConfirmAccepted = async () => {
    setSaving(true);
    await onSave(name.trim(), phone.trim());
    setSaving(false);
    setPocStatus("confirmed");
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onDismiss(); }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Add Point of Contact</h3>

        {/* ── Description (requirement 1) ── */}
        <div style={{ background: "var(--plum-t)", borderRadius: 12, padding: "0.9rem 1rem", marginBottom: "1.5rem", lineHeight: 1.65 }}>
          <p style={{ fontSize: "0.875rem", color: "var(--onyx)", margin: 0 }}>
            <strong>A Point of Contact is required before making a booking.</strong> This is a trusted person — such as a family member or close friend — who can be reached on your behalf during your appointment. They act as your emergency contact for safety and peace of mind, and may be contacted by the artist if anything arises at the meeting location.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mama Dlamini" style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>WhatsApp number *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder="e.g. 082 123 4567" style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
          </div>

          {/* POPIA Consent checkboxes */}
          <div style={{ background: "#FAFAFA", borderRadius: 12, padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: "0.65rem", border: "1px solid #EBEBEB" }}>
            <p style={{ fontSize: "0.73rem", fontWeight: 600, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>POPIA Consent</p>
            <label style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={pocConsentData}
                onChange={e => setPocConsentData(e.target.checked)}
                style={{ marginTop: "0.15rem", accentColor: "var(--plum)", width: 16, height: 16, flexShrink: 0 }}
              />
              <span style={{ fontSize: "0.82rem", color: "var(--grey)", lineHeight: 1.5 }}>
                I confirm that I have this person&apos;s permission to share their name and phone number with Umuhle.
              </span>
            </label>
            <label style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={pocConsentContact}
                onChange={e => setPocConsentContact(e.target.checked)}
                style={{ marginTop: "0.15rem", accentColor: "var(--plum)", width: 16, height: 16, flexShrink: 0 }}
              />
              <span style={{ fontSize: "0.82rem", color: "var(--grey)", lineHeight: 1.5 }}>
                I confirm that Umuhle may contact this person directly via WhatsApp in relation to my bookings.
              </span>
            </label>
          </div>

          {/* Step 1: Send WhatsApp to PoC for acceptance */}
          {pocStatus === "idle" && (
            <>
              {waError && <p style={{ color: "#E53935", fontSize: "0.8rem" }}>{waError}</p>}
              <button
                className="btn-plum"
                onClick={handleSendWhatsApp}
                disabled={sendingWa || !canSubmit}
                style={{ width: "100%", padding: "0.75rem" }}
              >
                {sendingWa ? "Sending…" : "Send WhatsApp to confirm"}
              </button>
              <p style={{ fontSize: "0.75rem", color: "var(--light)", textAlign: "center" }}>
                A WhatsApp message will be sent to this person asking them to accept being your Point of Contact.
              </p>
            </>
          )}

          {/* Step 2: Waiting for PoC to accept */}
          {pocStatus === "sent" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>💬</div>
              <p style={{ fontSize: "0.875rem", color: "var(--grey)", marginBottom: "1rem", lineHeight: 1.6 }}>
                A WhatsApp message has been sent to <strong>{name}</strong> at <strong>{phone}</strong>. Once they reply to accept, click the button below.
              </p>
              <button className="btn-plum" onClick={handleConfirmAccepted} disabled={saving} style={{ width: "100%", padding: "0.75rem", marginBottom: "0.5rem" }}>
                {saving ? "Saving…" : "They've accepted — confirm"}
              </button>
              <button
                onClick={handleSendWhatsApp}
                disabled={sendingWa}
                style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.83rem", cursor: "pointer", textDecoration: "underline" }}
              >
                Resend WhatsApp
              </button>
            </div>
          )}

          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.85rem", cursor: "pointer", textAlign: "center" }}>Remind me later</button>
        </div>
      </div>
    </div>
  );
}

// ─── Bookings tab with PoC section ─────────────────────────────────────────────
function BookingsTab({ user, profile, onUpdateProfile }: { user: User; profile: Profile; onUpdateProfile: (p: Profile) => void }) {
  const supabase = createClient();
  const [bookingRole, setBookingRole] = useState<"client" | "artist">("client");
  const [bookings, setBookings] = useState<BookingWithRelations[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [showPocPopup, setShowPocPopup] = useState(false);
  const [pocSaving, setPocSaving] = useState(false);
  const [myReviews, setMyReviews] = useState<MyReviewMap>({});
  const [reviewTarget, setReviewTarget] = useState<BookingWithRelations | null>(null);
  const [bookingActionId, setBookingActionId] = useState<string | null>(null);
  const [bookingActionError, setBookingActionError] = useState("");

  const hasPoc = !!(profile.poc_name && profile.poc_phone);

  const fetchBookings = useCallback(async () => {
    setBookingsLoading(true);
    const today = new Date().toISOString().split("T")[0];
    let query = supabase
      .from("bookings")
      .select(`*, artist:artists(id, display_name, avatar_url, suburb, profile:profiles(phone)), service:services(name, duration_minutes)`)
      .eq("client_id", user.id)
      .order("booking_date", { ascending: false })
      .order("booking_time", { ascending: false });
    if (bookingFilter === "upcoming") query = query.gte("booking_date", today).in("status", ["confirmed", "pending_payment", "in_progress"]);
    else if (bookingFilter === "past") query = query.or(`booking_date.lt.${today},status.in.(completed,cancelled,no_show)`);
    const { data } = await query.limit(50);
    const rows = (data ?? []) as unknown as BookingWithRelations[];
    setBookings(rows);
    setBookingsLoading(false);

    const completedIds = rows.filter(b => b.status === "completed").map(b => b.id);
    if (completedIds.length > 0) {
      const res = await fetch(`/api/reviews?bookingIds=${completedIds.join(",")}`);
      if (res.ok) { const data = await res.json(); setMyReviews(data.reviews ?? {}); }
    }
  }, [user.id, bookingFilter, supabase]);

  useEffect(() => { if (bookingRole === "client") fetchBookings(); }, [fetchBookings, bookingRole]);

  const handleReviewSubmitted = (bookingId: string, review: SubmittedReview) => {
    setMyReviews(prev => ({ ...prev, [bookingId]: { ...review, created_at: new Date().toISOString() } }));
    setReviewTarget(null);
  };

  // Cancelling or reporting a no-show as the client — see
  // app/api/bookings/[id]/status/route.ts, which derives cancelled_by/
  // no_show_party from the caller's identity rather than trusting the body.
  const handleBookingAction = async (id: string, status: "cancelled" | "no_show") => {
    setBookingActionId(id);
    setBookingActionError("");
    try {
      const res = await fetch(`/api/bookings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't update this booking.");
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    } catch (e) {
      setBookingActionError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBookingActionId(null);
    }
  };

  const handleSavePoc = async (name: string, phone: string) => {
    setPocSaving(true);
    const { data } = await supabase
      .from("profiles")
      .update({ poc_name: name, poc_phone: phone, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select()
      .single();
    setPocSaving(false);
    if (data) { onUpdateProfile(data as Profile); }
    setShowPocPopup(false);
  };

  const handleRemovePoc = async () => {
    const { data } = await supabase
      .from("profiles")
      .update({ poc_name: null, poc_phone: null, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select()
      .single();
    if (data) onUpdateProfile(data as Profile);
  };

  return (
    <section>
      {/* ── Client / artist role toggle (only shown to people with an artist profile) ── */}
      {profile.is_artist && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {([
            { id: "client" as const, label: "My Bookings" },
            { id: "artist" as const, label: "Client Bookings" },
          ]).map(t => (
            <button key={t.id} onClick={() => setBookingRole(t.id)}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1.1rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.25)", cursor: "pointer",
                background: bookingRole === t.id ? "var(--plum)" : "transparent", color: bookingRole === t.id ? "#fff" : "var(--onyx)", fontSize: "0.875rem", fontWeight: 500, transition: "all 0.15s" }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {bookingRole === "artist" && <ClientBookingsPanel user={user} />}

      {bookingRole === "client" && (
      <>
      {/* ── Point of Contact section ── */}
      <div style={{
        background: hasPoc ? "#E8F5E9" : "var(--plum-t)",
        border: `1.5px solid ${hasPoc ? "rgba(46,125,50,0.2)" : "rgba(155,127,184,0.2)"}`,
        borderRadius: 18, padding: "1.25rem 1.5rem", marginBottom: "2rem",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
              <span style={{ fontSize: "1.1rem" }}>{hasPoc ? "✅" : "👤"}</span>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", margin: 0, color: hasPoc ? "#2E7D32" : "var(--onyx)" }}>Point of Contact</h3>
            </div>

            {/* Description shown only when no PoC set */}
            {!hasPoc && (
              <p style={{ fontSize: "0.83rem", color: "var(--grey)", lineHeight: 1.6, marginBottom: 0 }}>
                <strong>A Point of Contact is required before making a booking.</strong> This is a trusted person — such as a family member or close friend — who can be reached on your behalf during your appointment, for safety and peace of mind.
              </p>
            )}

            {/* PoC details shown only when confirmed */}
            {hasPoc && (
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                <div>
                  <p style={{ fontSize: "0.7rem", color: "var(--light)", marginBottom: "0.1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Name</p>
                  <p style={{ fontSize: "0.9rem", fontWeight: 500, margin: 0 }}>{profile.poc_name}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.7rem", color: "var(--light)", marginBottom: "0.1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>WhatsApp</p>
                  <p style={{ fontSize: "0.9rem", fontWeight: 500, margin: 0 }}>{profile.poc_phone}</p>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0, flexWrap: "wrap" }}>
            {!hasPoc && (
              <button onClick={() => setShowPocPopup(true)} className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}>
                Add now
              </button>
            )}
            {hasPoc && (
              <button onClick={handleRemovePoc} className="btn-outline" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem", borderColor: "#E53935", color: "#E53935" }}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Bookings list ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem" }}>
          {bookingFilter === "upcoming" ? "Upcoming bookings" : bookingFilter === "past" ? "Past bookings" : "All bookings"}
        </h2>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {(["upcoming", "past", "all"] as const).map(f => (
            <button key={f} onClick={() => setBookingFilter(f)} style={{ borderRadius: 100, border: `1.5px solid ${bookingFilter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`, padding: "0.35rem 0.9rem", fontSize: "0.8rem", fontWeight: bookingFilter === f ? 500 : 400, background: bookingFilter === f ? "var(--plum-t)" : "#fff", color: bookingFilter === f ? "var(--plum)" : "var(--grey)", cursor: "pointer", textTransform: "capitalize" }}>{f}</button>
          ))}
        </div>
      </div>

      {bookingsLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {[...Array(3)].map((_, i) => <div key={i} style={{ height: 120, borderRadius: 18, background: "var(--plum-t)", animation: "pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      )}
      {!bookingsLoading && bookings.length === 0 && (
        <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📅</div>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>No bookings yet</h3>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>Discover and book talented beauty artists near you.</p>
          <Link href="/"><button className="btn-plum" style={{ padding: "0.75rem 2rem" }}>Find an artist</button></Link>
        </div>
      )}
      {bookingActionError && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{bookingActionError}</p>}
      {!bookingsLoading && bookings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {bookings.map(b => (
            <BookingCard key={b.id} booking={b} myReview={myReviews[b.id] ?? null} onRate={() => setReviewTarget(b)}
              onCancel={() => handleBookingAction(b.id, "cancelled")}
              onReportNoShow={() => handleBookingAction(b.id, "no_show")}
              actionLoading={bookingActionId === b.id}
            />
          ))}
        </div>
      )}

      {showPocPopup && (
        <PocPopup
          onSave={handleSavePoc}
          onDismiss={() => setShowPocPopup(false)}
        />
      )}
      {pocSaving && <div style={{ display: "none" }} />}
      </>
      )}

      {reviewTarget && (
        <ReviewModal
          bookingId={reviewTarget.id}
          revieweeName={reviewTarget.artist?.display_name ?? "your artist"}
          revieweeAvatarUrl={reviewTarget.artist?.avatar_url}
          role="client"
          onClose={() => setReviewTarget(null)}
          onSubmitted={(review) => handleReviewSubmitted(reviewTarget.id, review)}
        />
      )}
    </section>
  );
}

// ─── Client bookings (artist side) ─────────────────────────────────────────────
// The flip side of BookingsTab above: bookings where the current user is the
// ARTIST being booked, not the client. Nothing like this existed before —
// artists had no way to see who had booked them. Reuses the same status
// palette and card shell as the client view, plus lets the artist progress
// a booking to completed (or no-show) and then rate the client.

function ClientBookingCard({ booking, myReview, onRate, onMarkStatus, actionLoading }: {
  booking: BookingWithRelations;
  myReview?: { rating: number; comment: string | null } | null;
  onRate: () => void;
  onMarkStatus: (id: string, status: "completed" | "no_show" | "cancelled") => void;
  actionLoading: boolean;
}) {
  const status = STATUS_STYLES[booking.status] ?? STATUS_STYLES.confirmed;
  const client = booking.client;
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
        <Image src={client?.avatar_url ?? ICON} alt={client?.full_name ?? "Client"} width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid var(--plum-t)" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", marginBottom: "0.1rem" }}>{client?.full_name ?? "Client"}</h3>
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
          {client?.phone && (
            <div>
              <p style={{ fontSize: "0.72rem", color: "var(--light)", marginBottom: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Contact</p>
              <p style={{ fontSize: "0.88rem", fontWeight: 500 }}>{client.phone}</p>
            </div>
          )}
          <div>
            <p style={{ fontSize: "0.72rem", color: "var(--light)", marginBottom: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total</p>
            <p style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--plum)" }}>{fmt(booking.total_amount)}</p>
          </div>
        </div>

        {booking.status === "confirmed" && (
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px dashed rgba(155,127,184,0.2)" }}>
            <button onClick={() => onMarkStatus(booking.id, "completed")} disabled={actionLoading} className="btn-plum" style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem" }}>
              Mark completed
            </button>
            <button onClick={() => onMarkStatus(booking.id, "cancelled")} disabled={actionLoading} className="btn-outline" style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem" }}>
              Cancel booking
            </button>
            <button onClick={() => onMarkStatus(booking.id, "no_show")} disabled={actionLoading} className="btn-outline" style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem", borderColor: "#E53935", color: "#E53935" }}>
              Client no-show
            </button>
          </div>
        )}

        {booking.status === "completed" && (
          <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px dashed rgba(155,127,184,0.2)" }}>
            {myReview ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--grey)" }}>Your rating:</span>
                <StarRating rating={myReview.rating} showValue={false} size={13} />
              </div>
            ) : (
              <button onClick={onRate} className="btn-outline" style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem" }}>
                Rate this client
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientBookingsPanel({ user }: { user: User }) {
  const [hasArtistProfile, setHasArtistProfile] = useState(true);
  const [bookings, setBookings] = useState<BookingWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [myReviews, setMyReviews] = useState<MyReviewMap>({});
  const [reviewTarget, setReviewTarget] = useState<BookingWithRelations | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reliability, setReliability] = useState<{
    completed_bookings_count: number; cancelled_count: number; late_cancelled_count: number;
    no_show_count: number; visibility_reduced: boolean; account_status: string;
  } | null>(null);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/bookings/mine?filter=${filter}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    const rows = (data.bookings ?? []) as BookingWithRelations[];
    setHasArtistProfile(!!data.artistId);
    setReliability(data.reliability ?? null);
    setBookings(rows);
    setLoading(false);

    const completedIds = rows.filter(b => b.status === "completed").map(b => b.id);
    if (completedIds.length > 0) {
      const reviewRes = await fetch(`/api/reviews?bookingIds=${completedIds.join(",")}`);
      if (reviewRes.ok) { const d = await reviewRes.json(); setMyReviews(d.reviews ?? {}); }
    }
  }, [filter]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const handleMarkStatus = async (id: string, status: "completed" | "no_show" | "cancelled") => {
    setActionLoadingId(id);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't update this booking.");
      await fetchBookings();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!loading && !hasArtistProfile) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>💇</div>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>No artist profile yet</h3>
        <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Set up your services under the Services tab to start receiving bookings from clients.</p>
      </div>
    );
  }

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem" }}>
          {filter === "upcoming" ? "Upcoming client bookings" : filter === "past" ? "Past client bookings" : "All client bookings"}
        </h2>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {(["upcoming", "past", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ borderRadius: 100, border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`, padding: "0.35rem 0.9rem", fontSize: "0.8rem", fontWeight: filter === f ? 500 : 400, background: filter === f ? "var(--plum-t)" : "#fff", color: filter === f ? "var(--plum)" : "var(--grey)", cursor: "pointer", textTransform: "capitalize" }}>{f}</button>
          ))}
        </div>
      </div>

      {reliability && (() => {
        const score = computeReliabilityScore(reliability.completed_bookings_count, reliability.cancelled_count, reliability.no_show_count);
        const incidents = reliability.late_cancelled_count + reliability.no_show_count;
        const underReview = reliability.account_status === "pending_review";
        return (
          <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
              <div style={{ display: "flex", gap: "1.75rem", flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.15rem" }}>Completed</p>
                  <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>{reliability.completed_bookings_count}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.15rem" }}>Cancellations</p>
                  <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>{reliability.cancelled_count}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.15rem" }}>No-shows</p>
                  <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>{reliability.no_show_count}</p>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: "0.72rem", color: "var(--light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.15rem" }}>Reliability</p>
                <p style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--plum)" }}>{score === null ? "—" : `${score}%`}</p>
              </div>
            </div>
            {underReview ? (
              <p style={{ fontSize: "0.8rem", color: "#A32D2D", background: "#FCEBEB", borderRadius: 10, padding: "0.6rem 0.85rem", marginTop: "1rem", lineHeight: 1.5 }}>
                Your account is flagged for review after repeated late cancellations or no-shows. Reach out to info@umuhle.co.za if you'd like to talk it through.
              </p>
            ) : reliability.visibility_reduced ? (
              <p style={{ fontSize: "0.8rem", color: "#8A6100", background: "#FFF8E1", borderRadius: 10, padding: "0.6rem 0.85rem", marginTop: "1rem", lineHeight: 1.5 }}>
                Repeated late cancellations or no-shows in the last 90 days mean you're showing up lower in search results for now. This lifts on its own as those age out.
              </p>
            ) : incidents >= 1 ? (
              <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginTop: "1rem", lineHeight: 1.5 }}>
                Heads up — you have a late cancellation or no-show on record. Honouring confirmed bookings keeps your visibility and standing healthy.
              </p>
            ) : null}
          </div>
        );
      })()}

      {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {[...Array(3)].map((_, i) => <div key={i} style={{ height: 120, borderRadius: 18, background: "var(--plum-t)", animation: "pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      )}
      {!loading && bookings.length === 0 && (
        <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>💇</div>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>No bookings here yet</h3>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Bookings clients make with you will show up here.</p>
        </div>
      )}
      {!loading && bookings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {bookings.map(b => (
            <ClientBookingCard
              key={b.id}
              booking={b}
              myReview={myReviews[b.id] ?? null}
              onRate={() => setReviewTarget(b)}
              onMarkStatus={handleMarkStatus}
              actionLoading={actionLoadingId === b.id}
            />
          ))}
        </div>
      )}

      {reviewTarget && (
        <ReviewModal
          bookingId={reviewTarget.id}
          revieweeName={reviewTarget.client?.full_name ?? "this client"}
          revieweeAvatarUrl={reviewTarget.client?.avatar_url}
          role="artist"
          onClose={() => setReviewTarget(null)}
          onSubmitted={(review) => {
            setMyReviews(prev => ({ ...prev, [reviewTarget.id]: { ...review, created_at: new Date().toISOString() } }));
            setReviewTarget(null);
          }}
        />
      )}
    </section>
  );
}

// ─── My Shop tab (business partners: Products + Ads) ──────────────────────────

interface PartnerProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  stock_count: number;
  is_active: boolean;
  moderation_status: string;
  created_at: string;
  partner_id: string;
  weight_g: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  sell_scope: "province" | "south_africa";
  sell_provinces: string[];
  package: string | null;
  listing_status: string | null;
  listing_package_id: string | null;
  starts_at: string | null;
  expires_at: string | null;
}

const fmtShop = (cents: number) => `R${(cents / 100).toFixed(0)}`;

// ── Products manager ─────────────────────────────────────────────────────────
// Free to list — see the 2026-08 removal of the paid Starter/Growth/
// Business/Premium listing packages (products used to be gated behind
// `listing_status: "pending_payment"` until a package was bought; that
// gate is gone). package/listing_status/expires_at columns are left in
// the database for historical rows but nothing here reads or writes them
// anymore — every product is either "Live" or "Hidden", purely by the
// owner's own toggle, once past content moderation.


// My Shop — products and ads used to be two tabs here (a free product list,
// plus a separate ad-purchase tab that, as it turns out, had no way to
// actually create an ad from the UI). They're merged now: this tab IS
// listing management, and every listing is free from the start.
function MyShopTab({ user, partnerProvince }: { user: { id: string }; partnerProvince?: string | null }) {
  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.25rem" }}>Shop</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        <strong>Sell your products on Umuhle</strong><br />
        Add products to your shop for free.
      </p>
      <ProductsManager user={user} partnerProvince={partnerProvince} />
    </div>
  );
}

/**
 * UMUHLE DASHBOARD REFACTOR — BATCH 4: MY BUSINESS HUB
 *
 * My Business now owns Stores, Services, Products and Orders.
 * This prevents fulfilment and shipment tools from competing with customer
 * activity in the main dashboard navigation.
 *
 * CONTINUATION MARKER:
 * - Products and Orders are extracted reusable components.
 * - Store CSV import remains in StoreCsvImport and is the next component to
 *   fully extract from MySalonTab.
 * - Do not reintroduce a standalone Shipments tab.
 */



// ─── My Orders tab (unified product orders + service bookings history) ────────

type ProductOrderWithItems = Order & {
  order_items: (OrderItem & { product?: Product | null })[];
};

type OrderHistoryEntry =
  | { kind: "product"; id: string; date: string; data: ProductOrderWithItems }
  | { kind: "booking"; id: string; date: string; data: BookingWithRelations };

function ReorderButton({ order, onDone }: { order: ProductOrderWithItems; onDone: (msg: string) => void }) {
  const router = useRouter();
  const { addItem } = useCart();
  const [loading, setLoading] = useState(false);

  const items = order.order_items ?? [];
  const anyAvailable = items.some(i => i.product && i.product.is_active && i.product.moderation_status === "approved" && i.product.stock_count > 0);

  const handleClick = async () => {
    setLoading(true);
    let added = 0;
    const unavailable: string[] = [];
    for (const item of items) {
      const p = item.product;
      if (!p || !p.is_active || p.moderation_status !== "approved" || p.stock_count <= 0) {
        unavailable.push(item.product?.name ?? "An item");
        continue;
      }
      addItem(p, Math.min(item.quantity, p.stock_count));
      added++;
    }
    setLoading(false);
    if (added > 0) {
      onDone(
        unavailable.length > 0
          ? `Added ${added} item${added !== 1 ? "s" : ""} to your cart. ${unavailable.join(", ")} ${unavailable.length === 1 ? "is" : "are"} no longer available and ${unavailable.length === 1 ? "was" : "were"} skipped.`
          : `Added ${added} item${added !== 1 ? "s" : ""} to your cart.`
      );
      router.push("/cart");
    } else {
      onDone("Sorry — none of the items from this order are available anymore.");
    }
  };

  if (!anyAvailable) {
    return (
      <span style={{ fontSize: "0.78rem", color: "var(--light)", fontStyle: "italic" }}>
        No longer available to reorder
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="btn-outline"
      style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem" }}
    >
      {loading ? "Adding…" : "Order again"}
    </button>
  );
}

function ProductOrderCard({ order, onReorderDone }: { order: ProductOrderWithItems; onReorderDone: (msg: string) => void }) {
  const status = ORDER_STATUS_STYLES[order.status] ?? ORDER_STATUS_STYLES.pending_payment;
  const items = order.order_items ?? [];
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, background: "#fff", padding: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.2rem" }}>
            <span style={{ background: "var(--plum-t)", color: "var(--plum)", borderRadius: 100, padding: "0.15rem 0.6rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Product order</span>
            <span style={{ borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.72rem", fontWeight: 600, background: status.bg, color: status.color }}>{status.label}</span>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: 0 }}>
            {new Date(order.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })} · {itemCount} item{itemCount !== 1 ? "s" : ""}
          </p>
        </div>
        <p style={{ fontWeight: 700, color: "var(--plum)", fontSize: "1rem", margin: 0 }}>{fmt(order.total_amount)}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
        {items.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: 38, height: 38, borderRadius: 8, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
              {item.product?.image_url ? (
                <Image src={item.product.image_url} alt={item.product.name} width={38} height={38} style={{ objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: "1rem" }}>🛍️</span>
              )}
            </div>
            <p style={{ fontSize: "0.85rem", margin: 0, flex: 1, minWidth: 0 }}>
              {item.product?.name ?? "Product no longer available"} <span style={{ color: "var(--grey)" }}>× {item.quantity}</span>
            </p>
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: 0, flexShrink: 0 }}>{fmt(item.unit_price * item.quantity)}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ReorderButton order={order} onDone={onReorderDone} />
      </div>
    </div>
  );
}

function BookingHistoryCard({ booking }: { booking: BookingWithRelations }) {
  const status = STATUS_STYLES[booking.status] ?? STATUS_STYLES.confirmed;
  const artist = booking.artist;
  const service = booking.service;

  return (
    <div style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, background: "#fff", padding: "1.25rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
      <Image src={artist?.avatar_url ?? ICON} alt={artist?.display_name ?? "Artist"} width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid var(--plum-t)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.3rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.2rem" }}>
              <span style={{ background: "var(--blush, #C28070)", color: "#fff", borderRadius: 100, padding: "0.15rem 0.6rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Service booking</span>
              <span style={{ borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.72rem", fontWeight: 600, background: status.bg, color: status.color }}>{status.label}</span>
            </div>
            <p style={{ fontWeight: 500, fontSize: "0.92rem", margin: "0 0 0.1rem" }}>{artist?.display_name ?? "Artist"}</p>
            <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: 0 }}>
              {service?.name ?? "Service"} · {formatDate(booking.booking_date)} at {booking.booking_time}
            </p>
          </div>
          <p style={{ fontWeight: 700, color: "var(--plum)", fontSize: "1rem", margin: 0, flexShrink: 0 }}>{fmt(booking.total_amount)}</p>
        </div>
        <p style={{ fontSize: "0.76rem", color: "var(--light)", fontStyle: "italic", marginTop: "0.5rem" }}>
          Bookings can&apos;t be reordered automatically — artist availability changes, so book again from their profile.
        </p>
      </div>
    </div>
  );
}

function MyOrdersTab({ user }: { user: User }) {
  const supabase = createClient();
  const [productOrders, setProductOrders] = useState<ProductOrderWithItems[]>([]);
  const [bookings, setBookings] = useState<BookingWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "products" | "bookings">("all");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [ordersRes, bookingsRes] = await Promise.all([
      supabase
        .from("orders")
        .select(`*, order_items(*, product:products(*))`)
        .eq("client_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("bookings")
        .select(`*, artist:artists(id, display_name, avatar_url, suburb, profile:profiles(phone)), service:services(name, duration_minutes)`)
        .eq("client_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setProductOrders((ordersRes.data ?? []) as unknown as ProductOrderWithItems[]);
    setBookings((bookingsRes.data ?? []) as unknown as BookingWithRelations[]);
    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const entries: OrderHistoryEntry[] = [
    ...productOrders.map(o => ({ kind: "product" as const, id: o.id, date: o.created_at, data: o })),
    ...bookings.map(b => ({ kind: "booking" as const, id: b.id, date: b.created_at, data: b })),
  ]
    .filter(e => filter === "all" || (filter === "products" && e.kind === "product") || (filter === "bookings" && e.kind === "booking"))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem" }}>My Orders</h2>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {(["all", "products", "bookings"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{ borderRadius: 100, border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`, padding: "0.35rem 0.9rem", fontSize: "0.8rem", fontWeight: filter === f ? 500 : 400, background: filter === f ? "var(--plum-t)" : "#fff", color: filter === f ? "var(--plum)" : "var(--grey)", cursor: "pointer", textTransform: "capitalize" }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "var(--onyx)" }}>
          {notice}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {[...Array(3)].map((_, i) => <div key={i} style={{ height: 140, borderRadius: 18, background: "var(--plum-t)", animation: "pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🧾</div>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>No orders yet</h3>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>Your product orders and service bookings will show up here.</p>
          <Link href="/shop"><button className="btn-plum" style={{ padding: "0.75rem 2rem" }}>Browse the shop</button></Link>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {entries.map(e =>
            e.kind === "product"
              ? <ProductOrderCard key={`o-${e.id}`} order={e.data} onReorderDone={setNotice} />
              : <BookingHistoryCard key={`b-${e.id}`} booking={e.data} />
          )}
        </div>
      )}
    </section>
  );
}

// ─── Dashboard home (sidebar landing page) ─────────────────────────────────────
function DashboardHome({ user, profile, onNavigate }: {
  user: User;
  profile: Profile;
  onNavigate: (tab: Tab, section?: BusinessSection) => void;
}) {
  const supabase = createClient();
  const [stats, setStats] = useState({ bookings: 0, orders: 0, stores: 0 });

  useEffect(() => {
    let mounted = true;
    Promise.all([
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("client_id", user.id),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("client_id", user.id),
      supabase.from("partner_salons").select("id", { count: "exact", head: true }).eq("partner_id", user.id),
    ]).then(([b, o, s]) => {
      if (mounted) setStats({ bookings: b.count ?? 0, orders: o.count ?? 0, stores: s.count ?? 0 });
    });
    return () => { mounted = false; };
  }, [user.id]);

  const cards = [
    { label: "Bookings",  value: stats.bookings, action: "bookings" as Tab },
    { label: "Orders",    value: stats.orders,   action: "my-orders" as Tab },
    { label: "My Stores", value: stats.stores,   action: "my-business" as Tab, section: "stores" as BusinessSection },
  ];

  return (
    <section>
      <div className="dashboard-welcome">
        <div>
          <p className="dashboard-eyebrow">Welcome back</p>
          <h1>{profile.full_name?.split(" ")[0] ?? "Beautiful"}</h1>
          <p>{user.email}</p>
        </div>
        <button className="btn-plum" onClick={() => onNavigate("my-business", "stores")}>+ Add store</button>
      </div>
      <div className="dashboard-stat-grid">
        {cards.map(c => (
          <button key={c.label} className="dashboard-stat-card" onClick={() => onNavigate(c.action, c.section)}>
            <span>{c.label}</span>
            <strong>{c.value}</strong>
            <small>Open {c.label.toLowerCase()} →</small>
          </button>
        ))}
      </div>
      <div className="dashboard-home-grid">
        <div className="dashboard-card">
          <h2>Quick actions</h2>
          <div className="quick-actions">
            <button onClick={() => onNavigate("my-business", "stores")}>+ Add a store</button>
            <button onClick={() => onNavigate("my-business", "services")}>+ Add a service</button>
            <button onClick={() => onNavigate("my-business", "products")}>+ Add a product</button>
            <button onClick={() => onNavigate("bookings")}>View bookings</button>
          </div>
        </div>
        <div className="dashboard-card">
          <h2>My business</h2>
          <p>Manage your locations, services, products and orders from one place.</p>
          <button className="text-link" onClick={() => onNavigate("my-business", "stores")}>Manage My Business →</button>
        </div>
      </div>
    </section>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────
function DashboardContent() {
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
      if (!user) { router.replace("/dashboard?auth=login"); return; }
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

  const TAB_CONFIG: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard",   label: "Dashboard",   icon: "⌂" },
    { id: "bookings",    label: "Bookings",    icon: "▣" },
    { id: "my-orders",   label: "Orders",      icon: "▤" },
    { id: "wishlist",    label: "Saved",       icon: "♡" },
    { id: "my-business", label: "My Business", icon: "▥" },
    { id: "invite",      label: "Referrals",   icon: "↗" },
    { id: "wallet",      label: "Wallet",      icon: "R" },
    { id: "profile",     label: "Account",     icon: "○" },
  ];

  // Sidebar groups — order controls how items are grouped/headed in the left nav.
  const groups: { title: string; ids: Tab[] }[] = [
    { title: "",             ids: ["dashboard"] },
    { title: "My activity",  ids: ["bookings", "my-orders", "wishlist"] },
    { title: "My business",  ids: ["my-business"] },
    { title: "Money",        ids: ["wallet", "invite"] },
    { title: "Account",      ids: ["profile"] },
  ];
  const navItem = (id: Tab) => TAB_CONFIG.find(x => x.id === id)!;

  // Closes the mobile sidebar drawer on navigation; a no-op on desktop.
  const setActiveTab = (next: Tab) => { setTab(next); setSidebarOpen(false); };
  // Used by DashboardHome's quick-action cards, which also need to land on a
  // specific My Business section (e.g. "+ Add store" -> My Business > Stores).
  const goToTab = (next: Tab, section?: BusinessSection) => {
    if (section) setBusinessSection(section);
    setActiveTab(next);
  };

  // Courier's paused platform-wide (see lib/shiplogic.ts) — nag any partner
  // who still offers it and hasn't said how they'll handle delivery yet
  // (see PartnerFulfillmentSettings). Goes quiet the moment they save one.
  const needsDeliveryArrangement =
    profile.is_partner && profile.allow_courier && !COURIER_CHECKOUT_ENABLED && !profile.delivery_arrangement_method;

  return (
    <div className="dashboard-app">
      <SiteHeader initialUser={user} initialProfile={profile} />

      {/* ── Courier paused — delivery arrangement required ── */}
      {needsDeliveryArrangement && (
        <div style={{ background: "#FFF3E0", borderBottom: "1.5px solid #F0C766", padding: "0.85rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#8A6100", fontWeight: 500, textAlign: "center" }}>
            🚚 Courier is paused for now — let customers know how you&apos;ll handle delivery.
          </p>
          <button
            onClick={() => setActiveTab("profile")}
            style={{ background: "#8A6100", color: "#fff", border: "none", borderRadius: 999, padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Set it now
          </button>
        </div>
      )}

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
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>We mainly talk to you on WhatsApp — bookings, confirmations, and updates all go there.</p>
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
        {tab === "dashboard" && <DashboardHome user={user} profile={profile} onNavigate={goToTab} />}

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
        {tab === "my-business" && (
          <MyBusinessTab
            activeSection={businessSection}
            onSectionChange={setBusinessSection}
            stores={<section><MySalonTab user={user} /></section>}
            services={<section><MyServicesTab profile={profile} user={user} onUpdate={(p) => setProfile(p)} /></section>}
            products={<MyShopTab user={user} partnerProvince={profile.province} />}
            orders={<OrdersManager user={user} />}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the app router — wrap the
// real dashboard content so /dashboard?tab=wishlist deep links keep working.
export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--white)" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
