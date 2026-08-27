"use client";

// app/reschedule/[token]/page.tsx
//
// Landed on from the no-show nudge WhatsApp message (see app/api/cron/
// no-show-check/route.ts) or shared directly — no login, the token in the
// URL is the only credential (see app/api/reschedule/[token]/route.ts).
// Same trust model as app/review/[token]/page.tsx.

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { TIMES } from "@/lib/booking-times";

const ICON = "/umuhle-icon.png";

interface BookingInfo {
  status: "confirmed" | "no_show";
  bookingDate: string;
  bookingTime: string;
  artistName: string;
  artistAvatar: string | null;
  serviceName: string;
  takenTimes: string[];
}

export default function ReschedulePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [takenTimes, setTakenTimes] = useState<Set<string>>(new Set());
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetch(`/api/reschedule/${token}`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "This reschedule link isn't valid.");
        setInfo(data);
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : "Something went wrong"))
      .finally(() => setLoading(false));
  }, [token]);

  const fetchTakenTimes = useCallback((d: string) => {
    if (!d) { setTakenTimes(new Set()); return; }
    setLoadingTimes(true);
    fetch(`/api/reschedule/${token}?date=${d}`)
      .then(res => res.json())
      .then(data => setTakenTimes(new Set((data.takenTimes ?? []) as string[])))
      .finally(() => setLoadingTimes(false));
  }, [token]);

  useEffect(() => { fetchTakenTimes(date); }, [date, fetchTakenTimes]);

  const handleSubmit = async () => {
    if (!date || !time) { setSubmitError("Please pick a date and time."); return; }
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/reschedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't reschedule — please try again.");
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const nowTimeStr = new Date().toTimeString().slice(0, 5);

  return (
    <div className="min-h-screen" style={{ display: "flex", flexDirection: "column", background: "linear-gradient(135deg,#f4eff8 0%,#ffffff 60%)" }}>
      <SiteHeader />
      <main style={{ flex: 1, maxWidth: 480, margin: "0 auto", padding: "3rem 1.5rem", width: "100%" }}>
        {loading && <p style={{ textAlign: "center", color: "var(--grey)" }}>Loading…</p>}

        {!loading && loadError && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>😕</div>
            <p style={{ color: "var(--grey)" }}>{loadError}</p>
          </div>
        )}

        {!loading && info && !done && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", boxShadow: "0 10px 40px rgba(0,0,0,0.06)" }}>
            <div style={{ display: "flex", gap: "0.85rem", alignItems: "center", marginBottom: "1.5rem" }}>
              <Image src={info.artistAvatar || ICON} alt={info.artistName} width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover" }} />
              <div>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", margin: 0 }}>Reschedule your booking</h1>
                <p style={{ color: "var(--grey)", fontSize: "0.85rem", margin: 0 }}>{info.serviceName} with {info.artistName}</p>
              </div>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--grey)", background: "#F5F2F8", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
              Currently booked for {info.bookingDate} at {info.bookingTime}
              {info.status === "no_show" ? " — this slot was marked as missed. Picking a new time below re-confirms your booking." : "."}
            </p>

            <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>New date</label>
            <input type="date" value={date} min={todayStr} onChange={e => { setDate(e.target.value); setTime(""); }}
              style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid #E0E0E0", fontSize: "0.9rem", marginBottom: "1.25rem", boxSizing: "border-box" }} />

            <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>
              New time {loadingTimes && <span style={{ color: "var(--light)", fontWeight: 400 }}>· checking availability…</span>}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(72px,1fr))", gap: "0.5rem", marginBottom: "1.5rem" }}>
              {TIMES.map(t => {
                const isTaken = takenTimes.has(t);
                const isPast = date === todayStr && t < nowTimeStr;
                const isDisabled = !date || isTaken || isPast;
                const isSelected = time === t;
                return (
                  <button key={t} type="button" disabled={isDisabled} onClick={() => setTime(t)}
                    style={{
                      padding: "0.5rem", borderRadius: 10, fontSize: "0.8rem", cursor: isDisabled ? "not-allowed" : "pointer",
                      border: `1.5px solid ${isSelected ? "var(--plum)" : "#E0E0E0"}`,
                      background: isSelected ? "var(--plum)" : isDisabled ? "#F5F5F5" : "#fff",
                      color: isSelected ? "#fff" : isDisabled ? "#ccc" : "#333",
                    }}>
                    {t}
                  </button>
                );
              })}
            </div>

            {submitError && <p style={{ color: "#E53935", fontSize: "0.85rem", marginBottom: "1rem" }}>{submitError}</p>}

            <button className="btn-plum" style={{ width: "100%", padding: "0.85rem" }} disabled={submitting || !date || !time} onClick={handleSubmit}>
              {submitting ? "Rescheduling…" : "Confirm new time"}
            </button>
          </div>
        )}

        {!loading && done && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>✅</div>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "0.5rem" }}>All set</h1>
            <p style={{ color: "var(--grey)" }}>Your booking's been moved to {date} at {time}. We'll send you a reminder closer to the time.</p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
