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
  shipping_address: string | null;
  contact_name: string | null;
  contact_whatsapp: string | null;
  payment_method: PaymentMethod | null;
  payfast_payment_id: string | null;
  gateway_order_id: string | null; // PayFast pf_payment_id / Ozow TransactionId
  payout_via: "wallet" | "instant_split"; // 'instant_split' = already paid straight to a single partner via PayFast, see lib/payments/split.ts
  created_at: string;
  order_items?: OrderItem[];
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
  product?: Product;
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
