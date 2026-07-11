import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border border-[#e8e0f0] bg-white p-6 shadow-sm">
    <h2 className="mb-3 text-xl font-medium text-[#9b7fb8]">{title}</h2>
    <div className="space-y-3 text-slate-700">{children}</div>
  </section>
);

const Row = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="flex items-center justify-between gap-4 border-b border-[#f0eaf7] py-3 last:border-0">
    <div>
      <p className="font-medium text-slate-800">{label}</p>
      {sub && <p className="text-sm text-slate-500">{sub}</p>}
    </div>
    <p className="whitespace-nowrap font-semibold text-[#9b7fb8]">{value}</p>
  </div>
);

export default function FeesPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f4eff8_0%,#ffffff_60%)]" style={{ display: "flex", flexDirection: "column" }}>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-12" style={{ flex: 1 }}>
        <Link href="/" className="text-sm text-[#9b7fb8]">← Back to Umuhle</Link>

        <div className="mt-8 mb-10">
          <h1 style={{ fontFamily: "Raleway, sans-serif", fontWeight: 300, textTransform: "lowercase" }} className="text-5xl text-[#9b7fb8]">
            fees &amp; pricing
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Umuhle is free to browse, book and shop. Below is every fee a partner or artist might come across —
            no hidden charges, and nothing beyond what&apos;s listed here.
          </p>
          <p className="mt-2 text-sm text-slate-400">Last updated: July 2026</p>
        </div>

        <div className="space-y-6">

          <Section title="Browsing, Booking &amp; Buying — Free">
            <p>
              Creating an account, browsing artists and products, and booking a service all cost nothing.
              When you buy a product, you pay only the listed price plus delivery — there&apos;s no service or
              booking fee added at checkout.
            </p>
            <p>
              Returns are free too: a 7‑day window, no restocking fee, and a prepaid shipping label included
              with every order. See our <Link href="/returns" className="text-[#9b7fb8] underline">returns policy</Link> for details.
            </p>
          </Section>

          <Section title="Listing a Product — from R20">
            <p>
              To keep the shop genuine and reviewed, every product listing runs on a simple package price.
              Buying a package with more than one product slot means the rest are banked on your account — use
              them on other products any time, at no extra charge. There&apos;s no separate &ldquo;advertising&rdquo;
              fee on top — listing a product is what promotes it.
            </p>
            <div className="mt-2 divide-y divide-[#f0eaf7] rounded-2xl border border-[#f0eaf7] px-4">
              <Row label="Starter" value="R20" sub="1 product · 6 weeks — the minimum" />
              <Row label="Growth" value="R45" sub="3 products · 3 months each" />
              <Row label="Business" value="R75" sub="6 products · 4 months each" />
              <Row label="Premium" value="R115" sub="10 products · 6 months each" />
            </div>
            <p className="text-sm text-slate-500">
              Picking a longer package just means not having to renew as often — it doesn&apos;t change what you
              keep from a sale (see commission, below). When a listing expires it&apos;s automatically hidden
              from the shop until it&apos;s renewed.
            </p>
          </Section>

          <Section title="Selling a Product — 5.5% Commission">
            <p>
              Separate from the listing fee, Umuhle takes a <strong>5.5% commission</strong> on the sale price
              whenever a product actually sells — you keep <strong>94.5%</strong>. This is deducted automatically;
              there&apos;s nothing to invoice or pay out of pocket. If a product doesn&apos;t sell, you&apos;re
              never charged commission on it — only the original listing fee applies.
            </p>
          </Section>

          <Section title="Bookings (Artists) — 5.5% Commission">
            <p>
              The same <strong>5.5% commission</strong> applies to completed bookings — you keep{" "}
              <strong>94.5%</strong> of the service price, credited to your wallet automatically once the
              booking is marked complete. There&apos;s no fee to create a profile or list your services.
            </p>
          </Section>

          <Section title="Salon Listing — R35 / year">
            <p>
              If you want a discoverable salon/store profile with its own page and location, a salon listing
              is <strong>R35 per year</strong>. This is entirely optional — you can take bookings and sell
              products without one.
            </p>
          </Section>

          <Section title="Salon Gallery Photos — R5 each">
            <p>
              Direct photo uploads to your salon gallery are <strong>R5 per image</strong> to cover storage
              costs. Connecting your Instagram is free and syncs your gallery automatically — most partners use
              this instead of paying per photo.
            </p>
          </Section>

          <Section title="Payouts">
            <p>Everything you earn — from bookings, product sales, or Umuhle&apos;s own commission-free transfers — follows the same payout terms:</p>
            <div className="mt-2 divide-y divide-[#f0eaf7] rounded-2xl border border-[#f0eaf7] px-4">
              <Row label="Hold period" value="2 business days" sub="From completed booking or delivered order" />
              <Row label="Payout days" value="Mon · Wed · Fri" sub="Available balance pays out automatically" />
              <Row label="Minimum withdrawal" value="R100" />
            </div>
          </Section>

          <Section title="Referral Rewards — Earn, Don&apos;t Pay">
            <p>
              Refer a beauty professional and earn <strong>R10</strong> once they pay to list their first
              product — no cap on referrals. This is money Umuhle pays <em>you</em>, not a fee. See{" "}
              <Link href="/earn" className="text-[#9b7fb8] underline">how referrals work</Link> for the full breakdown.
            </p>
          </Section>

          <Section title="Everything at a Glance">
            <div className="divide-y divide-[#f0eaf7] rounded-2xl border border-[#f0eaf7] px-4">
              <Row label="Browsing, booking, buying" value="Free" />
              <Row label="Product listing" value="From R20" sub="1–10 products per package, minimum 6 weeks each" />
              <Row label="Commission on sales &amp; bookings" value="5.5%" sub="Only charged when something actually sells" />
              <Row label="Salon listing" value="R35 / year" sub="Optional" />
              <Row label="Salon gallery photo" value="R5 each" sub="Free via Instagram sync" />
              <Row label="Returns" value="Free" />
              <Row label="Minimum withdrawal" value="R100" />
            </div>
          </Section>

          <Section title="Questions">
            <p>
              If anything here is unclear, reach out at{" "}
              <a href="mailto:info@umuhle.co.za" className="text-[#9b7fb8] underline">info@umuhle.co.za</a> —
              we&apos;re happy to walk through how fees apply to your specific situation.
            </p>
          </Section>

        </div>
      </main>
      <Footer />
    </div>
  );
}
