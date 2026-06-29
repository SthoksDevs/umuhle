// app/payment/failed/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const ICON = "/umuhle-icon.png";

function FailedContent() {
  const params = useSearchParams();
  const ref    = params.get("ref");

  return (
    <div style={{ minHeight: "100vh", background: "#FFF5F5", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "3rem 2.5rem", maxWidth: 480, width: "100%", textAlign: "center", boxShadow: "0 24px 80px rgba(229,57,53,0.08)" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#FFEBEE", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.5rem" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>

        <Image src={ICON} alt="Umuhle" width={40} height={40} style={{ borderRadius: "50%", marginBottom: "1rem" }} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", color: "var(--onyx)", marginBottom: "0.5rem" }}>
          Payment failed
        </h1>
        <p style={{ color: "var(--grey)", marginBottom: "0.5rem", fontSize: "0.95rem" }}>
          Your payment could not be processed. No charge was made and nothing was booked or ordered.
        </p>
        {ref && (
          <p style={{ fontSize: "0.8rem", color: "var(--light)", marginBottom: "1rem" }}>
            Reference: <span style={{ fontFamily: "monospace" }}>{ref}</span>
          </p>
        )}
        <p style={{ color: "var(--grey)", fontSize: "0.875rem", marginBottom: "2rem" }}>
          Please check your card details and try again, or contact your bank. If the problem persists{" "}
          <a href="mailto:info@umuhle.co.za" style={{ color: "var(--plum)", textDecoration: "none" }}>get in touch</a>.
        </p>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/checkout">
            <button className="btn-plum">Try again</button>
          </Link>
          <Link href="/">
            <button className="btn-outline">Go home</button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentFailedPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
        </div>
      }>
        <FailedContent />
      </Suspense>
      <Footer />
    </>
  );
}
