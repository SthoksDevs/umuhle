-- 20260715_wallet_crediting_fix.sql
--
-- Fixes partners/artists never seeing a wallet credit for delivered orders /
-- completed bookings.
--
-- IMPORTANT CONTEXT: credit_wallet_earning() and recompute_wallet_balance()
-- already exist in the live database (added in
-- supabase/migrations/20260705_marketplace_payouts.sql per lib/payouts.ts's
-- comments) — but that migration file isn't present in this repo export, so
-- this file is a defensive CREATE OR REPLACE rewrite inferred entirely from
-- how lib/payouts.ts and app/dashboard/page.tsx already call these two
-- functions, not a diff against the original source. It's written to be
-- safe to run even if the current functions are already correct.
--
-- Root cause this fixes: nowhere in the TypeScript codebase ever inserts a
-- row into `wallets` directly (grep the repo — the only two call sites just
-- SELECT from it). The only place a wallet row could ever be created is
-- inside credit_wallet_earning() itself. If that function only ever UPDATEs
-- an existing wallet row (rather than creating one first), then the very
-- first payout for any given artist/partner — before they have a wallet row
-- yet — silently updates zero rows and vanishes, with no error anywhere.
-- That matches exactly what was reported: payments succeed, order/booking
-- status updates fine, but the wallet never shows a balance, and the
-- Bookings tab is left showing "Payout pending…" forever with no further
-- explanation.
--
-- What this migration does:
--   1. credit_wallet_earning: upserts the wallet row before crediting it,
--      so a brand-new artist/partner's first payout has somewhere to land.
--   2. recompute_wallet_balance: same upsert-first defensiveness, and
--      recalculates purely from the wallet_transactions ledger (source of
--      truth), so it self-corrects regardless of how the row got out of
--      sync.
--   3. Adds the unique index on wallet_transactions(source_type, source_id)
--      that lib/payouts.ts's comments already describe as part of the
--      idempotency design — belt-and-braces alongside the payout_credited_at
--      flag on the source row.
--
-- If step 3 fails with a "could not create unique index — key is
-- duplicated" error, it means duplicate credits already made it into
-- wallet_transactions under the old function. Run this first to see them:
--
--   select source_type, source_id, count(*), array_agg(id)
--   from public.wallet_transactions
--   where source_type is not null and source_id is not null
--   group by source_type, source_id
--   having count(*) > 1;
--
-- ...then decide with the real data in front of you whether to delete the
-- extra row(s) before re-running this file. Steps 1–2 do not depend on step
-- 3 and are safe to keep either way.

-- ── 1. credit_wallet_earning ────────────────────────────────────────────────
create or replace function public.credit_wallet_earning(
  p_profile_id   uuid,
  p_amount_cents integer,
  p_description  text,
  p_source_type  text,
  p_source_id    uuid,
  p_hold_days    integer default 2
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
begin
  if p_profile_id is null or p_amount_cents is null or p_amount_cents <= 0 then
    return false;
  end if;

  -- Create the wallet row if this profile has never earned anything before.
  -- This is the fix: previously nothing in the app ever did this insert, so
  -- a first-time payout had no row to credit.
  insert into public.wallets (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select id into v_wallet_id from public.wallets where profile_id = p_profile_id;

  -- Idempotency backstop: if a row for this exact (source_type, source_id)
  -- already exists (e.g. a retried webhook, or the admin re-triggering a
  -- "mark delivered" action), the unique index below rejects the duplicate
  -- insert and this returns false — the caller treats false as "already
  -- credited", not an error.
  begin
    insert into public.wallet_transactions
      (wallet_id, amount, type, description, source_type, source_id, clears_at)
    values
      (v_wallet_id, p_amount_cents, 'credit', p_description, p_source_type, p_source_id,
       now() + make_interval(days => coalesce(p_hold_days, 2)));
  exception
    when unique_violation then
      return false;
  end;

  update public.wallets
  set pending_balance = pending_balance + p_amount_cents,
      total_earned    = total_earned + p_amount_cents,
      updated_at      = now()
  where id = v_wallet_id;

  return true;
end;
$$;

comment on function public.credit_wallet_earning(uuid, integer, text, text, uuid, integer) is
  'Credits a profile''s wallet for a completed booking or delivered order item. Creates the wallet row if it does not exist yet. Returns false (no-op) if this exact source_type+source_id was already credited.';

-- ── 2. recompute_wallet_balance ─────────────────────────────────────────────
create or replace function public.recompute_wallet_balance(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_total_earned bigint;
  v_pending      bigint;
  v_available    bigint;
begin
  if p_profile_id is null then
    return;
  end if;

  -- Same defensiveness as credit_wallet_earning — a profile that opens its
  -- Wallet tab before ever earning anything has no row yet; give it one
  -- (all zeroes) rather than silently doing nothing.
  insert into public.wallets (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select id into v_wallet_id from public.wallets where profile_id = p_profile_id;

  -- Recomputed from the ledger in one pass, rather than trusted running
  -- totals — this is what makes it safe to call as often as the app likes
  -- (every Wallet tab load, every withdrawal status change) and what makes
  -- it self-correct if the running totals on `wallets` ever drift.
  select
    coalesce(sum(case when type = 'credit' then amount else 0 end), 0),
    coalesce(sum(case when type = 'credit' and clears_at is not null and clears_at > now() then amount else 0 end), 0),
    coalesce(sum(case when type = 'credit' then amount else 0 end), 0)
      - coalesce(sum(case when type = 'credit' and clears_at is not null and clears_at > now() then amount else 0 end), 0)
      - coalesce(sum(case when type = 'debit' then amount else 0 end), 0)
  into v_total_earned, v_pending, v_available
  from public.wallet_transactions
  where wallet_id = v_wallet_id;

  update public.wallets
  set total_earned       = v_total_earned,
      pending_balance    = v_pending,
      available_balance  = greatest(v_available, 0),
      -- approved_balance isn't read anywhere in the app today (legacy from
      -- an earlier 3-bucket design) — kept in sync with available_balance
      -- so it's never a stale, misleading number if something starts
      -- reading it later.
      approved_balance   = greatest(v_available, 0),
      updated_at         = now()
  where id = v_wallet_id;
end;
$$;

comment on function public.recompute_wallet_balance(uuid) is
  'Recalculates a wallet''s pending/available/total_earned straight from wallet_transactions. Safe to call anytime; creates the wallet row if missing. Deliberately callable for ANY profile_id (not just auth.uid()) because the admin Payments tab calls it for withdrawal requesters, not just for the logged-in user — real protection is on the wallets SELECT RLS policy, not here.';

-- ── 3. Idempotency safety net ────────────────────────────────────────────────
-- See the big comment at the top of this file if this errors out.
create unique index if not exists wallet_transactions_source_unique
  on public.wallet_transactions (source_type, source_id)
  where source_type is not null and source_id is not null;
