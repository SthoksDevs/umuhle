// lib/dashboard/types.ts
//
// Cross-cutting types/consts shared by more than one file under
// components/dashboard/*.tsx (mostly BookingsTab.tsx <-> MyOrdersTab.tsx,
// and WishlistCards.tsx <-> DashboardShell.tsx). Single-file-only types
// (MyReviewMap, ORDER_STATUS_STYLES, ServiceTypeId, etc.) stay local to
// whichever file actually uses them — see
// docs/role-based-dashboards-status.md for the full extraction map.

import type { Booking, Artist, Profile } from "@/types";

// The tabs available inside DashboardShell (customer/artist/owner). The
// employee role does not use this — EmployeeDashboard.tsx has its own,
// much smaller nav.
export type Tab = "dashboard" | "bookings" | "my-orders" | "wishlist" | "profile" | "my-business" | "invite" | "wallet";

export type BookingWithRelations = Booking & {
  artist?: Artist & { profile?: Profile };
  client?: Pick<Profile, "full_name" | "avatar_url" | "phone">;
  service?: { name: string; duration_minutes: number };
};

export type WishlistArtist = {
  artist_id: string;
  artists: Artist;
};

export const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending_payment: { bg: "#FFF3E0", color: "#E65100",  label: "Awaiting payment" },
  confirmed:       { bg: "#E8F5E9", color: "#2E7D32",  label: "Confirmed" },
  in_progress:     { bg: "#E3F2FD", color: "#1565C0",  label: "In progress" },
  completed:       { bg: "#F3E5F5", color: "#6A1B9A",  label: "Completed" },
  cancelled:       { bg: "#FAFAFA", color: "#757575",  label: "Cancelled" },
  no_show:         { bg: "#FBE9E7", color: "#BF360C",  label: "No show" },
};
