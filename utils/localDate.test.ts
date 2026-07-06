import { describe, expect, it } from 'vitest';
import { ymdToLocalDate } from './localDate.js';

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
