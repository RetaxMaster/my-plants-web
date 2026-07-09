import { describe, expect, it } from 'vitest';
import { toNullableNumber } from './nullableNumber.js';

describe('toNullableNumber', () => {
  it('keeps a finite number', () => {
    expect(toNullableNumber(18)).toBe(18);
    expect(toNullableNumber(0)).toBe(0);
    expect(toNullableNumber(-3.5)).toBe(-3.5);
  });

  it('maps a cleared input ("") to null', () => {
    expect(toNullableNumber('')).toBeNull();
  });

  it('maps a non-finite number to null', () => {
    expect(toNullableNumber(Number.NaN)).toBeNull();
    expect(toNullableNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('maps a non-numeric string to null', () => {
    expect(toNullableNumber('abc')).toBeNull();
  });
});
