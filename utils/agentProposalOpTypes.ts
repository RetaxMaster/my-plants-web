import type { AgentProposalOperationType } from '../types/api';

// The wire discriminant carries a dot ('profile.update'), and a dot inside an i18n leaf key is read by
// vue-i18n as a nesting separator — so it would never resolve. Map to flat camelCase keys instead.
//
// ONE map, imported by BOTH the banner (AgentProposalBanner.vue) and the locale-parity test
// (i18n/locales.parity.test.ts). Two hand-lists of the same fact is exactly the fork this project forbids
// — it is what would let a new operation type ship with a green test and a raw, untranslated key path
// rendered in front of the owner.
//
// Two independent guards, not one: this map's COMPLETENESS (every operation type has a key here) is
// enforced by the `Record<AgentProposalOperationType, string>` annotation itself — omitting one is a
// TypeScript compile error. `i18n/locales.parity.test.ts` enforces the OTHER half — that the LOCALE FILES
// actually resolve every one of these keys to a non-empty label in both `en.json` and `es.json` — which
// TypeScript cannot check, since a JSON i18n leaf is just a string key to it. A sixteenth operation type
// therefore fails one guard or the other rather than reaching the owner as a raw key path.
export const OP_TYPE_KEY: Record<AgentProposalOperationType, string> = {
  'profile.update': 'profileUpdate',
  'plant.update': 'plantUpdate',
  'plant.create': 'plantCreate',
  'progress.create': 'progressCreate',
  'progress.update': 'progressUpdate',
  'progress.delete': 'progressDelete',
  'frequency.set': 'frequencySet',
  'frequency.clear': 'frequencyClear',
  'care.done': 'careDone',
  'place.create': 'placeCreate',
  'place.update': 'placeUpdate',
  'city.create': 'cityCreate',
  'city.update': 'cityUpdate',
  'clinical_record.create': 'clinicalRecordCreate',
  'clinical_record.update': 'clinicalRecordUpdate',
};
