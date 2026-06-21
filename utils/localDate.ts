// Local calendar date helpers as YYYY-MM-DD, built from the browser's LOCAL timezone components.
//
// Never derive a care-action date with `new Date().toISOString().slice(0, 10)`: toISOString() is
// UTC, so in a negative offset such as America/Mexico_City (UTC-6) it rolls over to "tomorrow"
// after early evening — which would record occurredOn / postpone anchors a day off and corrupt the
// schedule and adherence. The app runs locally on the owner's machine, so the browser's local day
// is the owner's day; building the string from local Date components keeps the calendar date right.

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Today's local calendar date as YYYY-MM-DD.
export function todayYmd(): string {
  return ymd(new Date());
}

// Today shifted by `days` (e.g. +1 = tomorrow), as a local YYYY-MM-DD. Uses setDate so month/year
// rollover and DST are handled by the Date arithmetic rather than fixed-millisecond addition.
export function addDaysYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}
