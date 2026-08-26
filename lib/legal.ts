// lib/legal.ts
//
// Single source of truth for "which version of Terms/Privacy is live right
// now". Bump these whenever app/terms-and-conditions or app/privacy-policy
// changes in any way that matters (not typo fixes) — every signed-in user
// whose profile doesn't match gets the re-acceptance modal on next load
// (see app/dashboard/page.tsx) until they accept again via
// app/api/legal/accept, which logs it to terms_acceptance_log.
//
// Versioning is just "v" + an incrementing integer — good enough for an
// audit trail; there's no need to encode dates or semver here.
export const CURRENT_TERMS_VERSION = "v1.0";
export const CURRENT_PRIVACY_VERSION = "v1.0";

export function needsLegalReacceptance(profile: {
  terms_version: string | null;
  privacy_version: string | null;
} | null | undefined): boolean {
  if (!profile) return false;
  return profile.terms_version !== CURRENT_TERMS_VERSION || profile.privacy_version !== CURRENT_PRIVACY_VERSION;
}
