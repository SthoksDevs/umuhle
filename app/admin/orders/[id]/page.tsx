"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const ICON = "/umuhle-icon.png";
const SUPER_ADMIN_EMAIL = "info@umuhle.co.za";
const fmt = (cents: number) => `R${(cents / 100).toFixed(2)}`;

const ORDER_STATUSES = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending_payment: { bg: "#FFF3E0", color: "#E65100", label: "Awaiting payment" },
  paid: { bg: "#E8F5E9", color: "#2E7D32", label: "Paid" },
  processing: { bg: "#E3F2FD", color: "#1565C0", label: "Processing" },
  shipped: { bg: "#EDE7F6", color: "#4527A0", label: "Shipped" },
  delivered: { bg: "#E8F5E9", color: "#2E7D32", label: "Delivered" },
  cancelled: { bg: "#FAFAFA", color: "#757575", label: "Cancelled" },
};

const PAYMENT_LABEL: Record<string, string> = {
  payfast: "PayFast",
  ozow: "Ozow (Instant EFT)",
  happypay: "HappyPay (Buy Now, Pay Later)",
  google_pay: "Google Pay",
};

interface OrderItemRow {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product?: { id: string; name: string; image_url: string | null; category: string | null } | null;
}

interface OrderDetail {
  id: string;
  client_id: string;
  total_amount: number;
  status: OrderStatus;
  shipping_address: string | null;
  contact_name: string | null;
  contact_whatsapp: string | null;
  payment_method: string | null;
  payfast_payment_id: string | null;
  gateway_order_id: string | null;
  discount_cents: number;
  coupon_code: string | null;
  created_at: string;
  client?: { full_name: string; email: string; phone: string | null } | null;
  order_items?: OrderItemRow[];
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: "#F5F5F5", color: "#616161", label: status };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 100, padding: "0.25rem 0.85rem", fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem 1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", marginBottom: "1rem", color: "var(--onyx)" }}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: "0.85rem" }}>
      <p style={{ fontSize: "0.7rem", color: "var(--light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.15rem" }}>{label}</p>
      <p style={{ fontSize: "0.9rem", color: "var(--onyx)", margin: 0 }}>{value}</p>
    </div>
  );
}

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [statusDraft, setStatusDraft] = useState<OrderStatus>("pending_payment");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Admin gate ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/"); return; }
      if (user.email !== SUPER_ADMIN_EMAIL) { router.replace("/dashboard"); return; }
      setUser(user);
      setAuthChecked(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOrder = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        client:profiles!client_id(full_name, email, phone),
        order_items(id, product_id, quantity, unit_price, product:products(id, name, image_url, category))
      `)
      .eq("id", id)
      .single();

    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const o = data as unknown as OrderDetail;
    setOrder(o);
    setStatusDraft(o.status);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (authChecked) loadOrder();
  }, [authChecked, loadOrder]);

  const handleUpdateStatus = async () => {
    if (!order || statusDraft === order.status) return;
    setSaving(true);
    const { error } = await supabase.from("orders").update({ status: statusDraft }).eq("id", order.id);
    setSaving(false);
    if (!error) {
      setOrder({ ...order, status: statusDraft });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (!authChecked || loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <SiteHeader initialUser={user} />
        <main style={{ flex: 1, maxWidth: 800, margin: "0 auto", padding: "5rem 1.5rem", textAlign: "center" }}>
          <p style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📦</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.6rem", marginBottom: "0.5rem" }}>Order not found</h1>
          <p style={{ color: "var(--grey)", marginBottom: "1.5rem" }}>This order may have been removed.</p>
          <Link href="/admin"><button className="btn-plum">Back to admin</button></Link>
        </main>
        <Footer />
      </div>
    );
  }

  const items = order.order_items ?? [];
  const itemsSubtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const discount = order.discount_cents ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FAFAFA" }}>
      <SiteHeader initialUser={user} />

      <main style={{ flex: 1, maxWidth: 880, margin: "0 auto", padding: "2rem 1.5rem 5rem", width: "100%", boxSizing: "border-box" }}>

        {/* Back link */}
        <button
          onClick={() => router.push("/admin")}
          style={{ background: "none", border: "none", color: "var(--plum)", fontSize: "0.85rem", cursor: "pointer", padding: 0, marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
        >
          ← Back to Orders
        </button>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap", marginBottom: "1.75rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
              <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(1.5rem,3vw,2rem)", color: "var(--onyx)", margin: 0 }}>
                Order #<span style={{ fontFamily: "monospace" }}>{order.id.slice(0, 8)}</span>
              </h1>
              <StatusPill status={order.status} />
            </div>
            <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>
              Placed {new Date(order.created_at).toLocaleString("en-ZA", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <p style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--plum)", margin: 0 }}>{fmt(order.total_amount)}</p>
        </div>

        {/* Status updater */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem 1.5rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--onyx)" }}>Order status</label>
          <select
            value={statusDraft}
            onChange={(e) => setStatusDraft(e.target.value as OrderStatus)}
            style={{ padding: "0.5rem 0.9rem", borderRadius: 10, border: "1.5px solid rgba(155,127,184,0.3)", fontSize: "0.85rem", background: "#fff", color: "var(--onyx)" }}
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_STYLES[s].label}</option>
            ))}
          </select>
          <button
            onClick={handleUpdateStatus}
            disabled={saving || statusDraft === order.status}
            className="btn-plum"
            style={{ padding: "0.5rem 1.25rem", fontSize: "0.82rem", opacity: statusDraft === order.status ? 0.5 : 1, cursor: statusDraft === order.status ? "not-allowed" : "pointer" }}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Update status"}
          </button>
        </div>

        {/* Customer + shipping + payment */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>
          <Panel title="Customer">
            <Field label="Name" value={order.contact_name ?? order.client?.full_name} />
            <Field label="Email" value={order.client?.email} />
            <Field label="WhatsApp" value={order.contact_whatsapp ?? order.client?.phone} />
          </Panel>
          <Panel title="Shipping">
            <Field label="Address" value={order.shipping_address ?? "Not provided"} />
          </Panel>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <Panel title="Payment">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1.5rem" }}>
              <Field label="Method" value={order.payment_method ? (PAYMENT_LABEL[order.payment_method] ?? order.payment_method) : "—"} />
              <Field label="Gateway reference" value={order.payfast_payment_id ?? order.gateway_order_id ?? "—"} />
              {order.coupon_code && <Field label="Coupon used" value={`${order.coupon_code} (−${fmt(discount)})`} />}
            </div>
          </Panel>
        </div>

        {/* Line items */}
        <Panel title={`Items (${items.length})`}>
          {items.length === 0 ? (
            <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>No items found for this order.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {items.map((item, i) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.85rem 0", borderTop: i === 0 ? "none" : "1px solid rgba(155,127,184,0.1)" }}>
                  {item.product?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.product.image_url} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 52, height: 52, borderRadius: 10, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: "1.2rem" }}>🛍️</span>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500, fontSize: "0.88rem", margin: "0 0 0.15rem" }}>{item.product?.name ?? "Product removed"}</p>
                    <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>{fmt(item.unit_price)} × {item.quantity}</p>
                  </div>
                  <p style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--onyx)", flexShrink: 0 }}>{fmt(item.unit_price * item.quantity)}</p>
                </div>
              ))}

              {/* Totals */}
              <div style={{ borderTop: "1.5px solid rgba(155,127,184,0.15)", marginTop: "0.5rem", paddingTop: "0.85rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--grey)" }}>
                  <span>Subtotal</span>
                  <span>{fmt(itemsSubtotal)}</span>
                </div>
                {discount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.4rem", color: "#2E7D32" }}>
                    <span>Discount{order.coupon_code ? ` (${order.coupon_code})` : ""}</span>
                    <span>−{fmt(discount)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1rem", fontWeight: 700, marginTop: "0.5rem" }}>
                  <span>Total</span>
                  <span style={{ color: "var(--plum)" }}>{fmt(order.total_amount)}</span>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </main>

      <Footer />
    </div>
  );
}
