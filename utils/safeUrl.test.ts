import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from './safeUrl.js';

describe('safeHttpUrl', () => {
  it('allows absolute http(s) URLs', () => {
    expect(safeHttpUrl('https://myplants.app/premium')).toBe('https://myplants.app/premium');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com');
  });
  it('allows site-relative paths', () => {
    expect(safeHttpUrl('/premium')).toBe('/premium');
  });
  it('rejects javascript: and data: schemes', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('mailto:foo@bar.com')).toBeNull();
  });
  it('rejects protocol-relative and garbage', () => {
    expect(safeHttpUrl('//evil.com')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
  it('returns null for null/empty', () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
  });
});
