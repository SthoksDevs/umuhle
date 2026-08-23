"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OrderShipment, FulfillmentMethod } from "@/types";
import Image from "next/image";

/**
 * UMUHLE DASHBOARD REFACTOR — BATCH 3: ORDERS + SHIPMENTS
 *
 * Extracted from app/dashboard/page.tsx.
 *
 * CONTINUATION MARKER:
 * - Order fulfilment and shipment management now live in one reusable
 *   business Orders component rather than separate dashboard destinations.
 * - Shipment information remains associated with the order item/parcel.
 * - Future enhancement: replace the two internal sections with a true
 *   click-through OrderDetails view if multiple parcels/partial fulfilment
 *   needs a richer UI.
 *
 * IMPORTANT: Keep this component under My Business. Do not add a separate
 * top-level Shipments navigation item.
 */

// ─── Orders to Fulfill (partner's own order_items) ─────────────────────────────
//
// Per-item, not per-order: this reads order_items directly (via the
// "order_items: partner read own" RLS policy — 20260717_order_item_fulfillment.sql)
// rather than orders, since a partner's items sit alongside other partners'
// items in the same order and should be actioned independently of them.

type FulfillmentItem = {
  id: string;
  order_id: string;
  quantity: number;
  unit_price: number;
  shipped_at: string | null;
  delivered_at: string | null;
  shipment_id: string | null;
  product: { id: string; name: string; image_url: string | null } | null;
  order: {
    id: string;
    status: string;
    created_at: string;
    contact_name: string | null;
    shipping_address: string | null;
    client?: { full_name: string } | null;
  } | null;
  // Which parcel this line rides in — see OrderShipment. Joined read-only
  // here just for display; actual status/waybill editing happens in
  // ShipmentsManager below, since it's per-parcel, not per-line-item.
  shipment: {
    id: string;
    fulfillment_method: FulfillmentMethod;
    status: string;
    destination_city: string | null;
    destination_province: string | null;
  } | null;
};

type FulfillmentFilter = "to-ship" | "shipped" | "all";

function fulfillmentStatus(item: FulfillmentItem) {
  if (item.delivered_at) return { cardBg: "#E8F5E9", badge: { label: "Delivered ✓", bg: "#fff", color: "#2E7D32" } };
  if (item.shipped_at) return { cardBg: "#fff", badge: { label: "Shipped — awaiting customer confirmation", bg: "#EDE7F6", color: "#4527A0" } };
  return { cardBg: "#FFF3E0", badge: null as { label: string; bg: string; color: string } | null };
}

function OrderFulfillmentManager({ user }: { user: { id: string } }) {
  const supabase = createClient();
  const [items, setItems] = useState<FulfillmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FulfillmentFilter>("to-ship");
  const [shippingId, setShippingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("order_items")
      .select(`
        id, order_id, quantity, unit_price, shipped_at, delivered_at, shipment_id,
        product:products!inner(id, name, image_url, partner_id),
        order:orders(id, status, created_at, contact_name, shipping_address, client:profiles!client_id(full_name)),
        shipment:order_shipments(id, fulfillment_method, status, destination_city, destination_province)
      `)
      .eq("product.partner_id", user.id);

    // Nothing to fulfill on an order that hasn't paid yet or was cancelled.
    const rows = ((data ?? []) as unknown as FulfillmentItem[]).filter(
      (i) => i.order && i.order.status !== "pending_payment" && i.order.status !== "cancelled"
    );
    // order_id is a UUID, not chronological — sort by the order's actual
    // placed date instead, most recent first.
    rows.sort((a, b) => new Date(b.order?.created_at ?? 0).getTime() - new Date(a.order?.created_at ?? 0).getTime());
    setItems(rows);
    setLoading(false);
  }, [supabase, user.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleShip = async (item: FulfillmentItem) => {
    setShippingId(item.id);
    setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setNotice("Not authenticated."); return; }

      const res = await fetch(`/api/vendor/order-items/${item.id}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice(json?.error ?? "Couldn't mark this item as dispatched.");
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, shipped_at: json.item.shipped_at } : i)));
      setNotice(json.alreadyShipped ? "Already marked as dispatched." : "Marked as dispatched — the customer has been notified.");
    } catch {
      setNotice("Couldn't mark this item as dispatched. Please try again.");
    } finally {
      setShippingId(null);
    }
  };

  const filtered = items.filter((i) => {
    if (filter === "to-ship") return !i.shipped_at;
    if (filter === "shipped") return Boolean(i.shipped_at) && !i.delivered_at;
    return true;
  });

  const toShipCount = items.filter((i) => !i.shipped_at).length;

  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", margin: 0 }}>Orders to Fulfill</h2>
          <p style={{ color: "var(--grey)", fontSize: "0.82rem", margin: "0.2rem 0 0" }}>
            Mark your own items as dispatched — the customer gets a link to confirm receipt, which releases your payout.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {([
            { id: "to-ship", label: `To ship${toShipCount > 0 ? ` (${toShipCount})` : ""}` },
            { id: "shipped", label: "Shipped" },
            { id: "all", label: "All" },
          ] as { id: FulfillmentFilter; label: string }[]).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                padding: "0.4rem 0.9rem",
                borderRadius: 100,
                border: "1.5px solid " + (filter === f.id ? "var(--plum)" : "rgba(155,127,184,0.25)"),
                background: filter === f.id ? "var(--plum)" : "transparent",
                color: filter === f.id ? "#fff" : "var(--grey)",
                fontSize: "0.78rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p style={{ fontSize: "0.82rem", color: notice.includes("Couldn't") || notice.includes("authenticated") ? "#BF360C" : "#2E7D32", marginBottom: "0.85rem" }}>
          {notice}
        </p>
      )}

      {loading ? (
        <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>
          {filter === "to-ship" ? "Nothing waiting on you right now." : "No items here yet."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filtered.map((item) => {
            const status = fulfillmentStatus(item);
            return (
              <div key={item.id} style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, background: status.cardBg, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                  {item.product?.image_url ? (
                    <Image src={item.product.image_url} alt={item.product.name} width={44} height={44} style={{ objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: "1.1rem" }}>🛍️</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p style={{ fontWeight: 500, fontSize: "0.9rem", margin: "0 0 0.15rem" }}>
                    {item.product?.name ?? "Product"} <span style={{ color: "var(--grey)" }}>× {item.quantity}</span>
                  </p>
                  <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>
                    Order #{item.order_id.slice(0, 8)} · {item.order ? new Date(item.order.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    {item.order?.client?.full_name ? ` · ${item.order.client.full_name}` : ""}
                  </p>
                  {!item.shipped_at && item.shipment && (
                    item.shipment.fulfillment_method === "collection" ? (
                      <p style={{ fontSize: "0.78rem", color: "var(--onyx)", margin: "0.2rem 0 0" }}>🏠 Customer will collect in person</p>
                    ) : (
                      <p style={{ fontSize: "0.78rem", color: "var(--onyx)", margin: "0.2rem 0 0" }}>
                        🚚 Ships to {[item.shipment.destination_city, item.shipment.destination_province].filter(Boolean).join(", ") || item.order?.shipping_address || "customer address"}
                      </p>
                    )
                  )}
                  {!item.shipped_at && !item.shipment && item.order?.shipping_address && (
                    <p style={{ fontSize: "0.78rem", color: "var(--onyx)", margin: "0.2rem 0 0" }}>📍 {item.order.shipping_address}</p>
                  )}
                </div>
                {status.badge && (
                  <span style={{ background: status.badge.bg, color: status.badge.color, borderRadius: 100, padding: "0.25rem 0.75rem", fontSize: "0.74rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {status.badge.label}
                  </span>
                )}
                {!item.shipped_at && (
                  <button
                    onClick={() => handleShip(item)}
                    disabled={shippingId === item.id}
                    className="btn-plum"
                    style={{ padding: "0.5rem 1.1rem", fontSize: "0.8rem", flexShrink: 0 }}
                  >
                    {shippingId === item.id ? "Marking…" : "Mark as Dispatched"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── ShipmentsManager ─────────────────────────────────────────────────────────
// Parcel-level view: one card per order_shipments row (i.e. per partner per
// order — see the "local_delivery_and_provincial_sales" migration), separate
// from the per-line-item list above since a shipment can bundle several
// order_items and its status/waybill genuinely belongs to the parcel, not
// any one line. Direct client-side reads/writes here rely on the
// "order_shipments: partner manage own" RLS policy (partner_id = auth.uid()),
// not a server route — there's nothing privileged about a partner updating
// their own parcel's status or courier reference.
//
// "Book with Courier Guy" / "Sync tracking" below call the real (or mock,
// see lib/shiplogic.ts) Ship Logic integration — app/api/vendor/shipments/
// [id]/book and .../track — which populate courier_provider/waybill_number/
// tracking_url/courier_reference/courier_booked_at automatically. Manual
// entry via "Update shipment" still works alongside it, as a fallback for a
// courier arranged outside the platform.
type ShipmentRow = OrderShipment & {
  order: {
    id: string;
    created_at: string;
    contact_name: string | null;
    client?: { full_name: string } | null;
  } | null;
};

const SHIPMENT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "ready_for_collection", label: "Ready for collection" },
  { value: "collected", label: "Collected" },
  { value: "booked", label: "Courier booked" },
  { value: "in_transit", label: "In transit" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function shipmentStatusMeta(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pending:               { bg: "#FFF3E0", color: "#E65100", label: "Pending" },
    ready_for_collection:  { bg: "#E3F2FD", color: "#1565C0", label: "Ready for collection" },
    collected:             { bg: "#E8F5E9", color: "#2E7D32", label: "Collected" },
    booked:                { bg: "#EDE7F6", color: "#4527A0", label: "Courier booked" },
    in_transit:            { bg: "#EDE7F6", color: "#4527A0", label: "In transit" },
    delivered:             { bg: "#E8F5E9", color: "#2E7D32", label: "Delivered" },
    cancelled:             { bg: "#FFEBEE", color: "#C62828", label: "Cancelled" },
  };
  return map[status] ?? map.pending;
}

function ShipmentsManager({ user }: { user: { id: string } }) {
  const supabase = createClient();
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ status: "pending", courier_provider: "", waybill_number: "", tracking_url: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // "Book with Courier Guy" / "Sync tracking" — one id at a time each, same
  // shape as OrderFulfillmentManager's shippingId above, so only the card
  // being acted on shows a busy state.
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("order_shipments")
      .select(`*, order:orders(id, created_at, contact_name, client:profiles!client_id(full_name))`)
      .eq("partner_id", user.id)
      .order("created_at", { ascending: false });
    setShipments((data ?? []) as ShipmentRow[]);
    setLoading(false);
  }, [supabase, user.id]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (s: ShipmentRow) => {
    setEditingId(s.id);
    setDraft({
      status: s.status,
      courier_provider: s.courier_provider ?? "",
      waybill_number: s.waybill_number ?? "",
      tracking_url: s.tracking_url ?? "",
    });
    setNotice(null);
  };

  const saveEdit = async (s: ShipmentRow) => {
    setSaving(true);
    const patch: Record<string, unknown> = {
      status: draft.status,
      courier_provider: draft.courier_provider.trim() || null,
      waybill_number: draft.waybill_number.trim() || null,
      tracking_url: draft.tracking_url.trim() || null,
    };
    // Best-effort milestone timestamps — only set the first time each is
    // reached, never clobbered by a later unrelated edit.
    if (draft.status === "collected" && !s.collected_at) patch.collected_at = new Date().toISOString();
    if (draft.status === "booked" && !s.courier_booked_at) patch.courier_booked_at = new Date().toISOString();
    if (draft.status === "delivered" && !s.delivered_at) patch.delivered_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("order_shipments").update(patch).eq("id", s.id).select().single();
    setSaving(false);
    if (error) { setNotice("Couldn't save that update — please try again."); return; }
    setShipments(prev => prev.map(x => x.id === s.id ? { ...x, ...(data as OrderShipment) } : x));
    setEditingId(null);
    setNotice("Shipment updated.");
  };

  // Books a real (or mock, see lib/shiplogic.ts) Ship Logic waybill via
  // app/api/vendor/shipments/[id]/book — manual entry above still works as
  // a fallback/override. Idempotent server-side, so a double-click just
  // returns the existing waybill rather than booking twice.
  const bookShipment = async (s: ShipmentRow) => {
    setBookingId(s.id);
    setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setNotice("Not authenticated."); return; }

      const res = await fetch(`/api/vendor/shipments/${s.id}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice(json?.error ?? "Couldn't book with the courier — enter a waybill manually instead.");
        return;
      }
      setShipments((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...(json.shipment as OrderShipment) } : x)));
      setNotice(json.alreadyBooked ? "Already booked with the courier." : "Booked with Courier Guy — the customer has been notified.");
    } catch {
      setNotice("Couldn't book with the courier. Please try again.");
    } finally {
      setBookingId(null);
    }
  };

  // Manual, single-parcel refresh — app/api/cron/sync-courier-tracking does
  // the same thing for every in-flight shipment every 30 min, this is just
  // an on-demand version for one card. Never touches order_items.delivered_at
  // (see that route's own comment) — payout stays gated on the customer's
  // confirm-receipt click regardless of what the courier reports.
  const syncTracking = async (s: ShipmentRow) => {
    setSyncingId(s.id);
    setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setNotice("Not authenticated."); return; }

      const res = await fetch(`/api/vendor/shipments/${s.id}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice(json?.error ?? "Couldn't reach the courier for a tracking update.");
        return;
      }
      setShipments((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...(json.shipment as OrderShipment) } : x)));
      setNotice("Tracking updated.");
    } catch {
      setNotice("Couldn't reach the courier for a tracking update. Please try again.");
    } finally {
      setSyncingId(null);
    }
  };

  if (loading) return <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>Loading shipments…</p>;
  if (shipments.length === 0) return null;

  const inputStyle: React.CSSProperties = { width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, border: "1.5px solid #E0E0E0", fontSize: "0.8rem", boxSizing: "border-box" };

  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", margin: "0 0 0.2rem" }}>Shipments</h2>
      <p style={{ color: "var(--grey)", fontSize: "0.82rem", margin: "0 0 1rem" }}>
        One parcel per order — track collection or courier status, and add a waybill once one's booked.
      </p>

      {notice && <p style={{ fontSize: "0.82rem", color: notice.includes("Couldn't") ? "#BF360C" : "#2E7D32", marginBottom: "0.85rem" }}>{notice}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {shipments.map(s => {
          const meta = shipmentStatusMeta(s.status);
          const isEditing = editingId === s.id;
          const destination = s.fulfillment_method === "courier"
            ? [s.destination_address_line1, s.destination_suburb, s.destination_city, s.destination_province].filter(Boolean).join(", ")
            : null;
          return (
            <div key={s.id} style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, background: "#fff", padding: "1rem 1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
                <div>
                  <p style={{ fontWeight: 500, fontSize: "0.9rem", margin: "0 0 0.15rem" }}>
                    {s.fulfillment_method === "collection" ? "🏠 Collection" : "🚚 Courier"}
                    {" · "}Order #{s.order_id.slice(0, 8)}
                  </p>
                  <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>
                    {s.order ? new Date(s.order.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    {s.order?.client?.full_name ? ` · ${s.order.client.full_name}` : ""}
                  </p>
                  {destination && <p style={{ fontSize: "0.78rem", color: "var(--onyx)", margin: "0.3rem 0 0" }}>📍 {destination}{s.destination_postal_code ? `, ${s.destination_postal_code}` : ""}</p>}
                  {(s.parcel_weight_g || s.parcel_length_cm) && (
                    <p style={{ fontSize: "0.74rem", color: "#aaa", margin: "0.2rem 0 0" }}>
                      Parcel: {s.parcel_weight_g ? `${s.parcel_weight_g}g` : ""}
                      {s.parcel_length_cm ? ` · ${s.parcel_length_cm}×${s.parcel_width_cm ?? "?"}×${s.parcel_height_cm ?? "?"}cm` : ""}
                    </p>
                  )}
                  {!isEditing && s.waybill_number && (
                    <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: "0.3rem 0 0", display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                      <span>
                        Waybill: {s.waybill_number}
                        {s.courier_provider ? ` (${s.courier_provider.replace(/\s*\(sandbox.*?\)\s*/i, "").trim()})` : ""}
                      </span>
                      {s.courier_provider?.toLowerCase().includes("mock") && (
                        <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "#B26A00", background: "#FFF3E0", borderRadius: 999, padding: "0.1rem 0.55rem" }}>
                          Sandbox — mock
                        </span>
                      )}
                      {s.tracking_url && <> · <a href={s.tracking_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--plum)" }}>Track</a></>}
                      {s.courier_status && <span style={{ color: "#aaa" }}>· {s.courier_status}</span>}
                    </p>
                  )}
                  {!isEditing && s.courier_error && (
                    <p style={{ fontSize: "0.74rem", color: "#C62828", margin: "0.3rem 0 0" }}>⚠ {s.courier_error}</p>
                  )}
                </div>
                <span style={{ background: meta.bg, color: meta.color, borderRadius: 100, padding: "0.25rem 0.75rem", fontSize: "0.74rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {meta.label}
                </span>
              </div>

              {isEditing ? (
                <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid #F0F0F0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ fontSize: "0.72rem", color: "#888", fontWeight: 600 }}>Status</label>
                    <select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))} style={inputStyle}>
                      {SHIPMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {s.fulfillment_method === "courier" && (
                    <>
                      <div>
                        <label style={{ fontSize: "0.72rem", color: "#888", fontWeight: 600 }}>Courier</label>
                        <input value={draft.courier_provider} onChange={e => setDraft(d => ({ ...d, courier_provider: e.target.value }))} placeholder="e.g. The Courier Guy" style={inputStyle} />
                      </div>
                      <div>
                        <label style={{ fontSize: "0.72rem", color: "#888", fontWeight: 600 }}>Waybill number</label>
                        <input value={draft.waybill_number} onChange={e => setDraft(d => ({ ...d, waybill_number: e.target.value }))} style={inputStyle} />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label style={{ fontSize: "0.72rem", color: "#888", fontWeight: 600 }}>Tracking link</label>
                        <input value={draft.tracking_url} onChange={e => setDraft(d => ({ ...d, tracking_url: e.target.value }))} placeholder="https://…" style={inputStyle} />
                      </div>
                    </>
                  )}
                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <button onClick={() => saveEdit(s)} disabled={saving} className="btn-plum" style={{ padding: "0.45rem 1.1rem", fontSize: "0.8rem" }}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingId(null)} disabled={saving} className="btn-outline" style={{ padding: "0.45rem 1.1rem", fontSize: "0.8rem" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  {s.fulfillment_method === "courier" && !s.waybill_number && (
                    <button onClick={() => bookShipment(s)} disabled={bookingId === s.id} className="btn-plum" style={{ padding: "0.4rem 1rem", fontSize: "0.78rem" }}>
                      {bookingId === s.id ? "Booking…" : "Book with Courier Guy"}
                    </button>
                  )}
                  {s.fulfillment_method === "courier" && s.waybill_number && !["delivered", "cancelled"].includes(s.status) && (
                    <button onClick={() => syncTracking(s)} disabled={syncingId === s.id} className="btn-outline" style={{ padding: "0.4rem 1rem", fontSize: "0.78rem" }}>
                      {syncingId === s.id ? "Syncing…" : "Sync tracking"}
                    </button>
                  )}
                  <button onClick={() => startEdit(s)} className="btn-outline" style={{ padding: "0.4rem 1rem", fontSize: "0.78rem" }}>
                    Update shipment
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}


export default function OrdersManager({ user }: { user: { id: string } }) {
  return (
    <div>
      <OrderFulfillmentManager user={user} />
      <ShipmentsManager user={user} />
    </div>
  );
}
