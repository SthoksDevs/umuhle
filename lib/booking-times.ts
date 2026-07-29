// lib/booking-times.ts
// Single source of truth for the 30-minute booking slot grid (07:00–19:30),
// shared by the store[id] booking form and the homepage artist booking
// drawer so both pickers offer the same slots and stay in sync.

export const TIMES: string[] = [];
for (let h = 7; h < 20; h++) {
  TIMES.push(`${String(h).padStart(2, "0")}:00`);
  TIMES.push(`${String(h).padStart(2, "0")}:30`);
}
