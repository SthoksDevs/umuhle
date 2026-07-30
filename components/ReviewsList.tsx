"use client";

// components/ReviewsList.tsx
//
// Read-only public reviews section, shared by the salon (stores/[id]) and
// product (shop/[id]) detail pages. Fetches from GET /api/reviews, which
// only ever returns moderation_status='approved' rows (see
// app/api/reviews/route.ts) -- nothing unmoderated shows up here.
//
// The summary rating/count come from the parent's already-fetched row
// (partner_salons.rating / products.rating) rather than being recomputed
// from this list, since those columns are the trigger-maintained source of
// truth and this list is paginated (limit=20 below).

import { useState, useEffect } from "react";
import Image from "next/image";
import StarRating from "@/components/StarRating";

interface ReviewerInfo {
  full_name: string | null;
  avatar_url: string | null;
}

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: ReviewerInfo | ReviewerInfo[] | null;
}

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default function ReviewsList({
  salonId,
  productId,
  rating,
  reviewCount,
}: {
  salonId?: string;
  productId?: string;
  rating: number | null | undefined;
  reviewCount: number | null | undefined;
}) {
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null);

  useEffect(() => {
    const param = salonId ? `salonId=${salonId}` : productId ? `productId=${productId}` : null;
    if (!param) return;
    let cancelled = false;
    fetch(`/api/reviews?${param}&limit=20`)
      .then((res) => res.json())
      .then((json) => { if (!cancelled) setReviews(json.reviews ?? []); })
      .catch(() => { if (!cancelled) setReviews([]); });
    return () => { cancelled = true; };
  }, [salonId, productId]);

  const count = reviewCount ?? 0;
  // Nothing to show and nothing coming — skip the section entirely rather
  // than displaying an empty "Reviews (0)" block on every page.
  if (count === 0 && reviews && reviews.length === 0) return null;

  return (
    <div style={{ marginTop: "4rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", color: "var(--onyx)", margin: 0 }}>
          Reviews
        </h2>
        {count > 0 && <StarRating rating={rating ?? 0} reviewCount={count} size={16} />}
      </div>

      {reviews === null ? (
        <p style={{ color: "var(--grey)", fontSize: "0.875rem" }}>Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p style={{ color: "var(--grey)", fontSize: "0.875rem" }}>No reviews yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {reviews.map((r) => {
            const reviewer = Array.isArray(r.reviewer) ? r.reviewer[0] : r.reviewer;
            return (
              <div key={r.id} style={{ display: "flex", gap: "0.85rem", paddingBottom: "1.25rem", borderBottom: "1px solid rgba(155,127,184,0.12)" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", fontSize: "0.8rem", fontWeight: 600, color: "var(--plum)" }}>
                  {reviewer?.avatar_url ? (
                    <Image src={reviewer.avatar_url} alt="" width={38} height={38} style={{ objectFit: "cover" }} />
                  ) : (
                    initials(reviewer?.full_name ?? null)
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <p style={{ fontWeight: 500, fontSize: "0.88rem", margin: 0 }}>{reviewer?.full_name ?? "Umuhle customer"}</p>
                    <span style={{ fontSize: "0.72rem", color: "var(--light)" }}>
                      {new Date(r.created_at).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <StarRating rating={r.rating} showValue={false} size={13} />
                  {r.comment && <p style={{ fontSize: "0.85rem", color: "var(--onyx)", marginTop: "0.4rem", lineHeight: 1.5 }}>{r.comment}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
