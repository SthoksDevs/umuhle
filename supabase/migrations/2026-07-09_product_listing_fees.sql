-- 2026-07-09_product_listing_fees.sql
--
-- Merges "ads" and "products" into one pricing model. Every NEW product a
-- partner lists now goes through the same Starter/Growth/Business/Premium
-- packages that ads already use (R20 for 6 weeks, up to R115 for 6 months) —
-- see AD_PACKAGES / LISTING_PACKAGES in types/index.ts.
--
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New
-- query → paste → Run). This repo's schema.sql is a read-only dump for
-- context, not something that gets executed automatically, so this file
-- won't run itself — that's on you to do manually.
--
-- Safe to run on a live table: it only ADDs columns (no drops, no renames),
-- and it explicitly backfills existing rows so every product that's live
-- today stays live and keeps no expiry (grandfathered in for free — see the
-- UPDATE below). Only products created AFTER this migration, through the
-- normal partner-facing form, will require a paid package.

begin;

alter table public.products
  add column if not exists package             text,
  add column if not exists listing_status       text not null default 'active',
  add column if not exists starts_at            timestamptz,
  add column if not exists expires_at           timestamptz,
  add column if not exists payfast_payment_id   text;

alter table public.products
  add constraint products_package_check
    check (package is null or package = any (array['starter','growth','business','premium'])),
  add constraint products_listing_status_check
    check (listing_status = any (array['pending_payment','active','expired','cancelled']));

-- Backfill: every product that exists right now was created under the old
-- free-forever model. Mark it active with no expiry so it keeps showing in
-- the shop exactly as before — nobody's listing disappears because of this
-- migration. (New rows inserted from now on set their own listing_status
-- explicitly in application code, so this DEFAULT mostly matters for this
-- one-time backfill plus Umuhle's own skipVerify products.)
update public.products
  set listing_status = 'active',
      starts_at       = coalesce(starts_at, created_at)
  where listing_status is distinct from 'active' or starts_at is null;

-- Speeds up the "hide expired listings" filter added to the public shop
-- queries (app/shop, app/shop/[id]) and the "which of my listings expired"
-- check in the dashboard.
create index if not exists products_expires_at_idx
  on public.products (expires_at)
  where expires_at is not null;

commit;

-- ── Rollback (manual) ──────────────────────────────────────────────────────
-- alter table public.products
--   drop constraint if exists products_package_check,
--   drop constraint if exists products_listing_status_check,
--   drop column if exists package,
--   drop column if exists listing_status,
--   drop column if exists starts_at,
--   drop column if exists expires_at,
--   drop column if exists payfast_payment_id;
-- drop index if exists products_expires_at_idx;
