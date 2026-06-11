// types/index.ts

export type UserRole = "client" | "partner" | "admin";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
}

export type ServiceCategory = "hair" | "nails" | "makeup" | "skincare" | "lashes";

export interface Artist {
  id: string;
  profile_id: string;
  display_name: string;
  bio: string | null;
  category: ServiceCategory;
  location: string;
  suburb: string;
  city: string;
  avatar_url: string | null;
  cover_url: string | null;
  rating: number;
  review_count: number;
  is_verified: boolean;
  is_active: boolean;
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
  price: number; // in ZAR cents
  duration_minutes: number;
  category: ServiceCategory;
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
  day_of_week: number; // 0=Sun, 1=Mon ... 6=Sat
  start_time: string; // HH:MM
  end_time: string; // HH:MM
}

export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Booking {
  id: string;
  client_id: string;
  artist_id: string;
  service_id: string;
  booking_date: string; // YYYY-MM-DD
  booking_time: string; // HH:MM
  status: BookingStatus;
  total_amount: number; // ZAR cents
  payfast_payment_id: string | null;
  notes: string | null;
  created_at: string;
  // Relations
  client?: Profile;
  artist?: Artist;
  service?: Service;
}

export interface Review {
  id: string;
  booking_id: string;
  client_id: string;
  artist_id: string;
  rating: number; // 1-5
  comment: string | null;
  created_at: string;
  // Relations
  client?: Profile;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // ZAR cents
  image_url: string | null;
  category: string;
  stock_count: number;
  is_active: boolean;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Order {
  id: string;
  client_id: string;
  items: OrderItem[];
  total_amount: number; // ZAR cents
  status: "pending_payment" | "paid" | "shipped" | "delivered" | "cancelled";
  shipping_address: string | null;
  payfast_payment_id: string | null;
  created_at: string;
}

export interface OrderItem {
  product_id: string;
  quantity: number;
  unit_price: number;
}

// PayFast
export interface PayFastPaymentData {
  merchant_id: string;
  merchant_key: string;
  return_url: string;
  cancel_url: string;
  notify_url: string;
  name_first: string;
  name_last: string;
  email_address: string;
  m_payment_id: string;
  amount: string; // "150.00"
  item_name: string;
  item_description?: string;
  signature: string;
}

// WhatsApp
export interface WhatsAppMessage {
  to: string; // E.164 format e.g. +27821234567
  template?: string;
  body?: string;
}

// Dashboard stats
export interface PartnerStats {
  total_bookings: number;
  pending_bookings: number;
  completed_bookings: number;
  total_revenue: number; // ZAR cents
  this_month_revenue: number;
  avg_rating: number;
  review_count: number;
}
