// app/api/poc/notify/route.ts
//
// Step 1 of the "Add Point of Contact" flow (PocPopup in app/dashboard/page.tsx):
// sends a WhatsApp message to the proposed POC asking them to accept, before
// the client can save them to their profile.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendTextMessage } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!name || !phone) {
    return NextResponse.json({ error: "A name and WhatsApp number are required." }, { status: 400 });
  }

  const { data: profile } = await session
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const requesterName = profile?.full_name || "An Umuhle user";

  const message =
    `*Umuhle Point of Contact Request*\n\n` +
    `Hi ${name}, ${requesterName} has listed you as their Point of Contact for bookings on Umuhle.\n\n` +
    `This means an artist may reach out to you during their appointment, for safety and peace of mind.\n\n` +
    `Reply YES to this message to accept.`;

  const sent = await sendTextMessage(phone, message);

  if (!sent) {
    return NextResponse.json(
      { error: "Couldn't send the WhatsApp message. Please check the number and try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
