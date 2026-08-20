-- Removes the paid product-listing gate (Starter/Growth/Business/Premium
-- packages, and the separate "ads" entity) and adds explicit
-- service → product upsell links.
--
-- See lib/payments/split.ts's file header and components/ProductForm.tsx
-- for the app-side half of this change. The `ads` table itself, and the
-- package/listing_status/expires_at columns on `products`, are
-- deliberately left in place rather than dropped — they're historical
-- record only now; nothing in the app reads or writes them after this.

-- Anything still sitting in "pending_payment" was waiting on a listing
-- fee that no longer exists — go live immediately rather than staying
-- stuck forever. Content moderation (moderation_status/is_active) still
-- applies exactly as it always has; this only clears the old payment gate.
update public.products
set listing_status = 'active'
where listing_status = 'pending_payment';


-- ── Artist service upsells ──────────────────────────────────────────────
-- An artist can optionally attach a small, curated set of THEIR OWN
-- products to a specific service (e.g. the hair oil they actually use for
-- a silk press) — a deliberate, explicit pick, layered on top of the
-- existing tag-overlap "you might also like" matching in app/page.tsx
-- (services.tags / UPSELL_TAG_GROUPS), not a replacement for it. A
-- service with zero rows here just falls back to that existing tag-based
-- matching, unchanged.

create table if not exists public.service_upsell_products (
  id uuid not null default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint service_upsell_products_pkey primary key (id),
  constraint service_upsell_products_unique unique (service_id, product_id)
);

create index if not exists service_upsell_products_service_id_idx on public.service_upsell_products (service_id);
create index if not exists service_upsell_products_product_id_idx on public.service_upsell_products (product_id);

alter table public.service_upsell_products enable row level security;

create policy "service_upsell_products: public read" on public.service_upsell_products
  for select
  using (
    exists (
      select 1 from public.services s
      where s.id = service_upsell_products.service_id and s.is_active = true
    )
  );

create policy "service_upsell_products: owner manage" on public.service_upsell_products
  for all
  using (
    exists (
      select 1 from public.services s
      join public.artists a on a.id = s.artist_id
      where s.id = service_upsell_products.service_id
        and a.profile_id = auth.uid()
    )
  );

create policy "service_upsell_products: admin manage" on public.service_upsell_products
  for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );


-- ── Salon service upsells ───────────────────────────────────────────────
-- Same idea, for a salon's own priced services (salon_services — see
-- 20260804_salon_services.sql) instead of an individual artist's.

create table if not exists public.salon_service_upsell_products (
  id uuid not null default gen_random_uuid(),
  salon_service_id uuid not null references public.salon_services(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint salon_service_upsell_products_pkey primary key (id),
  constraint salon_service_upsell_products_unique unique (salon_service_id, product_id)
);

create index if not exists salon_service_upsell_products_service_id_idx on public.salon_service_upsell_products (salon_service_id);
create index if not exists salon_service_upsell_products_product_id_idx on public.salon_service_upsell_products (product_id);

alter table public.salon_service_upsell_products enable row level security;

create policy "salon_service_upsell_products: public read" on public.salon_service_upsell_products
  for select
  using (
    exists (
      select 1 from public.salon_services ss
      where ss.id = salon_service_upsell_products.salon_service_id and ss.is_active = true
    )
  );

create policy "salon_service_upsell_products: owner manage" on public.salon_service_upsell_products
  for all
  using (
    exists (
      select 1 from public.salon_services ss
      join public.partner_salons ps on ps.id = ss.salon_id
      where ss.id = salon_service_upsell_products.salon_service_id
        and ps.partner_id = auth.uid()
    )
  );

create policy "salon_service_upsell_products: admin manage" on public.salon_service_upsell_products
  for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
