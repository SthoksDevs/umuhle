import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border border-[#e8e0f0] bg-white p-6 shadow-sm">
    <h2 className="mb-3 text-xl font-medium text-[#9b7fb8]">{title}</h2>
    <div className="space-y-3 text-slate-700">{children}</div>
  </section>
);

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f4eff8_0%,#ffffff_60%)]" style={{ display: "flex", flexDirection: "column" }}>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-12" style={{ flex: 1 }}>
        <Link href="/" className="text-sm text-[#9b7fb8]">← Back to Umuhle</Link>

        <div className="mt-8 mb-10">
          <h1 style={{fontFamily:"Raleway, sans-serif",fontWeight:300,textTransform:"lowercase"}} className="text-5xl text-[#9b7fb8]">
            terms & conditions
          </h1>
          <p className="mt-3 text-slate-600">Last updated: August 2026</p>
        </div>

        <div className="space-y-6">
          <Section title="Platform">
            <p>Umuhle is a marketplace connecting customers, artists, partners and salons. Artists and partners operate independently and are not employees or agents of Umuhle. They're responsible for the services and products they offer; Umuhle's role is discovery, communication, payments and platform-level support. See <Link href="/how-it-works" className="text-[#9b7fb8] underline">how Umuhle works</Link> for a fuller breakdown of who's responsible for what.</p>
          </Section>

          <Section title="Eligibility">
            <p>You must be at least 18 years old to create an account, make a booking or purchase a product through Umuhle. A beauty service for someone under 18 may only go ahead where it's lawful to do so and with the knowledge and consent of a parent or legal guardian.</p>
          </Section>

          <Section title="Accounts">
            <p>A single account may act as a customer, artist, partner and referrer. Users are responsible for maintaining account security and accurate information.</p>
          </Section>

          <Section title="Bookings">
            <p>Booking arrangements are made between customers and artists. Umuhle facilitates discovery, communication and payments but is not a party to the underlying service agreement.</p>
          </Section>

          <Section title="Cancellations and No-Shows">
            <p>Customers and artists are both expected to honour confirmed bookings. If a booking needs to be cancelled or rescheduled, please give as much notice as you reasonably can so the other party isn't left out of pocket or out of time. Repeated late cancellations or no-shows — by a customer or an artist — may affect standing on the platform, and in serious or repeated cases may limit someone's ability to keep booking or accepting bookings through Umuhle.</p>
          </Section>

          <Section title="Health and Safety">
            <p>Beauty treatments can carry real risks, including allergic reactions, skin irritation, infection or other adverse outcomes. Please tell your artist or salon about any relevant allergies, sensitivities or medical conditions before a treatment begins, and ask about a patch test if you're trying a new product or service for the first time. Umuhle does not provide beauty services itself and can't guarantee the outcome of any treatment booked through the platform.</p>
          </Section>

          <Section title="Verification and Qualifications">
            <p>Umuhle may ask an artist, partner or salon to provide proof of identity, business registration, or relevant qualifications, certifications or licensing. A listing may be limited, suspended or removed where requested verification isn't provided, or where information provided turns out to be false or misleading.</p>
          </Section>

          <Section title="Products, Listings and Salon Subscriptions">
            <p>Partners are responsible for product accuracy, pricing, fulfilment, stock availability and compliance with applicable laws. Every product listing requires payment of a listing package before it appears in the shop; listing and salon subscription fees increase visibility for the paid duration but do not guarantee impressions, enquiries, bookings, sales or revenue.</p>
          </Section>

          <Section title="Disputes and Refunds">
            <p>If something goes wrong with a booking or an order, please raise it with us within 7 days of the appointment or delivery so we can look into it while the details are still fresh. We'll typically ask the other party to respond, review whatever evidence is reasonably available — photos, messages, booking or payment records — and let you know the outcome. Product returns follow the separate returns policy described on our <Link href="/fees" className="text-[#9b7fb8] underline">fees page</Link>; this section covers bookings and disputes more generally.</p>
          </Section>

          <Section title="Referral Programme">
            <p>Referral rewards become payable only when a referred partner successfully pays for their first qualifying product listing. The current reward and withdrawal thresholds may be updated by Umuhle from time to time.</p>
          </Section>

          <Section title="Reviews and Content">
            <p>Users may leave reviews based on genuine experiences. Fraudulent, misleading, abusive, harassing or clearly irrelevant content may be removed.</p>
          </Section>

          <Section title="Messaging and Off-Platform Transactions">
            <p>Any messaging or contact features on Umuhle are there to help coordinate a booking or order made through the platform. Please don't use them to arrange a transaction specifically to avoid Umuhle's fees — doing so undermines the payment protection, dispute support and review system that come with booking through the platform, and may affect account standing.</p>
          </Section>

          <Section title="Account Suspension and Termination">
            <p>Umuhle may suspend, restrict or terminate an account, listing or salon subscription where reasonably necessary — for example, fraud, chargeback abuse, repeated no-shows or late cancellations, harassment, fake reviews, misrepresented qualifications, unsafe practices, circumventing platform fees, or to comply with a legal obligation. Where practical we'll explain why, but we may act without advance notice where we reasonably believe it's necessary to protect the platform or its users.</p>
          </Section>

          <Section title="Limitation of Liability">
            <p>To the maximum extent permitted by law, Umuhle shall not be liable for losses arising from bookings, products, partner conduct, service interruptions or third-party systems.</p>
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
