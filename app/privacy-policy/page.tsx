import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border border-[#e8e0f0] bg-white p-6 shadow-sm">
    <h2 className="mb-3 text-xl font-medium text-[#9b7fb8]">{title}</h2>
    <div className="space-y-3 text-slate-700">{children}</div>
  </section>
);

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f4eff8_0%,#ffffff_60%)]" style={{ display: "flex", flexDirection: "column" }}>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-12" style={{ flex: 1 }}>
        <Link href="/" className="text-sm text-[#9b7fb8]">← Back to Umuhle</Link>

        <div className="mt-8 mb-10">
          <h1 style={{fontFamily:"Raleway, sans-serif",fontWeight:300,textTransform:"lowercase"}} className="text-5xl text-[#9b7fb8]">
            privacy policy
          </h1>
          <p className="mt-3 text-slate-600">Last updated: June 2026</p>
        </div>

        <div className="space-y-6">
          <Section title="Who We Are">
            <p>Umuhle is a South African beauty marketplace that connects customers with beauty professionals, business partners, products, salons and advertising opportunities.</p>
            <p>Umuhle is operated by Umuhle You Are Beautiful (Pty) Ltd. "Umuhle" is the trading brand of "Umuhle You Are Beautiful (Pty) Ltd."</p>
            <p>Registration Number: 2026/458231/07</p>
          </Section>

          <Section title="Information We Collect">
            <p>We may collect account information, profile information, booking information, referral information, wallet and withdrawal records, product orders, salon listings, advertisements, reviews, messages, device information and location information.</p>
          </Section>

          <Section title="How We Use Information">
            <p>We use information to provide bookings, ecommerce services, referrals, payments, advertisements, salon discovery, customer support, fraud prevention, analytics, platform improvement and legal compliance.</p>
          </Section>

          <Section title="Bookings and WhatsApp Communications">
            <p>By using Umuhle you consent to receiving booking confirmations, reminders, appointment updates and related service notifications through WhatsApp, email or other supported channels.</p>
          </Section>

          <Section title="Analytics and Tracking">
            <p>Umuhle may use Google Analytics, Google Tag Manager, Meta Pixel and TikTok Pixel to understand platform usage and improve services.</p>
          </Section>

          <Section title="Automated Moderation">
            <p>Advertisements, products, salon listings, reviews and other user content may be reviewed by automated systems, including artificial intelligence tools, and may be limited, rejected or escalated for review.</p>
          </Section>

          <Section title="Sharing Information">
            <p>We do not sell personal information. Information may be shared with artists, partners, payment providers, hosting providers, analytics providers and authorities where legally required.</p>
          </Section>

          <Section title="POPIA Rights">
            <p>Subject to applicable law, you may request access to, correction of or deletion of personal information held by Umuhle.</p>
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}