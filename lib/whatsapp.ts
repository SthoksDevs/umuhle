// lib/whatsapp.ts
import { buildAccountVerifyUrl } from "@/lib/account-verify";

  const WA_API_URL = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`; 
  
  function normalisePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");

  // Strip a leading 00 international prefix (e.g. "0027...")
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Local SA format starting with 0 (e.g. "082 123 4567") -> convert to 27...
  if (digits.startsWith("0") && !digits.startsWith("27")) {
    digits = `27${digits.slice(1)}`;
  }

  return digits;
}

async function sendMessage(body: object): Promise<boolean> {
  try {
    const res = await fetch(WA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("WhatsApp API error:", JSON.stringify(err));
      return false;
    }

    return true;
  } catch (err) {
    console.error("WhatsApp send error:", err);
    return false;
  }
}

export async function sendTextMessage(
  phone: string,
  text: string
): Promise<boolean> {
  return sendMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalisePhone(phone),
    type: "text",
    text: {
      body: text,
      preview_url: false,
    },
  });
}

export async function sendTemplateMessage(
  phone: string,
  templateName: string,
  components: object[]
): Promise<boolean> {
  return sendMessage({
    messaging_product: "whatsapp",
    to: normalisePhone(phone),
    type: "template",
    template: {
      name: templateName,
      language: {
        code: "en_US",
      },
      components,
    },
  });
}

// -----------------------------------------------------------------------------
// Booking notifications
// -----------------------------------------------------------------------------

interface BookingNotifyOpts {
  clientName: string;
  clientPhone: string;
  artistName: string;
  artistPhone: string;
  date: string;
  time: string;
  serviceName: string;
  meetingAddress?: string;
  expectedDuration?: number;
  clientPocName?: string;
  clientPocPhone?: string;
  artistPocName?: string;
  artistPocPhone?: string;
}

export async function notifyBookingCreated(
  opts: BookingNotifyOpts
) {
  const addressLine = opts.meetingAddress
    ? `\nAddress: ${opts.meetingAddress}`
    : "";

  const durationLine = opts.expectedDuration
    ? `\nDuration: ~${opts.expectedDuration} mins`
    : "";

  const clientMsg =
    `*Booking Confirmed*\n\n` +
    `Hi ${opts.clientName}, your booking with *${opts.artistName}* has been confirmed.\n\n` +
    `Date: ${opts.date}\n` +
    `Time: ${opts.time}\n` +
    `Service: ${opts.serviceName}` +
    `${addressLine}` +
    `${durationLine}\n\n` +
    `Reply to this message if you need to reschedule.`;

  const artistMsg =
    `*New Booking*\n\n` +
    `${opts.clientName} has booked *${opts.serviceName}*.\n\n` +
    `Date: ${opts.date}\n` +
    `Time: ${opts.time}` +
    `${addressLine}` +
    `${durationLine}\n\n` +
    `Open your dashboard to manage this booking.`;

  const promises: Promise<boolean>[] = [
    sendTextMessage(opts.clientPhone, clientMsg),
    sendTextMessage(opts.artistPhone, artistMsg),
  ];

  if (opts.clientPocPhone) {
    const pocMsg =
      `*Umuhle Booking Update*\n\n` +
      `${opts.clientName} has booked *${opts.serviceName}* with ${opts.artistName}.\n\n` +
      `Date: ${opts.date}\n` +
      `Time: ${opts.time}` +
      `${addressLine}`;

    promises.push(
      sendTextMessage(opts.clientPocPhone, pocMsg)
    );
  }

  if (opts.artistPocPhone) {
    const pocMsg =
      `*New Booking for ${opts.artistName}*\n\n` +
      `Client: ${opts.clientName}\n` +
      `Service: ${opts.serviceName}\n` +
      `Date: ${opts.date}\n` +
      `Time: ${opts.time}` +
      `${addressLine}`;

    promises.push(
      sendTextMessage(opts.artistPocPhone, pocMsg)
    );
  }

  await Promise.allSettled(promises);
}

export async function notifyBookingReminder(
  opts: BookingNotifyOpts
) {
  // Client-facing reminder uses the approved WABA template
  // "umuhle_booking_reminder" (button is static — "View details" ->
  // https://umuhle.co.za/dashboard?tab=bookings). Artist/POC reminders
  // below stay as free-text session messages — no template for those yet.
  const formattedDate = new Date(`${opts.date}T00:00:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const artistMsg =
    `*Tomorrow's Appointment*\n\n` +
    `Reminder: ${opts.clientName} has booked *${opts.serviceName}* tomorrow at ${opts.time}.`;

  const promises: Promise<boolean>[] = [
    sendTemplateMessage(opts.clientPhone, "umuhle_booking_reminder", [
      {
        type: "body",
        parameters: [
          { type: "text", text: opts.clientName },
          { type: "text", text: opts.artistName },
          { type: "text", text: formattedDate },
          { type: "text", text: opts.time },
        ],
      },
    ]),
    sendTextMessage(opts.artistPhone, artistMsg),
  ];

  if (opts.clientPocPhone) {
    promises.push(
      sendTextMessage(
        opts.clientPocPhone,
        `Reminder: ${opts.clientName} has an appointment with ${opts.artistName} tomorrow at ${opts.time}.`
      )
    );
  }

  if (opts.artistPocPhone) {
    promises.push(
      sendTextMessage(
        opts.artistPocPhone,
        `Reminder: ${opts.clientName} has an appointment with ${opts.artistName} tomorrow at ${opts.time}.`
      )
    );
  }

  await Promise.allSettled(promises);
}

export async function notifyAppointmentStarted(
  opts: BookingNotifyOpts
) {
  const msg =
    `*Appointment Started*\n\n` +
    `${opts.clientName}'s appointment with ${opts.artistName} has started.\n\n` +
    `Service: ${opts.serviceName}`;

  const promises: Promise<boolean>[] = [];

  if (opts.clientPocPhone) {
    promises.push(
      sendTextMessage(opts.clientPocPhone, msg)
    );
  }

  if (opts.artistPocPhone) {
    promises.push(
      sendTextMessage(opts.artistPocPhone, msg)
    );
  }

  await Promise.allSettled(promises);
}

export async function notifyAppointmentCompleted(opts: {
  clientName: string;
  clientPhone: string;
  artistName: string;
  artistPhone: string;
  serviceName: string;
  clientPocPhone?: string;
  artistPocPhone?: string;
}) {
  const clientMsg =
    `*Appointment Complete*\n\n` +
    `Your appointment with ${opts.artistName} has been completed.\n\n` +
    `We hope you enjoyed your ${opts.serviceName} service.\n\n` +
    `Please leave a review on Umuhle.`;

  const artistMsg =
    `*Appointment Marked Complete*\n\n` +
    `${opts.clientName}'s ${opts.serviceName} appointment has been completed.`;

  const promises: Promise<boolean>[] = [
    sendTextMessage(opts.clientPhone, clientMsg),
    sendTextMessage(opts.artistPhone, artistMsg),
  ];

  if (opts.clientPocPhone) {
    promises.push(
      sendTextMessage(
        opts.clientPocPhone,
        `${opts.clientName}'s appointment with ${opts.artistName} has been completed.`
      )
    );
  }

  if (opts.artistPocPhone) {
    promises.push(
      sendTextMessage(
        opts.artistPocPhone,
        `${opts.clientName}'s ${opts.serviceName} appointment has been completed.`
      )
    );
  }

  await Promise.allSettled(promises);
}

export async function notifyOrderPaid(opts: {
  clientName: string;
  clientPhone: string;
  orderId: string;
  itemCount: number;
  totalAmount: number; // cents
  paymentMethod: "payfast" | "happypay" | "ozow" | "google_pay";
}) {
  // Uses the approved WABA template "umuhle_order" (header/button are static
  // in the template — "View order" -> https://umuhle.co.za/dashboard?tab=my-orders).
  // Note: itemCount/totalAmount/paymentMethod are no longer rendered in the
  // WhatsApp message itself (the template body is fixed copy) — they're still
  // shown on the order confirmation email and the dashboard.
  const orderNumber = `#${opts.orderId.slice(0, 8).toUpperCase()}`;

  return sendTemplateMessage(opts.clientPhone, "umuhle_order", [
    {
      type: "body",
      parameters: [
        { type: "text", text: opts.clientName },
        { type: "text", text: orderNumber },
      ],
    },
  ]);
}

export async function notifyOrderItemShipped(opts: {
  clientName: string;
  clientPhone: string;
  orderId: string;
  productName: string;
  quantity: number;
  confirmToken: string;
}) {
  // Uses the approved WABA template "umuhle_order_shipped" (no button in
  // this template). The confirm-receipt link
  // (https://umuhle.co.za/confirm-receipt/[token]) is no longer sent via
  // WhatsApp — customers still get it by email
  // (sendOrderItemShippedEmail, called alongside this in the ship route).
  const orderNumber = `#${opts.orderId.slice(0, 8).toUpperCase()}`;

  return sendTemplateMessage(opts.clientPhone, "umuhle_order_shipped", [
    {
      type: "body",
      parameters: [
        { type: "text", text: opts.clientName },
        { type: "text", text: orderNumber },
      ],
    },
  ]);
}

export async function notifyPartnerWelcome(opts: {
  partnerPhone: string;
  partnerName: string;
}) {
  const msg =
    `*Welcome to Umuhle Partners*\n\n` +
    `Hi ${opts.partnerName}, you are now a verified Umuhle Partner.\n\n` +
    `You can now:\n` +
    `• List your products\n` +
    `• Purchase advertisements\n` +
    `• Manage your salon listing\n\n` +
    `Visit your dashboard to get started.`;

  return sendTextMessage(opts.partnerPhone, msg);
}

export async function notifyReferralRewarded(opts: {
  phone: string;
  name: string;
  amount: number;
}) {
  const msg =
    `*Referral Reward Received*\n\n` +
    `Hi ${opts.name}, your referral reward of R${(
      opts.amount / 100
    ).toFixed(0)} has been added to your Umuhle wallet.\n\n` +
    `Keep referring Partners to earn more rewards.`;

  return sendTextMessage(opts.phone, msg);
}

export async function notifyAccountCreated(opts: {
  phone: string;
  name: string;
  whatsappNumber: string;
  userId: string;
}) {
  // Uses the approved WABA template "umuhle_account". Its button is a
  // DYNAMIC Website URL button whose "Website URL" field in Meta is
  // configured as JUST {{1}} — no static prefix — so the parameter we send
  // must be the ENTIRE url, not a path segment. Clicking it hits
  // app/verify-account/route.ts, which records a reference-only
  // whatsapp_verified_at timestamp — it does not gate account_status or
  // payments.
  const verifyUrl = buildAccountVerifyUrl(opts.userId);

  return sendTemplateMessage(opts.phone, "umuhle_account", [
    {
      type: "body",
      parameters: [
        { type: "text", text: opts.name },
        { type: "text", text: opts.whatsappNumber },
      ],
    },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: verifyUrl }],
    },
  ]);
}
