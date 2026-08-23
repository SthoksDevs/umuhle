"use client";
// components/DashboardTour.tsx
//
// First-visit spotlight tour of the dashboard sidebar. Targets elements by
// a `data-tour-id` attribute (set on each nav button in app/dashboard/
// page.tsx) rather than taking refs as props, so it stays decoupled from
// the page's internals — any element anywhere can opt into a tour step
// just by adding the attribute.
//
// Triggered once automatically when profile.has_completed_dashboard_tour
// is false, and replayable anytime via the "Take a tour" link in the
// sidebar footer (see app/dashboard/page.tsx). Both paths call onClose()
// when done — the parent persists has_completed_dashboard_tour = true on
// first close, whether the tour was finished or skipped, so it never nags
// twice.
//
// On mobile the sidebar lives behind a drawer (see .dashboard-sidebar in
// app/globals.css — translateX(-102%) when closed), so the parent should
// force the drawer open for the duration of the tour or targets simply
// won't have an on-screen position to spotlight.
import { useEffect, useState, useCallback } from "react";

interface TourStep {
  targetId: string | null; // null = centered welcome/closing card, no spotlight
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  { targetId: null, title: "Welcome to your dashboard", body: "A quick tour of where everything lives — about 20 seconds. Skip anytime." },
  { targetId: "dashboard",   title: "Dashboard",   body: "Your home base — a snapshot of bookings, orders and anything that needs your attention." },
  { targetId: "bookings",    title: "Bookings",    body: "Every appointment you've made or received, with live status updates." },
  { targetId: "my-orders",   title: "Orders",      body: "Anything you've bought or sold — payment, shipping and delivery, all in one place." },
  { targetId: "wishlist",    title: "Saved",       body: "Products and artists you've saved for later." },
  { targetId: "my-business", title: "My Business", body: "Manage your listing, services and products here — this is where selling on Umuhle happens." },
  { targetId: "invite",      title: "Referrals",   body: "Share your referral code and earn rewards when friends book through Umuhle." },
  { targetId: "wallet",      title: "Wallet",      body: "Your earnings, payouts and payment history." },
  { targetId: "profile",     title: "Account",     body: "Your details, WhatsApp number, and notification preferences." },
];

interface Rect { top: number; left: number; width: number; height: number; }

export default function DashboardTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const measure = useCallback(() => {
    const step = STEPS[stepIndex];
    if (!step.targetId) { setRect(null); return; }
    const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [stepIndex]);

  useEffect(() => { if (open) setStepIndex(0); }, [open]);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    // A drawer that just animated open needs a beat before its rect settles.
    const t = setTimeout(measure, 250);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      clearTimeout(t);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const pad = 8;
  const narrow = window.innerWidth < 640;

  const tooltipStyle: React.CSSProperties = rect
    ? narrow
      ? { position: "fixed", top: Math.min(rect.top + rect.height + 12, window.innerHeight - 260), left: 16, right: 16, maxWidth: "none" }
      : { position: "fixed", top: Math.min(rect.top, window.innerHeight - 220), left: Math.min(rect.left + rect.width + 16, window.innerWidth - 320), maxWidth: 300 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", maxWidth: 320, width: narrow ? "calc(100% - 48px)" : 320 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      {/* Dimmed backdrop with a spotlight cutout (box-shadow trick) around the
          target, or a flat dim for the welcome/closing card. */}
      <div
        onClick={onClose}
        style={
          rect
            ? {
                position: "fixed",
                top: rect.top - pad,
                left: rect.left - pad,
                width: rect.width + pad * 2,
                height: rect.height + pad * 2,
                borderRadius: 12,
                boxShadow: "0 0 0 9999px rgba(26,26,26,0.55)",
                transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
                pointerEvents: "none",
              }
            : { position: "fixed", inset: 0, background: "rgba(26,26,26,0.55)" }
        }
      />
      <div style={{ ...tooltipStyle, background: "#fff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", zIndex: 201 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0.4rem" }}>{step.title}</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--grey)", lineHeight: 1.5, marginBottom: "1rem" }}>{step.body}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {STEPS.map((_, i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === stepIndex ? "var(--plum)" : "#E0E0E0" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--light)", fontSize: "0.8rem", cursor: "pointer" }}>Skip</button>
            {stepIndex > 0 && (
              <button onClick={() => setStepIndex(i => Math.max(0, i - 1))} className="btn-outline" style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }}>Back</button>
            )}
            <button onClick={() => (isLast ? onClose() : setStepIndex(i => i + 1))} className="btn-plum" style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }}>
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
