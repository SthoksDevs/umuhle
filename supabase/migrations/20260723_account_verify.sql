-- 20260723_account_verify.sql
--
-- Supports the "umuhle_account" WABA template's verify-account button
-- (app/verify-account/route.ts), sent from notifyAccountCreated after
-- CompleteProfileGate captures a user's WhatsApp number for the first time.
--
-- whatsapp_verified_at: set once the user clicks the verify-account link
--   from WhatsApp. Reference-only — NOT read by any account_status gating
--   or payment-initiate route. NULL just means "hasn't clicked it yet".
alter table public.profiles
  add column if not exists whatsapp_verified_at timestamp with time zone;
