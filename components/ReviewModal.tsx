"use client";

// components/ReviewModal.tsx
//
// Shared "leave a review" modal for completed bookings, used from both
// sides — a client rating the artist, and an artist rating the client
// (see the dashboard Bookings tab). Always tied to a specific bookingId;
// the API infers which of the two review_types this is from the caller's
// relationship to that booking, so this component doesn't need to know.

import { useState } from "react";
import Image from "next/image";
import StarRating from "./StarRating";

export interface SubmittedReview {
  rating: number;
  comment: string | null;
}

const NOT_REBOOK_REASONS: { id: string; label: string }[] = [
  { id: "price", label: "Price" },
  { id: "quality", label: "Quality" },
  { id: "punctuality", label: "Punctuality" },
  { id: "communication", label: "Communication" },
  { id: "cleanliness", label: "Cleanliness" },
  { id: "other", label: "Other" },
];

const REBOOK_INTERVALS: { label: string; days: number }[] = [
  { label: "2 weeks", days: 14 },
  { label: "3 weeks", days: 21 },
  { label: "4 weeks", days: 28 },
  { label: "6 weeks", days: 42 },
  { label: "3 months", days: 90 },
];

export default function ReviewModal({
  bookingId,
  revieweeName,
  revieweeAvatarUrl,
  role,
  onClose,
  onSubmitted,
}: {
  bookingId: string;
  revieweeName: string;
  revieweeAvatarUrl?: string | null;
  /** Which side the CURRENT user is on for this booking. */
  role: "client" | "artist";
  onClose: () => void;
  onSubmitted: (review: SubmittedReview) => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Satisfaction survey — client_to_artist only (see reviews_survey_scope_
  // check). "Would you book again" defaults to unanswered (null), not
  // false, so someone who just submits the star rating and skips the rest
  // doesn't silently register as a "no" and trigger nothing weird.
  const [wouldRebook, setWouldRebook] = useState<boolean | null>(null);
  const [notRebookReason, setNotRebookReason] = useState<string | null>(null);
  const [rebookIntervalDays, setRebookIntervalDays] = useState<number | null>(null);
  const [customIntervalDays, setCustomIntervalDays] = useState("");
  const [npsScore, setNpsScore] = useState<number | null>(null);

  const title = role === "client" ? "Rate your artist" : "Rate your client";
  const placeholder =
    role === "client"
      ? "Optional — tell others about your experience. This is shown on the artist's profile."
      : "Optional — private feedback about this client. Not shown publicly.";

  const handleSubmit = async () => {
    if (rating < 1) { setError("Please select a star rating."); return; }
    setLoading(true);
    setError("");
    try {
      const customDays = Number(customIntervalDays);
      const finalIntervalDays = rebookIntervalDays ?? (Number.isInteger(customDays) && customDays > 0 && customDays <= 730 ? customDays : null);
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId, rating, comment: comment.trim() || undefined,
          ...(role === "client" ? {
            wouldRebook,
            notRebookReason: wouldRebook === false ? notRebookReason : undefined,
            rebookIntervalDays: wouldRebook !== false ? finalIntervalDays : undefined,
            npsScore,
          } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't submit your review. Please try again.");
      onSubmitted({ rating, comment: comment.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <Image src={revieweeAvatarUrl || "/umuhle-icon.png"} alt={revieweeName} width={44} height={44} style={{ borderRadius: "50%", objectFit: "cover" }} />
            <div>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.1rem", margin: 0 }}>{title}</h3>
              <p style={{ color: "var(--grey)", fontSize: "0.82rem", margin: 0 }}>{revieweeName}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: "1.4rem", color: "var(--light)", lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
          <StarRating interactive value={rating} onChange={setRating} size={34} />
        </div>

        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={placeholder}
          rows={3}
          maxLength={500}
          style={{
            width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0",
            fontSize: "0.9rem", fontFamily: "var(--font-body)", resize: "none", boxSizing: "border-box", marginBottom: "1.25rem",
          }}
        />

        {role === "client" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", marginBottom: "1.25rem", paddingTop: "1rem", borderTop: "1px dashed rgba(155,127,184,0.2)" }}>
            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Would you book with {revieweeName} again?</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" onClick={() => setWouldRebook(true)} style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: `1.5px solid ${wouldRebook === true ? "var(--plum)" : "#E0E0E0"}`, background: wouldRebook === true ? "rgba(155,127,184,0.08)" : "#fff", fontSize: "0.85rem", cursor: "pointer" }}>Yes</button>
                <button type="button" onClick={() => setWouldRebook(false)} style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: `1.5px solid ${wouldRebook === false ? "var(--plum)" : "#E0E0E0"}`, background: wouldRebook === false ? "rgba(155,127,184,0.08)" : "#fff", fontSize: "0.85rem", cursor: "pointer" }}>No</button>
              </div>
            </div>

            {wouldRebook === false && (
              <div>
                <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>What didn't work for you?</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {NOT_REBOOK_REASONS.map(r => (
                    <button key={r.id} type="button" onClick={() => setNotRebookReason(r.id)} style={{ padding: "0.35rem 0.75rem", borderRadius: 100, border: `1.5px solid ${notRebookReason === r.id ? "var(--plum)" : "#E0E0E0"}`, background: notRebookReason === r.id ? "rgba(155,127,184,0.08)" : "#fff", fontSize: "0.78rem", cursor: "pointer" }}>{r.label}</button>
                  ))}
                </div>
              </div>
            )}

            {wouldRebook !== false && (
              <div>
                <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>How soon should we remind you to book again?</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
                  {REBOOK_INTERVALS.map(opt => (
                    <button key={opt.days} type="button" onClick={() => { setRebookIntervalDays(opt.days); setCustomIntervalDays(""); }} style={{ padding: "0.35rem 0.75rem", borderRadius: 100, border: `1.5px solid ${rebookIntervalDays === opt.days ? "var(--plum)" : "#E0E0E0"}`, background: rebookIntervalDays === opt.days ? "rgba(155,127,184,0.08)" : "#fff", fontSize: "0.78rem", cursor: "pointer" }}>{opt.label}</button>
                  ))}
                </div>
                <input
                  type="number" min={1} max={730} placeholder="Or enter custom days"
                  value={customIntervalDays}
                  onChange={e => { setCustomIntervalDays(e.target.value); setRebookIntervalDays(null); }}
                  style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.82rem", boxSizing: "border-box" }}
                />
                <p style={{ fontSize: "0.72rem", color: "var(--light)", marginTop: "0.4rem" }}>Skip this if you'd rather not be reminded.</p>
              </div>
            )}

            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>How likely are you to recommend {revieweeName} to a friend?</p>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {Array.from({ length: 11 }, (_, n) => n).map(n => (
                  <button key={n} type="button" onClick={() => setNpsScore(n)} style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${npsScore === n ? "var(--plum)" : "#E0E0E0"}`, background: npsScore === n ? "var(--plum)" : "#fff", color: npsScore === n ? "#fff" : "#333", fontSize: "0.78rem", cursor: "pointer" }}>{n}</button>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--light)", marginTop: "0.25rem" }}>
                <span>Not likely</span><span>Very likely</span>
              </div>
            </div>
          </div>
        )}

        {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

        <button className="btn-plum" style={{ width: "100%", padding: "0.85rem" }} disabled={loading || rating < 1} onClick={handleSubmit}>
          {loading ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </div>
  );
}
