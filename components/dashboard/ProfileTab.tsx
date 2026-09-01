"use client";

// components/dashboard/ProfileTab.tsx
//
// The "Profile" tab: personal details, password/security, WhatsApp
// notification opt-in, and (for artists/partners) the review-insights
// upsell card + fulfillment-address settings. Split out of the old
// app/dashboard/page.tsx monolith — see
// docs/role-based-dashboards-status.md.
//
// Shown on all three DashboardShell routes (customer/artist/owner) — an
// employee's password lives in Supabase Auth only and never touches this
// component; see components/dashboard/EmployeeDashboard.tsx.

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, Province } from "@/types";
import { SA_PROVINCES } from "@/types";
import { getProvince } from "@/lib/provinces";
import Image from "next/image";
import type { GeoStatus } from "@/lib/geolocation";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push-client";
import { normalizePhone, isValidSAMobile } from "@/lib/phone";
import { DELIVERY_ARRANGEMENT_OPTIONS, type DeliveryArrangementMethod } from "@/lib/deliveryArrangement";
import { ICON, COURIER_CHECKOUT_ENABLED } from "@/lib/dashboard/format";
import AddressAutocomplete, { type GeocodeSuggestion } from "@/components/dashboard/AddressAutocomplete";

export default function ProfileTab({ profile, user, locationStatus, onUpdate }: { profile: Profile; user: User; locationStatus: GeoStatus; onUpdate: (p: Profile) => void }) {
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

      {(profile.is_artist || profile.is_partner) && <ReviewInsightsCard />}

      {profile.is_partner && <PartnerFulfillmentSettings profile={profile} onUpdate={onUpdate} />}
    </div>
  );
}

// ── ReviewInsightsCard ───────────────────────────────────────────────────────
// Paid feature (see 20260827_feature_subscriptions.sql): a weekly digest
// of what clients said, grouped into what's working and what's not.
// Only the free-trial-signup half is built — converting a lapsed trial
// into an actual paid subscription needs a real price decision and a
// PayFast flow of its own, so "past trial with no payment" just quietly
// stops sending rather than trying to charge anyone yet.
function ReviewInsightsCard() {
  const [subscription, setSubscription] = useState<{ status: string; trial_ends_at: string | null; valid_until: string | null } | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/feature-subscriptions/review-insights")
      .then(res => res.json())
      .then(data => setSubscription(data.subscription))
      .catch(() => setSubscription(null));
  }, []);

  const handleStartTrial = async () => {
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/feature-subscriptions/review-insights", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start your trial.");
      setSubscription(data.subscription);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setStarting(false);
    }
  };

  if (subscription === undefined) return null; // still loading — avoid a flash of the wrong state

  return (
    <div style={{ marginTop: "1.5rem", background: "#FAFAFA", borderRadius: 16, padding: "1.25rem", border: "1.5px solid #E0E0E0" }}>
      <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--onyx)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>💌 Review insights</p>
      {!subscription && (
        <>
          <p style={{ fontSize: "0.85rem", color: "var(--grey)", marginBottom: "0.75rem" }}>
            A weekly email summarising what clients loved and what needs work — without having to read through every review yourself. Free for 30 days.
          </p>
          {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</p>}
          <button onClick={handleStartTrial} disabled={starting} className="btn-plum" style={{ padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}>
            {starting ? "Starting…" : "Start free 30-day trial"}
          </button>
        </>
      )}
      {subscription?.status === "trialing" && (
        <p style={{ fontSize: "0.85rem", color: "var(--grey)" }}>
          Your free trial is active until {subscription.trial_ends_at?.slice(0, 10)}. Your first digest lands with your next batch of reviews.
        </p>
      )}
      {subscription?.status === "active" && (
        <p style={{ fontSize: "0.85rem", color: "var(--grey)" }}>Active{subscription.valid_until ? ` until ${subscription.valid_until}` : ""}.</p>
      )}
      {subscription?.status === "expired" && (
        <p style={{ fontSize: "0.85rem", color: "var(--grey)" }}>Your trial's ended — digests have paused. Reach out to info@umuhle.co.za if you'd like to continue.</p>
      )}
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
