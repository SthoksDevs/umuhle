import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_ROWS = 100;
const WEEK_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const ALLOWED_SERVICES = new Set(["hair", "nails", "makeup", "lashes"]);
const REQUIRED_HEADERS = [
  "name","description","address","suburb","city","postal_code","phone","email","website","services",
  "monday_open","monday_close","monday_closed","tuesday_open","tuesday_close","tuesday_closed",
  "wednesday_open","wednesday_close","wednesday_closed","thursday_open","thursday_close","thursday_closed",
  "friday_open","friday_close","friday_closed","saturday_open","saturday_close","saturday_closed",
  "sunday_open","sunday_close","sunday_closed","instagram_username","youtube_url",
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(value.trim()); value = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      value += ch;
    }
  }
  if (value || row.length) { row.push(value.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const timeRe = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validateRow(r: Record<string, string>, rowNumber: number): string[] {
  const errors: string[] = [];
  if (!r.name) errors.push("Store name is required.");
  for (const key of ["address", "suburb", "city", "phone", "email", "services"]) {
    if (!r[key]) errors.push(`${key} is required.`);
  }
  if (r.email && !emailRe.test(r.email)) errors.push("Invalid email address.");
  if (r.postal_code && !/^\d{4}$/.test(r.postal_code)) errors.push("postal_code must be exactly 4 digits.");
  const services = r.services.split("|").filter(Boolean);
  if (services.some(s => !ALLOWED_SERVICES.has(s))) errors.push("services may only contain hair, nails, makeup or lashes, separated with |.");
  for (const day of WEEK_DAYS) {
    const closed = r[`${day}_closed`];
    if (closed !== "true" && closed !== "false") errors.push(`${day}_closed must be true or false.`);
    if (closed === "false" && (!timeRe.test(r[`${day}_open`] ?? "") || !timeRe.test(r[`${day}_close`] ?? ""))) {
      errors.push(`${day}_open and ${day}_close must use HH:MM.`);
    }
  }
  return errors.map(message => `Row ${rowNumber}: ${message}`);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Upload a CSV file." }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "CSV file is too large. Maximum size is 2MB." }, { status: 400 });

  const rows = parseCsv(await file.text());
  if (rows.length < 2) return NextResponse.json({ error: "The CSV contains no store rows." }, { status: 400 });

  const headers = rows[0].map(h => h.trim());
  if (headers.length !== REQUIRED_HEADERS.length || headers.some((h, i) => h !== REQUIRED_HEADERS[i])) {
    return NextResponse.json({ error: "Invalid header row. Download the official Umuhle template and do not rename, remove or reorder columns." }, { status: 400 });
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) return NextResponse.json({ error: `Maximum ${MAX_ROWS} stores per import.` }, { status: 400 });

  const errors: string[] = [];
  const payload = dataRows.map((values, index) => {
    const r = Object.fromEntries(REQUIRED_HEADERS.map((h, i) => [h, values[i] ?? ""]));
    errors.push(...validateRow(r, index + 2));
    return {
      name: r.name,
      description: r.description || null,
      address: r.address,
      suburb: r.suburb,
      city: r.city,
      postal_code: r.postal_code || null,
      phone: r.phone,
      email: r.email,
      website: r.website || null,
      instagram_username: r.instagram_username || null,
      youtube_url: r.youtube_url || null,
      services: r.services.split("|").filter(Boolean),
      partner_id: user.id,
      status: "pending",
      opening_hours: {
        weekly: Object.fromEntries(WEEK_DAYS.map(day => [day, {
          closed: r[`${day}_closed`] === "true",
          open: r[`${day}_open`] || "",
          close: r[`${day}_close`] || "",
        }])),
        public_holidays: { closed: true, open: "", close: "" },
        special_days: [],
      },
      gallery_urls: [],
    };
  });

  if (errors.length) return NextResponse.json({ error: "CSV validation failed.", errors }, { status: 422 });

  const { data, error } = await supabase
    .from("partner_salons")
    .insert(payload)
    .select("id, name, city, status");

  if (error) {
    console.error("Store CSV import failed:", error);
    return NextResponse.json({ error: "The stores could not be imported." }, { status: 500 });
  }

  return NextResponse.json({ imported: data?.length ?? 0, stores: data ?? [] });
}
