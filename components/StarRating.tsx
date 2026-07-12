"use client";

// components/StarRating.tsx
//
// Shared star rating display + input, used on artist cards, the booking
// drawer, and the review flow (dashboard). Two modes:
//   - display (default): renders `rating` out of 5, with smooth partial
//     fill (e.g. 4.3 stars fills the 5th star 30% of the way), optionally
//     followed by the numeric value and a review count.
//   - interactive: renders 5 tappable stars for collecting a 1-5 rating
//     (used inside ReviewModal).

import { useState } from "react";

const STAR_PATH = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
const GOLD = "#F4B400";
const EMPTY = "#E7E1EC";

function StarShape({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }} aria-hidden="true">
      <path d={STAR_PATH} fill={color} />
    </svg>
  );
}

/** A single star, filled left-to-right by `fillPercent` (0-100). */
function PartialStar({ size, fillPercent }: { size: number; fillPercent: number }) {
  const pct = Math.max(0, Math.min(100, fillPercent));
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, lineHeight: 0 }}>
      <StarShape size={size} color={EMPTY} />
      <span style={{ position: "absolute", inset: 0, overflow: "hidden", width: `${pct}%` }}>
        <StarShape size={size} color={GOLD} />
      </span>
    </span>
  );
}

interface StarRatingProps {
  /** Average rating out of 5, e.g. artist.rating. Ignored in interactive mode. */
  rating?: number;
  /** Shown as "(N)" next to the numeric value, if provided. */
  reviewCount?: number;
  /** Star size in px. Defaults to 14 (display) or 30 (interactive). */
  size?: number;
  /** Whether to show the numeric rating (and count) next to the stars. Display mode only. */
  showValue?: boolean;
  /** Switches to a tappable 1-5 input. */
  interactive?: boolean;
  /** Current selected value, interactive mode only. */
  value?: number;
  /** Called with the newly selected 1-5 value, interactive mode only. */
  onChange?: (value: number) => void;
}

export default function StarRating({
  rating = 0,
  reviewCount,
  size,
  showValue = true,
  interactive = false,
  value = 0,
  onChange,
}: StarRatingProps) {
  const [hover, setHover] = useState(0);

  if (interactive) {
    const s = size ?? 30;
    const current = hover || value;
    return (
      <div
        role="radiogroup"
        aria-label="Star rating"
        style={{ display: "inline-flex", gap: 4 }}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => onChange?.(n)}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            style={{ background: "none", border: "none", padding: 3, cursor: "pointer", lineHeight: 0 }}
          >
            <StarShape size={s} color={n <= current ? GOLD : EMPTY} />
          </button>
        ))}
      </div>
    );
  }

  const s = size ?? 14;
  const r = Number.isFinite(rating) ? rating : 0;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ display: "inline-flex", gap: 1 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <PartialStar key={i} size={s} fillPercent={(r - i) * 100} />
        ))}
      </span>
      {showValue && (
        <span style={{ fontSize: Math.round(s * 0.8), color: "var(--grey)", fontWeight: 500 }}>
          {r.toFixed(1)}
          {reviewCount !== undefined && <span style={{ color: "var(--light)", fontWeight: 400 }}> ({reviewCount})</span>}
        </span>
      )}
    </span>
  );
}
