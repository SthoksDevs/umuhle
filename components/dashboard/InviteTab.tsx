"use client";

// components/dashboard/InviteTab.tsx
//
// The referral program tab — shared across all three DashboardShell roles
// (customer/artist/owner). Split out of the old app/dashboard/page.tsx
// monolith — see docs/role-based-dashboards-status.md.

import { useState } from "react";
import type { Profile } from "@/types";
import Link from "next/link";

export default function InviteTab({ profile }: { profile: Profile }) {
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

