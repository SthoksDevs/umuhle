"use client";

// components/dashboard/MyOrdersTab.tsx
//
// "My Orders" — a buyer's own purchase history: a unified, date-sorted
// timeline of product orders (with a one-click reorder) and past service
// booking history. Shown on all three DashboardShell roles — everyone can
// buy things, regardless of what else their account can do. Split out of
// the old app/dashboard/page.tsx monolith — see
// docs/role-based-dashboards-status.md.

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Order, OrderItem, Product } from "@/types";
import { useCart } from "@/lib/cart-context";
import { fmt, formatDate } from "@/lib/dashboard/format";
import type { BookingWithRelations } from "@/lib/dashboard/types";
import { STATUS_STYLES } from "@/lib/dashboard/types";

const ORDER_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending_payment: { bg: "#FFF3E0", color: "#E65100", label: "Awaiting payment" },
  paid:            { bg: "#E8F5E9", color: "#2E7D32", label: "Paid" },
  processing:      { bg: "#E3F2FD", color: "#1565C0", label: "Processing" },
  shipped:         { bg: "#EDE7F6", color: "#4527A0", label: "Shipped" },
  delivered:       { bg: "#E8F5E9", color: "#2E7D32", label: "Delivered" },
  cancelled:       { bg: "#FAFAFA", color: "#757575", label: "Cancelled" },
};

// ─── My Orders tab (unified product orders + service bookings history) ────────

type ProductOrderWithItems = Order & {
  order_items: (OrderItem & { product?: Product | null })[];
};

type OrderHistoryEntry =
  | { kind: "product"; id: string; date: string; data: ProductOrderWithItems }
  | { kind: "booking"; id: string; date: string; data: BookingWithRelations };

function ReorderButton({ order, onDone }: { order: ProductOrderWithItems; onDone: (msg: string) => void }) {
  const router = useRouter();
  const { addItem } = useCart();
  const [loading, setLoading] = useState(false);

  const items = order.order_items ?? [];
  const anyAvailable = items.some(i => i.product && i.product.is_active && i.product.moderation_status === "approved" && i.product.stock_count > 0);

  const handleClick = async () => {
    setLoading(true);
    let added = 0;
    const unavailable: string[] = [];
    for (const item of items) {
      const p = item.product;
      if (!p || !p.is_active || p.moderation_status !== "approved" || p.stock_count <= 0) {
        unavailable.push(item.product?.name ?? "An item");
        continue;
      }
      addItem(p, Math.min(item.quantity, p.stock_count));
      added++;
    }
    setLoading(false);
    if (added > 0) {
      onDone(
        unavailable.length > 0
          ? `Added ${added} item${added !== 1 ? "s" : ""} to your cart. ${unavailable.join(", ")} ${unavailable.length === 1 ? "is" : "are"} no longer available and ${unavailable.length === 1 ? "was" : "were"} skipped.`
          : `Added ${added} item${added !== 1 ? "s" : ""} to your cart.`
      );
      router.push("/cart");
    } else {
      onDone("Sorry — none of the items from this order are available anymore.");
    }
  };

  if (!anyAvailable) {
    return (
      <span style={{ fontSize: "0.78rem", color: "var(--light)", fontStyle: "italic" }}>
        No longer available to reorder
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="btn-outline"
      style={{ padding: "0.4rem 1.1rem", fontSize: "0.8rem" }}
    >
      {loading ? "Adding…" : "Order again"}
    </button>
  );
}

function ProductOrderCard({ order, onReorderDone }: { order: ProductOrderWithItems; onReorderDone: (msg: string) => void }) {
  const status = ORDER_STATUS_STYLES[order.status] ?? ORDER_STATUS_STYLES.pending_payment;
  const items = order.order_items ?? [];
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, background: "#fff", padding: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.2rem" }}>
            <span style={{ background: "var(--plum-t)", color: "var(--plum)", borderRadius: 100, padding: "0.15rem 0.6rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Product order</span>
            <span style={{ borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.72rem", fontWeight: 600, background: status.bg, color: status.color }}>{status.label}</span>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: 0 }}>
            {new Date(order.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })} · {itemCount} item{itemCount !== 1 ? "s" : ""}
          </p>
        </div>
        <p style={{ fontWeight: 700, color: "var(--plum)", fontSize: "1rem", margin: 0 }}>{fmt(order.total_amount)}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
        {items.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: 38, height: 38, borderRadius: 8, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
              {item.product?.image_url ? (
                <Image src={item.product.image_url} alt={item.product.name} width={38} height={38} style={{ objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: "1rem" }}>🛍️</span>
              )}
            </div>
            <p style={{ fontSize: "0.85rem", margin: 0, flex: 1, minWidth: 0 }}>
              {item.product?.name ?? "Product no longer available"} <span style={{ color: "var(--grey)" }}>× {item.quantity}</span>
            </p>
            <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: 0, flexShrink: 0 }}>{fmt(item.unit_price * item.quantity)}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ReorderButton order={order} onDone={onReorderDone} />
      </div>
    </div>
  );
}

function BookingHistoryCard({ booking }: { booking: BookingWithRelations }) {
  const status = STATUS_STYLES[booking.status] ?? STATUS_STYLES.confirmed;
  const artist = booking.artist;
  const service = booking.service;

  return (
    <div style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 18, background: "#fff", padding: "1.25rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
      <Image src={artist?.avatar_url ?? ICON} alt={artist?.display_name ?? "Artist"} width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid var(--plum-t)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.3rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.2rem" }}>
              <span style={{ background: "var(--blush, #C28070)", color: "#fff", borderRadius: 100, padding: "0.15rem 0.6rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Service booking</span>
              <span style={{ borderRadius: 100, padding: "0.2rem 0.75rem", fontSize: "0.72rem", fontWeight: 600, background: status.bg, color: status.color }}>{status.label}</span>
            </div>
            <p style={{ fontWeight: 500, fontSize: "0.92rem", margin: "0 0 0.1rem" }}>{artist?.display_name ?? "Artist"}</p>
            <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: 0 }}>
              {service?.name ?? "Service"} · {formatDate(booking.booking_date)} at {booking.booking_time}
            </p>
          </div>
          <p style={{ fontWeight: 700, color: "var(--plum)", fontSize: "1rem", margin: 0, flexShrink: 0 }}>{fmt(booking.total_amount)}</p>
        </div>
        <p style={{ fontSize: "0.76rem", color: "var(--light)", fontStyle: "italic", marginTop: "0.5rem" }}>
          Bookings can&apos;t be reordered automatically — artist availability changes, so book again from their profile.
        </p>
      </div>
    </div>
  );
}

export default function MyOrdersTab({ user }: { user: User }) {
  const supabase = createClient();
  const [productOrders, setProductOrders] = useState<ProductOrderWithItems[]>([]);
  const [bookings, setBookings] = useState<BookingWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "products" | "bookings">("all");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [ordersRes, bookingsRes] = await Promise.all([
      supabase
        .from("orders")
        .select(`*, order_items(*, product:products(*))`)
        .eq("client_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("bookings")
        .select(`*, artist:artists(id, display_name, avatar_url, suburb, profile:profiles(phone)), service:services(name, duration_minutes)`)
        .eq("client_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setProductOrders((ordersRes.data ?? []) as unknown as ProductOrderWithItems[]);
    setBookings((bookingsRes.data ?? []) as unknown as BookingWithRelations[]);
    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const entries: OrderHistoryEntry[] = [
    ...productOrders.map(o => ({ kind: "product" as const, id: o.id, date: o.created_at, data: o })),
    ...bookings.map(b => ({ kind: "booking" as const, id: b.id, date: b.created_at, data: b })),
  ]
    .filter(e => filter === "all" || (filter === "products" && e.kind === "product") || (filter === "bookings" && e.kind === "booking"))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem" }}>My Orders</h2>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {(["all", "products", "bookings"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{ borderRadius: 100, border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`, padding: "0.35rem 0.9rem", fontSize: "0.8rem", fontWeight: filter === f ? 500 : 400, background: filter === f ? "var(--plum-t)" : "#fff", color: filter === f ? "var(--plum)" : "var(--grey)", cursor: "pointer", textTransform: "capitalize" }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.3)", borderRadius: 14, padding: "0.85rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "var(--onyx)" }}>
          {notice}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {[...Array(3)].map((_, i) => <div key={i} style={{ height: 140, borderRadius: 18, background: "var(--plum-t)", animation: "pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div style={{ textAlign: "center", padding: "4rem 1rem", background: "#fff", borderRadius: 20, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🧾</div>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>No orders yet</h3>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>Your product orders and service bookings will show up here.</p>
          <Link href="/shop"><button className="btn-plum" style={{ padding: "0.75rem 2rem" }}>Browse the shop</button></Link>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {entries.map(e =>
            e.kind === "product"
              ? <ProductOrderCard key={`o-${e.id}`} order={e.data} onReorderDone={setNotice} />
              : <BookingHistoryCard key={`b-${e.id}`} booking={e.data} />
          )}
        </div>
      )}
    </section>
  );
}

// ─── Dashboard home (sidebar landing page) ─────────────────────────────────────
