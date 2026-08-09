<script setup lang="ts">
// The measuring modal (spec §4.6). Reuses the canonical Modal. There is NO new task and no mode: this is an
// affordance on the WATER task, and the verdict routes onto the postpone / early-water paths that already
// exist.
import Modal from './Modal.vue';
import Button from './Button.vue';
import Input from './Input.vue';
import FormGroup from './FormGroup.vue';
import SegmentedControl from './SegmentedControl.vue';
import Alert from './Alert.vue';
import InstrumentCalibrationFields from './InstrumentCalibrationFields.vue';
// `InstrumentId` has a Zod-free subpath in the shared contract; `ReadingVerdict` and `WateringRelation` are
// the shared contract's Zod-module types, re-exported from `~/types/api` (see that file's own comment) —
// so they come from there, never from `soil-instrument-constants`.
import type { InstrumentId } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import type { PlantSoilReadings, ReadingVerdict, WateringRelation } from '~/types/api';
import { toNullableNumber } from '~/utils/nullableNumber';
import { todayYmd } from '~/utils/localDate';

const props = defineProps<{ plantId: string; data: PlantSoilReadings }>();
const emit = defineEmits<{ saved: [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const api = useApi();

// SegmentedControl's own model is a plain, non-nullable `string` (`defineModel<string>({ required: true
// })`) — '' is the "nothing chosen yet" sentinel, the same convention RepotDoneForm.vue/PlaceEditModal.vue
// already use for an unanswered field, rather than `null` (which SegmentedControl cannot accept).
const instrumentId = ref<InstrumentId | ''>(props.data.instruments[0]?.id ?? '');
const rawValue = ref<number | null>(null);
const verdict = ref<ReadingVerdict>('NONE');
const postponeToOn = ref<string>('');
// SegmentedControl's own model is a plain, non-nullable `string` — '' is the "nothing chosen yet" sentinel
// (same convention `instrumentId` above already uses). Owner-ruled (2026-08-08): NO default and NO
// pre-selection — the ambiguity a same-day-as-watering reading carries is resolved by ASKING, never by
// assuming, so this starts unanswered and stays that way until the owner picks one.
const wateringRelation = ref<WateringRelation | ''>('');
const calibration = reactive<{ saturatedValue: number | null; dryValue: number | null }>({
  saturatedValue: null, dryValue: null,
});
const submitting = ref(false);
const error = ref<string | null>(null);

// Bridge between Input.vue's `v-model` (`string | number`) and `rawValue`'s `number | null` — same pattern
// (and same shared util) as PlaceEditModal.vue's temperature fields.
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
// left un-reset here silently carries a prior reading's value into the next one. `measuredOn` and
// `postponeToOn` are the two date fields: a stale `measuredOn` is the worse of the two, since two readings
// landing on the same date is a zero-span pair that corrupts the drying-rate slope fit — the exact data
// quality this whole feature exists to protect.
// The server told us this day carries a watering even though our cached `wateringDays` did not name it —
// see the 400 branch in `submit()`. Reset with everything else on reopen and whenever the date changes.
const serverSaysWateringDay = ref(false);

watch(open, (isOpen) => {
  if (!isOpen) return;
  idempotencyKey.value = crypto.randomUUID();
  error.value = null;
  rawValue.value = null;
  verdict.value = 'NONE';
  measuredOn.value = todayYmd();
  postponeToOn.value = '';
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

// The date the browser must not let the owner exceed: a reading in the future is not a measurement. Uses
// the app's single local-calendar-day helper (`~/utils/localDate`'s `todayYmd()`) — never a second,
// independent `new Date().toLocaleDateString('en-CA')` of its own (see `RepotDoneForm.vue`'s own comment on
// this exact trap): that expression's output depends on the runtime's ICU locale data, while the shared
// helper builds the string from local Date components so it does not.
const measuredOn = ref(todayYmd());

// Owner-ruled (2026-08-08): the same-day-watering question is asked ONLY when the chosen `measuredOn` is
// itself a day the plant was watered — asking on every reading would be noise on the overwhelming majority
// of them, and noise is how a question stops being read.
const isWateringDay = computed(() =>
  serverSaysWateringDay.value || props.data.wateringDays.includes(measuredOn.value));

// The answer describes ONE specific day. If the owner changes `measuredOn` — to a non-watering day, where
// the control disappears entirely, or to a DIFFERENT watering day — a previously-given answer no longer
// describes the new day and must never survive: not into a submission for a day it doesn't describe, and
// not as a stale pre-selection if the control reappears for a later watering day (that would silently
// reintroduce the very default/pre-selection the owner ruled against). Cleared unconditionally on every
// change; harmless when there was nothing to clear.
watch(measuredOn, () => {
  wateringRelation.value = '';
  // The server's reveal was about the PREVIOUS day; a new date must be judged on its own evidence.
  serverSaysWateringDay.value = false;
});

// A WATER_NOW reading is, by construction, taken BEFORE the watering it causes — the API now always records
// BEFORE for it and rejects the field outright, so asking (and sending) the relation here would be a question
// the modal discards. `showWateringRelation` below is the single source of truth for "ask/show/send it", and
// this watcher clears a stale answer the instant the owner flips the verdict TO WATER_NOW, so switching AWAY
// and back never resubmits a leftover AFTER/BEFORE that no longer describes anything.
watch(verdict, (v) => {
  if (v === 'WATER_NOW') wateringRelation.value = '';
});

// Single source of truth for "ask the same-day-watering question at all": a watering day (per the owner's
// ruling above) AND not a WATER_NOW verdict — a WATER_NOW reading always anchors BEFORE its watering, so the
// question the modal would otherwise ask has no answer left to give. Drives the FormGroup's `v-if`, `canSubmit`
// and the payload alike, so the three can never drift out of sync with each other again.
const showWateringRelation = computed(() => isWateringDay.value && verdict.value !== 'WATER_NOW');

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
// Shown only once the owner has typed SOMETHING — an empty field is simply "not filled in yet" (canSubmit
// already gates on that), never an inline error of its own. Same shape as RepotDoneForm.vue's own
// `potSizeErrorMessage`.
// Two messages, because there are two genuinely different bounds (QA F5): a CLOSED scale states both ends,
// an OPEN-ENDED one has no ceiling to state and the old single message rendered "between 0 and ." for it.
const rawValueErrorMessage = computed(() => {
  if (rawValue.value == null || !rawValueOutOfRange.value) return undefined;
  const row = instrument.value!;
  return row.rawMax == null
    ? t('reading.valueBelowMin', { min: row.rawMin })
    : t('reading.valueOutOfRange', { min: row.rawMin, max: row.rawMax });
});

const canSubmit = computed(() =>
  instrumentId.value !== '' && rawValue.value != null && !submitting.value && !rawValueOutOfRange.value &&
  (verdict.value !== 'POSTPONE' || postponeToOn.value !== '') &&
  // Owner-ruled (2026-08-08): required, un-defaulted, whenever the control is actually shown — and it is
  // never shown for WATER_NOW (see `showWateringRelation`), so a WATER_NOW reading needs no answer here.
  (!showWateringRelation.value || wateringRelation.value !== '') &&
  (!needsCalibration.value ||
    (calibration.saturatedValue != null && calibration.dryValue != null &&
     calibration.saturatedValue > calibration.dryValue)));

async function submit() {
  if (!canSubmit.value || instrumentId.value === '' || rawValue.value == null) return;
  const chosenInstrumentId = instrumentId.value;
  const chosenRawValue = rawValue.value;
  submitting.value = true;
  error.value = null;
  try {
    // The calibration is saved FIRST when the pot has none: the reading's normalisation reads it, so a
    // reading written before it would be stored with a null wetness and never enter the estimator.
    if (needsCalibration.value) {
      await api.setInstrumentCalibration(props.plantId, chosenInstrumentId, {
        saturatedValue: calibration.saturatedValue as number,
        dryValue: calibration.dryValue as number,
      });
    }
    await api.recordSoilReading(props.plantId, {
      instrumentId: chosenInstrumentId,
      rawValue: chosenRawValue,
      measuredOn: measuredOn.value,
      verdict: verdict.value,
      ...(verdict.value === 'POSTPONE' ? { postponeToOn: postponeToOn.value } : {}),
      // Sent ONLY when the question was actually asked (`showWateringRelation`, which already excludes
      // WATER_NOW — the API always records BEFORE for it and rejects the field) — `canSubmit` already
      // guarantees it was answered whenever that holds, so the cast is safe.
      ...(showWateringRelation.value ? { wateringRelation: wateringRelation.value as WateringRelation } : {}),
    }, idempotencyKey.value);
    open.value = false;
    emit('saved');
  } catch (e: any) {
    // FIX (fix wave 1, item 4) — the idempotency key is pinned per open and reused across retries (correct:
    // a lost-response retry must never write a second reading), but that same discipline means a 409/422 on
    // THIS route can only mean the ORIGINAL request already committed: the global interceptor stores a key
    // on success, answers an in-flight duplicate 409, and answers a same-key/different-body retry 422
    // FOREVER under that key (docs' idempotent-creates contract). So the honest handling is not "try again"
    // — it is "this already happened": tell the owner, refresh through the SAME seam a successful save uses
    // (`emit('saved')`, which drives PlantDetail.vue's `onReadingSaved`), and close. Deliberately NOT
    // porting RepotDoneForm.vue's whole `frozen` machinery here (owner ruling) — reopening mints a fresh
    // key, and there is nothing left to retry once the server already has the reading.
    const status = e?.statusCode ?? e?.response?.status;
    if (status === 409 || status === 422) {
      error.value = t('reading.alreadyRecorded');
      open.value = false;
      emit('saved');
    } else if (status === 400 && String(e?.data?.message ?? e?.message ?? '').includes('wateringRelation')) {
      // DEFENCE IN DEPTH for the same-day question. `wateringDays` is a SNAPSHOT, so it can be behind the
      // server in two real ways: the owner watered from this same page after it loaded (PlantDetail.vue's
      // `sendDone` now refreshes it, which is the primary fix), or the reading is back-dated to a watering
      // day older than the window that list covers. In both cases the server knows the day carries a
      // watering and refuses honestly — so REVEAL THE QUESTION rather than showing a generic "save failed"
      // the owner can only clear by reloading. The question is still ASKED, never inferred: we surface it,
      // the owner answers it, and the retry carries a real answer.
      serverSaysWateringDay.value = true;
      error.value = t('reading.wateringRelationRequired');
    } else {
      error.value = t('reading.saveFailed');
    }
  } finally {
    submitting.value = false;
  }
}

const verdictOptions = computed(() => [
  { key: 'NONE', label: t('reading.verdict.none') },
  { key: 'POSTPONE', label: t('reading.verdict.postpone') },
  { key: 'WATER_NOW', label: t('reading.verdict.waterNow') },
]);

// ⚠️ THE HELPER LINE FOLLOWS THE SELECTED VERDICT (QA finding F3, 2026-08-08). It used to be ONE static
// sentence — "Recording alone won't water or postpone anything today" — shown under all three options,
// and it was false of two of them: `WATER_NOW` writes a real `WATER DONE` care event and `POSTPONE`
// writes a real POSTPONED one that moves the next watering (measured: 08-14 → 08-20). The modal was
// denying, in its own hint text, exactly what the button beneath it was about to do. Each verdict now
// states its own consequence; the "and it still teaches the app how fast this pot dries" half is true of
// all three and is repeated in each, because a translated sentence is one unit, never two glued together.
const VERDICT_HINT_KEY: Record<ReadingVerdict, string> = {
  NONE: 'reading.verdictHint.none',
  POSTPONE: 'reading.verdictHint.postpone',
  WATER_NOW: 'reading.verdictHint.waterNow',
};
const verdictHint = computed(() => t(VERDICT_HINT_KEY[verdict.value]));

// Two options → segmented control, same design-system rule `instrumentId`'s picker above already follows.
const wateringRelationOptions = computed(() => [
  { key: 'BEFORE', label: t('reading.wateringRelation.before') },
  { key: 'AFTER', label: t('reading.wateringRelation.after') },
]);
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

    <template v-else>
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
        :unit-label="t(`settings.instruments.unit.${instrument.id}`)"
      />

      <FormGroup
        :label="t('reading.value', { unit: instrument ? t(`settings.instruments.unit.${instrument.id}`) : '' })"
        :error="rawValueErrorMessage"
      >
        <Input
          v-model.number="rawValueField"
          type="number"
          inputmode="decimal"
          :min="instrument?.rawMin"
          :max="instrument?.rawMax ?? undefined"
          :step="instrument?.rawStep"
          :error="rawValueErrorMessage"
        />
      </FormGroup>

      <FormGroup :label="t('reading.measuredOn')">
        <Input v-model="measuredOn" type="date" :max="todayYmd()" />
      </FormGroup>

      <!-- Owner-ruled (2026-08-08): shown ONLY on a day the plant was also watered AND the verdict is not
           WATER_NOW — never a default, never pre-selected, and never asked when the answer would be
           discarded (see `showWateringRelation`). Two options → segmented control, same rule the instrument
           picker above follows. -->
      <FormGroup
        v-if="showWateringRelation"
        :label="t('reading.wateringRelationLabel')"
        :hint="t('reading.wateringRelationHint')"
        required
      >
        <SegmentedControl v-model="wateringRelation" :options="wateringRelationOptions" />
      </FormGroup>

      <FormGroup :label="t('reading.verdictLabel')" :hint="verdictHint">
        <SegmentedControl v-model="verdict" :options="verdictOptions" />
      </FormGroup>

      <FormGroup v-if="verdict === 'POSTPONE'" :label="t('reading.postponeTo')">
        <Input v-model="postponeToOn" type="date" :min="todayYmd()" />
      </FormGroup>

      <Alert v-if="error" color="red" :description="error" announce />
    </template>

    <template #footer>
      <Button variant="ghost" @click="open = false">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSubmit" :loading="submitting" @click="submit">
        {{ t('reading.save') }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.mp-reading__note { color: var(--text-faint); font-size: var(--text-sm); margin: var(--space-2) 0 var(--space-3); }
/* The empty state's link to /settings (QA F11). Inherits the alert's own colour so it reads as part of
   the sentence rather than as a foreign element; the underline is what makes it recognisably a link. */
.mp-reading__link { color: inherit; text-decoration: underline; font-weight: var(--weight-semibold); }
</style>
