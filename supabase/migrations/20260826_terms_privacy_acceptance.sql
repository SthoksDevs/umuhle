-- 20260826_terms_privacy_acceptance.sql
--
-- Explicit, versioned Terms/Privacy acceptance with an append-only audit
-- log — so a dispute or a POPIA access request can be answered with an
-- actual timestamp + version, not "the site had a link in the footer".
--
--   1. profiles gets the *current* acceptance snapshot (fast to check on
--      every page load: does this user need to re-accept?).
--   2. terms_acceptance_log keeps every acceptance event, including
--      re-acceptances after a version bump — profiles only holds the
--      latest, this table is the history.
--
-- lib/legal.ts holds CURRENT_TERMS_VERSION/CURRENT_PRIVACY_VERSION.
-- components/AuthModal.tsx sets these at signup; app/dashboard/page.tsx
-- forces re-acceptance (via app/api/legal/accept) when a logged-in user's
-- stored version falls behind.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS terms_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS privacy_version text;

CREATE TABLE IF NOT EXISTS terms_acceptance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  -- Best-effort context for the audit trail — never relied on as the sole
  -- proof, but useful alongside the timestamp if a dispute comes up.
  user_agent text
);

CREATE INDEX IF NOT EXISTS terms_acceptance_log_user_id_idx ON terms_acceptance_log(user_id, accepted_at DESC);

ALTER TABLE terms_acceptance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own acceptance log" ON terms_acceptance_log;
CREATE POLICY "Users can view own acceptance log" ON terms_acceptance_log
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own acceptance log" ON terms_acceptance_log;
CREATE POLICY "Users can insert own acceptance log" ON terms_acceptance_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── handle_new_user(): record acceptance at signup ──
-- components/AuthModal.tsx now requires the checkbox before submit and
-- passes terms_version/privacy_version through signUp()'s options.data,
-- same as full_name/phone/account_type already do.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_account_type text := coalesce(new.raw_user_meta_data->>'account_type', 'customer');
  v_artist_category text := nullif(new.raw_user_meta_data->>'artist_category', '');
  v_phone text := nullif(new.raw_user_meta_data->>'phone', '');
  v_otp_verified_at timestamptz;
  v_terms_version text := nullif(new.raw_user_meta_data->>'terms_version', '');
  v_privacy_version text := nullif(new.raw_user_meta_data->>'privacy_version', '');
begin
  if v_account_type not in ('customer','artist','business_partner') then
    v_account_type := 'customer';
  end if;

  if v_phone is not null then
    select verified_at into v_otp_verified_at
    from public.phone_otp_verifications
    where phone = v_phone
      and verified_at is not null
      and consumed_at is null
      and verified_at > now() - interval '30 minutes'
    order by verified_at desc
    limit 1;

    if v_otp_verified_at is not null then
      update public.phone_otp_verifications
      set consumed_at = now()
      where phone = v_phone
        and verified_at = v_otp_verified_at
        and consumed_at is null;
    end if;
  end if;

  insert into public.profiles (
    id, email, full_name, phone, avatar_url,
    account_type, artist_category, is_artist, is_partner,
    whatsapp_verified_at,
    terms_accepted, terms_accepted_at, terms_version, privacy_version
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    v_phone,
    coalesce(new.raw_user_meta_data->>'avatar_url', null),
    v_account_type,
    case when v_account_type = 'artist' then v_artist_category else null end,
    v_account_type = 'artist',
    v_account_type = 'business_partner',
    v_otp_verified_at,
    v_terms_version is not null and v_privacy_version is not null,
    case when v_terms_version is not null and v_privacy_version is not null then now() else null end,
    v_terms_version,
    v_privacy_version
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(nullif(excluded.full_name, ''), profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);

  if v_terms_version is not null and v_privacy_version is not null then
    insert into public.terms_acceptance_log (user_id, terms_version, privacy_version)
    values (new.id, v_terms_version, v_privacy_version);
  end if;

  return new;
end;
$function$;
