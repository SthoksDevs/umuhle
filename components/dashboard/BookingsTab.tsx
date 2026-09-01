"use client";

// components/dashboard/BookingsTab.tsx
//
// The personal "Bookings" tab: has a built-in client/artist toggle (an
// artist sees both the bookings they've made as a client AND the bookings
// clients have made with them; a plain customer only sees the client
// view). Distinct from MySalonTab.tsx's SalonBookingsInbox, which is the
// branch-wide booking inbox for a store's staff, gated by
// can_manage_calendar. Split out of the old app/dashboard/page.tsx
// monolith — see docs/role-based-dashboards-status.md.

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, Artist } from "@/types";
import StarRating from "@/components/StarRating";
import ReviewModal, { type SubmittedReview } from "@/components/ReviewModal";
import { computeReliabilityScore } from "@/lib/reliability";
import { fmt, formatDate, ICON } from "@/lib/dashboard/format";
import type { BookingWithRelations } from "@/lib/dashboard/types";
import { STATUS_STYLES } from "@/lib/dashboard/types";

// booking_id -> the review the current user already left for it, if any.
// Shared shape returned by GET /api/reviews?bookingIds=...
type MyReviewMap = Record<string, { rating: number; comment: string | null; created_at: string }>;

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
export default function BookingsTab({ user, profile, onUpdateProfile }: { user: User; profile: Profile; onUpdateProfile: (p: Profile) => void }) {
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