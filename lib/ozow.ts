// lib/ozow.ts
// Ozow (instant EFT) integration — "PostPaymentRequest" API.
// Docs entry point: https://oldhub.ozow.com/docs/getting-started-2
// (Ozow gates the full field reference behind merchant signup — see the
// warning above validateOzowResponse() before going live.)
//
// Flow:
//   1. We call PostPaymentRequest with a signed set of fields.
//   2. Ozow responds with { url }, which we redirect the shopper to.
//   3. The shopper pays on Ozow's hosted page.
//   4. Ozow POSTs a signed notification to our NotifyUrl (server-to-server —
//      this is the source of truth) AND redirects the shopper's browser to
//      Success/Cancel/Error with the same fields as query params (display
//      only, never trusted to flip an order to "paid").

import crypto from "crypto";

const IS_TEST = process.env.OZOW_ENV !== "live";

const OZOW_API_URL = IS_TEST
  ? "https://stagingapi.ozow.com/PostPaymentRequest"
  : "https://api.ozow.com/PostPaymentRequest";

export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Builds the HashCheck for an OUTGOING PostPaymentRequest call.
 *
 * Ozow's rule, confirmed against two independent working implementations
 * of this exact endpoint:
 *   1. Concatenate the request fields in the order below (excluding
 *      HashCheck itself).
 *   2. Append the private key.
 *   3. Lowercase the whole string.
 *   4. SHA512 it.
 *
 * Field order is fixed — do NOT reorder without re-deriving against a real
 * sandbox transaction, since it changes the hash.
 */
const REQUEST_FIELD_ORDER = [
  "SiteCode", "CountryCode", "CurrencyCode", "Amount", "TransactionReference",
  "BankReference", "CancelUrl", "ErrorUrl", "SuccessUrl", "NotifyUrl", "IsTest",
] as const;

function generateRequestHash(fields: Record<string, string>, privateKey: string): string {
  const concatenated = REQUEST_FIELD_ORDER.map((k) => fields[k] ?? "").join("");
  const hashInput = `${concatenated}${privateKey}`.toLowerCase();
  const hash = crypto.createHash("sha512").update(hashInput).digest("hex");

  console.log("[Ozow] Request hash field order:", REQUEST_FIELD_ORDER.join(", "));
  console.log("[Ozow] Request HashCheck:", hash);

  return hash;
}

export interface CreateOzowPaymentOptions {
  transactionReference: string; // our own order id
  bankReference: string;        // shows on the customer's bank statement — keep it short & alphanumeric
  amountCents: number;
  cancelUrl: string;
  errorUrl: string;
  successUrl: string;
  notifyUrl: string;
}

export interface OzowPaymentResult {
  success: boolean;
  redirectUrl?: string;
  ozowTransactionId?: string;
  errorMessage?: string;
}

export async function createOzowPaymentRequest(
  opts: CreateOzowPaymentOptions
): Promise<OzowPaymentResult> {
  const siteCode = process.env.OZOW_SITE_CODE;
  const privateKey = process.env.OZOW_PRIVATE_KEY;
  const apiKey = process.env.OZOW_API_KEY;

  if (!siteCode || !privateKey || !apiKey) {
    console.error("[Ozow] Missing OZOW_SITE_CODE / OZOW_PRIVATE_KEY / OZOW_API_KEY env vars");
    return { success: false, errorMessage: "Ozow is not configured" };
  }

  const fields: Record<string, string> = {
    SiteCode: siteCode,
    CountryCode: "ZA",
    CurrencyCode: "ZAR",
    Amount: formatAmount(opts.amountCents),
    TransactionReference: opts.transactionReference,
    BankReference: opts.bankReference.slice(0, 20),
    CancelUrl: opts.cancelUrl,
    ErrorUrl: opts.errorUrl,
    SuccessUrl: opts.successUrl,
    NotifyUrl: opts.notifyUrl,
    IsTest: IS_TEST ? "true" : "false",
  };

  const hashCheck = generateRequestHash(fields, privateKey);

  console.log("[Ozow] PostPaymentRequest fields:", JSON.stringify(fields, null, 2));
  console.log("[Ozow] Calling:", OZOW_API_URL, "| IS_TEST:", IS_TEST);

  try {
    const res = await fetch(OZOW_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        ApiKey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...fields, HashCheck: hashCheck }),
    });

    const text = await res.text();
    console.log("[Ozow] PostPaymentRequest HTTP status:", res.status);
    console.log("[Ozow] PostPaymentRequest raw response:", text);

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        success: false,
        errorMessage: `Ozow returned a non-JSON response (status ${res.status})`,
      };
    }

    if (json.errorMessage) {
      console.error("[Ozow] PostPaymentRequest error:", json.errorMessage);
      return { success: false, errorMessage: String(json.errorMessage) };
    }

    const url = json.url as string | undefined;
    if (!url) {
      return { success: false, errorMessage: "Ozow did not return a payment url" };
    }

    return {
      success: true,
      redirectUrl: url,
      ozowTransactionId: (json.transactionId as string) ?? (json.transactionReference as string) ?? undefined,
    };
  } catch (err) {
    console.error("[Ozow] PostPaymentRequest request error:", err);
    return { success: false, errorMessage: "Could not reach Ozow" };
  }
}

/**
 * ⚠️  VERIFY THIS BEFORE GOING LIVE — same caveat that bit us with PayFast ITN ⚠️
 *
 * This validates the Hash field Ozow sends back — both on the browser
 * redirect (Success/Cancel/Error query params, display-only) and on the
 * server-to-server Notify webhook (the one that actually flips an order to
 * "paid").
 *
 * Ozow doesn't publish the exact notification field list publicly — it's
 * handed out once you're an approved merchant (their integrations page
 * explicitly says to contact support@ozow.com for the optional-field
 * details). The order below is our best-supported reconstruction, NOT
 * copied verbatim from Ozow's own reference docs the way the PayFast
 * implementation was.
 *
 * Before flipping any real money on this: fire one test transaction from
 * Ozow's staging dashboard, compare the "expected" vs "received" hash
 * logged below, and adjust NOTIFY_FIELD_ORDER if they don't match — exactly
 * how the PayFast ITN "include empty custom fields" quirk got found.
 */
const NOTIFY_FIELD_ORDER = [
  "SiteCode", "TransactionId", "TransactionReference", "Amount", "Status",
  "Optional1", "Optional2", "Optional3", "Optional4", "Optional5",
  "CurrencyCode", "IsTest", "StatusMessage",
] as const;

export function generateResponseHash(payload: Record<string, string>, privateKey: string): string {
  const concatenated = NOTIFY_FIELD_ORDER.map((k) => payload[k] ?? "").join("");
  const hashInput = `${concatenated}${privateKey}`.toLowerCase();
  return crypto.createHash("sha512").update(hashInput).digest("hex");
}

export function validateOzowResponse(payload: Record<string, string>): boolean {
  const privateKey = process.env.OZOW_PRIVATE_KEY;
  if (!privateKey) {
    console.error("[Ozow] OZOW_PRIVATE_KEY not set — cannot validate response hash");
    return false;
  }

  const receivedHash = (payload.Hash ?? payload.HashCheck ?? "").toLowerCase();
  const expectedHash = generateResponseHash(payload, privateKey);

  console.log("[Ozow] Notify field order used:", NOTIFY_FIELD_ORDER.join(", "));
  console.log("[Ozow] Notify payload:", JSON.stringify(payload, null, 2));
  console.log("[Ozow] Notify expected hash:", expectedHash);
  console.log("[Ozow] Notify received hash:", receivedHash);
  console.log("[Ozow] Hashes match:", Boolean(receivedHash) && expectedHash === receivedHash);

  return Boolean(receivedHash) && expectedHash === receivedHash;
}
