"use client";

// app/confirm-receipt/[token]/page.tsx
//
// The page a customer lands on from the "Confirm Delivery" link in the
// shipped-notification email/WhatsApp message (see
// lib/email.ts:sendOrderItemShippedEmail and
// lib/whatsapp.ts:notifyOrderItemShipped). One button, deliberately not an
// auto-triggering GET — a mail client's link-preview fetch or WhatsApp's
// own link-unfurl can't accidentally confirm delivery just by loading this
// page; only clicking the button does.

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const ICON = "/umuhle-icon.png";

interface ConfirmInfo {
  productName: string;
  productImage: string | null;
  quantity: number;
  orderId: string;
  clientName: string | null;
  delivered: boolean;
}

export default function ConfirmReceiptPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<ConfirmInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/order-items/confirm/${token}`);
      if (!res.ok) { setNotFound(true); return; }
      const json = (await res.json()) as ConfirmInfo;
      setInfo(json);
      if (json.delivered) setConfirmed(true);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/order-items/confirm/${token}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setConfirmed(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FAFAFA" }}>
      <SiteHeader initialUser={null} />

      <main style={{ flex: 1, maxWidth: 480, margin: "0 auto", padding: "3.5rem 1.5rem 5rem", width: "100%", boxSizing: "border-box", textAlign: "center" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "3rem 0" }}>
            <Image src={ICON} alt="Umuhle" width={44} height={44} style={{ borderRadius: "50%" }} />
          </div>
        ) : notFound ? (
          <>
            <p style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🔗</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", marginBottom: "0.5rem", color: "var(--onyx)" }}>
              This link isn&apos;t valid
            </h1>
            <p style={{ color: "var(--grey)" }}>
              It may be incomplete, or already used. If you think this is a mistake, get in touch with the seller directly.
            </p>
          </>
        ) : confirmed ? (
          <>
            <p style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✓</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", marginBottom: "0.5rem", color: "var(--onyx)" }}>
              Thanks for confirming!
            </h1>
            <p style={{ color: "var(--grey)" }}>
              {info?.productName
                ? `Glad ${info.productName} arrived safely.`
                : "Glad your order arrived safely."}
            </p>
          </>
        ) : info ? (
          <>
            <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.25rem", marginBottom: "1.75rem", display: "flex", alignItems: "center", gap: "1rem", textAlign: "left" }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--plum-t)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                {info.productImage ? (
                  <Image src={info.productImage} alt={info.productName} width={56} height={56} style={{ objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "1.3rem" }}>🛍️</span>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 500, fontSize: "0.95rem", margin: "0 0 0.15rem" }}>
                  {info.productName} <span style={{ color: "var(--grey)" }}>× {info.quantity}</span>
                </p>
                <p style={{ fontSize: "0.78rem", color: "var(--grey)", margin: 0 }}>Order #{info.orderId.slice(0, 8)}</p>
              </div>
            </div>

            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.5rem", marginBottom: "0.5rem", color: "var(--onyx)" }}>
              Has this arrived?
            </h1>
            <p style={{ color: "var(--grey)", marginBottom: "1.75rem" }}>
              Only tap this once it&apos;s actually in your hands.
            </p>

            {error && <p style={{ color: "#BF360C", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="btn-plum"
              style={{ padding: "0.85rem 2.5rem", fontSize: "0.95rem" }}
            >
              {confirming ? "Confirming…" : "Confirm Delivery"}
            </button>
          </>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}
