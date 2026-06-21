import type { CitySearchResult } from '../types/api.js';

// Builds the friendly display name stored as City.name, e.g. "Guadalajara, Jalisco, Mexico".
// Drops empty admin1/country segments so a sparse result still reads cleanly.
export function friendlyCityLabel(sel: Pick<CitySearchResult, 'name' | 'admin1' | 'country'>): string {
  return [sel.name, sel.admin1, sel.country].filter((part) => part && part.trim().length > 0).join(', ');
}
