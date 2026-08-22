# Local delivery & provincial sales — handoff

Umuhle repo: https://github.com/SthoksDevs/umuhle/ (public, main branch)
Supabase project: `kfgvhxrsyvmukgfqpaqz` (eu-west-1, Postgres 17)
Repo pulled read-only via `https://codeload.github.com/SthoksDevs/umuhle/tar.gz/refs/heads/main`

Original request from Extra (repo owner):
> Local delivery and provincial sales. Add form option that asks Sell To with
> options provinces or whole of South Africa. Sometimes our partners will
> prefer to not use a courier service and deliver in person, the same with
> customers. Let us implement on checkout a select collection or delivery,
> along with expanding shipping address and adding waybills for our website
> to be courier api ready. Implement a solution that will be acceptable to
> courier services where items in one cart are from different partners in
> different cities. Upsell items should always prioritise local products
> (within the same city, then province, then rest of country if enabled to
> be sold by partner to country)

The database migration Extra had already applied before this session started
(shown as a document at the top of the conversation) is **live** on
`kfgvhxrsyvmukgfqpaqz` — verified via `information_schema.columns`. It added:
- `profiles`: `address, suburb, city, province, postal_code, latitude,
  longitude, allow_collection, allow_courier`
- `products`: `sell_scope ('province'|'south_africa')`, `sell_provinces text[]`
- `orders`: `shipping_address_line1/line2, shipping_suburb, shipping_city,
  shipping_province, shipping_postal_code, shipping_latitude,
  shipping_longitude`
- new table `order_shipments` — **one row per partner per order** = one
  parcel/waybill (this is the mechanism for multi-partner carts)
- `order_items.shipment_id` → `order_shipments.id`

**Do not re-run that migration** — it's already applied.

## Security fix already applied this session (also live, do not redo)

Found while checking RLS for this feature: the new `order_shipments: service
role` policy, and the pre-existing `order_items: service role` policy, were
both written as `for all using (true)` with **no `to service_role` clause**,
which Postgres defaults to `to public`. That meant any authenticated user
could insert/update/delete *any* order's items or shipments — not just their
own. Applied migration `fix_order_items_and_shipments_service_role_rls`:
- Re-scoped both policies to `to service_role`.
- Added `order_items: client insert` (`with check (order_id in (select id
  from orders where client_id = auth.uid()))`) since `order_items` had no
  other insert policy — checkout's own insert was accidentally relying on
  the bug to work at all.
- `order_shipments` deliberately gets **no** client insert policy — those
  rows are only ever created server-side with the service-role client (see
  "Remaining work" below), never directly from a customer's session.

Verified live via `pg_policies` after applying. Confirmed no other client-side
code path inserts into `order_items` (grepped the whole repo) so this didn't
break anything.

## How to keep working

1. Files in this folder mirror the repo's own paths — copy them back over
   `/path/to/umuhle-src/...` (or push directly with the same relative paths).
2. To pull a fresh copy of the repo for context: `curl -sL -o umuhle.tar.gz
   https://codeload.github.com/SthoksDevs/umuhle/tar.gz/refs/heads/main` then
   `tar -xzf umuhle.tar.gz --strip-components=1`.
3. **Apply the files in this folder over that fresh checkout first**, then
   continue — they're not in the tarball yet.
4. Syntax-check any file you touch: `npx esbuild <file> --jsx=automatic
   --bundle=false --outfile=/dev/null`. Before finishing, run a full
   typecheck: `npm install --no-audit --no-fund` then `npx tsc --noEmit -p
   tsconfig.json`. Everything in this handoff is currently **typecheck-clean**
   — keep it that way.
5. Supabase MCP tools (`Supabase:execute_sql`, `Supabase:apply_migration`,
   etc.) are available and already pointed at the right project — no need to
   ask the user for credentials.
6. Extra's established preference: deliver only changed/new files with
   explicit paths, not full project zips. Terse communication, expects
   execution over lengthy clarification.

## What's complete (typecheck-clean, ready to ship as-is)

### `types/index.ts`
- `SA_PROVINCES` (const array) + `Province` type — single source of truth
  for every province `<select>`/checkbox list in the app.
- `Profile`: added the fulfillment address fields + `allow_collection` /
  `allow_courier`.
- `Product`: added `sell_scope`, `sell_provinces`, and the previously-untyped
  `weight_g/length_cm/width_cm/height_cm` (real DB columns, just missing
  from the TS type before).
- `Order`: added structured `shipping_address_line1/line2/suburb/city/
  province/postal_code/latitude/longitude`. **Kept the legacy flat
  `shipping_address` string too** — write both at order-creation time (see
  "Remaining work" — `lib/orders.ts` isn't updated yet, so right now nothing
  writes the new columns).
- New: `FulfillmentMethod`, `ShipmentStatus`, `OrderShipment` interface
  matching the `order_shipments` table. `OrderItem.shipment_id` added.

### `lib/locality.ts` (new file)
Shared "how local is this seller" ranking helper, used by the two upsell
flows below. Deliberately built on **lat/long only** (via `distanceKm` +
the existing nearest-centroid `getProvince()` from `lib/provinces.ts`), not
string comparison of `profiles.city/province` (free-typed, inconsistently
cased). `SAME_CITY_RADIUS_KM = 15` is a documented approximation — there's
no real city-boundary data in this project, same caveat `lib/provinces.ts`
already calls out for provinces.

`sortByLocality(items, referenceCoords, getCoordsFn)` — stable sort, tier 0
(same city) → tier 1 (same province) → tier 2 (rest of country / unknown
location), preserving each tier's original relative order.

### `components/ProductForm.tsx`
"Sell To" section added right after the dimensions fields: two big toggle
cards (*Whole of South Africa* / *Selected provinces*), and when
"province" is picked, a 9-checkbox grid of `SA_PROVINCES`. New optional
prop `defaultProvince` — when a fresh product switches to "province" scope
with nothing ticked yet, pre-checks the seller's own home province (still
editable/addable from there). `productToForm()` and the submit payload both
carry `sell_scope`/`sell_provinces` now.

### `app/dashboard/page.tsx`
- **`PartnerFulfillmentSettings`** (new component, rendered inside
  `ProfileTab` when `profile.is_partner`): pickup/dispatch address via the
  existing `AddressAutocomplete` (Nominatim), suburb/city/postal fields, a
  province `<select>` that auto-fills from `getProvince(coords)` when an
  address is picked (Nominatim doesn't return a province) but stays
  editable, and two toggle cards for `allow_courier`/`allow_collection`.
  Blocks saving with both off ("customers have no way to actually get an
  order from you"). Saves straight to `profiles`.
- `defaultProvince` threaded: `ProfileTab` → `MyShopTab` → `ProductsManager`
  → both `ProductForm` call sites, sourced from `profile.province`.
  `PartnerProductRow` type and `handleSaved`'s local-state reconstruction
  both carry `sell_scope`/`sell_provinces` now.
- **`OrderFulfillmentManager`** (existing per-line-item dispatch manager,
  the one that drives `shipped_at`/payout release — **left that critical
  path untouched**): the query now joins
  `shipment:order_shipments(id, fulfillment_method, status,
  destination_city, destination_province)` and each item's location line
  shows "🏠 Customer will collect in person" or "🚚 Ships to {city,
  province}" instead of the flat legacy address, falling back to the old
  legacy-address line only when there's no linked shipment yet (i.e. orders
  placed before this feature, or before `lib/orders.ts` is updated — see
  below).
- **`ShipmentsManager`** (new component, mounted in `MyShopTab` right after
  `OrderFulfillmentManager`): one card per `order_shipments` row belonging
  to this partner. Shows fulfillment method, destination (courier) or
  "collection", parcel weight/dims if set, current status badge, and an
  "Update shipment" inline editor (status `<select>` +, for courier only,
  courier/waybill/tracking-link inputs). Reads/writes `order_shipments`
  **directly via the client-side Supabase client** — relies on the
  `order_shipments: partner manage own` RLS policy (`partner_id =
  auth.uid()`, already correctly scoped, not part of the bug above), no new
  API route needed. Sets `collected_at`/`courier_booked_at`/`delivered_at`
  the first time each status is reached, never overwrites them on a later
  edit. **This is what "courier API ready" means in practice right now** —
  the columns exist and are hand-editable in the shape a real integration
  would read/write later; nothing calls an actual courier API yet.

### `app/page.tsx` (artist booking drawer's upsell) and
### `app/stores/[id]/page.tsx` (salon booking form's upsell)
Both had the identical "explicit picks + tag-match fill-in" upsell pattern.
Changes, mirrored in both:
- `UpsellProduct` type widened with `sell_scope`, `sell_provinces` (used to
  build a *correct* synthetic cart `Product` — see next point) and an
  optional `partner: { latitude, longitude } | [...] | null` join.
- The tag-matched query now also selects `sell_scope, sell_provinces,
  partner:profiles(latitude, longitude)`, over-fetches
  (`Math.min(remaining * 5, 30)` instead of exactly `remaining`) so there's
  something to rank, then calls `sortByLocality(...).slice(0, remaining)`.
  - `app/page.tsx`: reference point is the **customer's own GPS**
    (`geo.coords`, already in scope via the existing `useGeolocation()`
    call in `BookingDrawer`).
  - `app/stores/[id]/page.tsx`: reference point is **the salon's own
    `latitude`/`longitude`** (the `Salon` prop), not the customer's device
    location — the customer is physically travelling to that salon, so the
    salon's address is the meaningful "local" anchor, and it's always
    available (no permission prompt needed).
- **Correctness fix, not just typing**: `handleAddUpsell` previously built
  a synthetic `Product` for the cart with no `sell_scope`/`sell_provinces`
  at all (a TS error once the type gained required fields). Now passes the
  *real* fetched values through. This matters for enforcement — once
  `lib/orders.ts` enforces `sell_scope` (see below), a province-restricted
  product added via an upsell needs to actually carry that restriction into
  the cart, not silently bypass it with a fabricated "sell everywhere"
  default.

### `components/UpsellProductPicker.tsx`
One-line fix: the inline "create a product" `ProductForm` invocation is now
typecheck-valid with `sell_scope: "south_africa", sell_provinces: []`
defaults (harmless — the seller can change it from the rendered form same as
any other product).

## In progress — `app/checkout/page.tsx`

Only the import and the hardcoded province array (now `SA_PROVINCES`) are
done. **The actual feature work on this file has not been started.** Below
is the concrete plan already worked out — no need to re-derive it.

**Confirmed via RLS check: no new API route is needed.** The `profiles:
public read (active)` policy (`(account_status = 'active') OR (auth.uid() =
id)`, role `public`) already lets a signed-in customer read another
partner's full profile row client-side, address/allow_collection/
allow_courier/lat/long included — it's row-level, not column-level, and
these are all fine to be public (equivalent to a store's public address).
So: just do a plain `supabase.from("profiles").select(...)` from the
checkout page itself.

### What to build

1. **Group cart by partner.** `CartLine.product.partner_id` is already
   populated on every line (products are fetched with `select("*")`
   elsewhere in the app, so `partner_id`/`sell_scope`/`sell_provinces` are
   already on every `line.product` in the cart — confirmed, no extra fetch
   needed for those).

2. **Fetch each distinct partner's fulfillment info** in a `useEffect` keyed
   off a *stable stringified* list of partner ids (e.g.
   `[...new Set(items.map(l => l.product.partner_id))].sort().join(",")`) —
   **not** the array itself, to avoid the exact re-fetch-loop bug already
   fixed elsewhere in this codebase (see the Aug 8 "Search reload bug" note:
   effects must key off a primitive, not an object/array identity).
   ```ts
   const { data } = await supabase
     .from("profiles")
     .select("id, full_name, address, suburb, city, province, postal_code, latitude, longitude, allow_collection, allow_courier")
     .in("id", partnerIds);
   ```
   Store as `Record<string, PartnerFulfillmentInfo>`.

3. **`fulfillmentByPartner: Record<string, FulfillmentMethod>` state.**
   Initialize once partner info loads: default `"courier"` if
   `allow_courier`, else `"collection"` if `allow_collection`. If a partner
   supports only one method, don't render a toggle for them — just show a
   fixed badge/note ("Ships via courier" / "Collect in person from
   {partner}"). If they support both, render a real segmented toggle.

4. **New "Fulfillment" card**, placed between "Contact details" and
   "Delivery address": one row per partner group (need a partner display
   name — `full_name` from the fetch above, or fall back to "Seller"), the
   toggle/badge, and for collection groups show the partner's pickup
   address inline (from `partnerInfo[partnerId]`) so the customer knows
   where to go.

5. **Make "Delivery address" conditional.** Only require (and only show as
   required) if at least one partner group is on `"courier"`. If every
   group is `"collection"`, either hide the card or show it collapsed with
   a note ("No delivery address needed — you're collecting everything in
   person") — don't force the customer to fill in an address they don't
   need. Update `isFormValid` accordingly (currently:
   `form.name.trim() && form.whatsapp.trim() && form.address.trim() &&
   form.city.trim()` — the address/city part should only be required when
   at least one group needs courier).

6. **Sell_scope inline warning** (client-side pre-check, server is the real
   enforcement — see `lib/orders.ts` below): for every courier-fulfilled
   line, check `line.product.sell_scope === "province"` and, if so, whether
   `form.province` is in (`line.product.sell_provinces.length ? sell_provinces
   : [partnerInfo[partner_id]?.province]`). If not, show an inline message
   under the address card naming the affected product(s) and block submit
   (add to `isFormValid`). Collection-fulfilled lines are exempt — the
   customer is fetching it in person, no shipping range applies.

7. **Send the new fields through** in both `handlePayFast` and `handleOzow`'s
   POST bodies (currently just `shippingAddress` as one flat string):
   ```ts
   fulfillmentByPartner,       // Record<string, FulfillmentMethod>
   shippingAddressLine1: form.address,
   shippingAddressLine2: "",   // no line2 field in the form yet — add one, or leave blank
   shippingSuburb: form.suburb,
   shippingCity: form.city,
   shippingProvince: form.province,
   shippingPostalCode: form.postalCode,
   // lat/long: consider adding AddressAutocomplete here too (same Nominatim
   // component already used in dashboard/page.tsx and SalonForm) so orders
   // get real coordinates instead of none — nice-to-have, not blocking.
   shippingAddress, // keep sending the existing flat string too, for lib/orders.ts to store in the legacy column unchanged
   ```

## Remaining work — not started yet

### `lib/orders.ts` (`createPendingOrder`)
This is the shared function both `/api/payfast/initiate/route.ts` and
`/api/ozow/initiate/route.ts` call. Needs:
1. Accept the new fields from the checkout body (see above).
2. **Sell_scope enforcement**: for each line where `fulfillmentByPartner[partner_id]
   === "courier"`, check the product's `sell_scope`/`sell_provinces` against
   `shippingProvince` (same rule as the client-side check above — this is
   the authoritative version). Reject early with a clear error message
   (product name + "doesn't ship to {province}") if violated. Collection
   lines are exempt.
3. Write the structured shipping fields onto `orders` alongside the
   existing flat `shipping_address` (keep writing both).
4. **After** `orders` + `order_items` are inserted (existing flow,
   unchanged): group items by `product.partner_id`, and for each partner
   group:
   - Fetch that partner's `profiles` row (address/suburb/city/province/
     postal_code/latitude/longitude) for the origin snapshot.
   - Aggregate parcel dims from the group's products: sum `weight_g *
     quantity`, take `max(length_cm)`, `max(width_cm)`, `max(height_cm)`
     across the group (documented rough approximation — a real courier
     integration would do real bin-packing; leave a comment saying so).
   - Insert one `order_shipments` row: `fulfillment_method` from
     `fulfillmentByPartner[partner_id]` (default to `"courier"` if
     somehow missing), origin snapshot, destination snapshot (only for
     `"courier"` — leave destination fields `null` for `"collection"`),
     parcel aggregate, `status: "pending"`.
   - Update each `order_item` in that group with the new shipment's `id` →
     `shipment_id`.
5. **Use a service-role client (`createServiceClient()` from
   `lib/supabase/server.ts`) specifically for the `order_shipments`
   insert + the `order_items.shipment_id` update.** This is *required*, not
   optional — after this session's RLS fix, the customer's own session has
   no insert policy on `order_shipments` at all (by design — see the
   security section above). The existing `orders`/`order_items` inserts can
   keep using the session-scoped client they already use (their RLS is
   fine as-is). Cleanest approach: have `createPendingOrder` import
   `createServiceClient` itself and only use it for this one step, rather
   than threading an extra client parameter through both initiate routes.
6. Keep existing rollback-on-failure behavior (there's already an
   `itemsErr` rollback path for the order_items insert — extend the same
   pattern if the shipment insert fails, or at minimum log clearly, since
   at that point payment hasn't happened yet so it's not catastrophic, but
   a customer shouldn't be left with an order that has items but no
   shipment).

### `app/api/payfast/initiate/route.ts` and `app/api/ozow/initiate/route.ts`
Thin change — both currently destructure `{ items, shippingAddress,
contactName, contactWhatsapp }` from the body and pass to
`createPendingOrder`. Just add the new fields to the destructure and pass
through unchanged. (`app/api/ozow/initiate/route.ts` line ~134 is the
relevant `initiateOrder` function — `app/api/payfast/initiate/route.ts` has
the equivalent.)

### Optional nice-to-have — not requested explicitly, skip if short on time
`app/admin/orders/[id]/page.tsx` could show the linked `order_shipments` for
admin oversight (Extra is the sole admin). Read-only display, same shape as
`ShipmentsManager` above but without the edit capability (or with it, since
admin already has an "admin all" RLS policy on `order_shipments`). Not
blocking — the partner-facing `ShipmentsManager` already covers the
functional need.

## Deliberate design decisions worth knowing (so they don't get re-litigated)

- **Collection bypasses `sell_scope` entirely.** A province-restricted
  seller can still let an out-of-province customer collect in person —
  there's no shipping cost/logistics involved, so the restriction shouldn't
  apply. Only courier-fulfilled lines get checked.
- **One shared address per order, not per partner.** The schema (`orders.
  shipping_*`) only has one address; each `order_shipments.destination_*`
  is a snapshot copied from it. This matches "one delivery address for the
  whole order, but collection can be chosen per-partner" rather than
  letting the customer type a different delivery address for each seller in
  a multi-partner cart — simpler UX, matches what was actually asked for.
- **"Same city" has no real boundary data** — approximated via a 15km
  radius from lat/long (`lib/locality.ts`). Documented in-code; not worth
  reopening unless it produces visibly wrong results in practice.
- **No live courier API integration.** "Courier API ready" was interpreted
  as: the schema/columns exist in the shape a real integration would use,
  and a partner can hand-enter waybill/tracking info today. Nothing calls
  an actual courier's API — there was no specific provider named in the
  request, and this avoids fabricating a fake integration or API keys that
  don't exist.
