// lib/tradesafe.ts
//
// TradeSafe is an escrow marketplace gateway — a fundamentally different
// wire protocol from PayFast (form-post + MD5 ITN signature) or Ozow (REST
// POST + hash): it's a GraphQL API behind OAuth2 client-credentials auth.
// That's why this is a new file rather than a renamed lib/payfast.ts —
// nothing about the transport carries over.
//
// Money flow, end to end:
//   1. initiateTradeSafeTransaction() below creates a TradeSafe transaction
//      (buyer + Umuhle as the only two parties — Umuhle already does its
//      own internal partner-payout splitting via lib/payouts.ts, so
//      TradeSafe never needs to know about artists/salons/vendors) and
//      returns a hosted checkout URL.
//   2. The buyer pays on TradeSafe's page. TradeSafe holds the funds in
//      escrow — it does NOT pay Umuhle directly the way PayFast/Ozow do.
//   3. TradeSafe calls our callback URL with state FUNDS_RECEIVED — treated
//      as "paid", the same trigger point PayFast's COMPLETE / Ozow's
//      Complete used to be (see app/api/tradesafe/callback/route.ts).
//   4. startAllocationDelivery() is called right away (same callback) so
//      the escrow allocation moves to INITIATED.
//   5. Once the customer confirms delivery on our side (the existing
//      /confirm-receipt/[token] flow), acceptAllocationDelivery() is
//      called, which is what actually triggers TradeSafe to pay Umuhle.
//      See app/api/order-items/confirm/[token]/route.ts.
//
// ⚠️  VERIFY BEFORE GOING LIVE — same spirit as the warning at the top of
// validateOzowResponse() in lib/ozow.ts:
//   - TRADESAFE_INDUSTRY (env var, defaulted below) — set this to whatever
//     industry TradeSafe's onboarding actually assigned Umuhle.
//   - Redirect and callback URLs are configured ONCE in TradeSafe's
//     dashboard (Getting Started → First Steps → "Register your
//     application") — unlike Ozow/PayFast, they are NOT sent per-request.
//     See the migration summary for the exact URLs to register there.
//   - feeAllocation (who eats TradeSafe's escrow fee) defaults to SELLER
//     below (Umuhle absorbs it, same as PayFast/Ozow's processing fee was
//     never passed on to the customer) — flip TRADESAFE_FEE_ALLOCATION if
//     that's wrong.

const IS_SANDBOX = process.env.TRADESAFE_ENV !== "live";

const AUTH_URL = process.env.TRADESAFE_AUTH_URL ?? "https://auth.tradesafe.co.za/oauth/token";

const GRAPHQL_URL =
  process.env.TRADESAFE_API_URL ??
  (IS_SANDBOX ? "https://api-developer.tradesafe.dev/graphql" : "https://api.tradesafe.co.za/graphql");

const CLIENT_ID = process.env.TRADESAFE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.TRADESAFE_CLIENT_SECRET ?? "";

// Every Umuhle payment sold today is a straightforward goods/services sale
// (no property, no vehicles) — see TRADESAFE_INDUSTRY note above if that
// ever needs to vary per payment type.
const INDUSTRY = process.env.TRADESAFE_INDUSTRY ?? "GENERAL_GOODS_SERVICES";
const FEE_ALLOCATION = process.env.TRADESAFE_FEE_ALLOCATION ?? "SELLER";

// ── OAuth2 client-credentials token, cached in-memory for the life of the
// serverless instance. A fresh one is fetched a minute before actual
// expiry rather than exactly on expiry, so a request landing right at the
// boundary never gets handed an already-dead token. ────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TradeSafe auth failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`TradeSafe API error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("TradeSafe API returned no data");
  }
  return json.data;
}

// ── Umuhle's own organisation token (the SELLER party on every
// transaction). Fetched once and cached — this doesn't change at runtime. ──
let cachedSellerToken: string | null = null;

async function getSellerToken(): Promise<string> {
  if (cachedSellerToken) return cachedSellerToken;
  const data = await graphql<{ apiProfile: { token: string } }>(
    `query apiProfile { apiProfile { token } }`,
    {}
  );
  cachedSellerToken = data.apiProfile.token;
  return cachedSellerToken;
}

/** Creates (or reuses) a buyer party token for this checkout. Buyers never need banking details — TradeSafe only asks for those on refund, and only then. */
async function createBuyerToken(buyer: { firstName: string; lastName: string; email: string; mobile: string }): Promise<string> {
  const data = await graphql<{ tokenCreate: { id: string } }>(
    `mutation tokenCreate($givenName: String!, $familyName: String!, $email: Email!, $mobile: String!) {
      tokenCreate(input: { user: { givenName: $givenName, familyName: $familyName, email: $email, mobile: $mobile } }) {
        id
      }
    }`,
    {
      givenName: buyer.firstName || "Umuhle",
      familyName: buyer.lastName || "Customer",
      email: buyer.email,
      mobile: normaliseMobile(buyer.mobile),
    }
  );
  return data.tokenCreate.id;
}

/** TradeSafe wants E.164-ish +27... — this codebase stores SA numbers in a few different shapes (082..., 27...), so normalise defensively rather than trust the caller. */
function normaliseMobile(raw: string | undefined | null): string {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return "+27000000000"; // TradeSafe requires a value; a real number is always collected before checkout in practice
  if (digits.startsWith("27")) return `+${digits}`;
  if (digits.startsWith("0")) return `+27${digits.slice(1)}`;
  return `+27${digits}`;
}

export interface CreateTransactionOptions {
  /** Our own reference, e.g. "order:UUID" or "booking:UUID" — round-tripped back on the callback and on the redirect, see buildReference()/parseReference() below. */
  reference: string;
  title: string;
  description: string;
  amountCents: number;
  buyer: { firstName: string; lastName: string; email: string; mobile: string };
  /** How long the seller has to deliver/the buyer has to inspect before TradeSafe's own reminder flow kicks in — see allocationInTransit/CompleteDelivery in TradeSafe's docs. Not used by Umuhle's own flow (we call acceptAllocationDelivery explicitly, see file header), but TradeSafe requires a value. */
  daysToDeliver?: number;
  daysToInspect?: number;
}

export interface CreateTransactionResult {
  transactionId: string;
  allocationId: string;
  checkoutUrl: string;
}

/**
 * Creates a TradeSafe transaction (Umuhle as the sole SELLER — no AGENT/
 * splitting, see file header) with a single allocation for the full
 * amount, then generates the hosted checkout link the buyer is redirected
 * to. This is the TradeSafe equivalent of PayFast's buildPaymentParams() /
 * Ozow's createOzowPaymentRequest().
 */
export async function initiateTradeSafeTransaction(
  opts: CreateTransactionOptions
): Promise<CreateTransactionResult> {
  const [sellerToken, buyerToken] = await Promise.all([getSellerToken(), createBuyerToken(opts.buyer)]);

  const created = await graphql<{
    transactionCreate: { id: string; allocations: { id: string }[] };
  }>(
    `mutation transactionCreate(
      $reference: String!, $title: String!, $description: String!, $industry: Industry!,
      $value: Float!, $daysToDeliver: Float!, $daysToInspect: Float!,
      $buyerToken: String!, $sellerToken: String!, $feeAllocation: FeeAllocation!
    ) {
      transactionCreate(input: {
        reference: $reference
        title: $title
        description: $description
        industry: $industry
        currency: ZAR
        workflow: STANDARD
        feeAllocation: $feeAllocation
        allocations: { create: [{ title: $title, description: $description, value: $value, daysToDeliver: $daysToDeliver, daysToInspect: $daysToInspect }] }
        parties: { create: [{ token: $buyerToken, role: BUYER }, { token: $sellerToken, role: SELLER }] }
      }) {
        id
        allocations { id }
      }
    }`,
    {
      reference: opts.reference,
      title: opts.title,
      description: opts.description,
      industry: INDUSTRY,
      // TradeSafe's `value` is Rand, not cents — every other Umuhle amount
      // is cents throughout (see lib/payfast.ts's formatAmount for the
      // exact same conversion PayFast needed).
      value: opts.amountCents / 100,
      daysToDeliver: opts.daysToDeliver ?? 14,
      daysToInspect: opts.daysToInspect ?? 7,
      buyerToken,
      sellerToken,
      feeAllocation: FEE_ALLOCATION,
    }
  );

  const transactionId = created.transactionCreate.id;
  const allocationId = created.transactionCreate.allocations[0]?.id;
  if (!allocationId) throw new Error("TradeSafe transaction created without an allocation");

  const linkData = await graphql<{ checkoutLink: string }>(
    `mutation checkoutLink($transactionId: ID!) { checkoutLink(transactionId: $transactionId) }`,
    { transactionId }
  );

  return { transactionId, allocationId, checkoutUrl: linkData.checkoutLink };
}

/** Moves the allocation from FUNDS_RECEIVED to INITIATED. Safe to call once payment is confirmed — see app/api/tradesafe/callback/route.ts. */
export async function startAllocationDelivery(allocationId: string): Promise<void> {
  await graphql<{ allocationStartDelivery: { id: string; state: string } }>(
    `mutation allocationStartDelivery($id: ID!) { allocationStartDelivery(id: $id) { id state } }`,
    { id: allocationId }
  );
}

/**
 * Marks the allocation as delivered/accepted — this is the call that
 * actually triggers TradeSafe to pay Umuhle out of escrow. No reminder
 * email goes to the buyer (see TradeSafe's docs comparison of
 * allocationInTransit/CompleteDelivery/AcceptDelivery) — appropriate here
 * since Umuhle already sends its own delivery/order-paid notifications.
 */
export async function acceptAllocationDelivery(allocationId: string): Promise<void> {
  await graphql<{ allocationAcceptDelivery: { id: string; state: string } }>(
    `mutation allocationAcceptDelivery($id: ID!) { allocationAcceptDelivery(id: $id) { id state } }`,
    { id: allocationId }
  );
}

// ── Reference encoding ────────────────────────────────────────────────────
// TradeSafe's own redirect/callback URLs are configured once, application-
// wide (see file header) — they can't carry our own query params the way
// Ozow's per-checkout NotifyUrl does. Instead we round-trip our payment
// `type` + id through TradeSafe's `reference` field, which it echoes back
// on both the callback payload and the redirect query string.
export function buildReference(type: string, id: string): string {
  return `${type}:${id}`;
}

export function parseReference(reference: string): { type: string; id: string } | null {
  const i = reference.indexOf(":");
  if (i < 0) return null;
  return { type: reference.slice(0, i), id: reference.slice(i + 1) };
}

// ── Callback (webhook) verification ───────────────────────────────────────
// TradeSafe's callback security model is a single static secret configured
// once as part of the callback URL itself (registered in TradeSafe's
// dashboard — see file header), NOT a per-transaction secret the way
// Ozow's gateway_webhook_secret column is. See app/api/tradesafe/callback/
// route.ts for where this gets checked, and TRADESAFE_WEBHOOK_SECRET in
// the env vars list.
export function isValidCallbackSecret(secretFromRequest: string | null): boolean {
  const expected = process.env.TRADESAFE_WEBHOOK_SECRET;
  return Boolean(expected) && secretFromRequest === expected;
}

// TradeSafe's documented callback source IPs — optional defence-in-depth
// on top of the secret above, not a substitute for it (Vercel's edge
// network makes strict IP allow-listing unreliable, so this is logged, not
// enforced). See docs.tradesafe.co.za/api/callbacks/#whitelisting.
export const TRADESAFE_CALLBACK_IPS = IS_SANDBOX
  ? ["13.244.48.16", "13.244.147.116"]
  : ["13.244.170.245", "13.244.43.204"];
