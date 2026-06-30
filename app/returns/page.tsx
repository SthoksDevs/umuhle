import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border border-[#e8e0f0] bg-white p-6 shadow-sm">
    <h2 className="mb-3 text-xl font-medium text-[#9b7fb8]">{title}</h2>
    <div className="space-y-3 text-slate-700">{children}</div>
  </section>
);

export default function ReturnsPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f4eff8_0%,#ffffff_60%)]" style={{ display: "flex", flexDirection: "column" }}>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-12" style={{ flex: 1 }}>
        <Link href="/" className="text-sm text-[#9b7fb8]">← Back to Umuhle</Link>

        <div className="mt-8 mb-10">
          <h1 style={{fontFamily:"Raleway, sans-serif",fontWeight:300,textTransform:"lowercase"}} className="text-5xl text-[#9b7fb8]">
            returns policy
          </h1>
          <p className="mt-3 text-slate-600">Last updated: June 2026</p>
        </div>

        <div className="space-y-6">
          <Section title="Where This Policy Applies">
            <p>This returns policy applies to orders placed on umuhle.co.za and delivered within South Africa.</p>
          </Section>

          <Section title="What Can Be Returned">
            <p>We accept returns on both defective and non-defective products. If an item arrives faulty, damaged or not as described, or if you simply change your mind, you may return it under the terms below.</p>
            <p>Returned items must be in new condition — unused, unworn, unwashed and in their original packaging with all tags and accessories included. We are unable to accept items that show signs of use, damage caused after delivery, or missing packaging or accessories, except where the item was faulty or incorrect on arrival.</p>
          </Section>

          <Section title="Return Window">
            <p>You have 7 days from the date your order is delivered to request a return. Requests made after this window cannot be accepted.</p>
          </Section>

          <Section title="Exchanges">
            <p>We do not offer direct exchanges. If you'd like a different size, colour or product, please return the original item for a refund and place a new order.</p>
          </Section>

          <Section title="How To Return An Item">
            <p>To start a return, contact us at <a href="mailto:info@umuhle.co.za" className="text-[#9b7fb8]">info@umuhle.co.za</a> within 7 days of delivery with your order reference and the reason for the return. We'll confirm your return and arrange collection.</p>
            <p>Returns can be made by mail or by dropping the item off at a designated drop-off location. A prepaid return label is included with every order at no cost to you — simply attach it to the package for your return shipment.</p>
          </Section>

          <Section title="Fees">
            <p>Returns are free of charge. We do not charge a restocking fee, and the return shipping label is provided to you at no cost.</p>
          </Section>

          <Section title="Refunds">
            <p>Once your returned item is received and inspected, refunds are processed within 7 days. Refunds are issued to your original payment method.</p>
          </Section>

          <Section title="Questions">
            <p>If you have any questions about a return or this policy, reach out to us at <a href="mailto:info@umuhle.co.za" className="text-[#9b7fb8]">info@umuhle.co.za</a>.</p>
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
