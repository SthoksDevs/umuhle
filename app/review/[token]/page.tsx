"use client";

// app/review/[token]/page.tsx
//
// The page someone lands on from a "Rate your experience" link — sent by
// email/WhatsApp once a booking is completed, a product delivery is
// confirmed, or a salon visit is completed (see lib/review-invites.ts and
// its call sites). No login: the token in the URL already identifies both
// the reviewer and the thing being reviewed server-side (see
// app/api/reviews/invite/[token]/route.ts) — this page never asks who you
// are, it just asks how it went.

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import StarRating from "@/components/StarRating";

const ICON = "/umuhle-icon.png";

type ReviewType = "client_to_artist" | "artist_to_client" | "client_to_salon" | "client_to_product";

interface InviteInfo {
  reviewType: ReviewType;
  targetName: string;
  targetImage: string | null;
  subtitle: string | null;
  alreadyReviewed: boolean;
}

const COPY: Record<ReviewType, { heading: string; placeholder: string; fallbackEmoji: string; thanks: string }> = {
  client_to_artist: {
    heading: "Rate your artist",
    placeholder: "Optional — tell others about your experience. This is shown on the artist's profile.",
    fallbackEmoji: "💅",
    thanks: "Your review helps other clients find great artists.",
  },
  artist_to_client: {
    heading: "Rate your client",
    placeholder: "Optional — private feedback about this client. Not shown publicly.",
    fallbackEmoji: "🙋",
    thanks: "Thanks for the feedback.",
  },
  client_to_product: {
    heading: "Rate this product",
    placeholder: "Optional — tell other shoppers what you thought. This is shown on the product page.",
    fallbackEmoji: "🛍️",
    thanks: "Your review helps other shoppers decide.",
  },
  client_to_salon: {
    heading: "Rate this salon",
    placeholder: "Optional — tell others about your visit. This is shown on the salon's page.",
    fallbackEmoji: "🏠",
    thanks: "Your review helps other clients find great salons.",
  },
};

export default function ReviewInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/reviews/invite/${token}`);
      if (!res.ok) { setNotFound(true); return; }
      const json = (await res.json()) as InviteInfo;
      setInfo(json);
      if (json.alreadyReviewed) setSubmitted(true);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (rating < 1) { setError("Please select a star rating."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A 409 here means it was already reviewed (e.g. the link was used
        // twice) — treat that as success rather than an error.
        if (res.status === 409) { setSubmitted(true); return; }
        setError(json?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const copy = info ? COPY[info.reviewType] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FAFAFA" }}>
      <SiteHeader initialUser={null} />

      <main style={{ flex: 1, maxWidth: 480, margin: "0 auto", padding: "3.5rem 1.5rem 5rem", width: "100%", boxSizing: "border-box", textAlign: "center" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "3rem 0" }}>
            <Image src={ICON} alt="Umuhle" width={44} height={44} style={{ borderRadius: "50%" }} />
          </div>
        ) : notFound ? (
          <>
            <p style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🔗</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", marginBottom: "0.5rem", color: "var(--onyx)" }}>
              This link isn&apos;t valid
            </h1>
            <p style={{ color: "var(--grey)" }}>
              It may be incomplete, or already used. If you think this is a mistake, get in touch with us at info@umuhle.co.za.
            </p>
          </>
        ) : submitted ? (
          <>
            <p style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✓</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", marginBottom: "0.5rem", color: "var(--onyx)" }}>
              Thanks for your review!
            </h1>
            <p style={{ color: "var(--grey)" }}>
              {copy?.thanks ?? "Your feedback has been recorded."}
            </p>
          </>
        ) : info && copy ? (
          <>
            <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem", marginBottom: "1.75rem", display: "flex", alignItems: "center", gap: "1rem", textAlign: "left" }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                {info.targetImage ? (
                  <Image src={info.targetImage} alt={info.targetName} width={56} height={56} style={{ objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "1.3rem" }}>{copy.fallbackEmoji}</span>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 500, fontSize: "0.95rem", margin: "0 0 0.15rem" }}>{info.targetName}</p>
                {info.subtitle && <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>{info.subtitle}</p>}
              </div>
            </div>

            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", marginBottom: "1.5rem", color: "var(--onyx)" }}>
              {copy.heading}
            </h1>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
              <StarRating interactive value={rating} onChange={setRating} size={40} />
            </div>

            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={copy.placeholder}
              rows={4}
              maxLength={500}
              style={{
                width: "100%", padding: "0.85rem 1rem", borderRadius: 14, border: "1.5px solid #E0E0E0",
                fontSize: "0.9rem", fontFamily: "var(--font-body)", resize: "none", boxSizing: "border-box", marginBottom: "1.25rem",
                textAlign: "left",
              }}
            />

            {error && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting || rating < 1}
              className="btn-plum"
              style={{ width: "100%", padding: "0.85rem", fontSize: "0.95rem", opacity: rating < 1 ? 0.6 : 1 }}
            >
              {submitting ? "Submitting…" : "Submit review"}
            </button>
          </>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}
