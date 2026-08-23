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
  components: object[],
  languageCode: string = "en_US"
): Promise<boolean> {
  return sendMessage({
    messaging_product: "whatsapp",
    to: normalisePhone(phone),
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      components,
    },
  });
}

// -----------------------------------------------------------------------------
// Phone verification (OTP)
// -----------------------------------------------------------------------------

// Sends a 6-digit code via the approved WABA Authentication template
// "umuhle_number_otp" — registered on Meta with a copy-code button,
// en_US, 10-minute expiry copy baked into the template body itself:
// "{{code}} is your verification code. For your security, do not share
// this code. Expires in 10 minutes." Used by both
// app/api/auth/phone-otp/send (signup + dashboard number changes) —
// there's no other caller, since this always fires before an open
// session window exists, so a template message is required either way.
export async function sendPhoneOtp(phone: string, code: string): Promise<boolean> {
  return sendTemplateMessage(phone, "umuhle_number_otp", [
    {
      type: "body",
      parameters: [{ type: "text", text: code }],
    },
    {
      type: "button",
      sub_type: "copy_code",
      index: "0",
      parameters: [{ type: "coupon_code", coupon_code: code }],
    },
  ]);
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
  // Non-essential booking sends respect each party's own whatsapp_comms_enabled
  // preference — see call sites in lib/payments/fulfillment.ts and
  // app/api/notifications/route.ts. POC messages above are meeting logistics,
  // not marketing, and always go out regardless of these flags.
  clientWhatsappEnabled?: boolean;
  artistWhatsappEnabled?: boolean;
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

  const promises: Promise<boolean>[] = [];
  if (opts.clientWhatsappEnabled) {
    promises.push(sendTextMessage(opts.clientPhone, clientMsg));
  }
  if (opts.artistWhatsappEnabled) {
    promises.push(sendTextMessage(opts.artistPhone, artistMsg));
  }

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
): Promise<{ clientSent: boolean }> {
  // Client-facing reminder uses the approved WABA template
  // "umuhle_booking_reminder" (button is static — "View details" ->
  // https://umuhle.co.za/dashboard?tab=bookings). Artist/POC reminders
  // below stay as free-text session messages — no template for those yet.
  //
  // Fires within 2h of the appointment now (see app/api/notifications/
  // route.ts), not necessarily "tomorrow" — copy below uses the actual
  // date instead of assuming.
  const formattedDate = new Date(`${opts.date}T00:00:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const clientSent = opts.clientWhatsappEnabled
    ? await sendTemplateMessage(opts.clientPhone, "umuhle_booking_reminder", [
        {
          type: "body",
          parameters: [
            { type: "text", text: opts.clientName },
            { type: "text", text: opts.artistName },
            { type: "text", text: formattedDate },
            { type: "text", text: opts.time },
          ],
        },
      ])
    : false;

  const promises: Promise<boolean>[] = [];

  // artistPhone may be missing — don't let that block the client's
  // WhatsApp send above, and don't fail the whole reminder if it is.
  if (opts.artistPhone) {
    const artistMsg =
      `*Upcoming Appointment*\n\n` +
      `Reminder: ${opts.clientName} has booked *${opts.serviceName}* on ${formattedDate} at ${opts.time}.`;
    promises.push(sendTextMessage(opts.artistPhone, artistMsg));
  }

  if (opts.clientPocPhone) {
    promises.push(
      sendTextMessage(
        opts.clientPocPhone,
        `Reminder: ${opts.clientName} has an appointment with ${opts.artistName} on ${formattedDate} at ${opts.time}.`
      )
    );
  }

  if (opts.artistPocPhone) {
    promises.push(
      sendTextMessage(
        opts.artistPocPhone,
        `Reminder: ${opts.clientName} has an appointment with ${opts.artistName} on ${formattedDate} at ${opts.time}.`
      )
    );
  }

  await Promise.allSettled(promises);

  return { clientSent };
}

// Store/salon booking reminder. Reuses the same approved
// "umuhle_booking_reminder" template (it's just {name, provider, date,
// time} params — no schema tie to "artist" specifically), with the salon
// name in the provider slot. If you'd rather have a distinct template on
// Meta's side for salons, this is the one call site to swap it in.
export async function notifyStoreBookingReminder(opts: {
  clientName: string;
  clientPhone: string;
  salonName: string;
  date: string;
  time: string;
  serviceName: string;
}): Promise<{ clientSent: boolean }> {
  const formattedDate = new Date(`${opts.date}T00:00:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const clientSent = await sendTemplateMessage(opts.clientPhone, "umuhle_booking_reminder", [
    {
      type: "body",
      parameters: [
        { type: "text", text: opts.clientName },
        { type: "text", text: opts.salonName },
        { type: "text", text: formattedDate },
        { type: "text", text: opts.time },
      ],
    },
  ]);

  return { clientSent };
}

export async function notifyPocBookingUpdate(
  opts: BookingNotifyOpts
) {
  if (!opts.clientPocPhone) return;

  // Approved WABA template "umuhle_poc_booking_update" — fires when a
  // booking is confirmed and the client listed a point of contact.
  // Note: registered on Meta as plain "English" (en), not "English (US)"
  // (en_US) like the other umuhle_* templates — hence the explicit
  // language override below.
  const formattedDate = new Date(`${opts.date}T00:00:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  try {
    await sendTemplateMessage(opts.clientPocPhone, "umuhle_poc_booking_update", [
      {
        type: "body",
        parameters: [
          { type: "text", text: opts.clientPocName ?? "there" },
          { type: "text", text: opts.clientName },
          { type: "text", text: opts.artistName },
          { type: "text", text: formattedDate },
          { type: "text", text: opts.time },
        ],
      },
    ], "en");
  } catch (e) {
    console.error("[whatsapp] notifyPocBookingUpdate failed:", e);
  }
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
    `We hope you enjoyed your ${opts.serviceName} service.`;

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
  paymentMethod: "payfast" | "ozow";
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
  // "https://www.umuhle.co.za/" + {{1}} — so the parameter we send must be
  // ONLY the path segment (no domain), or the link doubles up. Clicking it
  // hits app/verify-account/route.ts, which records a reference-only
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

export async function notifyReviewInvite(opts: {
  phone: string;
  name: string;
  targetName: string;
  reviewUrl: string;
  kind: "artist" | "client" | "product" | "salon";
}) {
  // Free-text (sendTextMessage), NOT a template — there's no approved WABA
  // template for review requests (the four that exist are
  // umuhle_booking_reminder, umuhle_order, umuhle_order_shipped and
  // umuhle_account — see their call sites above). That means this message
  // only lands if the recipient has messaged Umuhle within the last 24
  // hours; outside that window WhatsApp silently drops it. Email
  // (sendReviewInviteEmail in lib/email.ts) is the reliable channel and is
  // always sent alongside this at every call site — treat this as a bonus,
  // not the primary delivery path. Submitting an approved "review request"
  // Utility template to Meta would let this be upgraded later.
  const label = {
    artist:  "your artist",
    client:  "your client",
    product: "your purchase",
    salon:   "your visit",
  }[opts.kind];

  const msg =
    `*How was ${label}?*\n\n` +
    `Hi ${opts.name}, we'd love your feedback on *${opts.targetName}*.\n\n` +
    `Leave a quick review: ${opts.reviewUrl}`;

  return sendTextMessage(opts.phone, msg);
}

/**
 * One WhatsApp message per customer per cron run, covering every product
 * that just became reviewable — see sendProductReviewDigestEmail in
 * lib/email.ts (the reliable counterpart to this) for why this replaced
 * one notifyReviewInvite call per order item.
 */
export async function notifyProductReviewDigest(opts: {
  phone:        string;
  name:         string;
  productNames: string[];
  reviewUrl:    string;
}) {
  const list =
    opts.productNames.length === 1 ? opts.productNames[0]
    : opts.productNames.length === 2 ? `${opts.productNames[0]} and ${opts.productNames[1]}`
    : `${opts.productNames.slice(0, -1).join(", ")} and ${opts.productNames[opts.productNames.length - 1]}`;

  const msg = opts.productNames.length > 1
    ? `*How was your recent order?*\n\nHi ${opts.name}, we'd love your feedback on your recent purchases — *${list}*.\n\nLeave a quick review: ${opts.reviewUrl}`
    : `*How was your purchase?*\n\nHi ${opts.name}, we'd love your feedback on *${list}*.\n\nLeave a quick review: ${opts.reviewUrl}`;

  return sendTextMessage(opts.phone, msg);
}
