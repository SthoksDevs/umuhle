// app/api/salons/submitted/route.ts
//
// Fired once by the dashboard's SalonForm (app/dashboard/page.tsx),
// immediately after a brand-new store listing is inserted — never on
// edits to an existing listing, see handleSubmit's isNewSalon flag.
// Best-effort: a failed send here should never undo or block the listing
// that was just created.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendSalonSubmittedEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { salonId?: string; salonName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.salonId || !body.salonName) {
    return NextResponse.json({ error: "salonId and salonName required" }, { status: 400 });
  }

  // Confirm the salon belongs to the caller — stops anyone from passing
  // in an arbitrary salonId to trigger emails for a listing they don't own.
  const { data: salon } = await supabase
    .from("partner_salons")
    .select("id")
    .eq("id", body.salonId)
    .eq("partner_id", user.id)
    .single();
  if (!salon) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();

  try {
    await sendSalonSubmittedEmail({
      ownerName:  profile?.full_name || "there",
      ownerEmail: profile?.email || user.email || "",
      salonName:  body.salonName,
      salonId:    body.salonId,
    });
  } catch (e) {
    console.error("[salons/submitted] email send error:", e);
  }

  return NextResponse.json({ ok: true });
}
