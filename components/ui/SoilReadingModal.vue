<script setup lang="ts">
// The measuring modal (2026-08-09 redesign: "the modal answers the question instead of asking three of
// ours"). Reuses the canonical Modal, over TWO possible steps in the SAME modal instance: `measure` (the
// reading itself) and `verdict` (survey mode only — what the reading answers).
//
// ⚠️ TWO MODES, and they are not a cosmetic toggle — they change what is asked and what is written.
//   `survey`    — reached from a DUE water task: the owner is deciding RIGHT NOW. `measuredOn` is hidden
//                 (fixed to today — a survey answers today), the watering-relation question is NEVER ASKED
//                 (the API derives it — see below), and the reading is evaluated by the read-only preview
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
// ⚠️ WHY THE SURVEY NEVER ASKS THE WATERING-RELATION QUESTION (owner-ruled 2026-08-10). That question exists
// because a reading taken on a day the plant was ALSO watered is ambiguous about which side of the watering
// it falls on. In a survey there is no ambiguity to resolve: the owner is measuring NOW, and a watering
// already recorded for today was recorded BEFORE this moment — so the reading sits inside the cycle that
// watering opened, DERIVED from the ordering of events we already store rather than assumed. The API
// performs that derivation itself (`soil-reading.write-core.ts`), so the client sends no relation at all on
// any of the three verdict branches. The owner's ruling: *"que la pestaña de hoy me haga una encuesta si
// debo regar o no. Y ya, es todo, no quiero marcar ni antes ni después ni nada."*
//
// ⚠️ "THE OWNER IS MEASURING NOW" IS TRUE OF TWO OF THE THREE BRANCHES, AND THE THIRD IS WHY
// `measurementTakenAt` EXISTS (2026-08-10; docs/care-engine.md §7.20.4). HOLD and WATER_NOW write the
// instant the verdict lands, so for them write time IS measurement time and the API's own "absent means
// taken now" fallback is exactly right — neither sends the field, and neither changed. UNAVAILABLE is
// OFFERED: the owner may tap "Guardar lectura" much later, and a watering recorded in between would make
// the API read a pre-watering reading as the saturated anchor that OPENS the new cycle. So that ONE branch
// freezes the measurement instant at preview time and carries it on the save. Do not "unify" the three
// bodies by sending it everywhere or nowhere: the difference between them is real.
//
// The question survives only in `voluntary` mode, and that is not a leftover — it is the one place the
// ambiguity is genuinely UNRESOLVABLE. Care events store a DATE and no time, so a back-dated reading and a
// watering on that same past day have no order between them. Nobody can derive it; only the owner knows.
//
// ⚠️ AND IT MUST NOT BE INFERRED FROM THE READING'S OWN VALUE. *"It reads wet, so it must be after"* would
// admit only wet rows into the new cycle and systematically flatten the fitted drying slope — a plausible
// wrong number inside a legal range, the exact failure this whole feature exists to delete. Rejected in
// writing so nobody proposes it later as an optimisation (spec §2).
//
// ⚠️ CALIBRATION IS NOT COLLECTED HERE, IN EITHER MODE (owner-ruled 2026-08-10). The kitchen scale's two
// per-pot anchors moved to `PlantCalibrationModal.vue`, reached from the plant page, because asking for
// them mid-survey is CIRCULAR: one anchor is "the pot freshly watered", and supplying it means watering the
// plant — the very decision the survey has not made yet. An uncalibrated scale is therefore not OFFERED in
// SURVEY MODE (see `usableInstruments`); the owner is routed to calibrate it instead. VOLUNTARY MODE STILL
// OFFERS IT — that is not an oversight, see `usableInstruments`' own comment.
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
import ModalBlockedReason from './ModalBlockedReason.vue';
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

/**
 * ⚠️ SURVEY MODE ONLY — the filter is SCOPED, and the scope is the whole point (review finding F6).
 *
 * In a SURVEY the owner is asking "should I water this pot today?", and an instrument with no calibration
 * cannot answer: the normaliser has no scale to map the raw number onto, so the preview can only come back
 * `UNAVAILABLE / NEEDS_CALIBRATION`. Offering it there is a control that can only fail, so it is withheld
 * and the owner is routed to `PlantCalibrationModal` instead — never asked for two weights mid-decision,
 * which was circular anyway: one anchor is the pot freshly watered. That is the spec's §3.4, verbatim:
 * *"An uncalibrated scale is not offered IN THE SURVEY."*
 *
 * In VOLUNTARY mode the same filter would delete a capability the backend preserves on purpose. There the
 * owner is RECORDING a measurement he already took, usually back-dated, and `soil-reading.write-core.ts`
 * says outright: *"A missing calibration yields a NULL wetness — the reading is still RECORDED (it is the
 * owner's data)."* The raw weights are not wasted either, and the mechanism is worth NAMING rather
 * than gesturing at. ⚠️ CORRECTED 2026-08-10 (cross-family code review): this paragraph used to say the
 * anchors "apply retroactively", and that was simply FALSE — normalisation happens once, at write time, and
 * the only path that reacted to a calibration was the anchors-MOVED one, which cannot fire on a FIRST
 * calibration, so those rows stayed NULL forever while this comment promised the opposite. What makes the
 * promise true now: `SoilReadingsService.setCalibration` BACKFILLS on a first calibration — every reading of
 * that instrument still holding a null wetness, measured on or after the pot's current substrate-basis day,
 * is normalised through the SAME normaliser the write path uses, in the SAME transaction as the calibration
 * write, so the pot can never be left calibrated with its history half-filled. VERIFIED, not assumed:
 * 1500 g against anchors of 2000/1000 g reads exactly 0.5 afterwards (`reading-basis.test.ts` and
 * `soil-readings.service.test.ts` both pin the NUMBER, not merely "not null"). Why giving a row its FIRST
 * interpretation is allowed where RE-interpreting one is forbidden — and the one residual this does not
 * close — is `docs/care-engine.md` §7.20.13. Filtering in both modes (the state commit 338762e shipped) meant a pot whose only
 * instrument was an uncalibrated scale rendered no number field and no date field in voluntary mode — the
 * owner simply could not record his own reading. There is no verdict to protect in that mode: nothing is
 * computed, nothing is recommended, and the row is stored honestly with a null wetness.
 */
const usableInstruments = computed(() =>
  props.data.instruments.filter(
    (i) => props.mode !== 'survey' || !(i.requiresCalibration && i.calibration == null)));

// SegmentedControl's own model is a plain, non-nullable `string` (`defineModel<string>({ required: true
// })`) — '' is the "nothing chosen yet" sentinel, the same convention RepotDoneForm.vue/PlaceEditModal.vue
// already use for an unanswered field, rather than `null` (which SegmentedControl cannot accept).
const instrumentId = ref<InstrumentId | ''>(usableInstruments.value[0]?.id ?? '');
const rawValue = ref<number | null>(null);
// SegmentedControl's own model is a plain, non-nullable `string` — '' is the "nothing chosen yet" sentinel
// (same convention `instrumentId` above already uses). Owner-ruled (2026-08-08): NO default and NO
// pre-selection — the ambiguity a same-day-as-watering reading carries is resolved by ASKING, never by
// assuming, so this starts unanswered and stays that way until the owner picks one. VOLUNTARY MODE ONLY —
// see `showWateringRelation` below.
const wateringRelation = ref<WateringRelation | ''>('');
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
// (It used to carry an optional `wateringRelation` too, frozen at verdict time. Removed 2026-08-10 with
// the question itself — a survey sends no relation, so there is nothing to freeze.)
//
// ⚠️ `measurementTakenAt` IS FROZEN HERE FOR THE SAME REASON `measuredOn` IS, AND IT IS THE ONE THAT
// CLOSES THE DEFERRED-SAVE GAP (2026-08-10; docs/care-engine.md §7.20.4). This save is OFFERED, not
// performed: the owner may tap "Guardar lectura" minutes or hours after measuring. On a day that already
// carries a watering, the API decides which side of that watering the reading sits on — and until this
// field existed it decided that from WRITE time, so a watering recorded by another device IN BETWEEN made
// a reading genuinely taken BEFORE it look like the saturated anchor that OPENS the new drying cycle,
// flattening the fitted slope and under-watering the plant. Carrying the instant makes the API compare
// against WHEN THE MEASUREMENT WAS TAKEN instead. It is frozen at PREVIEW time, alongside `measuredOn`,
// and never re-read at save time — reading `new Date()` in `saveUnavailableReading()` would reproduce
// exactly the bug this closes, since save time IS write time.
const pendingUnavailableReading = ref<{
  instrumentId: InstrumentId; rawValue: number; measuredOn: string; measurementTakenAt: string;
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
// pass happened to touch. (It used to reset the calibration anchors too; those fields left this modal on
// 2026-08-10 — calibration is setup now, in `PlantCalibrationModal.vue`, and that modal carries the same
// reset for the same reason.) The modal is mounted once for the page's life (PlantDetail.vue, no `:key`),
// so a field left un-reset here silently carries a prior reading's value into the next one. `measuredOn` is the one
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
  // `instrumentId`'s setup-time initializer (`usableInstruments.value[0]?.id ?? ''`) can miss the "default
  // to the first instrument" intent entirely: PlantDetail.vue's template falls back to an empty
  // `{ instruments: [], … }` shape while its own async readings fetch is still in flight, so the modal can
  // be constructed before the real instrument list ever reaches it. Re-apply the default here, on every
  // open, but ONLY when nothing is currently selected — an owner's already-chosen instrument must survive
  // a close/reopen untouched, the deliberate stickiness this field otherwise has.
  if (instrumentId.value === '' && usableInstruments.value[0]) {
    instrumentId.value = usableInstruments.value[0].id;
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
 * (The calibration anchors used to be cleared here for the same per-(pot, instrument) reason. They live in
 * `PlantCalibrationModal.vue` since 2026-08-10, and that modal carries the identical clear-on-switch.)
 */
watch(instrumentId, () => {
  rawValue.value = null;
  // ⚠️ AND THE ERROR ALERT GOES WITH IT (QA round 3, defect 7). It described a save of the READING that
  // has just been cleared, so leaving it up puts a red "we couldn't save that reading, please try again"
  // under a fresh, untouched form — the owner reads it as a fault in what he is about to do. An error
  // outliving the thing it was about is a lie with a delay on it.
  error.value = null;
});

/**
 * A SELECTION MUST NEVER OUTLIVE THE INSTRUMENT IT NAMES (review finding F4).
 *
 * `usableInstruments` is derived from a PROP, so it can change under a selection the owner already made —
 * the plant page refetches its readings after a save, an instrument is disabled in /settings in another
 * tab, a calibration is retracted. `instrumentId` was only ever (re)defaulted at setup and on open, so a
 * selection whose instrument had left the list simply stayed. Measured: with the probe removed from `data`
 * while the survey was open, the owner saw the "not calibrated yet" alert AND a footer reading "enter a
 * reading first" — a blocking reason naming a field that is not on screen, which is the same class of lie
 * as QA round 3's defect 5 and just as corrosive to the next message's credibility.
 *
 * Re-default rather than merely clear: when other usable instruments remain, landing on the first one is
 * what the open watcher would have done anyway (and the watcher above then clears the reading, which is
 * right — that number was taken on a scale that is gone). '' is reached only when NOTHING is usable, and
 * that is exactly the two empty states — which is what lets the footer drop the primary button instead of
 * inventing a reason for it.
 */
watch(usableInstruments, (rows) => {
  if (instrumentId.value !== '' && rows.some((i) => i.id === instrumentId.value)) return;
  instrumentId.value = rows[0]?.id ?? '';
});

// Both built off `usableInstruments`, never off `props.data.instruments` directly — an instrument the picker
// refuses to offer must also be un-resolvable, or a stale `instrumentId` would silently reach the fields.
const options = computed(() =>
  usableInstruments.value.map((i) => ({ key: i.id, label: t(`settings.instruments.name.${i.id}`) })));
const instrument = computed(() =>
  usableInstruments.value.find((i) => i.id === instrumentId.value) ?? null);
// Which measuring protocol this instrument's reading actually follows — read STRAIGHT OFF the shared
// instrument row (QA finding F2), never branched on the id here, so a new row arrives with its own
// protocol and this file needs no edit. `insertion` is the fallback ONLY for the transient window before
// the readings fetch resolves (PlantDetail.vue renders an empty `{ instruments: [] }` shape meanwhile),
// where no instrument is selected and no protocol is shown at all.
const protocolKind = computed(() => instrument.value?.protocolKind ?? 'insertion');

/**
 * THE POT OWNS AN INSTRUMENT IT CANNOT USE YET — the third empty state (owner-ruled 2026-08-10, spec §3.4).
 *
 * `usableInstruments` filtering an uncalibrated scale out closes a circular dead end and opens a fresh one:
 * an owner whose ONLY enabled instrument is that scale would face an empty picker. That trap is closed here
 * rather than deferred. Three states, and collapsing any two of them tells the owner something false:
 *   • no instruments at all          → "add one in Settings" (true: there is a real setup gap)
 *   • instruments, none usable       → THIS: "this pot's scale isn't calibrated yet" + a way to calibrate it
 *   • otherwise                      → the picker
 * The middle one must never borrow the first one's copy: the owner already added an instrument, so sending
 * him to Settings would be a false statement AND a dead end.
 *
 * ⚠️ SURVEY MODE ONLY IN PRACTICE, since the filter above became survey-scoped (finding F6): voluntary mode
 * offers every enabled instrument, so `usableInstruments` can only be empty there when the owner owns none
 * — the FIRST state, not this one. Written as a derived condition rather than as `mode === 'survey' && …`
 * so it stays true by construction if the filter's scope ever changes again.
 */
const needsCalibrationSetup = computed(() =>
  props.data.instruments.length > 0 && usableInstruments.value.length === 0);

/**
 * THE INSTRUMENTS THIS POT CANNOT USE YET — the FOURTH state (QA finding F2, 2026-08-10).
 *
 * `needsCalibrationSetup` above is the ALL-of-them case. QA measured what happens when only SOME are
 * unusable: enable a moisture probe AND an uncalibrated scale, and the picker silently shows only the
 * probe. The instrument the owner deliberately turned on in Settings is simply absent — no reason, no
 * link, and nothing anywhere on the screen admitting it exists. `needsCalibrationSetup` was false (the
 * probe IS usable) and nothing else spoke for the missing row.
 *
 * The rule is not "explain it when nothing else works", it is the app's standing one: an affordance that is
 * withheld says WHY. So the not-calibrated message and its link render whenever ANY enabled instrument is
 * unusable for want of calibration — alongside the picker when others remain usable, and INSTEAD of it when
 * none do. Both cases are the same sentence about the same instrument, so they are the same alert, rendered
 * once (see the template) rather than forked into two copies that could drift.
 *
 * Derived from the SAME filter `usableInstruments` applies, negated — never a second, hand-written copy of
 * "requires calibration and has none", which is exactly how the picker and the explanation would come to
 * disagree about which instruments are usable.
 */
const uncalibratedInstruments = computed(() =>
  props.data.instruments.filter((i) => !usableInstruments.value.some((u) => u.id === i.id)));
const showCalibrationNotice = computed(() => uncalibratedInstruments.value.length > 0);

/**
 * WHERE "calíbrala" ACTUALLY GOES (QA finding F3, 2026-08-10).
 *
 * The link kept its promise and still made the owner hunt: it landed on `/plants/<id>` at `scrollY: 0`,
 * while the calibration button sits at `top: 1104px` on a 900px desktop viewport and `top: 2694px` on an
 * 844px mobile one — two thirds down a 4127px page, with no anchor, no scroll and no highlight. A link that
 * technically arrives but leaves the owner searching has not arrived.
 *
 * A QUERY FLAG THE PLANT PAGE ACTS ON, rather than a scroll or a fragment anchor. Three reasons, and the
 * third is the one that decided it:
 *   • it does not fight the router — it is an ordinary navigation the router already handles, with no
 *     scroll-behaviour override and no post-navigation `scrollIntoView` racing the page's own async data;
 *   • the plant page opens the calibration modal on arrival and strips the flag, so a reload or a shared
 *     URL is a plain plant page again;
 *   • it is VIEWPORT-INDEPENDENT BY CONSTRUCTION. A scroll offset is exactly the kind of fix that works at
 *     1440 and misses at 390, because the target's position differs by 1590px between the two. A modal
 *     opens in the same place at every width, so there is no second behaviour to get right.
 *
 * Same-route navigation (the survey opened FROM the plant page) is covered too: the page watches the query
 * rather than reading it once on mount, so the flag arriving on a route the router does not remount still
 * fires. See `PlantDetail.vue`'s own handler.
 */
const calibrationLink = computed(() => ({ path: `/plants/${props.plantId}`, query: { calibrate: '1' } }));

/**
 * PUSH or REPLACE — and the answer differs by where the survey was opened from (QA, 2026-08-11).
 *
 * The plant page consumes the flag and immediately strips it with `router.replace`. When the survey was
 * opened FROM that same plant page, pushing `?calibrate=1` and then replacing it leaves two consecutive,
 * identical `/plants/:id` entries — so Back appears to do nothing and the owner has to press it twice.
 * Replacing instead of pushing removes the duplicate, and costs nothing: the entry being replaced is the
 * very page we are navigating to.
 *
 * From the Today list it must stay a PUSH. That navigation genuinely leaves one page for another, and
 * replacing would consume Today's own history entry — Back from the plant page would skip straight past it.
 * That would be a worse bug than the one being fixed, so the choice is made per case rather than globally.
 */
const route = useRoute();
const calibrationReplacesHistory = computed(() => route.path === `/plants/${props.plantId}`);

/**
 * Is there anything to measure WITH? False in both empty states, and in no other case (finding F4).
 *
 * This is what the footer branches on. A primary button that cannot ever be pressed, beside an alert
 * explaining that the owner has nothing to measure with, is the same mute dead end QA's UX-2 was filed for
 * — and it cannot be fixed by giving it a reason, because the reason is already on screen in the alert and
 * the honest number of available actions is zero. So the button is not rendered at all there.
 */
const hasUsableInstrument = computed(() => usableInstruments.value.length > 0);

// An ORDINAL instrument (the wooden stick, the finger) has no physical unit to name — `OrdinalReadingPicker`
// renders a choice of named states, not a number, so "Reading (índice 1–10)"-shaped copy would be
// meaningless for it. Guarding here (rather than always attempting the interpolation) also keeps this modal
// from ever rendering a raw, untranslated `settings.instruments.unit.*` key path for an ordinal row that
// catalogue does not cover. THE ONE PLACE this modal names an instrument's unit — the raw-value label below
// routes through this computed rather than calling `t('settings.instruments.unit...')` inline, so the guard
// can never be bypassed. (There were two call sites until 2026-08-10; the second belonged to the
// calibration fields, which now live in `PlantCalibrationModal.vue` and carry the identical guard.)
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
// ⚠️ VOLUNTARY MODE ONLY, AND THIS IS THE THIRD TIME THIS LINE HAS MOVED — read the history before
// touching it. It was `mode === 'voluntary' && isWateringDay`; QA round 3 widened it to `isWateringDay`
// because a survey on a plant watered earlier that day dead-ended; the owner then ruled (2026-08-10) that
// the survey must not ask AT ALL, because the answer is derivable there and the API now derives it.
// So the gate is narrow again — but for a different reason, and with the server side that makes it true.
const showWateringRelation = computed(() => props.mode === 'voluntary' && isWateringDay.value);

/**
 * THE SAME QUESTION, WORDED FOR THE DAY IT IS ABOUT (QA finding F4, 2026-08-10).
 *
 * One wording served every date, so a TODAY-dated reading asked *"Ese día también regaste esta planta"* /
 * *"You also watered this plant that day"*. For a measurement being taken right now, "that day" reads as
 * some OTHER day — the owner is being asked about a date the question never names, while looking at a date
 * field that says today.
 *
 * Only the DEIXIS changes. Both variants still name the ACTION ("regaste" / "watered"), never the soil's
 * state: the question is about the ordering of two events the owner performed, and describing it as "the
 * soil was wet" would invite him to answer from the reading he is about to take.
 *
 * Keyed off `measuredOn`, the date THE READING IS FOR — never the browser's clock on its own, and never
 * the modal's open time. The owner can change that field mid-session (it is a date input), and the label
 * must follow it, or picking yesterday leaves "today" on screen.
 */
const wateringRelationIsToday = computed(() => measuredOn.value === todayYmd());
const wateringRelationLabel = computed(() =>
  t(wateringRelationIsToday.value ? 'reading.wateringRelationLabelToday' : 'reading.wateringRelationLabel'));

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
  // `instrumentId === ''` means NOTHING is usable (see the `usableInstruments` watcher — a selection can no
  // longer outlive its instrument), so the modal is showing one of the two empty-state alerts and there is
  // no primary button in the footer to explain. Returning a reason here would print a second, quieter
  // sentence under an alert that already said the whole thing.
  if (submitting.value || instrumentId.value === '') return undefined;
  // Ahead of the value: a date the owner has to correct anyway makes every other complaint noise.
  if (measuredOnInFuture.value) return t('reading.measuredOnFuture');
  if (rawValue.value == null) return t('reading.missingValue');
  // The SAME sentence the field shows, not a second phrasing of it — two wordings for one fault is what
  // actually reads as two faults.
  if (rawValueOutOfRange.value || rawValueOffStep.value) return rawValueErrorMessage.value;
  // NOTE: three calibration reasons used to be reported here (missing anchors / off-scale anchor / inverted
  // span). They left with the fields on 2026-08-10 — an instrument that still needs a calibration is no
  // longer OFFERED (see `usableInstruments`), so none of the three can block a reading any more. Their
  // assertions moved to `PlantCalibrationModal`, where the anchors are now typed.
  if (showWateringRelation.value && wateringRelation.value === '') {
    return t('reading.missingWateringRelation');
  }
  return undefined;
});

const canSubmit = computed(() =>
  instrumentId.value !== '' && rawValue.value != null && !submitting.value &&
  !rawValueOutOfRange.value && !rawValueOffStep.value && !measuredOnInFuture.value &&
  // Owner-ruled (2026-08-08): required, un-defaulted, whenever the control is actually shown — since
  // 2026-08-10 that means a watering day in VOLUNTARY mode only (see `showWateringRelation`).
  (!showWateringRelation.value || wateringRelation.value !== ''));

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
    // ⚠️ THIS FUNCTION NO LONGER WRITES A CALIBRATION (owner-ruled 2026-08-10). It used to `PUT` the two
    // anchors before the reading, because the normalisation needs them. That coupling is exactly what made
    // the survey circular — one anchor is "the pot freshly watered". Calibration is setup now
    // (`PlantCalibrationModal.vue`), and an instrument still missing one is never offered here, so by the
    // time this runs the chosen instrument always has whatever scale it needs.
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
          // NO `wateringRelation` — see the file header. A survey reading is taken NOW, so a watering
          // already recorded for today necessarily precedes it, and the API derives that itself.
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
          // WHEN THE MEASUREMENT WAS TAKEN — frozen HERE, at preview time, exactly like `measuredOn` beside
          // it, and for the same reason: this save may be tapped much later, and the API must not mistake
          // the tap for the measurement. See the ref's own declaration for the full reasoning.
          //
          // ⚠️ Struck at preview time and NEVER at save time. The whole defect is that write time drifts
          // away from measurement time on this one path; a `new Date()` inside `saveUnavailableReading()`
          // would BE write time and would close nothing.
          measurementTakenAt: new Date().toISOString(),
          // NO `wateringRelation` — see the file header. This record used to freeze the owner's answer at
          // verdict time so a much-later "Guardar lectura" carried the day's real answer; there is no
          // answer to freeze any more, because the survey does not ask and the API derives it.
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
          // NO `wateringRelation` — and the history of this ONE spread is worth keeping, because it has now
          // been argued both ways and each argument was correct at the time.
          //
          // It was originally ABSENT, justified by the API's `verdict: 'WATER_NOW'` exemption. That
          // exemption is keyed on the VERDICT, and this branch stopped sending `WATER_NOW` on 2026-08-09
          // (a WATER_NOW survey writes `verdict: 'NONE'` — it teaches the fit and moves no schedule), so it
          // silently stopped qualifying. Nothing failed at the seam: two independently correct pieces
          // stopped meeting, and the result was a permanent dead end on the ordinary rhythm of watering in
          // the morning and measuring a dry pot in the evening.
          //
          // QA round 4 fixed that by SENDING the field. The owner's 2026-08-10 ruling deletes the defect
          // instead of fixing it: the API now derives the relation for any today-dated reading on a
          // watering day, whatever verdict it carries, so no branch sends it and the dead end is
          // unreachable by construction. The verdict-keyed exemption is subsumed and stops being a rule.
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
    } else if (status === 400 && props.mode === 'voluntary' && upstreamMessage.includes('wateringRelation')) {
      // DEFENCE IN DEPTH for the same-day question — VOLUNTARY MODE ONLY again since 2026-08-10, and the
      // two previous versions of this gate are both worth remembering. It was voluntary-only on the (then
      // wrong) premise that a survey could never send the field; QA defect 3 widened it to both modes,
      // correctly, because a survey on a plant watered that morning really was being refused with no
      // control to answer through. It is narrow again now for a THIRD reason: the API derives the relation
      // for a today-dated reading, so a survey can no longer be refused for a missing one — and revealing
      // a control that `showWateringRelation` will refuse to render is the worse of the two dead ends.
      //
      // In voluntary mode the refusal stays genuinely reachable: `wateringDays` is a SNAPSHOT and can be
      // behind the server, either because the owner watered from this same page after it loaded
      // (PlantDetail.vue's `sendDone` refreshes it, the primary fix) or because the reading is back-dated
      // past the window that list covers. The server knows and refuses honestly, so REVEAL THE QUESTION
      // rather than a dead end. It is still ASKED, never inferred — and on a back-dated day it cannot be
      // derived by anyone, because care events store a date and no time.
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
      // The instant frozen at PREVIEW time — never re-struck here. This tap can be hours after the
      // measurement, and it is the only survey write where that is true; the API derives which side of
      // the day's watering the reading sits on from THIS instant instead of from its own write time.
      measurementTakenAt: pending.measurementTakenAt,
      verdict: 'NONE',
      // No `wateringRelation`: the pending record no longer carries one (see where it is built) — the
      // survey does not ask, and the API derives the relation for a today-dated reading itself.
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
    const upstreamMessage = upstreamErrorMessage(e);
    if (status === 409 || status === 422) {
      error.value = t('reading.alreadyRecorded');
      pendingUnavailableReading.value = null;
      open.value = false;
      emit('saved');
    } else if (status === 400 && upstreamMessage.includes('wateringRelation')) {
      // ⚠️ THE PLANT'S DAY ENDED WHILE THIS SAVE WAS STILL BEING OFFERED — narrow, real, and previously
      // argued away. Read this before "simplifying" the branch out again (review finding F2).
      //
      // The old comment here claimed a refusal naming `wateringRelation` was "unreachable by construction":
      // the survey sends no relation, and the API derives one for a TODAY-dated reading. The second half is
      // the hole. `pending.measuredOn` is frozen at PREVIEW time — the plant's local day as it was then —
      // and this button is tapped at an arbitrary later moment, possibly much later. Cross the plant's
      // local midnight in between and the write is BACK-DATED; if a `WATER DONE` also lands on that day
      // (from Today, a second device, a second tab), the API refuses it with a 400 naming the field,
      // because a back-dated reading's side of the watering is genuinely underivable — care events store a
      // date and no time.
      //
      // ⚠️ AND THE ONE RECOVERY THAT LOOKS OBVIOUS IS WRONG: do NOT reveal the question. This save is
      // survey-only, `showWateringRelation` is voluntary-only, and the verdict step renders no measure
      // form at all — so a "reveal" would render no control to answer through, which is a worse dead end
      // than the one it replaces. Re-dating the write to the plant's current day is equally wrong: nobody
      // here knows that day (that is why the preview supplies it), and inventing one would fabricate the
      // reading's date, which is the single thing a measurement may not have wrong.
      //
      // So the window is closed the honest way — the owner is told the day rolled over and that the
      // measurement has to be retaken. That is not a "try again": the retry the old generic message invited
      // sent a byte-identical body and was refused identically, forever.
      error.value = t('reading.dayRolledOver');
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

    <template v-else>
      <!-- THE NOT-CALIBRATED NOTICE (owner-ruled 2026-08-10; widened by QA finding F2) — see
           `showCalibrationNotice`. The owner HAS an instrument; it is a scale this pot has never been
           calibrated for, so it is not offered in the picker. Never the "add one in Settings" copy: he
           already added one, and that sentence would be both false and a dead end.

           ⚠️ RENDERED ONCE, FOR BOTH SHAPES OF THE SAME PROBLEM. It used to be an arm of the empty-state
           `v-else-if` chain, so it appeared ONLY when NOTHING was usable. QA measured the other half:
           enable a probe AND an uncalibrated scale and the picker just showed the probe, with the scale
           absent and unexplained. Now the sentence sits ABOVE the picker when other instruments remain
           usable, and stands alone (the picker being empty) when none do — one alert, one translatable
           string, no fork between the two cases.

           ⚠️ ONE `i18n-t` UNIT (review finding F5). This used to render `<span>{{ t('…') }}</span>{{ ' ' }}
           <NuxtLink>…</NuxtLink>` — three fragments with the word order hard-coded in the template, four
           lines under the comment that forbids it. No literal leaked (both halves were keyed), but a
           translator could not move the link, and Spanish word order is not English's. The sentence carries
           its own `{calibrate}` slot, so the whole thing is one translatable string in both locales.

           The link goes to the plant's own page, where the calibration modal lives — calibration is setup,
           done ahead of time, not collected mid-decision — and it ARRIVES AT THE MODAL rather than at the
           top of the page; see `calibrationLink`. -->
      <Alert v-if="showCalibrationNotice" color="amber">
        <i18n-t keypath="reading.calibration.notCalibratedYet" tag="span">
          <template #calibrate>
            <NuxtLink
              :to="calibrationLink"
              :replace="calibrationReplacesHistory"
              class="mp-reading__link"
              @click="open = false"
            >
              {{ t('reading.calibration.calibrateAction') }}
            </NuxtLink>
          </template>
        </i18n-t>
      </Alert>

    <template v-if="step === 'measure' && hasUsableInstrument">
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

      <!-- ⚠️ THE CALIBRATION FIELDS ARE GONE FROM HERE (owner-ruled 2026-08-10), not hidden. Collecting an
           anchor called "the pot freshly watered" inside the flow that decides whether to water the pot is
           circular, and it made a survey on an uncalibrated pot impossible to complete. They live in
           `PlantCalibrationModal.vue` now; an instrument still missing its anchors is filtered out of the
           picker above and the owner is routed there instead. Do not resurrect them behind a `v-if`. -->

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
           pre-selected. ⚠️ VOLUNTARY MODE ONLY, again, since the owner's 2026-08-10 ruling: a survey is
           taken NOW and the API derives the relation from the ordering of events it already stores, while
           a BACK-DATED reading has no derivable order at all (care events store a date, not a time). The
           full three-step history is at `showWateringRelation`; read it before widening this again.
           Two options → segmented control, same rule the instrument picker above follows. -->
      <FormGroup
        v-if="showWateringRelation"
        :label="wateringRelationLabel"
        :hint="t('reading.wateringRelationHint')"
        required
      >
        <SegmentedControl v-model="wateringRelation" :options="wateringRelationOptions" />
      </FormGroup>

      <Alert v-if="error" color="red" :description="error" announce />
    </template>

    <!-- The verdict step — survey mode only (see `submit()`'s `step.value = 'verdict'` assignment, reached
         only from the `mode === 'survey'` branch). Shaped like RepotVerdictModal.vue: a short title stating
         the answer, then whatever body that answer needs.
         ⚠️ An EXPLICIT `step === 'verdict'` check, not a bare `v-else`. The notice above is no longer part
         of an exclusive chain, so a `v-else` here would render the verdict body in the one state that has
         no verdict: the measure step with nothing usable to measure with. -->
    <template v-else-if="step === 'verdict'">
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
    </template>

    <template #footer>
      <template v-if="step === 'measure'">
        <!-- QA UX-2: the primary button used to go dead with nothing said. Rendered in the footer beside
             it, and `aria-live` so a screen reader hears the reason appear rather than only sighted users
             noticing a button that will not press. Shared with `PlantCalibrationModal.vue` through ONE
             component since 2026-08-10 (finding F1) — see `ModalBlockedReason.vue`. -->
        <ModalBlockedReason :reason="blockedReason" />
        <Button variant="ghost" @click="open = false">{{ t('common.cancel') }}</Button>
        <!-- Nothing to measure with (either empty state) means there is no action to offer — see
             `hasUsableInstrument`. The alert above is the whole answer; a permanently dead button under it
             is the mute dead end UX-2 is about, wearing an explanation that is not attached to it. -->
        <Button v-if="hasUsableInstrument" :disabled="!canSubmit" :loading="submitting" @click="submit">
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
/* The blocking reason's own layout (QA UX-2, and the phone-footer wrap QA round 4 added) moved to
   `ModalBlockedReason.vue` on 2026-08-10, together with the markup, when a second modal needed the same
   affordance (finding F1). It is not duplicated here. */
</style>
