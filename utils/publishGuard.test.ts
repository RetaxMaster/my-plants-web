import { describe, expect, it } from 'vitest';
import { needsCoverWarning } from './publishGuard.js';

describe('needsCoverWarning', () => {
  it('warns when there is no cover image (null)', () => {
    expect(needsCoverWarning(null)).toBe(true);
  });
  it('warns when the cover url is undefined', () => {
    expect(needsCoverWarning(undefined)).toBe(true);
  });
  it('warns when the cover url is an empty string', () => {
    expect(needsCoverWarning('')).toBe(true);
  });
  it('does not warn when a cover url is present', () => {
    expect(needsCoverWarning('https://cdn.example.com/cover.jpg')).toBe(false);
  });
});
