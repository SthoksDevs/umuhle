// lib/opening-hours.ts
//
// Single source of truth for reading the `opening_hours` JSONB column on
// partner_salons — an object keyed by weekday with a per-day {open, close,
// closed}, plus explicit date overrides in special_days. This is exactly
// the shape app/dashboard/page.tsx's SalonForm (the salon listing form)
// writes.
//
// Previously app/stores/page.tsx and app/stores/[id]/page.tsx each had
// their own isOpenNow()/dayOk() written against an older flat
// {days: string[], open, close} shape — one opening_hours never actually
// had, since the form was rebuilt to the weekly/special_days shape at some
// point without the read side being updated. Every salon (including fully
// filled-in ones, e.g. "Sthoks Barber") read as permanently closed as a
// result. Fixed by centralising the read logic here so it can't drift from
// the write side again.
//
// Public holidays are intentionally NOT auto-detected (that needs a South
// African public-holiday calendar, which nothing in this app has) — only
// the explicit special_days overrides an owner has actually entered.

export type DayHours = { open?: string; close?: string; closed: boolean };
export type SpecialDay = { date: string; closed: boolean; open?: string; close?: string };
export type OpeningHours = {
  weekly?: {
    sunday: DayHours; monday: DayHours; tuesday: DayHours; wednesday: DayHours;
    thursday: DayHours; friday: DayHours; saturday: DayHours;
  };
  public_holidays?: DayHours;
  special_days?: SpecialDay[];
};

// Index-matches Date.getDay() (0 = Sunday … 6 = Saturday).
const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export const WEEKDAY_LABELS: Record<typeof WEEKDAY_KEYS[number], string> = {
  sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday",
};

function hoursFor(oh: OpeningHours, date: Date): DayHours | null {
  const iso = date.toISOString().slice(0, 10);
  const special = oh.special_days?.find(sd => sd.date === iso);
  if (special) return special;
  const key = WEEKDAY_KEYS[date.getDay()];
  return oh.weekly?.[key] ?? null;
}

export function isOpenNow(oh: OpeningHours | null | undefined): { open: boolean; label: string } {
  if (!oh?.weekly) return { open: false, label: "Hours not listed" };
  const now = new Date();
  const today = hoursFor(oh, now);
  const cur = now.getHours() * 60 + now.getMinutes();

  if (today && !today.closed && today.open && today.close) {
    const [oH, oM] = today.open.split(":").map(Number);
    const [cH, cM] = today.close.split(":").map(Number);
    if (cur >= oH * 60 + oM && cur < cH * 60 + cM) {
      return { open: true, label: `Open · closes ${today.close}` };
    }
  }

  // Walk forward up to a week to find the next open day, for the "closed" label.
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dayHours = hoursFor(oh, d);
    if (dayHours && !dayHours.closed && dayHours.open) {
      const when = i === 1 ? "tomorrow" : d.toLocaleDateString("en-ZA", { weekday: "short" });
      return { open: false, label: `Closed · opens ${when} ${dayHours.open}` };
    }
  }
  return { open: false, label: "Closed" };
}

// Whether the salon is open (per its weekly schedule / special-day
// override) on a given calendar date — used to validate a chosen booking
// date, independent of the current time.
export function isOpenOnDate(oh: OpeningHours | null | undefined, date: Date): boolean {
  if (!oh?.weekly) return true; // hours not set up — don't block booking on it
  const hours = hoursFor(oh, date);
  return !!hours && !hours.closed;
}

// The open/close range for a given calendar date, or null if closed /
// hours not set up for that date.
export function hoursRangeForDate(oh: OpeningHours | null | undefined, date: Date): { open: string; close: string } | null {
  if (!oh?.weekly) return null;
  const hours = hoursFor(oh, date);
  if (!hours || hours.closed || !hours.open || !hours.close) return null;
  return { open: hours.open, close: hours.close };
  } 
