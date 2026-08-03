import type { AgentProposalOperationType } from '../types/api';

// The wire discriminant carries a dot ('profile.update'), and a dot inside an i18n leaf key is read by
// vue-i18n as a nesting separator — so it would never resolve. Map to flat camelCase keys instead.
//
// ONE map, consumed by the banner (AgentProposalBanner.vue) AND by `i18n/locales.parity.test.ts`. Two
// hand-lists of the same fact is exactly the fork this project forbids — it is what would let a new
// operation type ship with a green test and a raw, untranslated key path rendered in front of the owner.
//
// TWO guards, both wired up:
//   1. Compile time — the `Record<AgentProposalOperationType, string>` annotation makes omitting an
//      operation type a TypeScript error, and `AgentProposalOperationType` is itself an alias of the
//      shared package's `ProposalOperationType` union, so growing the shared contract breaks this build
//      until the map grows with it.
//   2. Runtime — `utils/agentProposalOpTypes.test.ts` compares this map's key set against the package's
//      own `PROPOSAL_OPERATION_TYPES`, and `i18n/locales.parity.test.ts` maps through this map per
//      namespace against that namespace's scope in the capability map (`permittedTypesFor`), so the
//      LOCALE FILES are asserted to actually resolve every permitted key to a non-empty label in both
//      `en.json` and `es.json` — something TypeScript cannot check, since a JSON i18n leaf is just a
//      string key to it.
// A new operation type therefore fails one guard or the other rather than reaching the owner as a
// raw key path.
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
  'care.postpone': 'carePostpone',
  'place.create': 'placeCreate',
  'place.update': 'placeUpdate',
  'city.create': 'cityCreate',
  'city.update': 'cityUpdate',
  'clinical_record.create': 'clinicalRecordCreate',
  'clinical_record.update': 'clinicalRecordUpdate',
  'note.create': 'noteCreate',
  'plant.memorialize': 'plantMemorialize',
  'plant.gift': 'plantGift',
  'substrate.refresh': 'substrateRefresh',
};
