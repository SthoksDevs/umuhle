// lib/analytics.ts
// Shared pixel-tracking helpers, extracted out of app/page.tsx so
// components/AuthModal.tsx can fire the same signup/login events without
// duplicating this file or importing from a page.

declare global {
  interface Window {
    ttq?: { track: (e: string, p?: Record<string, unknown>) => void };
    fbq?: (cmd: string, event: string, params?: Record<string, unknown>) => void;
    gtag?: (...a: unknown[]) => void;
  }
}

export function ttq(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.ttq) window.ttq.track(event, params);
}
export function fbq(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.fbq) window.fbq("track", event, params);
}
export function gTag(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.gtag) window.gtag("event", event, params);
}
