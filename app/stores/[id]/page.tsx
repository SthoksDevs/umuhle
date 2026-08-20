"use client";
// app/stores/[id]/page.tsx — Store detail page

import { useState, useEffect, useRef, Suspense } from "react";
import { useParams, useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import ReviewsList from "@/components/ReviewsList";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import { UPSELL_TAG_GROUPS } from "@/types";

import { isOpenNow as sharedIsOpenNow, isOpenOnDate, hoursRangeForDate, WEEKDAY_LABELS, type OpeningHours } from "@/lib/opening-hours";
import { TIMES } from "@/lib/booking-times";
import { gTag } from "@/lib/analytics";
import { useCart } from "@/lib/cart-context";

type Salon = {
  id: string; name: string; description: string | null;
  address: string | null; suburb: string | null; city: string | null;
  phone: string | null; email: string | null; website: string | null;
  opening_hours: OpeningHours | null; gallery_urls: string[] | null;
  instagram_username: string | null; youtube_url: string | null;
  services: string[] | null; latitude: number | null; longitude: number | null;
  rating: number | null; review_count: number | null;
  deposit_amount: number | null; // unused — superseded by salon_services.deposit_amount (per service, not per salon)
};
type IgPost = { id: string; media_url: string; permalink: string; caption?: string };
type StoreBookingInsert = { salon_id: string; branch_id: string | null; branch_employee_id: string | null; client_id: string | null; client_name: string; client_phone: string; client_email: string; service: string; service_id: string | null; service_price: number | null; booking_date: string; booking_time: string; notes: string | null };
type BranchStaffOption = { id: string; name: string; photo_url: string | null; specialties: string[] };
// A real, priced, individually-bookable service (see supabase/migrations/
// 20260804_salon_services.sql) — distinct from `salon.services`, which is
// just the four coarse category tags. A salon with none of these yet
// falls back to that plain category picker below, no price, no deposit.
type SalonServiceOption = { id: string; category: string; name: string; price: number; deposit_amount: number | null };

function isOpenNow(s: Salon) {
  return sharedIsOpenNow(s.opening_hours).open;
}

function ytId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|watch\?v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── Icon set (plain line icons — no emoji) ────────────────────────────────────
function PinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-7.58 7-12A7 7 0 0 0 5 9c0 4.42 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.4" />
    </svg>
  );
}
function PhoneIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.6 10.8c1.4 2.7 3.6 4.9 6.3 6.3l2-2c.3-.3.7-.4 1.1-.2 1.1.4 2.3.6 3.5.6.6 0 1.1.5 1.1 1.1v3.3c0 .6-.5 1.1-1.1 1.1C10.7 21 3.5 13.8 3.5 5.1c0-.6.5-1.1 1.1-1.1h3.3c.6 0 1.1.5 1.1 1.1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1.1z" />
    </svg>
  );
}
function MailIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function GlobeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.4 2.5 3.7 5.7 3.7 9s-1.3 6.5-3.7 9c-2.4-2.5-3.7-5.7-3.7-9S9.6 5.5 12 3z" />
    </svg>
  );
}
function ChatIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5C6.8 3.5 2.5 7.2 2.5 11.8c0 2.2 1 4.2 2.7 5.7-.1 1.2-.5 2.5-1.2 3.5 1.5-.2 2.9-.8 4-1.6 1.3.5 2.7.7 4 .7 5.2 0 9.5-3.7 9.5-8.3S17.2 3.5 12 3.5z" />
    </svg>
  );
}
function CheckCircleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.4l2.6 2.6L16 9.5" />
    </svg>
  );
}
function CameraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8a2 2 0 0 1 2-2h1.2l.9-1.5A1.5 1.5 0 0 1 9.4 3.8h5.2a1.5 1.5 0 0 1 1.3.7l.9 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

// ── YouTube embed (lazy, privacy-first) ──────────────────────────────────────
function YTEmbed({ videoId }: { videoId: string }) {
  const [active, setActive] = useState(false);
  const thumb = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  if (!active) return (
    <div onClick={() => setActive(true)} style={{ position: "relative", paddingBottom: "56.25%", borderRadius: 14, overflow: "hidden", cursor: "pointer" }}>
      <Image src={thumb} alt="Watch video" fill style={{ objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>
        <div style={{ width: 64, height: 64, background: "rgba(255,255,255,0.92)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "1.6rem", color: "#FF0000", marginLeft: 4 }}>▶</span>
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ position: "relative", paddingBottom: "56.25%", borderRadius: 14, overflow: "hidden" }}>
      <iframe src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`} allow="autoplay;encrypted-media;picture-in-picture" allowFullScreen title="Store video" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} />
    </div>
  );
}

// ── Instagram feed ────────────────────────────────────────────────────────────
function IGFeed({ username }: { username: string }) {
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    fetch(`/api/instagram/${encodeURIComponent(username)}`).then(r => r.json()).then(d => { setPosts(d.posts ?? []); setDone(true); }).catch(() => setDone(true));
  }, [username]);

  if (!done) return <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>Loading Instagram…</p>;
  if (!posts.length) return (
    <a href={`https://www.instagram.com/${username}`} target="_blank" rel="noopener noreferrer" style={{ display:"inline-flex", alignItems:"center", gap:6, color: "#C13584", fontWeight: 500, fontSize: "0.9rem" }}><CameraIcon size={16} /> @{username} on Instagram →</a>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
        {posts.slice(0,9).map(p => (
          <a key={p.id} href={p.permalink} target="_blank" rel="noopener noreferrer" style={{ display: "block", aspectRatio: "1", overflow: "hidden", borderRadius: 10, position: "relative" }}>
            <Image src={p.media_url} alt={p.caption?.slice(0,60) ?? ""} fill style={{ objectFit: "cover" }} />
          </a>
        ))}
      </div>
      <a href={`https://www.instagram.com/${username}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.82rem", color: "#C13584", fontWeight: 500, display: "block", marginTop: 8 }}>Follow @{username} →</a>
    </div>
  );
}

// ── Gallery with lightbox ─────────────────────────────────────────────────────
function Gallery({ urls }: { urls: string[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!urls.length) return null;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8 }}>
        {urls.map((url,i) => (
          <div key={i} onClick={() => setActive(i)} style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", position: "relative", cursor: "pointer" }}>
            <Image src={url} alt={`Photo ${i+1}`} fill style={{ objectFit: "cover" }} />
          </div>
        ))}
      </div>
      {active !== null && (
        <div onClick={() => setActive(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <button onClick={e => { e.stopPropagation(); setActive(a => a === null || a === 0 ? urls.length-1 : a-1); }} style={{ position: "absolute", left: "1rem", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: "2rem", width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>‹</button>
          <Image src={urls[active]} alt="Gallery" width={900} height={700} style={{ objectFit: "contain", maxHeight: "90vh", maxWidth: "90vw", borderRadius: 12 }} />
          <button onClick={e => { e.stopPropagation(); setActive(a => a === null || a === urls.length-1 ? 0 : a+1); }} style={{ position: "absolute", right: "1rem", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: "2rem", width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>›</button>
        </div>
      )}
    </>
  );
}

// ── Resume an interrupted booking ──────────────────────────────────────────────
// Prefill data pulled off a store_bookings row after a failed/cancelled
// deposit payment, so a shopper doesn't have to re-find this salon and
// re-enter everything just because their card was declined. See
// lib/payments/resume.ts (redirects here with ?resumeBooking=<bookingId>).
type ResumeStoreBookingData = {
  serviceId: string | null;
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  notes: string;
  employeeId: string;
};

// Isolated into its own component (rather than calling useSearchParams
// directly in BookingForm) because useSearchParams requires a Suspense
// boundary — same reasoning as app/payment/failed/page.tsx. Renders
// nothing.
function ResumeStoreBookingWatcher({ salonId, onResume }: { salonId: string; onResume: (data: ResumeStoreBookingData) => void }) {
  const params = useSearchParams();
  const bookingId = params.get("resumeBooking");

  useEffect(() => {
    if (!bookingId) return;
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("store_bookings")
      .select("salon_id, service_id, client_name, client_phone, client_email, booking_date, booking_time, notes, branch_employee_id, status")
      .eq("id", bookingId)
      .maybeSingle()
      .then(({ data }) => {
        // Only resume a still-open attempt for *this* salon — one that's
        // already gone through, belongs elsewhere, or wasn't this client's
        // (RLS already scopes reads to their own rows) just no-ops here.
        if (cancelled || !data || data.salon_id !== salonId || data.status !== "pending") return;
        onResume({
          serviceId: data.service_id,
          name: data.client_name ?? "",
          phone: data.client_phone ?? "",
          email: data.client_email ?? "",
          date: data.booking_date,
          time: (data.booking_time as string)?.slice(0, 5) ?? "",
          notes: data.notes ?? "",
          employeeId: data.branch_employee_id ?? "",
        });
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, salonId]);

  return null;
}

// ── Booking form ──────────────────────────────────────────────────────────────
function BookingForm({ salon, user }: { salon: Salon; user: User | null }) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const oh = salon.opening_hours;
  const services = salon.services?.length ? salon.services : ["hair","nails","makeup","lashes"];

  const [form, setForm] = useState({ name: "", phone: "", email: "", service: services[0], serviceId: "", date: "", time: "", notes: "", employeeId: "" });
  const [saving, setSaving] = useState(false);
  const [depositSaving, setDepositSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [staff, setStaff] = useState<BranchStaffOption[]>([]);
  const [structuredServices, setStructuredServices] = useState<SalonServiceOption[]>([]);
  const [structuredLoading, setStructuredLoading] = useState(true);
  const [resumeBanner, setResumeBanner] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Local calendar date as YYYY-MM-DD — deliberately not toISOString()
  // (that's UTC and can roll back to "yesterday" between midnight and
  // 02:00 SAST), same helper as the homepage's artist booking drawer.
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const handleResume = (data: ResumeStoreBookingData) => {
    setForm(f => ({
      ...f,
      name: data.name || f.name,
      phone: data.phone || f.phone,
      email: data.email || f.email,
      serviceId: data.serviceId ?? f.serviceId,
      notes: data.notes || f.notes,
      employeeId: data.employeeId || f.employeeId,
      date: data.date >= todayStr ? data.date : f.date,
      time: data.date >= todayStr ? data.time : f.time,
    }));
    setResumeBanner(true);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    (async () => {
      const { data: branch } = await supabase
        .from("store_branches").select("id").eq("salon_id", salon.id).eq("is_primary", true).maybeSingle();
      if (!branch) return;
      setBranchId(branch.id);
      const { data } = await supabase
        .from("branch_employees").select("id,name,photo_url,specialties")
        .eq("branch_id", branch.id).eq("is_active", true).order("display_order", { ascending: true });
      setStaff((data as BranchStaffOption[]) ?? []);
    })();
  }, [salon.id]);

  // The real, priced service list — if the salon has added any via the
  // "Manage services" dashboard screen, this replaces the plain category
  // picker below entirely.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("salon_services").select("id,category,name,price,deposit_amount")
        .eq("salon_id", salon.id).eq("is_active", true)
        .order("display_order", { ascending: true }).order("created_at", { ascending: true });
      setStructuredServices((data as SalonServiceOption[]) ?? []);
      setStructuredLoading(false);
    })();
  }, [salon.id]);

  const hasStructuredServices = structuredServices.length > 0;
  const selectedService = structuredServices.find(s => s.id === form.serviceId) ?? null;

  const { addItem } = useCart();
  type UpsellProduct = { id: string; partner_id: string; name: string; price: number; image_url: string | null; category: string | null; tags: string[]; stock_count: number };
  const [upsellProducts, setUpsellProducts] = useState<UpsellProduct[]>([]);
  const [addedProductIds, setAddedProductIds] = useState<Set<string>>(new Set());

  // Same explicit-picks-then-tag-match merge as the artist booking drawer
  // (see app/page.tsx) — salon_services has no tags field of its own, so
  // the tag match here is driven by the service's `category`
  // (UPSELL_TAG_GROUPS is keyed by category) rather than a per-service tag
  // list.
  useEffect(() => {
    if (!selectedService) { setUpsellProducts([]); return; }
    let cancelled = false;
    (async () => {
      const { data: picked } = await supabase
        .from("salon_service_upsell_products")
        .select("display_order, product:products(id, partner_id, name, price, image_url, category, tags, stock_count, is_active, moderation_status)")
        .eq("salon_service_id", selectedService.id)
        .order("display_order", { ascending: true });

      type PickedRow = { product: UpsellProduct & { is_active: boolean; moderation_status: string } | (UpsellProduct & { is_active: boolean; moderation_status: string })[] | null };
      const explicit = ((picked ?? []) as PickedRow[])
        .map((r) => Array.isArray(r.product) ? r.product[0] : r.product)
        .filter((p): p is UpsellProduct & { is_active: boolean; moderation_status: string } =>
          Boolean(p && p.is_active && p.moderation_status === "approved" && p.stock_count > 0));

      if (cancelled) return;
      const remaining = 6 - explicit.length;
      const categoryTags = UPSELL_TAG_GROUPS.find(g => g.category === selectedService.category)?.tags.map(t => t.id) ?? [];
      if (categoryTags.length === 0 || remaining <= 0) {
        setUpsellProducts(explicit.slice(0, 6));
        return;
      }

      const excludeIds = explicit.map((p) => p.id);
      const { data: tagMatched } = await supabase
        .from("products")
        .select("id, partner_id, name, price, image_url, category, tags, stock_count")
        .overlaps("tags", categoryTags)
        .eq("is_active", true)
        .eq("moderation_status", "approved")
        .gt("stock_count", 0)
        .not("id", "in", `(${excludeIds.length ? excludeIds.join(",") : "00000000-0000-0000-0000-000000000000"})`)
        .limit(remaining);

      if (!cancelled) setUpsellProducts([...explicit, ...((tagMatched ?? []) as UpsellProduct[])]);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService?.id]);

  const handleAddUpsell = (p: UpsellProduct) => {
    addItem({ id: p.id, partner_id: p.partner_id, name: p.name, description: null, price: p.price, image_url: p.image_url, category: p.category, tags: p.tags, stock_count: p.stock_count, is_active: true, moderation_status: "approved", moderation_score: null, created_at: "" });
    setAddedProductIds(prev => new Set(prev).add(p.id));
  };

  // Default to the first priced service once the list loads in.
  useEffect(() => {
    if (hasStructuredServices && !form.serviceId) {
      setForm(f => ({ ...f, serviceId: structuredServices[0].id }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuredServices]);

  // Whichever picker is active, this is the category to match staff
  // specialties against — the coarse string itself in fallback mode, or
  // the selected priced service's own category in structured mode.
  const currentCategory = hasStructuredServices ? (selectedService?.category ?? null) : form.service;

  // Staff shown for the currently-selected service: anyone tagged for its
  // category, plus anyone with no specialties set (they're available for
  // everything).
  const staffForService = staff.filter(s => s.specialties.length === 0 || (currentCategory && s.specialties.includes(currentCategory)));

  // If the picked staff member no longer applies once the service changes
  // (or was hidden), fall back to "No preference" rather than silently
  // submitting a mismatched request.
  useEffect(() => {
    if (form.employeeId && !staffForService.some(s => s.id === form.employeeId)) {
      setForm(f => ({ ...f, employeeId: "" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCategory, staff]);

  // Hours can differ per day of the week (and be overridden for a specific
  // date via special_days), so both the valid time slots and the "closed
  // that day" check are recomputed against whichever date is currently
  // selected, rather than one fixed open/close for the whole salon.
  const selectedDateRange = form.date ? hoursRangeForDate(oh, new Date(`${form.date}T00:00:00`)) : null;
  const validTimes = !form.date
    ? TIMES
    : selectedDateRange
      ? TIMES.filter(t => {
          const h = parseInt(t);
          const [openH] = selectedDateRange.open.split(":").map(Number);
          const [closeH] = selectedDateRange.close.split(":").map(Number);
          return h >= openH && h < closeH;
        })
      : [];

  const dayOk = () => {
    if (!form.date) return true;
    return isOpenOnDate(oh, new Date(`${form.date}T00:00:00`));
  };

  // If a previously-picked time falls outside the newly selected date's
  // hours (or that date turns out to be closed), clear it rather than
  // silently submitting a stale, invalid time.
  useEffect(() => {
    if (form.time && !validTimes.includes(form.time)) {
      setForm(f => ({ ...f, time: "" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date]);

  const fieldsOk = () => {
    if (!form.name || !form.phone || !form.email || !form.date || !form.time) { setError("Please fill in all required fields."); return false; }
    if (hasStructuredServices && !form.serviceId) { setError("Please choose a service."); return false; }
    if (!dayOk()) { setError("The salon is closed on that date. Please pick another date."); return false; }
    return true;
  };

  const submit = async () => {
    setError("");
    if (!fieldsOk()) return;
    setSaving(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const payload: StoreBookingInsert = {
      salon_id: salon.id,
      branch_id: branchId,
      branch_employee_id: form.employeeId || null,
      client_id: authUser?.id ?? null,
      client_name: form.name,
      client_phone: form.phone,
      client_email: form.email,
      service: hasStructuredServices ? (selectedService?.name ?? "") : form.service,
      service_id: hasStructuredServices ? (selectedService?.id ?? null) : null,
      service_price: hasStructuredServices ? (selectedService?.price ?? null) : null,
      booking_date: form.date,
      booking_time: form.time,
      notes: form.notes || null,
    };
    const { error: err } = await supabase.from("store_bookings").insert(payload);
    setSaving(false);
    if (err) { setError("Something went wrong. Please try again."); return; }
    gTag("form_submit", { form_name: "store_booking", store_id: salon.id, service: payload.service, branch_employee_id: form.employeeId || undefined });
    setDone(true);
  };

  // Pays a deposit through PayFast instead of the free/no-deposit insert
  // above — see app/api/payfast/initiate/route.ts and
  // lib/payments/fulfillment.ts (fulfillStoreBookingDeposit). The
  // store_bookings row is created server-side once payment is confirmed,
  // not here — this only ever kicks off the hosted-page hand-off. Deposits
  // belong to the salon (see lib/payments/eligibility.ts).
  const payDeposit = async () => {
    setError("");
    if (!fieldsOk()) return;
    setDepositSaving(true);
    try {
      const res = await fetch("/api/payfast/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "store_booking_deposit",
          salonId: salon.id,
          branchId,
          employeeId: form.employeeId || null,
          clientName: form.name,
          clientPhone: form.phone,
          clientEmail: form.email,
          serviceId: selectedService?.id,
          bookingDate: form.date,
          bookingTime: form.time,
          notes: form.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Couldn't start payment.");
      }

      gTag("form_submit", { form_name: "store_booking_deposit", store_id: salon.id, service: selectedService?.name });
      const payForm = document.createElement("form");
      payForm.method = "POST"; payForm.action = data.payfastUrl;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const inp = document.createElement("input"); inp.type = "hidden"; inp.name = k; inp.value = v; payForm.appendChild(inp);
      });
      document.body.appendChild(payForm);
      payForm.submit();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't start payment. Please try again.");
      setDepositSaving(false);
    }
  };

  const inp: React.CSSProperties = { width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid rgba(155,127,184,0.2)", fontSize: "0.9rem", outline: "none", background: "#fff", marginBottom: "0.85rem" };
  const lbl: React.CSSProperties = { fontSize: "0.8rem", fontWeight: 600, color: "#888", display: "block", marginBottom: "0.3rem" };

  if (done) return (
    <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
      <div style={{ color: "var(--forest)", display: "flex", justifyContent: "center", marginBottom: "0.75rem" }}><CheckCircleIcon size={44} /></div>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Booking request sent!</h3>
      <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>The salon will confirm via WhatsApp or phone shortly.</p>
    </div>
  );

  const depositRand = hasStructuredServices && selectedService?.deposit_amount ? (selectedService.deposit_amount / 100).toFixed(2) : null;

  return (
    <div ref={formRef} style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <Suspense fallback={null}>
        <ResumeStoreBookingWatcher salonId={salon.id} onResume={handleResume} />
      </Suspense>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "1.25rem" }}>Book an appointment</h3>

      {resumeBanner && (
        <p style={{ fontSize: "0.8rem", color: "var(--grey)", background: "var(--plum-t)", borderRadius: 10, padding: "0.6rem 0.85rem", marginBottom: "1.25rem" }}>
          We've restored your details from before — just double check and confirm below.
        </p>
      )}

      <div className="store-form-field-row" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "0 1rem" }}>
        <div><label style={lbl}>Your name *</label><input value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="Full name" style={inp} /></div>
        <div><label style={lbl}>WhatsApp / phone *</label><input value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} placeholder="082 123 4567" type="tel" style={inp} /></div>
      </div>

      <label style={lbl}>Email *</label>
      <input value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} placeholder="you@example.com" type="email" required style={inp} />

      <label style={lbl}>Service *</label>
      {structuredLoading ? (
        <div style={{ ...inp, color: "#999" }}>Loading services…</div>
      ) : hasStructuredServices ? (
        <select value={form.serviceId} onChange={e => setForm(f=>({...f,serviceId:e.target.value}))} style={{ ...inp, appearance: "none" }}>
          {structuredServices.map(s => (
            <option key={s.id} value={s.id}>{s.name} — R{(s.price / 100).toFixed(0)}</option>
          ))}
        </select>
      ) : (
        <select value={form.service} onChange={e => setForm(f=>({...f,service:e.target.value}))} style={{ ...inp, appearance: "none" }}>
          {services.map(svc => (
            <option key={svc} value={svc}>{svc.charAt(0).toUpperCase() + svc.slice(1)}</option>
          ))}
        </select>
      )}

      {staffForService.length > 0 && (
        <>
          <label style={lbl}>Who would you like to see? (optional)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "0.85rem" }}>
            <button onClick={() => setForm(f=>({...f,employeeId:""}))} style={{ padding: "0.4rem 1rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer", border: "1.5px solid", borderColor: !form.employeeId?"var(--plum)":"rgba(155,127,184,0.25)", background: !form.employeeId?"var(--plum)":"#fff", color: !form.employeeId?"#fff":"var(--grey)", fontWeight: !form.employeeId?600:400 }}>No preference</button>
            {staffForService.map(s => (
              <button key={s.id} onClick={() => setForm(f=>({...f,employeeId:s.id}))} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.3rem 1rem 0.3rem 0.3rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer", border: "1.5px solid", borderColor: form.employeeId===s.id?"var(--plum)":"rgba(155,127,184,0.25)", background: form.employeeId===s.id?"var(--plum)":"#fff", color: form.employeeId===s.id?"#fff":"var(--grey)", fontWeight: form.employeeId===s.id?600:400 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,0.4)", flexShrink: 0 }}>
                  {s.photo_url && <img src={s.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </span>
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="store-form-field-row" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "0 1rem" }}>
        <div>
          <label style={lbl}>Date *</label>
          <input type="date" value={form.date} min={new Date().toISOString().split("T")[0]} onChange={e => setForm(f=>({...f,date:e.target.value}))} style={{ ...inp, colorScheme: "light" }} />
          {form.date && !dayOk() && <p style={{ color:"#E53935",fontSize:"0.78rem",marginTop:-8,marginBottom:"0.5rem" }}>Closed that day.</p>}
        </div>
        <div>
          <label style={lbl}>Time *</label>
          <select value={form.time} onChange={e => setForm(f=>({...f,time:e.target.value}))} style={{ ...inp, appearance: "none" }}>
            <option value="">Select a time</option>
            {validTimes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <label style={lbl}>Notes (optional)</label>
      <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="Special requests, inspiration images link…" rows={3} style={{ ...inp, resize: "vertical" }} />

      {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</p>}

      {upsellProducts.length > 0 && (
        <div style={{ marginBottom: "0.85rem" }}>
          <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.15rem" }}>You might also like</p>
          <p style={{ fontSize: "0.78rem", color: "var(--grey)", marginBottom: "0.6rem" }}>
            Handy for your {selectedService?.name.toLowerCase()} — added to your cart, checked out separately.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", overflowX: "auto", paddingBottom: "0.25rem" }}>
            {upsellProducts.map(p => {
              const added = addedProductIds.has(p.id);
              return (
                <div key={p.id} style={{ flexShrink: 0, width: 120, borderRadius: 12, border: "1.5px solid rgba(155,127,184,0.15)", overflow: "hidden", background: "#fff" }}>
                  <div style={{ height: 90, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    <Image src={p.image_url ?? "/umuhle-icon.png"} alt={p.name} width={60} height={60} style={{ objectFit: "contain" }} />
                  </div>
                  <div style={{ padding: "0.5rem" }}>
                    <p style={{ fontSize: "0.75rem", fontWeight: 500, margin: 0, lineHeight: 1.3, height: "2.1rem", overflow: "hidden" }}>{p.name}</p>
                    <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--plum)", margin: "0.2rem 0 0.4rem" }}>R{(p.price / 100).toFixed(0)}</p>
                    <button
                      type="button"
                      onClick={() => handleAddUpsell(p)}
                      disabled={added}
                      style={{ width: "100%", padding: "0.35rem", borderRadius: 8, border: "none", fontSize: "0.72rem", fontWeight: 500, cursor: added ? "default" : "pointer", background: added ? "var(--forest)" : "var(--plum)", color: "#fff" }}
                    >{added ? "Added ✓" : "Add to cart"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {depositRand && (
        <div style={{ background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 14, padding: "1rem 1.1rem", marginBottom: "0.85rem" }}>
          <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--plum-d)", marginBottom: "0.3rem" }}>Secure this booking with a deposit</p>
          <p style={{ fontSize: "0.82rem", color: "var(--grey)", marginBottom: "0.85rem" }}>
            Pay a R{depositRand} deposit now and your slot is confirmed instantly — no waiting on a callback.
          </p>
          {user ? (
            <button onClick={payDeposit} disabled={depositSaving || saving} className="btn-plum" style={{ width: "100%", padding: "0.8rem", borderRadius: 100, fontSize: "0.92rem", fontWeight: 600, cursor: depositSaving?"not-allowed":"pointer", opacity: depositSaving?0.7:1 }}>
              {depositSaving ? "Redirecting to payment…" : `Pay R${depositRand} now to Book`}
            </button>
          ) : (
            <button onClick={() => router.push(`${pathname}?auth=login`)} className="btn-plum" style={{ width: "100%", padding: "0.8rem", borderRadius: 100, fontSize: "0.92rem", fontWeight: 600 }}>
              Log in to pay deposit & confirm
            </button>
          )}
        </div>
      )}

      <button onClick={submit} disabled={saving || depositSaving} className={depositRand ? "btn-outline" : "btn-plum"} style={{ width: "100%", padding: "0.9rem", borderRadius: 100, fontSize: "1rem", fontWeight: 600, cursor: saving?"not-allowed":"pointer", opacity: saving?0.7:1 }}>
        {saving ? "Sending…" : depositRand ? "Or request without paying now" : "Request booking"}
      </button>
      <p style={{ fontSize: "0.75rem", color: "#bbb", textAlign: "center", marginTop: "0.75rem" }}>The salon will confirm via WhatsApp or phone.</p>
    </div>
  );
}

// ── Floating WhatsApp button ──────────────────────────────────────────────────
function FloatingWhatsAppButton({ phone, salonName, salonId }: { phone: string; salonName: string; salonId: string }) {
  const waHref = `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi! I'd like to find out more about ${salonName} on Umuhle.`)}`;
  return (
    <a
      href={waHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => gTag("click", { link_type: "whatsapp_float", store_id: salonId })}
      className="store-whatsapp-float"
      aria-label="Chat with us on WhatsApp"
      style={{
        position: "fixed", bottom: "1.5rem", right: "1.5rem", zIndex: 500,
        width: 58, height: 58, borderRadius: "50%",
        background: "#25D366", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 8px 24px rgba(37,211,102,0.4)",
        textDecoration: "none",
      }}
    >
      <ChatIcon size={28} />
    </a>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function StoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [salon, setSalon] = useState<Salon | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
      if (user) supabase.from("profiles").select("full_name,avatar_url,phone").eq("id",user.id).single().then(({data})=>{if(data)setProfile(data as Profile);});
    });
  },[]);

  useEffect(() => {
    if (!id) return;
    supabase.from("partner_salons").select("*").eq("id",id).single().then(({data,error})=>{
      if (!error && data) setSalon(data as Salon);
      setLoading(false);
    });
  },[id]);

  if (loading) return <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center" }}><p style={{ color:"var(--grey)" }}>Loading…</p></div>;
  if (!salon) return (
    <div style={{ minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem" }}>
      <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400 }}>Salon not found</h2>
      <Link href="/stores" style={{ color:"var(--plum)" }}>← Back to salons</Link>
    </div>
  );

  const open = isOpenNow(salon);
  const videoId = salon.youtube_url ? ytId(salon.youtube_url) : null;
  const oh = salon.opening_hours;
  // If a salon has no gallery, no Instagram, and no video, the left column
  // of the grid below would otherwise render empty — fall back to a single
  // centred column (Hours + booking form only) rather than leaving a big
  // patch of blank space next to it.
  const hasLeftColumnContent = Boolean(salon.gallery_urls?.length || salon.instagram_username || videoId);

  return (
    <div style={{ minHeight:"100vh",background:"#FAFAF8" }}>
      <SiteHeader initialUser={user} initialProfile={profile} />

      {/* Hero — gradient plum with optional gallery photo overlay */}
      <div style={{ position:"relative", overflow:"hidden", minHeight:280 }}>
        {/* Gradient base */}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, #6B4F8A 0%, #9B7FB8 40%, #C28070 80%, #D4956B 100%)" }} />
        {/* Gallery photo overlay when available */}
        {salon.gallery_urls?.[0] && (
          <Image src={salon.gallery_urls[0]} alt={salon.name} fill style={{ objectFit:"cover", opacity:0.28, mixBlendMode:"overlay" }} />
        )}
        {/* Dark vignette */}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.08) 60%)" }} />

        {/* Open/closed badge */}
        <div style={{ position:"absolute", top:"1rem", right:"1rem", background:open?"rgba(43,107,69,0.92)":"rgba(30,30,30,0.72)", color:"#fff", borderRadius:100, padding:"0.3rem 0.9rem", fontSize:"0.82rem", fontWeight:600, backdropFilter:"blur(4px)", zIndex:2 }}>
          {open ? "Open now" : "Closed"}
        </div>

        {/* Centred text content */}
        <div style={{ position:"relative", zIndex:1, textAlign:"center", padding:"3.5rem 1.5rem 2.5rem", display:"flex", flexDirection:"column", alignItems:"center", gap:"0.4rem" }}>
          <Link href="/stores" style={{ color:"rgba(255,255,255,0.7)", fontSize:"0.8rem", textDecoration:"none", marginBottom:"0.25rem", letterSpacing:"0.04em" }}>
            ← All salons
          </Link>
          <h1 style={{ color:"#fff", fontFamily:"var(--font-display)", fontWeight:500, fontSize:"clamp(1.75rem,5vw,2.5rem)", margin:0, textShadow:"0 2px 12px rgba(0,0,0,0.25)" }}>{salon.name}</h1>
          <p style={{ color:"rgba(255,255,255,0.85)", fontSize:"0.95rem", margin:0, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <PinIcon size={15} /> {salon.address}{salon.suburb ? `, ${salon.suburb}` : ""}{salon.city ? `, ${salon.city}` : ""}
          </p>
          {salon.services?.length ? (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", marginTop:"0.5rem" }}>
              {salon.services.map(s => (
                <span key={s} style={{ padding:"0.2rem 0.75rem", borderRadius:100, background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.35)", color:"#fff", fontSize:"0.78rem", fontWeight:500, textTransform:"capitalize", backdropFilter:"blur(4px)" }}>{s}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ maxWidth:900,margin:"0 auto",padding:"2rem 1.5rem" }}>

        {/* About — full width of the content area, centred */}
        {salon.description && (
          <section style={{ marginBottom:"2.5rem", textAlign:"center" }}>
            <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.4rem",marginBottom:"0.85rem" }}>About</h2>
            <p style={{ color:"var(--grey)",lineHeight:1.75,fontSize:"1rem",maxWidth:680,margin:"0 auto" }}>{salon.description}</p>
          </section>
        )}

        <div className="store-detail-grid" style={{ display:"grid", gridTemplateColumns: hasLeftColumnContent ? "minmax(0,1fr) minmax(0,min(380px,100%))" : "minmax(0,min(480px,100%))", gap:"2rem", alignItems:"start", justifyContent: hasLeftColumnContent ? undefined : "center", marginBottom:"2.5rem" }}>

          {/* Left */}
          {hasLeftColumnContent && (
            <div>
              {salon.gallery_urls?.length ? (
                <section style={{ marginBottom:"2rem" }}>
                  <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Gallery</h2>
                  <Gallery urls={salon.gallery_urls} />
                </section>
              ) : null}

              {salon.instagram_username && (
                <section style={{ marginBottom:"2rem" }}>
                  <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Instagram <span style={{ fontSize:"0.82rem",color:"#C13584",fontFamily:"var(--font-body)",fontWeight:400 }}>@{salon.instagram_username}</span></h2>
                  <IGFeed username={salon.instagram_username} />
                </section>
              )}

              {videoId && (
                <section style={{ marginBottom:"2rem" }}>
                  <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Watch</h2>
                  <YTEmbed videoId={videoId} />
                </section>
              )}
            </div>
          )}

          {/* Right — sticky: Hours stacked above the booking form */}
          <div className="store-booking-col" style={{ position:"sticky",top:"1.5rem" }}>
            {oh?.weekly && (
              <section style={{ marginBottom:"1.5rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Hours</h2>
                <div style={{ background:"#fff",borderRadius:14,border:"1.5px solid rgba(155,127,184,0.15)",padding:"1rem 1.25rem",display:"grid",gap:"0.4rem" }}>
                  {(["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as const).map(key => {
                    const day = oh.weekly![key];
                    const todayKey = (["sunday","monday","tuesday","wednesday","thursday","friday","saturday"] as const)[new Date().getDay()];
                    const isToday = key === todayKey;
                    const isOpen = !!day && !day.closed && !!day.open && !!day.close;
                    return (
                      <div key={key} style={{ display:"flex",justifyContent:"space-between",fontSize:"0.88rem",fontWeight:isToday?600:400,color:isToday?"var(--plum)":"var(--grey)" }}>
                        <span>{WEEKDAY_LABELS[key]}{isToday?" (today)":""}</span>
                        <span style={{ color:isOpen?(isToday?"var(--plum)":"#333"):"#bbb" }}>{isOpen?`${day.open} – ${day.close}`:"Closed"}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <BookingForm salon={salon} user={user} />
          </div>

        </div>

        {/* Contact — widened like About, four inline icon blocks + map */}
        {(salon.phone || salon.email || salon.website || (salon.latitude && salon.longitude)) && (
          <section style={{ marginBottom:"2.5rem" }}>
            <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.4rem",marginBottom:"1.25rem" }}>Contact</h2>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:"1rem" }}>
              {salon.phone && (
                <a href={`tel:${salon.phone}`} onClick={() => gTag("click", { link_type: "call", store_id: salon.id })} className="contact-block" style={{ display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.6rem",padding:"1.25rem",borderRadius:16,border:"1.5px solid rgba(155,127,184,0.15)",background:"#fff",textDecoration:"none",color:"var(--onyx)" }}>
                  <span style={{ width:52,height:52,borderRadius:"50%",background:"var(--plum-t)",color:"var(--plum-d)",display:"flex",alignItems:"center",justifyContent:"center" }}><PhoneIcon size={24} /></span>
                  <span>
                    <span style={{ display:"block",fontSize:"0.75rem",fontWeight:600,color:"#999",textTransform:"uppercase",letterSpacing:"0.03em" }}>Call</span>
                    <span style={{ display:"block",fontSize:"0.92rem",fontWeight:500 }}>{salon.phone}</span>
                  </span>
                </a>
              )}
              {salon.phone && (
                <a href={`https://wa.me/${salon.phone.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" onClick={() => gTag("click", { link_type: "whatsapp", store_id: salon.id })} className="contact-block" style={{ display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.6rem",padding:"1.25rem",borderRadius:16,border:"1.5px solid rgba(155,127,184,0.15)",background:"#fff",textDecoration:"none",color:"var(--onyx)" }}>
                  <span style={{ width:52,height:52,borderRadius:"50%",background:"rgba(37,211,102,0.12)",color:"#25D366",display:"flex",alignItems:"center",justifyContent:"center" }}><ChatIcon size={24} /></span>
                  <span>
                    <span style={{ display:"block",fontSize:"0.75rem",fontWeight:600,color:"#999",textTransform:"uppercase",letterSpacing:"0.03em" }}>WhatsApp</span>
                    <span style={{ display:"block",fontSize:"0.92rem",fontWeight:500 }}>Message us</span>
                  </span>
                </a>
              )}
              {salon.email && (
                <a href={`mailto:${salon.email}`} onClick={() => gTag("click", { link_type: "email", store_id: salon.id })} className="contact-block" style={{ display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.6rem",padding:"1.25rem",borderRadius:16,border:"1.5px solid rgba(155,127,184,0.15)",background:"#fff",textDecoration:"none",color:"var(--onyx)" }}>
                  <span style={{ width:52,height:52,borderRadius:"50%",background:"var(--plum-t)",color:"var(--plum-d)",display:"flex",alignItems:"center",justifyContent:"center" }}><MailIcon size={24} /></span>
                  <span style={{ minWidth:0 }}>
                    <span style={{ display:"block",fontSize:"0.75rem",fontWeight:600,color:"#999",textTransform:"uppercase",letterSpacing:"0.03em" }}>Email</span>
                    <span style={{ display:"block",fontSize:"0.92rem",fontWeight:500,overflowWrap:"anywhere" }}>{salon.email}</span>
                  </span>
                </a>
              )}
              {salon.website && (
                <a href={salon.website} target="_blank" rel="noopener noreferrer" onClick={() => gTag("click", { link_type: "website", store_id: salon.id })} className="contact-block" style={{ display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.6rem",padding:"1.25rem",borderRadius:16,border:"1.5px solid rgba(155,127,184,0.15)",background:"#fff",textDecoration:"none",color:"var(--onyx)" }}>
                  <span style={{ width:52,height:52,borderRadius:"50%",background:"var(--plum-t)",color:"var(--plum-d)",display:"flex",alignItems:"center",justifyContent:"center" }}><GlobeIcon size={24} /></span>
                  <span style={{ minWidth:0 }}>
                    <span style={{ display:"block",fontSize:"0.75rem",fontWeight:600,color:"#999",textTransform:"uppercase",letterSpacing:"0.03em" }}>Website</span>
                    <span style={{ display:"block",fontSize:"0.92rem",fontWeight:500,overflowWrap:"anywhere" }}>{salon.website.replace(/^https?:\/\//,"")}</span>
                  </span>
                </a>
              )}
            </div>

            {salon.latitude && salon.longitude && (
              <div style={{ marginTop:"1.5rem",borderRadius:16,overflow:"hidden",border:"1.5px solid rgba(155,127,184,0.15)" }}>
                <iframe
                  src={`https://maps.google.com/maps?q=${salon.latitude},${salon.longitude}&output=embed`}
                  width="100%" height="320" style={{ border:"none",display:"block" }}
                  title={`Map for ${salon.name}`} loading="lazy" allowFullScreen
                />
              </div>
            )}
          </section>
        )}

        <ReviewsList salonId={salon.id} rating={salon.rating} reviewCount={salon.review_count} />
      </div>

      <Footer />

      {salon.phone && <FloatingWhatsAppButton phone={salon.phone} salonName={salon.name} salonId={salon.id} />}
    </div>
  );
}
