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
  calibration.saturatedValue = null;
  calibration.dryValue = null;
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
// The `WATER_NOW` exemption is real but belongs to the API, not here: that verdict creates the watering in
// its own transaction, so its reading definitionally precedes it, and the server derives `BEFORE` by
// construction while ignoring whatever a caller sends (docs/care-engine.md §7.20.4). The client honours it
// by not SENDING the field on that branch — see `submit()`. It is deliberately NOT expressed as a condition
// here: a `previewResult`-based term would be inert (the control only renders while the verdict is still
// unknown) and worse than inert, since the one moment it could ever evaluate true is a failed write, where
// hiding the control is exactly the dead end this fix removes.
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
 * Deliberately silent about the value's own bounds/step problems — those already render inline on the
 * field itself (`rawValueErrorMessage`), and saying it twice in two places reads as two separate faults.
 */
const blockedReason = computed(() => {
  if (submitting.value || instrumentId.value === '') return undefined;
  if (rawValue.value == null) return t('reading.missingValue');
  if (rawValueOutOfRange.value || rawValueOffStep.value) return undefined;
  if (needsCalibration.value &&
      !(calibration.saturatedValue != null && calibration.dryValue != null &&
        calibration.saturatedValue > calibration.dryValue)) {
    return t('reading.missingCalibration');
  }
  if (showWateringRelation.value && wateringRelation.value === '') {
    return t('reading.missingWateringRelation');
  }
  return undefined;
});

const canSubmit = computed(() =>
  instrumentId.value !== '' && rawValue.value != null && !submitting.value &&
  !rawValueOutOfRange.value && !rawValueOffStep.value &&
  // Owner-ruled (2026-08-08): required, un-defaulted, whenever the control is actually shown — since
  // 2026-08-10 that means ANY watering day, in either mode (see `showWateringRelation`).
  (!showWateringRelation.value || wateringRelation.value !== '') &&
  (!needsCalibration.value ||
    (calibration.saturatedValue != null && calibration.dryValue != null &&
     calibration.saturatedValue > calibration.dryValue)));

// "Calcular riego" in survey mode (the modal is about to ANSWER something), "Save reading" in voluntary
// mode (the modal is simply recording one). See the file-header comment for why the two verbs are not
// interchangeable copy for the same button.
const primaryLabel = computed(() => (props.mode === 'survey' ? t('reading.calculate') : t('reading.save')));

async function submit() {
  if (!canSubmit.value || instrumentId.value === '' || rawValue.value == null) return;
  const chosenInstrumentId = instrumentId.value;
  const chosenRawValue = rawValue.value;
  submitting.value = true;
  error.value = null;
  try {
    // The calibration is saved FIRST when the pot has none: the reading's normalisation reads it, so a
    // reading (or a preview, which normalises the SAME way) run before it would see a null wetness.
    if (needsCalibration.value) {
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
    const status = e?.statusCode ?? e?.response?.status;
    if (status === 409 || status === 422) {
      error.value = t('reading.alreadyRecorded');
      open.value = false;
      emit('saved');
    } else if (
      status === 400 &&
      String(e?.data?.message ?? e?.message ?? '').includes('wateringRelation')
    ) {
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
    // reading already committed under this key (see that comment for the full reasoning). Never the
    // `wateringRelation`-reveal branch: this button never sends that field, in either mode.
    const status = e?.statusCode ?? e?.response?.status;
    if (status === 409 || status === 422) {
      error.value = t('reading.alreadyRecorded');
      pendingUnavailableReading.value = null;
      open.value = false;
      emit('saved');
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

      <InstrumentCalibrationFields
        v-if="needsCalibration && instrument"
        v-model="calibration"
        :unit-label="valueUnitLabel"
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
      <FormGroup v-if="mode === 'voluntary'" :label="t('reading.measuredOn')">
        <Input v-model="measuredOn" type="date" :max="todayYmd()" />
      </FormGroup>

      <!-- Owner-ruled (2026-08-08): shown ONLY in voluntary mode, on a day the plant was also watered —
           never a default, never pre-selected (see `showWateringRelation`'s own comment for why survey mode
           never reaches this at all). Two options → segmented control, same rule the instrument picker
           above follows. -->
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
.mp-reading__blocked { margin: 0 auto 0 0; font-size: var(--text-sm); color: var(--text-faint); }
</style>
