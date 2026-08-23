// types/index.ts

export type ServiceCategory = "hair" | "nails" | "makeup" | "lashes";
export type AccountStatus = "active" | "pending_review" | "suspended" | "deleted";
export type ModerationStatus = "draft" | "scanning" | "approved" | "needs_review" | "rejected";
export type BookingStatus = "pending_payment" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";

// Curated, fixed vocabulary shared between `services.tags` and
// `products.tags` (both text[]). Deliberately not free text — matching is a
// simple array-overlap query, and keeping the list small and human-picked
// means an artist only tags a service with what's genuinely relevant (e.g.
// a weave install gets "extensions"/"wigs", never "hair-care", so a client
// shaving their head off never gets shampoo recommended at booking).
export const UPSELL_TAG_GROUPS: { category: ServiceCategory | "general"; label: string; tags: { id: string; label: string }[] }[] = [
  { category: "hair", label: "Hair", tags: [
    { id: "extensions", label: "Extensions" },
    { id: "wigs", label: "Wigs & hairpieces" },
    { id: "hair-care", label: "Hair care" },
    { id: "styling-tools", label: "Styling tools" },
    { id: "color-treatment", label: "Colour & treatment" },
    { id: "braiding-supplies", label: "Braiding supplies" },
  ] },
  { category: "nails", label: "Nails", tags: [
    { id: "nail-art-supplies", label: "Nail art supplies" },
    { id: "nail-care", label: "Nail care" },
  ] },
  { category: "makeup", label: "Makeup", tags: [
    { id: "makeup-tools", label: "Makeup tools" },
    { id: "skincare", label: "Skincare" },
  ] },
  { category: "lashes", label: "Lashes", tags: [
    { id: "lash-supplies", label: "Lash supplies" },
    { id: "lash-care", label: "Lash care" },
  ] },
  { category: "general", label: "General", tags: [
    { id: "gift-sets", label: "Gift sets" },
    { id: "tools", label: "Tools" },
  ] },
];

export const ALL_UPSELL_TAGS: string[] = UPSELL_TAG_GROUPS.flatMap(g => g.tags.map(t => t.id));
export const upsellTagLabel = (id: string): string => UPSELL_TAG_GROUPS.flatMap(g => g.tags).find(t => t.id === id)?.label ?? id;

// What the person told us they signed up to do. Kept separate from the
// is_artist/is_partner flags (which reflect what's actually been set up),
// since selecting "Artist" at signup doesn't instantly create an artists row.
export type AccountType = "customer" | "artist" | "business_partner";

// Canonical South African province list — matches the check constraint on
// profiles.province / orders.shipping_province / order_shipments.*_province
// (see supabase migration "local_delivery_and_provincial_sales"). Single
// source of truth so the checkout province <select>, a product's "Sell To"
// province picker, and a partner's fulfillment address all offer the exact
// same nine options in the exact same order.
export const SA_PROVINCES = [
  "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape", "Limpopo",
  "Mpumalanga", "North West", "Free State", "Northern Cape",
] as const;
export type Province = typeof SA_PROVINCES[number];

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_artist: boolean;
  is_partner: boolean;
  is_admin: boolean;
  account_status: AccountStatus;
  suspension_reason: string | null;
  suspended_at: string | null;
  suspended_by: string | null;
  referral_code: string | null;
  referred_by: string | null;
  account_type: AccountType | null;
  artist_category: ServiceCategory | null; // set at signup when account_type = 'artist'
  poc_name: string | null;   // point-of-contact name (required before booking)
  poc_phone: string | null;  // point-of-contact WhatsApp number
  payfast_merchant_id: string | null;    // for instant PayFast split payouts — see lib/payments/split.ts
  payfast_split_approved: boolean;       // admin-set, once TKZ has allow-listed this merchant ID in PayFast's dashboard
  // ── Fulfillment address + collection/courier capability ──
  // Drives the origin snapshot on order_shipments when this profile sells
  // products, and the default sell_provinces (see Product.sell_provinces
  // below) when a product's sell_scope is "province" but the seller hasn't
  // picked specific provinces. Any profile can carry these — not gated to
  // is_partner — since a customer's own address fields are read the same
  // way at checkout. See components/ProductForm.tsx and
  // app/dashboard/page.tsx's PartnerFulfillmentSettings.
  address: string | null;
  suburb: string | null;
  city: string | null;
  province: Province | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  allow_collection: boolean; // offers in-person collection instead of courier
  allow_courier: boolean;    // ships via courier — default true, so existing sellers keep working unchanged
  created_at: string;
  updated_at: string;
}

export interface Artist {
  id: string;
  profile_id: string;
  display_name: string;
  bio: string | null;
  category: ServiceCategory;
  location: string;
  suburb: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  avatar_url: string | null;
  cover_url: string | null;
  rating: number;
  review_count: number;
  is_verified: boolean;
  is_active: boolean;
  point_of_contact_name: string | null;
  point_of_contact_phone: string | null;
  status: "pending" | "approved" | "rejected";
  moderation_score: number | null;
  created_at: string;
  // Relations
  profile?: Profile;
  services?: Service[];
  portfolio?: PortfolioImage[];
  availability?: Availability[];
}

export interface Service {
  id: string;
  artist_id: string;
  name: string;
  description: string | null;
  price: number; // ZAR cents
  duration_minutes: number;
  category: ServiceCategory | null;
  tags: string[]; // upsell tags, see UPSELL_TAG_GROUPS
  is_active: boolean;
}

export interface PortfolioImage {
  id: string;
  artist_id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
}

export interface Availability {
  id: string;
  artist_id: string;
  day_of_week: number; // 0=Sun
  start_time: string;
  end_time: string;
}

export interface Booking {
  id: string;
  client_id: string;
  artist_id: string;
  service_id: string;
  booking_date: string;
  booking_time: string;
  meeting_address: string | null;
  status: BookingStatus;
  total_amount: number; // ZAR cents
  payfast_payment_id: string | null;
  notes: string | null;
  client_poc_name: string | null;
  client_poc_phone: string | null;
  artist_poc_name: string | null;
  artist_poc_phone: string | null;
  started_at: string | null;
  completed_at: string | null;
  reminder_sent: boolean;
  created_at: string;
  commission_cents: number | null; // Umuhle's 5.5% cut, recorded at payment time
  payout_cents: number | null;     // artist's 94.5% share
  payout_credited_at: string | null; // set once the payout has been credited to the artist's wallet
  payout_via: "wallet" | "instant_split"; // 'instant_split' = already paid straight to the artist via PayFast, see lib/payments/split.ts
  // Relations
  client?: Profile;
  artist?: Artist;
  service?: Service;
}

export interface Review {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewed_id: string;
  artist_id: string | null;
  rating: number;
  comment: string | null;
  review_type: "client_to_artist" | "artist_to_client";
  moderation_status: ModerationStatus;
  created_at: string;
  reviewer?: Profile;
}

// Kept only so Product.listing_status (a frozen legacy column, see below)
// keeps typechecking.
export type ListingStatus = "pending_payment" | "active" | "expired" | "cancelled";

export interface Product {
  id: string;
  partner_id: string;
  name: string;
  description: string | null;
  price: number; // ZAR cents
  image_url: string | null;
  category: string | null;
  tags: string[]; // upsell tags, see UPSELL_TAG_GROUPS
  stock_count: number;
  is_active: boolean;
  moderation_status: ModerationStatus;
  moderation_score: number | null;
  created_at: string;
  partner?: Profile;
  // ── Legacy paid-listing fields (package/listing fee removed 2026-08) ──
  // Every product is free to list now — see components/ProductForm.tsx.
  // These stay optional/nullable purely so old rows created while the fee
  // existed keep typechecking; nothing writes them anymore.
  package?: string | null;
  listing_status?: ListingStatus | null;
  listing_package_id?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  payfast_payment_id?: string | null;
  // Drives lib/payments/eligibility.ts: an order where every line item has
  // this set to true is 100% Umuhle profit (no partner payout), so it's
  // forced onto Ozow instead of PayFast — see lib/payouts.ts for the
  // payout-side logic that already reads this same column.
  is_umuhle_product?: boolean | null;
  // ── Local delivery & provincial sales ──
  // "province" = only ships within sell_provinces (falls back to the
  // seller's own profiles.province when sell_provinces is empty);
  // "south_africa" = ships nationwide. Set on components/ProductForm.tsx,
  // enforced server-side in lib/orders.ts's createPendingOrder for any
  // line going out by courier (collection is exempt — the customer is
  // fetching it in person, so there's no shipping range to restrict).
  sell_scope: "province" | "south_africa";
  sell_provinces: string[];
  // Parcel dimensions — real columns on `products`, used to build the
  // aggregate parcel_* snapshot on order_shipments. Optional here only
  // because older rows may not have them set.
  weight_g?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  // ── Gallery + variation fields ──
  // Not yet columns on `products` (checked July 2026) — kept optional so the
  // product page's gallery rail and Colour/Size pickers render once these
  // are added, without breaking on today's rows where they're simply absent.
  gallery_urls?: string[] | null;
  colors?: string[] | null;
  sizes?: string[] | null;
  // ── Review aggregate (kept in sync by reviews_sync_product_salon_rating_trigger) ──
  rating?: number | null;
  review_count?: number | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

// "payfast" and "ozow" are the only two gateways new payments can use
// (see lib/payments/gateways.ts). "tradesafe" | "happypay" | "google_pay"
// are kept here only so existing rows created before those gateways were
// retired — and any admin screen still displaying them — keep
// typechecking; nothing should ever write those values again.
export type PaymentMethod = "payfast" | "ozow" | "tradesafe" | "happypay" | "google_pay";

export interface Order {
  id: string;
  client_id: string;
  total_amount: number;
  status: "pending_payment" | "paid" | "processing" | "shipped" | "delivered" | "cancelled";
  shipping_address: string | null; // legacy flat string — still written (joined from the fields below) for anything not yet reading the structured ones
  // ── Structured shipping address ──
  // Populated at checkout alongside the legacy shipping_address string
  // above. This is what gets snapshotted onto each order_shipments row's
  // destination_* columns for courier fulfillment.
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_suburb: string | null;
  shipping_city: string | null;
  shipping_province: Province | null;
  shipping_postal_code: string | null;
  shipping_latitude: number | null;
  shipping_longitude: number | null;
  contact_name: string | null;
  contact_whatsapp: string | null;
  payment_method: PaymentMethod | null;
  payfast_payment_id: string | null;
  gateway_order_id: string | null; // PayFast pf_payment_id / Ozow TransactionId
  payout_via: "wallet" | "instant_split"; // 'instant_split' = already paid straight to a single partner via PayFast, see lib/payments/split.ts
  created_at: string;
  order_items?: OrderItem[];
  order_shipments?: OrderShipment[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  commission_cents: number | null; // Umuhle's 5.5% cut, recorded at payment time
  payout_cents: number | null;     // partner's 94.5% share
  payout_credited_at: string | null; // set once the payout has been credited to the partner's wallet
  shipped_at: string | null;    // set when the partner marks this item dispatched
  delivered_at: string | null;  // set when the customer confirms receipt via their confirm link
  confirm_token: string | null; // opaque token backing the customer's confirm-receipt link
  shipment_id: string | null;   // which order_shipments row (i.e. which partner's parcel) this line rides in — see OrderShipment
  product?: Product;
  shipment?: OrderShipment | null;
}

// One row per partner per order — one parcel/waybill. A single cart can
// span several partners (possibly in different cities); each gets its own
// shipment here rather than the order carrying one flat shipping address,
// which is what actually makes multi-partner carts workable for courier
// booking. See supabase migration "local_delivery_and_provincial_sales"
// and lib/orders.ts's createPendingOrder (where these rows get created).
export type FulfillmentMethod = "collection" | "courier";
export type ShipmentStatus =
  | "pending"               // just created, nothing actioned yet
  | "ready_for_collection"  // partner has it ready, waiting on the customer to fetch it
  | "collected"             // customer picked it up in person
  | "booked"                // courier booking made (waybill_number set) — pre-collection
  | "in_transit"
  | "delivered"
  | "cancelled";

export interface OrderShipment {
  id: string;
  order_id: string;
  partner_id: string;
  fulfillment_method: FulfillmentMethod;
  status: ShipmentStatus;
  // Origin snapshot — partner's dispatch/pickup address at order time (see
  // Profile.address etc.), frozen here so a partner moving premises later
  // doesn't retroactively change an in-flight parcel's recorded origin.
  origin_address: string | null;
  origin_suburb: string | null;
  origin_city: string | null;
  origin_province: Province | null;
  origin_postal_code: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
  // Destination snapshot — irrelevant/null for collection.
  destination_address_line1: string | null;
  destination_address_line2: string | null;
  destination_suburb: string | null;
  destination_city: string | null;
  destination_province: Province | null;
  destination_postal_code: string | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  // Aggregate parcel, derived from the products riding in this shipment.
  parcel_weight_g: number | null;
  parcel_length_cm: number | null;
  parcel_width_cm: number | null;
  parcel_height_cm: number | null;
  // Courier API fields — courier_provider/waybill_number/tracking_url/
  // courier_reference/courier_booked_at were originally hand-filled (see
  // app/dashboard/page.tsx's OrderFulfillmentManager); as of the Ship
  // Logic (The Courier Guy) integration (lib/shiplogic.ts), booking one of
  // these via ShipmentsManager populates them automatically instead —
  // manual entry still works as a fallback/override.
  courier_provider: string | null;
  waybill_number: string | null;
  tracking_url: string | null;
  courier_reference: string | null; // Ship Logic's own shipment id
  courier_booked_at: string | null;
  collected_at: string | null;
  delivered_at: string | null;
  created_at: string;
  // Rate quote captured at checkout (lib/orders.ts) — the price the
  // customer actually paid for this parcel's shipping, and the service
  // level booking should honour rather than re-shop at ship time.
  service_level_code: string | null;
  service_level_name: string | null;
  quoted_rate_cents: number | null;
  rate_quoted_at: string | null;
  last_rate_quote: Record<string, unknown> | null; // full provider rate response, for support/debugging
  // Tracking sync (manual "Sync tracking" button + the courier-tracking-sync
  // cron) — courier_status is the provider's own raw status string;
  // `status` (above) is our normalised ShipmentStatus.
  courier_status: string | null;
  courier_synced_at: string | null;
  courier_error: string | null; // last booking/sync failure message, if any
}

// Ads (a separate paid promotional-content entity) were removed in
// 2026-08 — products now serve as the site's upsells directly, optionally
// linked to a service. See ServiceUpsellProduct and lib/payments/split.ts.

export interface PartnerSalon {
  id: string;
  partner_id: string;
  name: string;
  description: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  opening_hours: Record<string, { open: string; close: string; closed?: boolean }>;
  gallery_urls: string[];
  is_active: boolean;
  subscription_until: string | null;
  moderation_status: ModerationStatus;
  created_at: string;
}

export interface StoreBranch {
  id: string;
  salon_id: string;
  name: string;
  is_primary: boolean;
  address: string | null;
  suburb: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  opening_hours: Record<string, { open: string; close: string; closed?: boolean }>;
  banner_url: string | null;
  brand_color_primary: string | null;
  brand_color_secondary: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BranchEmployee {
  id: string;
  branch_id: string;
  artist_id: string | null;
  name: string;
  photo_url: string | null;
  bio: string | null;
  specialties: string[];
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_id: string;
  referred_id: string;
  status: "pending" | "rewarded";
  reward_amount: number;
  rewarded_at: string | null;
  trigger_ad_id: string | null;
  created_at: string;
  referred?: Profile;
}

export interface Wallet {
  id: string;
  profile_id: string;
  available_balance: number;
  pending_balance: number;
  approved_balance: number;
  total_earned: number;
  updated_at: string;
  transactions?: WalletTransaction[];
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  amount: number;
  type: "credit" | "debit";
  description: string;
  reference_id: string | null;
  source_type: "booking" | "order_item" | "referral" | "withdrawal" | "adjustment" | null;
  source_id: string | null;
  clears_at: string | null; // when a pending credit becomes available; null/past = already available
  created_at: string;
}

export interface Withdrawal {
  id: string;
  profile_id: string;
  amount: number;
  bank_name: string;
  account_number: string;
  account_holder: string;
  status: "pending" | "approved" | "paid" | "rejected";
  processed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  reporter_id: string;
  content_type: "ad" | "product" | "salon" | "review" | "artist";
  content_id: string;
  reason: "spam" | "offensive" | "fraud" | "misleading";
  description: string | null;
  status: "open" | "reviewed" | "dismissed";
  created_at: string;
}

export const ARTIST_CATEGORIES: { id: ServiceCategory; label: string }[] = [
  { id: "hair", label: "Hair stylist" },
  { id: "nails", label: "Nail technician" },
  { id: "makeup", label: "Makeup artist" },
  { id: "lashes", label: "Lashes" },
];

export const ACCOUNT_TYPES: { id: AccountType; label: string; blurb: string }[] = [
  { id: "customer", label: "Customer", blurb: "Book artists & shop products" },
  { id: "artist", label: "Artist", blurb: "Hair, nails, makeup or lashes" },
  { id: "business_partner", label: "Business Partner", blurb: "Sell beauty products" },
];

// Paid listing packages (Starter/Growth/Business/Premium) and the
// separate Ads entity were both removed in 2026-08. Listing a product is
// free — see components/ProductForm.tsx and app/dashboard/page.tsx's
// ProductsManager. Products can optionally link to a service as an
// upsell instead — see ServiceUpsellProduct below and
// UPSELL_TAG_GROUPS above.
