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

type Tab = "bookings" | "wishlist" | "profile" | "ads" | "my-store" | "my-services";

const SERVICE_TYPES = [
  { id: "hair",   label: "Hair",   icon: "✂" },
  { id: "nails",  label: "Nails",  icon: "◈" },
  { id: "makeup", label: "Makeup", icon: "◉" },
  { id: "lashes", label: "Lashes", icon: "◎" },
] as const;

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
  tabs: { id: T; label: string }[];
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
      {/* Scroll arrow — mobile only */}
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

// ─── Ads tab ───────────────────────────────────────────────────────────────────
function AdsTab() {
  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>Ads</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem" }}>Promote your services or products to Umuhle users.</p>
      <div style={{ background: "var(--plum-t)", borderRadius: 20, padding: "2.5rem", textAlign: "center", border: "1.5px dashed rgba(155,127,184,0.35)" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📣</div>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>Coming soon</h3>
        <p style={{ color: "var(--grey)", fontSize: "0.875rem" }}>Ad placement and campaign management will be available here. Stay tuned.</p>
      </div>
    </div>
  );
}

// ─── My Store tab ──────────────────────────────────────────────────────────────
type StoreListing = {
  id?: string;
  salon_name: string;
  description: string;
  address: string;
  suburb: string;
  city: string;
  phone: string;
  email: string;
  opening_hours: string;
  status?: "pending" | "approved" | "rejected";
};

function MyStoreTab({ user }: { user: User }) {
  const supabase = createClient();
  const [listing, setListing] = useState<StoreListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<StoreListing>({
    salon_name: "", description: "", address: "", suburb: "", city: "", phone: "", email: "", opening_hours: "",
  });

  useEffect(() => {
    supabase
      .from("store_listings")
      .select("*")
      .eq("owner_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) { setListing(data as StoreListing); setForm(data as StoreListing); }
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(""); setSaved(false);
    try {
      const payload = { ...form, owner_id: user.id, status: "pending" };
      let data, err;
      if (listing?.id) {
        ({ data, error: err } = await supabase.from("store_listings").update(payload).eq("id", listing.id).select().single());
      } else {
        ({ data, error: err } = await supabase.from("store_listings").insert(payload).select().single());
      }
      if (err) throw err;
      setListing(data as StoreListing);
      setSaved(true);
      setShowForm(false);
      setTimeout(() => setSaved(false), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: "var(--grey)", fontSize: "0.9rem" }}>Loading…</div>;

  const inputStyle: React.CSSProperties = { width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" };

  const statusInfo: Record<string, { bg: string; color: string; label: string; desc: string }> = {
    pending:  { bg: "#FFF3E0", color: "#E65100", label: "Under review",  desc: "Your listing has been submitted and is being reviewed by our team. We'll notify you once approved." },
    approved: { bg: "#E8F5E9", color: "#2E7D32", label: "Live",          desc: "Your salon is listed on Umuhle and visible in Nearby Salons search results." },
    rejected: { bg: "#FBE9E7", color: "#BF360C", label: "Not approved",  desc: "Your listing was not approved. Please update the details and resubmit." },
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>My Store</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        List your salon on Umuhle to appear in Nearby Salons search results and reach new clients.
      </p>

      {/* Pricing info */}
      <div style={{ background: "var(--plum-t)", borderRadius: 16, padding: "1.25rem", marginBottom: "1.75rem", border: "1.5px solid rgba(155,127,184,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <p style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--plum)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>Listing fee</p>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--plum)", fontWeight: 500 }}>R35 <span style={{ fontSize: "0.85rem", fontWeight: 400, color: "var(--grey)" }}>/ year</span></p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: "0.8rem", color: "var(--grey)", lineHeight: 1.6 }}>
              Listed in Nearby Salons search<br />
              Salon profile &amp; map location<br />
              Gallery images &amp; opening hours
            </p>
          </div>
        </div>
      </div>

      {/* Existing listing status */}
      {listing && !showForm && (
        <div style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, background: "#fff", padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.15rem", marginBottom: "0.2rem" }}>{listing.salon_name}</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--grey)" }}>{listing.suburb}, {listing.city}</p>
            </div>
            {listing.status && (
              <span style={{ background: statusInfo[listing.status]?.bg, color: statusInfo[listing.status]?.color, borderRadius: 100, padding: "0.3rem 0.9rem", fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                {statusInfo[listing.status]?.label}
              </span>
            )}
          </div>
          <p style={{ fontSize: "0.82rem", color: "var(--grey)", marginBottom: "1rem", lineHeight: 1.5 }}>
            {listing.status && statusInfo[listing.status]?.desc}
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button onClick={() => setShowForm(true)} className="btn-outline" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}>Edit listing</button>
            {listing.status !== "approved" && (
              <button className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }} onClick={() => alert("PayFast payment for listing renewal coming soon!")}>
                Pay R35 &amp; Submit
              </button>
            )}
          </div>
        </div>
      )}

      {saved && (
        <div style={{ background: "#E8F5E9", borderRadius: 12, padding: "0.85rem 1.25rem", marginBottom: "1rem", color: "#2E7D32", fontSize: "0.88rem" }}>
          ✓ Listing saved and sent to admin for review. We'll notify you once approved.
        </div>
      )}

      {/* Add / edit form */}
      {(!listing || showForm) && (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0" }}>
            {listing ? "Edit your listing" : "Add your salon"}
          </h3>

          <div>
            <label style={labelStyle}>Salon name *</label>
            <input required value={form.salon_name} onChange={e => setForm(f => ({ ...f, salon_name: e.target.value }))} placeholder="e.g. Beauty by Thandi" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Tell clients what makes your salon special…" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>Suburb *</label>
              <input required value={form.suburb} onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))} placeholder="e.g. Sandton" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>City *</label>
              <input required value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Johannesburg" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Street address *</label>
            <input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main Street, Sandton" style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>Phone number *</label>
              <input required type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="082 123 4567" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Business email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="hello@yoursalon.co.za" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Opening hours</label>
            <input value={form.opening_hours} onChange={e => setForm(f => ({ ...f, opening_hours: e.target.value }))} placeholder="e.g. Mon–Fri 8am–6pm, Sat 9am–4pm" style={inputStyle} />
          </div>

          <div style={{ background: "#FFF3E0", borderRadius: 12, padding: "1rem 1.25rem", fontSize: "0.83rem", color: "#6D4C41", lineHeight: 1.6 }}>
            <strong>Before submitting:</strong> Your listing will be reviewed by our admin team. Once approved, it will appear in Nearby Salons. A once-off payment of <strong>R35</strong> (renewed annually) is required to publish your listing.
          </div>

          {error && <p style={{ color: "#E53935", fontSize: "0.85rem" }}>{error}</p>}

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="submit" className="btn-plum" disabled={saving} style={{ padding: "0.75rem 2rem" }}>
              {saving ? "Saving…" : listing ? "Save changes" : "Submit listing"}
            </button>
            {showForm && listing && (
              <button type="button" onClick={() => setShowForm(false)} className="btn-outline" style={{ padding: "0.75rem 1.5rem" }}>Cancel</button>
            )}
          </div>
          {!listing && (
            <p style={{ fontSize: "0.78rem", color: "var(--light)" }}>
              After submitting, you will be prompted to pay R35 to publish your listing. Renewal is once per year.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

// ─── My Services tab ───────────────────────────────────────────────────────────
function MyServicesTab({ profile, user, onUpdate }: { profile: Profile; user: User; onUpdate: (p: Profile) => void }) {
  const supabase = createClient();
  const [selected, setSelected] = useState<string[]>(profile.artist_category ? [profile.artist_category] : []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const toggle = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    const primary = selected[0] ?? null;
    const { data, error: err } = await supabase.from("profiles").update({ artist_category: primary as Profile["artist_category"], updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    if (data) { onUpdate(data as Profile); setSaved(true); setTimeout(() => setSaved(false), 3000); }
  };
  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>My Services</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem" }}>Select the beauty services you offer. You can pick one or all.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.75rem" }}>
        {SERVICE_TYPES.map(s => {
          const active = selected.includes(s.id);
          return (
            <button key={s.id} type="button" onClick={() => toggle(s.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "1.5rem 1rem", background: active ? "var(--plum)" : "#fff", color: active ? "#fff" : "var(--grey)", border: `2px solid ${active ? "var(--plum)" : "rgba(155,127,184,0.2)"}`, borderRadius: 16, cursor: "pointer", transition: "all 0.18s", fontFamily: "var(--font-body)", fontSize: "0.9rem", fontWeight: active ? 600 : 400 }}>
              <span style={{ fontSize: "1.75rem" }}>{s.icon}</span>
              {s.label}
              {active && <span style={{ fontSize: "0.7rem", opacity: 0.85 }}>Selected ✓</span>}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && <p style={{ fontSize: "0.82rem", color: "var(--nude)", marginBottom: "1rem" }}>Select at least one service you offer.</p>}
      {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
      {saved && <p style={{ color: "var(--forest)", fontSize: "0.85rem", marginBottom: "1rem" }}>Services saved.</p>}
      <button onClick={handleSave} className="btn-plum" disabled={saving || selected.length === 0} style={{ padding: "0.75rem 2rem" }}>{saving ? "Saving…" : "Save services"}</button>
      <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "1rem" }}>Your listed services help clients find you when searching on Umuhle.</p>
    </div>
  );
}

// ─── Point of Contact popup ────────────────────────────────────────────────────
function PocPopup({ onSave, onDismiss }: { onSave: (name: string, phone: string) => void; onDismiss: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    await onSave(name.trim(), phone.trim());
    setSaving(false);
  };
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onDismiss(); }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Add Point of Contact</h3>
        <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
          Your Point of Contact is someone who can be reached during your appointment — for example a family member or friend. Artists may need to get in touch if there&apos;s an issue at the meeting location. This person is required before any booking can be made.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mama Dlamini" style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "var(--grey)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>WhatsApp number *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder="e.g. 082 123 4567" style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box" }} />
          </div>
          <button className="btn-plum" onClick={handleSave} disabled={saving || !name.trim() || !phone.trim()} style={{ width: "100%", padding: "0.75rem" }}>
            {saving ? "Saving…" : "Save &amp; continue"}
          </button>
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
    const { data } = await supabase.from("profiles").update({ poc_name: name, poc_phone: phone, updated_at: new Date().toISOString() }).eq("id", user.id).select().single();
    setPocSaving(false);
    if (data) { onUpdateProfile(data as Profile); }
    setShowPocPopup(false);
  };

  const inputStyle: React.CSSProperties = { padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" };

  return (
    <section>
      {/* ── Point of Contact section ── */}
      <div style={{ background: hasPoc ? "#E8F5E9" : "var(--plum-t)", border: `1.5px solid ${hasPoc ? "rgba(46,125,50,0.2)" : "rgba(155,127,184,0.2)"}`, borderRadius: 18, padding: "1.25rem 1.5rem", marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
              <span style={{ fontSize: "1.1rem" }}>{hasPoc ? "✅" : "👤"}</span>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", margin: 0, color: hasPoc ? "#2E7D32" : "var(--onyx)" }}>Point of Contact</h3>
            </div>
            <p style={{ fontSize: "0.83rem", color: "var(--grey)", lineHeight: 1.6, marginBottom: hasPoc ? "0.75rem" : 0 }}>
              {hasPoc
                ? "Your Point of Contact is saved. Artists can reach this person if needed during a booking."
                : "A Point of Contact is required before making a booking. This is someone who can be reached on your behalf during your appointment — for safety and peace of mind."}
            </p>
            {hasPoc && (
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: "0.7rem", color: "var(--light)", marginBottom: "0.1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Name</p>
                  <p style={{ fontSize: "0.9rem", fontWeight: 500 }}>{profile.poc_name}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.7rem", color: "var(--light)", marginBottom: "0.1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>WhatsApp</p>
                  <p style={{ fontSize: "0.9rem", fontWeight: 500 }}>{profile.poc_phone}</p>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowPocPopup(true)}
            className={hasPoc ? "btn-outline" : "btn-plum"}
            style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem", flexShrink: 0 }}
          >
            {hasPoc ? "Update" : "Add now"}
          </button>
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

      {/* PoC popup when user clicks "Add now" or "Update" */}
      {showPocPopup && (
        <PocPopup
          onSave={handleSavePoc}
          onDismiss={() => setShowPocPopup(false)}
        />
      )}
      {pocSaving && <div style={{ display: "none" }} />}
      {inputStyle && null}
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

  const TAB_CONFIG: { id: Tab; label: string }[] = [
    { id: "bookings",    label: "My Bookings" },
    { id: "wishlist",    label: "Wishlist" },
    { id: "ads",         label: "Ads" },
    { id: "my-store",    label: "My Store" },
    { id: "my-services", label: "My Services" },
    { id: "profile",     label: "Profile" },
  ];

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

      <main style={{ flex: 1, maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem", width: "100%", boxSizing: "border-box" }}>
        {/* ── Header ── */}
        <div style={{ marginBottom: "2rem" }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "0.75rem", letterSpacing: "0.3em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Welcome back</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(1.75rem,4vw,2.5rem)", color: "var(--onyx)", marginBottom: "0.5rem" }}>{profile.full_name?.split(" ")[0] ?? "Beautiful"}</h1>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>{user.email}</p>
        </div>

        {/* ── Tabs ── */}
        <PillNav tabs={TAB_CONFIG} active={tab} onChange={setTab} />

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

        {/* ── Ads tab ── */}
        {tab === "ads" && <section><AdsTab /></section>}

        {/* ── My Store tab ── */}
        {tab === "my-store" && <section><MyStoreTab user={user} /></section>}

        {/* ── My Services tab ── */}
        {tab === "my-services" && <section><MyServicesTab profile={profile} user={user} onUpdate={(p) => setProfile(p)} /></section>}
      </main>

      <Footer />
    </div>
  );
}