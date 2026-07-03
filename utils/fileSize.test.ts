import { describe, expect, it } from 'vitest';
import { formatFileSize } from './fileSize.js';

describe('formatFileSize', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });
  it('formats KB', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });
  it('formats MB', () => {
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
