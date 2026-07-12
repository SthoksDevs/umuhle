// lib/happypay.ts
// HappyPay (https://happypay.co.za) Buy-Now-Pay-Later integration.
// API reference: https://widgets.happypay.co.za/api.htm
//
// HappyPay's flow mirrors PayFast's redirect model: we create an order
// server-side, the response gives us a URL to send the shopper to, and
// HappyPay pings our webhook URLs (which we supply per-order) once the
// payment succeeds or fails.

const IS_TEST = process.env.HAPPYPAY_ENV !== "live";

export const HAPPYPAY_BASE_URL = IS_TEST
  ? "https://qa.happypay.co.za"
  : "https://happypay.co.za";

export interface HappyPayProduct {
  quantity: number;
  price: number; // major units (Rand), not cents
  name: string;
}

export interface CreateHappyPayOrderOptions {
  orderId: string; // our own order id, used as HappyPay's "id"
  totalCents: number;
  products: HappyPayProduct[];
  successWebhook: string;
  failureWebhook: string;
  successReturnUrl: string;
  failReturnUrl: string;
}

export interface HappyPayOrderResult {
  success: boolean;
  redirectUrl?: string;
  happyPayOrderId?: string;
  errorMessage?: string;
}

function formatRand(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Creates a HappyPay order and returns the URL to redirect the shopper to
 * so they can complete the BNPL application/checkout on HappyPay's side.
 */
export async function createHappyPayOrder(
  opts: CreateHappyPayOrderOptions
): Promise<HappyPayOrderResult> {
  const merchantId = process.env.HAPPYPAY_MERCHANT_ID;
  const apiKey = process.env.HAPPYPAY_API_KEY;

  if (!merchantId || !apiKey) {
    console.error("HappyPay: missing HAPPYPAY_MERCHANT_ID / HAPPYPAY_API_KEY env vars");
    return { success: false, errorMessage: "HappyPay is not configured" };
  }

  const body = {
    id: opts.orderId,
    APIKey: apiKey,
    total: formatRand(opts.totalCents),
    products: opts.products.map((p) => ({
      quantity: p.quantity,
      price: Number(p.price.toFixed(2)),
      name: p.name,
    })),
    currency: "ZAR",
    successWebhook: opts.successWebhook,
    failureWebhook: opts.failureWebhook,
    successReturnUrl: opts.successReturnUrl,
    failReturnUrl: opts.failReturnUrl,
    merchantId,
    test: IS_TEST,
  };

  try {
    const res = await fetch(`${HAPPYPAY_BASE_URL}/api/ServicesV1.asmx/createOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    const result = json?.d;

    if (!result?.success) {
      return { success: false, errorMessage: result?.errorMessage ?? "HappyPay declined to create the order" };
    }

    return {
      success: true,
      redirectUrl: result.redirectUrl,
      happyPayOrderId: result.orderId,
    };
  } catch (err) {
    console.error("HappyPay createOrder error:", err);
    return { success: false, errorMessage: "Could not reach HappyPay" };
  }
}

export async function createHappyPayRefund(opts: {
  orderId: string; // HappyPay's own orderId from createOrder
  totalCents: number;
  reason: string;
}): Promise<{ success: boolean; errorMessage?: string }> {
  const merchantId = process.env.HAPPYPAY_MERCHANT_ID;
  const apiKey = process.env.HAPPYPAY_API_KEY;
  if (!merchantId || !apiKey) {
    return { success: false, errorMessage: "HappyPay is not configured" };
  }

  try {
    const res = await fetch(`${HAPPYPAY_BASE_URL}/api/ServicesV1.asmx/createRefund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId,
        APIKey: apiKey,
        orderId: opts.orderId,
        total: formatRand(opts.totalCents),
        reason: opts.reason,
      }),
    });
    const json = await res.json();
    const result = json?.d;
    if (!result?.Success) {
      return { success: false, errorMessage: result?.ErrorMessage ?? "Refund failed" };
    }
    return { success: true };
  } catch (err) {
    console.error("HappyPay createRefund error:", err);
    return { success: false, errorMessage: "Could not reach HappyPay" };
  }
}