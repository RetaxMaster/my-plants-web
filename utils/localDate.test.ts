import { afterEach, describe, expect, it } from 'vitest';
import { calendarDaysBetween, calendarDaysSince, ymdToLocalDate } from './localDate.js';

const REAL_TZ = process.env.TZ;
// Hermetic timezone juggling: every test that needs a specific zone asks for it, and we always put the
// ambient one back — otherwise these tests would leak their zone into every file that runs after them.
function inTimeZone(tz: string) {
  process.env.TZ = tz;
}
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe('ymdToLocalDate', () => {
  it('yields the exact calendar day the string names, at local midnight', () => {
    const d = ymdToLocalDate('2026-07-06');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July (0-indexed)
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('does NOT roll back a day the way new Date(ymd) (UTC midnight) does in negative offsets', () => {
    // `new Date('2026-07-06')` is UTC midnight; in a UTC-6 zone its LOCAL date is Jul 5. The helper
    // must keep the named calendar day (6) regardless of the runner's timezone.
    expect(ymdToLocalDate('2026-07-06').getDate()).toBe(6);
    expect(ymdToLocalDate('2026-01-01').getFullYear()).toBe(2026);
    expect(ymdToLocalDate('2026-01-01').getMonth()).toBe(0);
    expect(ymdToLocalDate('2026-01-01').getDate()).toBe(1);
  });

  it('handles month/day boundaries', () => {
    const d = ymdToLocalDate('2026-12-31');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  it('accepts a full ISO datetime string (e.g. Prisma acquiredOn) without returning an Invalid Date', () => {
    const dt = ymdToLocalDate('2026-03-15T00:00:00.000Z');
    expect(Number.isNaN(dt.getTime())).toBe(false);
    expect([dt.getFullYear(), dt.getMonth(), dt.getDate()]).toEqual([2026, 2, 15]); // local Mar 15
  });
});

describe('calendarDaysBetween / calendarDaysSince', () => {
  it('counts the owner\'s calendar days, not the UTC ones, once the UTC day has rolled over', () => {
    inTimeZone('America/Mexico_City'); // UTC-6: the UTC day flips to tomorrow at 18:00 local
    const lateEvening = new Date(2026, 6, 13, 23, 15); // Jul 13, 23:15 local = Jul 14, 05:15 UTC
    // Entered today. It happened today, no matter what a clock in Greenwich says.
    expect(calendarDaysSince('2026-07-13', lateEvening)).toBe(0);
    expect(calendarDaysSince('2026-07-12', lateEvening)).toBe(1);
    expect(calendarDaysSince('2026-07-08', lateEvening)).toBe(5);
    // And the same day counted forwards: still due today, not overdue.
    expect(calendarDaysBetween(lateEvening, ymdToLocalDate('2026-07-13'))).toBe(0);
    expect(calendarDaysBetween(lateEvening, ymdToLocalDate('2026-07-14'))).toBe(1);
  });

  it('holds in a POSITIVE offset too, where the error would run the other way', () => {
    inTimeZone('Asia/Tokyo'); // UTC+9: at 08:00 local the UTC clock is still on yesterday
    const earlyMorning = new Date(2026, 6, 13, 8, 0); // Jul 13, 08:00 local = Jul 12, 23:00 UTC
    expect(calendarDaysSince('2026-07-13', earlyMorning)).toBe(0);
    expect(calendarDaysSince('2026-07-12', earlyMorning)).toBe(1);
  });

  it('counts a DST day as ONE day, though it is 23 or 25 hours long', () => {
    // A fixed-millisecond subtraction would return 0.96 or 1.04 days here and round to the wrong side of
    // the boundary. Normalizing the local Y/M/D triple through Date.UTC is what makes this exact.
    inTimeZone('America/New_York');
    // Spring forward: Mar 8 2026 is a 23-hour day.
    expect(calendarDaysBetween(new Date(2026, 2, 7, 12, 0), new Date(2026, 2, 8, 12, 0))).toBe(1);
    // Fall back: Nov 1 2026 is a 25-hour day.
    expect(calendarDaysBetween(new Date(2026, 10, 1, 12, 0), new Date(2026, 10, 2, 12, 0))).toBe(1);
  });

  it('is signed: negative looking backwards, positive looking forwards', () => {
    inTimeZone('America/Mexico_City');
    const now = new Date(2026, 6, 13, 10, 0);
    expect(calendarDaysBetween(now, ymdToLocalDate('2026-07-10'))).toBe(-3);
    expect(calendarDaysBetween(now, ymdToLocalDate('2026-07-16'))).toBe(3);
  });

  it('crosses month and year boundaries', () => {
    inTimeZone('America/Mexico_City');
    expect(calendarDaysSince('2025-12-31', new Date(2026, 0, 1, 20, 0))).toBe(1);
    expect(calendarDaysSince('2026-01-31', new Date(2026, 1, 1, 20, 0))).toBe(1);
  });
});
