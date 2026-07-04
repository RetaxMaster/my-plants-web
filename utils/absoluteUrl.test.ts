import { describe, expect, it } from 'vitest';
import { absoluteUrl } from './absoluteUrl.js';

describe('absoluteUrl', () => {
  it('keeps an already-absolute http(s) URL', () => {
    expect(absoluteUrl('https://cdn.example.com/a.jpg', 'https://site.com')).toBe('https://cdn.example.com/a.jpg');
  });
  it('resolves a site-relative path against the origin', () => {
    expect(absoluteUrl('/uploads/a.jpg', 'https://site.com')).toBe('https://site.com/uploads/a.jpg');
  });
  it('returns null for null/empty/whitespace', () => {
    expect(absoluteUrl(null, 'https://site.com')).toBeNull();
    expect(absoluteUrl('', 'https://site.com')).toBeNull();
    expect(absoluteUrl('   ', 'https://site.com')).toBeNull();
  });
  it('returns null for a non-http(s) scheme', () => {
    expect(absoluteUrl('data:image/png;base64,xxxx', 'https://site.com')).toBeNull();
    expect(absoluteUrl('javascript:alert(1)', 'https://site.com')).toBeNull();
  });
});
