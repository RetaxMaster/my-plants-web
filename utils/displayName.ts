import { pickLocalized } from './localizedField.js';

// The species' human-facing name for a locale: the localized common name (with cross-locale fallback),
// then scientific, then slug. One source of the rule so no surface forks it.
export function speciesPrimaryName(
  s: {
    speciesCommonNameEs?: string | null;
    speciesCommonNameEn?: string | null;
    speciesScientificName?: string | null;
    speciesSlug?: string | null;
  },
  locale: string,
): string {
  const common = pickLocalized(locale, s.speciesCommonNameEs ?? null, s.speciesCommonNameEn ?? null);
  return common || s.speciesScientificName || s.speciesSlug || '';
}

// A plant's title: the owner's nickname if set, otherwise the localized species name.
export function plantTitle(
  p: {
    nickname?: string | null;
    speciesCommonNameEs?: string | null;
    speciesCommonNameEn?: string | null;
    speciesScientificName?: string | null;
    speciesSlug?: string | null;
  },
  locale: string,
): string {
  return p.nickname || speciesPrimaryName(p, locale);
}
