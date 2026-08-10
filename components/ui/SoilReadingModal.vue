<script setup lang="ts">
// The measuring modal (2026-08-09 redesign: "the modal answers the question instead of asking three of
// ours"). Reuses the canonical Modal, over TWO possible steps in the SAME modal instance: `measure` (the
// reading itself) and `verdict` (survey mode only — what the reading answers).
//
// ⚠️ TWO MODES, and they are not a cosmetic toggle — they change what is asked and what is written.
//   `survey`    — reached from a DUE water task: the owner is deciding RIGHT NOW. `measuredOn` is hidden
//                 (fixed to today — a survey answers today), the watering-relation question is IMPOSSIBLE
//                 BY CONSTRUCTION (see below), and the reading is evaluated by the read-only preview
//                 endpoint FIRST — the outcome decides what gets written and how: HOLD applies itself
//                 (reading + `verdict: 'POSTPONE'`), WATER_NOW WRITES the reading too (`verdict: 'NONE'`,
//                 owner ruling 2026-08-09 — measured-verdict-gap redesign: real data that teaches the
//                 drying-rate fit, and what lets the row's `measuredToday` gate close the "asks again
//                 forever" dead-end once the owner has answered for today), and UNAVAILABLE writes nothing
//                 until the owner explicitly offers to save it (see `submit()`'s own branch comments).
//                 ⚠️ Every survey write is dated by the PREVIEW's `measuredOn` — the plant-local day the
//                 verdict was computed for — and never by this browser's day, which is a DIFFERENT day
//                 across the midnight gap (finding W3; the full reasoning sits at that assignment).
//   `voluntary` — a back-dated reading taken earlier. `measuredOn` stays editable (capped at today), the
//                 watering-relation question is asked exactly as before (owner-ruled 2026-08-08, no
//                 pre-selection — see below), and the reading is recorded with `verdict: 'NONE'`. No
//                 verdict step: this mode never calls the preview endpoint at all.
//
// ⚠️ WHY THE WATERING-RELATION QUESTION IS IMPOSSIBLE IN SURVEY MODE, not merely hidden. That question
// exists because a reading taken on a day the plant was ALSO watered is ambiguous about which side of the
// watering it falls on. A survey's own order is fixed by construction: the task appears due → the owner
// measures → the verdict → (if WATER_NOW) he waters → he marks the task done. The measurement is always
// BEFORE that day's watering, and it is KNOWN rather than assumed — there is no ambiguity left to ask
// about. The question survives only in `voluntary` mode, where the owner recalls a PAST day: the one place
// the ambiguity was ever real.
//
// ⚠️ THE VERDICT PICKER AND THE POSTPONE-DATE FIELD ARE GONE, not hidden. The engine now chooses (via
// `previewSoilReading`), so nothing in this component asks "what are you doing about it?" any more — that
// question is the one this whole redesign exists to stop asking. Do not resurrect either field behind a
// `v-if`: they have no caller left in either mode, and a hidden control is a thing the next reader has to
// reason about.
import Modal from './Modal.vue';
import Button from './Button.vue';
import Input from './Input.vue';
import FormGroup from './FormGroup.vue';
import SegmentedControl from './SegmentedControl.vue';
import Alert from './Alert.vue';
import InstrumentCalibrationFields from './InstrumentCalibrationFields.vue';
import OrdinalReadingPicker from './OrdinalReadingPicker.vue';
// `InstrumentId` has a Zod-free subpath in the shared contract; `WateringRelation` is the shared contract's
// Zod-module type, re-exported from `~/types/api` (see that file's own comment) — so it comes from there,
// never from `soil-instrument-constants`.
import type { InstrumentId } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import type { PlantSoilReadings, SoilReadingPreview, WateringRelation } from '~/types/api';
import { toNullableNumber } from '~/utils/nullableNumber';
import { todayYmd, ymdToLocalDate } from '~/utils/localDate';
// The ONE module that knows the Nuxt BFF's error envelope. Read its header before touching the catch
// blocks below: the envelope carries no `message` of its own, so a hand-rolled `e.data.message` read here
// does not merely duplicate this module — it silently never matches, on every proxied failure.
import { upstreamErrorCode, upstreamErrorMessage } from '~/utils/upstreamError';

// `mode` is now REQUIRED (Task 6, watering-survey-web plan): both callers pass it explicitly —
// pages/index.vue's WATER survey passes `'survey'` (commit ff75f51), PlantDetail.vue passes a dynamic
// `readingMode` that is `'survey'` for its own WATER-row evaluate click and `'voluntary'` for its
// measurement-history "Add a reading" action — so the temporary scaffolding default this prop used to
// carry (see the file-header comment for the full contract) is gone: a future caller that forgets to pass
// `mode` now gets a compile error instead of a plausible-looking screen with the wrong behaviour.
const props = defineProps<{
  plantId: string;
  data: PlantSoilReadings;
  mode: 'survey' | 'voluntary';
}>();
// `water-done` / `water-postpone` are raised ONLY from the WATER_NOW verdict's footer. They carry no
// payload on purpose: this modal must not decide HOW a watering is recorded — the page owns that, and owns
// it in exactly one place (`onDone`/`onPostpone`), which is what keeps the verdict's buttons and the task
// row's buttons from becoming two implementations of one action that can drift apart.
const emit = defineEmits<{ saved: []; 'water-done': []; 'water-postpone': [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t, d } = useI18n();
const api = useApi();

// SegmentedControl's own model is a plain, non-nullable `string` (`defineModel<string>({ required: true
// })`) — '' is the "nothing chosen yet" sentinel, the same convention RepotDoneForm.vue/PlaceEditModal.vue
// already use for an unanswered field, rather than `null` (which SegmentedControl cannot accept).
const instrumentId = ref<InstrumentId | ''>(props.data.instruments[0]?.id ?? '');
const rawValue = ref<number | null>(null);
// SegmentedControl's own model is a plain, non-nullable `string` — '' is the "nothing chosen yet" sentinel
// (same convention `instrumentId` above already uses). Owner-ruled (2026-08-08): NO default and NO
// pre-selection — the ambiguity a same-day-as-watering reading carries is resolved by ASKING, never by
// assuming, so this starts unanswered and stays that way until the owner picks one. VOLUNTARY MODE ONLY —
// see `showWateringRelation` below.
const wateringRelation = ref<WateringRelation | ''>('');
const calibration = reactive<{ saturatedValue: number | null; dryValue: number | null }>({
  saturatedValue: null, dryValue: null,
});
const submitting = ref(false);
const error = ref<string | null>(null);

// Which screen of the modal is showing. `verdict` is reachable ONLY from survey mode, once
// `previewSoilReading` has answered — see `submit()`. Voluntary mode never leaves `measure`.
const step = ref<'measure' | 'verdict'>('measure');
// The survey's own answer, once it has one. Drives the verdict step's copy; `null` until `submit()` sets
// it (or on any reopen — see the `watch(open, …)` reset below).
const previewResult = ref<SoilReadingPreview | null>(null);
// UNAVAILABLE only (owner ruling, 2026-08-09): the reading `saveUnavailableReading()` will write if — and
// only if — the owner presses "Guardar lectura". Captured at the moment the verdict is reached (not read
// live off `instrumentId`/`rawValue`/`measuredOn` at save time) so the write can never pick up a value that
// changed after the fields it came from stopped being rendered — those refs are frozen in practice once
// `step` leaves `measure` (nothing re-renders them), but this keeps the save from depending on that being
// true forever.
const pendingUnavailableReading = ref<{
  instrumentId: InstrumentId; rawValue: number; measuredOn: string; wateringRelation?: WateringRelation;
} | null>(null);

// Bridge between Input.vue's `v-model` (`string | number`) and `rawValue`'s `number | null` — same pattern
// (and same shared util) as PlaceEditModal.vue's temperature fields. Numeric instruments only — an ordinal
// instrument (`OrdinalReadingPicker`) binds `rawValue` directly, since its own model is already
// `number | null`.
const rawValueField = computed<number | string>({
  get: () => rawValue.value ?? '',
  set: (v) => { rawValue.value = toNullableNumber(v); },
});

// PINNED idempotency key: minted once when the modal opens and reused on every retry, so a create whose
// response is lost after the server committed never writes a second reading.
const idempotencyKey = ref(crypto.randomUUID());
// Reopen must reset EVERY field a previous session could have left stale — not just the ones an earlier
// pass happened to touch, and that now explicitly includes the calibration anchors (`saturatedValue`/
// `dryValue`): the API's own comment records that a REPOT invalidates a calibration, so anchors typed for
// the OLD pot and abandoned without saving must never sit pre-filled, one tap from being written as the
// NEW pot's anchors. The modal is mounted once for the page's life (PlantDetail.vue, no `:key`), so a field
// left un-reset here silently carries a prior reading's value into the next one. `measuredOn` is the one
// date field left (`postponeToOn` no longer exists — see the file-header comment): a stale `measuredOn` is
// the worse trap of the two it used to guard against, since two readings landing on the same date is a
// zero-span pair that corrupts the drying-rate slope fit — the exact data quality this whole feature exists
// to protect. `step`/`previewResult` reset too: a survey's verdict describes ONE reading and must never be
// shown stale over a fresh one.
// The server told us this day carries a watering even though our cached `wateringDays` did not name it —
// see the 400 branch in `submit()`. Reset with everything else on reopen and whenever the date changes.
const serverSaysWateringDay = ref(false);

watch(open, (isOpen) => {
  if (!isOpen) return;
  idempotencyKey.value = crypto.randomUUID();
  error.value = null;
  rawValue.value = null;
  step.value = 'measure';
  previewResult.value = null;
  pendingUnavailableReading.value = null;
  measuredOn.value = todayYmd();
  wateringRelation.value = '';
  serverSaysWateringDay.value = false;
  // ⚠️ NOT nulled any more (QA round 3, 2026-08-10) — PREFILLED from the pot's stored anchors. The rule the
  // old code enforced is still right and still enforced: anchors TYPED for the old pot and abandoned
  // without saving must never sit pre-filled. What it got wrong is that the server's own stored calibration
  // is not that — it IS this pot's current calibration, and hiding it is what made a mis-weighed pot
  // unrepairable from the app and made a failed save look like it had lost a calibration it had actually
  // written. `syncCalibrationFromStored` reads `props.data`, so it shows what the pot has NOW.
  syncCalibrationFromStored();
  // `instrumentId`'s setup-time initializer (`props.data.instruments[0]?.id ?? ''`) can miss the "default
  // to the first instrument" intent entirely: PlantDetail.vue's template falls back to an empty
  // `{ instruments: [], … }` shape while its own async readings fetch is still in flight, so the modal can
  // be constructed before the real instrument list ever reaches it. Re-apply the default here, on every
  // open, but ONLY when nothing is currently selected — an owner's already-chosen instrument must survive
  // a close/reopen untouched, the deliberate stickiness this field otherwise has.
  if (instrumentId.value === '' && props.data.instruments[0]) {
    instrumentId.value = props.data.instruments[0].id;
  }
});

/**
 * SWITCHING INSTRUMENTS CLEARS THE READING (QA 2026-08-10, defect 2).
 *
 * `rawValue` is a number on whatever scale the CURRENT instrument declares, and those scales share nothing.
 * Picking "damp soil sticks to it" on the wooden stick stores `3`; switching to the moisture probe left
 * that `3` sitting in the number field as a 1..10 conductance reading — a measurement the owner never took,
 * on an instrument they never used, and it saved without a murmur. The reverse was as bad: `5` on the probe
 * became `5 g` on the kitchen scale.
 *
 * Nothing else in the modal can catch this. Every value involved is legal on the scale it lands on, so the
 * range check passes, the step check passes, and the server has no way to know the number was carried
 * rather than read. The only moment the mistake is visible is the switch itself.
 *
 * The calibration anchors go too: they are per (pot, instrument), so anchors typed for one instrument
 * describe nothing on another.
 */
watch(instrumentId, () => {
  rawValue.value = null;
  // Re-read from the SERVER for the newly chosen instrument rather than blanking: anchors are per (pot,
  // instrument), so the old instrument's numbers describe nothing here — but the new instrument may well
  // have its own stored pair, and that pair is exactly what the owner should see.
  syncCalibrationFromStored();
  // ⚠️ AND THE ERROR ALERT GOES WITH THEM (QA round 3, defect 7). It described a save of the READING that
  // has just been cleared, so leaving it up puts a red "we couldn't save that reading, please try again"
  // under a fresh, untouched form — the owner reads it as a fault in what he is about to do. An error
  // outliving the thing it was about is a lie with a delay on it.
  error.value = null;
});

const options = computed(() =>
  props.data.instruments.map((i) => ({ key: i.id, label: t(`settings.instruments.name.${i.id}`) })));
const instrument = computed(() =>
  props.data.instruments.find((i) => i.id === instrumentId.value) ?? null);
// Which measuring protocol this instrument's reading actually follows — read STRAIGHT OFF the shared
// instrument row (QA finding F2), never branched on the id here, so a new row arrives with its own
// protocol and this file needs no edit. `insertion` is the fallback ONLY for the transient window before
// the readings fetch resolves (PlantDetail.vue renders an empty `{ instruments: [] }` shape meanwhile),
// where no instrument is selected and no protocol is shown at all.
const protocolKind = computed(() => instrument.value?.protocolKind ?? 'insertion');
const needsCalibration = computed(() =>
  instrument.value?.requiresCalibration === true && instrument.value.calibration == null);

/**
 * A SAVED CALIBRATION MUST STAY VISIBLE AND CORRECTABLE (QA round 3, 2026-08-10).
 *
 * This used to be `needsCalibration` — the fields rendered only while the pot had NO anchors, and vanished
 * the instant it had some. That made the calibration write-once from the app: a mis-weighed pot (an
 * ordinary mistake — the saucer left on, the wrong pot, a transposed digit) could be seen nowhere, in the
 * dialog, on the plant page, or in /settings, and could be repaired by nothing short of a raw `PUT`.
 *
 * It is the reason the negative-anchor defect had no exit. It is also why a FAILED save appeared to lose a
 * calibration that had in fact been stored: the anchors were written by the first half of `submit()`, the
 * reading then failed, and reopening re-rendered two empty fields, one tap from silently overwriting a
 * perfectly good calibration with whatever the owner re-typed.
 *
 * `needsCalibration` above survives and still means what it says — "there is nothing to normalise against
 * yet" — which is what `canSubmit` and `blockedReason` must gate on. This one answers a different question:
 * "does this instrument have anchors the owner should be able to see?"
 */
const showsCalibration = computed(() => instrument.value?.requiresCalibration === true);

/** The anchors as the SERVER currently holds them, for this instrument, or `null`. The one place the stored
 *  calibration is read, so the prefill and the "did the owner change it?" comparison below can never
 *  disagree about what "stored" means. */
const storedCalibration = computed(() => instrument.value?.calibration ?? null);

/** Pull the stored anchors into the editable fields. Called on open and on every instrument switch — the
 *  two moments the fields stop describing whatever they described before — AND once at setup, for the same
 *  reason `instrumentId` re-applies its default in the `open` watcher: a modal that is mounted ALREADY open
 *  never fires that watcher, and an initializer that only runs on a transition is an initializer with a
 *  precondition nobody stated. Cheap, idempotent, and it removes the precondition. */
function syncCalibrationFromStored() {
  calibration.saturatedValue = storedCalibration.value?.saturatedValue ?? null;
  calibration.dryValue = storedCalibration.value?.dryValue ?? null;
}
syncCalibrationFromStored();

/** Has the owner actually moved the anchors? Drives whether `submit()` writes them at all — re-`PUT`ting
 *  identical numbers is not merely wasteful, it is a request the API must reason about (its own comment:
 *  replacing anchors RETRACTS the fractions they produced, and it compares before deciding). Sending only a
 *  real change keeps that decision unambiguous on both sides. */
const calibrationChanged = computed(() => {
  const stored = storedCalibration.value;
  if (calibration.saturatedValue == null || calibration.dryValue == null) return false;
  if (stored == null) return true;
  return stored.saturatedValue !== calibration.saturatedValue
    || stored.dryValue !== calibration.dryValue;
});

/**
 * AN ANCHOR IS A READING ON THE SAME SCALE, so the instrument's own bounds bind it (QA round 3).
 *
 * The client half of the shared contract's `instrumentCalibrationSchemaFor` — the same relationship
 * `rawValueOutOfRange` below has with `rawValueRangeRefinement`. Returns the offending field's label-ready
 * reason, or `undefined`.
 *
 * Worth stating plainly, because the browser bound alone would be a false comfort: the server refuses these
 * too, through the shared contract. This exists so the owner never reaches the refusal by accident, not as
 * the only thing standing between a typo and the database.
 */
const calibrationOffScale = computed(() => {
  const row = instrument.value;
  if (row == null) return undefined;
  const offScale = (v: number | null) =>
    v != null && (v < row.rawMin || (row.rawMax != null && v > row.rawMax));
  if (offScale(calibration.saturatedValue) || offScale(calibration.dryValue)) {
    return row.rawMax == null
      ? t('reading.calibration.belowMin', { min: row.rawMin })
      : t('reading.calibration.outOfRange', { min: row.rawMin, max: row.rawMax });
  }
  return undefined;
});

/** The anchors are usable: both present, ordered, and each one on the instrument's scale. */
const calibrationUsable = computed(() =>
  calibration.saturatedValue != null && calibration.dryValue != null &&
  calibration.saturatedValue > calibration.dryValue && calibrationOffScale.value === undefined);
// An ORDINAL instrument (the wooden stick, the finger) has no physical unit to name — `OrdinalReadingPicker`
// renders a choice of named states, not a number, so "Reading (índice 1–10)"-shaped copy would be
// meaningless for it. Guarding here (rather than always attempting the interpolation) also keeps this modal
// from ever rendering a raw, untranslated `settings.instruments.unit.*` key path for an ordinal row that
// catalogue does not cover. THE ONE PLACE this modal names an instrument's unit — both call sites below
// (this raw-value label AND `InstrumentCalibrationFields`'s own `unit-label` prop) route through this
// computed rather than calling `t('settings.instruments.unit...')` inline a second time, so the guard can
// never be bypassed by one of the two forgetting it.
//
// ⚠️ HISTORY, kept because it is the reason this guard exists rather than a stylistic preference. Code
// review (2026-08-09) found `pages/settings.vue` iterating the full instrument catalogue the API returns
// and resolving `settings.instruments.name.*`/`help.*` for EVERY row — so it rendered raw key paths for the
// two ordinal instruments the catalogue did not yet cover. That page has since been fixed and all three
// `settings.instruments.{name,unit,help}.*` families now define all four rows, so the sentence that used
// to stand here ("they still define ONLY galvanic-probe/kitchen-scale") is no longer true and has been
// removed rather than left to mislead the next reader.
//
// The class of defect, however, came back: QA (2026-08-10) found THIS file rendering
// `reading.honesty.wooden-stick` raw, for exactly the same reason one directory over. The durable answer is
// no longer a comment — it is `i18n/instrument-keys.parity.test.ts`, which walks the shared contract's
// `INSTRUMENT_LIST` and fails when any id-derived key is missing from either locale. Read that file before
// adding another `t(\`...${id}\`)` call site.
const valueUnitLabel = computed(() =>
  instrument.value && instrument.value.captureKind !== 'ordinal'
    ? t(`settings.instruments.unit.${instrument.value.id}`)
    : '');

// An ordinal instrument has no unit to print (a named state is not a quantity), and the unit-bearing label
// is `Reading ({unit})` — so interpolating an empty string produced the literal `Reading ()` QA found on
// screen for both the stick and the finger. Two labels, chosen by whether there is anything to put in the
// parentheses, rather than one label with an empty parenthetical.
const valueFieldLabel = computed(() =>
  valueUnitLabel.value
    ? t('reading.value', { unit: valueUnitLabel.value })
    : t('reading.valueNoUnit'));

// The date the browser must not let the owner exceed: a reading in the future is not a measurement. Uses
// the app's single local-calendar-day helper (`~/utils/localDate`'s `todayYmd()`) — never a second,
// independent `new Date().toLocaleDateString('en-CA')` of its own (see `RepotDoneForm.vue`'s own comment on
// this exact trap): that expression's output depends on the runtime's ICU locale data, while the shared
// helper builds the string from local Date components so it does not. Editable ONLY in voluntary mode — a
// survey answers TODAY, so the field is hidden there (see the template's `v-if="mode === 'voluntary'"`).
//
// ⚠️ THIS REF IS VOLUNTARY MODE'S DATE, and since W3 it is ONLY that. Survey mode does not write it: what
// the browser calls "today" is not necessarily the plant city's today, and the API judges — and the write
// is validated — on the PLANT's day, so every survey write carries `preview.measuredOn` instead. This ref
// still sits at its `todayYmd()` default through a survey session; nothing reads it there.
const measuredOn = ref(todayYmd());

// Owner-ruled (2026-08-08): the same-day-watering question is asked ONLY when the chosen `measuredOn` is
// itself a day the plant was watered — asking on every reading would be noise on the overwhelming majority
// of them, and noise is how a question stops being read. VOLUNTARY MODE ONLY — see `showWateringRelation`.
const isWateringDay = computed(() =>
  serverSaysWateringDay.value || props.data.wateringDays.includes(measuredOn.value));

// The answer describes ONE specific day. If the owner changes `measuredOn` — to a non-watering day, where
// the control disappears entirely, or to a DIFFERENT watering day — a previously-given answer no longer
// describes the new day and must never survive: not into a submission for a day it doesn't describe, and
// not as a stale pre-selection if the control reappears for a later watering day (that would silently
// reintroduce the very default/pre-selection the owner ruled against). Cleared unconditionally on every
// change; harmless when there was nothing to clear. (Survey mode never changes `measuredOn` — the field
// isn't rendered — so this watcher is inert there, not dead: voluntary mode still needs it.)
watch(measuredOn, () => {
  wateringRelation.value = '';
  // The server's reveal was about the PREVIOUS day; a new date must be judged on its own evidence.
  serverSaysWateringDay.value = false;
});

// Single source of truth for "ask the same-day-watering question at all".
//
// ⚠️ CORRECTED 2026-08-10 (QA defect 3). This used to read `props.mode === 'voluntary' && isWateringDay`,
// justified by: "survey mode's own order is fixed by construction (measure → verdict → water → done), so
// the reading is always BEFORE that day's watering and there is nothing left to ask."
//
// THAT PREMISE IS TRUE ONLY OF THE WATERING THIS FLOW CREATES. It is false of a watering that already
// happened earlier the same day — water in the morning, measure in the evening, which is not an edge case
// but the ordinary rhythm of caring for a plant. On such a plant the preview succeeded and the write was
// refused `400` ("wateringRelation is required"), the owner saw a generic "please try again", and retrying
// could never succeed because the question had no control to answer it through. Two of the four QA fixture
// plants were unusable for the whole day.
//
// The question is asked on the MEASURE step, before any verdict exists — deliberately, because it must be
// answerable before the owner presses the primary button rather than revealed afterwards by a failure. So
// this gate is `isWateringDay` in both modes and nothing else.
//
// ⚠️ THERE IS NO `WATER_NOW` EXEMPTION ON THIS PATH — CORRECTED 2026-08-10 (QA round 4), and the previous
// text here is the reason the defect existed, so it is quoted rather than deleted: *"the `WATER_NOW`
// exemption is real but belongs to the API… the client honours it by not SENDING the field on that
// branch."*
//
// The API's exemption is real and remains untouched, but it is keyed on `verdict: 'WATER_NOW'`, and this
// flow has not sent that verdict since 2026-08-09 (a WATER_NOW survey writes `verdict: 'NONE'` — it teaches
// the fit and moves no schedule). The exemption's justification is that the write creates the watering the
// reading precedes; a write that creates no watering cannot derive that, so the client must supply it. The
// full account sits at the WATER_NOW branch in `submit()`.
//
// The gate is `isWateringDay` in both modes, for all three verdicts, and nothing else. In particular it is
// deliberately NOT conditioned on `previewResult`: such a term would be inert (the control only renders
// while the verdict is still unknown) and worse than inert, since the one moment it could ever evaluate
// true is a failed write, where hiding the control is exactly the dead end this whole area keeps
// rediscovering.
const showWateringRelation = computed(() => isWateringDay.value);

// FIX (fix wave 1, item 3) — `min`/`max` attributes on a number input do NOT block a click-submit, and the
// shared Zod schema requires only a finite number, so typing e.g. `55` on the 1–10 galvanic probe used to
// record a fully-wet `w = 1.0` reading with no complaint anywhere, corrupting the slope fit this whole
// feature exists to protect. The server's own clamp stays untouched (docs/care-engine.md §7.20.2 rules it
// the honest treatment of an out-of-range reading) — this is a CLIENT-side gate so the owner never reaches
// it by accident. Gated on `rawMax` being DECLARED: the kitchen scale's `rawMax` is `null` (grams are
// open-ended) and must stay unrestricted, same convention `RepotDoneForm.vue`'s `potSizeValid`/
// `potSizeInvalid` pair already uses for its own bounded numeric field.
// FIX (QA finding F5, 2026-08-08) — this used to bail out entirely when `rawMax` was null, which meant the
// kitchen scale (grams, open-ended ceiling) had NO client bound at all, floor included: a weight of `-50`
// passed the browser and the server accepted it too. The ceiling is genuinely open-ended and stays so; the
// FLOOR always binds, because `rawMin: 0` on that row is a real statement (a pot cannot weigh less than
// nothing). The server now refuses both ends through the SAME shared schema (`soilReadingCreateSchema`),
// so this is the fast, local half of one rule, never the only copy of it.
const rawValueOutOfRange = computed(() => {
  const row = instrument.value;
  if (row == null || rawValue.value == null) return false;
  return rawValue.value < row.rawMin || (row.rawMax != null && rawValue.value > row.rawMax);
});

// GRANULARITY, the local half of the shared contract's own `rawValueRangeRefinement` step check (QA
// 2026-08-10). CLOSED SCALES ONLY: the kitchen scale declares `rawStep: 1` but an open-ended `rawMax`,
// because grams really are continuous and `1234.5 g` is a reading a real scale gives — the identical
// condition the server applies, so the button and the API can never disagree about what is submittable.
const rawValueOffStep = computed(() => {
  const row = instrument.value;
  if (row == null || rawValue.value == null || row.rawMax == null || row.rawStep <= 0) return false;
  const steps = (rawValue.value - row.rawMin) / row.rawStep;
  return Math.abs(steps - Math.round(steps)) > 1e-9;
});
// Shown only once the owner has typed SOMETHING — an empty field is simply "not filled in yet" (canSubmit
// already gates on that), never an inline error of its own. Same shape as RepotDoneForm.vue's own
// `potSizeErrorMessage`.
// Two messages, because there are two genuinely different bounds (QA F5): a CLOSED scale states both ends,
// an OPEN-ENDED one has no ceiling to state and the old single message rendered "between 0 and ." for it.
const rawValueErrorMessage = computed(() => {
  if (rawValue.value == null) return undefined;
  const row = instrument.value!;
  // BOUNDS FIRST when a value breaks both (e.g. `99.5` on a 1..10 probe): one message, and it must be the
  // one the owner can act on. The shared refinement orders its two issues the same way, deliberately.
  if (rawValueOutOfRange.value) {
    return row.rawMax == null
      ? t('reading.valueBelowMin', { min: row.rawMin })
      : t('reading.valueOutOfRange', { min: row.rawMin, max: row.rawMax });
  }
  if (rawValueOffStep.value) return t('reading.valueOffStep', { min: row.rawMin, step: row.rawStep });
  return undefined;
});

/**
 * WHY THE PRIMARY BUTTON IS DISABLED, or `undefined` when it is not (QA UX-2).
 *
 * A dead green button that explains nothing is a dialog the owner cannot get out of without guessing. The
 * order matters: it reports the FIRST thing standing in the way, walking the form top-to-bottom the way
 * the owner's eye does, rather than whichever condition happens to be evaluated first.
 *
 * ⚠️ IT USED TO GO DELIBERATELY SILENT ABOUT THE VALUE'S OWN BOUNDS AND STEP, on the reasoning that those
 * already render inline on the field and saying it twice reads as two separate faults. QA (round 3,
 * 2026-08-10) overturned that from the owner's side: typing `11` into a field labelled `Reading (1–10
 * index)` greyed the button out with nothing beside it, and the same for `0`, `1.5`, `-5` and `1e3`. The
 * inline message is real, but the footer is where the owner looks when the button will not press — and in a
 * tall dialog (the kitchen scale renders three number fields plus two hints) the field can be scrolled out
 * of view while the footer is not. THE DATE FIELD ALREADY WORKS THIS WAY, states its reason in both places,
 * and QA verified it as the good case; this is the same treatment for the number.
 */
const blockedReason = computed(() => {
  if (submitting.value || instrumentId.value === '') return undefined;
  // Ahead of the value: a date the owner has to correct anyway makes every other complaint noise.
  if (measuredOnInFuture.value) return t('reading.measuredOnFuture');
  if (rawValue.value == null) return t('reading.missingValue');
  // The SAME sentence the field shows, not a second phrasing of it — two wordings for one fault is what
  // actually reads as two faults.
  if (rawValueOutOfRange.value || rawValueOffStep.value) return rawValueErrorMessage.value;
  if (needsCalibration.value || (showsCalibration.value && calibrationChanged.value)) {
    // ⚠️ THREE OUTCOMES, NOT TWO (QA round 3, defect 5). This used to collapse every calibration problem
    // into "fill in both reference weights first", so an INVERTED pair (800 watered / 1500 dry) — both
    // fields filled, the real fault stated correctly inline — was explained in the footer as two empty
    // fields the owner was staring at. A blocking reason that describes a state the owner can see is false
    // is worse than none: it costs him the trust he needs to believe the next one.
    if (calibration.saturatedValue == null || calibration.dryValue == null) {
      return t('reading.missingCalibration');
    }
    if (calibrationOffScale.value) return calibrationOffScale.value;
    if (calibration.saturatedValue <= calibration.dryValue) return t('reading.calibration.spanInvalid');
  }
  if (showWateringRelation.value && wateringRelation.value === '') {
    return t('reading.missingWateringRelation');
  }
  return undefined;
});

const canSubmit = computed(() =>
  instrumentId.value !== '' && rawValue.value != null && !submitting.value &&
  !rawValueOutOfRange.value && !rawValueOffStep.value && !measuredOnInFuture.value &&
  // Owner-ruled (2026-08-08): required, un-defaulted, whenever the control is actually shown — since
  // 2026-08-10 that means ANY watering day, in either mode (see `showWateringRelation`).
  (!showWateringRelation.value || wateringRelation.value !== '') &&
  // Two conditions, because a calibration can now be EDITED as well as first supplied (QA round 3):
  // it must be usable when the pot has none yet, and it must still be usable if the owner has touched it.
  // A pot with a good stored calibration the owner leaves alone gates on neither.
  (!needsCalibration.value || calibrationUsable.value) &&
  (!calibrationChanged.value || calibrationUsable.value));

// "Calcular riego" in survey mode (the modal is about to ANSWER something), "Save reading" in voluntary
// mode (the modal is simply recording one). See the file-header comment for why the two verbs are not
// interchangeable copy for the same button.
const primaryLabel = computed(() => (props.mode === 'survey' ? t('reading.calculate') : t('reading.save')));

// The chosen date spelled out in the APP's locale (QA UX-5). The `<input type="date">` above renders in the
// BROWSER's, which is a different setting entirely — `08/10/2026` is 10 August to one reader and 8 October
// to another, and nothing on screen said which. Built through `ymdToLocalDate` rather than `new Date(ymd)`:
// the bare string parses as UTC midnight and renders one day early west of Greenwich, which would make the
// clarification itself the lie.
const measuredOnHint = computed(() =>
  (measuredOn.value ? d(ymdToLocalDate(measuredOn.value), 'short') : undefined));

/**
 * A MEASUREMENT CANNOT BE DATED IN THE FUTURE (QA 2026-08-10, defect 3).
 *
 * The field already carries `max="<today>"`, and that attribute stops the picker's arrows and nothing else:
 * a typed `08/25/2026` sails straight through. The server refuses it correctly and precisely — *"measuredOn
 * must be today or earlier for this plant (its local today is …, you sent …)"* — but the modal rendered its
 * catch-all "we couldn't save that reading, please try again", which is advice that can never work: the same
 * request will be refused forever. That is the identical dead end the survey had on a plant watered today,
 * reached through a different door.
 *
 * Guarded here so the owner never gets that far, AND surfaced honestly in the catch below if a request
 * still manages to be refused for this reason — the two are not redundant. This one compares against the
 * BROWSER's today, which is all a client can know; the server compares against the PLANT's, and across the
 * midnight gap those differ, so the server's refusal remains reachable and must stay legible.
 */
const measuredOnInFuture = computed(() =>
  props.mode === 'voluntary' && !!measuredOn.value && measuredOn.value > todayYmd());

async function submit() {
  if (!canSubmit.value || instrumentId.value === '' || rawValue.value == null) return;
  const chosenInstrumentId = instrumentId.value;
  const chosenRawValue = rawValue.value;
  submitting.value = true;
  error.value = null;
  try {
    // The calibration is saved FIRST when the pot has none: the reading's normalisation reads it, so a
    // reading (or a preview, which normalises the SAME way) run before it would see a null wetness.
    //
    // ⚠️ ALSO WHEN THE OWNER CORRECTED AN EXISTING ONE (QA round 3) — the fields are editable now, and an
    // edit nobody sent is an edit that did not happen, which is the worst of the three outcomes: the owner
    // watched himself fix a wrong anchor and the pot kept the wrong one. Gated on `calibrationChanged` and
    // not merely on "the fields are filled", so simply opening the dialog on a calibrated pot does not
    // re-`PUT` identical numbers — the API treats an anchor MOVE as a retraction of the fractions it
    // produced, and it deserves to see only real moves.
    if (needsCalibration.value || calibrationChanged.value) {
      await api.setInstrumentCalibration(props.plantId, chosenInstrumentId, {
        saturatedValue: calibration.saturatedValue as number,
        dryValue: calibration.dryValue as number,
      });
    }

    if (props.mode === 'survey') {
      // Read-only: "water this pot today, or hold?" Nothing is written by this call, and — per the branch
      // below — nothing is written at all until the branch itself decides to (see the file-header comment,
      // "Nothing is written until the branch acts").
      const preview = await api.previewSoilReading(props.plantId, {
        instrumentId: chosenInstrumentId,
        rawValue: chosenRawValue,
      });
      previewResult.value = preview;
      // FIX W3 — every write that follows a survey is dated by the PREVIEW, never by this browser.
      //
      // The API judges the reading against the plant CITY's local day, and this component's `measuredOn`
      // holds the BROWSER's (`todayYmd()`). Those are the same day for most of the day and different
      // across the midnight gap, and both directions dead-end the survey. Browser BEHIND the plant: the
      // reading lands on yesterday, so the care payload's `measuredToday` never flips and the row goes on
      // asking "¿Necesitas regar?" forever. Browser AHEAD: the write carries a future date and the API's
      // own past-event rule refuses it with a 400, after the owner has already measured.
      //
      // Read ONCE, here, into a local — not off `previewResult` at each write site — so all three survey
      // writes below (HOLD, WATER_NOW, and the UNAVAILABLE save the owner may tap much later) are dated by
      // the same one answer, and the reopen reset cannot strand the deferred one. Voluntary mode never
      // reaches this: there the owner picks the date himself, and no preview ran to name a better one.
      const verdictMeasuredOn = preview.measuredOn;

      if (preview.recommendation === 'HOLD') {
        // "No riegues todavía" — applied IMMEDIATELY. The owner asked a question and the engine answered
        // it; there is nothing left for him to confirm, so the postpone is recorded as part of reaching
        // this verdict, not behind a second tap.
        await api.recordSoilReading(props.plantId, {
          instrumentId: chosenInstrumentId,
          rawValue: chosenRawValue,
          measuredOn: verdictMeasuredOn,
          verdict: 'POSTPONE',
          ...(preview.suggestedPostponeToOn ? { postponeToOn: preview.suggestedPostponeToOn } : {}),
          // QA defect 3 — a plant watered EARLIER today is refused without this, and survey mode had no
          // way to supply it. `showWateringRelation` gates the control and `canSubmit` gates the button,
          // so reaching here with the control shown means the owner answered it.
          ...(showWateringRelation.value
            ? { wateringRelation: wateringRelation.value as WateringRelation }
            : {}),
        }, idempotencyKey.value);
        emit('saved');
      } else if (preview.recommendation === 'UNAVAILABLE') {
        // Owner ruling (2026-08-09): UNAVAILABLE is OFFERED, never PERFORMED — nothing is written on
        // arrival. HOLD applies itself because the app HAS an answer and that answer IS an action;
        // UNAVAILABLE has no answer, and a null-wetness reading teaches the drying-rate fit nothing (a null
        // fraction is excluded from the fit), so an automatic write would be acting on the owner's behalf
        // for no benefit. Asking costs one tap and is honest. `saveUnavailableReading()` below is that tap;
        // it fires ONLY if the owner presses "Guardar lectura" on the verdict step.
        pendingUnavailableReading.value = {
          instrumentId: chosenInstrumentId, rawValue: chosenRawValue, measuredOn: verdictMeasuredOn,
          // Captured WITH the rest of the pending reading rather than read off the ref at save time: the
          // owner may tap "Guardar lectura" much later, and the answer must describe the day this reading
          // was taken on, not whatever the control happens to hold by then (QA defect 3).
          ...(showWateringRelation.value
            ? { wateringRelation: wateringRelation.value as WateringRelation }
            : {}),
        };
      } else if (preview.recommendation === 'WATER_NOW') {
        // Owner ruling (2026-08-09, measured-verdict-gap redesign): WATER_NOW now WRITES the reading, with
        // `verdict: 'NONE'`. It changes no schedule (`NONE` never touches DueCache/TaskOverride the way
        // `POSTPONE` does), but it IS real data — a genuine wetness fraction that feeds the drying-rate
        // fit — and, just as importantly, it is what lets the row's own `measuredToday` gate flip: without
        // this write, nothing on this plant would ever record that today's survey happened, and the row
        // would keep offering "¿Necesitas regar?" forever after the owner already answered it and went to
        // water. `emit('saved')` fires HERE, the same as HOLD's own branch above (and BEFORE the verdict
        // step renders) — the caller's refresh (`onReadingSaved`/`onWaterEvaluate`'s callers) runs in the
        // background while the owner is still reading the verdict, so `canSurvey` has already flipped false
        // by the time he closes the modal, instead of only on a later reload.
        await api.recordSoilReading(props.plantId, {
          instrumentId: chosenInstrumentId,
          rawValue: chosenRawValue,
          measuredOn: verdictMeasuredOn,
          verdict: 'NONE',
          // ⚠️ THIS SPREAD WAS MISSING, AND ITS ABSENCE WAS ARGUED FOR IN A COMMENT (QA round 4,
          // 2026-08-10). The argument: a WATER_NOW reading is exempt from the same-day question because the
          // API derives `BEFORE` by construction — the reading is what prompted the watering the write is
          // about to create.
          //
          // Every word of that is still true OF `verdict: 'WATER_NOW'`. It stopped being true of THIS
          // branch on 2026-08-09, when the owner ruled that a WATER_NOW survey writes the reading with
          // `verdict: 'NONE'` (it teaches the drying-rate fit and moves no schedule; the owner presses Done
          // separately afterwards). The server's exemption is keyed on the VERDICT, so the moment this
          // branch stopped sending `WATER_NOW` it stopped qualifying — and it stopped qualifying
          // CORRECTLY, because a write that creates no watering cannot derive a reading's position
          // relative to one.
          //
          // Nothing failed at the seam. Two independently correct pieces simply stopped meeting, and the
          // result was a permanent dead end on the ordinary case of watering in the morning and measuring a
          // dry pot in the evening: the preview said WATER_NOW, the write was refused, and retrying was
          // refused identically — while the owner watched his own answer sitting selected on screen. Worse,
          // nothing was written, so `measuredToday` never flipped and the row went on asking "¿Necesitas
          // regar?" forever, which is the exact dead end this write exists to close.
          //
          // So it travels, gated by `showWateringRelation` exactly as HOLD's does two branches up — true
          // only on a day that genuinely carries a watering, which is also the only day the API accepts the
          // field at all.
          ...(showWateringRelation.value
            ? { wateringRelation: wateringRelation.value as WateringRelation }
            : {}),
        }, idempotencyKey.value);
        emit('saved');
      }
      step.value = 'verdict';
    } else {
      // Voluntary: always `verdict: 'NONE'` — this mode never asks "what are you doing about it", it only
      // records the reading. No verdict step follows a successful save; the modal closes exactly like the
      // pre-redesign NONE-verdict path did.
      await api.recordSoilReading(props.plantId, {
        instrumentId: chosenInstrumentId,
        rawValue: chosenRawValue,
        measuredOn: measuredOn.value,
        verdict: 'NONE',
        // Sent ONLY when the question was actually asked (`showWateringRelation`) — `canSubmit` already
        // guarantees it was answered whenever that holds, so the cast is safe.
        ...(showWateringRelation.value ? { wateringRelation: wateringRelation.value as WateringRelation } : {}),
      }, idempotencyKey.value);
      open.value = false;
      emit('saved');
    }
  } catch (e: any) {
    // FIX (fix wave 1, item 4) — the idempotency key is pinned per open and reused across retries (correct:
    // a lost-response retry must never write a second reading), but that same discipline means a 409/422 on
    // THIS route can only mean the ORIGINAL request already committed: the global interceptor stores a key
    // on success, answers an in-flight duplicate 409, and answers a same-key/different-body retry 422
    // FOREVER under that key (docs' idempotent-creates contract). So the honest handling is not "try again"
    // — it is "this already happened": tell the owner, refresh through the SAME seam a successful save uses
    // (`emit('saved')`, which drives PlantDetail.vue's `onReadingSaved`), and close. Deliberately NOT
    // porting RepotDoneForm.vue's whole `frozen` machinery here (owner ruling) — reopening mints a fresh
    // key, and there is nothing left to retry once the server already has the reading. Applies to BOTH
    // modes: a genuine idempotency replay means the same thing regardless of which flow produced the write.
    // ⚠️ READ THROUGH `utils/upstreamError.ts`, NEVER OFF `e.data` DIRECTLY (QA round 3, 2026-08-10).
    //
    // Every call here is proxied by the Nuxt BFF, which re-throws through h3's `createError({ statusCode,
    // data: <the API's body> })`. ofetch hands the browser the whole serialized envelope as `err.data`, so
    // the API's own message sits at `err.data.data.message` — and the envelope carries NO `message` key of
    // its own (measured, in `server/api/proxy.wire.test.ts`).
    //
    // The two branches below used to read `String(e?.data?.message ?? e?.message ?? '')`. Both halves of
    // that fallback miss: the first is `undefined`, and the second is ofetch's own summary line —
    // `[GET] "http://…/api/…": 400 Bad Request` — which contains the method, the URL and the status, and
    // none of the API's words. So `.includes('wateringRelation')` was false EVERY TIME, since the day these
    // branches were written, and both fell through to the generic `reading.saveFailed`. QA saw only the
    // symptom (a survey dead-ended on a plant watered earlier the same day, told to "try again" on a
    // request the server would refuse identically forever). The cause was not that the recovery was wrong:
    // it was unreachable.
    //
    // This repo already learned this once. That module was written after an EXPIRED proposal was explained
    // to the owner as "someone else resolved this", and its header says outright that consumers must never
    // index into `data.data` themselves. This file did its own indexing anyway — which is why a second copy
    // of a lookup is not a harmless duplicate: it is a copy that can be silently wrong while looking right.
    const status = upstreamErrorCode(e);
    const upstreamMessage = upstreamErrorMessage(e);
    if (status === 409 || status === 422) {
      error.value = t('reading.alreadyRecorded');
      open.value = false;
      emit('saved');
    } else if (status === 400 && upstreamMessage.includes('wateringRelation')) {
      // DEFENCE IN DEPTH for the same-day question — IN BOTH MODES since 2026-08-10 (QA defect 3). It used
      // to be voluntary-only, on the reasoning that survey mode "never sends `wateringRelation` at all —
      // impossible by construction". That reasoning has been corrected where it originates, at
      // `showWateringRelation`; the short version is that a survey's order is fixed only relative to the
      // watering IT creates, not to one that already happened that morning. With the gate voluntary-only,
      // a survey on such a plant showed a generic "please try again" for a request that could NEVER
      // succeed — the recovery this branch exists to provide was the one thing walled off from the mode
      // that needed it most.
      //
      // `wateringDays` is a SNAPSHOT and can be behind the server in three real ways: the owner watered
      // from this same page after it loaded (PlantDetail.vue's `sendDone` refreshes it, the primary fix),
      // the reading is back-dated past the window that list covers, or — survey mode only — the plant's
      // local day is not the browser's, so the day the API judged is not the day this list was checked
      // against. In every case the server knows and refuses honestly, so REVEAL THE QUESTION rather than a
      // dead end. The question is still ASKED, never inferred: we surface it, the owner answers, the retry
      // carries a real answer.
      serverSaysWateringDay.value = true;
      error.value = t('reading.wateringRelationRequired');
    } else if (status === 400 && upstreamMessage.includes('measuredOn')) {
      // The server judges "future" against the PLANT's local day; the client guard above judges against the
      // browser's. Across the midnight gap those disagree, so this refusal stays reachable even with the
      // field guarded — and it must say what it is about. Falling through to the generic branch printed
      // "please try again" for a request the server will refuse identically forever (QA defect 3).
      error.value = t('reading.measuredOnFuture');
    } else {
      // Covers every OTHER failure too, including a rejected `previewSoilReading` call and a rejected
      // survey-branch `recordSoilReading` — in every case `step` is still `measure` (it only ever advances
      // AFTER the awaited call above succeeds), so the owner lands back on the form, unwritten, and free to
      // retry with the same idempotency key.
      error.value = t('reading.saveFailed');
    }
  } finally {
    submitting.value = false;
  }
}

/**
 * The WATER_NOW verdict's two actions (QA 2026-08-10). CLOSES FIRST, then emits.
 *
 * The order is load-bearing, not tidiness: the page's `onDone` can open a SECOND dialog (the early-water
 * reason picker, when the watering is ahead of schedule), and emitting while this modal is still mounted
 * would stack one modal on another. Closing first also means the owner's next view is the task row — which
 * by then has already flipped out of its survey state, because the reading written on the way to this
 * verdict set `measuredToday`.
 */
function actOnVerdict(action: 'water-done' | 'water-postpone') {
  open.value = false;
  // Branched rather than `emit(action)`: `defineEmits`'s generated overloads are resolved per literal, so
  // handing one a UNION of two event names matches no overload at all (TS2769). Two calls, no cast.
  if (action === 'water-done') emit('water-done');
  else emit('water-postpone');
}

// The OFFERED save for an UNAVAILABLE verdict (owner ruling, 2026-08-09 — see `submit()`'s own comment on
// the branch that sets `pendingUnavailableReading` instead of writing). Reachable ONLY from the verdict
// step's own "Guardar lectura" button, and only while that pending reading exists — `previewResult` staying
// `UNAVAILABLE` is not enough on its own, since a stale click after a reopen must not resurrect a PREVIOUS
// session's reading.
async function saveUnavailableReading() {
  const pending = pendingUnavailableReading.value;
  if (pending == null || submitting.value) return;
  submitting.value = true;
  error.value = null;
  try {
    await api.recordSoilReading(props.plantId, {
      instrumentId: pending.instrumentId,
      rawValue: pending.rawValue,
      measuredOn: pending.measuredOn,
      verdict: 'NONE',
      // Carried from the moment the reading was taken, not re-read now (QA defect 3 — see where this
      // pending record is built). Absent unless the day genuinely carried a watering.
      ...(pending.wateringRelation ? { wateringRelation: pending.wateringRelation } : {}),
    }, idempotencyKey.value);
    pendingUnavailableReading.value = null;
    open.value = false;
    emit('saved');
  } catch (e: any) {
    // Same idempotency-replay handling as `submit()`'s catch — a 409/422 here can only mean this exact
    // reading already committed under this key (see that comment for the full reasoning), and the same
    // `utils/upstreamError.ts` lookup, for the same reason: the BFF envelope has no `message` of its own,
    // so a direct `e.data.message` read is `undefined` and matches nothing.
    const status = upstreamErrorCode(e);
    if (status === 409 || status === 422) {
      error.value = t('reading.alreadyRecorded');
      pendingUnavailableReading.value = null;
      open.value = false;
      emit('saved');
    } else if (status === 400 && upstreamErrorMessage(e).includes('wateringRelation')) {
      // ⚠️ THIS BRANCH USED TO BE RULED OUT IN A COMMENT — *"never the `wateringRelation`-reveal branch:
      // this button never sends that field"*. True, and beside the point: the field is not missing because
      // the button declined to send it, it is missing because the PENDING RECORD was frozen at a moment
      // when `showWateringRelation` was false (the page's `wateringDays` snapshot did not yet name the day
      // as watered). The owner then taps "Guardar lectura" minutes later, against a server that knows
      // better, and the save is refused — permanently, since the frozen record can never gain the field.
      //
      // So send him BACK to the measure step rather than leaving a dead verdict screen. The reveal below
      // makes the control appear there, the instrument and reading are still filled in, and pressing the
      // primary button again runs the ordinary survey path — which now carries the answer. No new save
      // path, no second way to write a reading: the recovery is the flow he already knows.
      serverSaysWateringDay.value = true;
      pendingUnavailableReading.value = null;
      step.value = 'measure';
      error.value = t('reading.wateringRelationRequired');
    } else {
      error.value = t('reading.saveFailed');
    }
  } finally {
    submitting.value = false;
  }
}

// Two options → segmented control, same design-system rule `instrumentId`'s picker above already follows.
const wateringRelationOptions = computed(() => [
  { key: 'BEFORE', label: t('reading.wateringRelation.before') },
  { key: 'AFTER', label: t('reading.wateringRelation.after') },
]);

// The date `verdictHoldBody` names, formatted the same way every other calendar-date display in the app
// already does (`d(ymdToLocalDate(...), 'short')` — ClinicalRecordModal.vue, RepotVerdictModal.vue,
// TaskRow.vue). `suggestedPostponeToOn` is null only when the recommendation is NOT `HOLD` (the shared
// contract's own invariant); this stays defensive rather than asserting it, so a contract violation renders
// an empty date instead of throwing.
const holdDateLabel = computed(() => {
  const on = previewResult.value?.suggestedPostponeToOn;
  return on ? d(ymdToLocalDate(on), 'short') : '';
});
</script>

<template>
  <Modal v-model="open" :title="t('reading.title')">
    <!-- ⚠️ THE WORD "Settings" HERE IS A REAL LINK (QA finding F11, 2026-08-08). This alert is the app
         telling the owner to go somewhere; before this it named the destination and gave them no way to
         reach it, and on a desktop viewport there was no other route to `/settings` at all (QA F1). A
         `NuxtLink` closes the loop, and `i18n-t` keeps the sentence a single translatable unit rather
         than three concatenated fragments — the app's standing i18n rule. -->
    <Alert v-if="data.instruments.length === 0" color="amber">
      <i18n-t keypath="reading.noInstruments" tag="span">
        <template #settings>
          <NuxtLink to="/settings" class="mp-reading__link" @click="open = false">
            {{ t('reading.settingsLink') }}
          </NuxtLink>
        </template>
      </i18n-t>
    </Alert>

    <template v-else-if="step === 'measure'">
      <!-- Two options today → segmented control (design-system rule: up to 3–4 short options). -->
      <FormGroup :label="t('reading.instrument')">
        <SegmentedControl v-model="instrumentId" :options="options" />
      </FormGroup>

      <!-- ⚠️ THE PROTOCOL IS INSTRUMENT-CONDITIONAL (QA finding F2, 2026-08-08). It used to print the
           INSERTION protocol — "insert to about 8 cm deep, roughly 4 cm from the centre" — for a KITCHEN
           SCALE, in this prominent amber alert, with the real weighing note demoted to muted grey
           underneath. A scale is never inserted into anything, so the app was stating a procedure that
           cannot be followed, in its loudest voice, for the very reason the protocol exists (repeatability).
           Which protocol applies is a PROPERTY OF THE INSTRUMENT ROW (`protocolKind`, shared contract) —
           never a branch invented here, and never a second copy of the table, so the capacitive and
           tensiometer rows land with the right protocol the day they are added. -->
      <template v-if="protocolKind === 'whole-pot-mass'">
        <Alert color="amber">{{ t('reading.protocolWholePot') }}</Alert>
      </template>
      <!-- QA 2026-08-10: the finger was shown the WOODEN STICK's guidance verbatim — "insert to about 6 cm"
           — because both rows said `insertion` and the depth is computed from the pot. A finger reaches
           about 3 cm whatever the pot's diameter says, so that instruction was unfollowable, contradicted
           our own Settings copy, and contradicted `FINGER_DEPTH_PENALTY`, which exists precisely because
           the finger samples the top layer. Branching on the ROW's `protocolKind`, never on the id — the
           same rule that fixed the kitchen scale being shown an insertion depth. -->
      <template v-else-if="protocolKind === 'shallow-insertion'">
        <Alert color="amber">{{ t('reading.protocolShallow') }}</Alert>
      </template>
      <template v-else>
        <Alert v-if="data.protocol" color="amber">
          {{ t('reading.protocol', {
            depth: data.protocol.insertionDepthCm,
            distance: data.protocol.distanceFromCentreCm,
          }) }}
        </Alert>
        <Alert v-else color="amber">{{ t('reading.protocolUnknownPot') }}</Alert>
      </template>

      <!-- One line, instrument-specific, and about COMPARABILITY only — the "how do I take the reading"
           half now lives in the protocol alert above, where it belongs. The comparison table lives in
           /settings, not here. -->
      <p v-if="instrument" class="mp-reading__note">
        {{ t(`reading.honesty.${instrument.id}`) }}
      </p>

      <!-- Shown whenever the instrument USES a calibration — not only while it lacks one (QA round 3).
           A stored calibration the owner cannot see is one he cannot correct, and a wrong anchor silently
           rescales every future reading of this pot into a perfectly legal fraction. -->
      <InstrumentCalibrationFields
        v-if="showsCalibration && instrument"
        v-model="calibration"
        :unit-label="valueUnitLabel"
        :off-scale-error="calibrationOffScale"
      />

      <FormGroup :label="valueFieldLabel" :error="rawValueErrorMessage">
        <!-- An ORDINAL instrument (the wooden stick, the finger) produces one of a few NAMED states, never
             a number — see OrdinalReadingPicker.vue's own header comment. The caller (here) is responsible
             for gating on `captureKind === 'ordinal'`; the picker throws legibly if that guard is skipped. -->
        <OrdinalReadingPicker
          v-if="instrument && instrument.captureKind === 'ordinal'"
          v-model="rawValue"
          :instrument-id="instrument.id"
        />
        <Input
          v-else
          v-model.number="rawValueField"
          type="number"
          inputmode="decimal"
          :min="instrument?.rawMin"
          :max="instrument?.rawMax ?? undefined"
          :step="instrument?.rawStep"
          :error="rawValueErrorMessage"
        />
      </FormGroup>

      <!-- Voluntary mode ONLY — a survey answers TODAY, so this field is hidden there entirely (never
           merely disabled), and `measuredOn` stays pinned to `todayYmd()` for the whole session. See the
           file-header comment. -->
      <!-- QA UX-5: `<input type="date">` renders in the BROWSER's locale, not the app's, so a Mexican
           owner reading the interface in Spanish saw `08/10/2026` and could reasonably parse it as
           8 October. The native control cannot be steered, so the resolved date is stated beside it in the
           app's own locale — the unambiguous reading, next to the ambiguous one. -->
      <FormGroup
        v-if="mode === 'voluntary'"
        :label="t('reading.measuredOn')"
        :hint="measuredOnHint"
        :error="measuredOnInFuture ? t('reading.measuredOnFuture') : undefined"
      >
        <Input v-model="measuredOn" type="date" :max="todayYmd()" />
      </FormGroup>

      <!-- Owner-ruled (2026-08-08): shown on a day the plant was also watered — never a default, never
           pre-selected. ⚠️ CORRECTED 2026-08-10: this comment used to say "voluntary mode ONLY … survey
           mode never reaches this at all", which was true of the code and false of reality — see
           `showWateringRelation`. Both modes ask it now. Two options → segmented control, same rule the
           instrument picker above follows. -->
      <FormGroup
        v-if="showWateringRelation"
        :label="t('reading.wateringRelationLabel')"
        :hint="t('reading.wateringRelationHint')"
        required
      >
        <SegmentedControl v-model="wateringRelation" :options="wateringRelationOptions" />
      </FormGroup>

      <Alert v-if="error" color="red" :description="error" announce />
    </template>

    <!-- The verdict step — survey mode only (see `submit()`'s `step.value = 'verdict'` assignment, reached
         only from the `mode === 'survey'` branch). Shaped like RepotVerdictModal.vue: a short title stating
         the answer, then whatever body that answer needs. -->
    <template v-else>
      <template v-if="previewResult?.recommendation === 'WATER_NOW'">
        <h3 class="mp-reading__verdict-title">{{ t('reading.verdictWaterNowTitle') }}</h3>
        <!-- QA (2026-08-10, UX-4): HOLD carried a supporting sentence and WATER_NOW carried none, so the
             payoff verdict of the whole redesign read as an unfinished screen next to the "not yet" one. -->
        <p class="mp-reading__verdict-body">{{ t('reading.verdictWaterNowBody') }}</p>
      </template>
      <template v-else-if="previewResult?.recommendation === 'HOLD'">
        <h3 class="mp-reading__verdict-title">{{ t('reading.verdictHoldTitle') }}</h3>
        <p class="mp-reading__verdict-body">{{ t('reading.verdictHoldBody', { date: holdDateLabel }) }}</p>
      </template>
      <template v-else-if="previewResult?.recommendation === 'UNAVAILABLE'">
        <!-- "no verdict" (spec) — no title claiming an answer that was never reached, only the reason. The
             save itself is OFFERED here (owner ruling, 2026-08-09), via the footer's "Guardar lectura" —
             see `saveUnavailableReading()`. -->
        <p class="mp-reading__verdict-body">
          {{ t(`reading.verdictUnavailableReason.${previewResult.unavailableReason}`) }}
        </p>
      </template>
      <Alert v-if="error" color="red" :description="error" announce />
    </template>

    <template #footer>
      <template v-if="step === 'measure'">
        <!-- QA UX-2: the primary button used to go dead with nothing said. Rendered in the footer beside
             it, and `aria-live` so a screen reader hears the reason appear rather than only sighted users
             noticing a button that will not press. -->
        <p v-if="blockedReason" class="mp-reading__blocked" aria-live="polite">{{ blockedReason }}</p>
        <Button variant="ghost" @click="open = false">{{ t('common.cancel') }}</Button>
        <Button :disabled="!canSubmit" :loading="submitting" @click="submit">
          {{ primaryLabel }}
        </Button>
      </template>
      <!-- WATER_NOW and HOLD both already WROTE their reading the instant this step was reached (see
           `submit()`), so neither has a reading left to confirm.
           ⚠️ WATER_NOW nonetheless CARRIES ACTIONS, and the reason it now does is worth stating: the
           reading it wrote uses `verdict: 'NONE'`, which deliberately moves no schedule — so at this point
           the app knows the pot needs water and NOTHING has recorded that it was watered. This footer used
           to offer only Close, on the reasoning that "the row's Hecho/Posponer take over from here". They
           do (the write flips `measuredToday`, which closes the survey affordance and reopens the classic
           pair) — but only AFTER the owner closes this dialog and finds them, and QA (2026-08-10) judged
           the payoff of the entire redesign unreachable in practice for exactly that reason.
           The two actions are NOT a second implementation: they emit, and the page routes them through the
           same `onDone`/`onPostpone` the row itself uses. And they are two SEPARATE statements on purpose
           (spec §5) — "I should water" is not "I had time to water", so an owner who cannot water right now
           must be able to say so without the app recording a watering that never happened.
           HOLD keeps Close alone: it applied its own postpone, so there is nothing left to decide.
           UNAVAILABLE is the third case (owner ruling, 2026-08-09): it OFFERS a save rather than performing
           one, so its footer adds "Guardar lectura". -->
      <template v-else-if="previewResult?.recommendation === 'WATER_NOW'">
        <Button variant="ghost" @click="open = false">{{ t('common.close') }}</Button>
        <Button variant="ghost" @click="actOnVerdict('water-postpone')">{{ t('common.postpone') }}</Button>
        <Button @click="actOnVerdict('water-done')">{{ t('common.done') }}</Button>
      </template>
      <template v-else-if="previewResult?.recommendation === 'UNAVAILABLE'">
        <Button variant="ghost" @click="open = false">{{ t('common.close') }}</Button>
        <Button :loading="submitting" @click="saveUnavailableReading">{{ t('reading.save') }}</Button>
      </template>
      <template v-else>
        <Button variant="ghost" @click="open = false">{{ t('common.close') }}</Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.mp-reading__note { color: var(--text-faint); font-size: var(--text-sm); margin: var(--space-2) 0 var(--space-3); }
/* The empty state's link to /settings (QA F11). Inherits the alert's own colour so it reads as part of
   the sentence rather than as a foreign element; the underline is what makes it recognisably a link. */
.mp-reading__link { color: inherit; text-decoration: underline; font-weight: var(--weight-semibold); }
/* The verdict step (2026-08-09 redesign). Class conventions follow RepotVerdictModal.vue's own
   `.mp-repotverdict__body`. */
.mp-reading__verdict-title { margin: 0 0 var(--space-2); font-size: var(--text-md); font-weight: var(--weight-semibold); color: var(--text-strong); }
.mp-reading__verdict-body { margin: 0; font-size: var(--text-sm); color: var(--text-body); }
/* The reason the primary action is unavailable (QA UX-2). `margin-right: auto` pushes it to the far side
   of the footer so the two buttons keep their existing right-aligned position rather than shifting. */
/* The blocking reason shares the modal's `display: flex` footer with Cancel/Save. `auto` on the right
   margin pushes the buttons to the far edge, which is what we want on a wide panel.
   ⚠️ IT NEEDS A FLOOR (QA round 4, 2026-08-10). With no `min-width`, a flex item shrinks to whatever the
   two buttons leave over — and these sentences got LONGER in the same fix round that put them here (the
   bound, step and calibration reasons all render in this slot now). QA measured 75 px of column wrapping
   over NINE lines at 390 px wide, a footer 160 px tall, pushing the form out of view. `12ch` is a floor on
   the text, not a width: it simply stops the column collapsing before the wrap-to-own-row rule below
   takes over. */
.mp-reading__blocked {
  margin: 0 auto 0 0;
  min-width: 12ch;
  font-size: var(--text-sm);
  color: var(--text-faint);
}

/* On a phone the reason takes its OWN ROW, above the buttons, at full width — a sentence is not a third
   button and should not compete with two for one line. `order: -1` puts it first without reordering the
   markup, so the reading order a screen reader gets is unchanged (it is `aria-live` and announces on
   appearance regardless). The footer itself has to be told to wrap: it is `display: flex` with no
   `flex-wrap` in Modal.vue, which is correct for every OTHER modal's footer — none of them puts prose in
   it — so the exception is declared here rather than changed for all of them. */
@media (max-width: 480px) {
  :global(.mp-modal__footer:has(.mp-reading__blocked)) { flex-wrap: wrap; }
  .mp-reading__blocked { order: -1; flex-basis: 100%; min-width: 0; margin: 0; }
}
</style>
