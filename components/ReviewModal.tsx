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
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, rating, comment: comment.trim() || undefined }),
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

        {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

        <button className="btn-plum" style={{ width: "100%", padding: "0.85rem" }} disabled={loading || rating < 1} onClick={handleSubmit}>
          {loading ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </div>
  );
}
