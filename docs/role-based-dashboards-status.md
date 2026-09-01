# Role-based dashboards — status & handoff

Splitting the single `app/dashboard/page.tsx` monolith (4,911 lines, one
tab-switcher UI shown identically to every account type) into separate
Customer / Employee / Artist / Store Owner dashboards, per the original
brief. This doc is the continuity thread across sessions — read this before
doing anything else on this feature.

## Where this came from

1. **Schema pass** (done, live): `supabase/migrations/20260830_role_based_dashboards.sql`
   added `profiles.is_employee`/`is_seller`/`seller_enabled_at`,
   `branch_employees.profile_id`/`rank`/`can_manage_products`/
   `can_manage_calendar`/`can_view_analytics`/`can_view_revenue`/
   `invited_by`/`invite_status`, and the `branch_employee_availability`
   table. `20260830_employee_self_access_rls.sql` fixed RLS so an employee
   can read their own `branch_employees`/`branch_employee_availability`/
   `store_bookings` rows. **Both are applied to production** (project
   `kfgvhxrsyvmukgfqpaqz`) and now also committed as migration files in
   this repo (this session backfilled them from
   `supabase_migrations.schema_migrations.statements` on the live DB —
   byte-accurate, not reconstructed).
2. **Route split** (in progress, this doc's subject): extracting the
   monolith into per-tab components, a role-aware shell, and real
   `/dashboard/{customer,employee,artist,owner}` routes.
3. **Deferred, explicitly sequenced after this**: the owner-side employee
   invite flow, and an owner UI for granting the four `can_*` permission
   flags. Don't start these until the route split is done and pushed — see
   "Explicitly deferred" below.

## The core design decision

`DashboardShell` (customer/artist/owner) is **one shared component**
parameterized by a `role` prop, not three separate implementations —
almost every tab (bookings, my-orders, wishlist, profile, wallet, invite)
is genuinely identical across those three roles; only **My Business**
differs, and only in which of its four sections (stores/services/products/
orders) are visible. Employee is NOT part of this shell — it's a wholly
separate `EmployeeDashboard` component, because per the brief an employee
account has almost nothing in common with the other three (no orders, no
wishlist, no wallet, no personal bookings — just password, own availability,
own assigned store bookings, own reviews).

Per-role visibility, as designed (not yet fully wired into DashboardShell):
- **Customer**: baseline tabs always; My Business only if `profile.is_seller`,
  and only the Products + Orders sections (never Stores/Services).
- **Artist**: baseline tabs; My Business always shows Services, plus
  Products/Orders if `profile.is_seller`.
- **Owner**: baseline tabs; My Business always shows Stores + Products +
  Orders (never Services — that's an artist's personal catalog, not a
  store's).
- **Employee**: none of the above. Separate component entirely.

Root `/dashboard` is a server component that resolves role via
`getDashboardContext()` and **redirects to `/dashboard/{role}`, preserving
the query string** — `/dashboard?tab=wishlist&sub=products` links are
already baked into sent emails/WhatsApp templates (see `lib/email.ts`,
`lib/whatsapp.ts`, `lib/push-server.ts`) and must keep working unchanged.
Each `/dashboard/{role}/layout.tsx` independently guards eligibility via
`isEligibleForRole()` (customer is the universal baseline everyone can
reach; the other three require the matching profile flag) and redirects to
`/dashboard` (which re-resolves) if not eligible.

## ⚠️ The recurring gotcha — read this before extracting anything else

The monolith's function-start line numbers (from `grep -n "^function "`)
are **not** reliable section boundaries. Repeatedly, a `// ─── Section
Name ───` comment marking the start of tab N's code actually sits *after*
some trailing types/consts that are used by tab N but were physically
typed at the end of tab N-1's block. Every one of these was silently wrong
until checked by hand:

- `GeocodeSuggestion` type looked like part of "My Salon tab" prep but is
  actually only used by `AddressAutocomplete` + `PartnerFulfillmentSettings`
  (Profile tab) → had to relocate.
- `PartnerFulfillmentSettings`'s real closing `}` is line 821, not 899 —
  everything from 824–899 (`DayHours`/`SalonListing`/`StoreBooking`/
  `GalleryFile`/`WEEK_DAYS`/`ALL_SERVICES`/`defaultDay`) is My-Salon-tab
  prep, not part of Profile tab.
- `MySalonTab`'s real closing `}` is line 2482, not 2519 — lines 2484–2519
  (`StyleEntry`/`ServiceStyles`/`ArtistService`/`ServiceFormState`/
  `EMPTY_SERVICE_FORM`) are My-Services-tab prep.
- `MyShopTab` closes at line 4204; everything after (BATCH 4 comment,
  `ProductOrderWithItems`/`OrderHistoryEntry` types, and — found but not
  yet trimmed — a dead unused `PartnerProductRow` interface) belongs to
  My-Orders-tab, not My-Shop-tab.
- `WalletTab`+`PayFastMerchantSection`'s real end is before the `// ───
  Point of Contact popup ───` comment + `type PocStatus` — those two lines
  belong to `BookingsTab.tsx` (already fixed in this session — see below).

**Do this for every remaining extraction**: after slicing a range, `tail
-40` it and check whether the last thing in the slice is actually a type/
const that's *used by the next component*, not the one you're extracting.
When in doubt, `grep -n "\bTypeName\b" app/dashboard/page.tsx` (if the
monolith still exists in your checkout) and check every usage line falls
inside the range you think it does.

`fmtShop` (a near-duplicate of `fmt`) and the `PartnerProductRow` interface
mentioned above are both **confirmed dead code** — defined, never
referenced anywhere. Drop them rather than carry them over.

## Done and pushed (this branch)

Backfilled, verbatim from production:
- `supabase/migrations/20260830_role_based_dashboards.sql`
- `supabase/migrations/20260830_employee_self_access_rls.sql`

New/updated app code:
- `types/index.ts` — `Profile.is_employee`/`is_seller`/`seller_enabled_at`,
  updated `BranchEmployee`, new `BranchEmployeeAvailability`. Matched
  column-for-column against live `information_schema.columns` and the
  `rank`/`invite_status` CHECK constraints — not guessed.
- `lib/dashboard/format.ts` — `ICON`, `fmt`, `formatDate` (shared helpers
  used by many of the new tab files; `fmtShop` intentionally dropped as
  dead code).
- `lib/dashboard/types.ts` — `Tab`, `BookingWithRelations`, `WishlistArtist`,
  `STATUS_STYLES` (the subset of the monolith's shared types actually used
  by *more than one* new file — genuinely single-file types like
  `MyReviewMap`/`ORDER_STATUS_STYLES` were left local to whichever file
  needs them).
- `lib/dashboard/context.ts` — `getDashboardContext()`, `resolveDashboardRole()`,
  `isEligibleForRole()`. This is the server-side helper every
  `app/dashboard/{role}/layout.tsx` guard will call. **Not yet used
  anywhere** — no layout files exist yet.
- `components/dashboard/AddressAutocomplete.tsx` — new shared component
  (was duplicated-in-spirit across two call sites in the monolith; now one
  file, imported by both `ProfileTab.tsx` and `MySalonTab.tsx`).
- `components/dashboard/ProfileTab.tsx` — `ProfileTab` (default export) +
  local `ReviewInsightsCard` + `PartnerFulfillmentSettings`.
- `components/dashboard/MySalonTab.tsx` — `MySalonTab` (default export) +
  local `SalonForm`/`SalonBookingsInbox`/`BranchStaffManager`/`StaffForm`/
  `ServiceManager`/`emptySalon`. **Scope note**: `BranchStaffManager`/
  `StaffForm` are relocated *verbatim* — still the pre-migration
  display-only roster UI (name/photo/bio/specialties only). They do NOT
  yet expose `rank`/the four `can_*` permission columns or the invite
  flow. That's the deliberately-deferred work — see below.
- `components/dashboard/MyServicesTab.tsx` — `MyServicesTab` (default
  export) + local `PricedServicesManager` + `SERVICE_TYPES`/`ServiceTypeId`.
- `components/dashboard/InviteTab.tsx` — `InviteTab` (default export).
- `components/dashboard/WalletTab.tsx` — `WalletTab` (default export) +
  local `PayFastMerchantSection` + `MIN_WITHDRAWAL_CENTS`.

None of these are imported by anything live yet (the old
`app/dashboard/page.tsx` monolith is untouched and still what's actually
deployed) — pushing them is safe and additive, not a live behavior change.

## Not started yet — exact next steps, in order

1. **`components/dashboard/BookingsTab.tsx`** — in progress when this doc
   was written. Source ranges (from the original monolith,
   `app/dashboard/page.tsx` at the commit this branch forked from):
   lines 136–223 (`BookingCard`) + 3532–4177 (comment + `type PocStatus` +
   `PocPopup` + `BookingsTab` + `ClientBookingCard` + `ClientBookingsPanel`),
   **trimmed of the trailing dead `PartnerProductRow` interface and the
   `// ─── My Shop tab ───` comment** (those belong to the next file).
   Needs `MyReviewMap` type (local — only used here), plus `BookingWithRelations`/
   `STATUS_STYLES` from `lib/dashboard/types.ts`. Also needs `StarRating`,
   `ReviewModal`/`SubmittedReview`, `computeReliabilityScore`, `fmt`/
   `formatDate`/`ICON`.
2. **`components/dashboard/MyShopTab.tsx`** — tiny. Just the `MyShopTab`
   function (original lines ~4194–4204), which is a thin wrapper around the
   already-extracted `ProductsManager`. Drop the dead `PartnerProductRow`
   interface and `fmtShop` sitting next to it in the original — neither is
   used.
3. **`components/dashboard/MyOrdersTab.tsx`** — original lines ~4206–4457
   (`ProductOrderWithItems`/`OrderHistoryEntry` types + `ReorderButton` +
   `ProductOrderCard` + `BookingHistoryCard` + `MyOrdersTab`). Needs
   `BookingWithRelations`/`STATUS_STYLES` from `lib/dashboard/types.ts`,
   local `ORDER_STATUS_STYLES`. Needs `useRouter`, `useCart`, `Order`/
   `OrderItem`/`Product`/`Artist` types.
4. **`components/dashboard/WishlistCards.tsx`** — original lines 224–305
   (`WishlistCard` + `ProductWishlistCard`, both need to be **named
   exports**, not just default — `DashboardShell` renders both directly).
   Needs `WishlistArtist` from `lib/dashboard/types.ts`.
5. **`components/dashboard/DashboardHome.tsx`** — original lines 4458–4523,
   straightforward, default export.
6. **`components/dashboard/DashboardShell.tsx`** — the big one. Original
   lines 4524–4900 (`DashboardContent`) plus the `useArtistLocationPing`
   hook (lines 49–79). Rename to `DashboardShell`, add a `role: "customer" |
   "artist" | "owner"` prop (from `lib/dashboard/context.ts`'s
   `DashboardRole`, minus `"employee"`), and use it to compute:
   - which `businessSections` array to pass to `MyBusinessTab` (see #7 —
     needs that prop added first), per the "core design decision" table
     above.
   - Everything else (bookings/my-orders/wishlist/profile/wallet/invite)
     stays visible for all three roles, unchanged from current behavior.
   Keep its existing client-side self-fetch of user+profile via
   `supabase.auth.getUser()` — don't move that server-side, it's load-bearing
   for the WhatsApp nudge timing / tour trigger / legal-reacceptance modal
   logic already in there and rewriting it is out of scope for this pass.
   Import all the tab components from their new files instead of having
   them in-module.
7. **`components/dashboard/MyBusinessTab.tsx`** — currently hardcodes all
   4 nav sections (Stores/Services/Products/Orders) unconditionally. Add an
   optional `sections?: BusinessSection[]` prop (default: all four, for
   backward compat) that filters both the nav buttons and which content
   prop needs to be provided. `stores`/`services`/`products`/`orders`
   props should become optional (`ReactNode | undefined`) so
   `DashboardShell` only constructs (and only queries) the tab components
   actually relevant to the current role.
8. **`components/dashboard/EmployeeDashboard.tsx`** — brand new, no
   monolith source to extract from (this role has no UI today). Needs:
   password change (via Supabase Auth's `updateUser({ password })` directly
   — **not** a `profiles` column, per the design decision already made:
   "employee shouldn't have access to address... only thing they need is a
   password"), own weekly availability (CRUD against
   `branch_employee_availability`, scoped to the caller's own
   `branch_employees` row(s) via `getDashboardContext().employeeAssignments`),
   own assigned `store_bookings` (`WHERE branch_employee_id = <their row>`
   — distinct from the branch-wide `SalonBookingsInbox` in
   `MySalonTab.tsx`, which stays behind `can_manage_calendar`), and reviews
   on those bookings (`reviews.store_booking_id → store_bookings.branch_employee_id`
   join, no direct FK needed). A multi-branch employee (row per branch) should
   probably get a simple branch switcher if `employeeAssignments.length > 1`.
9. **Routes**:
   - `app/dashboard/page.tsx` — rewrite as an async server component
     (drop `"use client"`), `export const dynamic = "force-dynamic"`
     (matches the convention in `app/[adminSlug]/page.tsx`), `searchParams`
     as a `Promise` (Next 16 convention — see that same file for the exact
     shape), calls `getDashboardContext()`, redirects to
     `/dashboard/${role}` with the search string appended. Redirect to
     `/?auth=login` if `getDashboardContext()` returns null (defensive —
     `proxy.ts` should already have caught this).
   - `app/dashboard/customer/layout.tsx`, `.../artist/layout.tsx`,
     `.../owner/layout.tsx`, `.../employee/layout.tsx` — each: call
     `getDashboardContext()`, `isEligibleForRole(profile, "<this role>")`,
     redirect to `/dashboard` if false, else render `children`.
   - `app/dashboard/customer/page.tsx`, `.../artist/page.tsx`,
     `.../owner/page.tsx` — each a thin `"use client"` page rendering
     `<DashboardShell role="customer" />` etc.
   - `app/dashboard/employee/page.tsx` — renders `<EmployeeDashboard />`.
   - No changes needed to `proxy.ts` (already prefix-matches `/dashboard`),
     `components/SiteHeader.tsx` (its active-link check already does
     `pathname.startsWith(href + "/")`), or `components/DashboardTour.tsx`
     (matches by `data-tour-id` DOM attribute, degrades gracefully if a
     tour step's target is hidden for a given role).
10. Once all of the above compiles, run an actual build check this time
    (`npm install && npx next build`, or at least `npx tsc --noEmit`) —
    it was explicitly skipped in earlier sessions to prioritize getting
    code pushed before hitting a tool-call limit. That tradeoff should
    NOT continue indefinitely; verify before this goes anywhere near a
    real PR merge.
11. Open a PR (not a direct push to `main` — see "why a PR" below), get it
    building clean in CI/preview if this repo has that, then merge.

## Explicitly deferred (don't start until the above is merged)

Per the user's own sequencing:
1. The owner-side employee **invite flow** (owner enters name/phone →
   creates `profiles` + `branch_employees` row with
   `invite_status='pending'` → employee sets their own password to
   activate). `branch_employees.invite_status` already supports
   `'pending'`/`'active'`/`'revoked'` (DB CHECK constraint, confirmed live).
2. An owner-side UI for granting the four `can_manage_products`/
   `can_manage_calendar`/`can_view_analytics`/`can_view_revenue` flags per
   employee, and the "add up to 2 managers per branch" hierarchy UI (the
   DB-side cap is already enforced live by trigger `trg_branch_manager_cap`
   on `branch_employees` — don't reimplement that check in application
   code, just surface it).
3. Store analytics / branch revenue dashboards — confirmed to not exist
   anywhere yet (owner or otherwise), currently only an email cron report.
   No schema work needed, this is a pure new-UI task whenever it's picked
   up.

## Why a PR, not a direct push to main

Multiple Claude sessions have touched this repo/project back-to-back in
short succession. A direct push to `main` risks a race if two sessions
overlap. Branch + PR, even working solo, costs nothing and avoids that
class of mistake.
