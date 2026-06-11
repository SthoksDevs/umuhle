// lib/whatsapp.ts

const WA_API_URL = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

/** Normalise to E.164 (+27...) */
function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    return `27${digits.slice(1)}`; // South African local → international
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

/**
 * Send a plain text message.
 * For production, use template messages (approved by Meta) instead.
 */
export async function sendTextMessage(
  phone: string,
  text: string
): Promise<boolean> {
  return sendMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalisePhone(phone),
    type: "text",
    text: { body: text, preview_url: false },
  });
}

/**
 * Send an approved WhatsApp template message.
 * Templates must be approved in Meta Business Manager before use.
 *
 * Example template names (create these in Meta):
 *   - booking_confirmed   → "Hi {{1}}, your booking with {{2}} on {{3}} at {{4}} is confirmed! 💜"
 *   - booking_reminder    → "Reminder: your appointment with {{1}} is tomorrow at {{2}}."
 *   - booking_cancelled   → "Your booking on {{3}} has been cancelled. We hope to see you soon."
 */
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
      language: { code: "en" },
      components,
    },
  });
}

// ─────────────────────────────────────────────
//  Convenience notification helpers
// ─────────────────────────────────────────────

export async function notifyBookingConfirmed(opts: {
  clientPhone: string;
  clientName: string;
  artistName: string;
  date: string;
  time: string;
  serviceName: string;
}) {
  const text =
    `✅ *Booking Confirmed!*\n\n` +
    `Hi ${opts.clientName}, your booking with *${opts.artistName}* is confirmed.\n\n` +
    `📅 ${opts.date} at ${opts.time}\n` +
    `💅 ${opts.serviceName}\n\n` +
    `_Reply to this message if you need to reschedule._`;

  return sendTextMessage(opts.clientPhone, text);
}

export async function notifyArtistNewBooking(opts: {
  artistPhone: string;
  clientName: string;
  date: string;
  time: string;
  serviceName: string;
}) {
  const text =
    `🆕 *New Booking!*\n\n` +
    `${opts.clientName} booked *${opts.serviceName}*\n` +
    `📅 ${opts.date} at ${opts.time}\n\n` +
    `Open your dashboard to confirm or manage the booking.`;

  return sendTextMessage(opts.artistPhone, text);
}

export async function notifyBookingReminder(opts: {
  clientPhone: string;
  clientName: string;
  artistName: string;
  time: string;
  serviceName: string;
}) {
  const text =
    `⏰ *Appointment Reminder*\n\n` +
    `Hi ${opts.clientName}! Your appointment with *${opts.artistName}* is *tomorrow at ${opts.time}*.\n` +
    `💅 ${opts.serviceName}\n\n` +
    `See you soon! 💜`;

  return sendTextMessage(opts.clientPhone, text);
}
