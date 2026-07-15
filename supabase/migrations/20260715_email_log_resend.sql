-- 20260715_email_log_resend.sql
--
-- Supports the new "resend timed-out emails" daily cron
-- (app/api/cron/resend-emails/route.ts).
--
-- Note: this repo doesn't have a supabase/migrations folder checked in from
-- earlier work (schema.sql is a point-in-time dump, not a migration
-- history), so this is the first file in it. Run this directly in the
-- Supabase SQL editor, same as prior migrations were.
--
-- html_body / text_body: the exact content that was sent (or attempted),
--   captured at send time by lib/email.ts. This is what lets a resend
--   replay a failed email verbatim, instead of re-deriving it from the
--   underlying order/booking/etc., which may have changed — or been
--   deleted — by the time the retry runs, possibly days later.
-- resent_at: set once a retry of this row succeeds. NULL = never
--   successfully resent. The ORIGINAL failed row keeps this stamp rather
--   than being edited in place, so the Emails tab still shows the original
--   failure for audit purposes, with a "✓ Resent" badge next to it — the
--   successful retry itself gets its own new row via the normal log() path.
-- retry_count: how many times a resend has been attempted and failed.
--   Lets the cron give up on a permanently-bad address after a few days
--   instead of retrying forever.
alter table public.email_log
  add column if not exists html_body   text,
  add column if not exists text_body   text,
  add column if not exists resent_at   timestamp with time zone,
  add column if not exists retry_count integer not null default 0;

-- Used by both the resend cron's WHERE clause and the Emails tab's
-- "failed, not yet given up on" view.
create index if not exists email_log_resend_candidates_idx
  on public.email_log (status, resent_at, retry_count, sent_at)
  where status = 'failed';
