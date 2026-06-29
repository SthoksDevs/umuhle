// app/payment/success/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { useCart } from "@/lib/cart-context";

const ICON = "/umuhle-icon.png";

function SuccessContent() {
  const params = useSearchParams();
  const method = params.get("method") ?? "payfast";
  const ref    = params.get("ref");
  const { clear } = useCart();

  // Clear the cart as soon as the success page mounts — payment is confirmed.
  useEffect(() => { clear(); }, [clear]);

  const methodLabel: Record<string, string> = {
    payfast:    "PayFast",
    happypay:   "HappyPay",
    google_pay: "Google Pay",
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "3rem 2.5rem", maxWidth: 480, width: "100%", textAlign: "center", boxShadow: "0 24px 80px rgba(155,127,184,0.15)" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--f15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.5rem" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--forest)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>

        <Image src={ICON} alt="Umuhle" width={100} height={100} style={{ borderRadius: "50%", marginBottom: "1rem", marginLeft: "auto", marginRight: "auto" }} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", color: "var(--onyx)", marginBottom: "0.5rem" }}>
          Payment successful!
        </h1>
        <p style={{ color: "var(--grey)", marginBottom: "0.5rem" }}>
          Thank you for your order. Payment was processed via {methodLabel[method] ?? method}.
        </p>
        {ref && (
          <p style={{ fontSize: "0.8rem", color: "var(--light)", marginBottom: "1.5rem" }}>
            Reference: <span style={{ fontFamily: "monospace" }}>{ref}</span>
          </p>
        )}
        <p style={{ color: "var(--grey)", fontSize: "0.9rem", marginBottom: "2rem" }}>
          You will receive a WhatsApp confirmation shortly with your booking or order details.
        </p>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/dashboard">
            <button className="btn-plum">View my dashboard</button>
          </Link>
          <Link href="/shop">
            <button className="btn-outline">Continue shopping</button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Image src={ICON} alt="Umuhle" width={48} height={48} style={{ borderRadius: "50%" }} />
        </div>
      }>
        <SuccessContent />
      </Suspense>
      <Footer />
    </>
  );
}
