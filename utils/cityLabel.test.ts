import { describe, expect, it } from 'vitest';
import { friendlyCityLabel } from './cityLabel.js';

describe('friendlyCityLabel', () => {
  it('joins all three parts present', () => {
    expect(friendlyCityLabel({ name: 'Guadalajara', admin1: 'Jalisco', country: 'Mexico' }))
      .toBe('Guadalajara, Jalisco, Mexico');
  });

  it('drops a missing admin1', () => {
    expect(friendlyCityLabel({ name: 'Guadalajara', admin1: '', country: 'Mexico' }))
      .toBe('Guadalajara, Mexico');
  });

  it('drops both missing admin1 and country', () => {
    expect(friendlyCityLabel({ name: 'Somewhere', admin1: '', country: '' }))
      .toBe('Somewhere');
  });
});
