// lib/email.ts
// Sends transactional emails via SMTP (nodemailer) and writes every attempt
// to the `email_log` table in Supabase — success or failure, always logged.
//
// Env vars required (same set as admin OTP):
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

/** Write one row to email_log. Never throws — log failure must not block caller. */
async function log(opts: {
  to:          string;
  subject:     string;
  template:    string;
  referenceId?: string;
  status:      "sent" | "failed";
  errorMsg?:   string;
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
    // Log writing failed — surface to server logs but don't rethrow
    console.error("email_log write failed:", e);
  }
}

/**
 * Core send wrapper — sends via SMTP and logs the outcome.
 * Throws on SMTP failure so callers know when to surface an error.
 */
async function send(opts: {
  to:          string;
  subject:     string;
  html:        string;
  text:        string;
  template:    string;
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
    throw err; // re-throw so the ITN handler can log to console
  }
}

// ── Booking confirmed ─────────────────────────────────────────────────────────

export async function sendBookingConfirmedEmail(opts: {
  bookingId:     string;
  clientName:    string;
  clientEmail:   string;
  artistName:    string;
  serviceName:   string;
  date:          string;
  time:          string;
  amount:        number;
  meetingAddress?: string;
}) {
  const subject = `✅ Booking confirmed — ${opts.serviceName} with ${opts.clientName}`;
  const amountStr = formatRand(opts.amount);

  await send({
    to:          ADMIN_EMAIL,
    subject,
    template:    "booking_confirmed",
    referenceId: opts.bookingId,
    text: `Booking confirmed\nRef: ${opts.bookingId}\nClient: ${opts.clientName} (${opts.clientEmail})\nArtist: ${opts.artistName}\nService: ${opts.serviceName}\nDate: ${opts.date} ${opts.time}\nAmount: ${amountStr}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem;color:#1a1a1a">
        <p style="font-size:0.78rem;color:#9B7FB8;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 0.5rem">Umuhle · Booking Confirmed</p>
        <h2 style="font-weight:600;font-size:1.2rem;margin:0 0 1.5rem">✅ New booking — ${amountStr}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
          <tr><td style="padding:0.5rem 0;color:#666;width:40%">Reference</td><td style="padding:0.5rem 0;font-family:monospace">${opts.bookingId}</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Client</td><td style="padding:0.5rem 0">${opts.clientName} (${opts.clientEmail})</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Artist</td><td style="padding:0.5rem 0">${opts.artistName}</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Service</td><td style="padding:0.5rem 0">${opts.serviceName}</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Date</td><td style="padding:0.5rem 0">${opts.date} at ${opts.time}</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Amount</td><td style="padding:0.5rem 0;font-weight:600;color:#2B6B45">${amountStr}</td></tr>
          ${opts.meetingAddress ? `<tr><td style="padding:0.5rem 0;color:#666">Location</td><td style="padding:0.5rem 0">${opts.meetingAddress}</td></tr>` : ""}
        </table>
      </div>`,
  });
}

// ── Booking failed / cancelled ────────────────────────────────────────────────

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
  const label   = opts.reason === "cancelled" ? "Cancelled" : "Failed";
  const subject = `Payment ${label.toLowerCase()} — ${opts.serviceName} — ${formatRand(opts.amount)}`;

  await send({
    to:          ADMIN_EMAIL,
    subject,
    template:    `booking_payment_${opts.reason}`,
    referenceId: opts.bookingId,
    text: `Payment ${label}\nRef: ${opts.bookingId}\nClient: ${opts.clientName} (${opts.clientEmail})\nService: ${opts.serviceName}\nDate: ${opts.date} at ${opts.time}\nAmount: ${formatRand(opts.amount)}\n\nNo booking was created.`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem;color:#1a1a1a">
        <p style="font-size:0.78rem;color:#9B7FB8;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 0.5rem">Umuhle · Payment ${label}</p>
        <h2 style="font-weight:600;font-size:1.2rem;margin:0 0 1.5rem">Payment ${label.toLowerCase()} — ${formatRand(opts.amount)}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
          <tr><td style="padding:0.5rem 0;color:#666;width:40%">Reference</td><td style="padding:0.5rem 0;font-family:monospace">${opts.bookingId}</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Client</td><td style="padding:0.5rem 0">${opts.clientName} (${opts.clientEmail})</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Service</td><td style="padding:0.5rem 0">${opts.serviceName}</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Date</td><td style="padding:0.5rem 0">${opts.date} at ${opts.time}</td></tr>
        </table>
        <p style="margin-top:1.5rem;font-size:0.85rem;color:#666">No booking was created — no action needed.</p>
      </div>`,
  });
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
  const subject   = `✅ Order paid — ${formatRand(opts.totalAmount)} — ${opts.clientName}`;
  const itemRows  = opts.items.map(i => `<tr><td style="padding:0.35rem 0">${i.name}</td><td style="padding:0.35rem 0;text-align:center">${i.quantity}</td><td style="padding:0.35rem 0;text-align:right">${formatRand(i.unit_price * i.quantity)}</td></tr>`).join("");
  const itemText  = opts.items.map(i => `  ${i.quantity}× ${i.name} — ${formatRand(i.unit_price * i.quantity)}`).join("\n");

  await send({
    to:          ADMIN_EMAIL,
    subject,
    template:    "order_paid",
    referenceId: opts.orderId,
    text: `Order paid\nRef: ${opts.orderId}\nClient: ${opts.clientName} (${opts.clientEmail})\nTotal: ${formatRand(opts.totalAmount)}\n\nItems:\n${itemText}${opts.shippingAddress ? `\n\nShip to: ${opts.shippingAddress}` : ""}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem;color:#1a1a1a">
        <p style="font-size:0.78rem;color:#9B7FB8;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 0.5rem">Umuhle · Order Paid</p>
        <h2 style="font-weight:600;font-size:1.2rem;margin:0 0 1.5rem">✅ New order — ${formatRand(opts.totalAmount)}</h2>
        <p style="margin:0 0 1rem;font-size:0.9rem"><strong>Ref:</strong> <span style="font-family:monospace">${opts.orderId}</span><br><strong>Client:</strong> ${opts.clientName} (${opts.clientEmail})</p>
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem;margin-bottom:1rem">
          <thead><tr style="border-bottom:1.5px solid #eee">
            <th style="text-align:left;padding:0.35rem 0;color:#666;font-weight:600">Item</th>
            <th style="text-align:center;padding:0.35rem 0;color:#666;font-weight:600">Qty</th>
            <th style="text-align:right;padding:0.35rem 0;color:#666;font-weight:600">Total</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
          <tfoot><tr style="border-top:1.5px solid #eee">
            <td colspan="2" style="padding:0.5rem 0;font-weight:700">Total</td>
            <td style="padding:0.5rem 0;font-weight:700;text-align:right;color:#2B6B45">${formatRand(opts.totalAmount)}</td>
          </tfoot>
        </table>
        ${opts.shippingAddress ? `<p style="font-size:0.85rem;color:#666"><strong>Ship to:</strong> ${opts.shippingAddress}</p>` : ""}
      </div>`,
  });
}

// ── Order failed / cancelled ──────────────────────────────────────────────────

export async function sendOrderFailedEmail(opts: {
  orderId:     string;
  clientName:  string;
  clientEmail: string;
  totalAmount: number;
  reason:      "cancelled" | "failed";
}) {
  const label   = opts.reason === "cancelled" ? "Cancelled" : "Failed";
  const subject = `Order payment ${label.toLowerCase()} — ${formatRand(opts.totalAmount)} — ${opts.clientName}`;

  await send({
    to:          ADMIN_EMAIL,
    subject,
    template:    `order_payment_${opts.reason}`,
    referenceId: opts.orderId,
    text: `Order payment ${label}\nRef: ${opts.orderId}\nClient: ${opts.clientName} (${opts.clientEmail})\nTotal: ${formatRand(opts.totalAmount)}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem;color:#1a1a1a">
        <p style="font-size:0.78rem;color:#9B7FB8;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 0.5rem">Umuhle · Order ${label}</p>
        <h2 style="font-weight:600;font-size:1.2rem;margin:0 0 1rem">Order payment ${label.toLowerCase()}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
          <tr><td style="padding:0.5rem 0;color:#666;width:40%">Reference</td><td style="padding:0.5rem 0;font-family:monospace">${opts.orderId}</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Client</td><td style="padding:0.5rem 0">${opts.clientName} (${opts.clientEmail})</td></tr>
          <tr><td style="padding:0.5rem 0;color:#666">Total</td><td style="padding:0.5rem 0">${formatRand(opts.totalAmount)}</td></tr>
        </table>
      </div>`,
  });
}