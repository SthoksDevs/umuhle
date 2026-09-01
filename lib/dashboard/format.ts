// lib/dashboard/format.ts
//
// Shared formatting helpers used across components/dashboard/*.tsx.
// Split out of the old 4,911-line app/dashboard/page.tsx monolith as part
// of the role-based dashboard split — see
// docs/role-based-dashboards-status.md for the full history and what's
// still outstanding.
//
// (One casualty of the split: the old file also had a second, unused copy
// of `fmt` called `fmtShop` sitting next to MyShopTab — dead code, dropped
// rather than carried over.)

export const ICON = "/umuhle-icon.png";

// Mirrors lib/shiplogic.ts's isCourierCheckoutEnabled() (see there for the
// full history — this shipped as `!== "false"`, i.e. defaulting ON with no
// live Ship Logic account, which meant checkout silently quoted/charged a
// fabricated mock shipping fee; fixed 2026-08-31 to fail safe: OFF unless
// explicitly opted in). The old monolith kept two hand-copied mirrors of
// this flag (PartnerFulfillmentSettings and DashboardContent) with a
// comment warning to keep them in sync — exactly the kind of duplication
// that let the bug happen in the first place. Both of this file's
// call sites (ProfileTab.tsx, DashboardShell.tsx) now import this one
// instead.
export const COURIER_CHECKOUT_ENABLED = process.env.NEXT_PUBLIC_COURIER_CHECKOUT_ENABLED === "true";

export const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;

export function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}
