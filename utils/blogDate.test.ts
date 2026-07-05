import { describe, expect, it } from 'vitest';
import { formatBlogDate, formatBlogDateFull } from './blogDate.js';

describe('formatBlogDate', () => {
  it('returns an empty string for null/empty', () => {
    expect(formatBlogDate('es', null)).toBe('');
    expect(formatBlogDate('en', '')).toBe('');
  });
  it('formats an ISO date into a non-empty localized string', () => {
    expect(formatBlogDate('en', '2026-06-12T00:00:00.000Z').length).toBeGreaterThan(0);
    expect(formatBlogDate('es', '2026-06-12T00:00:00.000Z').length).toBeGreaterThan(0);
  });
});

describe('formatBlogDateFull', () => {
  // 2026-07-03T20:30 in America/Mexico_City (UTC-6) → 03:30 UTC next day.
  const iso = '2026-07-04T02:30:00.000Z';
  it('returns an empty string for null/empty', () => {
    expect(formatBlogDateFull('es', null)).toBe('');
    expect(formatBlogDateFull('en', undefined)).toBe('');
  });
  it('formats ES as "<day> de <month> de <year> a las <time> p.m." (fixed MX zone)', () => {
    const s = formatBlogDateFull('es', iso);
    expect(s).toContain('3 de julio de 2026');
    expect(s).toContain('a las');
    expect(s).toContain('8:30');
    expect(s.toLowerCase()).toContain('p.m.');
  });
  it('formats EN with "at" and the same instant in the fixed zone', () => {
    const s = formatBlogDateFull('en', iso);
    expect(s).toContain('July 3, 2026');
    expect(s).toContain('at');
    expect(s).toContain('8:30');
  });
  it('never leaves a narrow no-break space (U+202F) in the output', () => {
    expect(formatBlogDateFull('es', iso)).not.toContain(String.fromCharCode(0x202f));
  });
});
