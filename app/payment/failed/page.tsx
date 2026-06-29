import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

export default function PaymentFailedPage() {
  return (
    <>
      <SiteHeader />

      <main
        style={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4rem 1.5rem",
          background: "#faf8fc",
        }}
      >
        <div
          style={{
            maxWidth: 620,
            width: "100%",
            background: "#fff",
            padding: "3rem",
            borderRadius: 20,
            boxShadow: "0 10px 40px rgba(0,0,0,.06)",
            textAlign: "center",
          }}
        >

          <h1
            style={{
              marginTop: "1rem",
              color: "var(--plum)",
              fontFamily: "var(--font-display)",
            }}
          >
            Payment Failed!
          </h1>

          <p style={{ marginTop: "1rem", lineHeight: 1.8 }}>
            Unfortunately your payment could not be processed.
            <br />
            No money has been captured.
          </p>

          <div
            style={{
              display: "flex",
              gap: "1rem",
              justifyContent: "center",
              marginTop: "2rem",
              flexWrap: "wrap",
            }}
          >
            <Link href="/" className="btn-primary">
              Return Home
            </Link>

            <Link href="/checkout">
              Try Again
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}