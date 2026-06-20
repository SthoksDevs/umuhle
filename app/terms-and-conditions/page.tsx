import Link from "next/link";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border border-[#e8e0f0] bg-white p-6 shadow-sm">
    <h2 className="mb-3 text-xl font-medium text-[#9b7fb8]">{title}</h2>
    <div className="space-y-3 text-slate-700">{children}</div>
  </section>
);

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f4eff8_0%,#ffffff_60%)]">
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Link href="/" className="text-sm text-[#9b7fb8]">← Back to Umuhle</Link>

        <div className="mt-8 mb-10">
          <h1 style={{fontFamily:"Raleway, sans-serif",fontWeight:300,textTransform:"lowercase"}} className="text-5xl text-[#9b7fb8]">
            terms & conditions
          </h1>
          <p className="mt-3 text-slate-600">Last updated: June 2026</p>
        </div>

        <div className="space-y-6">
          <Section title="Platform">
            <p>Umuhle is a marketplace connecting customers, artists, partners and salons. Artists and partners operate independently and are not employees or agents of Umuhle.</p>
          </Section>

          <Section title="Accounts">
            <p>A single account may act as a customer, artist, partner and referrer. Users are responsible for maintaining account security and accurate information.</p>
          </Section>

          <Section title="Bookings">
            <p>Booking arrangements are made between customers and artists. Umuhle facilitates discovery, communication and payments but is not a party to the underlying service agreement.</p>
          </Section>

          <Section title="Products and Orders">
            <p>Partners are responsible for product accuracy, pricing, fulfilment, stock availability and compliance with applicable laws.</p>
          </Section>

          <Section title="Advertisements and Salon Subscriptions">
            <p>Advertisement purchases and salon subscriptions increase visibility but do not guarantee impressions, enquiries, bookings, sales or revenue.</p>
          </Section>

          <Section title="Referral Programme">
            <p>Referral rewards become payable only when a referred partner successfully purchases and pays for their first qualifying advertisement. The current reward and withdrawal thresholds may be updated by Umuhle from time to time.</p>
          </Section>

          <Section title="Reviews and Content">
            <p>Users may leave reviews based on genuine experiences. Fraudulent, misleading, abusive or unlawful content may be removed.</p>
          </Section>

          <Section title="Suspensions">
            <p>Umuhle may suspend or restrict users, products, advertisements, salons or listings where necessary to protect platform integrity, investigate abuse or comply with legal obligations.</p>
          </Section>

          <Section title="Limitation of Liability">
            <p>To the maximum extent permitted by law, Umuhle shall not be liable for losses arising from bookings, products, advertisements, partner conduct, service interruptions or third-party systems.</p>
          </Section>
        </div>
      </main>
    </div>
  );
}
