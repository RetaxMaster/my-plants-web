import { describe, expect, it } from 'vitest';
import { formatBlogDate } from './blogDate.js';

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
