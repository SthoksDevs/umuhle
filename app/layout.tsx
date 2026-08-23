// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import CookieConsent from "@/components/CookieConsent";

export const metadata: Metadata = {
  title: "Umuhle — You are beautiful",
  description: "Book hair stylists, nail technicians, and makeup artists near you.",
  icons: {
    icon: "/favicon.ico",
    apple: "/umuhle-icon.png",
  },
  openGraph: {
    title: "Umuhle — You are beautiful",
    description: "Book beauty artists near you.",
    url: "https://umuhle.co.za",
    siteName: "Umuhle",
    type: "website",
    images: [{ url: "https://umuhle.co.za/umuhle-icon.png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#9B7FB8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* GTM, GA, Meta Pixel, and TikTok Pixel now live in
            components/CookieConsent.tsx, gated behind Accept — see that
            file. */}

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <CookieConsent />
      </body>
    </html>
  );
}
