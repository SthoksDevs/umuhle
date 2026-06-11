// lib/payfast.ts
import crypto from "crypto";

const IS_SANDBOX = process.env.PAYFAST_ENV !== "live";

export const PAYFAST_URL = IS_SANDBOX
  ? "https://sandbox.payfast.co.za/eng/process"
  : "https://www.payfast.co.za/eng/process";

/** Format amount as "150.00" string required by PayFast */
export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Generate the MD5 signature PayFast requires.
 * All params must be sorted alphabetically, empty values excluded.
 */
export function generateSignature(
  params: Record<string, string>,
  passphrase?: string
): string {
  const sorted = Object.keys(params)
    .sort()
    .filter((k) => k !== "signature" && params[k] !== "");

  let str = sorted
    .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`)
    .join("&");

  if (passphrase) {
    str += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  }

  return crypto.createHash("md5").update(str).digest("hex");
}

/**
 * Build the full PayFast payment parameter object (including signature).
 * `amount` should be in ZAR cents.
 */
export function buildPaymentParams(options: {
  paymentId: string;
  amount: number; // cents
  itemName: string;
  itemDescription?: string;
  firstName: string;
  lastName: string;
  email: string;
  baseUrl: string;
}): Record<string, string> {
  const params: Record<string, string> = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID!,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY!,
    return_url: `${options.baseUrl}/payment/success?ref=${options.paymentId}`,
    cancel_url: `${options.baseUrl}/payment/cancel?ref=${options.paymentId}`,
    notify_url: `${options.baseUrl}/api/payfast/notify`,
    name_first: options.firstName,
    name_last: options.lastName,
    email_address: options.email,
    m_payment_id: options.paymentId,
    amount: formatAmount(options.amount),
    item_name: options.itemName,
    ...(options.itemDescription
      ? { item_description: options.itemDescription }
      : {}),
  };

  params.signature = generateSignature(
    params,
    process.env.PAYFAST_PASSPHRASE
  );

  return params;
}

/** Validate PayFast ITN (Instant Transaction Notification / webhook) */
export async function validateITN(
  payload: Record<string, string>
): Promise<boolean> {
  // 1. Verify signature
  const { signature, ...rest } = payload;
  const expected = generateSignature(rest, process.env.PAYFAST_PASSPHRASE);
  if (expected !== signature) {
    console.error("PayFast ITN: signature mismatch");
    return false;
  }

  // 2. Confirm with PayFast server
  const validateUrl = IS_SANDBOX
    ? "https://sandbox.payfast.co.za/eng/query/validate"
    : "https://www.payfast.co.za/eng/query/validate";

  try {
    const body = Object.entries(payload)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const res = await fetch(validateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const text = await res.text();
    return text.trim() === "VALID";
  } catch (err) {
    console.error("PayFast ITN validate error:", err);
    return false;
  }
}
