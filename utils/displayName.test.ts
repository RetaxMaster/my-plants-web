import { describe, expect, it } from 'vitest';
import { speciesPrimaryName, plantTitle } from './displayName.js';

describe('speciesPrimaryName (locale-aware)', () => {
  const s = { speciesCommonNameEs: 'Lengua de suegra', speciesCommonNameEn: 'Snake plant', speciesScientificName: 'Dracaena trifasciata' };
  it('picks the ES name in es', () => expect(speciesPrimaryName(s, 'es')).toBe('Lengua de suegra'));
  it('picks the EN name in en', () => expect(speciesPrimaryName(s, 'en')).toBe('Snake plant'));
  it('cross-locale falls back to the other language', () =>
    expect(speciesPrimaryName({ speciesCommonNameEs: null, speciesCommonNameEn: 'Snake plant', speciesScientificName: 'X' }, 'es')).toBe('Snake plant'));
  it('falls back to scientific, then slug', () => {
    expect(speciesPrimaryName({ speciesScientificName: 'Dracaena fragrans' }, 'es')).toBe('Dracaena fragrans');
    expect(speciesPrimaryName({ speciesSlug: 'x' }, 'en')).toBe('x');
  });
});

describe('plantTitle', () => {
  it('prefers the nickname', () =>
    expect(plantTitle({ nickname: 'Monty', speciesCommonNameEs: 'Lengua de suegra', speciesCommonNameEn: 'Snake plant' }, 'en')).toBe('Monty'));
  it('falls back to the localized species name', () =>
    expect(plantTitle({ nickname: null, speciesCommonNameEs: 'Lengua de suegra', speciesCommonNameEn: 'Snake plant' }, 'es')).toBe('Lengua de suegra'));
});
