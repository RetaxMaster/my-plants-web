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

// Parse a date-valued string to a Date at LOCAL midnight (TZ-agnostic calendar day).
//
// Accepts EITHER a date-only `YYYY-MM-DD` (e.g. API fields emitted via ymdFromUtcDate) OR a full ISO
// datetime `YYYY-MM-DDThh:mm:ssZ` (e.g. Prisma-serialized `acquiredOn`, which is UTC-midnight of the
// entered date). We take the leading 10-char calendar-date portion and build the Date from its numeric
// components (year, month-1, day).
//
// Why: `new Date('2026-07-06')` parses as UTC midnight, so in a negative offset such as
// America/Mexico_City (UTC-6) it becomes Jul 5 18:00 local and renders the PREVIOUS day. Building from
// components pins the calendar day the string names, regardless of the viewer's timezone. Slicing to
// the date portion FIRST also means a datetime string never yields an Invalid Date (splitting the raw
// ISO string would make the day part `15T00:00:00.000Z` → NaN → an Invalid Date that vue-i18n's `$d()`
// throws on). Use for date-valued fields (acquiredOn, occurredOn, lastRepottedOn, …) fed to
// `$d`/display — NOT for the current time (`new Date()`).
export function ymdToLocalDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
