// components/GooglePayButton.tsx
"use client";

import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Google Pay — test-mode integration.
//
// Umuhle hasn't signed up for a production Google Pay/Wallet merchant
// account yet, so this uses Google's published "example" gateway, which is
// designed for exactly this situation: it lets you build and test the full
// button + tokenization flow with no live gateway and no real money moving.
// See: https://developers.google.com/pay/api/web/guides/tutorial
//
// To go live later:
//   1. Sign up at https://pay.google.com/business/console
//   2. Get a real merchantId and connect a payment gateway that supports
//      Google Pay token decryption (e.g. Peach Payments, Adumo, Stripe —
//      PayFast does not currently support Google Pay tokens directly).
//   3. Set NEXT_PUBLIC_GOOGLE_PAY_ENV=PRODUCTION and swap the
//      tokenizationSpecification gateway/gatewayMerchantId below for the
//      ones your chosen gateway gives you.
// ─────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    google?: {
      payments: {
        api: {
          PaymentsClient: new (opts: { environment: "TEST" | "PRODUCTION" }) => GooglePaymentsClient;
        };
      };
    };
  }
}

interface GooglePaymentsClient {
  isReadyToPay: (req: object) => Promise<{ result: boolean }>;
  loadPaymentData: (req: object) => Promise<GooglePaymentData>;
  createButton: (opts: {
    onClick: () => void;
    buttonColor?: string;
    buttonType?: string;
    buttonSizeMode?: string;
  }) => HTMLElement;
}

interface GooglePaymentData {
  paymentMethodData: {
    description: string;
    tokenizationData: { type: string; token: string };
    info?: { cardNetwork?: string; cardDetails?: string };
  };
}

const BASE_CARD_PAYMENT_METHOD = {
  type: "CARD",
  parameters: {
    allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
    allowedCardNetworks: ["VISA", "MASTERCARD"],
  },
};

const GATEWAY_TOKENIZATION_SPECIFICATION = {
  type: "PAYMENT_GATEWAY",
  parameters: {
    // Google's public test gateway — safe to use before a real gateway is connected.
    gateway: "example",
    gatewayMerchantId: "exampleGatewayMerchantId",
  },
};

const CARD_PAYMENT_METHOD = {
  ...BASE_CARD_PAYMENT_METHOD,
  tokenizationSpecification: GATEWAY_TOKENIZATION_SPECIFICATION,
};

function loadGooglePayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.payments?.api) { resolve(); return; }
    const existing = document.getElementById("google-pay-js");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.id = "google-pay-js";
    script.src = "https://pay.google.com/gp/p/js/pay.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Pay"));
    document.head.appendChild(script);
  });
}

export default function GooglePayButton({
  amountCents,
  disabled,
  onPaymentAuthorized,
}: {
  amountCents: number;
  disabled?: boolean;
  onPaymentAuthorized: (token: string) => void | Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GooglePaymentsClient | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadGooglePayScript()
      .then(() => {
        if (cancelled || !window.google) return;
        const environment = (process.env.NEXT_PUBLIC_GOOGLE_PAY_ENV as "TEST" | "PRODUCTION") || "TEST";
        const client = new window.google.payments.api.PaymentsClient({ environment });
        clientRef.current = client;

        return client
          .isReadyToPay({
            apiVersion: 2,
            apiVersionMinor: 0,
            allowedPaymentMethods: [BASE_CARD_PAYMENT_METHOD],
          })
          .then((res) => {
            if (cancelled) return;
            if (res.result) setReady(true);
            else setUnavailable(true);
          });
      })
      .catch(() => { if (!cancelled) setUnavailable(true); });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || !clientRef.current) return;
    containerRef.current.innerHTML = "";

    const button = clientRef.current.createButton({
      onClick: handleClick,
      buttonColor: "black",
      buttonType: "pay",
      buttonSizeMode: "fill",
    });
    containerRef.current.appendChild(button);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, amountCents]);

  const handleClick = async () => {
    const client = clientRef.current;
    if (!client) return;

    const merchantName = process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_NAME || "Umuhle";
    const merchantId = process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID;

    try {
      const paymentData = await client.loadPaymentData({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [CARD_PAYMENT_METHOD],
        merchantInfo: {
          merchantName,
          ...(merchantId ? { merchantId } : {}),
        },
        transactionInfo: {
          totalPriceStatus: "FINAL",
          totalPrice: (amountCents / 100).toFixed(2),
          currencyCode: "ZAR",
          countryCode: "ZA",
        },
      });

      await onPaymentAuthorized(paymentData.paymentMethodData.tokenizationData.token);
    } catch (err: unknown) {
      // CANCELED is thrown when the shopper dismisses the sheet — not an error
      const statusCode = (err as { statusCode?: string })?.statusCode;
      if (statusCode !== "CANCELED") {
        console.error("Google Pay error:", err);
      }
    }
  };

  if (unavailable) {
    return (
      <p style={{ fontSize: "0.8rem", color: "var(--light)", textAlign: "center", padding: "0.75rem" }}>
        Google Pay isn&apos;t available on this device/browser.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto", minHeight: 48 }} />
      {!ready && <div style={{ height: 48, borderRadius: 8, background: "var(--plum-t)" }} />}
    </div>
  );
}