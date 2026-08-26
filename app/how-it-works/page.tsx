import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border border-[#e8e0f0] bg-white p-6 shadow-sm">
    <h2 className="mb-3 text-xl font-medium text-[#9b7fb8]">{title}</h2>
    <div className="space-y-3 text-slate-700">{children}</div>
  </section>
);

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f4eff8_0%,#ffffff_60%)]" style={{ display: "flex", flexDirection: "column" }}>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-12" style={{ flex: 1 }}>
        <Link href="/" className="text-sm text-[#9b7fb8]">← Back to Umuhle</Link>

        <div className="mt-8 mb-10">
          <h1 style={{fontFamily:"Raleway, sans-serif",fontWeight:300,textTransform:"lowercase"}} className="text-5xl text-[#9b7fb8]">
            how umuhle works
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            A plain-language summary of who's responsible for what. Our full{" "}
            <Link href="/terms-and-conditions" className="text-[#9b7fb8] underline">Terms &amp; Conditions</Link>{" "}
            are the governing document — this page is here so it's easy to understand before you book,
            buy or list.
          </p>
        </div>

        <div className="space-y-6">
          <Section title="Umuhle is a marketplace, not a service provider">
            <p>Umuhle connects customers with independent beauty artists, salons and business partners. It doesn't employ them, train them or supervise their work. The person or salon you book with is responsible for actually delivering the service or product you paid for.</p>
          </Section>

          <Section title="For customers">
            <p>Browsing, booking and buying on Umuhle is free — you only pay the price the artist or partner sets, plus delivery where that applies. Payments go through Umuhle's payment system, which holds funds briefly and releases them to the artist or partner once a booking is complete or an order is delivered.</p>
            <p>Umuhle can help if a booking or order goes wrong — see <Link href="/terms-and-conditions" className="text-[#9b7fb8] underline">Disputes and Refunds</Link> in our Terms — but we're not the ones providing the beauty service itself, so we can't personally guarantee how a treatment turns out.</p>
          </Section>

          <Section title="For artists, partners and salons">
            <p>By listing on Umuhle, you're taking on responsibility for actually delivering what you've listed, honouring confirmed bookings, and complying with whatever laws, licensing or health and safety standards apply to your trade — including holding your own insurance where that's appropriate for your work.</p>
            <p>Umuhle deducts its platform fees automatically from completed bookings and sales — see the <Link href="/fees" className="text-[#9b7fb8] underline">Fees page</Link> for the current rates, since these can change and we'd rather point you to one place that's always up to date than repeat numbers here that go stale.</p>
          </Section>

          <Section title="Trust and safety, briefly">
            <p>We may ask artists and partners to verify who they are and what they're qualified to do, we expect reviews to reflect genuine experiences, and we ask everyone to disclose relevant health information (allergies, sensitivities) before a treatment. The full detail on all of this — along with cancellations, account suspension, and how disputes get resolved — lives in our <Link href="/terms-and-conditions" className="text-[#9b7fb8] underline">Terms &amp; Conditions</Link>.</p>
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
