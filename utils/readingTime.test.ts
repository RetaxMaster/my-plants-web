import { describe, expect, it } from 'vitest';
import { countWords, readingMinutes } from './readingTime.js';

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('one two three')).toBe(3);
  });
  it('collapses runs of whitespace and trims', () => {
    expect(countWords('  a\n\nb   c \t d ')).toBe(4);
  });
  it('is 0 for empty / whitespace-only input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });
});

describe('readingMinutes', () => {
  it('is at least 1 minute even for a few words', () => {
    expect(readingMinutes('just a few words')).toBe(1);
  });
  it('rounds up at ~200 words per minute', () => {
    const words201 = Array.from({ length: 201 }, () => 'w').join(' ');
    expect(readingMinutes(words201)).toBe(2);
  });
  it('is 1 for empty input (never 0)', () => {
    expect(readingMinutes('')).toBe(1);
  });
});
