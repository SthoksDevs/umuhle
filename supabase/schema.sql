-- ═══════════════════════════════════════════════════════════════
--  Umuhle Complete Database Schema
--  Run this in your Supabase SQL Editor (full replacement)
-- ═══════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ── Drop old tables in dependency order ──────────────────────
drop table if exists public.reports cascade;
drop table if exists public.withdrawals cascade;
drop table if exists public.wallet_transactions cascade;
drop table if exists public.wallets cascade;
drop table if exists public.referrals cascade;
drop table if exists public.ads cascade;
drop table if exists public.salon_subscription_payments cascade;
drop table if exists public.partner_salons cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.products cascade;
drop table if exists public.reviews cascade;
drop table if exists public.bookings cascade;
drop table if exists public.portfolio_images cascade;
drop table if exists public.availability cascade;
drop table if exists public.services cascade;
drop table if exists public.artists cascade;
drop table if exists public.profiles cascade;

-- ════════════════════════════════════════════════════════════
--  PROFILES
-- ════════════════════════════════════════════════════════════
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  full_name           text,
  phone               text,
  avatar_url          text,
  -- Role flags (single-account architecture)
  is_artist           boolean not null default false,
  is_partner          boolean not null default false,
  is_admin            boolean not null default false,
  -- What the person told us they signed up to do
  account_type        text default 'customer'
                        check (account_type in ('customer','artist','business_partner')),
  artist_category     text check (artist_category in ('hair','nails','makeup','lashes')),
  -- Account status
  account_status      text not null default 'active'
                        check (account_status in ('active','pending_review','suspended','deleted')),
  suspension_reason   text,
  suspended_at        timestamptz,
  suspended_by        uuid references auth.users(id),
  -- Referrals
  referral_code       text unique,
  referred_by         uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Generate referral code on insert
create or replace function public.generate_referral_code()
returns trigger language plpgsql as $$
begin
  if new.referral_code is null then
    new.referral_code := upper(substring(replace(new.id::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;

create trigger trg_referral_code
  before insert on public.profiles
  for each row execute function public.generate_referral_code();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_account_type text := coalesce(new.raw_user_meta_data->>'account_type', 'customer');
  v_artist_category text := nullif(new.raw_user_meta_data->>'artist_category', '');
begin
  if v_account_type not in ('customer','artist','business_partner') then
    v_account_type := 'customer';
  end if;

  insert into public.profiles (
    id, email, full_name, phone, avatar_url,
    account_type, artist_category, is_artist, is_partner
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', null),
    coalesce(new.raw_user_meta_data->>'avatar_url', null),
    v_account_type,
    case when v_account_type = 'artist' then v_artist_category else null end,
    v_account_type = 'artist',
    v_account_type = 'business_partner'
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(nullif(excluded.full_name, ''), profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ════════════════════════════════════════════════════════════
--  ARTISTS
-- ════════════════════════════════════════════════════════════
create table public.artists (
  id                  uuid primary key default uuid_generate_v4(),
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  display_name        text not null,
  bio                 text,
  category            text not null check (category in ('hair','nails','makeup','lashes')),
  location            text,
  suburb              text,
  city                text,
  latitude            numeric(10,7),
  longitude           numeric(10,7),
  avatar_url          text,
  cover_url           text,
  rating              numeric(3,2) not null default 0,
  review_count        integer not null default 0,
  is_verified         boolean not null default false,
  is_active           boolean not null default true,
  -- contact
  point_of_contact_name  text,
  point_of_contact_phone text,
  -- moderation
  moderation_status   text not null default 'approved'
                        check (moderation_status in ('draft','scanning','approved','needs_review','rejected')),
  moderation_score    numeric(5,4),
  created_at          timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  SERVICES
-- ════════════════════════════════════════════════════════════
create table public.services (
  id                uuid primary key default uuid_generate_v4(),
  artist_id         uuid not null references public.artists(id) on delete cascade,
  name              text not null,
  description       text,
  price             integer not null,
  duration_minutes  integer not null default 60,
  category          text,
  is_active         boolean not null default true
);

-- ════════════════════════════════════════════════════════════
--  AVAILABILITY
-- ════════════════════════════════════════════════════════════
create table public.availability (
  id            uuid primary key default uuid_generate_v4(),
  artist_id     uuid not null references public.artists(id) on delete cascade,
  day_of_week   integer not null check (day_of_week between 0 and 6),
  start_time    time not null,
  end_time      time not null
);

-- ════════════════════════════════════════════════════════════
--  PORTFOLIO
-- ════════════════════════════════════════════════════════════
create table public.portfolio_images (
  id          uuid primary key default uuid_generate_v4(),
  artist_id   uuid not null references public.artists(id) on delete cascade,
  image_url   text not null,
  caption     text,
  created_at  timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  BOOKINGS
-- ════════════════════════════════════════════════════════════
create table public.bookings (
  id                          uuid primary key default uuid_generate_v4(),
  client_id                   uuid not null references public.profiles(id),
  artist_id                   uuid not null references public.artists(id),
  service_id                  uuid not null references public.services(id),
  booking_date                date not null,
  booking_time                time not null,
  meeting_address             text,
  status                      text not null default 'pending_payment'
                                check (status in ('pending_payment','confirmed','in_progress','completed','cancelled','no_show')),
  total_amount                integer not null,
  payfast_payment_id          text,
  notes                       text,
  -- point of contact
  client_poc_name             text,
  client_poc_phone            text,
  artist_poc_name             text,
  artist_poc_phone            text,
  -- timestamps
  started_at                  timestamptz,
  completed_at                timestamptz,
  reminder_sent               boolean not null default false,
  created_at                  timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  REVIEWS
-- ════════════════════════════════════════════════════════════
create table public.reviews (
  id            uuid primary key default uuid_generate_v4(),
  booking_id    uuid not null references public.bookings(id) on delete cascade,
  reviewer_id   uuid not null references public.profiles(id),
  reviewed_id   uuid not null references public.profiles(id),
  artist_id     uuid references public.artists(id),
  rating        integer not null check (rating between 1 and 5),
  comment       text,
  review_type   text not null check (review_type in ('client_to_artist','artist_to_client')),
  -- moderation
  moderation_status text not null default 'approved'
                    check (moderation_status in ('draft','scanning','approved','needs_review','rejected')),
  moderation_score  numeric(5,4),
  created_at    timestamptz not null default now(),
  unique (booking_id, review_type)
);

create or replace function public.update_artist_rating()
returns trigger language plpgsql as $$
begin
  update public.artists
  set
    rating       = (select avg(rating)::numeric(3,2) from public.reviews where artist_id = new.artist_id and review_type = 'client_to_artist' and moderation_status = 'approved'),
    review_count = (select count(*) from public.reviews where artist_id = new.artist_id and review_type = 'client_to_artist' and moderation_status = 'approved')
  where id = new.artist_id;
  return new;
end;
$$;

drop trigger if exists on_review_created on public.reviews;
create trigger on_review_created
  after insert or update on public.reviews
  for each row execute function public.update_artist_rating();

-- ════════════════════════════════════════════════════════════
--  PRODUCTS (Partner-owned)
-- ════════════════════════════════════════════════════════════
create table public.products (
  id                uuid primary key default uuid_generate_v4(),
  partner_id        uuid not null references public.profiles(id),
  name              text not null,
  description       text,
  price             integer not null,
  image_url         text,
  category          text check (category in ('hair','nails','makeup','lashes','skincare','tools','other')),
  stock_count       integer not null default 0,
  is_active         boolean not null default true,
  -- moderation
  moderation_status text not null default 'scanning'
                      check (moderation_status in ('draft','scanning','approved','needs_review','rejected')),
  moderation_score  numeric(5,4),
  created_at        timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  ORDERS + ORDER_ITEMS
-- ════════════════════════════════════════════════════════════
create table public.orders (
  id                  uuid primary key default uuid_generate_v4(),
  client_id           uuid not null references public.profiles(id),
  total_amount        integer not null,
  status              text not null default 'pending_payment'
                        check (status in ('pending_payment','paid','processing','shipped','delivered','cancelled')),
  shipping_address    text,
  contact_name        text,
  contact_whatsapp    text,
  payment_method      text default 'payfast'
                        check (payment_method in ('payfast','happypay','google_pay')),
  payfast_payment_id  text,
  gateway_order_id        text, -- HappyPay orderId / Google Pay reference
  gateway_webhook_secret  text, -- validates HappyPay's success/failure webhook calls
  created_at          timestamptz not null default now()
);

create table public.order_items (
  id          uuid primary key default uuid_generate_v4(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  quantity    integer not null default 1,
  unit_price  integer not null
);

-- ════════════════════════════════════════════════════════════
--  PARTNER SALONS
-- ════════════════════════════════════════════════════════════
create table public.partner_salons (
  id                  uuid primary key default uuid_generate_v4(),
  partner_id          uuid not null references public.profiles(id) on delete cascade,
  name                text not null,
  description         text,
  address             text,
  suburb              text,
  city                text,
  latitude            numeric(10,7),
  longitude           numeric(10,7),
  phone               text,
  email               text,
  website             text,
  opening_hours       jsonb default '{}',
  gallery_urls        text[] default '{}',
  is_active           boolean not null default false,
  subscription_until  date,
  -- moderation
  moderation_status   text not null default 'approved'
                        check (moderation_status in ('draft','scanning','approved','needs_review','rejected')),
  created_at          timestamptz not null default now()
);

create table public.salon_subscription_payments (
  id                  uuid primary key default uuid_generate_v4(),
  salon_id            uuid not null references public.partner_salons(id),
  partner_id          uuid not null references public.profiles(id),
  amount              integer not null default 3500,
  payfast_payment_id  text,
  status              text not null default 'pending'
                        check (status in ('pending','paid','failed')),
  valid_until         date,
  created_at          timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  ADVERTISEMENTS
-- ════════════════════════════════════════════════════════════
create table public.ads (
  id                  uuid primary key default uuid_generate_v4(),
  partner_id          uuid not null references public.profiles(id) on delete cascade,
  title               text not null,
  description         text,
  image_url           text,
  link_url            text,
  category            text check (category in ('hair','nails','makeup','lashes','general')),
  package             text not null check (package in ('starter','growth','business','premium')),
  ads_count           integer not null default 1,
  price               integer not null,
  status              text not null default 'pending_payment'
                        check (status in ('pending_payment','active','expired','cancelled')),
  payfast_payment_id  text,
  starts_at           timestamptz,
  expires_at          timestamptz,
  -- moderation
  moderation_status   text not null default 'draft'
                        check (moderation_status in ('draft','scanning','approved','needs_review','rejected')),
  moderation_score    numeric(5,4),
  created_at          timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  REFERRALS
-- ════════════════════════════════════════════════════════════
create table public.referrals (
  id              uuid primary key default uuid_generate_v4(),
  referrer_id     uuid not null references public.profiles(id),
  referred_id     uuid not null references public.profiles(id),
  status          text not null default 'pending'
                    check (status in ('pending','rewarded')),
  reward_amount   integer default 1000,  -- R10 in cents
  rewarded_at     timestamptz,
  trigger_ad_id   uuid references public.ads(id),
  created_at      timestamptz not null default now(),
  unique(referrer_id, referred_id)
);

-- ════════════════════════════════════════════════════════════
--  WALLETS
-- ════════════════════════════════════════════════════════════
create table public.wallets (
  id                uuid primary key default uuid_generate_v4(),
  profile_id        uuid not null unique references public.profiles(id) on delete cascade,
  available_balance integer not null default 0,
  pending_balance   integer not null default 0,
  approved_balance  integer not null default 0,
  total_earned      integer not null default 0,
  updated_at        timestamptz not null default now()
);

create table public.wallet_transactions (
  id            uuid primary key default uuid_generate_v4(),
  wallet_id     uuid not null references public.wallets(id),
  amount        integer not null,
  type          text not null check (type in ('credit','debit')),
  description   text not null,
  reference_id  uuid,
  created_at    timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  WITHDRAWALS
-- ════════════════════════════════════════════════════════════
create table public.withdrawals (
  id              uuid primary key default uuid_generate_v4(),
  profile_id      uuid not null references public.profiles(id),
  amount          integer not null,
  bank_name       text not null,
  account_number  text not null,
  account_holder  text not null,
  status          text not null default 'pending'
                    check (status in ('pending','approved','paid','rejected')),
  processed_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
--  COMMUNITY REPORTS
-- ════════════════════════════════════════════════════════════
create table public.reports (
  id              uuid primary key default uuid_generate_v4(),
  reporter_id     uuid not null references public.profiles(id),
  content_type    text not null check (content_type in ('ad','product','salon','review','artist')),
  content_id      uuid not null,
  reason          text not null check (reason in ('spam','offensive','fraud','misleading')),
  description     text,
  status          text not null default 'open'
                    check (status in ('open','reviewed','dismissed')),
  created_at      timestamptz not null default now()
);

-- Auto-flag content after 5 reports
create or replace function public.check_report_threshold()
returns trigger language plpgsql as $$
declare
  report_count integer;
begin
  select count(*) into report_count
  from public.reports
  where content_type = new.content_type
    and content_id = new.content_id
    and status = 'open';

  if report_count >= 5 then
    case new.content_type
      when 'ad' then
        update public.ads set moderation_status = 'needs_review' where id = new.content_id;
      when 'product' then
        update public.products set moderation_status = 'needs_review' where id = new.content_id;
      when 'salon' then
        update public.partner_salons set moderation_status = 'needs_review' where id = new.content_id;
      else null;
    end case;
  end if;
  return new;
end;
$$;

create trigger trg_report_threshold
  after insert on public.reports
  for each row execute function public.check_report_threshold();

-- ════════════════════════════════════════════════════════════
--  Auto-create wallet for new profile
-- ════════════════════════════════════════════════════════════
create or replace function public.create_wallet_for_profile()
returns trigger language plpgsql security definer as $$
begin
  insert into public.wallets (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

create trigger trg_create_wallet
  after insert on public.profiles
  for each row execute function public.create_wallet_for_profile();

-- ════════════════════════════════════════════════════════════
--  SUSPENSION: hide content for suspended users
-- ════════════════════════════════════════════════════════════
create or replace function public.handle_suspension_change()
returns trigger language plpgsql security definer as $$
begin
  if new.account_status = 'suspended' and old.account_status != 'suspended' then
    update public.artists set is_active = false where profile_id = new.id;
    update public.products set is_active = false where partner_id = new.id;
    update public.partner_salons set is_active = false where partner_id = new.id;
    update public.ads set status = 'cancelled' where partner_id = new.id and status = 'active';
  elsif new.account_status = 'active' and old.account_status = 'suspended' then
    update public.artists set is_active = true where profile_id = new.id;
    update public.products set is_active = true where partner_id = new.id;
    update public.partner_salons set is_active = true where partner_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trg_suspension_change
  after update of account_status on public.profiles
  for each row execute function public.handle_suspension_change();

-- ════════════════════════════════════════════════════════════
--  Stock decrement helper (called once a product order is paid)
-- ════════════════════════════════════════════════════════════
create or replace function public.decrement_stock(p_product_id uuid, p_qty integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.products
  set stock_count = greatest(stock_count - p_qty, 0)
  where id = p_product_id;
end;
$$;

-- ════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════

-- Profiles
alter table public.profiles enable row level security;
create policy "profiles: public read (active)" on public.profiles
  for select using (account_status = 'active' or auth.uid() = id);
create policy "profiles: self update" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles: service role" on public.profiles
  for all using (true) with check (true);

-- Artists
alter table public.artists enable row level security;
create policy "artists: public read" on public.artists
  for select using (
    is_active = true
    and moderation_status = 'approved'
    and exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.account_status = 'active'
    )
  );
create policy "artists: owner manage" on public.artists
  for all using (profile_id = auth.uid());
create policy "artists: admin all" on public.artists
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Services
alter table public.services enable row level security;
create policy "services: public read" on public.services
  for select using (is_active = true);
create policy "services: owner manage" on public.services
  for all using (
    artist_id in (select id from public.artists where profile_id = auth.uid())
  );

-- Bookings
alter table public.bookings enable row level security;
create policy "bookings: client read" on public.bookings
  for select using (client_id = auth.uid());
create policy "bookings: client insert" on public.bookings
  for insert with check (client_id = auth.uid());
create policy "bookings: client update" on public.bookings
  for update using (client_id = auth.uid());
create policy "bookings: artist read" on public.bookings
  for select using (
    artist_id in (select id from public.artists where profile_id = auth.uid())
  );
create policy "bookings: artist update" on public.bookings
  for update using (
    artist_id in (select id from public.artists where profile_id = auth.uid())
  );
create policy "bookings: service role" on public.bookings
  for all using (true);

-- Reviews
alter table public.reviews enable row level security;
create policy "reviews: public read" on public.reviews
  for select using (moderation_status = 'approved');
create policy "reviews: insert own" on public.reviews
  for insert with check (reviewer_id = auth.uid());

-- Products
alter table public.products enable row level security;
create policy "products: public read" on public.products
  for select using (
    is_active = true
    and moderation_status = 'approved'
    and exists (
      select 1 from public.profiles p
      where p.id = partner_id and p.account_status = 'active'
    )
  );
create policy "products: partner manage" on public.products
  for all using (partner_id = auth.uid());
create policy "products: admin all" on public.products
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Orders
alter table public.orders enable row level security;
create policy "orders: client read" on public.orders
  for select using (client_id = auth.uid());
create policy "orders: client insert" on public.orders
  for insert with check (client_id = auth.uid());
create policy "orders: service role" on public.orders
  for all using (true);

-- Order items
alter table public.order_items enable row level security;
create policy "order_items: client read" on public.order_items
  for select using (
    order_id in (select id from public.orders where client_id = auth.uid())
  );
create policy "order_items: service role" on public.order_items
  for all using (true);

-- Ads
alter table public.ads enable row level security;
create policy "ads: public read" on public.ads
  for select using (
    status = 'active'
    and moderation_status = 'approved'
    and (expires_at is null or expires_at > now())
    and exists (
      select 1 from public.profiles p
      where p.id = partner_id and p.account_status = 'active'
    )
  );
create policy "ads: partner manage" on public.ads
  for all using (partner_id = auth.uid());
create policy "ads: admin all" on public.ads
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Partner salons
alter table public.partner_salons enable row level security;
create policy "salons: public read" on public.partner_salons
  for select using (
    is_active = true
    and moderation_status = 'approved'
    and (subscription_until is null or subscription_until >= current_date)
    and exists (
      select 1 from public.profiles p
      where p.id = partner_id and p.account_status = 'active'
    )
  );
create policy "salons: partner manage" on public.partner_salons
  for all using (partner_id = auth.uid());

-- Referrals
alter table public.referrals enable row level security;
create policy "referrals: own read" on public.referrals
  for select using (referrer_id = auth.uid() or referred_id = auth.uid());
create policy "referrals: service role" on public.referrals
  for all using (true);

-- Wallets
alter table public.wallets enable row level security;
create policy "wallets: own read" on public.wallets
  for select using (profile_id = auth.uid());
create policy "wallets: service role" on public.wallets
  for all using (true);

alter table public.wallet_transactions enable row level security;
create policy "wallet_tx: own read" on public.wallet_transactions
  for select using (
    wallet_id in (select id from public.wallets where profile_id = auth.uid())
  );
create policy "wallet_tx: service role" on public.wallet_transactions
  for all using (true);

-- Withdrawals
alter table public.withdrawals enable row level security;
create policy "withdrawals: own read" on public.withdrawals
  for select using (profile_id = auth.uid());
create policy "withdrawals: own insert" on public.withdrawals
  for insert with check (profile_id = auth.uid());
create policy "withdrawals: admin all" on public.withdrawals
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Reports
alter table public.reports enable row level security;
create policy "reports: own insert" on public.reports
  for insert with check (reporter_id = auth.uid());
create policy "reports: admin read" on public.reports
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Portfolio
alter table public.portfolio_images enable row level security;
create policy "portfolio: public read" on public.portfolio_images
  for select using (true);
create policy "portfolio: artist manage" on public.portfolio_images
  for all using (
    artist_id in (select id from public.artists where profile_id = auth.uid())
  );

-- Salon subscription payments
alter table public.salon_subscription_payments enable row level security;
create policy "salon_subs: own read" on public.salon_subscription_payments
  for select using (partner_id = auth.uid());
create policy "salon_subs: service role" on public.salon_subscription_payments
  for all using (true);