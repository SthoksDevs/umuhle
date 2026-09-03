-- 20260903_registration_multi_category_and_address.sql
--
-- Two additive changes to support app/register/page.tsx's updated form:
--
-- 1. Artists can now pick more than one specialty at signup. Adds
--    artist_categories text[] alongside the existing singular
--    artist_category column rather than replacing it — search filters,
--    artist cards, and anything else already reading artist_category
--    keep working unchanged; handle_new_user() keeps it in sync as the
--    first of the chosen categories.
-- 2. handle_new_user() never actually wrote address/suburb/city/province/
--    postal_code, even though profiles has always had the columns (they
--    were only ever set later, from the dashboard's fulfillment settings).
--    Registration now collects a delivery address up front so checkout can
--    prefill it — this trigger is what persists it at signup time.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS artist_categories text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_artist_categories_check
  CHECK (artist_categories <@ ARRAY['hair','nails','makeup','lashes']::text[]);

-- Backfill: every existing artist's single category becomes a one-element
-- array so nobody appears to have lost their specialty.
UPDATE public.profiles
SET artist_categories = ARRAY[artist_category]
WHERE account_type = 'artist'
  AND artist_category IS NOT NULL
  AND artist_categories = '{}';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_account_type text := coalesce(new.raw_user_meta_data->>'account_type', 'customer');
  -- Filtered against the allowed set the same way the old singular
  -- v_artist_category always was — an unrecognised value is dropped
  -- rather than rejecting the whole signup. Guards against a missing key,
  -- an explicit JSON null, or a non-array value, all of which would
  -- otherwise throw "cannot extract elements from a scalar".
  v_artist_categories text[] := (
    select coalesce(array_agg(value), ARRAY[]::text[])
    from jsonb_array_elements_text(
      case when jsonb_typeof(new.raw_user_meta_data->'artist_categories') = 'array'
        then new.raw_user_meta_data->'artist_categories'
        else '[]'::jsonb
      end
    ) as t(value)
    where value in ('hair','nails','makeup','lashes')
  );
  v_artist_category text;
  v_phone text := nullif(new.raw_user_meta_data->>'phone', '');
  v_otp_verified_at timestamptz;
  v_terms_version text := nullif(new.raw_user_meta_data->>'terms_version', '');
  v_privacy_version text := nullif(new.raw_user_meta_data->>'privacy_version', '');
  v_address text := nullif(new.raw_user_meta_data->>'address', '');
  v_suburb text := nullif(new.raw_user_meta_data->>'suburb', '');
  v_city text := nullif(new.raw_user_meta_data->>'city', '');
  v_province text := nullif(new.raw_user_meta_data->>'province', '');
  v_postal_code text := nullif(new.raw_user_meta_data->>'postal_code', '');
begin
  if v_account_type not in ('customer','artist','business_partner') then
    v_account_type := 'customer';
  end if;

  if v_account_type != 'artist' then
    v_artist_categories := ARRAY[]::text[];
  end if;
  v_artist_category := v_artist_categories[1];

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
    account_type, artist_category, artist_categories, is_artist, is_partner,
    whatsapp_verified_at,
    terms_accepted, terms_accepted_at, terms_version, privacy_version,
    address, suburb, city, province, postal_code
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    v_phone,
    coalesce(new.raw_user_meta_data->>'avatar_url', null),
    v_account_type,
    v_artist_category,
    v_artist_categories,
    v_account_type = 'artist',
    v_account_type = 'business_partner',
    v_otp_verified_at,
    v_terms_version is not null and v_privacy_version is not null,
    case when v_terms_version is not null and v_privacy_version is not null then now() else null end,
    v_terms_version,
    v_privacy_version,
    v_address, v_suburb, v_city, v_province, v_postal_code
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
