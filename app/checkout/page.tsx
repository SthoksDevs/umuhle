"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useCart } from "@/lib/cart-context";
import type { CartLine } from "@/lib/cart-context";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, Province, FulfillmentMethod } from "@/types";
import { SA_PROVINCES } from "@/types";
// Type-only — erased at compile time, so this doesn't pull lib/shiplogic's
// server-side fetch/env-var code into the client bundle.
import type { CourierRate } from "@/lib/shiplogic";
import { formatDeliveryArrangement } from "@/lib/deliveryArrangement";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import AuthModal from "@/components/AuthModal";

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
type PayMethod = "payfast" | "ozow";

// Mirrors lib/shiplogic.ts's isCourierCheckoutEnabled() — duplicated as a
// plain env read (rather than imported) since that file also pulls in
// server-only fetch code that shouldn't ship in the client bundle (see the
// CourierRate type-only import above). Fail-safe / opt-in: defaults OFF
// unless explicitly set to "true" (see lib/shiplogic.ts for why). Keep
// both in sync if this ever changes name.
const COURIER_CHECKOUT_ENABLED = process.env.NEXT_PUBLIC_COURIER_CHECKOUT_ENABLED === "true";

// ── Coupon types ──────────────────────────────────────────────────────────────
interface Coupon {
  id: string;
  code: string;
  discount_type: "percentage" | "fixed";
  discount_value: number; // percentage (0-100) or fixed cents
  scope: "cart" | "product";
  product_id: string | null;
  min_order_cents: number | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
}

// ── Coupon section component ──────────────────────────────────────────────────
function CouponSection({
  subtotal,
  items,
  onDiscount,
}: {
  subtotal: number;
  items: { product: { id: string; price: number }; quantity: number }[];
  onDiscount: (savings: number, coupon: Coupon | null) => void;
}) {
  const supabase = createClient();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState<Coupon | null>(null);
  const [savings, setSavings] = useState(0);

  const computeDiscount = useCallback(
    (coupon: Coupon): number => {
      if (coupon.scope === "product" && coupon.product_id) {
        const line = items.find((l) => l.product.id === coupon.product_id);
        if (!line) return 0;
        const lineTotal = line.product.price * line.quantity;
        if (coupon.discount_type === "percentage") {
          return Math.round((lineTotal * coupon.discount_value) / 100);
        }
        return Math.min(coupon.discount_value, lineTotal);
      }
      const base = subtotal;
      if (coupon.discount_type === "percentage") {
        return Math.round((base * coupon.discount_value) / 100);
      }
      return Math.min(coupon.discount_value, base);
    },
    [items, subtotal]
  );

  const apply = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { data, error: dbErr } = await supabase
        .from("coupons")
        .select("*")
        .eq("code", code.trim().toUpperCase())
        .eq("is_active", true)
        .single();

      if (dbErr || !data) {
        setError("Invalid or expired coupon code.");
        setLoading(false);
        return;
      }

      const coupon = data as Coupon;

      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        setError("This coupon has expired.");
        setLoading(false);
        return;
      }

      if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
        setError("This coupon has reached its usage limit.");
        setLoading(false);
        return;
      }

      if (coupon.min_order_cents !== null && subtotal < coupon.min_order_cents) {
        setError(`Minimum order of ${fmt(coupon.min_order_cents)} required.`);
        setLoading(false);
        return;
      }

      const discount = computeDiscount(coupon);
      if (discount <= 0) {
        setError("This coupon doesn't apply to items in your cart.");
        setLoading(false);
        return;
      }

      setApplied(coupon);
      setSavings(discount);
      onDiscount(discount, coupon);
    } catch {
      setError("Could not validate coupon. Please try again.");
    }
    setLoading(false);
  };

  const remove = () => {
    setApplied(null);
    setSavings(0);
    setCode("");
    setError("");
    onDiscount(0, null);
  };

  return (
    <div
      style={{
        background: "#fff",
        border: "1.5px solid rgba(155,127,184,0.15)",
        borderRadius: 16,
        padding: "1.5rem",
      }}
    >
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          fontSize: "1.1rem",
          marginBottom: "1rem",
        }}
      >
        Discount / Coupon
      </h3>

      {applied ? (
        <div
          style={{
            background: "#E8F5E9",
            border: "1.5px solid rgba(46,125,50,0.2)",
            borderRadius: 12,
            padding: "0.9rem 1.1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <p style={{ fontWeight: 600, fontSize: "0.9rem", color: "#2E7D32", margin: "0 0 0.15rem" }}>
              🎉 {applied.code} applied
            </p>
            <p style={{ fontSize: "0.8rem", color: "#388E3C", margin: 0 }}>
              You save {fmt(savings)}{" "}
              {applied.discount_type === "percentage"
                ? `(${applied.discount_value}% off${applied.scope === "product" ? " selected product" : ""})`
                : `(fixed discount${applied.scope === "product" ? " on selected product" : ""})`}
            </p>
          </div>
          <button
            onClick={remove}
            style={{
              background: "none",
              border: "none",
              color: "#C62828",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.65rem" }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="Enter coupon code…"
            style={{
              flex: 1,
              padding: "0.75rem 1rem",
              borderRadius: 12,
              border: "1.5px solid #E0E0E0",
              fontSize: "0.9rem",
              letterSpacing: "0.08em",
              fontWeight: 500,
            }}
          />
          <button
            onClick={apply}
            disabled={loading || !code.trim()}
            style={{
              background: "var(--plum)",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "0.75rem 1.25rem",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: loading || !code.trim() ? "not-allowed" : "pointer",
              opacity: loading || !code.trim() ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "…" : "Apply"}
          </button>
        </div>
      )}

      {error && (
        <p style={{ color: "#C62828", fontSize: "0.82rem", marginTop: "0.5rem" }}>{error}</p>
      )}
    </div>
  );
}

// ── Payment method display data ───────────────────────────────────────────────
// Presentation-only: labels, copy, and badges shown on the payment method
// cards below. This does not affect which gateways are actually available
// (that's still driven entirely by `availableGateways`, from
// /api/payments/gateways) or how a method is submitted (see the handle*
// functions further down, which are untouched).
interface PaymentOption {
  id: PayMethod;
  label: string;
  description: string;
  tagline: string;
  badges: string[];
}

const PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: "payfast",
    label: "PayFast",
    description: "Card, EFT, SnapScan & more",
    tagline: "Cards, EFT & more via PayFast",
    badges: ["Visa", "Mastercard", "Instant EFT", "SnapScan"],
  },
  {
    id: "ozow",
    label: "Ozow",
    description: "Pay instantly from your bank account",
    tagline: "Instant EFT with Ozow",
    badges: ["Instant EFT"],
  },
];

// Local brand assets — drop the real files in place at these paths:
//   /public/payment/payfast.svg
//   /public/payment/ozow.svg
// GatewayLogo below falls back to a neutral card glyph if a file is
// missing or fails to load, so an absent logo never breaks the layout.
const GATEWAY_LOGOS: Record<PayMethod, string> = {
  payfast: "/payment/payfast.svg",
  ozow: "/payment/ozow.svg",
};

function GatewayLogo({ id, className = "payment-method-logo" }: { id: PayMethod; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={className} aria-hidden="true">
      {failed ? (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2.5" />
          <path d="M2 10h20" />
          <path d="M6 15h4" />
        </svg>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- small local
        // brand SVG with an onError fallback; next/image's optimizer blocks
        // SVG sources without extra next.config setup.
        <img src={GATEWAY_LOGOS[id]} alt="" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

// ── Per-partner fulfillment ─────────────────────────────────────────────────
// One row per distinct products.partner_id in the cart. Fetched client-side
// straight from `profiles` (public-readable for active accounts — see the
// local-delivery handoff doc) rather than through a new API route.
interface PartnerFulfillmentInfo {
  id: string;
  full_name: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  allow_collection: boolean;
  allow_courier: boolean;
  delivery_arrangement_method: string | null;
  delivery_arrangement_note: string | null;
}

/**
 * Client-side mirror of the sell_scope check `lib/orders.ts` enforces
 * server-side. Collection lines are always exempt — the customer is
 * fetching the item in person, so there's no shipping range to restrict.
 */
function sellScopeViolation(
  line: CartLine,
  method: FulfillmentMethod,
  province: string,
  partnerInfo: Record<string, PartnerFulfillmentInfo>
): boolean {
  if (method !== "courier") return false;
  if (line.product.sell_scope !== "province") return false;
  if (!province) return false; // nothing to validate against yet
  const sellProvinces = line.product.sell_provinces ?? [];
  const allowed = sellProvinces.length > 0 ? sellProvinces : [partnerInfo[line.product.partner_id]?.province].filter(Boolean);
  return !allowed.includes(province);
}

// ── Main checkout page ────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter();
  const supabase = createClient();
  const { items, subtotal, count } = useCart();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [payMethod, setPayMethod] = useState<PayMethod>("payfast");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [discount, setDiscount] = useState(0);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  // Defaults to "everything on" so there's no flash of a shorter list while
  // /api/payments/gateways is loading — the common case is nothing paused
  // and the cart clears both eligibility rules (see lib/payments/eligibility.ts).
  const [availableGateways, setAvailableGateways] = useState<Set<PayMethod>>(
    new Set<PayMethod>(["payfast", "ozow"])
  );

  const [form, setForm] = useState({
    name: "",
    whatsapp: "",
    address: "",
    suburb: "",
    city: "",
    province: "",
    postalCode: "",
  });

  // ── Per-partner fulfillment (collection vs courier) ──
  const [partnerInfo, setPartnerInfo] = useState<Record<string, PartnerFulfillmentInfo>>({});
  const [fulfillmentByPartner, setFulfillmentByPartner] = useState<Record<string, FulfillmentMethod>>({});

  // ── Courier Guy (Ship Logic) live rate quotes ──
  // Keyed by partner_id, same shape POST /api/checkout/courier-rates
  // returns. Purely for display/selection — lib/orders.ts re-quotes
  // authoritatively at order-creation time, so a stale or missing
  // selection here never under- or over-charges the customer.
  const [courierQuotes, setCourierQuotes] = useState<Record<string, { rates: CourierRate[]; isMock: boolean; error?: string }>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [selectedServiceLevel, setSelectedServiceLevel] = useState<Record<string, string>>({});

  // CartLine.product.partner_id is already populated on every line (products
  // are fetched with select("*") elsewhere in the app) — no extra fetch
  // needed for that part. Deduped + sorted into a stable string so the
  // effect below can key off a primitive instead of array identity (see
  // the Aug 8 "search reload bug" note — effects must key off a primitive,
  // not an object/array, or they re-fire every render).
  const partnerIds = [...new Set(items.map((l) => l.product.partner_id).filter(Boolean))].sort();
  const partnerIdsKey = partnerIds.join(",");

  // Client-side mirror of the parcel aggregation lib/orders.ts does per
  // courier partner group (sum weight/declared value, max each dimension)
  // — same rough approximation, just so the preview quote below asks for
  // (close to) the same parcel the authoritative server-side re-quote will.
  const courierGroups = partnerIds
    .filter((id) => (fulfillmentByPartner[id] ?? "courier") === "courier")
    .map((id) => {
      const lines = items.filter((l) => l.product.partner_id === id);
      return {
        partnerId: id,
        weightG: lines.reduce((s, l) => s + (l.product.weight_g ?? 0) * l.quantity, 0),
        lengthCm: Math.max(0, ...lines.map((l) => l.product.length_cm ?? 0)),
        widthCm: Math.max(0, ...lines.map((l) => l.product.width_cm ?? 0)),
        heightCm: Math.max(0, ...lines.map((l) => l.product.height_cm ?? 0)),
        declaredValueCents: lines.reduce((s, l) => s + l.product.price * l.quantity, 0),
      };
    });
  // Primitive key for the effect below — see the Aug 8 "search reload bug"
  // note above: effects must key off a primitive, not array/object
  // identity, or they re-fire every render since courierGroups is rebuilt
  // fresh each time.
  const courierGroupsKey = courierGroups.map((g) => `${g.partnerId}:${g.weightG}:${g.declaredValueCents}`).join("|");

  const cheapestRate = (rates: CourierRate[]): CourierRate | null =>
    rates.length === 0 ? null : rates.reduce((a, b) => (b.rateCents < a.rateCents ? b : a));

  // Sum of whichever rate is selected (or cheapest, if the customer hasn't
  // picked yet) per courier group. A group with no quote yet, or whose
  // quote errored, contributes R0 here — same "ships with no quoted fee
  // rather than blocking checkout" behaviour as the server.
  const shippingFeeCents = courierGroups.reduce((sum, g) => {
    const quote = courierQuotes[g.partnerId];
    if (!quote) return sum;
    const chosen = quote.rates.find((r) => r.serviceLevelCode === selectedServiceLevel[g.partnerId]) ?? cheapestRate(quote.rates);
    return sum + (chosen?.rateCents ?? 0);
  }, 0);

  const total = Math.max(0, subtotal - discount + shippingFeeCents);
  // Drives lib/payments/eligibility.ts's Umuhle-profit-only rule: true only
  // when every line in the cart is Umuhle's own stock. products.
  // is_umuhle_product comes through on every product fetch (they all
  // select("*")) — see types/index.ts's Product interface.
  const isUmuhleProfitOnly = items.length > 0 && items.every((line) => line.product.is_umuhle_product === true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/checkout?auth=login"); return; }
      setUser(user);
      supabase.from("profiles").select("*").eq("id", user.id).single().then(({ data }) => {
        if (data) {
          const p = data as Profile;
          setProfile(p);
          setForm((f) => ({ ...f, name: p.full_name ?? "", whatsapp: p.phone ?? "" }));
        }
        setLoading(false);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && count === 0) router.replace("/shop");
  }, [loading, count, router]);

  useEffect(() => {
    if (total <= 0) return; // nothing to price yet — first render before the cart's loaded
    const params = new URLSearchParams({
      type: "order",
      amountCents: String(total),
      profitOnly: String(isUmuhleProfitOnly),
    });
    fetch(`/api/payments/gateways?${params}`)
      .then((res) => res.json())
      .then((data: { gateways: string[] }) => {
        setAvailableGateways(new Set<PayMethod>(data.gateways as PayMethod[]));
      })
      .catch(() => {
        // If this fails, keep showing every method rather than hiding all
        // payment options over a transient network error.
      });
  }, [total, isUmuhleProfitOnly]);

  // If the pre-selected default (or a previous selection) turns out to be
  // unavailable — paused, or the cart just became ineligible for it (see
  // the effect above) — fall back to whatever's actually available instead
  // of leaving a disabled option selected.
  useEffect(() => {
    if (availableGateways.has(payMethod)) return;
    const fallback = (["payfast", "ozow"] as PayMethod[]).find((m) => availableGateways.has(m));
    if (fallback) setPayMethod(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableGateways]);

  // profiles: public read (active) already lets a signed-in customer read
  // another partner's full profile row client-side (address/allow_collection/
  // allow_courier/lat/long included) — it's row-level, not column-level, and
  // these are all fine to be public (equivalent to a store's public
  // address). So no new API route is needed here.
  useEffect(() => {
    if (!partnerIdsKey) return;
    const ids = partnerIdsKey.split(",");
    supabase
      .from("profiles")
      .select("id, full_name, address, suburb, city, province, postal_code, latitude, longitude, allow_collection, allow_courier, delivery_arrangement_method, delivery_arrangement_note")
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, PartnerFulfillmentInfo> = {};
        (data as PartnerFulfillmentInfo[]).forEach((p) => { map[p.id] = p; });
        setPartnerInfo((prev) => ({ ...prev, ...map }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerIdsKey]);

  // Live Ship Logic (The Courier Guy) rate preview — refetches whenever the
  // cart's courier groups or the delivery address change. Waits for a
  // minimally complete address (city + province) and for every group's
  // origin to have loaded from partnerInfo, and debounces so it doesn't
  // fire on every keystroke while the customer is still typing the address.
  useEffect(() => {
    // Courier is paused platform-wide — see lib/shiplogic.ts. Each
    // partner's own delivery arrangement is shown instead (rendered below),
    // so there's no rate to fetch here at all.
    if (!COURIER_CHECKOUT_ENABLED) { setCourierQuotes({}); return; }
    if (courierGroups.length === 0) { setCourierQuotes({}); return; }
    if (!form.city.trim() || !form.province) return;
    if (courierGroups.some((g) => !partnerInfo[g.partnerId])) return;

    const timer = setTimeout(() => {
      setQuotesLoading(true);
      fetch("/api/checkout/courier-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: courierGroups.map((g) => ({
            partnerId: g.partnerId,
            weightG: g.weightG || null,
            lengthCm: g.lengthCm || null,
            widthCm: g.widthCm || null,
            heightCm: g.heightCm || null,
            declaredValueCents: g.declaredValueCents,
            origin: {
              address: partnerInfo[g.partnerId]?.address ?? null,
              suburb: partnerInfo[g.partnerId]?.suburb ?? null,
              city: partnerInfo[g.partnerId]?.city ?? null,
              province: partnerInfo[g.partnerId]?.province ?? null,
              postalCode: partnerInfo[g.partnerId]?.postal_code ?? null,
              latitude: partnerInfo[g.partnerId]?.latitude ?? null,
              longitude: partnerInfo[g.partnerId]?.longitude ?? null,
            },
          })),
          destination: {
            addressLine1: form.address,
            suburb: form.suburb,
            city: form.city,
            province: form.province,
            postalCode: form.postalCode,
          },
        }),
      })
        .then((res) => res.json())
        .then((data: { quotes?: Record<string, { rates: CourierRate[]; isMock: boolean; error?: string }> }) => {
          const quotes = data.quotes ?? {};
          setCourierQuotes(quotes);
          // Default-select the cheapest rate for any group that doesn't have
          // a selection yet, or whose previous selection is no longer
          // offered (e.g. a re-quote after the address changed) — the
          // customer can still override by tapping another service level.
          setSelectedServiceLevel((prev) => {
            const next = { ...prev };
            for (const [partnerId, q] of Object.entries(quotes)) {
              const stillOffered = q.rates.some((r) => r.serviceLevelCode === next[partnerId]);
              const fallback = cheapestRate(q.rates);
              if (!stillOffered && fallback) next[partnerId] = fallback.serviceLevelCode;
            }
            return next;
          });
        })
        .catch(() => setCourierQuotes({}))
        .finally(() => setQuotesLoading(false));
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courierGroupsKey, form.address, form.suburb, form.city, form.province, form.postalCode, partnerInfo]);

  // Default each partner to "courier" if they offer it, else "collection" —
  // only once, when their info first loads. Left alone after that so it
  // doesn't clobber the customer's own toggle choice on a later re-render.
  useEffect(() => {
    const ids = Object.keys(partnerInfo);
    if (ids.length === 0) return;
    setFulfillmentByPartner((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (next[id]) continue;
        const info = partnerInfo[id];
        next[id] = info.allow_courier ? "courier" : "collection";
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [partnerInfo]);

  const setFulfillment = (partnerId: string, method: FulfillmentMethod) => {
    setFulfillmentByPartner((prev) => ({ ...prev, [partnerId]: method }));
  };

  // At least one partner group needs courier ⇒ a delivery address is
  // required. If every group is collection, the address card is hidden —
  // see "Delivery address" below.
  const anyCourier = partnerIds.some((id) => (fulfillmentByPartner[id] ?? "courier") === "courier");

  // Client-side pre-check mirroring lib/orders.ts's authoritative
  // server-side enforcement — lets the customer fix the problem before
  // even submitting, rather than only finding out after a redirect to the
  // payment gateway and back.
  const sellScopeViolations = items.filter((line) =>
    sellScopeViolation(line, fulfillmentByPartner[line.product.partner_id] ?? "courier", form.province, partnerInfo)
  );

  const shippingAddress = [form.address, form.suburb, form.city, form.province, form.postalCode]
    .filter(Boolean)
    .join(", ");

  // Increment coupon usage count after successful payment
  const recordCouponUsage = useCallback(async () => {
    if (!appliedCoupon) return;
    await supabase
      .from("coupons")
      .update({ used_count: appliedCoupon.used_count + 1 })
      .eq("id", appliedCoupon.id);
  }, [appliedCoupon, supabase]);

  // Chosen (or cheapest-fallback) service level per courier partner, in the
  // { serviceLevelCode } shape lib/orders.ts's CourierQuoteSelection
  // expects. A group with no live quote at all (rates never loaded, or the
  // route errored) is simply omitted — the server just re-quotes fresh and
  // picks its own cheapest rate rather than blocking checkout.
  const courierQuotesPayload = courierGroups.reduce<Record<string, { serviceLevelCode: string }>>((acc, g) => {
    const quote = courierQuotes[g.partnerId];
    const chosen = quote?.rates.find((r) => r.serviceLevelCode === selectedServiceLevel[g.partnerId]) ?? (quote ? cheapestRate(quote.rates) : null);
    if (chosen) acc[g.partnerId] = { serviceLevelCode: chosen.serviceLevelCode };
    return acc;
  }, {});

  const handlePayFast = async () => {
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/payfast/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order",
          items: items.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          fulfillmentByPartner,
          courierQuotes: courierQuotesPayload,
          shippingAddressLine1: form.address,
          shippingAddressLine2: "",
          shippingSuburb: form.suburb,
          shippingCity: form.city,
          shippingProvince: form.province,
          shippingPostalCode: form.postalCode,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
          discountCents: discount,
          couponCode: appliedCoupon?.code ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The cart can become PayFast-ineligible between page load and
        // submit (a coupon just dropped the total under R5, or the cart
        // spans multiple sellers so it can't split — see
        // lib/payments/eligibility.ts's GATEWAY_INELIGIBLE code) — the
        // effect above should already have hidden this button in that
        // case, but if the request still lands here, fall back to Ozow
        // automatically rather than showing a dead end.
        if (data.code === "GATEWAY_INELIGIBLE" && data.fallback === "ozow") {
          setPayMethod("ozow");
          setSubmitting(false);
          setError(data.error ?? "Please pay via Ozow instead.");
          return;
        }
        throw new Error(data.error ?? "Payment failed");
      }
      await recordCouponUsage();

      // ⚠️  Do NOT call clear() here — if the user cancels on PayFast's
      //     checkout page they must land on /payment/cancelled with their
      //     cart still intact. Cart is cleared only after confirmed
      //     payment (see /payment/success).
      const form2 = document.createElement("form");
      form2.method = "POST"; form2.action = data.payfastUrl;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const inp = document.createElement("input"); inp.type = "hidden"; inp.name = k; inp.value = v; form2.appendChild(inp);
      });
      document.body.appendChild(form2);
      form2.submit();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setSubmitting(false);
    }
  };

  const handleOzow = async () => {
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/ozow/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order",
          items: items.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          fulfillmentByPartner,
          courierQuotes: courierQuotesPayload,
          shippingAddressLine1: form.address,
          shippingAddressLine2: "",
          shippingSuburb: form.suburb,
          shippingCity: form.city,
          shippingProvince: form.province,
          shippingPostalCode: form.postalCode,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
          discountCents: discount,
          couponCode: appliedCoupon?.code ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ozow failed");
      await recordCouponUsage();

      // ⚠️  Same as PayFast — do NOT clear cart here. Cart is
      //     cleared on /payment/success after confirmed payment.
      window.location.href = data.redirectUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ozow payment failed");
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    borderRadius: 12,
    border: "1.5px solid #E0E0E0",
    fontSize: "0.9rem",
    width: "100%",
    boxSizing: "border-box",
  };

  const isFormValid = Boolean(
    form.name.trim() &&
    form.whatsapp.trim() &&
    (!anyCourier || (form.address.trim() && form.city.trim())) &&
    sellScopeViolations.length === 0
  );
  const selectedPaymentOption = PAYMENT_OPTIONS.find((opt) => opt.id === payMethod);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
        {/* Checkout doesn't use SiteHeader (deliberately minimal nav to
            reduce distraction), so AuthModal needs mounting directly here —
            otherwise the ?auth=login redirect below has nothing to render. */}
        <Suspense fallback={null}><AuthModal /></Suspense>
      </div>
    );
  }

  return (
    <div className="page-shell" style={{ background: "#FAFAFA", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>
        <Link href="/cart" aria-label="Back to cart" style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", color: "var(--grey)", textDecoration: "none" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M11 18l-6-6 6-6" /></svg>
          <span className="nav-links-desktop" style={{ display: "inline" }}>Back to cart</span>
        </Link>
      </nav>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem 5rem", flex: 1, width: "100%", boxSizing: "border-box" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", marginBottom: "2rem" }}>Checkout</h1>

        <div className="checkout-layout-grid">
          {/* Left: form */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

            {/* Contact */}
            <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Contact details</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <input placeholder="Full name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} />
                <div>
                  <input placeholder="WhatsApp number * (e.g. 082 123 4567)" value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} style={inputStyle} type="tel" />
                  <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "0.3rem" }}>Order updates will be sent to this WhatsApp number.</p>
                </div>
                {profile?.email && (
                  <input value={profile.email} disabled style={{ ...inputStyle, background: "#FAFAFA", color: "var(--light)" }} />
                )}
              </div>
            </div>

            {/* Fulfillment — one row per partner group */}
            {partnerIds.length > 0 && (
              <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem" }}>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Fulfillment</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {partnerIds.map((partnerId, idx) => {
                    const info = partnerInfo[partnerId];
                    const method = fulfillmentByPartner[partnerId] ?? "courier";
                    const partnerName = info?.full_name || "Seller";
                    const bothSupported = Boolean(info?.allow_collection && info?.allow_courier);
                    return (
                      <div
                        key={partnerId}
                        style={{
                          paddingBottom: idx < partnerIds.length - 1 ? "1rem" : 0,
                          borderBottom: idx < partnerIds.length - 1 ? "1px dashed rgba(155,127,184,0.15)" : "none",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{partnerName}</span>
                          {bothSupported ? (
                            <div style={{ display: "flex", gap: "0.4rem" }}>
                              {(["courier", "collection"] as FulfillmentMethod[]).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setFulfillment(partnerId, m)}
                                  style={{
                                    padding: "0.4rem 0.85rem",
                                    borderRadius: 999,
                                    fontSize: "0.78rem",
                                    fontWeight: 600,
                                    border: method === m ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
                                    background: method === m ? "var(--plum)" : "#fff",
                                    color: method === m ? "#fff" : "var(--grey)",
                                    cursor: "pointer",
                                  }}
                                >
                                  {m === "courier" ? (COURIER_CHECKOUT_ENABLED ? "🚚 Courier" : "📦 Delivery") : "🏠 Collection"}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: "0.78rem", color: "var(--light)" }}>
                              {method === "courier" ? (COURIER_CHECKOUT_ENABLED ? "Ships via courier" : "Delivery arranged with seller") : `Collect in person from ${partnerName}`}
                            </span>
                          )}
                        </div>
                        {method === "collection" && (
                          <p style={{ fontSize: "0.78rem", color: "var(--grey)", marginTop: "0.5rem" }}>
                            📍 {[info?.address, info?.suburb, info?.city, info?.province].filter(Boolean).join(", ") || "Pickup address available after checkout"}
                          </p>
                        )}
                        {method === "courier" && !COURIER_CHECKOUT_ENABLED && (
                          <p style={{ fontSize: "0.78rem", color: "var(--grey)", marginTop: "0.5rem", lineHeight: 1.5 }}>
                            📦 {formatDeliveryArrangement(info?.delivery_arrangement_method, info?.delivery_arrangement_note)}
                          </p>
                        )}
                        {method === "courier" && COURIER_CHECKOUT_ENABLED && (() => {
                          const quote = courierQuotes[partnerId];
                          if (!form.city.trim() || !form.province) {
                            return (
                              <p style={{ fontSize: "0.76rem", color: "var(--light)", marginTop: "0.5rem" }}>
                                Add your delivery address below to see shipping rates.
                              </p>
                            );
                          }
                          if (!quote && quotesLoading) {
                            return <p style={{ fontSize: "0.76rem", color: "var(--light)", marginTop: "0.5rem" }}>Fetching shipping rates…</p>;
                          }
                          if (quote?.error) {
                            return <p style={{ fontSize: "0.76rem", color: "#C62828", marginTop: "0.5rem" }}>{quote.error}</p>;
                          }
                          if (!quote || quote.rates.length === 0) return null;
                          const selectedCode = selectedServiceLevel[partnerId] ?? cheapestRate(quote.rates)?.serviceLevelCode;
                          return (
                            <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                              {quote.isMock && (
                                <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "#B26A00", background: "#FFF3E0", borderRadius: 999, padding: "0.12rem 0.6rem", width: "fit-content" }}>
                                  Sandbox — mock rates
                                </span>
                              )}
                              {quote.rates.map((rate) => {
                                const selected = selectedCode === rate.serviceLevelCode;
                                return (
                                  <button
                                    key={rate.serviceLevelCode}
                                    type="button"
                                    onClick={() => setSelectedServiceLevel((prev) => ({ ...prev, [partnerId]: rate.serviceLevelCode }))}
                                    style={{
                                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem",
                                      padding: "0.55rem 0.75rem", borderRadius: 10, textAlign: "left", width: "100%", boxSizing: "border-box",
                                      border: selected ? "1.5px solid var(--plum)" : "1.5px solid #E0E0E0",
                                      background: selected ? "rgba(155,127,184,0.06)" : "#fff",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <span>
                                      <span style={{ fontSize: "0.82rem", fontWeight: 600, display: "block" }}>{rate.serviceLevelName}</span>
                                      {rate.deliveryDateFrom && (
                                        <span style={{ fontSize: "0.7rem", color: "var(--light)" }}>
                                          Est. {new Date(rate.deliveryDateFrom).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                                          {rate.deliveryDateTo ? `–${new Date(rate.deliveryDateTo).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : ""}
                                        </span>
                                      )}
                                    </span>
                                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--plum)", whiteSpace: "nowrap" }}>{fmt(rate.rateCents)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Shipping */}
            {anyCourier ? (
              <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem" }}>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: COURIER_CHECKOUT_ENABLED ? "1.25rem" : "0.5rem" }}>Delivery address</h3>
                {!COURIER_CHECKOUT_ENABLED && (
                  <p style={{ fontSize: "0.8rem", color: "var(--grey)", marginBottom: "1rem" }}>
                    We'll pass this on to the seller so they can arrange delivery with you directly.
                  </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <input placeholder="Street address *" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} style={inputStyle} />
                  <div className="checkout-field-row">
                    <input placeholder="Suburb" value={form.suburb} onChange={(e) => setForm((f) => ({ ...f, suburb: e.target.value }))} style={inputStyle} />
                    <input placeholder="City *" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} style={inputStyle} />
                  </div>
                  <div className="checkout-field-row">
                    <select value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} style={{ ...inputStyle, background: "#fff" }}>
                      <option value="">Province</option>
                      {SA_PROVINCES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <input placeholder="Postal code" value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} style={inputStyle} />
                  </div>
                </div>
                {sellScopeViolations.length > 0 && (
                  <p style={{ color: "#C62828", fontSize: "0.8rem", marginTop: "0.85rem" }}>
                    {[...new Set(sellScopeViolations.map((l) => l.product.name))].join(", ")}{" "}
                    {sellScopeViolations.length === 1 ? "doesn't" : "don't"} ship to {form.province || "the selected province"}. Choose collection instead, or update the delivery province above.
                  </p>
                )}
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem" }}>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "0.5rem" }}>Delivery address</h3>
                <p style={{ fontSize: "0.85rem", color: "var(--light)", margin: 0 }}>
                  No delivery address needed — you&apos;re collecting everything in person.
                </p>
              </div>
            )}

            {/* Coupon */}
            <CouponSection
              subtotal={subtotal}
              items={items}
              onDiscount={(savings, coupon) => {
                setDiscount(savings);
                setAppliedCoupon(coupon);
              }}
            />

            {error && (
              <div style={{ background: "#FFF3F3", border: "1.5px solid #FFCDD2", borderRadius: 12, padding: "1rem 1.25rem" }}>
                <p style={{ color: "#C62828", fontSize: "0.875rem", margin: 0 }}>{error}</p>
              </div>
            )}
          </div>

          {/* Right: order summary + pay button */}
          <div className="checkout-summary" style={{ position: "sticky", top: 80 }}>
            <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem", marginBottom: "1rem" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Order summary</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
                {items.map((line) => (
                  <div key={line.product.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--grey)" }}>{line.product.name} × {line.quantity}</span>
                    <span>{fmt(line.product.price * line.quantity)}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px dashed rgba(155,127,184,0.3)", paddingTop: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--grey)", marginBottom: "0.5rem" }}>
                  <span>Subtotal</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "#2E7D32", marginBottom: "0.5rem" }}>
                    <span>Discount ({appliedCoupon?.code})</span>
                    <span>−{fmt(discount)}</span>
                  </div>
                )}
                {shippingFeeCents > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--grey)", marginBottom: "0.5rem" }}>
                    <span>Shipping{quotesLoading ? " (updating…)" : ""}</span>
                    <span>{fmt(shippingFeeCents)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "1rem", marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid rgba(155,127,184,0.15)" }}>
                  <span>Total</span>
                  <span style={{ color: "var(--plum)" }}>{fmt(total)}</span>
                </div>
              </div>
            </div>

            {/* Payment method */}
            <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem", marginBottom: "1rem" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Payment method</h3>

              {/* Grid of brand images — 2 per row. Selected = full colour
                  with a corner tick; unselected = greyscaled. */}
              <div className="payment-method-grid">
                {PAYMENT_OPTIONS.filter((opt) => availableGateways.has(opt.id)).map((opt) => {
                  const selected = payMethod === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPayMethod(opt.id)}
                      aria-pressed={selected}
                      aria-label={`${opt.label} — ${opt.description}`}
                      className={`payment-tile${selected ? " payment-tile--selected" : ""}`}
                    >
                      {selected && (
                        <span className="payment-tile-check" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                      <GatewayLogo id={opt.id} className="payment-tile-logo-wrap" />
                      <span className="payment-tile-name">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Selected gateway details — logo + a one-line description of
                  what it offers. */}
              {selectedPaymentOption && (
                <div className="payment-detail-card">
                  <GatewayLogo id={selectedPaymentOption.id} className="payment-detail-logo" />
                  <div className="payment-detail-copy">
                    <p className="payment-detail-title">{selectedPaymentOption.label}</p>
                    <p className="payment-detail-tagline">{selectedPaymentOption.tagline}</p>
                  </div>
                </div>
              )}

              {/* Badge panel — PayFast fans out to several networks, shown
                  as badges (see PAYMENT_OPTIONS above); Ozow shows its one. */}
              {selectedPaymentOption ? (
                <div className="payment-methods-panel">
                  <div className="payment-method-badges">
                    {selectedPaymentOption.badges.map((badge) => (
                      <span key={badge} className="payment-method-badge">{badge}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Selected payment summary */}
            {selectedPaymentOption && (
              <p className="payment-selected-summary">
                Selected payment: <span className="payment-selected-summary-value">{selectedPaymentOption.label}</span>
              </p>
            )}

            {/* Pay buttons */}
            {payMethod === "payfast" && (
              <button className="btn-plum" style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
                onClick={handlePayFast} disabled={submitting || !isFormValid}>
                {submitting ? "Redirecting…" : `Pay ${fmt(total)} with PayFast`}
              </button>
            )}

            {payMethod === "ozow" && (
              <button className="btn-plum" style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
                onClick={handleOzow} disabled={submitting || !isFormValid}>
                {submitting ? "Redirecting…" : `Pay ${fmt(total)} with Ozow`}
              </button>
            )}

            {!availableGateways.has("payfast") && (
              <p style={{ fontSize: "0.72rem", color: "var(--light)", textAlign: "center", marginTop: "0.5rem" }}>
                {isUmuhleProfitOnly
                  ? "This order is Umuhle stock only, so it's paid via Ozow."
                  : "Orders under R5 are paid via Ozow."}
              </p>
            )}

            {!isFormValid && (
              <p style={{ fontSize: "0.75rem", color: "var(--light)", textAlign: "center", marginTop: "0.5rem" }}>
                Please fill in all required fields above.
              </p>
            )}

            <p style={{ fontSize: "0.72rem", color: "var(--light)", textAlign: "center", marginTop: "0.75rem" }}>
              Secure payment · Your data is protected
            </p>
          </div>
        </div>
      </main>

      <Footer />
      <Suspense fallback={null}><AuthModal /></Suspense>
    </div>
  );
}