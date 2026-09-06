// lib/validation.ts
//
// Single source of truth for validating guest-supplied contact details
// before they get used downstream. The immediate driver: PayFast
// validates `email_address` itself once the browser POSTs the checkout
// form (see lib/payfast.ts), and rejects the whole thing with a 400
// "malformed email" error if it isn't a plausible address. For a guest
// that's a dead end on PayFast's own hosted page, with no way back to a
// friendly in-app message — see app/api/payfast/initiate/route.ts and
// app/page.tsx's BookingDrawer, which both call isValidEmail() below
// before ever reaching PayFast. A logged-in profile's email doesn't need
// this (already validated at signup), but it's cheap enough to not
// bother special-casing that out.
//
// Deliberately dependency-free (no Node builtins) so it can be imported
// from both server route handlers and "use client" components without
// pulling in anything that breaks the client bundle.
//
// Not RFC 5322-complete — that grammar accepts genuinely obscure but
// valid addresses no gateway needs to support. This is the pragmatic
// "one @, something on each side, a dot somewhere in the domain" shape
// that catches the mistakes guests actually make: typos, a missing
// domain, a missing TLD, stray spaces.

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
