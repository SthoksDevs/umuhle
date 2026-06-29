"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, Booking, Artist } from "@/types";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

// ── Tab type extended with "invite" and "my-store" (replaces "my-store") ──────
type Tab = "bookings" | "wishlist" | "profile" | "my-store" | "my-services" | "invite";

const SERVICE_TYPES = [
  { id: "hair",   label: "Hair",  banner: "/banners/hair.jpg",   description: "From protective styles to blowouts, braids to colour — let clients know exactly what you specialise in." },
  { id: "nails",  label: "Nails",  banner: "/banners/nails.jpg",  description: "Gels, acrylics, nail art, manicures and more — list every nail style you offer so clients can find you." },
  { id: "makeup", label: "Makeup",  banner: "/banners/makeup.jpg", description: "Bridal, editorial, glam, natural — describe the makeup looks you create." },
  { id: "lashes", label: "Lashes",  banner: "/banners/lashes.jpg", description: "Classic, hybrid, volume, mega volume — tell clients which lash styles you do." },
] as const;

type ServiceTypeId = typeof SERVICE_TYPES[number]["id"];

type BookingWithRelations = Booking & {
  artist?: Artist & { profile?: Profile };
  service?: { name: string; duration_minutes: number };
};

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
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
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
      {canScrollRight && (
        <button
          onClick={scrollRight}
          aria-label="Scroll tabs"
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
function BookingCard({ booking }: { booking: BookingWithRelations }) {
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <span style={{ color: "#F4B400", fontSize: "0.82rem" }}>★ {(artist.rating ?? 0).toFixed(1)}</span>
          <span style={{ fontSize: "0.72rem", color: "var(--light)" }}>{artist.review_count ?? 0} reviews</span>
        </div>
        <Link href={`/?artist=${artist.id}`}><button className="btn-plum" style={{ width: "100%", padding: "0.55rem", fontSize: "0.85rem" }}>Book now</button></Link>
      </div>
    </div>
  );
}

// ─── Profile tab ───────────────────────────────────────────────────────────────
function ProfileTab({ profile, user, onUpdate }: { profile: Profile; user: User; onUpdate: (p: Profile) => void }) {
  const supabase = createClient();
  const [form, setForm] = useState({ full_name: profile.full_name ?? "", phone: profile.phone ?? "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [phoneChanged, setPhoneChanged] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState("");
  const originalPhone = profile.phone ?? "";

  const handlePhoneChange = (val: string) => {
    setForm(f => ({ ...f, phone: val }));
    setPhoneChanged(val.replace(/\D/g, "") !== originalPhone.replace(/\D/g, ""));
    setOtpSent(false); setOtpVerified(false); setOtpCode(""); setOtpError("");
  };
  const handleSendOtp = async () => {
    if (!form.phone) { setOtpError("Enter a WhatsApp number first."); return; }
    setOtpLoading(true); setOtpError("");
    try {
      const res = await fetch("/api/auth/send-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: form.phone }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setOtpSent(true);
    } catch (err: unknown) { setOtpError(err instanceof Error ? err.message : "Failed to send code"); }
    finally { setOtpLoading(false); }
  };
  const handleVerifyOtp = async () => {
    if (!otpCode.trim()) { setOtpError("Enter the 6-digit code."); return; }
    setOtpLoading(true); setOtpError("");
    try {
      const res = await fetch("/api/auth/send-otp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: form.phone, code: otpCode }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setOtpVerified(true); setOtpError("");
    } catch (err: unknown) { setOtpError(err instanceof Error ? err.message : "Verification failed"); }
    finally { setOtpLoading(false); }
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
    if (phoneChanged && !otpVerified) { setError("Please verify your new WhatsApp number before saving."); return; }
    setSaving(true); setError(""); setSaved(false);
    const { data, error: err } = await supabase.from("profiles").update({ full_name: form.full_name, phone: form.phone, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    if (data) { onUpdate(data as Profile); setSaved(true); setPhoneChanged(false); setOtpVerified(false); setTimeout(() => setSaved(false), 3000); }
  };
  const handleCopyReferral = () => {
    if (!profile.referral_code) return;
    navigator.clipboard.writeText(profile.referral_code);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
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
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>WhatsApp number{otpVerified && <span style={{ marginLeft: "0.5rem", color: "var(--forest)", fontSize: "0.72rem" }}>✓ Verified</span>}</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input value={form.phone} onChange={e => handlePhoneChange(e.target.value)} placeholder="e.g. 082 123 4567" type="tel" style={{ flex: 1, padding: "0.75rem 1rem", borderRadius: 12, border: `1.5px solid ${phoneChanged && !otpVerified ? "var(--nude)" : "#E0E0E0"}`, fontSize: "0.9rem" }} />
            {phoneChanged && !otpVerified && (
              <button type="button" onClick={handleSendOtp} disabled={otpLoading} style={{ flexShrink: 0, background: "var(--plum)", color: "#fff", border: "none", borderRadius: 12, padding: "0 1rem", fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{otpLoading ? "Sending…" : otpSent ? "Resend" : "Verify"}</button>
            )}
          </div>
          {otpSent && !otpVerified && (
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <input value={otpCode} onChange={e => setOtpCode(e.target.value)} placeholder="Enter 6-digit code" maxLength={6} style={{ flex: 1, padding: "0.65rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", letterSpacing: "0.15em", textAlign: "center" }} />
              <button type="button" onClick={handleVerifyOtp} disabled={otpLoading} style={{ flexShrink: 0, background: "var(--forest)", color: "#fff", border: "none", borderRadius: 12, padding: "0 1rem", fontSize: "0.82rem", fontWeight: 500, cursor: "pointer" }}>{otpLoading ? "…" : "Confirm"}</button>
            </div>
          )}
          {otpError && <p style={{ color: "#E53935", fontSize: "0.8rem", marginTop: "0.4rem" }}>{otpError}</p>}
          {!otpSent && <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "0.35rem" }}>Used for booking notifications. Changing your number requires verification.</p>}
          {otpSent && !otpVerified && <p style={{ fontSize: "0.75rem", color: "var(--nude)", marginTop: "0.35rem" }}>A 6-digit code was sent to your WhatsApp. Enter it above.</p>}
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
 
      // Record R5 charge (status = pending until PayFast confirms)
      // In practice you'd initiate PayFast here; for now just log the intent
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
      const payload = {
        name: form.name,
        description: form.description,
        address: form.address,
        suburb: form.suburb,
        city: form.city,
        phone: form.phone,
        email: form.email,
        website: form.website || null,
        opening_hours: form.opening_hours,
        gallery_urls: galleryUrls,
        instagram_username: form.instagram_username || null,
        youtube_url: form.youtube_url || null,
        services: form.services,
        partner_id: userId,
        status: "pending",
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
      .select("*")
      .eq("salon_id", salonId)
      .order("booking_date", { ascending: true })
      .then(({ data }) => {
        setBookings((data as StoreBooking[]) ?? []);
        setLoading(false);
      });
  }, [salonId]);
 
  const updateStatus = async (id: string, status: string) => {
    await supabase.from("store_bookings").update({ status }).eq("id", id);
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
              <button onClick={() => updateStatus(b.id, "completed")}
                style={{ padding: "0.4rem 1rem", borderRadius: 100, border: "none", background: "#E6F1FB", color: "#185FA5", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
                Mark completed
              </button>
            )}
          </div>
        );
      })}
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
  const [innerTab, setInnerTab] = useState<"listing" | "bookings">("listing");
 
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
 
  if (loading) return <p style={{ color: "var(--grey)" }}>Loading…</p>;
 
  // ── Add form (no existing listing) ──
  if (listings.length === 0 && (showForm || true)) {
    if (showForm) return (
      <SalonForm initial={emptySalon()} userId={user.id} onSaved={handleSaved}
        onCancel={() => setShowForm(false)} isEdit={false} />
    );
    return (
      <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "2rem", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", marginBottom: "0.5rem" }}>List your store on Umuhle</p>
        <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
          Appear in the Stores page and receive appointment bookings directly.
        </p>
        <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.75rem 2rem", borderRadius: 100, fontWeight: 600 }}>
          Add your store
        </button>
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
        {(["listing","bookings"] as const).map((t, i) => (
          <button key={t} onClick={() => setInnerTab(t)} style={{
            padding: "0.5rem 1.25rem", border: "none", cursor: "pointer", fontSize: "0.85rem",
            background: innerTab === t ? "var(--plum)" : "#fff",
            color: innerTab === t ? "#fff" : "var(--grey)",
            fontWeight: innerTab === t ? 600 : 400,
            borderRight: i === 0 ? "1.5px solid rgba(155,127,184,0.2)" : "none",
          }}>
            {t === "listing" ? "Listing" : "Bookings"}
          </button>
        ))}
      </div>
 
      {innerTab === "listing" && (
        <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0.75rem" }}>{listing.name}</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "0.5rem" }}>📍 {listing.address}, {listing.suburb}</p>
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
      )}
 
      {innerTab === "bookings" && listing.id && (
        <SalonBookingsInbox salonId={listing.id} />
      )}
    </div>
  );
}

// ─── My Services tab ───────────────────────────────────────────────────────────
// Each service category has a repeater for style tags.
type ServiceStyles = Record<ServiceTypeId, string[]>;

function MyServicesTab({ profile, user, onUpdate }: { profile: Profile; user: User; onUpdate: (p: Profile) => void }) {
  const supabase = createClient();
  const [selected, setSelected] = useState<string[]>(profile.artist_category ? [profile.artist_category] : []);
  const [styles, setStyles] = useState<ServiceStyles>({ hair: [], nails: [], makeup: [], lashes: [] });
  const [styleInputs, setStyleInputs] = useState<Record<ServiceTypeId, string>>({ hair: "", nails: "", makeup: "", lashes: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadingStyles, setLoadingStyles] = useState(true);

  // Load existing styles from DB on mount
  useEffect(() => {
    supabase
      .from("artist_service_styles")
      .select("category, style")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (data) {
          const grouped: ServiceStyles = { hair: [], nails: [], makeup: [], lashes: [] };
          for (const row of data as { category: ServiceTypeId; style: string }[]) {
            if (grouped[row.category]) grouped[row.category].push(row.style);
          }
          setStyles(grouped);
        }
        setLoadingStyles(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const toggle = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const addStyle = (cat: ServiceTypeId) => {
    const val = styleInputs[cat].trim();
    if (!val) return;
    if (styles[cat].includes(val)) { setStyleInputs(i => ({ ...i, [cat]: "" })); return; }
    setStyles(s => ({ ...s, [cat]: [...s[cat], val] }));
    setStyleInputs(i => ({ ...i, [cat]: "" }));
  };

  const removeStyle = (cat: ServiceTypeId, idx: number) => {
    setStyles(s => ({ ...s, [cat]: s[cat].filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      const primary = selected[0] ?? null;

      // Update profile category
      const { data, error: err } = await supabase
        .from("profiles")
        .update({ artist_category: primary as Profile["artist_category"], updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select()
        .single();
      if (err) throw err;

      // Upsert styles: delete existing, re-insert
      await supabase.from("artist_service_styles").delete().eq("user_id", user.id);
      const rows: { user_id: string; category: ServiceTypeId; style: string }[] = [];
      for (const cat of selected as ServiceTypeId[]) {
        for (const style of styles[cat]) {
          rows.push({ user_id: user.id, category: cat, style });
        }
      }
      if (rows.length > 0) {
        const { error: insertErr } = await supabase.from("artist_service_styles").insert(rows);
        if (insertErr) throw insertErr;
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
        Select the beauty services you offer and list the styles you specialise in. Clients search by style — the more specific, the better.
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
                    {/* Tag list */}
                    {styles[s.id].length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
                        {styles[s.id].map((style, idx) => (
                          <span key={idx} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "var(--plum-t)", color: "var(--plum)", borderRadius: 100, padding: "0.25rem 0.75rem", fontSize: "0.82rem", fontWeight: 500 }}>
                            {style}
                            <button
                              type="button"
                              onClick={() => removeStyle(s.id, idx)}
                              style={{ background: "none", border: "none", color: "var(--plum)", cursor: "pointer", padding: "0 0.1rem", fontSize: "0.75rem", lineHeight: 1, display: "flex", alignItems: "center" }}
                              aria-label={`Remove ${style}`}
                            >✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Add input */}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        value={styleInputs[s.id]}
                        onChange={e => setStyleInputs(i => ({ ...i, [s.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStyle(s.id); } }}
                        placeholder={`e.g. ${s.id === "hair" ? "Dreadlocks" : s.id === "nails" ? "Gel extensions" : s.id === "makeup" ? "Bridal glam" : "Volume lashes"}`}
                        style={{ flex: 1, padding: "0.6rem 0.9rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.88rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => addStyle(s.id)}
                        style={{ flexShrink: 0, background: "var(--plum)", color: "#fff", border: "none", borderRadius: 10, padding: "0.6rem 1rem", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" }}
                      >Add</button>
                    </div>
                    <p style={{ fontSize: "0.73rem", color: "var(--light)", marginTop: "0.35rem" }}>Press Enter or click Add. These become searchable tags on Umuhle.</p>
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
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 440, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
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
  const [bookings, setBookings] = useState<BookingWithRelations[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [showPocPopup, setShowPocPopup] = useState(false);
  const [pocSaving, setPocSaving] = useState(false);

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
    setBookings((data ?? []) as unknown as BookingWithRelations[]);
    setBookingsLoading(false);
  }, [user.id, bookingFilter, supabase]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

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
      {!bookingsLoading && bookings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {bookings.map(b => <BookingCard key={b.id} booking={b} />)}
        </div>
      )}

      {showPocPopup && (
        <PocPopup
          onSave={handleSavePoc}
          onDismiss={() => setShowPocPopup(false)}
        />
      )}
      {pocSaving && <div style={{ display: "none" }} />}
    </section>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab]         = useState<Tab>("bookings");
  const [loading, setLoading] = useState(true);

  const [wishlist, setWishlist]   = useState<WishlistArtist[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(false);

  const [showWhatsAppNudge, setShowWhatsAppNudge] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

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
      setProfile(data as Profile);
      if (!data.phone) setTimeout(() => setShowWhatsAppNudge(true), 1500);
    }
    setLoading(false);
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
    { id: "bookings",    label: "Bookings",   icon: "📅" },
    { id: "wishlist",    label: "Wishlist",   icon: "💜" },
    { id: "my-store",    label: "My Store",   icon: "✂️" },
    { id: "my-services", label: "Services",   icon: "💅" },
    { id: "invite",      label: "Invite",     icon: "🎁" },
    { id: "profile",     label: "Profile",    icon: "👤" },
  ];

  // Suppress unused-var warning — kept for potential header use
  void handleSignOut;

  // Primary tabs shown in bottom action bar (mobile) — most used
  const PRIMARY_TABS: Tab[] = ["bookings", "wishlist", "my-store", "my-services", "profile"];
  const MORE_TABS = TAB_CONFIG.filter(t => !PRIMARY_TABS.includes(t.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FAFAFA" }}>
      <SiteHeader initialUser={user} initialProfile={profile} />

      {/* ── WhatsApp incomplete nudge ── */}
      {showWhatsAppNudge && (
        <div className="modal-overlay" onClick={() => setShowWhatsAppNudge(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 380, boxShadow: "0 24px 80px rgba(0,0,0,0.15)", textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📱</div>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Complete your profile</h3>
            <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>Your profile is missing a WhatsApp number. Add it so you can receive booking confirmations and service updates.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <button className="btn-plum" onClick={() => { setShowWhatsAppNudge(false); setTab("profile"); }} style={{ width: "100%", padding: "0.75rem" }}>Add WhatsApp number</button>
              <button onClick={() => setShowWhatsAppNudge(false)} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.85rem", cursor: "pointer" }}>Remind me later</button>
            </div>
          </div>
        </div>
      )}

      {/* ── More menu overlay (mobile) ── */}
      {showMoreMenu && (
        <div className="modal-overlay" onClick={() => setShowMoreMenu(false)} style={{ alignItems: "flex-end", padding: 0 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1.25rem 1rem 2rem", width: "100%", maxWidth: 480, boxShadow: "0 -8px 40px rgba(0,0,0,0.12)" }}>
            <div style={{ width: 40, height: 4, background: "#E0E0E0", borderRadius: 2, margin: "0 auto 1.25rem" }} />
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem", paddingLeft: "0.5rem" }}>More</p>
            {MORE_TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setShowMoreMenu(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "1rem", padding: "0.85rem 0.75rem", borderRadius: 14, border: "none", background: tab === t.id ? "var(--plum-t)" : "transparent", cursor: "pointer", textAlign: "left", transition: "background 0.15s" }}>
                <span style={{ fontSize: "1.3rem", width: 28 }}>{t.icon}</span>
                <span style={{ fontSize: "0.95rem", fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? "var(--plum)" : "var(--onyx)" }}>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <main style={{ flex: 1, maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem 6rem", width: "100%", boxSizing: "border-box" }}>
        {/* ── Header ── */}
        <div style={{ marginBottom: "2rem" }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "0.75rem", letterSpacing: "0.3em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Welcome back</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(1.75rem,4vw,2.5rem)", color: "var(--onyx)", marginBottom: "0.5rem" }}>{profile.full_name?.split(" ")[0] ?? "Beautiful"}</h1>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>{user.email}</p>
        </div>

        {/* ── Desktop Tabs (hidden on mobile) ── */}
        <div className="dashboard-desktop-tabs">
          <PillNav tabs={TAB_CONFIG} active={tab} onChange={setTab} />
        </div>

        {/* ── Bookings tab ── */}
        {tab === "bookings" && <BookingsTab user={user} profile={profile} onUpdateProfile={p => { setProfile(p); if (p.phone) setShowWhatsAppNudge(false); }} />}

        {/* ── Wishlist tab ── */}
        {tab === "wishlist" && (
          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem" }}>Saved artists <span style={{ fontSize: "0.9rem", color: "var(--grey)", fontFamily: "var(--font-body)", fontWeight: 400, marginLeft: "0.5rem" }}>({wishlist.length})</span></h2>
            </div>
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
          </section>
        )}

        {/* ── Profile tab ── */}
        {tab === "profile" && <section><ProfileTab profile={profile} user={user} onUpdate={(p) => { setProfile(p); if (p.phone) setShowWhatsAppNudge(false); }} /></section>}

        {/* ── My Salon tab ── */}
        {tab === "my-store" && <section><MySalonTab user={user} /></section>}

        {/* ── My Services tab ── */}
        {tab === "my-services" && <section><MyServicesTab profile={profile} user={user} onUpdate={(p) => setProfile(p)} /></section>}

        {/* ── Invite tab ── */}
        {tab === "invite" && <section><InviteTab profile={profile} /></section>}
      </main>

      {/* ── Mobile Bottom Action Bar ── */}
      <nav className="dashboard-bottom-bar">
        {PRIMARY_TABS.map(id => {
          const t = TAB_CONFIG.find(x => x.id === id)!;
          const isActive = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: "0.2rem", padding: "0.6rem 0.25rem", border: "none", background: "transparent",
              cursor: "pointer", borderRadius: 12, transition: "background 0.15s",
            }}>
              <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: "0.68rem", fontWeight: isActive ? 600 : 400, color: isActive ? "var(--plum)" : "var(--grey)", letterSpacing: "0.01em" }}>{t.label}</span>
              {isActive && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--plum)", marginTop: "0.1rem" }} />}
            </button>
          );
        })}
        {/* More button */}
        <button onClick={() => setShowMoreMenu(true)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: "0.2rem", padding: "0.6rem 0.25rem", border: "none", background: "transparent", cursor: "pointer", borderRadius: 12,
        }}>
          <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>⋯</span>
          <span style={{ fontSize: "0.68rem", fontWeight: 400, color: "var(--grey)" }}>More</span>
        </button>
      </nav>

      <Footer />
    </div>
  );
}
