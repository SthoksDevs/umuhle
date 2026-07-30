-- review_invites: capability tokens for the unauthenticated review-submission
-- landing page (/review/[token]). Each row is a one-time "who + what"
-- pointer created server-side the moment a booking/order/salon-visit
-- completes, then emailed/WhatsApp'd to the relevant person. The token
-- itself is the bearer credential (same trust model as
-- order_items.confirm_token) -- the landing page never asks for login,
-- and identity/target can't be tampered with client-side since none of it
-- travels as plain, editable URL params.
create table public.review_invites (
  token uuid primary key default gen_random_uuid(),
  review_type text not null check (review_type in ('client_to_artist','artist_to_client','client_to_salon','client_to_product')),
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewed_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  salon_id uuid references public.partner_salons(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Mirrors reviews_target_shape_check on the reviews table itself, so an
  -- invite can never be created in a shape the eventual review insert
  -- would reject.
  constraint review_invites_target_shape_check check (
    (review_type in ('client_to_artist','artist_to_client') and booking_id is not null and order_item_id is null and salon_id is null)
    or (review_type = 'client_to_product' and order_item_id is not null and booking_id is null and salon_id is null)
    or (review_type = 'client_to_salon' and salon_id is not null and booking_id is null and order_item_id is null)
  )
);

create index review_invites_booking_id_idx on public.review_invites(booking_id) where booking_id is not null;
create index review_invites_order_item_id_idx on public.review_invites(order_item_id) where order_item_id is not null;
create index review_invites_salon_id_idx on public.review_invites(salon_id) where salon_id is not null;

-- No public policies -- same posture as every other table here (rls on,
-- zero policies). Only the service-role client (used exclusively by the
-- new /api/reviews/invite/[token] route) can read or write this table.
alter table public.review_invites enable row level security;

-- The existing (booking_id, reviewer_id) unique constraint on `reviews`
-- already stops a client/artist double-reviewing the same booking, but
-- product and salon reviews had no equivalent guard yet -- add them so
-- re-visiting (or re-sending) the same review link can't spam duplicate
-- rows.
alter table public.reviews
  add constraint reviews_order_item_reviewer_unique unique (order_item_id, reviewer_id);
alter table public.reviews
  add constraint reviews_salon_reviewer_unique unique (salon_id, reviewer_id);
