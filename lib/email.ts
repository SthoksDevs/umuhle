// lib/email.ts
// Sends transactional emails via SMTP (nodemailer) and writes every attempt
// to the `email_log` table in Supabase — success or failure, always logged.
//
// Every function sends TWO emails:
//   1. Admin copy → ADMIN_EMAIL (info@umuhle.co.za)
//   2. Customer copy → the client's email address
//
// Env vars required:
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "info@umuhle.co.za";

// ── Internal helpers ──────────────────────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function formatRand(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

/**
 * Write one row to email_log. Never throws.
 *
 * Stores the fully-rendered html/text alongside the metadata — that's what
 * lets /api/cron/resend-emails replay a failed send exactly as originally
 * composed, without re-fetching the underlying order/booking/etc. (which
 * may have changed, or been deleted, by the time the retry runs).
 */
async function log(opts: {
  to:           string;
  subject:      string;
  template:     string;
  referenceId?: string;
  status:       "sent" | "failed";
  errorMsg?:    string;
  html?:        string;
  text?:        string;
}) {
  try {
    await serviceClient().from("email_log").insert({
      to_address:   opts.to,
      subject:      opts.subject,
      template:     opts.template,
      reference_id: opts.referenceId ?? null,
      status:       opts.status,
      error_msg:    opts.errorMsg ?? null,
      html_body:    opts.html ?? null,
      text_body:    opts.text ?? null,
    });
  } catch (e) {
    console.error("email_log write failed:", e);
  }
}

/**
 * Send one email via SMTP and log the outcome.
 * Throws on SMTP failure.
 */
async function send(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  referenceId?: string;
}) {
  const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE !== "false",
    user: process.env.SMTP_USER,
    from: process.env.SMTP_FROM ?? ADMIN_EMAIL,
    passwordConfigured: !!process.env.SMTP_PASS,
  };

  console.log("==================================================");
  console.log("[EMAIL] Starting email send");
  console.log("[EMAIL] Recipient:", opts.to);
  console.log("[EMAIL] Subject:", opts.subject);
  console.log("[EMAIL] Template:", opts.template);
  console.log("[EMAIL] Reference:", opts.referenceId);
  console.log("[EMAIL] SMTP:", smtpConfig);

  const transporter = createTransport();

  try {

    console.log("[EMAIL] Sending email...");

    const info = await transporter.sendMail({
      from: `"Umuhle" <${process.env.SMTP_FROM ?? ADMIN_EMAIL}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });

    console.log("[EMAIL] Email accepted by SMTP server.");
    console.log("[EMAIL] Message ID:", info.messageId);
    console.log("[EMAIL] SMTP Response:", info.response);

    await log({
      to: opts.to,
      subject: opts.subject,
      template: opts.template,
      referenceId: opts.referenceId,
      status: "sent",
      html: opts.html,
      text: opts.text,
    });

    console.log("[EMAIL] Logged successful send.");

  } catch (err) {

    const message =
      err instanceof Error ? err.message : String(err);

    console.error("[EMAIL] SEND FAILED");
    console.error(message);

    await log({
      to: opts.to,
      subject: opts.subject,
      template: opts.template,
      referenceId: opts.referenceId,
      status: "failed",
      errorMsg: message,
      html: opts.html,
      text: opts.text,
    });

    throw err;
  }

  console.log("[EMAIL] Finished sending.");
  console.log("==================================================");
}

/**
 * Send to multiple addresses.
 */
async function sendToAll(
  addresses: string[],
  opts: Omit<Parameters<typeof send>[0], "to">
) {
  const unique = Array.from(new Set(addresses.filter(Boolean)));

  console.log("==================================================");
  console.log("[EMAIL] sendToAll()");
  console.log("[EMAIL] Recipients:", unique);
  console.log("[EMAIL] Template:", opts.template);
  console.log("[EMAIL] Subject:", opts.subject);

  const results = await Promise.allSettled(
    unique.map(async (recipient) => {
      console.log(`[EMAIL] Beginning send to ${recipient}`);

      await send({
        ...opts,
        to: recipient,
      });

      console.log(`[EMAIL] Finished send to ${recipient}`);
    })
  );

  console.log("[EMAIL] Promise results:");

  results.forEach((result, index) => {
    const recipient = unique[index];

    if (result.status === "fulfilled") {
      console.log(`✓ ${recipient} SUCCESS`);
    } else {
      console.error(`✗ ${recipient} FAILED`);
      console.error(result.reason);
    }
  });

  console.log("[EMAIL] sendToAll complete.");
  console.log("==================================================");
}

// ── Resending a previously-failed email ────────────────────────────────────────
// Used by /api/cron/resend-emails (see that route for the daily schedule and
// the query that decides which rows are eligible). This module only knows
// how to safely replay ONE row — policy (how old, how many retries, how
// many per run) lives in the route, not here.

export interface FailedEmailRow {
  id: string;
  to_address: string;
  subject: string;
  template: string;
  reference_id: string | null;
  html_body: string | null;
  text_body: string | null;
  retry_count: number | null;
}

export interface ResendOutcome {
  id: string;
  ok: boolean;
  reason?: string;
}

/**
 * Re-attempts a single previously-failed email_log row byte-for-byte — it
 * replays the html/text that was captured at the original send time rather
 * than re-deriving content from the order/booking/etc., which may have
 * changed (or been deleted) by the time a retry runs, days later.
 *
 * On success: writes a fresh email_log row for the new attempt (so the full
 * history stays intact — original failure + successful resend both visible
 * in the Emails tab) and stamps `resent_at` on the ORIGINAL row so the
 * dashboard can show "✓ Resent" instead of retrying it again tomorrow.
 *
 * On failure: bumps `retry_count` on the original row so the cron can stop
 * retrying a permanently-bad address after a few days instead of forever.
 *
 * Never throws — always resolves with an outcome for the caller to tally.
 */
export async function resendFailedEmail(row: FailedEmailRow): Promise<ResendOutcome> {
  if (!row.html_body && !row.text_body) {
    // Rows logged before this feature shipped (or the admin_otp path, which
    // is deliberately never resent) have nothing safe to replay.
    return { id: row.id, ok: false, reason: "No stored content to resend." };
  }

  const service = serviceClient();

  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from: `"Umuhle" <${process.env.SMTP_FROM ?? ADMIN_EMAIL}>`,
      to: row.to_address,
      subject: row.subject,
      html: row.html_body ?? undefined,
      text: row.text_body ?? undefined,
    });

    await log({
      to: row.to_address,
      subject: row.subject,
      template: row.template,
      referenceId: row.reference_id ?? undefined,
      status: "sent",
      html: row.html_body ?? undefined,
      text: row.text_body ?? undefined,
    });

    await service.from("email_log").update({ resent_at: new Date().toISOString() }).eq("id", row.id);

    return { id: row.id, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await service
      .from("email_log")
      .update({ retry_count: (row.retry_count ?? 0) + 1, error_msg: `Retry failed: ${message}` })
      .eq("id", row.id);

    return { id: row.id, ok: false, reason: message };
  }
}

// ── Admin OTP ──────────────────────────────────────────────────────────────────
// Used by app/api/admin/otp/route.ts. Previously that route sent OTP emails
// with its own private nodemailer call and never wrote to `email_log`, which
// is why OTP codes arrived but never showed up in the database or the admin
// dashboard's Emails tab. Routing it through the shared send() helper fixes
// that — every OTP attempt (success or SMTP failure) is now logged exactly
// like order/booking/ad/salon emails.

export async function sendAdminOtpEmail(toEmail: string, code: string): Promise<void> {
  await send({
    to:      toEmail,
    subject: "Your Umuhle admin verification code",
    template: "admin_otp",
    text:    `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it.`,
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:2rem">
        <p style="font-size:0.85rem;color:#888;letter-spacing:0.1em;text-transform:uppercase">Umuhle Admin</p>
        <h2 style="font-size:1.1rem;font-weight:600;color:#1a1a1a;margin:0.5rem 0 1.5rem">Verification code</h2>
        <div style="background:#f7f4fc;border-radius:12px;padding:1.5rem;text-align:center;margin-bottom:1.5rem">
          <span style="font-size:2.2rem;font-weight:700;letter-spacing:0.25em;color:#9B7FB8">${code}</span>
        </div>
        <p style="font-size:0.85rem;color:#666">Expires in <strong>10 minutes</strong>. Do not share this code with anyone.</p>
      </div>
    `,
  });
}

// ── Shared HTML chrome ────────────────────────────────────────────────────────

function emailWrapper(title: string, body: string) {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:2rem;color:#1a1a1a;background:#fff">
      <p style="font-size:0.75rem;color:#9B7FB8;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 0.4rem">Umuhle</p>
      <h2 style="font-weight:600;font-size:1.2rem;margin:0 0 1.5rem;border-bottom:1.5px solid #f0f0f0;padding-bottom:1rem">${title}</h2>
      ${body}
      <p style="font-size:0.75rem;color:#bbb;margin-top:2rem;border-top:1px solid #f0f0f0;padding-top:1rem">
        Umuhle · Beauty booking & shopping platform · <a href="https://umuhle.co.za" style="color:#9B7FB8;text-decoration:none">umuhle.co.za</a>
      </p>
    </div>`;
}

// Always resolves to the CURRENT status of the order/booking, regardless of
// how long ago the email was sent (or resent) — see app/track/[type]/[id]/route.ts.
// Unlike the one-time gateway return_url query params, this link stays
// meaningful even in a resend days later.
function trackUrl(type: "order" | "booking", id: string) {
  return `https://umuhle.co.za/track/${type}/${id}`;
}

function detailTable(rows: Array<[string, string]>) {
  return `
    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-bottom:1rem">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding:0.45rem 0;color:#666;width:38%;vertical-align:top">${label}</td>
          <td style="padding:0.45rem 0;font-weight:500">${value}</td>
        </tr>`).join("")}
    </table>`;
}

// ── Booking confirmed ─────────────────────────────────────────────────────────

export async function sendBookingConfirmedEmail(opts: {
  bookingId:      string;
  clientName:     string;
  clientEmail:    string;
  artistName:     string;
  serviceName:    string;
  date:           string;
  time:           string;
  amount:         number;
  meetingAddress?: string;
}) {
  const amountStr = formatRand(opts.amount);
  const rows: Array<[string, string]> = [
    ["Reference",  `<span style="font-family:monospace">${opts.bookingId}</span>`],
    ["Client",     `${opts.clientName} (${opts.clientEmail})`],
    ["Artist",     opts.artistName],
    ["Service",    opts.serviceName],
    ["Date & time", `${opts.date} at ${opts.time}`],
    ["Amount",     `<strong style="color:#2B6B45">${amountStr}</strong>`],
    ...(opts.meetingAddress ? [["Location", opts.meetingAddress] as [string, string]] : []),
  ];

  // Admin email
  await sendToAll([ADMIN_EMAIL], {
    subject:     `✅ New booking — ${opts.serviceName} — ${amountStr}`,
    template:    "booking_confirmed_admin",
    referenceId: opts.bookingId,
    text:        `New booking confirmed\nRef: ${opts.bookingId}\nClient: ${opts.clientName} (${opts.clientEmail})\nArtist: ${opts.artistName}\nService: ${opts.serviceName}\nDate: ${opts.date} at ${opts.time}\nAmount: ${amountStr}${opts.meetingAddress ? `\nLocation: ${opts.meetingAddress}` : ""}`,
    html:        emailWrapper(`✅ New booking — ${amountStr}`, detailTable(rows)),
  });

  // Customer email
  if (opts.clientEmail) {
    await sendToAll([opts.clientEmail], {
      subject:     `Your booking is confirmed — ${opts.serviceName} with ${opts.artistName}`,
      template:    "booking_confirmed_customer",
      referenceId: opts.bookingId,
      text:        `Hi ${opts.clientName},\n\nYour booking is confirmed!\n\nArtist: ${opts.artistName}\nService: ${opts.serviceName}\nDate: ${opts.date} at ${opts.time}\nAmount paid: ${amountStr}${opts.meetingAddress ? `\nLocation: ${opts.meetingAddress}` : ""}\n\nYou'll also receive a WhatsApp message shortly. See you then!\n\nView your booking: ${trackUrl("booking", opts.bookingId)}\n\nUmuhle`,
      html:        emailWrapper(`Your booking is confirmed 🎉`, `
        <p style="margin:0 0 1.25rem">Hi ${opts.clientName},</p>
        <p style="margin:0 0 1.25rem">Your booking is confirmed and payment of <strong>${amountStr}</strong> has been received.</p>
        ${detailTable([
          ["Artist",      opts.artistName],
          ["Service",     opts.serviceName],
          ["Date & time", `${opts.date} at ${opts.time}`],
          ["Amount paid", `<strong style="color:#2B6B45">${amountStr}</strong>`],
          ...(opts.meetingAddress ? [["Location", opts.meetingAddress] as [string, string]] : []),
        ])}
        <p style="margin:1rem 0 0;font-size:0.875rem;color:#666">You'll also receive a WhatsApp message with the details. See you then! 💜</p>
        <p style="margin:1rem 0 0"><a href="${trackUrl("booking", opts.bookingId)}" style="color:#9B7FB8;font-weight:600;text-decoration:none">View your booking status →</a></p>`),
    });
  }
}

// ── Booking cancelled / failed ────────────────────────────────────────────────

export async function sendBookingFailedEmail(opts: {
  bookingId:   string;
  clientName:  string;
  clientEmail: string;
  serviceName: string;
  date:        string;
  time:        string;
  amount:      number;
  reason:      "cancelled" | "failed";
}) {
  const label     = opts.reason === "cancelled" ? "Cancelled" : "Failed";
  const amountStr = formatRand(opts.amount);
  const rows: Array<[string, string]> = [
    ["Reference", `<span style="font-family:monospace">${opts.bookingId}</span>`],
    ["Client",    `${opts.clientName} (${opts.clientEmail})`],
    ["Service",   opts.serviceName],
    ["Date",      `${opts.date} at ${opts.time}`],
    ["Amount",    amountStr],
  ];

  // Admin email
  await sendToAll([ADMIN_EMAIL], {
    subject:     `Payment ${label.toLowerCase()} — ${opts.serviceName} — ${amountStr}`,
    template:    `booking_payment_${opts.reason}_admin`,
    referenceId: opts.bookingId,
    text:        `Payment ${label}\nRef: ${opts.bookingId}\nClient: ${opts.clientName} (${opts.clientEmail})\nService: ${opts.serviceName}\nDate: ${opts.date} at ${opts.time}\nAmount: ${amountStr}\n\nNo booking was created.`,
    html:        emailWrapper(`Payment ${label} — ${amountStr}`, `
      ${detailTable(rows)}
      <p style="margin-top:1rem;font-size:0.85rem;color:#666">No booking was created — no action needed.</p>`),
  });

  // Customer email
  if (opts.clientEmail) {
    const isCancel = opts.reason === "cancelled";
    await sendToAll([opts.clientEmail], {
      subject:     isCancel
        ? `Your payment was cancelled — ${opts.serviceName}`
        : `Payment failed — ${opts.serviceName}`,
      template:    `booking_payment_${opts.reason}_customer`,
      referenceId: opts.bookingId,
      text:        (isCancel
        ? `Hi ${opts.clientName},\n\nYour payment for ${opts.serviceName} on ${opts.date} at ${opts.time} was cancelled. No charge was made and no booking was created.\n\nYou can try again at umuhle.co.za.`
        : `Hi ${opts.clientName},\n\nYour payment for ${opts.serviceName} on ${opts.date} at ${opts.time} could not be processed. No charge was made.\n\nPlease check your card details and try again, or contact your bank. If the problem persists, email us at info@umuhle.co.za.`
      ) + `\n\nCheck this booking's status: ${trackUrl("booking", opts.bookingId)}\n\nUmuhle`,
      html:        emailWrapper(
        isCancel ? "Payment cancelled" : "Payment failed",
        `<p style="margin:0 0 1rem">Hi ${opts.clientName},</p>
         <p style="margin:0 0 1.25rem">${isCancel
           ? `Your payment for <strong>${opts.serviceName}</strong> on ${opts.date} at ${opts.time} was cancelled. No charge was made and no booking was created.`
           : `Your payment for <strong>${opts.serviceName}</strong> on ${opts.date} at ${opts.time} could not be processed. No charge was made.`
         }</p>
         <p style="margin:0 0 1.25rem;font-size:0.875rem;color:#666">${isCancel
           ? `You can <a href="https://umuhle.co.za" style="color:#9B7FB8">try again</a> whenever you're ready.`
           : `Please check your card details and try again, or contact your bank. Still having trouble? <a href="mailto:info@umuhle.co.za" style="color:#9B7FB8">Email us</a>.`
         }</p>
         <p style="margin:0"><a href="${trackUrl("booking", opts.bookingId)}" style="color:#9B7FB8;font-weight:600;text-decoration:none">Check this booking's status →</a></p>`
      ),
    });
  }
}

// ── Order paid ────────────────────────────────────────────────────────────────

export async function sendOrderPaidEmail(opts: {
  orderId:          string;
  clientName:       string;
  clientEmail:      string;
  items:            Array<{ name: string; quantity: number; unit_price: number }>;
  totalAmount:      number;
  shippingAddress?: string;
}) {
  const amountStr = formatRand(opts.totalAmount);
  const itemRowsHtml = opts.items.map(i =>
    `<tr>
      <td style="padding:0.35rem 0">${i.name}</td>
      <td style="padding:0.35rem 0;text-align:center">${i.quantity}</td>
      <td style="padding:0.35rem 0;text-align:right">${formatRand(i.unit_price * i.quantity)}</td>
    </tr>`
  ).join("");
  const itemText = opts.items.map(i => `  ${i.quantity}× ${i.name} — ${formatRand(i.unit_price * i.quantity)}`).join("\n");

  const itemsTable = `
    <table style="width:100%;border-collapse:collapse;font-size:0.875rem;margin-bottom:1rem">
      <thead><tr style="border-bottom:1.5px solid #eee">
        <th style="text-align:left;padding:0.35rem 0;color:#666;font-weight:600">Item</th>
        <th style="text-align:center;padding:0.35rem 0;color:#666;font-weight:600">Qty</th>
        <th style="text-align:right;padding:0.35rem 0;color:#666;font-weight:600">Total</th>
      </tr></thead>
      <tbody>${itemRowsHtml}</tbody>
      <tfoot><tr style="border-top:1.5px solid #eee">
        <td colspan="2" style="padding:0.5rem 0;font-weight:700">Total</td>
        <td style="padding:0.5rem 0;font-weight:700;text-align:right;color:#2B6B45">${amountStr}</td>
      </tfoot>
    </table>
    ${opts.shippingAddress ? `<p style="font-size:0.85rem;color:#666"><strong>Ship to:</strong> ${opts.shippingAddress}</p>` : ""}`;

  // Admin email
  await sendToAll([ADMIN_EMAIL], {
    subject:     `✅ New order — ${amountStr} — ${opts.clientName}`,
    template:    "order_paid_admin",
    referenceId: opts.orderId,
    text:        `New order paid\nRef: ${opts.orderId}\nClient: ${opts.clientName} (${opts.clientEmail})\nTotal: ${amountStr}\n\nItems:\n${itemText}${opts.shippingAddress ? `\n\nShip to: ${opts.shippingAddress}` : ""}`,
    html:        emailWrapper(`✅ New order — ${amountStr}`, `
      <p style="margin:0 0 1rem;font-size:0.9rem"><strong>Ref:</strong> <span style="font-family:monospace">${opts.orderId}</span><br>
      <strong>Client:</strong> ${opts.clientName} (${opts.clientEmail})</p>
      ${itemsTable}`),
  });

  // Customer email
  if (opts.clientEmail) {
    await sendToAll([opts.clientEmail], {
      subject:     `Your Umuhle order is confirmed — ${amountStr}`,
      template:    "order_paid_customer",
      referenceId: opts.orderId,
      text:        `Hi ${opts.clientName},\n\nThank you for your order! Payment of ${amountStr} has been received.\n\nOrder ref: ${opts.orderId}\n\nItems:\n${itemText}${opts.shippingAddress ? `\n\nShipping to: ${opts.shippingAddress}` : ""}\n\nWe'll be in touch once your order is on its way.\n\nTrack your order: ${trackUrl("order", opts.orderId)}\n\nUmuhle`,
      html:        emailWrapper(`Your order is confirmed 🛍️`, `
        <p style="margin:0 0 1.25rem">Hi ${opts.clientName}, thank you for your order!</p>
        <p style="margin:0 0 1.25rem">Payment of <strong>${amountStr}</strong> has been received.</p>
        <p style="margin:0 0 0.5rem;font-size:0.8rem;color:#666">Order ref: <span style="font-family:monospace">${opts.orderId}</span></p>
        ${itemsTable}
        <p style="margin:1rem 0 0;font-size:0.875rem;color:#666">We'll be in touch once your order is on its way. 💜</p>
        <p style="margin:1rem 0 0"><a href="${trackUrl("order", opts.orderId)}" style="color:#9B7FB8;font-weight:600;text-decoration:none">Track your order →</a></p>`),
    });
  }
}

// ── Order item shipped / dispatched ─────────────────────────────────────────
//
// Per-item, not per-order: a single order can span multiple partners, so
// each partner's "mark as dispatched" sends its own independent email with
// its own confirm-receipt link — a customer with two partners in one order
// gets two of these, one per item, whenever each partner ships separately.
// See app/api/vendor/order-items/[id]/ship/route.ts, the only caller.

function confirmReceiptUrl(token: string) {
  return `https://umuhle.co.za/confirm-receipt/${token}`;
}

export async function sendOrderItemShippedEmail(opts: {
  orderId:      string;
  clientName:   string;
  clientEmail:  string;
  productName:  string;
  quantity:     number;
  confirmToken: string;
}) {
  if (!opts.clientEmail) return;
  const link = confirmReceiptUrl(opts.confirmToken);

  await sendToAll([opts.clientEmail], {
    subject:     `Your Umuhle order has been dispatched`,
    template:    "order_item_shipped_customer",
    referenceId: opts.orderId,
    text:        `Hi ${opts.clientName},\n\nGood news! ${opts.productName} (× ${opts.quantity}) has been dispatched and should be with you soon.\n\nOnce it arrives, please confirm delivery.:\n${link}\n\nOrder ref: ${opts.orderId}\n\nThe Umuhle Team`,
    html:        emailWrapper(`Your order is on its way! 📦`, `
      <p style="margin:0 0 1rem">Hi ${opts.clientName},</p> 
      <p style="margin:0 0 1.25rem;font-size:0.8rem;color:#666">Good news! <strong>${opts.productName}</strong> (× ${opts.quantity}) has been dispatched and should be with you soon.</p>
      <p style="margin:0 0 1.25rem;font-size:0.8rem;color:#666">Order ref: <span style="font-family:monospace">${opts.orderId}</span></p>
      <p style="margin:0 0 1.5rem">Once it arrives, please confirm delivery below.</p>
      <p style="margin:0 0 1.5rem"><a href="${link}" style="display:inline-block;background:#9B7FB8;color:#fff;font-weight:600;text-decoration:none;padding:0.75rem 1.5rem;border-radius:10px">Confirm Delivery</a></p>
      <p style="margin:0 0 1.5rem">Thank you for supporting local beauty businesses.</p>
      <p style="margin:0 0 1.5rem">The Umuhle Team</p>`),
  });
}

// ── Order cancelled / failed ──────────────────────────────────────────────────

export async function sendOrderFailedEmail(opts: {
  orderId:     string;
  clientName:  string;
  clientEmail: string;
  totalAmount: number;
  reason:      "cancelled" | "failed";
}) {
  const label     = opts.reason === "cancelled" ? "Cancelled" : "Failed";
  const amountStr = formatRand(opts.totalAmount);

  // Admin email
  await sendToAll([ADMIN_EMAIL], {
    subject:     `Order payment ${label.toLowerCase()} — ${amountStr} — ${opts.clientName}`,
    template:    `order_payment_${opts.reason}_admin`,
    referenceId: opts.orderId,
    text:        `Order payment ${label}\nRef: ${opts.orderId}\nClient: ${opts.clientName} (${opts.clientEmail})\nTotal: ${amountStr}`,
    html:        emailWrapper(`Order payment ${label}`, detailTable([
      ["Reference", `<span style="font-family:monospace">${opts.orderId}</span>`],
      ["Client",    `${opts.clientName} (${opts.clientEmail})`],
      ["Total",     amountStr],
    ])),
  });

  // Customer email
  if (opts.clientEmail) {
    const isCancel = opts.reason === "cancelled";
    await sendToAll([opts.clientEmail], {
      subject:     isCancel ? "Your order was cancelled" : "Your order payment failed",
      template:    `order_payment_${opts.reason}_customer`,
      referenceId: opts.orderId,
      text:        (isCancel
        ? `Hi ${opts.clientName},\n\nYour order payment was cancelled. No charge was made.\n\nYou can try again at umuhle.co.za/shop.`
        : `Hi ${opts.clientName},\n\nYour payment of ${amountStr} could not be processed. No charge was made.\n\nPlease check your card details and try again, or contact us at info@umuhle.co.za.`
      ) + `\n\nCheck this order's status: ${trackUrl("order", opts.orderId)}\n\nUmuhle`,
      html:        emailWrapper(
        isCancel ? "Order payment cancelled" : "Order payment failed",
        `<p style="margin:0 0 1rem">Hi ${opts.clientName},</p>
         <p style="margin:0 0 1.25rem">${isCancel
           ? "Your order payment was cancelled. No charge was made."
           : `Your payment of <strong>${amountStr}</strong> could not be processed. No charge was made.`
         }</p>
         <p style="margin:0 0 1.25rem;font-size:0.875rem;color:#666">${isCancel
           ? `<a href="https://umuhle.co.za/shop" style="color:#9B7FB8">Continue shopping</a> whenever you're ready.`
           : `Please check your card details and <a href="https://umuhle.co.za/checkout" style="color:#9B7FB8">try again</a>, or <a href="mailto:info@umuhle.co.za" style="color:#9B7FB8">contact us</a>.`
         }</p>
         <p style="margin:0"><a href="${trackUrl("order", opts.orderId)}" style="color:#9B7FB8;font-weight:600;text-decoration:none">Check this order's status →</a></p>`
      ),
    });
  }
}

// ── Ad payment confirmed ──────────────────────────────────────────────────────

export async function sendAdPaidEmail(opts: {
  adId:         string;
  clientName:   string;
  clientEmail:  string;
  packageName:  string;
  adsCount:     number;
  durationLabel: string;
  amount:       number;
}) {
  const amountStr = formatRand(opts.amount);
  const rows: Array<[string, string]> = [
    ["Reference",  `<span style="font-family:monospace">${opts.adId}</span>`],
    ["Partner",    `${opts.clientName} (${opts.clientEmail})`],
    ["Package",    opts.packageName],
    ["Ads",        `${opts.adsCount} ad slot${opts.adsCount !== 1 ? "s" : ""}`],
    ["Duration",   opts.durationLabel],
    ["Amount",     `<strong style="color:#2B6B45">${amountStr}</strong>`],
  ];

  // Admin email
  await sendToAll([ADMIN_EMAIL], {
    subject:     `✅ Ad payment received — ${opts.packageName} package — ${amountStr}`,
    template:    "ad_paid_admin",
    referenceId: opts.adId,
    text:        `Ad payment received\nRef: ${opts.adId}\nPartner: ${opts.clientName} (${opts.clientEmail})\nPackage: ${opts.packageName} (${opts.adsCount} ads, ${opts.durationLabel})\nAmount: ${amountStr}`,
    html:        emailWrapper(`✅ New ad purchase — ${amountStr}`, detailTable(rows)),
  });

  // Customer / partner email
  if (opts.clientEmail) {
    await sendToAll([opts.clientEmail], {
      subject:     `Your Umuhle ad is being set up — ${opts.packageName} package`,
      template:    "ad_paid_customer",
      referenceId: opts.adId,
      text:        `Hi ${opts.clientName},\n\nThank you! Your payment of ${amountStr} for the ${opts.packageName} ad package has been received.\n\nYour ad (${opts.adsCount} slot${opts.adsCount !== 1 ? "s" : ""} for ${opts.durationLabel}) is now under review and will go live once approved.\n\nUmuhle`,
      html:        emailWrapper(`Your ad is being set up 📣`, `
        <p style="margin:0 0 1.25rem">Hi ${opts.clientName},</p>
        <p style="margin:0 0 1.25rem">Payment of <strong>${amountStr}</strong> for your <strong>${opts.packageName}</strong> ad package has been received.</p>
        ${detailTable([
          ["Ad slots",  `${opts.adsCount}`],
          ["Duration",  opts.durationLabel],
          ["Ref",       `<span style="font-family:monospace">${opts.adId}</span>`],
        ])}
        <p style="margin:1rem 0 0;font-size:0.875rem;color:#666">Your ad is now under review and will go live once our team approves it — usually within 24 hours. 💜</p>`),
    });
  }
}

// ── Product listing payment confirmed ──────────────────────────────────────────
// Same shape as sendAdPaidEmail above — products now use the same package
// pricing as ads, just for a single named item instead of a generic ad slot.

export async function sendProductListingPaidEmail(opts: {
  productId:     string;
  productName:   string;
  clientName:    string;
  clientEmail:   string;
  packageName:   string;
  durationLabel: string;
  slotsTotal:    number;
  amount:        number;
}) {
  const amountStr = formatRand(opts.amount);
  const rows: Array<[string, string]> = [
    ["Reference",  `<span style="font-family:monospace">${opts.productId}</span>`],
    ["Partner",    `${opts.clientName} (${opts.clientEmail})`],
    ["Product",    opts.productName],
    ["Package",    `${opts.packageName} (${opts.slotsTotal} product${opts.slotsTotal > 1 ? "s" : ""})`],
    ["Duration",   opts.durationLabel],
    ["Amount",     `<strong style="color:#2B6B45">${amountStr}</strong>`],
  ];

  // Admin email
  await sendToAll([ADMIN_EMAIL], {
    subject:     `✅ Listing payment received — ${opts.packageName} package — ${amountStr}`,
    template:    "product_listing_paid_admin",
    referenceId: opts.productId,
    text:        `Listing payment received\nRef: ${opts.productId}\nPartner: ${opts.clientName} (${opts.clientEmail})\nProduct: ${opts.productName}\nPackage: ${opts.packageName} (${opts.slotsTotal} products, ${opts.durationLabel})\nAmount: ${amountStr}`,
    html:        emailWrapper(`✅ New listing payment — ${amountStr}`, detailTable(rows)),
  });

  // Customer / partner email
  const slotsRemaining = opts.slotsTotal - 1;
  if (opts.clientEmail) {
    await sendToAll([opts.clientEmail], {
      subject:     `Your Umuhle listing is being set up — ${opts.packageName} package`,
      template:    "product_listing_paid_customer",
      referenceId: opts.productId,
      text:        `Hi ${opts.clientName},\n\nThank you! Your payment of ${amountStr} for the ${opts.packageName} package has been received.\n\n"${opts.productName}" is now under review and will go live in the Umuhle shop for ${opts.durationLabel} once approved.${slotsRemaining > 0 ? `\n\nYou have ${slotsRemaining} more product slot${slotsRemaining > 1 ? "s" : ""} left on this package — list another product any time from My Shop and it won't cost you again.` : ""}\n\nUmuhle`,
      html:        emailWrapper(`Your listing is being set up 🛍️`, `
        <p style="margin:0 0 1.25rem">Hi ${opts.clientName},</p>
        <p style="margin:0 0 1.25rem">Payment of <strong>${amountStr}</strong> for your <strong>${opts.packageName}</strong> package has been received.</p>
        ${detailTable([
          ["Product",  opts.productName],
          ["Live for", opts.durationLabel],
          ["Ref",      `<span style="font-family:monospace">${opts.productId}</span>`],
        ])}
        <p style="margin:1rem 0 0;font-size:0.875rem;color:#666">"${opts.productName}" is now under review and will appear in the shop once our team approves it — usually within 24 hours. 💜</p>
        ${slotsRemaining > 0 ? `<p style="margin:0.75rem 0 0;font-size:0.875rem;color:#666">You've got <strong>${slotsRemaining} more product slot${slotsRemaining > 1 ? "s" : ""}</strong> left on this package — list another product from <strong>My Shop</strong> any time and it's already paid for.</p>` : ""}`),
    });
  }
}

// ── Salon subscription confirmed ──────────────────────────────────────────────

export async function sendSalonPaidEmail(opts: {
  paymentId:    string;
  clientName:   string;
  clientEmail:  string;
  salonName:    string;
  amount:       number;
  expiresAt:    string; // ISO date string
}) {
  const amountStr  = formatRand(opts.amount);
  const expiryDate = new Date(opts.expiresAt).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const rows: Array<[string, string]> = [
    ["Reference",  `<span style="font-family:monospace">${opts.paymentId}</span>`],
    ["Partner",    `${opts.clientName} (${opts.clientEmail})`],
    ["Salon",      opts.salonName],
    ["Amount",     `<strong style="color:#2B6B45">${amountStr}</strong>`],
    ["Valid until", expiryDate],
  ];

  // Admin email
  await sendToAll([ADMIN_EMAIL], {
    subject:     `✅ Salon subscription — ${opts.salonName} — ${amountStr}`,
    template:    "salon_paid_admin",
    referenceId: opts.paymentId,
    text:        `Salon subscription payment\nRef: ${opts.paymentId}\nPartner: ${opts.clientName} (${opts.clientEmail})\nSalon: ${opts.salonName}\nAmount: ${amountStr}\nValid until: ${expiryDate}`,
    html:        emailWrapper(`✅ Salon subscription — ${amountStr}`, detailTable(rows)),
  });

  // Customer / partner email
  if (opts.clientEmail) {
    await sendToAll([opts.clientEmail], {
      subject:     `Your salon listing is active — ${opts.salonName}`,
      template:    "salon_paid_customer",
      referenceId: opts.paymentId,
      text:        `Hi ${opts.clientName},\n\nYour annual salon listing for ${opts.salonName} has been activated. Payment of ${amountStr} was received.\n\nYour listing is valid until ${expiryDate}.\n\nUmuhle`,
      html:        emailWrapper(`Your salon listing is active ✂️`, `
        <p style="margin:0 0 1.25rem">Hi ${opts.clientName},</p>
        <p style="margin:0 0 1.25rem">Your annual listing for <strong>${opts.salonName}</strong> is now active. Payment of <strong>${amountStr}</strong> was received.</p>
        ${detailTable([
          ["Salon",      opts.salonName],
          ["Valid until", expiryDate],
          ["Ref",        `<span style="font-family:monospace">${opts.paymentId}</span>`],
        ])}
        <p style="margin:1rem 0 0;font-size:0.875rem;color:#666">Your store is now visible on <a href="https://umuhle.co.za/stores" style="color:#9B7FB8">umuhle.co.za/stores</a>. 💜</p>`),
    });
  }
}

// ── Daily admin "pending items" digest ─────────────────────────────────────────
// Used by the once-a-day /api/cron/admin-digest job. Each section mirrors a
// filter already used somewhere in the admin dashboard (Stores/Products/Ads
// "pending" tab, Payments' pending withdrawals) so the counts here always
// match what admin would see by clicking into that tab.

export interface PendingDigestItem {
  title:    string;
  subtitle?: string;
  href?:    string;
}

export interface PendingDigestSection {
  label: string;
  count: number;
  items: PendingDigestItem[];
}

export async function sendAdminPendingDigestEmail(opts: {
  toEmail: string;
  sections: PendingDigestSection[];
}) {
  const sections = opts.sections.filter((s) => s.count > 0);
  const totalCount = sections.reduce((sum, s) => sum + s.count, 0);
  if (totalCount === 0) return; // nothing pending — caller should skip, but don't send an empty "all clear" spam either way

  const MAX_LISTED = 10;

  const sectionsHtml = sections.map((sec) => `
    <div style="margin-bottom:1.25rem">
      <p style="font-weight:600;font-size:0.9rem;margin:0 0 0.5rem;color:#1a1a1a">${sec.label} <span style="color:#9B7FB8">(${sec.count})</span></p>
      <ul style="margin:0;padding-left:1.1rem;font-size:0.85rem;color:#444;line-height:1.6">
        ${sec.items.slice(0, MAX_LISTED).map((i) => `<li>${i.href ? `<a href="${i.href}" style="color:#333;text-decoration:underline">${i.title}</a>` : i.title}${i.subtitle ? ` <span style="color:#999">— ${i.subtitle}</span>` : ""}</li>`).join("")}
        ${sec.count > MAX_LISTED ? `<li style="color:#999">…and ${sec.count - MAX_LISTED} more</li>` : ""}
      </ul>
    </div>`).join("");

  const sectionsText = sections.map((sec) =>
    `${sec.label} (${sec.count}):\n${sec.items.slice(0, MAX_LISTED).map((i) => `  - ${i.title}${i.subtitle ? ` — ${i.subtitle}` : ""}`).join("\n")}${sec.count > MAX_LISTED ? `\n  …and ${sec.count - MAX_LISTED} more` : ""}`
  ).join("\n\n");

  await sendToAll([opts.toEmail], {
    subject:     `📋 ${totalCount} item${totalCount !== 1 ? "s" : ""} waiting for review on Umuhle`,
    template:    "admin_pending_digest",
    text:        `Daily pending-items summary\n\n${sectionsText}\n\nReview at https://umuhle.co.za/admin`,
    html:        emailWrapper(`📋 ${totalCount} item${totalCount !== 1 ? "s" : ""} need your review`, `
      <p style="margin:0 0 1.25rem;font-size:0.9rem;color:#666">Daily summary of everything waiting for action across the platform.</p>
      ${sectionsHtml}
      <p style="margin:1rem 0 0"><a href="https://umuhle.co.za/admin" style="color:#9B7FB8;font-weight:600;text-decoration:none">Open admin dashboard →</a></p>`),
  });
}
