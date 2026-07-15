"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useCart } from "@/lib/cart-context";
import { createClient } from "@/lib/supabase/client";
import GooglePayButton from "@/components/GooglePayButton";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import AuthModal from "@/components/AuthModal";

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
type PayMethod = "payfast" | "happypay" | "google_pay" | "ozow";

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
    description: "Secure card, EFT and digital wallet payments",
    tagline: "Cards & Instant EFT with PayFast",
    badges: ["Visa", "Mastercard", "Instant EFT", "SnapScan"],
  },
  {
    id: "ozow",
    label: "Ozow",
    description: "Pay instantly from your bank account",
    tagline: "Instant EFT with Ozow",
    badges: ["Instant EFT"],
  },
  {
    id: "happypay",
    label: "HappyPay",
    description: "Buy now, pay later with instalments",
    tagline: "Buy Now, Pay Later with HappyPay",
    badges: ["Pay in instalments"],
  },
  {
    id: "google_pay",
    label: "Google Pay",
    description: "Pay using your saved Google payment methods",
    tagline: "Fast, secure checkout with Google Pay",
    badges: ["Google Pay"],
  },
];

// Local brand assets — drop the real files in place at these paths:
//   /public/payment/payfast.svg
//   /public/payment/ozow.svg
//   /public/payment/happypay.svg
//   /public/payment/google-pay.svg
// GatewayLogo below falls back to a neutral card glyph if a file is
// missing or fails to load, so an absent logo never breaks the layout.
const GATEWAY_LOGOS: Record<PayMethod, string> = {
  payfast: "/payment/payfast.svg",
  ozow: "/payment/ozow.svg",
  happypay: "/payment/happypay.svg",
  google_pay: "/payment/google-pay.svg",
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

// ── Main checkout page ────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter();
  const supabase = createClient();
  const { items, subtotal, count, clear } = useCart();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [payMethod, setPayMethod] = useState<PayMethod>("payfast");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [discount, setDiscount] = useState(0);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  // Defaults to "everything on" so there's no flash of a shorter list while
  // /api/payments/gateways is loading — the common case is nothing paused.
  // google_pay isn't part of the pause system (lib/payments/gateways.ts
  // only covers PayFast/HappyPay/Ozow) so it's always included here.
  const [availableGateways, setAvailableGateways] = useState<Set<PayMethod>>(
    new Set<PayMethod>(["payfast", "ozow", "happypay", "google_pay"])
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

  const total = Math.max(0, subtotal - discount);

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
    fetch("/api/payments/gateways")
      .then((res) => res.json())
      .then((data: { gateways: string[] }) => {
        setAvailableGateways(new Set<PayMethod>([...(data.gateways as PayMethod[]), "google_pay"]));
      })
      .catch(() => {
        // If this fails, keep showing every method rather than hiding all
        // payment options over a transient network error.
      });
  }, []);

  // If the pre-selected default (or a previous selection) turns out to be
  // paused, fall back to whatever's actually available instead of leaving
  // a disabled option selected.
  useEffect(() => {
    if (availableGateways.has(payMethod)) return;
    const fallback = (["payfast", "ozow", "happypay", "google_pay"] as PayMethod[]).find((m) =>
      availableGateways.has(m)
    );
    if (fallback) setPayMethod(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableGateways]);

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
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
          discountCents: discount,
          couponCode: appliedCoupon?.code ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment failed");
      await recordCouponUsage();

      // Build and submit the PayFast form.
      // ⚠️  Do NOT call clear() here — if the user cancels on PayFast they
      //     must land on /payment/cancel with their cart still intact.
      //     Cart is cleared only after confirmed payment (see /payment/success).
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

  const handleHappyPay = async () => {
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/happypay/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
          discountCents: discount,
          couponCode: appliedCoupon?.code ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "HappyPay failed");
      await recordCouponUsage();

      // ⚠️  Same as PayFast — do NOT clear cart here. Cart is cleared on
      //     /payment/success after confirmed payment.
      window.location.href = data.redirectUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "HappyPay payment failed");
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
          items: items.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
          discountCents: discount,
          couponCode: appliedCoupon?.code ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ozow failed");
      await recordCouponUsage();

      // ⚠️  Same as PayFast/HappyPay — do NOT clear cart here. Cart is
      //     cleared on /payment/success after confirmed payment.
      window.location.href = data.redirectUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ozow payment failed");
      setSubmitting(false);
    }
  };

  const handleGooglePay = async (token: string) => {
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/orders/google-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          items: items.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
          discountCents: discount,
          couponCode: appliedCoupon?.code ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Google Pay failed");
      await recordCouponUsage();
      // Google Pay is confirmed synchronously by the server, so clear cart here.
      clear();
      router.push(`/payment/success?ref=${data.orderId}&method=google_pay`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google Pay failed");
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

  const isFormValid = form.name.trim() && form.whatsapp.trim() && form.address.trim() && form.city.trim();
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

            {/* Shipping */}
            <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Delivery address</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <input placeholder="Street address *" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} style={inputStyle} />
                <div className="checkout-field-row">
                  <input placeholder="Suburb" value={form.suburb} onChange={(e) => setForm((f) => ({ ...f, suburb: e.target.value }))} style={inputStyle} />
                  <input placeholder="City *" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} style={inputStyle} />
                </div>
                <div className="checkout-field-row">
                  <select value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} style={{ ...inputStyle, background: "#fff" }}>
                    <option value="">Province</option>
                    {["Gauteng","Western Cape","KwaZulu-Natal","Eastern Cape","Limpopo","Mpumalanga","North West","Free State","Northern Cape"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <input placeholder="Postal code" value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} style={inputStyle} />
                </div>
              </div>
            </div>

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

              {/* Consolidated methods — PayFast fans out to many networks,
                  so show the full logo collage; other gateways show their
                  one badge in the same panel shape. */}
              {selectedPaymentOption?.id === "payfast" ? (
                <div className="payment-methods-panel">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/payment/payfast-payment-methods-collage.webp"
                    alt="Payment methods supported by PayFast: Visa, Mastercard, Instant EFT, SnapScan and more"
                  />
                </div>
              ) : selectedPaymentOption ? (
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

            {payMethod === "happypay" && (
              <div>
                <button className="btn-plum" style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
                  onClick={handleHappyPay} disabled={submitting || !isFormValid}>
                  {submitting ? "Loading HappyPay…" : `Pay later with HappyPay`}
                </button>
                <p style={{ fontSize: "0.75rem", color: "var(--light)", textAlign: "center", marginTop: "0.5rem" }}>
                  Split {fmt(total)} into manageable payments
                </p>
              </div>
            )}

            {payMethod === "google_pay" && (
              <div style={{ opacity: isFormValid ? 1 : 0.5, pointerEvents: isFormValid ? "auto" : "none" }}>
                <GooglePayButton
                  amountCents={total}
                  disabled={submitting || !isFormValid}
                  onPaymentAuthorized={handleGooglePay}
                />
              </div>
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