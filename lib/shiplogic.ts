// lib/shiplogic.ts
//
// Client for The Courier Guy's underlying booking platform, Ship Logic
// (api.shiplogic.com/v2) — rate quotes, shipment booking, and tracking.
// Used by: app/api/checkout/courier-rates, lib/orders.ts (persisting the
// quote onto order_shipments), app/api/vendor/shipments/[id]/book,
// app/api/vendor/shipments/[id]/track, and the courier-tracking-sync cron.
//
// ── MOCK MODE ──
// Ship Logic has no shared public sandbox credential the way PayFast does
// (merchant_id 10000100 / merchant_key 46f0cd694581a) — every account,
// including the free sandbox tier, is tied to a real signup at
// shiplogic.com. Until SHIPLOGIC_API_KEY is set in the environment, every
// function below returns deterministic, clearly-labelled fake data instead
// of calling the real API, so the whole quote → book → track loop is
// testable end-to-end today. Nothing here needs to change when a real key
// is added later — mock mode just stops triggering (see isMockMode()).
//
// Real API reference: https://www.shiplogic.com/api-docs — rates via
// POST /v2/rates, booking via POST /v2/shipments, tracking via
// GET /v2/tracking/shipments/{tracking_reference}. Field names below match
// Ship Logic's documented request/response shape (confirmed against a
// working POST /v2/rates example), but the booking/tracking response
// field names in particular are our best-effort reading of their docs —
// worth a quick check against a live sandbox response once Extra has an
// account, in case a field name or two needs adjusting.

interface ShipLogicAddress {
  type: "business" | "residential";
  company?: string;
  street_address: string;
  local_area?: string;
  city: string;
  zone: string; // province
  country: string; // "ZA"
  code: string; // postal code
}

interface ShipLogicParcel {
  submitted_length_cm: number;
  submitted_width_cm: number;
  submitted_height_cm: number;
  submitted_weight_kg: number;
}

export interface CourierRate {
  serviceLevelCode: string;
  serviceLevelName: string;
  serviceLevelDescription: string | null;
  rateCents: number;
  deliveryDateFrom: string | null;
  deliveryDateTo: string | null;
  raw: unknown; // full provider payload — stashed in order_shipments.last_rate_quote for reference
}

export interface BookedShipment {
  shiplogicShipmentId: string;
  waybillNumber: string;
  trackingReference: string;
  trackingUrl: string | null;
  labelUrl: string | null;
  isMock: boolean;
}

export type CourierShipmentStatus = "pending" | "booked" | "collected" | "in_transit" | "delivered" | "cancelled";

export interface TrackingUpdate {
  status: CourierShipmentStatus;
  courierStatusRaw: string;
  collectedAt: string | null;
  deliveredAt: string | null;
}

const API_BASE = process.env.SHIPLOGIC_API_BASE || "https://api.shiplogic.com/v2";
const API_KEY = process.env.SHIPLOGIC_API_KEY || "";

export const COURIER_PROVIDER_LABEL = "The Courier Guy";
export const COURIER_PROVIDER_LABEL_MOCK = "The Courier Guy (sandbox — mock)";

export function isMockMode(): boolean {
  return !API_KEY;
}

// ── Global courier pause ─────────────────────────────────────────────────────
// Lets checkout stop quoting/charging for Ship Logic courier platform-wide
// (e.g. while rates are too high, or a courier application is pending)
// without touching anything else here — booking (createShipment) and
// tracking (getTracking) still work as before for shipments already placed,
// and this flips back with an env var, no code change. Checked at the two
// courier-checkout call sites: app/api/checkout/courier-rates/route.ts and
// lib/orders.ts's createPendingOrder. NEXT_PUBLIC_ so the same flag also
// gates the client-side checkout UI (see app/checkout/page.tsx) without a
// second variable to keep in sync.
export function isCourierCheckoutEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COURIER_CHECKOUT_ENABLED !== "false";
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
}

// ── Address / parcel builders ───────────────────────────────────────────────
// Shared by the rate-quote and booking call sites so the two never build
// slightly different address shapes for the same partner/order.

export function buildAddress(opts: {
  company?: string | null;
  streetAddress: string | null;
  suburb?: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  isBusiness?: boolean;
}): ShipLogicAddress {
  return {
    type: opts.isBusiness ? "business" : "residential",
    company: opts.company ?? "",
    street_address: opts.streetAddress ?? "",
    local_area: opts.suburb ?? "",
    city: opts.city ?? "",
    zone: opts.province ?? "",
    country: "ZA",
    code: opts.postalCode ?? "",
  };
}

export function buildParcel(opts: {
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}): ShipLogicParcel {
  // Every dimension has a sane floor — an unpackaged/undimensioned product
  // still needs *something* submitted, and 0s get rejected by real courier
  // APIs as an invalid parcel.
  const kg = Math.max(0.5, (opts.weightG ?? 500) / 1000);
  return {
    submitted_weight_kg: Math.round(kg * 10) / 10,
    submitted_length_cm: Math.max(10, opts.lengthCm ?? 20),
    submitted_width_cm: Math.max(10, opts.widthCm ?? 15),
    submitted_height_cm: Math.max(5, opts.heightCm ?? 10),
  };
}

// ── Mock helpers ─────────────────────────────────────────────────────────────
// Deterministic (same inputs → same quote) so refreshing checkout doesn't
// make the price jump around, and roughly weight/distance-shaped so it
// still feels like a real courier quote while there's no live account.

type LatLng = { lat: number | null; lng: number | null };

function mockDistanceKm(a: LatLng, b: LatLng): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 400; // unknown → assume a national trip, not a cheap local one
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function mockRates(weightKg: number, distanceKm: number): CourierRate[] {
  const base = 4500; // R45 floor
  const perKg = 800; // R8/kg
  const perKm = 15; // R0.15/km
  const eco = Math.round(base + weightKg * perKg + distanceKm * perKm);
  const overnight = Math.round(eco * 1.6 + 2000);
  const now = Date.now();
  const day = 86400000;
  return [
    {
      serviceLevelCode: "ECO",
      serviceLevelName: "Economy (mock)",
      serviceLevelDescription: "Simulated quote — no live Ship Logic account connected yet.",
      rateCents: Math.min(eco, 85000),
      deliveryDateFrom: new Date(now + 2 * day).toISOString(),
      deliveryDateTo: new Date(now + 4 * day).toISOString(),
      raw: { mock: true },
    },
    {
      serviceLevelCode: "ONX",
      serviceLevelName: "Overnight (mock)",
      serviceLevelDescription: "Simulated quote — no live Ship Logic account connected yet.",
      rateCents: Math.min(overnight, 120000),
      deliveryDateFrom: new Date(now + 1 * day).toISOString(),
      deliveryDateTo: new Date(now + 2 * day).toISOString(),
      raw: { mock: true },
    },
  ];
}

// ── Rates ────────────────────────────────────────────────────────────────────

export async function getRates(opts: {
  collection: ShipLogicAddress;
  delivery: ShipLogicAddress;
  collectionCoords?: LatLng;
  deliveryCoords?: LatLng;
  parcels: ShipLogicParcel[];
  declaredValueCents: number;
}): Promise<{ rates: CourierRate[]; isMock: boolean }> {
  if (isMockMode()) {
    const weightKg = opts.parcels.reduce((s, p) => s + p.submitted_weight_kg, 0);
    const distance = mockDistanceKm(
      opts.collectionCoords ?? { lat: null, lng: null },
      opts.deliveryCoords ?? { lat: null, lng: null }
    );
    return { rates: mockRates(weightKg, distance), isMock: true };
  }

  const today = new Date().toISOString().split("T")[0];
  const res = await fetch(`${API_BASE}/rates`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      collection_address: opts.collection,
      delivery_address: opts.delivery,
      parcels: opts.parcels,
      declared_value: Math.round(opts.declaredValueCents / 100),
      collection_min_date: today,
      delivery_min_date: today,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ship Logic rates request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const rawRates: Record<string, any>[] = data?.result?.rates ?? data?.rates ?? [];
  const rates: CourierRate[] = rawRates.map((r) => ({
    serviceLevelCode: r.service_level?.code ?? r.service_level_code ?? "UNKNOWN",
    serviceLevelName: r.service_level?.name ?? r.service_level_name ?? "Courier",
    serviceLevelDescription: r.service_level?.description ?? null,
    rateCents: Math.round(Number(r.rate ?? r.total_charge ?? 0) * 100),
    deliveryDateFrom: r.service_level?.delivery_date_from ?? null,
    deliveryDateTo: r.service_level?.delivery_date_to ?? null,
    raw: r,
  }));
  return { rates, isMock: false };
}

// ── Booking ──────────────────────────────────────────────────────────────────

export async function createShipment(opts: {
  collection: ShipLogicAddress;
  delivery: ShipLogicAddress;
  parcels: ShipLogicParcel[];
  declaredValueCents: number;
  serviceLevelCode: string;
  reference: string; // our order_shipments.id — round-trips into Ship Logic's own dashboard as customer_reference
  collectionContactName?: string | null;
  collectionContactPhone?: string | null;
  deliveryContactName?: string | null;
  deliveryContactPhone?: string | null;
}): Promise<BookedShipment> {
  if (isMockMode()) {
    const suffix = opts.reference.replace(/-/g, "").slice(0, 10).toUpperCase();
    return {
      shiplogicShipmentId: `MOCK-${suffix}`,
      waybillNumber: `MOCKWB${suffix}`,
      trackingReference: `MOCK-${suffix}`,
      trackingUrl: null, // nothing real to link to in mock mode — see ShipmentsManager's mock badge instead
      labelUrl: null,
      isMock: true,
    };
  }

  const today = new Date().toISOString().split("T")[0];
  const res = await fetch(`${API_BASE}/shipments`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      collection_address: opts.collection,
      delivery_address: opts.delivery,
      parcels: opts.parcels,
      declared_value: Math.round(opts.declaredValueCents / 100),
      collection_min_date: today,
      delivery_min_date: today,
      service_level_code: opts.serviceLevelCode,
      customer_reference: opts.reference,
      collection_contact_name: opts.collectionContactName || undefined,
      collection_contact_mobile_number: opts.collectionContactPhone || undefined,
      delivery_contact_name: opts.deliveryContactName || undefined,
      delivery_contact_mobile_number: opts.deliveryContactPhone || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ship Logic booking failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const result: Record<string, any> = data?.result ?? data;
  const trackingRef = String(result.short_tracking_reference ?? result.tracking_reference ?? result.id ?? "");
  return {
    shiplogicShipmentId: String(result.id ?? result.shipment_id ?? trackingRef),
    waybillNumber: String(result.waybill_number ?? trackingRef),
    trackingReference: trackingRef,
    trackingUrl: result.tracking_url ?? (trackingRef ? `https://www.shiplogic.com/tracking?ref=${trackingRef}` : null),
    labelUrl: result.label_url ?? result.waybill_document_url ?? null,
    isMock: false,
  };
}

// ── Tracking ─────────────────────────────────────────────────────────────────

export async function getTracking(opts: {
  trackingReference: string;
  isMock: boolean;
  bookedAt: string | null;
}): Promise<TrackingUpdate> {
  if (opts.isMock || isMockMode()) {
    // Accelerated, deterministic mock progression — purely so the "Sync
    // tracking" button and the cron job have something to visibly do while
    // testing today. Not a simulation of real transit timing.
    const bookedMs = opts.bookedAt ? new Date(opts.bookedAt).getTime() : Date.now();
    const elapsedMin = (Date.now() - bookedMs) / 60000;
    let status: CourierShipmentStatus = "booked";
    if (elapsedMin >= 90) status = "delivered";
    else if (elapsedMin >= 20) status = "in_transit";
    else if (elapsedMin >= 5) status = "collected";
    const collectedAt = status !== "booked" ? new Date(bookedMs + 5 * 60000).toISOString() : null;
    const deliveredAt = status === "delivered" ? new Date(bookedMs + 90 * 60000).toISOString() : null;
    return { status, courierStatusRaw: `mock:${status}`, collectedAt, deliveredAt };
  }

  const res = await fetch(`${API_BASE}/tracking/shipments/${encodeURIComponent(opts.trackingReference)}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Ship Logic tracking request failed (${res.status})`);
  }
  const data = await res.json();
  const events: Record<string, any>[] = data?.result?.tracking_events ?? data?.tracking_events ?? [];
  const latest = events[0]?.status ?? data?.result?.status ?? data?.status ?? "";
  const statusMap: Record<string, CourierShipmentStatus> = {
    submitted: "booked",
    booked: "booked",
    collected: "collected",
    "in transit": "in_transit",
    in_transit: "in_transit",
    "out for delivery": "in_transit",
    delivered: "delivered",
    cancelled: "cancelled",
    failed: "cancelled",
  };
  const status = statusMap[String(latest).toLowerCase()] ?? "booked";
  const findEvent = (pattern: RegExp) => events.find((e) => pattern.test(String(e.status ?? "")))?.timestamp ?? null;
  return {
    status,
    courierStatusRaw: String(latest),
    collectedAt: status === "pending" || status === "booked" ? null : findEvent(/collect/i),
    deliveredAt: status === "delivered" ? findEvent(/deliver/i) : null,
  };
}
