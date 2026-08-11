import type { AgentCommand, AgentProviderStatus, CommandCatalog, SessionHistory } from '@retaxmaster/agents-realtime-protocol';
import type { TaskCode } from '../utils/tasks.js';
// The survey affordance's verdict vocabulary lives with the RULE that reads it, imported here rather than
// re-declared, so the wire shape and the rule can never drift apart.
import type { TodaysVerdict } from '../utils/waterSurvey.js';
import type { CompressedUpload } from '../composables/useImageCompression';
import type {
  PotType, SoilMix, GrowthHabit, WindowDist,
} from '@retaxmaster/my-plants-species-schema/plant-profile-constants';
import type { Airflow } from '@retaxmaster/my-plants-species-schema/place-constants';
import { PHOTO_STATUSES, PHOTO_FAILURE_KINDS, PHOTO_FAILURE_CODES } from '@retaxmaster/my-plants-species-schema/photo-contract-constants';
import type { ProgressTagKey } from '@retaxmaster/my-plants-species-schema/progress-tag-constants';
import type { InstrumentId, InstrumentRow } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import { RECOMMENDATIONS, HOLD_BASES, UNAVAILABLE_REASONS } from '@retaxmaster/my-plants-species-schema/watering-verdict-constants';
// `RepotEvidenceClass` is the SHARED contract's own union (`REPOT_EVIDENCE_CLASSES`), imported for the same
// reason `RepotEvaluationSubmit` is: a locally re-typed copy is a fork, and the class list is exactly the
// kind of thing that would silently drift the day a fifth class is added.
//
// `InstrumentCalibration` and `ReadingVerdict` are the same shared contract's `soil-reading.ts` types,
// imported here for the identical reason — see that file's own root export (`index.ts` re-exports
// `soil-reading.js` alongside `proposal-operations.js`, the very module `RepotEvaluationSubmit`/
// `RepotEvidenceClass` above already come from). A prior version of this file re-declared them
// structurally, reasoning that "no Zod-free subpath exports them, so importing them pulls Zod into the web
// bundle" — that reasoning does not hold for a `import type`, which TypeScript erases entirely (zero
// runtime JS, so zero bytes of Zod), exactly like the import one line up. The empirical build check
// (`npm run build`, confirming `zod`'s presence in the client bundle is unaffected) is what actually backs
// this, not the reasoning alone — see that check's own note for what it found.
// `WateringRelation` is the same shared contract's newest `soil-reading.ts` type (owner-ruled, 2026-08-08),
// imported alongside its siblings above for the identical reason — never re-declared, so the two-value
// union can't silently drift.
import type {
  ProposalOperationType, RepotEvaluationSubmit, RepotEvidenceClass, InstrumentCalibration, ReadingVerdict,
  WateringRelation,
} from '@retaxmaster/my-plants-species-schema';
export type {
  ProgressTagKey, RepotEvaluationSubmit, RepotEvidenceClass, InstrumentCalibration, ReadingVerdict,
  WateringRelation,
};

export type ViabilityLevel = 'good' | 'caution' | 'poor';

export interface SpeciesSummary { slug: string; scientificName: string; commonNameEs: string | null; commonNameEn: string | null }

export interface City {
  id: string; name: string; latitude: number; longitude: number; timezone: string; isPrimary: boolean;
}
export interface CreateCity {
  name: string; latitude: number; longitude: number; timezone: string; isPrimary?: boolean;
}
export interface CitySearchResult {
  name: string; country: string; admin1: string; latitude: number; longitude: number; timezone: string;
}

export type LightType = 'DIRECT' | 'BRIGHT_INDIRECT' | 'MEDIUM' | 'LOW';
export type HumidityCharacter = 'DRY' | 'NORMAL' | 'HUMID';

export interface Place {
  id: string; ownerId: string; cityId: string; name: string; indoor: boolean; lightType: LightType;
  climateControlled: boolean; humidityCharacter: HumidityCharacter | null;
  indoorTempMinC: number | null; indoorTempMaxC: number | null; airflow: Airflow | null;
}
export interface CreatePlace {
  cityId: string; name: string; indoor: boolean; lightType: LightType;
  climateControlled?: boolean; humidityCharacter?: HumidityCharacter;
  indoorTempMinC?: number | null; indoorTempMaxC?: number | null; airflow?: Airflow;
}

// A plant's lifecycle state (Plant Lifecycle feature). ACTIVE is the normal, care-engine-tracked state;
// MEMORIAL/GIFTED are frozen terminal-or-reversible states (spec: memorialize/gift/revive).
export type PlantLifecycleState = 'ACTIVE' | 'MEMORIAL' | 'GIFTED';

export interface Plant {
  // placeId is NULL for a frozen import-created plant (MEMORIAL/GIFTED created with no place). The type
  // must reflect that so consumers null-check rather than blind-deref a snapshot-only frozen plant.
  id: string; ownerId: string; placeId: string | null; speciesSlug: string; nickname: string | null; acquiredOn: string;
  speciesScientificName: string; speciesCommonNameEs: string | null; speciesCommonNameEn: string | null;
  coverImageUrl: string | null;
  // The species' growth habit (spec §2.4) — drives the measure-info modal. Null for an un-curated species.
  speciesGrowthHabit: GrowthHabit | null;
  lifecycleState: PlantLifecycleState;
  // Snapshot of the place/city labels at the moment a plant froze (memorialize/gift). Null while ACTIVE.
  frozenPlaceLabel: string | null;
  frozenCityLabel: string | null;
}

export interface Viability { level: ViabilityLevel; reasons: string[] }
export interface UpdatePlant { nickname?: string; placeId?: string }
export interface UpdatePlace {
  name?: string; climateControlled?: boolean; lightType?: LightType;
  humidityCharacter?: HumidityCharacter | null; airflow?: Airflow | null;
  indoorTempMinC?: number | null; indoorTempMaxC?: number | null;
}
export interface CreatePlant {
  // Optional: an import-on-create (a MEMORIAL/GIFTED plant carries no place, per the ACTIVE ⇒ place
  // invariant). Absent/undefined means a normal ACTIVE create, which still requires a place.
  placeId?: string; speciesSlug: string; nickname?: string; acquiredOn: string;
  lastDone?: { task: CareActionTask; doneOn: string }[]; // PROGRESS excluded — journaled, never seeded
  // Import-on-create: creates the plant already frozen (MEMORIAL/GIFTED) with an import progress entry.
  lifecycleState?: 'MEMORIAL' | 'GIFTED';
  /** Spec 1 §5.5 rung 1 — YYYY-MM-DD. Optional; blank means the engine assumes charge still remains and
   * withholds the first feeding until it expires — the safe default (a delayed feed self-corrects; an
   * early one does not). */
  substrateRefreshedOn?: string;
  /** Tri-state by PRESENCE: omitted = derive from the mix, true = fresh charged, false = reused/inert. */
  substrateCharged?: boolean;
}

// --- Plant physical profile (spec 1 vocabulary; all fields optional/nullable) ---
export interface PlantProfile {
  windowDistance: WindowDist | null;
  growLight: boolean | null;
  potType: PotType | null;
  potSizeCm: number | null;
  hasDrainage: boolean | null;
  soilMix: SoilMix | null;
  growthHabit: GrowthHabit | null;
  ageMonths: number | null;
  nearHeater: boolean | null;
}
// PATCH body: absent key = leave unchanged, explicit null = clear.
export type PlantProfileUpdate = Partial<PlantProfile>;

// One item in the plant photos gallery (every progress photo, flattened, newest-first).
export interface PlantPhotoItem {
  id: string; imageUrl: string; entryId: string; occurredOn: string; sortOrder: number;
}

// Care-basis summary fields carried by GET /plants/:id (spec 2 §6). ProgressHealth is defined below.
// health is nullable: the latest entry can be an import entry (Plant Lifecycle feature), which is
// created with health: null.
export interface PlantLatestProgress {
  entryId: string; occurredOn: string; health: ProgressHealth | null; observations: string | null;
}
export interface PlantDerived {
  heightCm: number | null;
  lastRepottedOn: string | null;
}
// GET /plants/:id — the plant view enriched with the care-basis payload. GET /plants returns Plant[].
export interface PlantDetail extends Plant {
  profile: PlantProfile;
  latestProgress: PlantLatestProgress | null;
  derived: PlantDerived;
}

// `pendingEvaluation` (repoteval:27's own dependency): present on the REPOT row iff an unresolved
// evaluation exists, null on every other task and when nothing is pending. Mirrors PlantCareTask's own
// field exactly (same shape, same source) — added to /care-plan/today's response so the Today card can
// render its "time to evaluate" vs Done/Postpone state correctly BEFORE any click, never from an
// on-demand per-card fetch. See PendingRepotEvaluation below.
export interface DueTaskResponse {
  plantId: string;
  task: TaskCode;
  nextDueOn: string;
  // Optional at the type level so an older API during a rolling deploy still types — the same convention
  // this file already uses for `crowding`/`juvenile` above (web and api deploy independently, see
  // deploy.sh --web). The runtime read (`pendingEvaluationFor`, pages/index.vue) already defaults to
  // `null` when absent, so this is a type-contract correction with no behavior change.
  pendingEvaluation?: PendingRepotEvaluation | null;
  /**
   * Meaningful ONLY on a `WATER` row (mirrors `pendingEvaluation`'s own REPOT-only convention): `null`
   * on every other task, `true`/`false` on WATER — whether this plant already has a soil reading dated
   * its own local today (measured-verdict-gap spec, Task 47/T6b). Optional at the type level for the
   * same rolling-deploy reason `pendingEvaluation` is; the runtime read (`measuredTodayFor`,
   * pages/index.vue) treats an absent field as "not measured", the safe default (still offers the
   * survey, never silently hides it).
   */
  measuredToday?: boolean | null;
  /**
   * Meaningful ONLY on a `WATER` row, same convention as the two fields above: WHAT today's reading said
   * (`'WATER_NOW'` / `'POSTPONE'` / `'NONE'`), or `null` for "no reading today" and for every non-WATER
   * row. `measuredToday` beside it separates those two nulls.
   *
   * This is what the survey affordance branches on (QA finding F1) — `measuredToday` reports only that a
   * measurement happened, and the row needs to know what it DECIDED. Optional at the type level for the
   * same rolling-deploy reason the two fields above are; an absent field reads as `null`, i.e. "nothing
   * measured", the safe default that still OFFERS the survey rather than silently hiding it.
   */
  todaysVerdict?: TodaysVerdict;
}

export type FeedbackType = 'DONE' | 'POSTPONED' | 'SYMPTOM';
export interface Feedback {
  task: TaskCode; type: FeedbackType; occurredOn: string;
  postponeToOn?: string;
  // Feedback reason. For WATER (spec B): captured on an early WATER Done or a WATER Postpone; a slug from
  // EARLY_WATER_REASONS ∪ WATER_POSTPONE_REASONS. For REPOT (spec F): the inspection outcome on a Postpone,
  // a slug from REPOT_POSTPONE_REASONS. Omitted for every other task and for due waterings.
  //
  // A REPOT Postpone sends NO `postponeToOn`: the server derives a FLOOR date from the reason.
  reason?: string;
  /**
   * Free-form event payload. For a REPOT marked DONE this carries the owner's fresh-substrate answer:
   *   { substrateCharged: true }   -> fresh, charged medium
   *   { substrateCharged: false }  -> reused / inert medium
   *   (key ABSENT)                 -> "no sé": derive from the recorded mix.
   * Absent is NOT the same as false — see refreshSubstrateCore's contract on the API side.
   */
  payload?: Record<string, unknown>;
}

export interface OwnerSummary {
  ownerId: string;
  username: string;
  role: 'USER' | 'ADMIN' | null;
}

export interface PlantViability {
  plantId: string; nickname: string | null; speciesSlug: string;
  speciesScientificName: string; speciesCommonNameEs: string | null; speciesCommonNameEn: string | null;
  level: ViabilityLevel; reasons: string[];
  placeCityName: string;
  inPrimaryCity: boolean;
}

// --- Repot evaluation (substrate:13 addendum) ---
/** One catalogue row, already resolved to the request locale by the API. */
export interface RepotSign {
  id: string;
  /** Already localized. NEVER an i18n key — catalogue text is DATA, which is what lets a new species' sign
   *  appear with no code change. Only the modal's FRAME (headings, the two exclusive answers, buttons) is i18n. */
  label: string;
  help: string | null;
  /**
   * The KE's ordinal evidence class, READ-ONLY, used for exactly one thing: ranking the signs the owner did
   * NOT tick so the RE-EVALUATE screen can name one worth going to look for (docs/care-engine.md §7.17
   * defines `strong` as "reliable, but worth confirming with one more" — reasoning that was invisible).
   *
   * The browser can never SEND a class: `repotEvaluationSubmitSchema` is `.strict()` and carries ids and
   * nothing else, so this can never reach the calibration. Optional at the type level for the same
   * rolling-deploy reason `DueTaskResponse.pendingEvaluation` is (web and api deploy independently) — the
   * one consumer treats an absent or unrecognised class as the WEAKEST, so an older API simply produces no
   * suggestion rather than a wrong one.
   */
  evidence?: RepotEvidenceClass;
}

/**
 * `GET /plants/:id/repot-signs` response. `typicalIntervalMonths` is INFORMATIVE-ONLY context rendered next
 * to the questionnaire — how often this species is typically repotted, sourced from the curated species
 * record's `repotting.typicalIntervalMonths`. It feeds no engine input, changes no verdict, no submitted
 * value, and no request body; it is `null` whenever the species is un-curated (see `docs/api/README.md`'s
 * `GET /plants/:id/repot-signs` entry).
 */
export interface RepotSignsResponse {
  signs: RepotSign[];
  typicalIntervalMonths: number | null;
}

export type RepotVerdict = 'REPOT' | 'RE-EVALUATE';

export interface PendingRepotEvaluation {
  id: string;
  verdict: RepotVerdict;
  reevaluateOn: string | null; // YYYY-MM-DD
}

// RepotEvaluationSubmit is schema-owned (re-exported above) — imported, never retyped locally, per the
// project's "no new forks" rule. A previous version of this file duplicated the union here; a Codex review
// (repoteval:24 fix wave) caught the fork and this import replaces it.

export interface RepotEvaluationResult {
  evaluationId: string;
  verdict: RepotVerdict;
  reevaluateOn?: string; // YYYY-MM-DD, present iff verdict is RE-EVALUATE
}

/**
 * The fields a REPOT completion carries — mirrors the API's repotDonePayloadSchema.
 *
 * All three admit "I don't know" — but they spell it differently, and the difference is load-bearing
 * rather than stylistic:
 *   - `potSizeCm` is required-but-NULLABLE (QA round-4 finding 2). `null` is the owner's explicit "I don't
 *     know how wide the new pot is". It used to be required outright, on the reasoning that without the NEW
 *     diameter the crowding ratio would be computed against a pot that no longer exists — which is exactly
 *     why the answer is an explicit `null` and not an omitted key: the null CLEARS the old diameter, so the
 *     ratio stops being computed rather than being computed from a pot that is gone. Requiring a number did
 *     not obtain the truth, it obtained an invented one.
 *   - `soilMix` is required-but-NULLABLE (QA D2). `null` is the owner's explicit "I don't know what I
 *     potted into", and it is sent EXPLICITLY because a repot replaces the medium — omitting the key would
 *     leave the plant's previously recorded mix standing, which is a claim about this pot that is no
 *     longer true.
 *   - `charged` is OPTIONAL BY PRESENCE (FIX D). Absent means "I don't know"; the server then derives the
 *     charge state from the recorded mix. Absence is the right spelling here because `charged` has no
 *     stale prior value to displace — `refreshSubstrateCore` writes the column on every completion.
 *
 * Never round-trip any of those absences into a positive answer: an absent `charged` read back as `false`
 * ("reused"), a null `soilMix` read back as some concrete mix, or a null `potSizeCm` read back as a number
 * all convert a non-answer into a claim the owner never made. See `RepotDoneForm.vue`'s frozenSnapshot
 * hydration for all three.
 */
export interface RepotDonePayload {
  potSizeCm: number | null;
  soilMix: string | null;
  charged?: boolean;
  refreshedOn?: string;
  evaluationId?: string;
}

export interface PlantCareTask {
  task: TaskCode;
  nextDueOn: string;        // YYYY-MM-DD
  daysUntilDue: number;     // <0 overdue, 0 today, >0 upcoming
  status: 'overdue' | 'today' | 'upcoming';
  /** Present on the REPOT entry; `null` on every other task and when nothing is pending. */
  pendingEvaluation: PendingRepotEvaluation | null;
}
export interface PlantCare {
  plantId: string;
  tasks: PlantCareTask[];
  // Added in Phase C — the per-plant viability semaphore for its current place. Null for a frozen plant
  // (Plant Lifecycle feature) — the recompute-free frozen branch never computes a semaphore.
  viability: { level: ViabilityLevel; reasons: string[] } | null;
  // The species' soil-dryness-before-watering slug (e.g. 'mostly-dry'), used by the WATER info modal.
  soilDrynessBeforeWatering?: string;
  // The plant-to-pot crowding index (spec E, Area A). Optional so an older API during a rolling deploy
  // still types. `repotSigns` moved off this shape — see `PlantCareTask.pendingEvaluation` and
  // `getRepotSigns` (repot-evaluation flow, substrate:13 addendum).
  crowding?: {
    index: number | null;
  };
  /**
   * Juvenile state (Spec 2 §7.3). `ageMonths` is the API's EFFECTIVE (aged) value — the same number the
   * care engine reads — so the web never re-derives an age. Optional so an older API during a rolling
   * deploy still types; every consumer must handle its absence as "unknown", never as false.
   */
  juvenile?: {
    isJuvenile: boolean;
    juvenilePeriodMonths: number | null;
    ageMonths: number | null;
  };
  /**
   * The substrate block (Spec 1 §6) — what the medium in this pot holds, and two independent facts
   * about the REPOT date the user is looking at (substrate:13 final ruling).
   *
   * `repotDriver` and `repotOverrideBinding` never claim to be "the reason for the date" on their own —
   * each states one always-true-or-false fact, and the UI renders both:
   * - `repotDriver` says what the engine's OWN ESTIMATE is based on (substrate wearing out vs. crowding).
   *   This is always knowable and always true regardless of any owner override, so it is null ONLY for a
   *   frozen plant, which has no active REPOT task at all.
   * - `repotOverrideBinding` separately says whether an active REPOT override's date matches the displayed
   *   due date — i.e. whether a postponement, from EITHER author, is what is being shown. This can be
   *   true at the same time `repotDriver` names a driver: the engine's estimate and the postponement
   *   are independent facts, not competing explanations for a single cause.
   * - `repotOverrideOrigin` is the THIRD fact, and it exists because reading the second one as "the owner
   *   postponed this" was wrong (QA round 5, finding 1). A REPOT override is written by two different
   *   actors: the owner pressing Postpone (`OWNER`), and the questionnaire answering "not yet"
   *   (`EVALUATION`, which writes no care event and involves no owner decision at all). It is `null`
   *   EXACTLY when `repotOverrideBinding` is false — with nothing binding there is no author to name.
   *   Never re-derive it from `pendingEvaluation`: an evaluation returning a `REPOT` verdict deliberately
   *   leaves an older evaluation-authored override standing, so the latest evaluation names the wrong
   *   author. The API reads it off the override row itself.
   *
   * Null-tolerant but NOT uniformly nullable: every field may be null EXCEPT `chargeDays` (always a
   * resolved number, 0 when unknown) and `repotOverrideBinding` (always a resolved boolean).
   *
   * Optional at the type level so an older API during a rolling deploy still types — the same convention
   * `crowding` above already follows.
   */
  substrate?: {
    refreshedOn: string | null;        // YYYY-MM-DD
    soilMix: string | null;
    charged: boolean | null;
    chargeDays: number;
    chargeEndsOn: string | null;       // YYYY-MM-DD
    fertilizeFloorOn: string | null;   // YYYY-MM-DD
    structuralLifeEndsOn: string | null; // YYYY-MM-DD
    /**
     * A2 (spec §2.2) — a CLASS, never the name of one estimator.
     *
     * `CROWDING` is GONE. It was the ELSE branch of "did the substrate win?", so it meant "not
     * substrate" and never consulted whether a crowding index existed at all — and the channel it named
     * is a THREE-estimator blend, so naming one of them could never have been honest. Pre-migration rows
     * carry `null`, which this app already renders as "no sentence"; the routine recompute refills them
     * within one cycle.
     */
    repotDriver: 'SUBSTRATE' | 'EVIDENCE' | 'SPECIES_DEFAULT' | null;
    /**
     * Present EXACTLY when `repotDriver === 'SPECIES_DEFAULT'`, and `null` otherwise — a reason attached
     * to any other driver would explain something that did not happen. Computed at READ TIME.
     *
     * `NOT_APPLICABLE` is PERMANENT and carries no action (a trailing habit has no crowding reference).
     * `MISSING` and `STALE` are ACTIONABLE, and `missing` names the fields.
     */
    repotDriverReason:
      | { kind: 'NOT_APPLICABLE'; missing: [] }
      | { kind: 'MISSING'; missing: Array<'heightCm' | 'potSizeCm' | 'growthHabit'> }
      | { kind: 'STALE'; missing: [] }
      | null;
    repotOverrideBinding: boolean;
    /** Optional at the type level for the same rolling-deploy reason the block itself is: an API that does
     *  not publish it yet must not be read as "the owner postponed it". `repotExplanation` treats an absent
     *  value as UNKNOWN and says only what is true of both authors. */
    repotOverrideOrigin?: 'OWNER' | 'EVALUATION' | null;
    /**
     * A3's consequence affordance, as STATE (spec §2.3 item 3; QA finding F10, 2026-08-08).
     *
     * TRUE means: the recorded soil mix was CHANGED and no substrate refresh has supplied the day it
     * happened — the watering model already moved, the fertilize clock cannot move without a date. §2.3
     * calls that affordance PERSISTENT; it used to be a `ref` on the plant page, so a reload silently
     * restored the app's silence about a question it had just raised.
     *
     * Optional at the type level for the same rolling-deploy reason the rest of this block is; an absent
     * value must be read as "no pending mix change", never as unknown-so-show-it.
     */
    mixChangePending?: boolean;
  };
  /**
   * A1 + B1 (spec §2.1, ledger D3) — which rule, if any, moved the owner's own FERTILIZE date.
   *
   * A LIST, never a boolean and never one shared sentence: "held back because the substrate is still
   * charged" and "moved so it lands on a watering day" are DIFFERENT facts, and a floored override may
   * then ALSO be snapped, in which case BOTH apply. Collapsing them is the exact defect
   * `utils/repotExplanation.ts`'s own comment records this app shipping once and fixing.
   *
   * `overrideMovedBy` is `[]` whenever there is no override, or the override was not moved.
   */
  fertilize: {
    overrideOn: string | null;
    overrideMovedBy: Array<'FLOOR' | 'SNAP'>;
  };
  /**
   * The care payload's read-time measurement block (spec Part C) — computed on every `GET .../care`, never
   * persisted, the same posture `substrate` already takes. `null` for a frozen plant (no live schedule to
   * compare a rate against) — consumers must treat `null` as "no measurement finding", never as "the pot
   * dries fine".
   */
  measurement: PlantMeasurement | null;
}

// --- Care History ---
export type ProgressHealth = 'SICK' | 'POOR' | 'GOOD' | 'EXCELLENT';
export type ProgressTagGroup = 'positive' | 'negative';
// label removed — the API sends only { key, group }; the label is resolved on the web via i18n on the
// key (useProgressTagMeta), never duplicated here. ProgressTagKey is the shared closed union re-exported
// above — never re-typed as a bare `string` (fork-prevention).
export interface ProgressTag { key: ProgressTagKey; group: ProgressTagGroup }

// These unions MUST equal the shared arrays exactly — enforced by photo-contract.parity.test.ts. The web
// treats RECOVERING identically to PROCESSING (spec §6.3): still-not-ready, no imageUrl, counts toward
// processingCount, no remove control.
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];
export type PhotoFailureKind = (typeof PHOTO_FAILURE_KINDS)[number];
export type PhotoFailureCode = (typeof PHOTO_FAILURE_CODES)[number];

export interface ProgressPhoto {
  id: string;
  status: PhotoStatus;
  imageUrl: string | null;        // present only when READY
  sortOrder: number;
  originalName: string | null;
  failureKind: PhotoFailureKind | null;
  failureCode: PhotoFailureCode | null;
  retryable: boolean;
}

export interface ProgressEntryDetail {
  id: string;
  plantId: string;
  occurredOn: string;          // YYYY-MM-DD
  // Null for an import entry (Plant Lifecycle feature) — created with no health assessment.
  health: ProgressHealth | null;
  observations: string | null;
  sizeCm: number | null;
  tags: ProgressTag[];         // { key, group } — the label is resolved on the web via i18n
  photos: ProgressPhoto[];
  processingCount: number;
  failedCount: number;
  // True for an import-on-create entry (Plant Lifecycle feature). Optional so an older API during a
  // rolling deploy still types.
  isImport?: boolean;
}

// What the edit view sends (serialized into a multipart PATCH). `removePhotoIds` are ids of existing
// photos to drop; `files` are new photos to add. A cleared optional field is sent EMPTY (''/'[]'), an
// unchanged-required field (health/occurredOn) is always sent. See spec §2.1 / §3.1.
export interface UpdateProgressPayload {
  health: ProgressHealth;
  occurredOn: string;               // YYYY-MM-DD
  observations: string;             // '' clears
  sizeCm: number | null;            // null clears
  tags: string[];                   // [] clears
  photos: CompressedUpload[];       // new photos, already client-compressed via useImageCompression
  removePhotoIds: string[];
}

// The six species-scheduled care tasks (PROGRESS excluded — it is the richer 'progress' item).
export type CareActionTask = Exclude<TaskCode, 'PROGRESS'>;

export type HistoryItem =
  // health is nullable and isImport is optional: an import-on-create entry (Plant Lifecycle feature) is
  // written with no health assessment.
  | { kind: 'progress'; entryId: string; occurredOn: string; health: ProgressHealth | null; photoCount: number; processingCount: number; tagCount: number; isImport?: boolean }
  | { kind: 'action'; task: CareActionTask; type: 'DONE'; occurredOn: string }
  // A doctor-authored case note. Metadata only — the body is fetched on modal open, so a 20,000-character
  // record never rides in the timeline payload. This union is HAND-MIRRORED from the API (there is no
  // generated client for this endpoint), which is exactly where drift hides.
  | { kind: 'clinical'; recordId: string; occurredOn: string }
  // A relocation. All names come from the event's write-time SNAPSHOT — non-clickable.
  | { kind: 'move'; id: string; occurredOn: string; fromPlaceName: string | null; fromCityName: string | null; toPlaceName: string | null; toCityName: string | null; cityChanged: boolean }
  // A free-form owner/agent note. `noteId` drives PATCH/DELETE; `body` is the editable text. Author is
  // NOT on the wire (invisible in the UI).
  | { kind: 'note'; id: string; noteId: string; occurredOn: string; body: string }
  // A lifecycle transition (Plant Lifecycle feature): memorialize, gift, or revive.
  | { kind: 'lifecycle'; id: string; occurredOn: string; transition: 'MEMORIALIZED' | 'GIFTED' | 'REVIVED' };

// Admin knowledge-engine chat (spec 3). Sessions are a shared admin pool; addressed by internal cuid id.
// ⚠️ `LAUNCHING` is the launch-lease state and IS on the wire: a run that won the QUEUED -> LAUNCHING
// conditional update reports it until it registers its pid. It belongs to the API's ACTIVE_RUN_STATUSES
// alongside QUEUED and RUNNING, so anything gating on "is this session busy" must include it.
//
// Omitting it was the dangerous half of the asymmetry rule: for a value we READ, a type NARROWER than
// what the server can emit lies to the compiler about what can arrive. It rendered the raw key path
// `runStatus.LAUNCHING` at the owner and left the delete button enabled during the one window where the
// server is guaranteed to refuse the delete.
export type KnowledgeChatRunStatus = 'QUEUED' | 'LAUNCHING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** The statuses in which a session is busy — mirrors the API's `ACTIVE_RUN_STATUSES`. */
export const ACTIVE_RUN_STATUSES: readonly KnowledgeChatRunStatus[] = ['QUEUED', 'LAUNCHING', 'RUNNING'];

// Which agent runs a conversation. Mirrors the agents-realtime `AgentProvider` wire vocabulary — the
// value the API persists is the value it sends the engine, so this stays a plain string union.
export type KnowledgeChatProvider = 'claude' | 'codex';

// A chat session's scope. KNOWLEDGE = the admin Knowledge Engine pool; DOCTOR = a per-plant diagnosis;
// GARDENER = the whole-garden agent (places/cities/plant creation, not scoped to one plant).
// Present on doctor and gardener sessions; absent/KNOWLEDGE on the KE pool.
export type ChatSessionKind = 'KNOWLEDGE' | 'DOCTOR' | 'GARDENER';

export interface KnowledgeChatSessionSummary {
  id: string;
  provider: KnowledgeChatProvider;
  // Scope, returned by the doctor endpoints; the KE endpoints omit it (⇒ KNOWLEDGE).
  kind?: ChatSessionKind;
  // The pinned plant for a DOCTOR session; null/absent for a KNOWLEDGE session.
  plantId?: string | null;
  // The AGENT's own session id (Claude's UUID / Codex's thread id); null until the first run establishes
  // one — a conversation with none can never be resumed.
  providerSessionId: string | null;
  title: string;
  status: KnowledgeChatRunStatus | null;
  turns: number;
  createdAt: string;
  updatedAt: string;
}

// A turn is a prompt OR a command — the API guarantees exactly one is set.
export interface KnowledgeChatTurn {
  runId: string;
  prompt: string | null;
  command: AgentCommand | null;
  status: KnowledgeChatRunStatus;
  isActive: boolean;
  logUrl: string;
}

/** One attachment as it crosses OUR wire: base64 bytes plus the metadata the API validates. */
export interface ChatAttachment {
  id: string;
  filename: string;
  mimeType: string;
  data: string; // base64
}

// What a send carries. The union is the point: there is no shape in which a command rides inside a prompt.
// Commands never carry attachments — the API answers 400 to a body with both, so the union makes the
// combination unrepresentable rather than discovering it at runtime.
export type KnowledgeChatSendInput =
  | { prompt: string; attachments?: ChatAttachment[] }
  | { command: AgentCommand };

export type { CommandCatalog };

export interface KnowledgeChatSessionDetail {
  id: string;
  title: string;
  provider: KnowledgeChatProvider;
  // Scope, returned by the doctor endpoints; the KE endpoints omit it (⇒ KNOWLEDGE).
  kind?: ChatSessionKind;
  // The pinned plant for a DOCTOR session; null/absent for a KNOWLEDGE session.
  plantId?: string | null;
  providerSessionId: string | null;
  turns: KnowledgeChatTurn[];
}

// The engine's canonical SessionHistory plus the one fact only our API can report: the agent itself no
// longer holds this session, so the conversation cannot be continued either.
export type KnowledgeChatHistory = SessionHistory & { agentSessionMissing?: boolean };

export interface CreateKnowledgeSessionResponse { sessionId: string; runId: string; ticket: string }
export interface ResumeKnowledgeRunResponse { runId: string; ticket: string }
export interface KnowledgeSocketTicketResponse { ticket: string }

// What the shared <AgentChat> needs from a "sessions" source — the intersection the component actually
// calls (create/resume/history/providers/commands). useKnowledgeChatSessions(), useDoctorChatSessions(),
// and useGardenerChatSessions() each return a superset of this, so any of the three satisfies it
// structurally (fork-prevention: one component, injected scope). `list`/`fetch`/`remove` are used by the
// PAGE, not the component, so they are deliberately absent here.
export interface ChatSessionsAdapter {
  create: (input: KnowledgeChatSendInput, provider: KnowledgeChatProvider) => Promise<CreateKnowledgeSessionResponse>;
  resume: (id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) => Promise<ResumeKnowledgeRunResponse>;
  history: (id: string) => Promise<KnowledgeChatHistory>;
  providers: (force?: boolean) => Promise<AgentProviderStatus[]>;
  commands: (provider: KnowledgeChatProvider) => Promise<CommandCatalog>;
}

// What the shared <AgentChatWorkspace> SHELL needs — a SUPERSET of ChatSessionsAdapter that also includes
// the list / fetch / remove the session list + selection use (the inner <AgentChat> does not call these,
// which is why ChatSessionsAdapter omits them). useKnowledgeChatSessions(), useDoctorChatSessions(), and
// useGardenerChatSessions() each return this exact shape, so any of the three satisfies it structurally
// (fork-prevention: one shell, injected scope).
export interface ChatWorkspaceSessionsAdapter extends ChatSessionsAdapter {
  list: () => Promise<KnowledgeChatSessionSummary[]>;
  fetch: (id: string) => Promise<KnowledgeChatSessionDetail>;
  remove: (id: string) => Promise<unknown>;
}

// What the shared <AgentChat> / <AgentChatWorkspace> need from a "runs" source.
export interface ChatRunsAdapter {
  mintSocketTicket: (runId: string) => Promise<string>;
  /**
   * Recall ONE restored attachment's bytes for this surface (spec 2026-08-01 §3.4).
   *
   * It returns a `Blob` and never a url, because the chat package's object-url registry owns every url
   * it mints and revokes all of them — a resolver handing back a url would invert that and leave nobody
   * responsible for revocation.
   *
   * REJECTS on a non-2xx, carrying the upstream status: 410 (the 48 h retention reaped it — the COMMON
   * case for an old conversation), 404 (never recorded), 500 (our own misconfiguration). The caller
   * renders the first two as an honest placeholder and only the last as a failure.
   */
  fetchAttachment: (sessionId: string, runId: string, attachmentId: string) => Promise<Blob>;
}

// --- Agent write proposals (spec 2026-07-18 §5.4, §5.5.1, §5.5.3) ---
//
// No agent role can mutate anything directly. It files a PROPOSAL, and the owner approves it. Everything
// below is SERVER-RENDERED: the API resolves each operation's human target label and its before/after
// values and hands them over as strings. That is deliberate and load-bearing — if the browser re-derived
// the labels it would be a second implementation of "what does this change mean", free to disagree with
// the one that actually applies the write. The owner must approve exactly what the server will do.
//
// These types MIRROR `RenderedChange` / `RenderedOperation` / `ProposalView` in the API's
// `src/agents/proposals/proposal-render.service.ts`. The two repos never co-compile, so nothing
// mechanical keeps them in step. If they ever disagree, THE API WINS and this file is corrected — never
// the reverse, and never by reshaping the payload in the browser.

// Mirrors the Prisma enum `AgentProposalStatus`. Closed and DB-enforced, so the server cannot emit a
// sixth value without a migration.
export type AgentProposalStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED' | 'FAILED';

// Mirrors the Prisma enum `AgentProposalFailureCode` — a CLOSED set of five. The API deliberately keeps
// it coarse: a raw driver error is never something a plant-scoped agent (or this banner) gets to read.
export type AgentProposalFailureCode = 'VALIDATION' | 'NOT_FOUND' | 'OWNERSHIP' | 'CONFLICT' | 'INTERNAL';

// The `status` travelling in a 409 body from approve/decline. It is NOT `AgentProposalStatus`: the API
// falls back to the literal `'UNKNOWN'` when the row has vanished entirely
// (`current?.status ?? 'UNKNOWN'`), so a type that admitted only the five enum values would be a lie —
// and an exhaustive switch over it would silently mis-handle the one case that means "we lost track of
// it". Widening a value we only READ is the safe direction; narrowing it is what strands the caller.
export type AgentProposalConflictStatus = AgentProposalStatus | 'UNKNOWN';

/**
 * The closed operation union's discriminant, ALIASED FROM THE SHARED CONTRACT — never hand-copied.
 * A hand-copied literal union is a silent fork: the shared union grew from ten to fifteen members (five
 * new garden ops: place.create/update, city.create/update, plant.create) and this file stayed green at
 * ten, so every `Record<AgentProposalOperationType, …>` exhaustiveness check in this repo (the proposal
 * banner's label map, the locale-parity test) was measuring completeness against a stale local copy that
 * could never grow. Importing the type turns the NEXT union growth into a compile error right here,
 * instead of a raw untranslated key path shown to the owner in production.
 */
export type AgentProposalOperationType = ProposalOperationType;

/** A clinical record's metadata. The list endpoint never returns the body. */
export interface ClinicalRecordSummary {
  id: string;
  recordedOn: string;
  createdAt: string;
  updatedAt: string;
}
/** The detail read. `body` is agent-authored Markdown — render it ONLY through renderMarkdown + UiProse. */
export interface ClinicalRecordDetail extends ClinicalRecordSummary {
  body: string;
  bodyChars: number;
}

// One field-level change inside an operation. `before` is ALWAYS the value to show as current:
// normally the proposal's immutable snapshot, and — when the record drifted since the agent looked —
// the LIVE value, with `stale` carrying what the agent originally saw (§5.5.3). Rendering a stale
// snapshot as if it were current is the one thing the spec forbids outright.
export interface AgentProposalChange {
  // Server-owned human label for the field ("Pot type", "Every (days)").
  field: string;
  // null = the field currently has no value.
  before: string | null;
  // null = the operation CLEARS the field.
  after: string | null;
  // Present only when the live value drifted from the proposal's snapshot.
  stale?: { atProposeTime: string | null };
}

export interface AgentProposalOperation {
  type: AgentProposalOperationType;
  // Server-resolved target ("2026-07-12", "WATER", "Living room"). Rendered verbatim.
  targetLabel: string;
  changes: AgentProposalChange[];
  // True for progress.delete: the entry AND its photos are gone for good (§7.2). The banner must say so.
  destructive: boolean;
}

export interface AgentProposal {
  id: string;
  status: AgentProposalStatus;
  // Agent-authored prose. A CAPTION ONLY — never the consent surface (§5.4). A misleading summary must
  // not be able to change what is shown or what is applied.
  summary: string;
  operations: AgentProposalOperation[];
  autoApproved: boolean;
  failureCode: AgentProposalFailureCode | null;
  failureReason: string | null;
  /**
   * SERVER-computed at propose time: how many plants a place edit in this proposal would recompute. Null
   * when the proposal contains no place edit. It is never re-derived at approval and never read from the
   * agent's summary — this field is the whole reason the fan-out claim is verifiable.
   */
  affectedPlantCount: number | null;
  // `createdAt` is a `Date` on the server; it crosses JSON as an ISO-8601 string.
  createdAt: string;
}

// From here on the vocabulary is deliberately mixed, not inconsistent: the wire TYPES above generalized to
// `Agent*` because the gardener's adapter reuses them unchanged, while `DoctorSessionSettings` stays
// doctor-NAMED by convention only — it is not in the earlier spec's rename list (Spec 3 §5.1 renamed only
// `DoctorProposal`/`DoctorProposalOperationType`), and renaming it is not this feature's job. The gardener's
// settings endpoints (`getGardenerSessionSettings`/`updateGardenerSessionSettings`) return this exact type
// over `/gardener/sessions/:id/settings`, unchanged — reusing an unrenamed type across scopes is the
// fork-prevention outcome we want, not a sign the type is doctor-exclusive. The `*DoctorProposal` methods
// on `useApi` below ARE genuinely doctor-only, since they call the `/plants/:id/diagnose/*` routes
// specifically; the gardener's proposal methods are their own, separately-named siblings.

// Per-session Dangerously Skip Permissions (§6.4). Owner-toggled only; the agent may read it and never write it.
export interface DoctorSessionSettings {
  skipPermissions: boolean;
}

// What the shared <AgentChat> needs from a "proposals" source. OPTIONAL by design: the Knowledge Engine
// injects nothing and therefore renders no approval surface at all, while the doctor page injects the
// plant-scoped adapter. One component, injected scope — the same fork-prevention shape as
// ChatSessionsAdapter / ChatRunsAdapter above.
//
// NOTE on `pending`: the ADAPTER's contract is "a proposal, or null". That is a NORMALIZATION, not the
// raw wire shape — on the wire, "nothing pending" is 200 with an EMPTY BODY, which reaches the browser
// as `''`, not `null`. `useApi.getDoctorPendingProposal` performs that coercion so no consumer has to
// know. See its comment for why the raw shape is a trap.
export interface ChatProposalsAdapter {
  pending: (sessionId: string) => Promise<AgentProposal | null>;
  approve: (sessionId: string, proposalId: string) => Promise<AgentProposal>;
  decline: (sessionId: string, proposalId: string) => Promise<AgentProposal>;
  getSettings: (sessionId: string) => Promise<DoctorSessionSettings>;
  setSettings: (sessionId: string, skipPermissions: boolean) => Promise<DoctorSessionSettings>;
}

// --- Blog & media (Spec 3; mirrors the API read-models in Spec 1) ---

// Paginated envelope returned by GET /blog, GET /blogposts, GET /media.
export interface BlogPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Public feed card (GET /blog items). Bilingual title/excerpt; the web picks the locale field.
// Date fields arrive as ISO strings over JSON. difficulty is currently always null (no species
// difficulty signal exists yet) — the badge is rendered only when it is non-null.
export interface BlogpostCard {
  slug: string;
  titleEs: string;
  titleEn: string | null;
  excerptEs: string;
  excerptEn: string | null;
  coverImageUrl: string | null;
  publishedAt: string | null;
  readingMinutes: number;
  speciesSlug: string | null;
  speciesScientificName: string | null;
  speciesCommonNameEs: string | null;
  speciesCommonNameEn: string | null;
  difficulty: string | null;
}

// Public single-post detail (GET /blog/:slug) — card + body/youtube/cta.
export interface BlogpostDetail extends BlogpostCard {
  bodyEs: string;
  bodyEn: string | null;
  youtubeUrl: string | null;
  ctaLink: string | null;
  ctaLabelEs: string | null;
  ctaLabelEn: string | null;
}

// The full editor view — the RAW blogpost row returned by the admin routes (create/get/patch/cover).
// No species-derived fields, no readingMinutes (that is a public-feed projection only).
export interface BlogpostAdminDetail {
  slug: string;
  status: 0 | 1;
  speciesSlug: string | null;
  titleEs: string;
  titleEn: string | null;
  excerptEs: string;
  excerptEn: string | null;
  bodyEs: string;
  bodyEn: string | null;
  coverImageUrl: string | null;
  coverImageObjectKey: string | null;
  coverImagePrompt: string | null;
  youtubeUrl: string | null;
  ctaLink: string | null;
  ctaLabelEs: string | null;
  ctaLabelEn: string | null;
  createdByUserId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Writing-desk list row (GET /blogposts items).
export interface BlogpostAdminRow {
  slug: string;
  status: 0 | 1;
  titleEs: string;
  excerptEs: string;
  coverImageUrl: string | null;
  speciesSlug: string | null;
  updatedAt: string;
}

// Media library asset (POST /media response + GET /media items).
export interface MediaAssetView {
  id: string;
  imageUrl: string;
  filename: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

// Create/update request bodies (server-owned fields omitted; speciesSlug is whitelist-stripped by the
// API — the desk only creates/edits free-form posts). ES leads (required); EN + the rest are optional.
export interface CreateBlogpost {
  slug?: string;
  status?: 0 | 1;
  titleEs: string;
  titleEn?: string | null;
  excerptEs: string;
  excerptEn?: string | null;
  bodyEs: string;
  bodyEn?: string | null;
  coverImageUrl?: string | null;
  coverImageObjectKey?: string | null;
  youtubeUrl?: string | null;
  ctaLink?: string | null;
  ctaLabelEs?: string | null;
  ctaLabelEn?: string | null;
}

// ---- Measured soil (spec Part C) --------------------------------------------------------------------
// `InstrumentId` and `InstrumentRow` come from the shared contract's Zod-FREE subpath
// (`@retaxmaster/my-plants-species-schema/soil-instrument-constants`), imported above alongside the
// package's other Zod-free constant modules. `InstrumentCalibration` and `ReadingVerdict` come from the
// same package's root type-only import at the top of this file — see that import's own comment for why a
// prior structural re-declaration here was a fork, not a bundle-size necessity.

export interface OwnerInstruments {
  /** The full catalogue, from the shared contract. */
  available: InstrumentRow[];
  selected: InstrumentId[];
}

export interface PlantInstrument extends InstrumentRow {
  /** The per-pot anchors, or null when this pot has none yet. */
  calibration: InstrumentCalibration | null;
}

/** The measuring protocol for THIS pot. Null when the pot size is unknown — the app states no protocol
 *  rather than inventing a depth. */
export interface ReadingProtocol {
  potSizeCm: number;
  insertionDepthCm: number;
  distanceFromCentreCm: number;
}

export interface SoilReadingItem {
  id: string;
  instrumentId: InstrumentId;
  rawValue: number;
  wetness: number | null;
  measuredOn: string; // YYYY-MM-DD
  verdict: ReadingVerdict;
  /** Which side of that day's watering the reading falls on, or `null` for "unknown / never asked" — a
   *  real, distinguishable state, never a default. Published by the API since 2026-08-11 so the measuring
   *  modal can PREFILL it: one reading per (plant, instrument, day) means a second save is an EDIT, and an
   *  edit form that silently dropped an answer the owner already gave would re-ask it. */
  wateringRelation: WateringRelation | null;
}

export interface PlantSoilReadings {
  instruments: PlantInstrument[];
  protocol: ReadingProtocol | null;
  readings: SoilReadingItem[];
  /** The `YYYY-MM-DD` days carrying a WATER DONE, inside the same window `readings` uses. Drives the
   *  measuring modal's same-day-watering question (owner-ruled, 2026-08-08): the drying-rate fence is
   *  strict-after the last watering, so a reading taken on one of these days is ambiguous about which side
   *  of the watering it belongs to unless the owner places it. */
  wateringDays: string[];
}

export interface CreateSoilReading {
  instrumentId: InstrumentId;
  rawValue: number;
  measuredOn: string;
  verdict: ReadingVerdict;
  postponeToOn?: string;
  /** Answers "before or after that day's watering?" — sent ONLY when `measuredOn` is one of
   *  `PlantSoilReadings.wateringDays`; absent otherwise. No default: the owner ruled the ambiguity is
   *  resolved by asking, never by assuming. */
  wateringRelation?: WateringRelation;
  /** WHEN THE MEASUREMENT WAS TAKEN — an ISO-8601 instant (`new Date().toISOString()`), and NOT the same
   *  thing as `measuredOn`, which is the calendar day the reading belongs to.
   *
   *  Sent ONLY by a write whose save can happen materially later than the measurement: today that is the
   *  survey's DEFERRED `UNAVAILABLE` save, where the owner is OFFERED a save and may tap it much later.
   *  Everywhere else the write follows the measurement immediately, so the API's own fallback ("absent
   *  means taken now") is exactly right and sending the field would add nothing.
   *
   *  Why it matters: on a day that already carries a watering, the API derives which side of that watering
   *  a reading sits on. Deriving that from WRITE time files a reading genuinely taken BEFORE a watering as
   *  the saturated anchor that OPENS the new drying cycle, which flattens the fitted slope. See
   *  `docs/care-engine.md` §7.20.4. */
  measurementTakenAt?: string;
}

// `Recommendation`/`HoldBasis`/`UnavailableReason` are DERIVED from the shared contract's own
// `watering-verdict-constants.ts` arrays (imported above), never retyped: those are closed literal
// unions the API's watering-verdict engine COMPUTES and the web only reads — the same shape
// `photo-contract-constants.ts`'s `PHOTO_STATUSES` already solved for the photo pipeline's
// server-computed state machine (see `PhotoStatus` below), so a future rename or a fourth `basis` value
// can no longer silently diverge between the API and the web. Mechanical parity is asserted by
// `types/watering-verdict-contract.parity.test.ts`, the sibling of `photo-contract.parity.test.ts`.
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export type HoldBasis = (typeof HOLD_BASES)[number];
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** The read-only answer to "water this pot today, or hold?" (`POST /plants/:id/soil-readings/preview`,
 *  §8 of the 2026-08-09 redesign). Nothing is written to produce this. */
export interface SoilReadingPreview {
  /**
   * `YYYY-MM-DD` — the PLANT-LOCAL calendar day the verdict was computed for, and the day the write that
   * follows a survey must carry (finding W3).
   *
   * The browser's own day is not that day. The API evaluates against the plant CITY's local day, so in the
   * midnight gap the two disagree, and both directions dead-end: browser-behind writes a reading dated
   * yesterday, so `measuredToday` never flips and the row re-offers the survey forever; browser-ahead
   * writes a future date, which the API's own past-event rule refuses with a 400 and the survey ends
   * nowhere. Voluntary mode is the one place the browser's day is still right — there the owner picks the
   * date himself, and no preview ran to name a better one.
   */
  measuredOn: string;
  /** The normalised fraction (`normaliseReading`), or null when no honest fraction exists. */
  wetness: number | null;
  /** The species' own trigger (`targetWetnessFor`). Always present — it needs no reading to compute. */
  target: number;
  recommendation: Recommendation;
  suggestedPostponeToOn: string | null;
  basis: HoldBasis | null;
  unavailableReason: UnavailableReason | null;
}

/** The care payload's read-time measurement block. Null for a frozen plant. */
export interface PlantMeasurement {
  dryingRate: {
    measuredDaysToTarget: number;
    confidence: number;
    readingsUsed: number;
    spanDays: number;
  } | null;
  reason: 'TOO_FEW_READINGS' | 'SPAN_TOO_SHORT' | 'FLAT_SERIES' | 'NOT_DRYING' | null;
  tooSlowDrying: boolean;
  flatSeries: boolean;
  suggestMeasuring: boolean;
  /**
   * True when this plant already has a soil reading dated its own LOCAL today (measured-verdict-gap
   * spec, Task 47/T6b).
   *
   * ⚠️ A PURELY FACTUAL FLAG — "a reading was taken today", nothing about whether it decided anything
   * (owner ruling, 2026-08-10). It is NOT the survey affordance's gate; `todaysVerdict` below is. It still
   * drives `postponeReasonWithoutAsking`, where the mere fact of a measurement is exactly the right
   * question: a Posponer that follows one can only mean the owner ran out of day.
   */
  measuredToday: boolean;
  /**
   * WHAT today's reading said, or `null` when nothing was measured today. This is what the survey
   * affordance's shared rule reads — see `utils/waterSurvey.ts`'s `todaysVerdictClosesSurvey`.
   */
  todaysVerdict: TodaysVerdict;
}

export type UpdateBlogpost = Partial<CreateBlogpost>;
