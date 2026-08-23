// components/CookieConsent.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";

const STORAGE_KEY = "umuhle_cookie_consent";
type ConsentStatus = "accepted" | "rejected";

export default function CookieConsent() {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  // Distinguishes "haven't checked localStorage yet" from "checked, found
  // no prior decision" — without this the banner would flash on then off
  // for anyone who already accepted/rejected on a previous visit.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "accepted" || stored === "rejected") setStatus(stored);
    } catch {
      // localStorage unavailable (privacy mode etc.) — treat as undecided;
      // the banner will show but Accept/Reject just won't persist.
    } finally {
      setChecked(true);
    }
  }, []);

  const decide = (next: ConsentStatus) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — worst case it asks again next visit
    }
    setStatus(next);
  };

  return (
    <>
      {/* Functional cookies (auth session, cart) run regardless of the
          choice below — they're required for the site to work and aren't
          gated here. Only the analytics/marketing trackers wait on
          "accepted". */}
      {status === "accepted" && (
        <>
          {/* Google Tag Manager */}
          <Script
            id="gtm-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-MMHDNZHQ');`,
            }}
          />
          <noscript>
            <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-MMHDNZHQ" height="0" width="0" style={{ display: "none", visibility: "hidden" }} />
          </noscript>

          {/* Google Analytics */}
          <Script src="https://www.googletagmanager.com/gtag/js?id=G-95TVSZRYMT" strategy="afterInteractive" />
          <Script
            id="ga-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-95TVSZRYMT');`,
            }}
          />

          {/* Meta Pixel */}
          <Script
            id="meta-pixel-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','2504347420018174');fbq('track','PageView');`,
            }}
          />
          <noscript>
            <img height="1" width="1" style={{ display: "none" }} src="https://www.facebook.com/tr?id=2504347420018174&ev=PageView&noscript=1" alt="" />
          </noscript>

          {/* TikTok Pixel */}
          <Script
            id="tiktok-pixel-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load('D8RFGBJC77U2RT853VQ0');ttq.page()}(window,document,'ttq');`,
            }}
          />
        </>
      )}

      {checked && status === null && (
        <div
          role="dialog"
          aria-label="Cookie notice"
          style={{
            position: "fixed",
            right: "1.25rem",
            bottom: "1.25rem",
            zIndex: 1000,
            width: 300,
            maxWidth: "calc(100vw - 2.5rem)",
            background: "#fff",
            border: "1.5px solid rgba(155,127,184,0.25)",
            borderRadius: 16,
            boxShadow: "0 8px 30px rgba(26,26,26,0.12)",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--onyx)", lineHeight: 1.5 }}>
            We use functional cookies to run Umuhle, and — with your permission — analytics cookies to
            understand how the site is used.{" "}
            <Link href="/privacy-policy" style={{ color: "var(--plum)", textDecoration: "underline" }}>
              Learn more
            </Link>
            .
          </p>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              onClick={() => decide("accepted")}
              className="btn-plum"
              style={{ flex: 1, padding: "0.6rem 0.5rem", fontSize: "0.85rem" }}
            >
              Accept
            </button>
            <button
              onClick={() => decide("rejected")}
              className="btn-outline"
              style={{ flex: 1, padding: "0.6rem 0.5rem", fontSize: "0.85rem" }}
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </>
  );
}
