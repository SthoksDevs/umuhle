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

  const hash = crypto
    .createHash("md5")
    .update(signatureString)
    .digest("hex");

  console.log("[generateSignature] Field order used:", filtered.join(", "));
  console.log("[generateSignature] Signature string:", signatureString);
  console.log("[generateSignature] Passphrase included:", Boolean(passphrase));
  console.log("[generateSignature] Resulting MD5 hash:", hash);

  return hash;
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
  console.log("[PayFast ITN] ── Raw payload received ──");
  console.log(JSON.stringify(payload, null, 2));
  console.log("[PayFast ITN] Field order (as received):", Object.keys(payload).join(", "));

  const { signature, ...rest } = payload;
  console.log("[PayFast ITN] Submitted signature:", signature);

  const passphrase = process.env.PAYFAST_PASSPHRASE;
  console.log("[PayFast ITN] Passphrase is set:", Boolean(passphrase), passphrase ? `(length ${passphrase.length})` : "");
  console.log("[PayFast ITN] PAYFAST_ENV:", process.env.PAYFAST_ENV, "| IS_SANDBOX:", IS_SANDBOX);
  console.log("[PayFast ITN] merchant_id in payload:", payload.merchant_id, "| env PAYFAST_MERCHANT_ID set:", Boolean(process.env.PAYFAST_MERCHANT_ID));

  const expected = generateSignature(rest, passphrase);
  console.log("[PayFast ITN] Expected signature:", expected);
  console.log("[PayFast ITN] Signatures match:", expected === signature);

  if (expected !== signature) {
    console.error("[PayFast ITN] ❌ LOCAL signature mismatch — payload was likely tampered with, OR passphrase / encoding differs from what PayFast used to sign.");
    return false;
  }
  console.log("[PayFast ITN] ✅ Local signature check passed. Proceeding to remote PayFast validation...");

  const validateUrl = IS_SANDBOX
    ? "https://sandbox.payfast.co.za/eng/query/validate"
    : "https://www.payfast.co.za/eng/query/validate";
  console.log("[PayFast ITN] Validating against:", validateUrl);

  try {
    const body = Object.entries(payload)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const res = await fetch(validateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const responseText = (await res.text()).trim();
    console.log("[PayFast ITN] Remote validate HTTP status:", res.status);
    console.log("[PayFast ITN] Remote validate response body:", responseText);

    const isValid = responseText === "VALID";
    console.log("[PayFast ITN]", isValid ? "✅ Remote validation passed" : "❌ Remote validation FAILED");
    return isValid;
  } catch (err) {
    console.error("[PayFast ITN] Remote validate request error:", err);
    return false;
  }
}