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

/** Write one row to email_log. Never throws. */
async function log(opts: {
  to:           string;
  subject:      string;
  template:     string;
  referenceId?: string;
  status:       "sent" | "failed";
  errorMsg?:    string;
}) {
  try {
    await serviceClient().from("email_log").insert({
      to_address:   opts.to,
      subject:      opts.subject,
      template:     opts.template,
      reference_id: opts.referenceId ?? null,
      status:       opts.status,
      error_msg:    opts.errorMsg ?? null,
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
  to:           string;
  subject:      string;
  html:         string;
  text:         string;
  template:     string;
  referenceId?: string;
}) {
  const t = createTransport();
  try {
    await t.sendMail({
      from:    `"Umuhle" <${process.env.SMTP_FROM ?? ADMIN_EMAIL}>`,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    });
    await log({ to: opts.to, subject: opts.subject, template: opts.template, referenceId: opts.referenceId, status: "sent" });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await log({ to: opts.to, subject: opts.subject, template: opts.template, referenceId: opts.referenceId, status: "failed", errorMsg });
    throw err;
  }
}

/**
 * Send to multiple addresses, collecting errors so one failure doesn't
 * prevent the other from being attempted.
 */
async function sendToAll(
  addresses: string[],
  opts: Omit<Parameters<typeof send>[0], "to">
) {
  const unique = Array.from(new Set(addresses.filter(Boolean)));
  await Promise.allSettled(
    unique.map(to =>
      send({ ...opts, to }).catch(e =>
        console.error(`Email send failed to ${to}:`, e)
      )
    )
  );
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
      text:        `Hi ${opts.clientName},\n\nYour booking is confirmed!\n\nArtist: ${opts.artistName}\nService: ${opts.serviceName}\nDate: ${opts.date} at ${opts.time}\nAmount paid: ${amountStr}${opts.meetingAddress ? `\nLocation: ${opts.meetingAddress}` : ""}\n\nYou'll also receive a WhatsApp message shortly. See you then!\n\nUmuhle`,
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
        <p style="margin:1rem 0 0;font-size:0.875rem;color:#666">You'll also receive a WhatsApp message with the details. See you then! 💜</p>`),
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
      text:        isCancel
        ? `Hi ${opts.clientName},\n\nYour payment for ${opts.serviceName} on ${opts.date} at ${opts.time} was cancelled. No charge was made and no booking was created.\n\nYou can try again at umuhle.co.za.\n\nUmuhle`
        : `Hi ${opts.clientName},\n\nYour payment for ${opts.serviceName} on ${opts.date} at ${opts.time} could not be processed. No charge was made.\n\nPlease check your card details and try again, or contact your bank. If the problem persists, email us at info@umuhle.co.za.\n\nUmuhle`,
      html:        emailWrapper(
        isCancel ? "Payment cancelled" : "Payment failed",
        `<p style="margin:0 0 1rem">Hi ${opts.clientName},</p>
         <p style="margin:0 0 1.25rem">${isCancel
           ? `Your payment for <strong>${opts.serviceName}</strong> on ${opts.date} at ${opts.time} was cancelled. No charge was made and no booking was created.`
           : `Your payment for <strong>${opts.serviceName}</strong> on ${opts.date} at ${opts.time} could not be processed. No charge was made.`
         }</p>
         <p style="margin:0;font-size:0.875rem;color:#666">${isCancel
           ? `You can <a href="https://umuhle.co.za" style="color:#9B7FB8">try again</a> whenever you're ready.`
           : `Please check your card details and try again, or contact your bank. Still having trouble? <a href="mailto:info@umuhle.co.za" style="color:#9B7FB8">Email us</a>.`
         }</p>`
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
      text:        `Hi ${opts.clientName},\n\nThank you for your order! Payment of ${amountStr} has been received.\n\nOrder ref: ${opts.orderId}\n\nItems:\n${itemText}${opts.shippingAddress ? `\n\nShipping to: ${opts.shippingAddress}` : ""}\n\nWe'll be in touch once your order is on its way.\n\nUmuhle`,
      html:        emailWrapper(`Your order is confirmed 🛍️`, `
        <p style="margin:0 0 1.25rem">Hi ${opts.clientName}, thank you for your order!</p>
        <p style="margin:0 0 1.25rem">Payment of <strong>${amountStr}</strong> has been received.</p>
        <p style="margin:0 0 0.5rem;font-size:0.8rem;color:#666">Order ref: <span style="font-family:monospace">${opts.orderId}</span></p>
        ${itemsTable}
        <p style="margin:1rem 0 0;font-size:0.875rem;color:#666">We'll be in touch once your order is on its way. 💜</p>`),
    });
  }
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
      text:        isCancel
        ? `Hi ${opts.clientName},\n\nYour order payment was cancelled. No charge was made.\n\nYou can try again at umuhle.co.za/shop.\n\nUmuhle`
        : `Hi ${opts.clientName},\n\nYour payment of ${amountStr} could not be processed. No charge was made.\n\nPlease check your card details and try again, or contact us at info@umuhle.co.za.\n\nUmuhle`,
      html:        emailWrapper(
        isCancel ? "Order payment cancelled" : "Order payment failed",
        `<p style="margin:0 0 1rem">Hi ${opts.clientName},</p>
         <p style="margin:0 0 1.25rem">${isCancel
           ? "Your order payment was cancelled. No charge was made."
           : `Your payment of <strong>${amountStr}</strong> could not be processed. No charge was made.`
         }</p>
         <p style="margin:0;font-size:0.875rem;color:#666">${isCancel
           ? `<a href="https://umuhle.co.za/shop" style="color:#9B7FB8">Continue shopping</a> whenever you're ready.`
           : `Please check your card details and <a href="https://umuhle.co.za/checkout" style="color:#9B7FB8">try again</a>, or <a href="mailto:info@umuhle.co.za" style="color:#9B7FB8">contact us</a>.`
         }</p>`
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
