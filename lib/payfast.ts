// lib/payfast.ts
import crypto from "crypto";

const IS_SANDBOX = process.env.PAYFAST_ENV !== "live";

export const PAYFAST_URL = IS_SANDBOX
  ? "https://sandbox.payfast.co.za/eng/process"
  : "https://www.payfast.co.za/eng/process";

export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function generateSignature(
  params: Record<string, string>,
  passphrase?: string
): string {
  // PayFast computes its signature from fields in the order they appear in the
  // submitted form — do NOT sort. Keep insertion order (Object.keys preserves it
  // in all modern JS engines) and only strip empty / signature keys.
  const filtered = Object.keys(params).filter(
    (key) =>
      key !== "signature" &&
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ""
  );

  const data = filtered
    .map((key) => {
      const value = params[key];

      return (
        `${key}=` +
        encodeURIComponent(value)
          .replace(/!/g, "%21")
          .replace(/'/g, "%27")
          .replace(/\(/g, "%28")
          .replace(/\)/g, "%29")
          .replace(/\*/g, "%2A")
          .replace(/%20/g, "+")
      );
    })
    .join("&");

  const signatureString = passphrase
    ? `${data}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`
    : data;

  console.log("Signature string:");
  console.log(signatureString);

  console.log("Signature:");
  console.log(
    crypto
        .createHash("md5")
        .update(signatureString)
        .digest("hex")
  );

  return crypto
    .createHash("md5")
    .update(signatureString)
    .digest("hex");
}

export function buildPaymentParams(options: {
  paymentId: string;
  amount: number; // cents
  itemName: string;
  itemDescription?: string;
  firstName: string;
  lastName: string;
  email: string;
  baseUrl: string;
  customStr1?: string; // payment_type: "booking"|"order"|"ad"|"salon"
  customStr2?: string; // extra reference
}): Record<string, string> {
  const params: Record<string, string> = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID!,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY!,
    return_url: `${options.baseUrl}/payment/success?ref=${options.paymentId}`,
    cancel_url: `${options.baseUrl}/payment/cancelled?ref=${options.paymentId}`,
    notify_url: `${options.baseUrl}/api/payfast/notify`,
    name_first: options.firstName,
    name_last: options.lastName,
    email_address: options.email,
    m_payment_id: options.paymentId,
    amount: formatAmount(options.amount),
    item_name: options.itemName,
    ...(options.itemDescription ? { item_description: options.itemDescription } : {}),
    ...(options.customStr1 ? { custom_str1: options.customStr1 } : {}),
    ...(options.customStr2 ? { custom_str2: options.customStr2 } : {}),
  };

  params.signature = generateSignature(params, process.env.PAYFAST_PASSPHRASE);
  return params;
}

export async function validateITN(
  payload: Record<string, string>
): Promise<boolean> {
  const { signature, ...rest } = payload;
  const expected = generateSignature(rest, process.env.PAYFAST_PASSPHRASE);
  if (expected !== signature) {
    console.error("PayFast ITN: signature mismatch");
    return false;
  }

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

    return (await res.text()).trim() === "VALID";
  } catch (err) {
    console.error("PayFast ITN validate error:", err);
    return false;
  }
}