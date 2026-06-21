// The species' human-facing name: common name, then scientific, then slug.
export function speciesPrimaryName(s: {
  speciesCommonName?: string | null;
  speciesScientificName?: string | null;
  speciesSlug?: string | null;
}): string {
  return s.speciesCommonName || s.speciesScientificName || s.speciesSlug || '';
}

// A plant's title: the owner's nickname if set, otherwise the species' primary name.
export function plantTitle(p: {
  nickname?: string | null;
  speciesCommonName?: string | null;
  speciesScientificName?: string | null;
  speciesSlug?: string | null;
}): string {
  return p.nickname || speciesPrimaryName(p);
}
