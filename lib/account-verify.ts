// lib/account-verify.ts
//
// Signs/verifies the token used in the "umuhle_account" WABA template's
// dynamic Website URL button (https://umuhle.co.za/verify-account?token=...).
// This is a reference-only confirmation that the WhatsApp number is reachable
// — it does NOT gate account_status or payments (see app/verify-account/route.ts).
import { createHmac } from "crypto";

const ACCOUNT_VERIFY_SECRET =
  process.env.ACCOUNT_VERIFY_SECRET ?? process.env.OTP_SECRET ?? "umuhle-verify-secret-change-me";

interface AccountVerifyPayload {
  userId: string;
  ts: number;
}

function sign(userId: string, ts: number): string {
  return createHmac("sha256", ACCOUNT_VERIFY_SECRET)
    .update(`${userId}:${ts}`)
    .digest("hex");
}

/** Builds the full URL sent as the umuhle_account template's button parameter. */
export function buildAccountVerifyUrl(userId: string): string {
  const ts = Date.now();
  const sig = sign(userId, ts);
  const token = Buffer.from(JSON.stringify({ userId, ts, sig })).toString("base64url");
  return `https://umuhle.co.za/verify-account?token=${token}`;
}

/** Verifies a token from the query string. No expiry — this is a reference-only
 *  confirmation, not a security gate, so there's no downside to it staying valid. */
export function verifyAccountToken(token: string): { valid: boolean; userId?: string } {
  try {
    const payload = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8")
    ) as AccountVerifyPayload & { sig: string };

    if (!payload.userId || !payload.ts || !payload.sig) return { valid: false };
    if (sign(payload.userId, payload.ts) !== payload.sig) return { valid: false };

    return { valid: true, userId: payload.userId };
  } catch {
    return { valid: false };
  }
}
