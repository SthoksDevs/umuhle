// lib/whatsapp.ts 
  const WA_API_URL = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`; 
  
  function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("0") && digits.length === 10) {
    return `27${digits.slice(1)}`;
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
        code: "en",
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
  const clientMsg =
    `*Appointment Reminder*\n\n` +
    `Hi ${opts.clientName}, this is a reminder that your appointment with *${opts.artistName}* is tomorrow at ${opts.time}.\n\n` +
    `Service: ${opts.serviceName}\n\n` +
    `We look forward to seeing you.`;

  const artistMsg =
    `*Tomorrow's Appointment*\n\n` +
    `Reminder: ${opts.clientName} has booked *${opts.serviceName}* tomorrow at ${opts.time}.`;

  const promises: Promise<boolean>[] = [
    sendTextMessage(opts.clientPhone, clientMsg),
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
  const methodLabel =
    opts.paymentMethod === "happypay" ? "HappyPay (Pay in installments)"
    : opts.paymentMethod === "ozow" ? "Ozow (Instant EFT)"
    : opts.paymentMethod === "google_pay" ? "Google Pay"
    : "Card/EFT via PayFast";

  const msg =
    `*Order Confirmed*\\n\\n` +
    `Hi ${opts.clientName}, we've received payment for your Umuhle Shop order.\\n\\n` +
    `Order: #${opts.orderId.slice(0, 8).toUpperCase()}\\n` +
    `Items: ${opts.itemCount}\\n` +
    `Total: R${(opts.totalAmount / 100).toFixed(0)}\\n` +
    `Paid via: ${methodLabel}\\n\\n` +
    `We'll message you here as soon as your order ships.`;

  return sendTextMessage(opts.clientPhone, msg);
}

export async function notifyOrderItemShipped(opts: {
  clientName: string;
  clientPhone: string;
  orderId: string;
  productName: string;
  quantity: number;
  confirmToken: string;
}) {
  const link = `https://umuhle.co.za/confirm-receipt/${opts.confirmToken}`;
  const msg =
    `*Your order is on its way!*\n\n` +
    `Hi ${opts.clientName}, ${opts.productName} (× ${opts.quantity}) from order #${opts.orderId.slice(0, 8).toUpperCase()} is on its way.\n\n` +
    `Once it arrives, please confirm receipt so we can release payment to the seller:\n${link}`;

  return sendTextMessage(opts.clientPhone, msg);
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
