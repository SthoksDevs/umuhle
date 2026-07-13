// app/payment/cancelled/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const ICON = "/umuhle-icon.png";

function CancelledContent() {
  const params = useSearchParams();
  const ref    = params.get("ref");
  const type   = params.get("type");
  const method = params.get("method") ?? "payfast";

  // Most gateways don't send a server-to-server notification for a plain
  // "shopper backed out before paying" cancellation — PayFast in
  // particular never does (see app/api/payments/finalize/route.ts for the
  // full explanation). This closes out the booking/order and sends the
  // cancellation email if the real webhook hasn't already done so. Safe to
  // call even when it has: finalize only ever acts on a still-pending
  // record, so a webhook that already landed makes this a no-op.
  //
  // `type` is only present on checkouts started after this fix shipped —
  // older in-flight PayFast redirects land here without it, in which case
  // this silently no-ops, same as before this fix (no regression either way).
  useEffect(() => {
    if (!ref || !type) return;
    fetch("/api/payments/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, type, gateway: method, outcome: "cancelled" }),
    }).catch(() => {
      // Best-effort — nothing to show the customer either way.
    });
  }, [ref, type, method]);

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "3rem 2.5rem", maxWidth: 480, width: "100%", textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.06)" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.5rem" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#E65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>

        <Image src={ICON} alt="Umuhle" width={100} height={100} style={{ borderRadius: "50%", marginBottom: "1rem", marginLeft: "auto", marginRight: "auto" }} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", color: "var(--onyx)", marginBottom: "0.5rem" }}>
          Payment cancelled
        </h1>
        <p style={{ color: "var(--grey)", marginBottom: "2rem", fontSize: "0.95rem" }}>
          No payment was taken and nothing was booked. Your cart is still saved — you can try again whenever you&apos;re ready.
        </p>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/checkout">
            <button className="btn-plum">Try again</button>
          </Link>
          <Link href="/cart">
            <button className="btn-outline">Back to cart</button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentCancelPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
        </div>
      }>
        <CancelledContent />
      </Suspense>
      <Footer />
    </>
  );
}
