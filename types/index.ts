// types/index.ts

export type ServiceCategory = "hair" | "nails" | "makeup" | "lashes";
export type AccountStatus = "active" | "pending_review" | "suspended" | "deleted";
export type ModerationStatus = "draft" | "scanning" | "approved" | "needs_review" | "rejected";
export type BookingStatus = "pending_payment" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";

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
  moderation_status: ModerationStatus;
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

export interface Product {
  id: string;
  partner_id: string;
  name: string;
  description: string | null;
  price: number; // ZAR cents
  image_url: string | null;
  category: string | null;
  stock_count: number;
  is_active: boolean;
  moderation_status: ModerationStatus;
  moderation_score: number | null;
  created_at: string;
  partner?: Profile;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export type PaymentMethod = "payfast" | "happypay" | "google_pay" | "ozow";

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
  gateway_order_id: string | null; // HappyPay order id / Google Pay token reference
  created_at: string;
  order_items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product?: Product;
}

export interface Ad {
  id: string;
  partner_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  link_url: string | null;
  category: ServiceCategory | "general" | null;
  package: "starter" | "growth" | "business" | "premium";
  ads_count: number;
  price: number;
  status: "pending_payment" | "active" | "expired" | "cancelled";
  payfast_payment_id: string | null;
  starts_at: string | null;
  expires_at: string | null;
  moderation_status: ModerationStatus;
  created_at: string;
  partner?: Profile;
}

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

export const AD_PACKAGES = [
  { id: "starter",  name: "Starter",  price: 2000,  ads: 1,  weeks: 6,  label: "6 weeks" },
  { id: "growth",   name: "Growth",   price: 4500,  ads: 3,  weeks: 12, label: "3 months" },
  { id: "business", name: "Business", price: 7500,  ads: 6,  weeks: 16, label: "4 months" },
  { id: "premium",  name: "Premium",  price: 11500, ads: 10, weeks: 24, label: "6 months" },
] as const;

export type AdPackageId = "starter" | "growth" | "business" | "premium";