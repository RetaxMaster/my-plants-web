import { describe, it, expect } from 'vitest';
import { speciesPrimaryName, plantTitle } from './displayName.js';

describe('displayName', () => {
  it('species primary name prefers the common name', () => {
    expect(speciesPrimaryName({ speciesCommonName: 'Snake plant', speciesScientificName: 'Dracaena trifasciata' }))
      .toBe('Snake plant');
  });
  it('falls back to scientific then slug', () => {
    expect(speciesPrimaryName({ speciesCommonName: '', speciesScientificName: '', speciesSlug: 'x' })).toBe('x');
  });
  it('plant title prefers the nickname', () => {
    expect(plantTitle({ nickname: 'Monty', speciesCommonName: 'Snake plant', speciesScientificName: 'D. trifasciata' }))
      .toBe('Monty');
  });
  it('plant title falls back to the common name when there is no nickname', () => {
    expect(plantTitle({ nickname: null, speciesCommonName: 'Snake plant', speciesScientificName: 'D. trifasciata' }))
      .toBe('Snake plant');
  });
});
