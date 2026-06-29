"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import type { Profile } from "@/types";
import ProductForm, { productToForm, type ProductFormData } from "@/components/ProductForm";

const ICON = "/umuhle-icon.png";
const SUPER_ADMIN_EMAIL = "info@umuhle.co.za";
const fmt = (cents: number) => `R${(cents / 100).toFixed(0)}`;

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminTab =
  | "analytics"
  | "salons"
  | "users"
  | "ads"
  | "products"
  | "payments"
  | "umuhle-products"
  | "add-salon"
  | "email-log";

type ModerationStatus = "pending" | "approved" | "rejected";

interface SalonRow {
  id: string;
  name: string;
  address: string | null;
  suburb: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  services: string[];
  status: string;
  moderation_status: string;
  gallery_urls: string[];
  instagram_username: string | null;
  created_at: string;
  partner_id: string;
  partner?: { full_name: string; email: string };
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  account_type: string | null;
  account_status: string;
  is_admin: boolean;
  is_partner: boolean;
  is_artist: boolean;
  created_at: string;
}

interface AdRow {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  package: string;
  status: string;
  moderation_status: string;
  created_at: string;
  partner_id: string;
  partner?: { full_name: string; email: string };
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  stock_count: number;
  is_active: boolean;
  moderation_status: string;
  created_at: string;
  partner_id: string;
  weight_g: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  partner?: { full_name: string; email: string };
  is_umuhle_product?: boolean;
}

interface WithdrawalRow {
  id: string;
  profile_id: string;
  amount: number;
  bank_name: string;
  account_number: string;
  account_holder: string;
  status: string;
  created_at: string;
  profile?: { full_name: string; email: string; phone: string };
}

interface Analytics {
  totalUsers: number;
  activeUsers: number;
  totalOrderVolume: number;
  totalOrders: number;
  totalSalons: number;
  pendingSalons: number;
  totalProducts: number;
  pendingProducts: number;
  totalAds: number;
  pendingAds: number;
  pendingWithdrawals: number;
  pendingWithdrawalAmount: number;
}

// ── PillNav ───────────────────────────────────────────────────────────────────

function PillNav<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: string; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, []);

  return (
    <div style={{ position: "relative", marginBottom: "1.75rem" }}>
      <div
        ref={scrollRef}
        style={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "0.25rem",
            background: "#fff",
            borderRadius: 100,
            padding: "0.3rem",
            border: "1.5px solid rgba(155,127,184,0.12)",
            width: "max-content",
            minWidth: "100%",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              style={{
                borderRadius: 100,
                border: "none",
                cursor: "pointer",
                padding: "0.5rem 1.1rem",
                fontSize: "0.85rem",
                fontWeight: active === t.id ? 500 : 400,
                background: active === t.id ? "var(--plum)" : "transparent",
                color: active === t.id ? "#fff" : "var(--grey)",
                transition: "all 0.18s",
                whiteSpace: "nowrap",
                position: "relative",
              }}
            >
              {t.label}
              {t.badge && t.badge > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 4,
                    background: "#E53935",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 16,
                    height: 16,
                    fontSize: "0.6rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                  }}
                >
                  {t.badge > 9 ? "9+" : t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      {canScrollRight && (
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: "smooth" })}
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            background: "linear-gradient(to left, #fff 60%, transparent)",
            border: "none",
            cursor: "pointer",
            padding: "0.35rem 0.5rem 0.35rem 1.5rem",
            color: "var(--plum)",
            fontSize: "1rem",
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: "#FFF3E0", color: "#E65100", label: "Pending" },
    approved: { bg: "#E8F5E9", color: "#2E7D32", label: "Approved" },
    rejected: { bg: "#FAFAFA", color: "#757575", label: "Rejected" },
    active: { bg: "#E8F5E9", color: "#2E7D32", label: "Active" },
    scanning: { bg: "#E3F2FD", color: "#1565C0", label: "Scanning" },
    needs_review: { bg: "#FFF3E0", color: "#E65100", label: "Needs Review" },
    draft: { bg: "#F5F5F5", color: "#616161", label: "Draft" },
    paid: { bg: "#E8F5E9", color: "#2E7D32", label: "Paid" },
    suspended: { bg: "#FFEBEE", color: "#C62828", label: "Suspended" },
  };
  const s = map[status] ?? { bg: "#F5F5F5", color: "#616161", label: status };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        borderRadius: 100,
        padding: "0.2rem 0.7rem",
        fontSize: "0.72rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return <p style={{ color: "var(--grey)" }}>Loading analytics…</p>;

  const cards = [
    { label: "Total Users", value: analytics.totalUsers.toLocaleString(), icon: "👥", color: "#7B5EA7" },
    { label: "Active Users (30d)", value: analytics.activeUsers.toLocaleString(), icon: "🟢", color: "#2E7D32" },
    { label: "Total Order Volume", value: fmt(analytics.totalOrderVolume), icon: "💰", color: "#E65100" },
    { label: "Total Orders", value: analytics.totalOrders.toLocaleString(), icon: "📦", color: "#1565C0" },
    { label: "Total Stores", value: analytics.totalSalons.toLocaleString(), icon: "✂️", color: "#4A148C" },
    { label: "Pending Stores", value: analytics.pendingSalons.toLocaleString(), icon: "⏳", color: "#E65100" },
    { label: "Total Products", value: analytics.totalProducts.toLocaleString(), icon: "🛍️", color: "#0F6E56" },
    { label: "Pending Withdrawals", value: fmt(analytics.pendingWithdrawalAmount), icon: "💳", color: "#C62828" },
  ];

  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          fontSize: "1.4rem",
          marginBottom: "0.5rem",
        }}
      >
        Platform Analytics
      </h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Overview of key metrics across the Umuhle platform.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: "#fff",
              borderRadius: 18,
              border: "1.5px solid rgba(155,127,184,0.15)",
              padding: "1.25rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "1.5rem" }}>{c.icon}</span>
            </div>
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.75rem",
                fontWeight: 500,
                color: c.color,
                margin: "0 0 0.25rem",
              }}
            >
              {c.value}
            </p>
            <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Salons Tab ────────────────────────────────────────────────────────────────

function SalonsTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [salons, setSalons] = useState<SalonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("partner_salons")
      .select("*, partner:profiles!partner_id(full_name, email)")
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setSalons((data ?? []) as unknown as SalonRow[]);
    setLoading(false);
  }, [filter, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (id: string, status: string) => {
    setActionLoading(id);
    await supabase.from("partner_salons").update({ status, is_active: status === "approved" }).eq("id", id);
    setSalons((prev) => prev.map((s) => (s.id === id ? { ...s, status, is_active: status === "approved" } : s)));
    setActionLoading(null);
  };

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        Salon Publications
      </h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Review and verify store listings submitted by partners.
      </p>
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              borderRadius: 100,
              border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`,
              padding: "0.35rem 0.9rem",
              fontSize: "0.8rem",
              fontWeight: filter === f ? 500 : 400,
              background: filter === f ? "var(--plum-t)" : "#fff",
              color: filter === f ? "var(--plum)" : "var(--grey)",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>
      {loading ? (
        <p style={{ color: "var(--grey)" }}>Loading salons…</p>
      ) : salons.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem",
            background: "#fff",
            borderRadius: 18,
            border: "1.5px solid rgba(155,127,184,0.12)",
          }}
        >
          <p style={{ color: "var(--grey)" }}>No salons in this category.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {salons.map((salon) => (
            <div
              key={salon.id}
              style={{
                background: "#fff",
                borderRadius: 16,
                border: "1.5px solid rgba(155,127,184,0.15)",
                padding: "1.25rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
                    <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1rem", margin: 0 }}>
                      {salon.name}
                    </h3>
                    <StatusBadge status={salon.status} />
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: "0 0 0.25rem" }}>
                    📍 {[salon.address, salon.suburb, salon.city].filter(Boolean).join(", ")}
                  </p>
                  <p style={{ fontSize: "0.78rem", color: "var(--light)", margin: "0 0 0.5rem" }}>
                    Owner: {(salon.partner as { full_name: string; email: string } | undefined)?.full_name ?? "Unknown"} ·{" "}
                    {(salon.partner as { full_name: string; email: string } | undefined)?.email ?? ""}
                  </p>
                  {salon.services?.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {salon.services.map((s: string) => (
                        <span
                          key={s}
                          style={{
                            padding: "0.2rem 0.6rem",
                            borderRadius: 100,
                            border: "1px solid rgba(155,127,184,0.3)",
                            fontSize: "0.72rem",
                            color: "var(--plum)",
                            textTransform: "capitalize",
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {salon.gallery_urls?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {salon.gallery_urls.slice(0, 3).map((url: string, i: number) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={url}
                        alt=""
                        style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }}
                      />
                    ))}
                  </div>
                )}
              </div>
              {salon.status === "pending" && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button
                    onClick={() => updateStatus(salon.id, "approved")}
                    disabled={actionLoading === salon.id}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: 100,
                      border: "none",
                      background: "#E8F5E9",
                      color: "#2E7D32",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => updateStatus(salon.id, "rejected")}
                    disabled={actionLoading === salon.id}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: 100,
                      border: "none",
                      background: "#FFEBEE",
                      color: "#C62828",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    ✗ Reject
                  </button>
                  <a
                    href={`/stores/${salon.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "0.82rem", color: "var(--plum)", alignSelf: "center", marginLeft: "auto" }}
                  >
                    View listing →
                  </a>
                </div>
              )}
              {salon.status !== "pending" && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  {salon.status === "approved" && (
                    <button
                      onClick={() => updateStatus(salon.id, "rejected")}
                      disabled={actionLoading === salon.id}
                      style={{
                        padding: "0.4rem 1rem",
                        borderRadius: 100,
                        border: "none",
                        background: "#FFEBEE",
                        color: "#C62828",
                        fontWeight: 500,
                        fontSize: "0.8rem",
                        cursor: "pointer",
                      }}
                    >
                      Revoke
                    </button>
                  )}
                  {salon.status === "rejected" && (
                    <button
                      onClick={() => updateStatus(salon.id, "approved")}
                      disabled={actionLoading === salon.id}
                      style={{
                        padding: "0.4rem 1rem",
                        borderRadius: 100,
                        border: "none",
                        background: "#E8F5E9",
                        color: "#2E7D32",
                        fontWeight: 500,
                        fontSize: "0.8rem",
                        cursor: "pointer",
                      }}
                    >
                      Re-approve
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "suspended">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
    if (filter !== "all") q = q.eq("account_status", filter);
    if (search.trim()) q = q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    const { data } = await q;
    setUsers((data ?? []) as UserRow[]);
    setLoading(false);
  }, [filter, search, supabase]);

  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load]);

  const toggleSuspend = async (u: UserRow) => {
    setActionLoading(u.id);
    const newStatus = u.account_status === "suspended" ? "active" : "suspended";
    await supabase.from("profiles").update({ account_status: newStatus }).eq("id", u.id);
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, account_status: newStatus } : x)));
    setActionLoading(null);
  };

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        User Management
      </h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        View registered users. Total registrations and activity.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 220,
            padding: "0.65rem 1rem",
            borderRadius: 12,
            border: "1.5px solid #E0E0E0",
            fontSize: "0.88rem",
          }}
        />
        {(["all", "active", "suspended"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              borderRadius: 100,
              border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`,
              padding: "0.35rem 0.9rem",
              fontSize: "0.8rem",
              fontWeight: filter === f ? 500 : 400,
              background: filter === f ? "var(--plum-t)" : "#fff",
              color: filter === f ? "var(--plum)" : "var(--grey)",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>
      {loading ? (
        <p style={{ color: "var(--grey)" }}>Loading users…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{
                background: "#fff",
                borderRadius: 14,
                border: "1.5px solid rgba(155,127,184,0.12)",
                padding: "0.9rem 1.25rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.15rem" }}>
                  <p style={{ fontWeight: 500, fontSize: "0.9rem", margin: 0 }}>
                    {u.full_name ?? "No name"}{" "}
                    {u.is_admin && (
                      <span style={{ fontSize: "0.7rem", background: "var(--plum)", color: "#fff", borderRadius: 4, padding: "1px 5px", marginLeft: 4 }}>
                        Admin
                      </span>
                    )}
                  </p>
                  <StatusBadge status={u.account_status} />
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: "0 0 0.1rem" }}>{u.email}</p>
                <p style={{ fontSize: "0.75rem", color: "var(--light)", margin: 0 }}>
                  {u.account_type ?? "customer"} · Joined{" "}
                  {new Date(u.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              {u.email !== SUPER_ADMIN_EMAIL && (
                <button
                  onClick={() => toggleSuspend(u)}
                  disabled={actionLoading === u.id}
                  style={{
                    padding: "0.4rem 1rem",
                    borderRadius: 100,
                    border: "none",
                    background: u.account_status === "suspended" ? "#E8F5E9" : "#FFEBEE",
                    color: u.account_status === "suspended" ? "#2E7D32" : "#C62828",
                    fontWeight: 500,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {u.account_status === "suspended" ? "Reinstate" : "Suspend"}
                </button>
              )}
            </div>
          ))}
          {users.length === 0 && (
            <p style={{ color: "var(--grey)", textAlign: "center", padding: "2rem" }}>No users found.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Ads Tab ───────────────────────────────────────────────────────────────────

function AdsReviewTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "active" | "all">("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("ads")
      .select("*, partner:profiles!partner_id(full_name, email)")
      .order("created_at", { ascending: false });
    if (filter === "pending") q = q.eq("moderation_status", "draft").neq("status", "expired");
    else if (filter === "active") q = q.eq("status", "active");
    const { data } = await q;
    setAds((data ?? []) as unknown as AdRow[]);
    setLoading(false);
  }, [filter, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id: string) => {
    setActionLoading(id);
    await supabase
      .from("ads")
      .update({ moderation_status: "approved", status: "active", starts_at: new Date().toISOString() })
      .eq("id", id);
    setAds((prev) => prev.filter((a) => a.id !== id));
    setActionLoading(null);
  };

  const reject = async (id: string) => {
    setActionLoading(id);
    await supabase.from("ads").update({ moderation_status: "rejected", status: "cancelled" }).eq("id", id);
    setAds((prev) => prev.filter((a) => a.id !== id));
    setActionLoading(null);
  };

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        Ad Moderation
      </h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Review ad submissions before they go live.
      </p>
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem" }}>
        {(["pending", "active", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              borderRadius: 100,
              border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`,
              padding: "0.35rem 0.9rem",
              fontSize: "0.8rem",
              fontWeight: filter === f ? 500 : 400,
              background: filter === f ? "var(--plum-t)" : "#fff",
              color: filter === f ? "var(--plum)" : "var(--grey)",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>
      {loading ? (
        <p style={{ color: "var(--grey)" }}>Loading ads…</p>
      ) : ads.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <p style={{ color: "var(--grey)" }}>No ads in this category.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {ads.map((ad) => (
            <div
              key={ad.id}
              style={{ background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem" }}
            >
              <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                {ad.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ad.image_url}
                    alt=""
                    style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <p style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>{ad.title}</p>
                    <StatusBadge status={ad.moderation_status} />
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: "0 0 0.25rem" }}>{ad.description}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--light)", margin: 0 }}>
                    Partner: {(ad.partner as { full_name: string; email: string } | undefined)?.full_name ?? "Unknown"} · Package:{" "}
                    <span style={{ textTransform: "capitalize" }}>{ad.package}</span>
                  </p>
                </div>
              </div>
              {filter === "pending" && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button
                    onClick={() => approve(ad.id)}
                    disabled={actionLoading === ad.id}
                    style={{ padding: "0.5rem 1.25rem", borderRadius: 100, border: "none", background: "#E8F5E9", color: "#2E7D32", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
                  >
                    ✓ Approve & Go Live
                  </button>
                  <button
                    onClick={() => reject(ad.id)}
                    disabled={actionLoading === ad.id}
                    style={{ padding: "0.5rem 1.25rem", borderRadius: 100, border: "none", background: "#FFEBEE", color: "#C62828", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
                  >
                    ✗ Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Products Tab ──────────────────────────────────────────────────────────────

function ProductsReviewTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [products,     setProducts]     = useState<ProductRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [filter,       setFilter]       = useState<"pending" | "approved" | "all">("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editTarget,   setEditTarget]   = useState<ProductRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("products")
      .select("*, partner:profiles!partner_id(full_name, email)")
      .order("created_at", { ascending: false });
    if (filter === "pending") q = q.in("moderation_status", ["scanning", "needs_review", "draft"]);
    else if (filter === "approved") q = q.eq("moderation_status", "approved");
    const { data } = await q;
    setProducts((data ?? []) as unknown as ProductRow[]);
    setLoading(false);
  }, [filter, supabase]);

  useEffect(() => { load(); }, [load]);

  const updateMod = async (id: string, status: string) => {
    setActionLoading(id);
    await supabase.from("products").update({ moderation_status: status, is_active: status === "approved" }).eq("id", id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setActionLoading(null);
  };

  const handleEdited = (saved: ProductFormData & { id: string }) => {
    setProducts(prev => prev.map(p =>
      p.id === saved.id
        ? {
            ...p,                                          // keep DB-only fields (is_active, moderation_status, created_at, partner_id, …)
            name:        saved.name,
            description: saved.description || null,
            price:       Math.round(Number(saved.price) * 100),
            category:    saved.category || null,
            stock_count: parseInt(saved.stock_count) || 0,
            image_url:   saved.image_url ?? p.image_url,
            weight_g:    saved.weight_g   ? parseInt(saved.weight_g)    : null,
            length_cm:   saved.length_cm  ? parseFloat(saved.length_cm) : null,
            width_cm:    saved.width_cm   ? parseFloat(saved.width_cm)  : null,
            height_cm:   saved.height_cm  ? parseFloat(saved.height_cm) : null,
          }
        : p
    ));
    setEditTarget(null);
  };

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        Product Moderation
      </h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Review partner product submissions before they appear in the shop.
      </p>
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem" }}>
        {(["pending", "approved", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            borderRadius: 100,
            border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`,
            padding: "0.35rem 0.9rem", fontSize: "0.8rem",
            fontWeight: filter === f ? 500 : 400,
            background: filter === f ? "var(--plum-t)" : "#fff",
            color: filter === f ? "var(--plum)" : "var(--grey)",
            cursor: "pointer", textTransform: "capitalize",
          }}>
            {f}
          </button>
        ))}
      </div>

      {/* Inline edit form */}
      {editTarget && (
        <div style={{ marginBottom: "1.5rem" }}>
          <ProductForm
            initial={productToForm(editTarget)}
            partnerId={editTarget.partner_id}
            supabase={supabase}
            skipVerify={true}
            onSaved={handleEdited}
            onCancel={() => setEditTarget(null)}
          />
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--grey)" }}>Loading products…</p>
      ) : products.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <p style={{ color: "var(--grey)" }}>No products in this category.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {products.map((p) => (
            <div key={p.id} style={{ background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem" }}>
              <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: 10, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: "1.5rem" }}>🛍️</span>
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <p style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>{p.name}</p>
                    <StatusBadge status={p.moderation_status} />
                    {p.is_umuhle_product && (
                      <span style={{ background: "var(--plum)", color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: "0.68rem", fontWeight: 700 }}>Umuhle</span>
                    )}
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--grey)", margin: "0 0 0.1rem" }}>
                    {fmt(p.price)} · Stock: {p.stock_count} · {p.category ?? "uncategorised"}
                  </p>
                  {(p.weight_g || p.length_cm) && (
                    <p style={{ fontSize: "0.72rem", color: "#bbb", margin: "0 0 0.1rem" }}>
                      {p.weight_g ? `${p.weight_g}g` : "no weight"}
                      {p.length_cm ? ` · ${p.length_cm}×${p.width_cm}×${p.height_cm} cm` : " · no dimensions"}
                    </p>
                  )}
                  {!p.weight_g && !p.length_cm && (
                    <p style={{ fontSize: "0.72rem", color: "#E65100", margin: "0 0 0.1rem" }}>
                      ⚠️ Missing delivery dimensions
                    </p>
                  )}
                  <p style={{ fontSize: "0.75rem", color: "var(--light)", margin: 0 }}>
                    Partner: {(p.partner as { full_name: string; email: string } | undefined)?.full_name ?? "Umuhle"}
                  </p>
                </div>
                <button
                  onClick={() => setEditTarget(p)}
                  style={{ padding: "0.35rem 0.9rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--plum)", fontWeight: 500, fontSize: "0.78rem", cursor: "pointer", flexShrink: 0 }}
                >
                  Edit
                </button>
              </div>
              {filter !== "approved" && !p.is_umuhle_product && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button onClick={() => updateMod(p.id, "approved")} disabled={actionLoading === p.id}
                    style={{ padding: "0.5rem 1.25rem", borderRadius: 100, border: "none", background: "#E8F5E9", color: "#2E7D32", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}>
                    ✓ Approve
                  </button>
                  <button onClick={() => updateMod(p.id, "rejected")} disabled={actionLoading === p.id}
                    style={{ padding: "0.5rem 1.25rem", borderRadius: 100, border: "none", background: "#FFEBEE", color: "#C62828", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}>
                    ✗ Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payments/Withdrawals Tab ──────────────────────────────────────────────────

function PaymentsTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "paid" | "all">("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("withdrawals")
      .select("*, profile:profiles!profile_id(full_name, email, phone)")
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setWithdrawals((data ?? []) as unknown as WithdrawalRow[]);
    setLoading(false);
  }, [filter, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (id: string, status: string) => {
    setActionLoading(id);
    const payload: Record<string, string | null> = { status };
    if (status === "paid" || status === "approved") payload.processed_at = new Date().toISOString();
    if (notes[id]) payload.notes = notes[id];
    await supabase.from("withdrawals").update(payload).eq("id", id);

    // If approving payment, deduct from wallet
    if (status === "paid") {
      const w = withdrawals.find((x) => x.id === id);
      if (w) {
        const { data: walletData } = await supabase
          .from("wallets")
          .select("id")
          .eq("profile_id", w.profile_id)
          .single();
        if (walletData) {
          await supabase.from("wallet_transactions").insert({
            wallet_id: walletData.id,
            amount: w.amount,
            type: "debit",
            description: `Withdrawal paid — ${w.bank_name} ${w.account_number}`,
          });
        }
      }
    }

    setWithdrawals((prev) => prev.filter((x) => x.id !== id));
    setActionLoading(null);
  };

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        Payment Requests
      </h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Manage user withdrawal requests and mark payments as processed.
      </p>
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {(["pending", "approved", "paid", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              borderRadius: 100,
              border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.25)"}`,
              padding: "0.35rem 0.9rem",
              fontSize: "0.8rem",
              fontWeight: filter === f ? 500 : 400,
              background: filter === f ? "var(--plum-t)" : "#fff",
              color: filter === f ? "var(--plum)" : "var(--grey)",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>
      {loading ? (
        <p style={{ color: "var(--grey)" }}>Loading…</p>
      ) : withdrawals.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.12)" }}>
          <p style={{ color: "var(--grey)" }}>No withdrawal requests in this category.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {withdrawals.map((w) => (
            <div
              key={w.id}
              style={{ background: "#fff", borderRadius: 16, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
                    <p style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--plum)", margin: 0 }}>{fmt(w.amount)}</p>
                    <StatusBadge status={w.status} />
                  </div>
                  <p style={{ fontSize: "0.85rem", fontWeight: 500, margin: "0 0 0.15rem" }}>
                    {(w.profile as { full_name: string; email: string; phone: string } | undefined)?.full_name ?? "Unknown"}
                  </p>
                  <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: "0 0 0.5rem" }}>
                    {(w.profile as { full_name: string; email: string; phone: string } | undefined)?.email} ·{" "}
                    {(w.profile as { full_name: string; email: string; phone: string } | undefined)?.phone}
                  </p>
                  <div style={{ background: "#FAFAFA", borderRadius: 10, padding: "0.65rem 0.9rem", display: "inline-block" }}>
                    <p style={{ fontSize: "0.8rem", margin: "0 0 0.1rem" }}>
                      <strong>{w.bank_name}</strong>
                    </p>
                    <p style={{ fontSize: "0.8rem", margin: "0 0 0.1rem", fontFamily: "monospace" }}>{w.account_number}</p>
                    <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>Acc holder: {w.account_holder}</p>
                  </div>
                  <p style={{ fontSize: "0.72rem", color: "var(--light)", marginTop: "0.5rem" }}>
                    Requested: {new Date(w.created_at).toLocaleDateString("en-ZA")}
                  </p>
                </div>
              </div>
              {(filter === "pending" || filter === "approved") && (
                <div style={{ marginTop: "1rem" }}>
                  <input
                    placeholder="Add note (optional)…"
                    value={notes[w.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [w.id]: e.target.value }))}
                    style={{ width: "100%", padding: "0.55rem 0.9rem", borderRadius: 10, border: "1.5px solid #E0E0E0", fontSize: "0.85rem", marginBottom: "0.65rem", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {filter === "pending" && (
                      <button
                        onClick={() => updateStatus(w.id, "approved")}
                        disabled={actionLoading === w.id}
                        style={{ padding: "0.5rem 1.25rem", borderRadius: 100, border: "none", background: "#E3F2FD", color: "#1565C0", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
                      >
                        Approve
                      </button>
                    )}
                    {(filter === "pending" || filter === "approved") && (
                      <button
                        onClick={() => updateStatus(w.id, "paid")}
                        disabled={actionLoading === w.id}
                        style={{ padding: "0.5rem 1.25rem", borderRadius: 100, border: "none", background: "#E8F5E9", color: "#2E7D32", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
                      >
                        ✓ Mark as Paid
                      </button>
                    )}
                    <button
                      onClick={() => updateStatus(w.id, "rejected")}
                      disabled={actionLoading === w.id}
                      style={{ padding: "0.5rem 1.25rem", borderRadius: 100, border: "none", background: "#FFEBEE", color: "#C62828", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
                    >
                      ✗ Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Umuhle Products Tab ───────────────────────────────────────────────────────

function UmuhleProductsTab({
  supabase,
  userId,
}: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
}) {
  const [products,   setProducts]   = useState<ProductRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editTarget, setEditTarget] = useState<ProductRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("partner_id", userId)
      .order("created_at", { ascending: false });
    setProducts((data ?? []) as ProductRow[]);
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (p: ProductRow) => {
    await supabase.from("products").update({ is_active: !p.is_active }).eq("id", p.id);
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)));
  };

  // Called by ProductForm after a successful save
  const handleSaved = (saved: ProductRow & { id: string }) => {
    setProducts((prev) => {
      const exists = prev.find((p) => p.id === saved.id);
      if (exists) return prev.map((p) => p.id === saved.id ? { ...p, ...saved } : p);
      return [saved as unknown as ProductRow, ...prev];
    });
    setShowForm(false);
    setEditTarget(null);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", margin: 0 }}>
          Umuhle Products
        </h2>
        {!showForm && !editTarget && (
          <button onClick={() => setShowForm(true)} className="btn-plum" style={{ padding: "0.55rem 1.25rem", fontSize: "0.85rem" }}>
            + Add Product
          </button>
        )}
      </div>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Products uploaded here are published immediately without requiring verification.
      </p>

      {/* Add form */}
      {showForm && (
        <div style={{ marginBottom: "1.5rem" }}>
          <ProductForm
            partnerId={userId}
            supabase={supabase}
            skipVerify={true}
            onSaved={handleSaved}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Edit form */}
      {editTarget && (
        <div style={{ marginBottom: "1.5rem" }}>
          <ProductForm
            initial={productToForm(editTarget)}
            partnerId={userId}
            supabase={supabase}
            skipVerify={true}
            onSaved={handleSaved}
            onCancel={() => setEditTarget(null)}
          />
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--grey)" }}>Loading…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {products.map((p) => (
            <div
              key={p.id}
              style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(155,127,184,0.12)", padding: "1rem 1.25rem", display: "flex", gap: "1rem", alignItems: "center" }}
            >
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 8, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span>🛍️</span>
                </div>
              )}
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: "0.9rem", margin: "0 0 0.1rem" }}>{p.name}</p>
                <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: "0 0 0.1rem" }}>
                  {fmt(p.price)} · {p.stock_count} in stock · <span style={{ textTransform: "capitalize" }}>{p.category}</span>
                </p>
                {(p.weight_g || p.length_cm) && (
                  <p style={{ fontSize: "0.72rem", color: "#bbb", margin: 0 }}>
                    {p.weight_g ? `${p.weight_g}g` : ""}
                    {p.length_cm ? ` · ${p.length_cm}×${p.width_cm}×${p.height_cm} cm` : ""}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button
                  onClick={() => { setEditTarget(p); setShowForm(false); }}
                  style={{ padding: "0.35rem 0.9rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--plum)", fontWeight: 500, fontSize: "0.78rem", cursor: "pointer" }}
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleActive(p)}
                  style={{ padding: "0.35rem 0.9rem", borderRadius: 100, border: "none", background: p.is_active ? "#E8F5E9" : "#F5F5F5", color: p.is_active ? "#2E7D32" : "#757575", fontWeight: 500, fontSize: "0.78rem", cursor: "pointer" }}
                >
                  {p.is_active ? "Live" : "Hidden"}
                </button>
              </div>
            </div>
          ))}
          {products.length === 0 && (
            <p style={{ color: "var(--grey)", textAlign: "center", padding: "2rem" }}>No Umuhle products yet. Add one above.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Salon Tab (admin creates a salon directly — auto-approved) ─────────────
// Identical to the SalonForm in dashboard/page.tsx but status is "approved"
// immediately so it goes live without manual review.

type DayHours = { closed: boolean; open: string; close: string };
type SpecialDay = { date: string; closed: boolean; open?: string; close?: string };
type OpeningHours = {
  weekly: {
    sunday: DayHours; monday: DayHours; tuesday: DayHours;
    wednesday: DayHours; thursday: DayHours; friday: DayHours; saturday: DayHours;
  };
  public_holidays: DayHours;
  special_days: SpecialDay[];
};
type SalonListing = {
  id?: string; name: string; description: string; address: string;
  suburb: string; city: string; phone: string; email: string; website: string;
  opening_hours: OpeningHours; gallery_urls: string[];
  instagram_username: string; youtube_url: string; services: string[];
  status?: "pending" | "approved" | "rejected";
};

const WEEK_DAYS_ADMIN = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"] as const;
const ALL_SALON_SERVICES = ["hair","nails","makeup","lashes"];
const defaultDayAdmin: DayHours = { closed: false, open: "08:00", close: "17:00" };

const emptySalonAdmin = (): SalonListing => ({
  name: "", description: "", address: "", suburb: "", city: "",
  phone: "", email: "", website: "",
  opening_hours: {
    weekly: {
      sunday:    { closed: true, open: "", close: "" },
      monday:    { ...defaultDayAdmin },
      tuesday:   { ...defaultDayAdmin },
      wednesday: { ...defaultDayAdmin },
      thursday:  { ...defaultDayAdmin },
      friday:    { ...defaultDayAdmin },
      saturday:  { closed: false, open: "08:00", close: "13:00" },
    },
    public_holidays: { closed: true, open: "", close: "" },
    special_days: [],
  },
  gallery_urls: [], instagram_username: "", youtube_url: "", services: [],
});

function AddSalonTab({ supabase, userId }: { supabase: ReturnType<typeof createClient>; userId: string }) {
  const [form,         setForm]        = useState<SalonListing>(emptySalonAdmin());
  const [saving,       setSaving]      = useState(false);
  const [error,        setError]       = useState("");
  const [success,      setSuccess]     = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.75rem 1rem", borderRadius: 12,
    border: "1.5px solid #E0E0E0", fontSize: "0.9rem", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.8rem", fontWeight: 600, color: "#888",
    display: "block", marginBottom: "0.3rem", marginTop: "0.85rem",
  };

  const toggleService = (svc: string) => {
    setForm(f => ({
      ...f,
      services: f.services.includes(svc) ? f.services.filter(s => s !== svc) : [...f.services, svc],
    }));
  };

  const handleSubmit = async () => {
    setError(""); setSuccess("");
    if (!form.name.trim()) { setError("Salon name is required."); return; }
    if (!form.address.trim()) { setError("Address is required."); return; }
    const openDays = Object.values(form.opening_hours.weekly).filter(d => !d.closed);
    if (openDays.length === 0) { setError("Select at least one open business day."); return; }
    if (form.services.length === 0) { setError("Select at least one service."); return; }

    setSaving(true);
    try {
      let partnerId = userId;
      if (partnerEmail.trim()) {
        const { data: partnerProfile } = await supabase
          .from("profiles").select("id").eq("email", partnerEmail.trim()).single();
        if (partnerProfile) partnerId = partnerProfile.id;
        else { setError("Partner email not found in profiles."); setSaving(false); return; }
      }

      const { error: insertErr } = await supabase.from("partner_salons").insert({
        partner_id:         partnerId,
        name:               form.name.trim(),
        description:        form.description.trim() || null,
        address:            form.address.trim(),
        suburb:             form.suburb.trim() || null,
        city:               form.city.trim() || null,
        phone:              form.phone.trim() || null,
        email:              form.email.trim() || null,
        website:            form.website.trim() || null,
        instagram_username: form.instagram_username.trim() || null,
        youtube_url:        form.youtube_url.trim() || null,
        services:           form.services,
        opening_hours:      form.opening_hours,
        gallery_urls:       [],
        status:             "approved",
        is_active:          true,
      });
      if (insertErr) throw insertErr;

      setSuccess(`Salon "${form.name}" created and published.`);
      setForm(emptySalonAdmin());
      setPartnerEmail("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        Add Salon (Admin)
      </h2>
      <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Manually create and immediately publish a salon. No review required.
      </p>

      <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>

        <label style={labelStyle}>Partner email (optional)</label>
        <input type="email" value={partnerEmail}
          onChange={e => setPartnerEmail(e.target.value)}
          placeholder="partner@example.co.za" style={inputStyle} />
        <p style={{ fontSize: "0.75rem", color: "var(--light)", marginTop: "0.25rem" }}>
          Leave blank to assign to your admin account.
        </p>

        <label style={labelStyle}>Salon name *</label>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Beauty by Thandi" style={inputStyle} />

        <label style={labelStyle}>Description</label>
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Tell clients what makes this salon special…" rows={3}
          style={{ ...inputStyle, resize: "vertical" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
          <div>
            <label style={labelStyle}>Suburb *</label>
            <input value={form.suburb} onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))}
              placeholder="e.g. Sandton" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>City *</label>
            <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
              placeholder="e.g. Johannesburg" style={inputStyle} />
          </div>
        </div>

        <label style={labelStyle}>Full address *</label>
        <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          placeholder="123 Main Street, Sandton" style={inputStyle} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
          <div>
            <label style={labelStyle}>Phone</label>
            <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="082 123 4567" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="hello@yoursalon.co.za" style={inputStyle} />
          </div>
        </div>

        <label style={labelStyle}>Website</label>
        <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
          placeholder="https://yoursalon.co.za" style={inputStyle} />

        <label style={labelStyle}>Services offered *</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {ALL_SALON_SERVICES.map(svc => {
            const on = form.services.includes(svc);
            return (
              <button key={svc} type="button" onClick={() => toggleService(svc)} style={{
                padding: "0.4rem 1rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer",
                border: "1.5px solid", borderColor: on ? "var(--plum)" : "rgba(155,127,184,0.25)",
                background: on ? "var(--plum)" : "#fff", color: on ? "#fff" : "var(--grey)",
                fontWeight: on ? 600 : 400, textTransform: "capitalize",
              }}>{svc}</button>
            );
          })}
        </div>

        <label style={{ ...labelStyle, marginTop: "1.25rem" }}>Business hours *</label>
        <div style={{ border: "1.5px solid #E0E0E0", borderRadius: 12, overflow: "hidden", marginTop: 4 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#fafaf8" }}>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Day</th>
                <th style={{ padding: "0.75rem", textAlign: "center" }}>Closed</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Open</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Close</th>
              </tr>
            </thead>
            <tbody>
              {WEEK_DAYS_ADMIN.map(day => {
                const hours = form.opening_hours.weekly[day];
                return (
                  <tr key={day} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "0.75rem", textTransform: "capitalize" }}>{day}</td>
                    <td style={{ padding: "0.75rem", textAlign: "center" }}>
                      <input type="checkbox" checked={hours.closed}
                        onChange={e => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, weekly: { ...f.opening_hours.weekly, [day]: { ...hours, closed: e.target.checked } } } }))} />
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <input type="time" disabled={hours.closed} value={hours.open}
                        onChange={e => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, weekly: { ...f.opening_hours.weekly, [day]: { ...hours, open: e.target.value } } } }))}
                        style={{ ...inputStyle, opacity: hours.closed ? 0.5 : 1 }} />
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <input type="time" disabled={hours.closed} value={hours.close}
                        onChange={e => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, weekly: { ...f.opening_hours.weekly, [day]: { ...hours, close: e.target.value } } } }))}
                        style={{ ...inputStyle, opacity: hours.closed ? 0.5 : 1 }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label style={{ ...labelStyle, marginTop: "1rem" }}>Public holidays</label>
        <div style={{ border: "1.5px solid #E0E0E0", borderRadius: 12, padding: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: "0.75rem", alignItems: "center" }}>
            <label>
              <input type="checkbox" checked={form.opening_hours.public_holidays.closed}
                onChange={e => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, public_holidays: { ...f.opening_hours.public_holidays, closed: e.target.checked } } }))} />
              {" "}Closed
            </label>
            <input type="time" disabled={form.opening_hours.public_holidays.closed}
              value={form.opening_hours.public_holidays.open}
              onChange={e => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, public_holidays: { ...f.opening_hours.public_holidays, open: e.target.value } } }))}
              style={inputStyle} />
            <input type="time" disabled={form.opening_hours.public_holidays.closed}
              value={form.opening_hours.public_holidays.close}
              onChange={e => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, public_holidays: { ...f.opening_hours.public_holidays, close: e.target.value } } }))}
              style={inputStyle} />
          </div>
        </div>

        <label style={{ ...labelStyle, marginTop: "1rem" }}>Special days</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {form.opening_hours.special_days.map((sd, idx) => (
            <div key={idx} style={{ border: "1.5px solid #E0E0E0", borderRadius: 12, padding: "0.75rem", display: "grid", gridTemplateColumns: "1.2fr auto 1fr 1fr auto", gap: "0.5rem", alignItems: "center" }}>
              <input type="date" value={sd.date}
                onChange={e => { const next = [...form.opening_hours.special_days]; next[idx].date = e.target.value; setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, special_days: next } })); }}
                style={inputStyle} />
              <label>
                <input type="checkbox" checked={sd.closed}
                  onChange={e => { const next = [...form.opening_hours.special_days]; next[idx].closed = e.target.checked; setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, special_days: next } })); }} />
                {" "}Closed
              </label>
              <input type="time" disabled={sd.closed} value={sd.open ?? ""}
                onChange={e => { const next = [...form.opening_hours.special_days]; next[idx].open = e.target.value; setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, special_days: next } })); }}
                style={inputStyle} />
              <input type="time" disabled={sd.closed} value={sd.close ?? ""}
                onChange={e => { const next = [...form.opening_hours.special_days]; next[idx].close = e.target.value; setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, special_days: next } })); }}
                style={inputStyle} />
              <button type="button"
                onClick={() => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, special_days: f.opening_hours.special_days.filter((_, i) => i !== idx) } }))}
                style={{ border: "none", background: "#FCEBEB", color: "#A32D2D", borderRadius: 8, padding: "0.5rem", cursor: "pointer" }}>
                Remove
              </button>
            </div>
          ))}
          <button type="button"
            onClick={() => setForm(f => ({ ...f, opening_hours: { ...f.opening_hours, special_days: [...f.opening_hours.special_days, { date: "", closed: true, open: "", close: "" }] } }))}
            style={{ padding: "0.75rem", borderRadius: 12, border: "1.5px dashed rgba(155,127,184,0.3)", background: "#fafaf8", cursor: "pointer", color: "var(--plum)" }}>
            + Add special day
          </button>
        </div>

        <label style={labelStyle}>Instagram username</label>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "#C13584", fontSize: "0.9rem", pointerEvents: "none" }}>@</span>
          <input value={form.instagram_username}
            onChange={e => setForm(f => ({ ...f, instagram_username: e.target.value.replace(/^@/, "") }))}
            placeholder="yoursalonhandle" style={{ ...inputStyle, paddingLeft: "2rem" }} />
        </div>

        <label style={labelStyle}>YouTube video URL</label>
        <input type="url" value={form.youtube_url}
          onChange={e => setForm(f => ({ ...f, youtube_url: e.target.value }))}
          placeholder="https://youtube.com/watch?v=..." style={inputStyle} />

        {error   && <p style={{ color: "#E53935", fontSize: "0.85rem", marginTop: "0.75rem", background: "#FFF0F0", borderRadius: 8, padding: "0.5rem 0.75rem" }}>{error}</p>}
        {success && <p style={{ color: "#2E7D32", fontSize: "0.85rem", marginTop: "0.75rem", background: "#F1F8E9", borderRadius: 8, padding: "0.5rem 0.75rem" }}>✓ {success}</p>}

        <button onClick={handleSubmit} disabled={saving} className="btn-plum"
          style={{ marginTop: "1.25rem", padding: "0.75rem 2rem", borderRadius: 100, fontWeight: 600, width: "100%", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Creating…" : "Create & Publish Salon"}
        </button>
        <p style={{ fontSize: "0.75rem", color: "#bbb", textAlign: "center", marginTop: "0.5rem" }}>
          Salon goes live immediately — no review needed for admin-created listings.
        </p>
      </div>
    </div>
  );
}



// ── EmailLogTab ───────────────────────────────────────────────────────────────

interface EmailLogRow {
  id: string;
  to_address: string;
  subject: string;
  template: string;
  reference_id: string | null;
  status: "sent" | "failed";
  error_msg: string | null;
  sent_at: string;
}

function EmailLogTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [rows,    setRows]    = useState<EmailLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<"all" | "sent" | "failed">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const q = supabase
      .from("email_log")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(200);
    if (filter !== "all") q.eq("status", filter);
    const { data } = await q;
    setRows((data ?? []) as EmailLogRow[]);
    setLoading(false);
  }, [supabase, filter]);

  useEffect(() => { load(); }, [load]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.4rem", margin: 0 }}>Email log</h2>
          <p style={{ color: "var(--grey)", fontSize: "0.85rem", marginTop: "0.25rem" }}>Last 200 emails sent from the platform.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["all", "sent", "failed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: "0.35rem 0.9rem", borderRadius: 100, border: `1.5px solid ${filter === f ? "var(--plum)" : "rgba(155,127,184,0.3)"}`, background: filter === f ? "var(--plum-t)" : "#fff", color: filter === f ? "var(--plum)" : "var(--grey)", fontWeight: filter === f ? 600 : 400, fontSize: "0.8rem", cursor: "pointer", textTransform: "capitalize" }}>
              {f}
            </button>
          ))}
          <button onClick={load} style={{ padding: "0.35rem 0.9rem", borderRadius: 100, border: "1.5px solid rgba(155,127,184,0.3)", background: "#fff", color: "var(--grey)", fontSize: "0.8rem", cursor: "pointer" }}>↻</button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: "var(--grey)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--grey)" }}>
          {filter === "failed" ? "No failed emails. 🎉" : "No emails logged yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {rows.map(r => (
            <div key={r.id} style={{ background: "#fff", borderRadius: 12, border: `1.5px solid ${r.status === "failed" ? "#FFCDD2" : "rgba(155,127,184,0.12)"}`, padding: "0.85rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                <span style={{ fontSize: "1.1rem", marginTop: "0.05rem", flexShrink: 0 }}>{r.status === "failed" ? "❌" : "✅"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: "0.875rem", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject}</p>
                  <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: "0.15rem 0 0" }}>
                    <span style={{ background: "#F3EEF9", color: "var(--plum)", borderRadius: 4, padding: "1px 5px", fontSize: "0.7rem", fontWeight: 600, marginRight: 6 }}>{r.template}</span>
                    To: {r.to_address}
                    {r.reference_id && <span style={{ color: "#bbb", marginLeft: 6, fontFamily: "monospace", fontSize: "0.72rem" }}>{r.reference_id.slice(0, 8)}…</span>}
                  </p>
                  {r.status === "failed" && r.error_msg && (
                    <p style={{ fontSize: "0.75rem", color: "#C62828", background: "#FFF5F5", borderRadius: 6, padding: "0.25rem 0.5rem", marginTop: "0.35rem" }}>{r.error_msg}</p>
                  )}
                </div>
                <span style={{ fontSize: "0.72rem", color: "#bbb", flexShrink: 0, whiteSpace: "nowrap" }}>{fmt(r.sent_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Admin Dashboard ───────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<AdminTab>("analytics");
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/"); return; }
      if (user.email !== SUPER_ADMIN_EMAIL) { router.replace("/dashboard"); return; }
      setUser(user);
      supabase.from("profiles").select("*").eq("id", user.id).single().then(({ data }) => {
        if (data) setProfile(data as Profile);
        setLoading(false);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAnalytics = useCallback(async () => {
    const [
      { count: totalUsers },
      { count: totalOrders },
      { data: orderVolume },
      { count: totalSalons },
      { count: pendingSalons },
      { count: totalProducts },
      { count: pendingProducts },
      { count: totalAds },
      { count: pendingAds },
      { count: pendingWithdrawals },
      { data: pendingWdAmount },
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "paid"),
      supabase.from("orders").select("total_amount").eq("status", "paid"),
      supabase.from("partner_salons").select("*", { count: "exact", head: true }),
      supabase.from("partner_salons").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("products").select("*", { count: "exact", head: true }),
      supabase.from("products").select("*", { count: "exact", head: true }).in("moderation_status", ["scanning", "draft", "needs_review"]),
      supabase.from("ads").select("*", { count: "exact", head: true }),
      supabase.from("ads").select("*", { count: "exact", head: true }).eq("moderation_status", "draft"),
      supabase.from("withdrawals").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("withdrawals").select("amount").eq("status", "pending"),
    ]);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: activeUsers } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("updated_at", thirtyDaysAgo);

    const totalVolume = (orderVolume ?? []).reduce((sum: number, o: { total_amount: number }) => sum + o.total_amount, 0);
    const pendingWdTotal = (pendingWdAmount ?? []).reduce((sum: number, w: { amount: number }) => sum + w.amount, 0);

    setAnalytics({
      totalUsers: totalUsers ?? 0,
      activeUsers: activeUsers ?? 0,
      totalOrderVolume: totalVolume,
      totalOrders: totalOrders ?? 0,
      totalSalons: totalSalons ?? 0,
      pendingSalons: pendingSalons ?? 0,
      totalProducts: totalProducts ?? 0,
      pendingProducts: pendingProducts ?? 0,
      totalAds: totalAds ?? 0,
      pendingAds: pendingAds ?? 0,
      pendingWithdrawals: pendingWithdrawals ?? 0,
      pendingWithdrawalAmount: pendingWdTotal,
    });
  }, [supabase]);

  useEffect(() => {
    if (!loading && user) loadAnalytics();
  }, [loading, user, loadAnalytics]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
      </div>
    );
  }

  if (!user || !profile) return null;

  const TAB_CONFIG: { id: AdminTab; label: string; icon: string; badge?: number }[] = [
    { id: "analytics", label: "Analytics", icon: "📊" },
    { id: "salons", label: "Stores", icon: "✂️", badge: analytics?.pendingSalons },
    { id: "users", label: "Users", icon: "👥" },
    { id: "ads", label: "Ads", icon: "📣", badge: analytics?.pendingAds },
    { id: "products", label: "Products", icon: "🛍️", badge: analytics?.pendingProducts },
    { id: "payments", label: "Payments", icon: "💰", badge: analytics?.pendingWithdrawals },
    { id: "umuhle-products", label: "Umuhle Products", icon: "⭐" },
    { id: "add-salon", label: "Add Store", icon: "➕" },
    { id: "email-log", label: "Emails", icon: "📧" },
  ];

  const PRIMARY_TABS: AdminTab[] = ["analytics", "salons", "users", "products", "payments"];
  const MORE_TABS = TAB_CONFIG.filter((t) => !PRIMARY_TABS.includes(t.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FAFAFA" }}>
      <SiteHeader initialUser={user} initialProfile={profile} />

      {showMoreMenu && (
        <div className="modal-overlay" onClick={() => setShowMoreMenu(false)} style={{ alignItems: "flex-end", padding: 0 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1.25rem 1rem 2rem", width: "100%", maxWidth: 480, boxShadow: "0 -8px 40px rgba(0,0,0,0.12)" }}
          >
            <div style={{ width: 40, height: 4, background: "#E0E0E0", borderRadius: 2, margin: "0 auto 1.25rem" }} />
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--grey)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem", paddingLeft: "0.5rem" }}>More</p>
            {MORE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setShowMoreMenu(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "1rem", padding: "0.85rem 0.75rem", borderRadius: 14, border: "none", background: tab === t.id ? "var(--plum-t)" : "transparent", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontSize: "1.3rem", width: 28 }}>{t.icon}</span>
                <span style={{ fontSize: "0.95rem", fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? "var(--plum)" : "var(--onyx)" }}>{t.label}</span>
                {t.badge && t.badge > 0 ? (
                  <span style={{ marginLeft: "auto", background: "#E53935", color: "#fff", borderRadius: "50%", width: 20, height: 20, fontSize: "0.7rem", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                    {t.badge > 9 ? "9+" : t.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}

      <main style={{ flex: 1, maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem 6rem", width: "100%", boxSizing: "border-box" }}>
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "0.75rem", letterSpacing: "0.3em", color: "var(--nude)", textTransform: "uppercase", margin: 0 }}>Super Admin</p>
            <span style={{ background: "var(--plum)", color: "#fff", borderRadius: 4, padding: "1px 7px", fontSize: "0.68rem", fontWeight: 700 }}>🛡 Admin</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(1.75rem,4vw,2.5rem)", color: "var(--onyx)", marginBottom: "0.25rem" }}>Admin Dashboard</h1>
          <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>{user.email}</p>
        </div>

        <div className="dashboard-desktop-tabs">
          <PillNav tabs={TAB_CONFIG} active={tab} onChange={setTab} />
        </div>

        {tab === "analytics" && <AnalyticsTab analytics={analytics} />}
        {tab === "salons" && <SalonsTab supabase={supabase} />}
        {tab === "users" && <UsersTab supabase={supabase} />}
        {tab === "ads" && <AdsReviewTab supabase={supabase} />}
        {tab === "products" && <ProductsReviewTab supabase={supabase} />}
        {tab === "payments" && <PaymentsTab supabase={supabase} />}
        {tab === "umuhle-products" && <UmuhleProductsTab supabase={supabase} userId={user.id} />}
        {tab === "add-salon" && <AddSalonTab supabase={supabase} userId={user.id} />}
        {tab === "email-log" && <EmailLogTab supabase={supabase} />}
      </main>

      {/* Mobile Bottom Bar */}
      <nav className="dashboard-bottom-bar">
        {PRIMARY_TABS.map((id) => {
          const t = TAB_CONFIG.find((x) => x.id === id)!;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.2rem", padding: "0.6rem 0.25rem", border: "none", background: "transparent", cursor: "pointer", borderRadius: 12, position: "relative" }}
            >
              <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: "0.68rem", fontWeight: isActive ? 600 : 400, color: isActive ? "var(--plum)" : "var(--grey)" }}>{t.label}</span>
              {isActive && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--plum)", marginTop: "0.1rem" }} />}
              {t.badge && t.badge > 0 ? (
                <span style={{ position: "absolute", top: 4, right: "20%", background: "#E53935", color: "#fff", borderRadius: "50%", width: 15, height: 15, fontSize: "0.55rem", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {t.badge > 9 ? "9+" : t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          onClick={() => setShowMoreMenu(true)}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.2rem", padding: "0.6rem 0.25rem", border: "none", background: "transparent", cursor: "pointer", borderRadius: 12 }}
        >
          <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>⋯</span>
          <span style={{ fontSize: "0.68rem", fontWeight: 400, color: "var(--grey)" }}>More</span>
        </button>
      </nav>

      <Footer />
    </div>
  );
}