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
          <p className="mt-2 text-sm text-slate-400">Last updated: August 2026</p>
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

          <Section title="Listing a Product — Free">
            <p>
              To keep the shop genuine and reviewed, every product listing runs on a simple package price.
              Buying a package with more than one product slot means the rest are banked on your account — use
              them on other products any time, at no extra charge. There&apos;s no separate &ldquo;advertising&rdquo;
              fee on top — listing a product is what promotes it.
            </p>
          </Section>

          <Section title="Selling a Product — R5 or 10% Service Fee">
            <p>
              Separate from the listing fee, Umuhle takes a service fee on the sale price whenever a product
              actually sells: a flat R5, or 10% of the price — whichever is
              higher. In practice that&apos;s a flat R5 on anything up to R50, and 10% above that. 
              Products must be priced at R35 or more.
            </p>
          </Section>

          <Section title="Bookings (Artists) — R5 or 10% Service Fee">
            <p>
              The same service fee — a flat R5, or 10% of the price, whichever
              is higher — applies to completed bookings; you keep the rest, credited to your wallet automatically
              once the booking is marked complete. There&apos;s no fee to create a profile or list your services.
              Services must be priced at R35 or more.
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
              <Row label="Service fee on sales &amp; bookings" value="R5 or 10%" sub="Whichever is higher — only charged when something actually sells" />
              <Row label="Minimum product/service price" value="R35" />
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
