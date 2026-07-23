// app/api/auth/notify-account-created/route.ts
//
// Fired after a user's WhatsApp number is saved (signup or dashboard edit)
// and account type for the first time (works for both customer and
// artist/business_partner signups — Google/Facebook signups skip our own
// registration form, so this gate is the first point we actually have a
// WhatsApp number to notify). Best-effort: a failed send here should never
// block account setup.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyAccountCreated } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { name, phone } = await req.json();
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }

  try {
    await notifyAccountCreated({
      phone,
      name: name && typeof name === "string" ? name : "there",
      whatsappNumber: phone,
      userId: user.id,
    });
  } catch (e) {
    console.error("[notify-account-created] WhatsApp send error:", e);
  }

  return NextResponse.json({ ok: true });
}
