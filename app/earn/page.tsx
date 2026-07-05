"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import Footer from "@/components/Footer";
import SiteHeader from "@/components/SiteHeader";

const AD_PACKAGES = [
  { id: "starter",  name: "Starter",  price: "R20",  ads: 1,  duration: "6 weeks",  featured: false },
  { id: "growth",   name: "Growth",   price: "R45",  ads: 3,  duration: "3 months", featured: true  },
  { id: "business", name: "Business", price: "R75",  ads: 6,  duration: "4 months", featured: false },
  { id: "premium",  name: "Premium",  price: "R115", ads: 10, duration: "6 months", featured: false },
];

export default function EarnPage() {
  const supabase = createClient();
  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Record<string, string> | null>(null);
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
      if (user) {
        supabase
          .from("profiles")
          .select("referral_code, full_name")
          .eq("id", user.id)
          .single()
          .then(({ data }) => { if (data) setProfile(data as Record<string, string>); });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
      if (!s?.user) setProfile(null);
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const referralCode = profile?.referral_code ?? null;

  const handleCopy = () => {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--white)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column" }}>
      <SiteHeader initialUser={user} />

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem 4rem", flex: 1, width: "100%", boxSizing: "border-box" }}>

        {/* Hero */}
        <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.35em", color: "var(--nude)", textTransform: "uppercase", marginBottom: "0.75rem" }}>Referral Programme</p>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2.5rem", color: "var(--onyx)", marginBottom: "1rem" }}>
          Earn with <em style={{ color: "var(--plum)", fontStyle: "italic" }}>umuhle</em>
        </h1>
        <p style={{ color: "var(--grey)", maxWidth: 540, marginBottom: "2.5rem", lineHeight: 1.7, fontSize: "1rem" }}>
          Share your unique referral code with any beauty professional. When they sign up and purchase their first advertisement, you earn <strong>R10</strong>. No cap on referrals. Withdraw once you reach <strong>R100</strong>.
        </p>

        {/* ── Referral code card ──
            Logged in + code ready  → show code + copy button
            Logged in + no code yet → show "being generated" message
            Logged out              → show nothing (no sign-in prompt)
        */}
        {user && referralCode ? (
          <div style={{
            background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.4)",
            borderRadius: 16, padding: "1.5rem 2rem",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: "3rem", gap: "1rem", flexWrap: "wrap",
          }}>
            <div>
              <p style={{ fontSize: "0.8rem", color: "var(--plum)", marginBottom: 4, fontWeight: 500 }}>Your referral code</p>
              <p style={{ fontFamily: "monospace", fontSize: "2rem", fontWeight: 700, letterSpacing: "0.12em", margin: 0 }}>{referralCode}</p>
            </div>
            <button className="btn-plum" onClick={handleCopy}>{copied ? "Copied! ✓" : "Copy code"}</button>
          </div>
        ) : user ? (
          /* Logged in but code not yet generated */
          <div style={{
            background: "var(--plum-t)", border: "1.5px solid rgba(155,127,184,0.2)",
            borderRadius: 16, padding: "1.5rem 2rem", marginBottom: "3rem",
          }}>
            <p style={{ color: "var(--grey)", fontSize: "0.9rem", margin: 0 }}>Your code is being generated — refresh in a moment.</p>
          </div>
        ) : null /* Logged out — show nothing here */ }

        {/* How it works */}
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.6rem", color: "var(--onyx)", marginBottom: "1.5rem" }}>How it works</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "1rem", marginBottom: "3rem" }}>
          {[
            ["01", "Get your code",   "Your unique code is on your dashboard after signing in."],
            ["02", "Share it",         "Send it to any beauty professional — a hairdresser, nail tech, or makeup artist."],
            ["03", "They advertise",   "They sign up on Umuhle, enter your code, and pay for their first Ad."],
            ["04", "Earn R10",         "R10 is credited to your Umuhle wallet automatically."],
          ].map(([step, title, desc]) => (
            <div key={step} style={{ border: "1.5px solid rgba(155,127,184,0.15)", borderRadius: 14, padding: "1.25rem", background: "#fff" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--plum)", letterSpacing: "0.08em", marginBottom: 8 }}>STEP {step}</p>
              <p style={{ fontWeight: 500, marginBottom: 4 }}>{title}</p>
              <p style={{ fontSize: "0.85rem", color: "var(--grey)", lineHeight: 1.5, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>

        {/* Earning rules */}
        <div style={{ background: "var(--surface)", borderRadius: 14, padding: "1.5rem", marginBottom: "3rem" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "1rem" }}>Earning rules</h3>
          {[
            ["Reward per partner",  "R10 per qualifying referral"],
            ["When you earn",       "When your referred partner pays for their first advertisement"],
            ["Minimum withdrawal",  "R100"],
            ["Payout schedule",     "Mondays, Wednesdays & Fridays"],
            ["Who can refer",       "Any Umuhle user"],
            ["Code entry",          "During partner sign-up only"],
          ].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", fontSize: "0.9rem", borderBottom: "1px solid rgba(155,127,184,0.08)" }}>
              <span style={{ color: "var(--grey)" }}>{l}</span>
              <span style={{ fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Ad packages */}
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.6rem", color: "var(--onyx)", marginBottom: "0.5rem" }}>Partner Ad packages</h2>
        <p style={{ color: "var(--grey)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>Share these packages with potential partners — your referral triggers their first purchase reward.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: "1rem", marginBottom: "3rem" }}>
          {AD_PACKAGES.map(pkg => (
            <div key={pkg.id} style={{ position: "relative", border: pkg.featured ? "2px solid var(--plum)" : "1.5px solid rgba(155,127,184,0.15)", borderRadius: 16, padding: "1.5rem 1.25rem", background: "#fff" }}>
              {pkg.featured && (
                <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--plum)", color: "#fff", fontSize: "0.7rem", fontWeight: 700, padding: "3px 12px", borderRadius: 100, whiteSpace: "nowrap" }}>MOST POPULAR</span>
              )}
              <p style={{ fontWeight: 600, marginBottom: 4, fontSize: "0.95rem" }}>{pkg.name}</p>
              <p style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--plum)", margin: "0 0 4px" }}>{pkg.price}</p>
              <p style={{ fontSize: "0.8rem", color: "var(--grey)", margin: 0 }}>{pkg.ads} Ad{pkg.ads > 1 ? "s" : ""} · {pkg.duration}</p>
            </div>
          ))}
        </div>

        {/* Become a partner CTA */}
        <div style={{ background: "linear-gradient(135deg, var(--plum-t) 0%, #fff 60%)", borderRadius: 20, padding: "3rem 2rem", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", color: "var(--onyx)", marginBottom: "0.75rem" }}>
            Are you a beauty <em style={{ color: "var(--plum)", fontStyle: "italic" }}>professional</em>?
          </h2>
          <p style={{ color: "var(--grey)", maxWidth: 400, margin: "0 auto 1.5rem", fontSize: "0.95rem" }}>
            Become an Umuhle Partner. Sell products, run advertisements, and list your salon.
          </p>
          <Link href="/?auth=register">
            <button className="btn-plum">Become a Partner</button>
          </Link>
        </div>

      </main>

      <Footer />
    </div>
  );
}
