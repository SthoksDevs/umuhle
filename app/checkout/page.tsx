"use client";

import { useState, useEffect } from "react";
import { useCart } from "@/lib/cart-context";
import { createClient } from "@/lib/supabase/client";
import GooglePayButton from "@/components/GooglePayButton";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

const ICON = "/umuhle-icon.png";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;
type PayMethod = "payfast" | "happypay" | "google_pay";

export default function CheckoutPage() {
  const router = useRouter();
  const supabase = createClient();
  const { items, subtotal, count, clear } = useCart();

  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [payMethod, setPayMethod] = useState<PayMethod>("payfast");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState("");

  const [form, setForm] = useState({
    name: "",
    whatsapp: "",
    address: "",
    suburb: "",
    city: "",
    province: "",
    postalCode: "",
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/?auth=login"); return; }
      setUser(user);
      supabase.from("profiles").select("*").eq("id", user.id).single().then(({ data }) => {
        if (data) {
          const p = data as Profile;
          setProfile(p);
          setForm(f => ({ ...f, name: p.full_name ?? "", whatsapp: p.phone ?? "" }));
        }
        setLoading(false);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && count === 0) router.replace("/shop");
  }, [loading, count, router]);

  const shippingAddress = [form.address, form.suburb, form.city, form.province, form.postalCode].filter(Boolean).join(", ");

  const handlePayFast = async () => {
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/payfast/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order",
          items: items.map(l => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment failed");
      const form2 = document.createElement("form");
      form2.method = "POST"; form2.action = data.payfastUrl;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const inp = document.createElement("input"); inp.type = "hidden"; inp.name = k; inp.value = v; form2.appendChild(inp);
      });
      document.body.appendChild(form2);
      clear();
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
          items: items.map(l => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "HappyPay failed");
      clear();
      window.location.href = data.redirectUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "HappyPay payment failed");
      setSubmitting(false);
    }
  };

  const handleGooglePay = async (token: string) => {
    setSubmitting(true); setError("");
    try {
      // In test mode the token is a dummy string — we record the order as paid
      const res = await fetch("/api/orders/google-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          items: items.map(l => ({ productId: l.product.id, quantity: l.quantity })),
          shippingAddress,
          contactName: form.name,
          contactWhatsapp: form.whatsapp,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Google Pay failed");
      clear();
      router.push(`/payment/success?ref=${data.orderId}&method=google_pay`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google Pay failed");
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0",
    fontSize: "0.9rem", width: "100%", boxSizing: "border-box",
  };

  const isFormValid = form.name.trim() && form.whatsapp.trim() && form.address.trim() && form.city.trim();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(155,127,184,0.15)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <Image src={ICON} alt="Umuhle" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </Link>
        <Link href="/cart" style={{ fontSize: "0.85rem", color: "var(--grey)", textDecoration: "none" }}>← Back to cart</Link>
      </nav>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem 5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", marginBottom: "2rem" }}>Checkout</h1>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "2rem", alignItems: "start" }}>
          {/* Left: form */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

            {/* Contact */}
            <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Contact details</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <input placeholder="Full name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
                <div>
                  <input placeholder="WhatsApp number * (e.g. 082 123 4567)" value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} style={inputStyle} type="tel" />
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
                <input placeholder="Street address *" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} style={inputStyle} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <input placeholder="Suburb" value={form.suburb} onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))} style={inputStyle} />
                  <input placeholder="City *" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <select value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} style={{ ...inputStyle, background: "#fff" }}>
                    <option value="">Province</option>
                    {["Gauteng","Western Cape","KwaZulu-Natal","Eastern Cape","Limpopo","Mpumalanga","North West","Free State","Northern Cape"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input placeholder="Postal code" value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))} style={inputStyle} />
                </div>
              </div>
            </div>

            {/* Payment method */}
            <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Payment method</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {[
                  { id: "payfast" as PayMethod, label: "PayFast", sub: "Card, EFT, Instant EFT, SnapScan & more" },
                  { id: "happypay" as PayMethod, label: "HappyPay", sub: "Buy now, pay later — split into instalments" },
                  { id: "google_pay" as PayMethod, label: "Google Pay", sub: "Pay instantly with your saved Google card" },
                ].map(opt => (
                  <button key={opt.id} onClick={() => setPayMethod(opt.id)}
                    style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1rem 1.25rem", borderRadius: 14, border: `1.5px solid ${payMethod === opt.id ? "var(--plum)" : "rgba(155,127,184,0.2)"}`, background: payMethod === opt.id ? "var(--plum-t)" : "#fff", textAlign: "left", cursor: "pointer" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${payMethod === opt.id ? "var(--plum)" : "#E0E0E0"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {payMethod === opt.id && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--plum)" }} />}
                    </div>
                    <div>
                      <p style={{ fontWeight: 500, fontSize: "0.95rem", margin: 0 }}>{opt.label}</p>
                      <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>{opt.sub}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div style={{ background: "#FFF3F3", border: "1.5px solid #FFCDD2", borderRadius: 12, padding: "1rem 1.25rem" }}>
                <p style={{ color: "#C62828", fontSize: "0.875rem", margin: 0 }}>{error}</p>
              </div>
            )}
          </div>

          {/* Right: order summary + pay button */}
          <div style={{ position: "sticky", top: 80 }}>
            <div style={{ background: "#fff", border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem", marginBottom: "1rem" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.1rem", marginBottom: "1.25rem" }}>Order summary</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
                {items.map(line => (
                  <div key={line.product.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--grey)" }}>{line.product.name} × {line.quantity}</span>
                    <span>{fmt(line.product.price * line.quantity)}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px dashed rgba(155,127,184,0.3)", paddingTop: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "1rem" }}>
                  <span>Total</span>
                  <span style={{ color: "var(--plum)" }}>{fmt(subtotal)}</span>
                </div>
              </div>
            </div>

            {/* Pay buttons */}
            {payMethod === "payfast" && (
              <button className="btn-plum" style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
                onClick={handlePayFast} disabled={submitting || !isFormValid}>
                {submitting ? "Redirecting…" : `Pay ${fmt(subtotal)} with PayFast`}
              </button>
            )}

            {payMethod === "happypay" && (
              <div>
                <button className="btn-plum" style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
                  onClick={handleHappyPay} disabled={submitting || !isFormValid}>
                  {submitting ? "Loading HappyPay…" : `Pay later with HappyPay`}
                </button>
                <p style={{ fontSize: "0.75rem", color: "var(--light)", textAlign: "center", marginTop: "0.5rem" }}>
                  Split {fmt(subtotal)} into manageable payments
                </p>
              </div>
            )}

            {payMethod === "google_pay" && (
              <div style={{ opacity: isFormValid ? 1 : 0.5, pointerEvents: isFormValid ? "auto" : "none" }}>
                <GooglePayButton
                  amountCents={subtotal}
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
    </div>
  );
}
