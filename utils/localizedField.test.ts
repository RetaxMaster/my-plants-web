import { describe, expect, it } from 'vitest';
import { pickLocalized } from './localizedField.js';

describe('pickLocalized', () => {
  it('prefers the active locale value', () => {
    expect(pickLocalized('es', 'Hola', 'Hi')).toBe('Hola');
    expect(pickLocalized('en', 'Hola', 'Hi')).toBe('Hi');
  });
  it('falls back to the other language when the preferred one is null', () => {
    expect(pickLocalized('en', 'Hola', null)).toBe('Hola');
    expect(pickLocalized('es', null, 'Hi')).toBe('Hi');
  });
  it('returns null only when both are absent', () => {
    expect(pickLocalized('es', null, null)).toBeNull();
    expect(pickLocalized('en', undefined, undefined)).toBeNull();
  });
});
