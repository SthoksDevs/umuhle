// lib/phone.ts
//
// Single source of truth for South African phone number normalisation and
// validation, used anywhere a number gets STORED or COMPARED for account
// purposes — signup (components/AuthModal.tsx), profile updates
// (app/dashboard/page.tsx's ProfileTab), and the phone-otp send/verify
// routes (app/api/auth/phone-otp/*). This is the fix for the original
// signup-vs-login mismatch bug: login normalized a phone before matching
// it against profiles.phone, but signup saved whatever the user typed
// (082..., +27..., with spaces, etc.), so some accounts were already
// unmatchable by phone. Every write path now goes through this.
//
// lib/whatsapp.ts keeps its own internal normalisePhone (lowercase 'n',
// not exported) purely for shaping the "to" field of an outgoing WhatsApp
// API call — that one is left as-is to avoid touching a working send
// path. This file is for anything that stores or compares a number.

/**
 * Normalises any reasonable South African phone number input into the
 * canonical "27XXXXXXXXX" digits-only form used for storage and lookups.
 *
 * Handles a leading 0 ("082 123 4567" -> "27821234567"), a number already
 * starting with 27 (with or without a leading +), a leading 00
 * international prefix, and any spaces/dashes/parentheses in between.
 */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");

  // Strip a leading 00 international prefix (e.g. "0027...")
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Local SA format starting with 0 (e.g. "082 123 4567") -> "27..."
  if (digits.startsWith("0") && !digits.startsWith("27")) {
    digits = `27${digits.slice(1)}`;
  }

  return digits;
}

/**
 * True if `phone` normalises to a plausible South African mobile number:
 * 27 followed by 9 digits, starting with 6, 7 or 8 — SA's mobile ranges.
 * This intentionally excludes SA landline prefixes (e.g. 27 10/11/12...),
 * since a WhatsApp OTP can only ever reach a mobile number anyway.
 */
export function isValidSAMobile(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^27[678]\d{8}$/.test(normalized);
}
