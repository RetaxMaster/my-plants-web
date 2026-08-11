// @vitest-environment happy-dom
//
// Harness mirrors components/ui/RepotDoneForm.test.ts: Vue's own reactivity primitives and the bare Nuxt
// auto-imports (`useI18n`/`useApi`) are stubbed as globals, because outside Nuxt's build pipeline (plain
// vitest + @vue/test-utils, no auto-import shim) they don't exist. Modal/Button/FormGroup/AppIcon are
// stubbed to plain passthroughs (their own behavior is irrelevant here); Input/SegmentedControl/Alert are
// left REAL so their actual rendered markup — disabled state, option count, alert text — can be asserted,
// the same choice `stubsWithRealInputs()` makes in RepotDoneForm's own test file.
// (`InstrumentCalibrationFields` used to be in that list. The calibration block left this component on
// 2026-08-10 — it is setup now, and its cases live in `PlantCalibrationModal.test.ts`.)
//
// 2026-08-09 redesign ("the modal answers the question instead of asking three of ours"): every test below
// now mounts with an EXPLICIT `mode`, never relying on the component's own default — see `mountModal`'s own
// comment for why that matters for the mutation proofs this file's spec calls for.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ref, reactive, computed, watch, inject } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import SoilReadingModal from './SoilReadingModal.vue';
import type { CreateSoilReading, PlantSoilReadings, SoilReadingPreview } from '~/types/api';
import { todayYmd, ymdFromLocalDate } from '../../utils/localDate.js';

vi.stubGlobal('ref', ref);
vi.stubGlobal('reactive', reactive);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
// Needed because SegmentedControl.vue is left REAL (not stubbed) and calls Vue's `inject()` directly for
// FormGroup's field-id wiring — same requirement RepotDoneForm.test.ts's `stubsWithRealInputs()` suite
// documents. FormGroup itself IS stubbed below (a plain passthrough that never calls `provide()`), so the
// injected value resolves to its declared default (`undefined`) rather than a real field id — harmless
// here, since no assertion below depends on the `<label for>` wiring itself.
vi.stubGlobal('inject', inject);
// `d` renders the date to a plain `YYYY-MM-DD` (same pattern RepotVerdictModal.test.ts/TaskRow.test.ts use)
// so a test can tell "the date reached the component" from "the key was merely selected", matching the
// component's own `d(ymdToLocalDate(...), 'short')` call for the HOLD verdict's date.
//
// ⚠️ IT FORMATS FROM THE DATE'S **LOCAL** COMPONENTS, never `toISOString().slice(0, 10)` (finding W4). The
// component hands `d()` a LOCAL-midnight Date built by `ymdToLocalDate`, and `toISOString()` re-reads that
// through the UTC clock — so at a positive offset the stub silently returned the PREVIOUS day and this file
// failed at `TZ=Pacific/Kiritimati` while passing at UTC and America/Mexico_City. Production was never
// affected (the real `d()` formats local components), which is exactly why it was invisible: a test-harness
// defect that only exists east of Greenwich. `ymdFromLocalDate` is `ymdToLocalDate`'s own inverse, so the
// round trip is lossless at every offset by construction rather than by luck — and `utils/localDate.ts`'s
// own header warns against this precise substitution in writing.
vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) =>
    (params ? `${k}|${Object.values(params).join('|')}` : k),
  d: (date: Date) => ymdFromLocalDate(date),
}));

// FIX W3 — the PLANT-LOCAL day the preview says it judged, and DELIBERATELY not the browser's `todayYmd()`.
// The API evaluates against the plant city's calendar day, so across the midnight gap the two are different
// days; picking a fixed date far from any real "today" is what lets every assertion below tell "the write
// carried the preview's day" from "the write carried the browser's day and happened to agree".
const PLANT_TODAY = '2026-08-19';

// Typed on its own parameters (rather than inferred from a zero-arg lambda) so `.mock.calls[n]` carries the
// real `[plantId, body, idempotencyKey]` tuple type — needed below to read the recorded `body` argument.
const recordSoilReading = vi.fn(
  (_plantId: string, _body: CreateSoilReading, _idempotencyKey: string) => Promise.resolve({ readingId: 'r1' }),
);
const setInstrumentCalibration = vi.fn(() => Promise.resolve({ saturatedValue: 1850, dryValue: 1200 }));
// Read-only "water this pot today, or hold?" — survey mode's own branch point. Defaults to WATER_NOW
// (arbitrary; every survey test that cares about the recommendation overrides it with `mockResolvedValueOnce`).
const previewSoilReading = vi.fn(
  (): Promise<SoilReadingPreview> => Promise.resolve({
    measuredOn: PLANT_TODAY, wetness: 0.5, target: 0.4, recommendation: 'WATER_NOW',
    suggestedPostponeToOn: null, basis: null, unavailableReason: null,
  }),
);
vi.stubGlobal('useApi', () => ({ recordSoilReading, setInstrumentCalibration, previewSoilReading }));

const stubs = {
  // `data-modal-stub` names the rendered panel, same hook RepotDoneForm.test.ts / RepotEvaluationModal.
  // test.ts use — not needed by any assertion below, kept for consistency with the sibling harnesses.
  Modal: {
    props: ['modelValue', 'title'],
    template: '<div data-modal-stub v-if="modelValue"><slot /><slot name="footer" /></div>',
  },
  Button: { props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
  // NAMED (QA F3/F5) so `findAllComponents({ name: 'FormGroup' })` can locate a specific group and read
  // its `hint`/`error` PROPS — asserting on props rather than on rendered text keeps every pre-existing
  // `w.text()` assertion in this file byte-identical.
  FormGroup: {
    name: 'FormGroup',
    props: ['label', 'hint', 'error', 'required'],
    template: '<div><slot /></div>',
  },
  AppIcon: true, // Alert.vue's own icon dependency; irrelevant to every assertion here.
  // The empty state's link to /settings (QA F11). `i18n-t` renders the keypath and its named slots; the
  // stub keeps both visible so a test can assert the sentence AND that the slot really is a NuxtLink.
  // Renders the keypath AND every named slot the component uses, so a test can assert the sentence is one
  // translatable unit AND that the slot really is a NuxtLink. `calibrate` joined `settings` on 2026-08-10
  // (finding F5), when the "not calibrated yet" sentence stopped being three concatenated fragments.
  'i18n-t': {
    props: ['keypath', 'tag'],
    template: '<span class="i18n-t">{{ keypath }}<slot name="settings" /><slot name="calibrate" /></span>',
  },
  NuxtLink: { props: ['to'], template: '<a class="nuxt-link" :href="to"><slot /></a>' },
};

const galvanicProbe = {
  id: 'galvanic-probe' as const, kind: 'moisture' as const, unit: '1–10 index', scale: 'galvanic-1-10',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: false,
  // QA finding F2 — the protocol is a PROPERTY OF THE ROW: a probe is pushed INTO the medium.
  protocolKind: 'insertion' as const,
  // The owner types a number on this instrument — see soil-instrument-constants.ts's own row.
  captureKind: 'numeric' as const,
  rawMin: 1, rawMax: 10, rawStep: 1, calibration: null,
};
const kitchenScaleNoCalibration = {
  id: 'kitchen-scale' as const, kind: 'moisture' as const, unit: 'grams', scale: 'kitchen-scale-grams',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: true,
  // …and a scale weighs the WHOLE POT. It is never inserted into anything, which is the whole finding.
  protocolKind: 'whole-pot-mass' as const,
  // The owner types a number (grams) on this instrument too — see soil-instrument-constants.ts.
  captureKind: 'numeric' as const,
  rawMin: 0, rawMax: null, rawStep: 1, calibration: null,
};
const kitchenScaleCalibrated = {
  ...kitchenScaleNoCalibration, calibration: { saturatedValue: 1850, dryValue: 1200 },
};
// ⚠️ THE FIRST ORDINAL FIXTURE IN THIS FILE, and its absence is why two defects shipped through it.
// Until QA (2026-08-10) every instrument mounted here was `captureKind: 'numeric'`, so the ordinal branch
// of this modal — the one the wooden stick and the finger actually take — was never rendered by a single
// one of these 45 tests. Both of the defects QA found live on exactly that branch: the raw
// `reading.honesty.wooden-stick` key path, and the `Reading ()` empty parenthetical below. A suite can only
// fail on a code path it executes.
const woodenStick = {
  id: 'wooden-stick' as const, kind: 'moisture' as const, unit: 'level', scale: 'stick-clean-to-damp',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: false,
  protocolKind: 'insertion' as const,
  captureKind: 'ordinal' as const,
  rawMin: 1, rawMax: 3, rawStep: 1, calibration: null,
};

const protocol = { potSizeCm: 20, insertionDepthCm: 7, distanceFromCentreCm: 3 };

function makeData(overrides: Partial<PlantSoilReadings> = {}): PlantSoilReadings {
  return { instruments: [galvanicProbe], protocol, readings: [], wateringDays: [], ...overrides };
}

// `mode` is ALWAYS passed explicitly — defaulted to `'voluntary'` here in the helper, never left to the
// component's own prop default. This is what makes mutation proof 1 (see the spec) meaningful: if the
// component ever stopped reading `props.mode` and hard-used one behavior regardless of what was passed,
// every test that names a mode explicitly would still catch it, because the prop really is being set.
function mountModal(data: PlantSoilReadings, extra: { mode?: 'survey' | 'voluntary' } = {}) {
  return mount(SoilReadingModal, {
    props: { open: true, plantId: 'plant-1', data, mode: 'voluntary', ...extra },
    global: { mocks: { $t: (k: string) => k }, stubs },
  });
}
function mountSurvey(data: PlantSoilReadings, extra: Record<string, unknown> = {}) {
  return mountModal(data, { mode: 'survey', ...extra });
}

// The instrument picker is always the FIRST `.mp-seg` in the DOM.
function instrumentSegButtons(w: ReturnType<typeof mount>) {
  return w.findAll('.mp-seg')[0]!.findAll('button');
}
// The raw-reading FormGroup's own `error` prop (QA F5). Read as a PROP, not as rendered text, so this
// assertion is about the message the component chose rather than about the stub's markup.
/**
 * A FAILURE SHAPED THE WAY THE BROWSER ACTUALLY RECEIVES ONE.
 *
 * ⚠️ EVERY REJECTION FIXTURE IN THIS FILE MUST GO THROUGH HERE, and the reason is the most expensive lesson
 * of QA round 3 (2026-08-10). These tests used to hand-build `{ statusCode, data: { message } }` — the
 * shape an UNPROXIED call would produce. Nothing in this app is unproxied. Every backend call goes through
 * the Nuxt BFF (`server/api/[...].ts`), which re-throws through h3's `createError({ statusCode, data: <the
 * API body> })`; ofetch hands the client the whole serialized envelope as `err.data`, so the API's message
 * really sits at `err.data.data.message` — and the envelope carries no `message` of its own.
 *
 * The component read `e.data.message ?? e.message` and compared it with `.includes(...)`. Against the old
 * fixture it matched. Against the browser the first half is `undefined` and the second is ofetch's summary
 * line (`[POST] "http://…": 400 Bad Request`), so it matched nothing, the recovery branch never ran, and
 * the owner got "please try again" for a request the server would refuse forever. The tests were green the
 * entire time — they were asserting against a wire shape that does not exist.
 *
 * A fixture is a claim about what the outside world sends. The shape below is COPIED FROM A MEASUREMENT —
 * `server/api/proxy.wire.test.ts` drives the real proxy over a real socket — never from a mental model of
 * what h3 probably does.
 */
function proxiedError(statusCode: number, upstreamMessage: string | string[]) {
  return {
    statusCode,
    message: `[POST] "http://localhost/api/x": ${statusCode} Bad Request`,
    data: {
      statusCode,
      statusMessage: 'Bad Request',
      stack: [],
      data: { statusCode, message: upstreamMessage, error: 'Bad Request' },
    },
  };
}

function rawValueError(w: ReturnType<typeof mount>) {
  const group = w.findAllComponents({ name: 'FormGroup' })
    .find((g) => String(g.props('label')).startsWith('reading.value|'));
  return group?.props('error');
}

/**
 * THE READING'S OWN number input, located by its FormGroup rather than by `w.find('input[type="number"]')`.
 *
 * Kept even though the modal now renders exactly one number field. It used to be load-bearing: a
 * calibrating instrument rendered its two anchor fields ABOVE the reading, so the bare selector silently
 * typed the test's reading into the "weight when freshly watered" box and the case failed somewhere that
 * had nothing to do with what it was about. Those fields left on 2026-08-10, but naming the field you mean
 * is the right habit and costs nothing.
 */
function readingInput(w: ReturnType<typeof mount>) {
  const group = w.findAllComponents({ name: 'FormGroup' })
    .find((g) => String(g.props('label')).startsWith('reading.value'));
  return group!.find('input[type="number"]');
}
function findSaveButton(w: ReturnType<typeof mount>) {
  return w.findAll('button').find((b) => b.text().includes('reading.save'))!;
}
// Survey mode's own primary action — a DIFFERENT verb ("Calcular riego") because the modal is about to
// ANSWER something, not just record it. See the component's own `primaryLabel` comment.
function findCalculateButton(w: ReturnType<typeof mount>) {
  return w.findAll('button').find((b) => b.text().includes('reading.calculate'))!;
}
function findCloseButton(w: ReturnType<typeof mount>) {
  return w.findAll('button').find((b) => b.text().includes('common.close'))!;
}
// Located by its own button labels rather than a fixed `.mp-seg` index — the watering-relation control only
// renders on a watering day, so its position among the other segmented controls is NOT fixed the way
// `instrumentSegButtons` above assumes. Returns `undefined` when the control isn't shown.
function wateringRelationSeg(w: ReturnType<typeof mount>) {
  return w.findAll('.mp-seg').find((seg) =>
    seg.findAll('button').some((b) => b.text() === 'reading.wateringRelation.before'));
}

const holdPreview: SoilReadingPreview = {
  measuredOn: PLANT_TODAY, wetness: 0.55, target: 0.4, recommendation: 'HOLD',
  suggestedPostponeToOn: '2026-08-20', basis: 'MEASURED_SLOPE', unavailableReason: null,
};
const waterNowPreview: SoilReadingPreview = {
  measuredOn: PLANT_TODAY, wetness: 0.2, target: 0.4, recommendation: 'WATER_NOW',
  suggestedPostponeToOn: null, basis: null, unavailableReason: null,
};
const unavailablePreview: SoilReadingPreview = {
  measuredOn: PLANT_TODAY, wetness: null, target: 0.4, recommendation: 'UNAVAILABLE',
  suggestedPostponeToOn: null, basis: null, unavailableReason: 'NOT_MEASURABLE',
};

describe('SoilReadingModal', () => {
  it('offers ONLY the instruments the owner selected in /settings', () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }));
    expect(instrumentSegButtons(w)).toHaveLength(1);
  });

  // REWRITTEN 2026-08-10: the second fixture used to be `kitchenScaleNoCalibration`, which the picker no
  // longer offers at all (see the `an uncalibrated instrument is not offered` describe below). Swapped for
  // the CALIBRATED scale, so the property this case is actually about — one segment per enabled instrument
  // — is still exercised rather than silently reduced to a one-segment assertion wearing a two-segment name.
  it('offers every selected instrument, one segment each', () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe, kitchenScaleCalibrated] }));
    expect(instrumentSegButtons(w)).toHaveLength(2);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // RETRACTED 2026-08-10 — EIGHT CALIBRATION CASES, MOVED not deleted (spec §5 MOVED table).
  //
  // They all asserted the two per-pot anchor fields INSIDE this measuring modal, and each was written for
  // a real defect, named here so a later reader never has to guess whether the coverage was dropped by
  // design or by neglect:
  //   • `shows the calibration fields whenever the instrument USES one — calibrated pot included`
  //       — QA round 3, defect 3: a STORED calibration was invisible, so a mis-weighed pot (the saucer
  //         left on, a transposed digit) could be corrected nowhere short of a raw `PUT`.
  //   • `PREFILLS the stored anchors, so the owner sees what this pot is actually calibrated to`
  //       — same QA round 3 defect: a failed save looked like it had LOST a calibration it had written.
  //   • `does NOT re-PUT a calibration the owner never touched`
  //       — an anchor MOVE retracts every fraction those anchors produced; identical re-`PUT`s handed the
  //         API a retraction decision it should never have to make.
  //   • `DOES PUT a corrected calibration — an edit nobody sent is an edit that did not happen`
  //       — QA round 3: the owner watched himself fix a wrong anchor and the pot kept the wrong one.
  //   • `refuses an anchor that is off the instrument's own scale, span or no span`
  //       — QA round 3: `-500` typed in the dry box was stored with a 200, and a real 1000 g reading on
  //         that pot then reported 60 % wet. The span rule could never catch it — `2000 > -500` is true.
  //   • `blocks submit until the calibration span is strictly positive`
  //       — a zero or inverted span makes every normalised fraction it produces meaningless.
  //   • `resets the calibration anchors too on close/reopen (fix wave 1, item 1a)`
  //       — a REPOT invalidates a calibration; anchors typed for the OLD pot must never sit pre-filled,
  //         one tap from being written as the NEW pot's.
  //   • `clears calibration anchors too — they describe one instrument on one pot`
  //       — anchors are per (pot, instrument), so carrying them across a switch describes nothing.
  //
  // NONE of that coverage is gone: all eight live in `PlantCalibrationModal.test.ts`, verified case by
  // case before this deletion. What is retracted is only the claim that THIS modal hosts them — the owner
  // ruled (2026-08-10) that calibration is SETUP, done ahead of time, because collecting an anchor called
  // "the pot freshly watered" inside the flow that decides whether to water the pot is circular.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════

  it('states the protocol from THIS pot, and warns instead when the pot size is unknown', () => {
    const withProtocol = mountModal(makeData({ protocol }));
    expect(withProtocol.text()).toContain('reading.protocol');

    const withoutProtocol = mountModal(makeData({ protocol: null }));
    expect(withoutProtocol.text()).toContain('reading.protocolUnknownPot');
    expect(withoutProtocol.text()).not.toContain('reading.protocol|');
  });

  // QA finding F2 (2026-08-08): the modal printed "insert to about 8 cm deep, roughly 4 cm from the
  // centre" for a KITCHEN SCALE, in the prominent amber alert, with the correct weighing note demoted to
  // muted grey below it. The protocol is now read off the instrument row's own `protocolKind`.
  describe('the measuring protocol is INSTRUMENT-CONDITIONAL (QA F2)', () => {
    it('states the WEIGHING protocol for a whole-pot-mass instrument — never an insertion depth', () => {
      const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated], protocol }));
      expect(w.text()).toContain('reading.protocolWholePot');
      // The insertion sentence must be ABSENT — including its interpolated form, which is the one that
      // shipped the wrong instruction. `reading.protocol|7|3` is what the harness renders it as.
      expect(w.text()).not.toContain('reading.protocol|');
      expect(w.text()).not.toContain('reading.protocolUnknownPot');
    });

    it('still states the INSERTION protocol for a probe, with this pot\'s own depth and distance', () => {
      const w = mountModal(makeData({ instruments: [galvanicProbe], protocol }));
      expect(w.text()).toContain('reading.protocol|7|3');
      expect(w.text()).not.toContain('reading.protocolWholePot');
    });

    it('ignores an unknown pot size for a scale — a pot with no diameter still weighs the same way', () => {
      // The insertion branch degrades to `protocolUnknownPot` without a diameter; the weighing branch has
      // no diameter to miss, so it must NOT degrade.
      const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated], protocol: null }));
      expect(w.text()).toContain('reading.protocolWholePot');
      expect(w.text()).not.toContain('reading.protocolUnknownPot');
    });

    it('follows the SELECTED instrument, switching protocol as the owner switches picker', async () => {
      const w = mountModal(makeData({ instruments: [galvanicProbe, kitchenScaleCalibrated], protocol }));
      expect(w.text()).toContain('reading.protocol|7|3');
      await instrumentSegButtons(w)[1]!.trigger('click');
      expect(w.text()).toContain('reading.protocolWholePot');
      expect(w.text()).not.toContain('reading.protocol|');
    });

    it('states the PROMINENT protocol in the alert, not in the muted honesty note', () => {
      const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated], protocol }));
      // The alert is the loud surface; the note is the quiet one. The finding was that these two had
      // swapped contents for the scale.
      expect(w.find('.mp-alert').text()).toContain('reading.protocolWholePot');
      expect(w.find('.mp-reading__note').text()).toBe('reading.honesty.kitchen-scale');
    });
  });

  // QA finding F11 (2026-08-08): the empty state told the owner to go to Settings and gave them no way to
  // get there — and on a desktop viewport there was no other route to that page at all (QA F1).
  describe('the empty state links to /settings (QA F11)', () => {
    it('renders a real link to /settings inside the sentence', () => {
      const w = mountModal(makeData({ instruments: [] }));
      const link = w.find('a.nuxt-link');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('/settings');
      expect(link.text()).toBe('reading.settingsLink');
    });

    it('keeps the sentence ONE translatable unit, interpolating the link rather than concatenating', () => {
      const w = mountModal(makeData({ instruments: [] }));
      expect(w.find('.i18n-t').exists()).toBe(true);
      expect(w.text()).toContain('reading.noInstruments');
    });

    it('closes the modal when the link is followed, so the owner lands on the page they were sent to', async () => {
      const w = mountModal(makeData({ instruments: [] }));
      await w.find('a.nuxt-link').trigger('click');
      expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
    });

    it('shows no link when the owner DOES have an instrument — nothing to be sent anywhere for', () => {
      const w = mountModal(makeData({ instruments: [galvanicProbe] }));
      expect(w.find('a.nuxt-link').exists()).toBe(false);
    });
  });

  // QA finding F5's client half: the OPEN-ENDED scale had no client bound at all, floor included.
  describe('an open-ended scale still has a FLOOR (QA F5)', () => {
    it('rejects a negative weight and blocks Save', async () => {
      const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
      await readingInput(w).setValue(-50);
      expect(findSaveButton(w).attributes('disabled')).toBeDefined();
      expect(rawValueError(w)).toBe('reading.valueBelowMin|0');
    });

    it('accepts an arbitrarily large weight — grams genuinely have no ceiling', async () => {
      const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
      await readingInput(w).setValue(1_000_000);
      expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
      expect(rawValueError(w)).toBeUndefined();
    });

    it('still states BOTH bounds for a closed scale, never the open-ended message', async () => {
      const w = mountModal(makeData({ instruments: [galvanicProbe] }));
      await w.find('input[type="number"]').setValue(99);
      expect(rawValueError(w)).toBe('reading.valueOutOfRange|1|10');
    });
  });

  it('caps the measured date at today — a reading in the future is not a measurement (voluntary mode)', () => {
    const w = mountModal(makeData(), { mode: 'voluntary' });
    // Uses the app's own `~/utils/localDate` helper for the expected value — NOT a second, independent
    // `new Date().toLocaleDateString('en-CA')` of its own — so this test can actually catch the component
    // reintroducing that exact fork (level-1 integration review finding 3): a duplicated expression here
    // would agree with a duplicated bug in the component and never go red.
    const measuredOnInput = w.findAll('input[type="date"]')[0]!;
    expect(measuredOnInput.attributes('max')).toBe(todayYmd());
  });

  // Level-1 integration review finding 2: the modal is mounted once for the page's life (PlantDetail.vue,
  // no `:key`), and its reopen-watch resets idempotencyKey/error/rawValue but used to leave `measuredOn`
  // untouched — so logging a back-dated reading, closing the modal, and reopening it to log TODAY's reading
  // showed the stale date, silently recording the new reading under the wrong day. Two readings on the same
  // date is a zero-span pair that corrupts the drying-rate slope fit. Voluntary mode only — `measuredOn`
  // isn't rendered in survey mode at all (see the survey-mode describe block below).
  it('resets measuredOn back to today when the modal is closed and reopened, even after a back-dated ' +
    'reading (voluntary mode)', async () => {
    const w = mountModal(makeData(), { mode: 'voluntary' });
    const measuredOnInput = () => w.findAll('input[type="date"]')[0]!;

    await measuredOnInput().setValue('2026-08-01');
    expect((measuredOnInput().element as HTMLInputElement).value).toBe('2026-08-01');

    // Close, then reopen — the same modal instance a page reuse never re-mounts.
    await w.setProps({ open: false });
    await w.setProps({ open: true });

    expect((measuredOnInput().element as HTMLInputElement).value).toBe(todayYmd());
  });

  // RETRACTED 2026-08-10 — `resets the calibration anchors too on close/reopen (fix wave 1, item 1a)`.
  // Written for fix wave 1, item 1a/1c: the reopen-reset watcher claimed in its own comment to reset
  // "EVERY field a previous session could have left stale" while silently leaving the anchors untouched,
  // and the API records that a REPOT invalidates a calibration — so anchors typed for the OLD pot and
  // abandoned without saving sat pre-filled, one tap from being written as the NEW pot's. Moved verbatim
  // to `PlantCalibrationModal.test.ts`, which now hosts the fields and carries the identical reset.

  // Fix wave 1, item 1b: `instrumentId`'s setup-time initializer (`props.data.instruments[0]?.id ?? ''`)
  // can miss the "default to the first instrument" intent entirely — PlantDetail.vue's template falls
  // back to an empty `{ instruments: [], … }` shape while its own async readings fetch is still in
  // flight, so the modal can be constructed before the real instrument list ever reaches it. The fix
  // re-applies the default on every open, but ONLY when nothing is currently selected, so it must NOT
  // clobber the owner's own later, deliberate choice.
  it('defaults the instrument to the first one on a first open, even with a late-arriving data prop, but ' +
    'never overwrites an explicit LATER choice on reopen (fix wave 1, item 1b)', async () => {
    const w = mount(SoilReadingModal, {
      props: { open: false, plantId: 'plant-1', data: makeData({ instruments: [] }), mode: 'voluntary' },
      global: { mocks: { $t: (k: string) => k }, stubs },
    });

    // Simulate PlantDetail.vue's readings fetch resolving LATE — after the modal already exists — while
    // the modal is still closed, exactly the gap the setup-time initializer used to miss.
    await w.setProps({ data: makeData({ instruments: [galvanicProbe, kitchenScaleCalibrated] }) });
    await w.setProps({ open: true });
    expect(instrumentSegButtons(w)[0]!.attributes('aria-pressed')).toBe('true');

    // The owner explicitly picks the SECOND instrument.
    await instrumentSegButtons(w)[1]!.trigger('click');
    expect(instrumentSegButtons(w)[1]!.attributes('aria-pressed')).toBe('true');

    // Close and reopen: the deliberate stickiness must survive untouched — never reverting to the default.
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect(instrumentSegButtons(w)[1]!.attributes('aria-pressed')).toBe('true');
  });

  // Fix wave 1, item 3: `min`/`max` attributes on a number input do NOT block a click-submit, and the
  // shared Zod schema requires only a finite number — typing `55` on the 1–10 galvanic probe used to
  // record a fully-wet `w = 1.0` reading with no complaint anywhere, corrupting the slope fit this whole
  // feature exists to protect. The gate lives in `canSubmit`, the same shape as RepotDoneForm.vue's own
  // `potSizeValid`/`potSizeInvalid` pair.
  it('blocks submit and marks the field invalid when the raw value is outside the instrument\'s declared ' +
    'range (fix wave 1, item 3)', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] })); // rawMin 1, rawMax 10
    const input = w.find('input[type="number"]');
    await input.setValue(55);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    expect(input.attributes('aria-invalid')).toBe('true');
  });

  it('allows submit again once the raw value is back within range', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }));
    const input = w.find('input[type="number"]');
    await input.setValue(55);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    await input.setValue(7);
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
    expect(input.attributes('aria-invalid')).toBeUndefined();
  });

  // The kitchen scale declares NO `rawMax` (grams are open-ended) — it must stay unrestricted.
  it('never restricts the kitchen scale — grams are open-ended, no declared rawMax', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    const input = readingInput(w);
    await input.setValue(999999);
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
    expect(input.attributes('aria-invalid')).toBeUndefined();
  });
});

// The same-day-watering question (owner-ruled, 2026-08-08): the drying-rate fence is strict-after the last
// watering, so a reading taken ON a watering day is ambiguous about which side of that watering it belongs
// to. The API tells the modal when to ask via `PlantSoilReadings.wateringDays`. NO default, NO
// pre-selection: `canSubmit` stays false until the owner answers, and the field is reset on reopen and on
// any `measuredOn` change, exactly like every other field this modal already resets.
//
// MOVED to voluntary mode (2026-08-09 redesign): the question is impossible by construction in survey mode
// — see the component's own `showWateringRelation` comment — so it survives only here. Every assertion
// below is unchanged in substance from the pre-redesign version; only the explicit `mode: 'voluntary'` is
// new.
describe('SoilReadingModal — the same-day-watering question, voluntary mode (owner-ruled 2026-08-08)', () => {
  // REWRITTEN 2026-08-10 (spec §5): a third clause, because the gate is now `mode === 'voluntary' &&
  // isWateringDay` and the first two clauses alone cannot tell that apart from the bare `isWateringDay`
  // the code carried between QA round 3 and the owner's ruling.
  it('shows the question ONLY when measuredOn is a watering day — and only in VOLUNTARY mode', () => {
    const onWateringDay = mountModal(makeData({ wateringDays: [todayYmd()] }), { mode: 'voluntary' });
    expect(wateringRelationSeg(onWateringDay)).toBeTruthy();

    const notWateringDay = mountModal(makeData({ wateringDays: [] }), { mode: 'voluntary' });
    expect(wateringRelationSeg(notWateringDay)).toBeUndefined();

    // Same day, same data, survey mode: silent. The mode is the whole difference.
    const survey = mountSurvey(makeData({ wateringDays: [todayYmd()] }));
    expect(wateringRelationSeg(survey)).toBeUndefined();
  });

  it('blocks submit until the question is answered, and never pre-selects either option', async () => {
    const w = mountModal(
      makeData({ instruments: [galvanicProbe], wateringDays: [todayYmd()] }), { mode: 'voluntary' },
    );
    await w.find('input[type="number"]').setValue(5); // a valid raw reading, so only the question gates it

    const buttons = wateringRelationSeg(w)!.findAll('button');
    expect(buttons.every((b) => b.attributes('aria-pressed') === 'false')).toBe(true);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();

    await buttons[0]!.trigger('click'); // BEFORE
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });

  it('sends the chosen answer to the API only when the question was asked', async () => {
    const w = mountModal(
      makeData({ instruments: [galvanicProbe], wateringDays: [todayYmd()] }), { mode: 'voluntary' },
    );
    await w.find('input[type="number"]').setValue(5);
    const buttons = wateringRelationSeg(w)!.findAll('button');
    await buttons[1]!.trigger('click'); // AFTER
    await findSaveButton(w).trigger('click');
    await flushPromises();

    const lastCall = recordSoilReading.mock.calls[recordSoilReading.mock.calls.length - 1]!;
    expect(lastCall[1]).toMatchObject({ wateringRelation: 'AFTER' });
  });

  // FIX W3's counter-case, and the boundary of that fix. Voluntary mode is the ONE surface where the
  // browser's day is still the right one: no preview runs (there is no verdict to compute for a five-day-old
  // reading), and the owner picks the date himself — so a survey-mode fix that reached in here would
  // silently overwrite a back-dated reading with today.
  it('voluntary mode still sends the date the OWNER chose, and never consults the preview for one',
    async () => {
      const backDated = '2026-08-01';
      const w = mountModal(makeData({ instruments: [galvanicProbe], wateringDays: [] }), { mode: 'voluntary' });
      await w.find('input[type="date"]').setValue(backDated);
      await w.find('input[type="number"]').setValue(5);
      await findSaveButton(w).trigger('click');
      await flushPromises();

      const lastCall = recordSoilReading.mock.calls[recordSoilReading.mock.calls.length - 1]!;
      expect(lastCall[1].measuredOn).toBe(backDated);
      expect(lastCall[1].measuredOn).not.toBe(PLANT_TODAY);
      expect(previewSoilReading).not.toHaveBeenCalled();
    });

  it('omits wateringRelation entirely when measuredOn is not a watering day', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe], wateringDays: [] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(5);
    await findSaveButton(w).trigger('click');
    await flushPromises();

    const lastCall = recordSoilReading.mock.calls[recordSoilReading.mock.calls.length - 1]!;
    expect(lastCall[1]).not.toHaveProperty('wateringRelation');
  });

  it('changing measuredOn away from a watering day clears the answer and re-enables submit — never ' +
    'silently submitted for a day it does not describe', async () => {
    const wateringDay = todayYmd();
    const otherDay = '2026-08-01';
    const w = mountModal(
      makeData({ instruments: [galvanicProbe], wateringDays: [wateringDay] }), { mode: 'voluntary' },
    );
    await w.find('input[type="number"]').setValue(5);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined(); // watering day, unanswered

    await wateringRelationSeg(w)!.findAll('button')[0]!.trigger('click'); // BEFORE
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();

    const measuredOnInput = w.findAll('input[type="date"]')[0]!;
    await measuredOnInput.setValue(otherDay);

    // The question disappears entirely for a non-watering day, and submit stays enabled.
    expect(wateringRelationSeg(w)).toBeUndefined();
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();

    // The answer was actually CLEARED, not just hidden — switching back to the SAME watering day must show
    // the control unanswered again, never a stale pre-selection, and submit must gate on it again.
    await measuredOnInput.setValue(wateringDay);
    const buttonsAgain = wateringRelationSeg(w)!.findAll('button');
    expect(buttonsAgain.every((b) => b.attributes('aria-pressed') === 'false')).toBe(true);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
  });

  it('resets the answer on close/reopen', async () => {
    const wateringDay = todayYmd();
    const w = mountModal(
      makeData({ instruments: [galvanicProbe], wateringDays: [wateringDay] }), { mode: 'voluntary' },
    );
    await wateringRelationSeg(w)!.findAll('button')[1]!.trigger('click'); // AFTER
    expect(wateringRelationSeg(w)!.findAll('button')[1]!.attributes('aria-pressed')).toBe('true');

    // Close, then reopen — the same modal instance a page reuse never re-mounts. `measuredOn` resets to
    // today too, which is still `wateringDay` here, so the control stays shown.
    await w.setProps({ open: false });
    await w.setProps({ open: true });

    const buttonsAfter = wateringRelationSeg(w)!.findAll('button');
    expect(buttonsAfter.every((b) => b.attributes('aria-pressed') === 'false')).toBe(true);
  });
});

// The measuring modal's whole point, since the 2026-08-09 redesign: survey mode ANSWERS "do I water this
// today?" instead of asking the owner three questions the engine can now answer itself.
describe('SoilReadingModal — survey mode (the redesigned measuring modal answers, not asks)', () => {
  afterEach(() => {
    previewSoilReading.mockClear();
    recordSoilReading.mockClear();
  });

  it('hides measuredOn — a survey answers TODAY, never a chosen date', () => {
    const w = mountSurvey(makeData());
    expect(w.findAll('input[type="date"]')).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // RETRACTED 2026-08-10 (owner's ruling — the survey stops asking). Three cases, each named with the
  // defect it was written for, because the survey no longer renders the control at all:
  //   • `DOES render the watering-relation control in survey mode on a day the plant was already watered`
  //       — QA round 3, defect 3. It replaced an assertion of the exact OPPOSITE ("impossible by
  //         construction"), because a plant watered that morning and measured that evening broke the
  //         premise: the API refused the write with a 400 the survey had no control to answer, and two of
  //         four QA fixture plants were unusable for a whole day.
  //   • `the primary button stays disabled until the same-day question is answered`
  //       — same defect, the gating half: an un-defaulted question must block submit while it is shown.
  //   • `sends the answer with a HOLD write`
  //       — same defect, the payload half.
  //
  // All three were correct about the code and correct about the fix available at the time. They are gone
  // because the owner deleted the question instead of answering it: a survey reading is taken NOW, so a
  // watering already recorded for today necessarily precedes it, and the API derives that from the
  // ordering of events it already stores. The 400 they defended against is unreachable by construction.
  // The behaviour they pinned survives in VOLUNTARY mode, where it is genuinely underivable, and the
  // voluntary describe block above is unchanged.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════

  // REPLACES the three retracted cases above with the inverted invariant, so "the survey does not ask" is
  // asserted rather than merely no longer contradicted. Both days are checked: a watering day is the one
  // that used to render the control, and an ordinary day is the case that was always silent — a single
  // assertion on the ordinary day would pass even if the gate regressed to `isWateringDay`.
  it('NEVER renders the watering-relation control in survey mode — watering day or not', async () => {
    const onWateringDay = mountSurvey(makeData({
      instruments: [galvanicProbe], wateringDays: [todayYmd()],
    }));
    expect(wateringRelationSeg(onWateringDay)).toBeUndefined();

    const ordinaryDay = mountSurvey(makeData({ instruments: [galvanicProbe], wateringDays: [] }));
    expect(wateringRelationSeg(ordinaryDay)).toBeUndefined();

    // …and the absent question blocks nothing: on the very day it used to be mandatory, a valid reading is
    // enough to press "Calcular riego". Without this half the case would also pass if the control were
    // merely hidden while `canSubmit` still waited on an answer nobody could give — the exact dead end the
    // ruling exists to delete.
    await readingInput(onWateringDay).setValue(5);
    expect(findCalculateButton(onWateringDay).attributes('disabled')).toBeUndefined();
  });

  it('has no verdict picker and no postpone-date field', () => {
    const w = mountSurvey(makeData());
    // The retired controls rendered these exact strings before the redesign; neither may appear anywhere,
    // including inside a still-unanswered measure step.
    expect(w.text()).not.toContain('reading.verdictLabel');
    expect(w.text()).not.toContain('reading.verdict.');
    expect(w.text()).not.toContain('reading.postponeTo');
  });

  it('labels the primary action "Calcular riego" — never "Guardar lectura"', () => {
    const w = mountSurvey(makeData());
    expect(findCalculateButton(w)).toBeTruthy();
    expect(w.findAll('button').some((b) => b.text().includes('reading.save'))).toBe(false);
  });

  // REWRITTEN (measured-verdict-gap redesign, Task 47/T6b, owner ruling 2026-08-09) — the case this
  // replaces asserted "WATER_NOW writes NOTHING", which was the exact dead end the redesign closes: with
  // nothing written, the row had no way to know a measurement happened, so it kept offering "¿Necesitas
  // regar?" forever after the owner already answered it and went to water. The new behaviour: WATER_NOW
  // WRITES the reading, with `verdict: 'NONE'` (real data that teaches the drying-rate fit and changes no
  // schedule — `NONE` never touches DueCache/TaskOverride the way `POSTPONE` does), and emits `saved` so
  // the caller's refresh flips `measuredToday` and closes `canSurvey` back to false. The owner still acts
  // on the row himself (Hecho once he has actually watered) — this write only stops the app from asking
  // the same question again.
  it('a WATER_NOW verdict WRITES the reading (verdict NONE) and still shows the verdict step', async () => {
    previewSoilReading.mockResolvedValueOnce(waterNowPreview);
    const w = mountSurvey(makeData({ instruments: [galvanicProbe] }));
    await w.find('input[type="number"]').setValue(5);
    await findCalculateButton(w).trigger('click');
    await flushPromises();

    expect(previewSoilReading).toHaveBeenCalledWith('plant-1', { instrumentId: 'galvanic-probe', rawValue: 5 });
    expect(recordSoilReading).toHaveBeenCalledTimes(1);
    const [plantId, body] = recordSoilReading.mock.calls[0]!;
    expect(plantId).toBe('plant-1');
    expect(body).toMatchObject({ instrumentId: 'galvanic-probe', rawValue: 5, verdict: 'NONE' });
    // FIX W3 — dated by the PREVIEW's plant-local day, never by this browser's. Browser-behind would write
    // yesterday, so `measuredToday` never flips and the row asks forever; browser-ahead would write a
    // future date the API's own past-event rule refuses with a 400. Both dead-end the survey.
    expect(body.measuredOn).toBe(PLANT_TODAY);
    expect(body.measuredOn).not.toBe(todayYmd());
    // Never a schedule-moving field — this write teaches the fit, it does not postpone anything.
    expect(body).not.toHaveProperty('postponeToOn');
    expect(w.emitted('saved')).toHaveLength(1);
    expect(w.text()).toContain('reading.verdictWaterNowTitle');
    // The modal stays open on the verdict step, waiting for the owner to close it and go act on the row —
    // it never auto-closes the way a successful voluntary save does.
    expect(w.find('[data-modal-stub]').exists()).toBe(true);

    // Closing from here writes nothing further — the ONE write already happened when the verdict arrived,
    // never a second one on close.
    await findCloseButton(w).trigger('click');
    expect(recordSoilReading).toHaveBeenCalledTimes(1);
  });

  it('a HOLD verdict applies IMMEDIATELY: verdict POSTPONE with the suggested date, no extra tap', async () => {
    previewSoilReading.mockResolvedValueOnce(holdPreview);
    const w = mountSurvey(makeData({ instruments: [galvanicProbe] }));
    await w.find('input[type="number"]').setValue(5);
    await findCalculateButton(w).trigger('click');
    await flushPromises();

    expect(recordSoilReading).toHaveBeenCalledTimes(1);
    const [, body] = recordSoilReading.mock.calls[0]!;
    expect(body).toMatchObject({
      instrumentId: 'galvanic-probe', rawValue: 5, verdict: 'POSTPONE', postponeToOn: '2026-08-20',
    });
    // FIX W3 — the plant's day, not the browser's (see the WATER_NOW case for the full reasoning).
    expect(body.measuredOn).toBe(PLANT_TODAY);
    expect(body.measuredOn).not.toBe(todayYmd());
    expect(body).not.toHaveProperty('wateringRelation');
    expect(w.text()).toContain('reading.verdictHoldTitle');
    expect(w.text()).toContain('reading.verdictHoldBody|2026-08-20');
    expect(w.emitted('saved')).toHaveLength(1);
  });

  // The endpoint's own contract (`watering-verdict-constants.ts`): UNAVAILABLE means no honest fraction
  // exists to compare against the target — it is a genuinely DIFFERENT outcome from HOLD (a real,
  // measured "wait until X" answer), and the modal must never blur that distinction by treating the two
  // the same way.
  //
  // Owner ruling (2026-08-09): UNAVAILABLE is OFFERED, never PERFORMED — HOLD applies itself because the
  // app HAS an answer and that answer IS an action; UNAVAILABLE has no answer, and a null-wetness reading
  // teaches the drying-rate fit nothing, so an automatic write would act on the owner's behalf for no
  // benefit. Both halves below are load-bearing: nothing written on arrival, and a real write ONLY once the
  // owner presses "Guardar lectura".
  it('an UNAVAILABLE verdict is never rounded into a HOLD, writes NOTHING on arrival, and records a plain ' +
    'NONE only once the owner presses Guardar lectura', async () => {
    previewSoilReading.mockResolvedValueOnce(unavailablePreview);
    const w = mountSurvey(makeData({ instruments: [galvanicProbe] }));
    await w.find('input[type="number"]').setValue(5);
    await findCalculateButton(w).trigger('click');
    await flushPromises();

    expect(w.text()).not.toContain('reading.verdictHoldTitle');
    expect(w.text()).not.toContain('reading.verdictWaterNowTitle');
    expect(w.text()).toContain('reading.verdictUnavailableReason.NOT_MEASURABLE');

    // Half 1: nothing written on arrival — the modal only OFFERS the save, and stays open on the verdict
    // step waiting for the owner's own tap.
    expect(recordSoilReading).not.toHaveBeenCalled();
    expect(w.emitted('saved')).toBeUndefined();
    expect(w.find('[data-modal-stub]').exists()).toBe(true);

    // Half 2: pressing "Guardar lectura" writes the plain NONE reading, and only then.
    await findSaveButton(w).trigger('click');
    await flushPromises();

    expect(recordSoilReading).toHaveBeenCalledTimes(1);
    const [, body] = recordSoilReading.mock.calls[0]!;
    expect(body).toMatchObject({ instrumentId: 'galvanic-probe', rawValue: 5, verdict: 'NONE' });
    // FIX W3, and this is the branch most easily missed: the write happens on a LATER tap, out of
    // `pendingUnavailableReading`, so the preview's day has to have been captured INTO that object at
    // verdict time rather than read off a live field at save time.
    expect(body.measuredOn).toBe(PLANT_TODAY);
    expect(body.measuredOn).not.toBe(todayYmd());
    expect(body).not.toHaveProperty('postponeToOn');
    expect(w.emitted('saved')).toHaveLength(1);
  });

  it('a failed preview writes nothing and stays retryable', async () => {
    previewSoilReading.mockRejectedValueOnce({ statusCode: 500 });
    const w = mountSurvey(makeData({ instruments: [galvanicProbe] }));
    await w.find('input[type="number"]').setValue(5);
    await findCalculateButton(w).trigger('click');
    await flushPromises();

    expect(recordSoilReading).not.toHaveBeenCalled();
    expect(w.emitted('saved')).toBeUndefined();
    expect(w.text()).toContain('reading.saveFailed');
    // Still on the measure step — the primary action is offered again, unchanged, retryable with the
    // SAME idempotency key (nothing about the form was reset).
    expect(findCalculateButton(w)).toBeTruthy();
    expect(findCalculateButton(w).attributes('disabled')).toBeUndefined();

    // The retry actually works once the API stops failing — proving "retryable" is real, not just an
    // absence of a disabled attribute.
    previewSoilReading.mockResolvedValueOnce(waterNowPreview);
    await findCalculateButton(w).trigger('click');
    await flushPromises();
    expect(w.text()).toContain('reading.verdictWaterNowTitle');
  });

  it('resets the verdict step back to measure on close/reopen — a stale verdict must never survive a ' +
    'fresh reading', async () => {
    previewSoilReading.mockResolvedValueOnce(waterNowPreview);
    const w = mountSurvey(makeData({ instruments: [galvanicProbe] }));
    await w.find('input[type="number"]').setValue(5);
    await findCalculateButton(w).trigger('click');
    await flushPromises();
    expect(w.text()).toContain('reading.verdictWaterNowTitle');

    await w.setProps({ open: false });
    await w.setProps({ open: true });

    expect(w.text()).not.toContain('reading.verdictWaterNowTitle');
    expect(findCalculateButton(w)).toBeTruthy();
  });
});

// Fix wave 1, item 4: the idempotency key is pinned per open and reused across retries — correct, since a
// lost-response retry must never write a second reading. But that same discipline means a 409 (in-flight
// duplicate) or 422 (same-key/different-body, permanent under the SAME pinned key) on THIS route can only
// mean the ORIGINAL request already committed. The honest handling is "this already happened", not "try
// again": a distinct message, the same refresh a successful save triggers (`emit('saved')`), and a close —
// never RepotDoneForm.vue's whole `frozen` machinery (owner ruling: do the minimum).
describe('SoilReadingModal — a failed save (fix wave 1, item 4)', () => {
  const plainT = (k: string, params?: Record<string, unknown>) =>
    (params ? `${k}|${Object.values(params).join('|')}` : k);

  afterEach(() => {
    // Restore the module's default (non-spy) useI18n stub for every other describe block in this file.
    vi.stubGlobal('useI18n', () => ({ t: plainT, d: (date: Date) => ymdFromLocalDate(date) }));
    recordSoilReading.mockReset();
    recordSoilReading.mockImplementation(() => Promise.resolve({ readingId: 'r1' }));
  });

  function mountReady() {
    return mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
  }

  async function fillAndSubmit(w: ReturnType<typeof mountReady>) {
    await w.find('input[type="number"]').setValue(5);
    await findSaveButton(w).trigger('click');
    await flushPromises();
  }

  it('on a 422 (same-key retry after an edit), shows the "already recorded" message, refreshes, and ' +
    'closes the modal', async () => {
    const tSpy = vi.fn(plainT);
    vi.stubGlobal('useI18n', () => ({ t: tSpy, d: (date: Date) => ymdFromLocalDate(date) }));
    recordSoilReading.mockRejectedValueOnce({ statusCode: 422 });

    const w = mountReady();
    await fillAndSubmit(w);

    expect(tSpy).toHaveBeenCalledWith('reading.alreadyRecorded');
    expect(w.emitted('saved')).toHaveLength(1);
    expect(w.find('[data-modal-stub]').exists()).toBe(false);
  });

  it('a 409 (in-flight duplicate) is classified the same way as a 422', async () => {
    recordSoilReading.mockRejectedValueOnce({ response: { status: 409 } });
    const w = mountReady();
    await fillAndSubmit(w);

    expect(w.emitted('saved')).toHaveLength(1);
    expect(w.find('[data-modal-stub]').exists()).toBe(false);
  });

  // Round-5 finding F1, defence in depth. `wateringDays` is a SNAPSHOT and can legitimately be behind the
  // server: the owner waters from the plant page after it loaded (PlantDetail.vue's `sendDone` now refreshes
  // it — that is the primary fix), or back-dates a reading to a watering day older than the window that list
  // covers. The server then refuses honestly with a 400 naming the field, and the modal must REVEAL the
  // question rather than show a generic "save failed" the owner can only clear by reloading. The question is
  // still ASKED, never inferred — we surface it, the owner answers, the retry carries a real answer.
  //
  // MOVED to voluntary mode (2026-08-09 redesign): survey mode never sends `wateringRelation` at all, so a
  // 400 naming it there would have no control left to reveal — see the component's own catch-block comment.
  it('a 400 naming wateringRelation REVEALS the question instead of dead-ending on the generic error ' +
    '(voluntary mode)', async () => {
    recordSoilReading.mockRejectedValueOnce(proxiedError(
      400, 'wateringRelation is required: this plant was already watered on measuredOn',
    ));
    // The cached list does NOT name today — that is precisely the stale-snapshot case.
    const w = mountModal(makeData({ instruments: [galvanicProbe], wateringDays: [] }), { mode: 'voluntary' });
    expect(wateringRelationSeg(w)).toBeUndefined();

    await fillAndSubmit(w);

    expect(wateringRelationSeg(w)).toBeDefined();          // the question is now on screen
    expect(w.text()).toContain('reading.wateringRelationRequired');
    expect(w.text()).not.toContain('reading.saveFailed');
    expect(w.find('[data-modal-stub]').exists()).toBe(true); // stays open so the owner can answer
    expect(w.emitted('saved')).toBeUndefined();              // nothing was recorded
  });

  // QA round 3, defect 7. The alert described a save of the reading that switching instruments has just
  // cleared, so it sat in red under a fresh, untouched form and read as a fault in what the owner was about
  // to do. An error that outlives the thing it was about is a lie with a delay on it.
  it('clears the error alert when the instrument changes, along with the reading it described', async () => {
    recordSoilReading.mockRejectedValueOnce(proxiedError(500, 'boom'));
    // The CALIBRATED scale: an uncalibrated one is no longer offered by the picker (2026-08-10), so the
    // second segment this case clicks would not exist.
    const w = mountModal(
      makeData({ instruments: [galvanicProbe, kitchenScaleCalibrated] }), { mode: 'voluntary' },
    );
    await fillAndSubmit(w);
    expect(w.text()).toContain('reading.saveFailed');

    await instrumentSegButtons(w)[1]!.trigger('click');
    expect(w.text()).not.toContain('reading.saveFailed');
  });

  it('a 400 about anything ELSE keeps the generic message and does NOT reveal the question', async () => {
    recordSoilReading.mockRejectedValueOnce(proxiedError(400, 'rawValue must be finite'));
    const w = mountModal(makeData({ instruments: [galvanicProbe], wateringDays: [] }), { mode: 'voluntary' });
    await fillAndSubmit(w);

    expect(w.text()).toContain('reading.saveFailed');
    expect(wateringRelationSeg(w)).toBeUndefined();
  });

  it('any other error keeps the generic message and leaves the modal open for a genuine retry', async () => {
    recordSoilReading.mockRejectedValueOnce({ statusCode: 500 });
    const w = mountReady();
    await fillAndSubmit(w);

    expect(w.emitted('saved')).toBeUndefined();
    expect(w.find('[data-modal-stub]').exists()).toBe(true);
    expect(w.text()).toContain('reading.saveFailed');
  });
});

// ---------------------------------------------------------------------------------------------------
// The ordinal capture branch. See `woodenStick`'s own comment: before QA (2026-08-10) NOTHING in this file
// mounted an ordinal instrument, so every assertion here covers a path that was previously untested.
//
// ⚠️ WHAT THIS BLOCK DELIBERATELY DOES NOT ASSERT: that `reading.honesty.wooden-stick` resolves to real
// prose. It CANNOT — this file's `useI18n` stub echoes the key back, so a present translation and a missing
// one are byte-identical here, and an assertion on the rendered sentence would pass whether or not the
// string exists. That is exactly the shape of vacuous test this feature has already been bitten by twice.
// The honest home for that guarantee is `i18n/instrument-keys.parity.test.ts`, which reads the locale JSON
// itself and is driven by the shared contract's instrument list.
// ---------------------------------------------------------------------------------------------------
describe('an ordinal instrument', () => {
  function valueGroupLabel(w: ReturnType<typeof mount>) {
    // The reading field is the ONLY FormGroup whose label comes from the `reading.value*` family.
    return w.findAllComponents({ name: 'FormGroup' })
      .map((g) => String(g.props('label')))
      .find((label) => label.startsWith('reading.value'));
  }

  it('labels the reading field with NO unit parenthetical', () => {
    const w = mountModal(makeData({ instruments: [woodenStick] }), { mode: 'voluntary' });
    // `reading.value` is `Reading ({unit})`; an ordinal instrument has no unit, so interpolating it
    // rendered the literal `Reading ()` on screen (QA, 2026-08-10). The fix is a SECOND key rather than an
    // empty interpolation — asserting the key identity is what makes that distinction observable, since
    // the stub echoes `key|param` for an interpolated call and the bare key otherwise.
    expect(valueGroupLabel(w)).toBe('reading.valueNoUnit');
  });

  it('a numeric instrument still labels the field WITH its unit', () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    // The `|` proves the interpolated form was chosen; the suffix proves the unit came from the shared
    // instrument catalogue rather than a literal typed into this component.
    expect(valueGroupLabel(w)).toBe('reading.value|settings.instruments.unit.galvanic-probe');
  });

  it('renders the named-state picker instead of a number input', () => {
    const w = mountModal(makeData({ instruments: [woodenStick] }), { mode: 'voluntary' });
    // A stick has no numeric readout. Being asked to type one would defeat the entire point of the
    // hardware-free rung.
    expect(w.find('input[type="number"]').exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// The WATER_NOW verdict's two actions (QA 2026-08-10, defect 2).
//
// Before this, the verdict that is the PAYOFF of the whole redesign rendered a bare title and a single
// `Cerrar`. The row behind it did take over — the reading written on the way here flips `measuredToday`,
// which closes the survey affordance and restores the classic pair — but only after the owner closed the
// dialog and went looking, and QA judged the verdict unactionable in practice for exactly that reason.
//
// Done and Postpone are two SEPARATE statements on purpose (spec §5): "I should water" is not "I had time
// to water", so an owner who cannot water right now must be able to say so without the app recording a
// watering that never happened.
// ---------------------------------------------------------------------------------------------------
describe('the WATER_NOW verdict is actionable', () => {
  async function reachWaterNowVerdict() {
    previewSoilReading.mockResolvedValueOnce({
      measuredOn: PLANT_TODAY, wetness: 0.2, target: 0.4, recommendation: 'WATER_NOW',
      suggestedPostponeToOn: null, basis: null, unavailableReason: null,
    });
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'survey' });
    await w.find('input[type="number"]').setValue(3);
    await findCalculateButton(w).trigger('click');
    await flushPromises();
    return w;
  }

  function verdictButton(w: ReturnType<typeof mount>, label: string) {
    return w.findAll('button').find((b) => b.text().includes(label));
  }

  it('carries a supporting sentence, not a bare title (UX-4)', async () => {
    const w = await reachWaterNowVerdict();
    expect(w.text()).toContain('reading.verdictWaterNowTitle');
    // HOLD always had one; WATER_NOW read as an unfinished screen next to it.
    expect(w.text()).toContain('reading.verdictWaterNowBody');
  });

  it('offers BOTH Done and Postpone alongside Close', async () => {
    const w = await reachWaterNowVerdict();
    expect(verdictButton(w, 'common.done')).toBeDefined();
    expect(verdictButton(w, 'common.postpone')).toBeDefined();
    expect(verdictButton(w, 'common.close')).toBeDefined();
  });

  it('Done closes the modal FIRST, then emits — never both open at once', async () => {
    const w = await reachWaterNowVerdict();
    await verdictButton(w, 'common.done')!.trigger('click');

    expect(w.emitted('water-done')).toHaveLength(1);
    // The page's own `onDone` may open a SECOND dialog (the early-water reason picker). Emitting while
    // this modal was still mounted would stack one modal on another.
    expect(w.find('[data-modal-stub]').exists()).toBe(false);
  });

  it('Postpone emits its own event, distinct from Done', async () => {
    const w = await reachWaterNowVerdict();
    await verdictButton(w, 'common.postpone')!.trigger('click');

    expect(w.emitted('water-postpone')).toHaveLength(1);
    // Collapsing the two into one event would let a "no tuve tiempo" be recorded as a watering.
    expect(w.emitted('water-done')).toBeUndefined();
    expect(w.find('[data-modal-stub]').exists()).toBe(false);
  });

  it('the modal itself records NO watering — the page owns that, in one place', async () => {
    const w = await reachWaterNowVerdict();
    recordSoilReading.mockClear();
    await verdictButton(w, 'common.done')!.trigger('click');

    // The reading was already written on the way to this verdict (`verdict: 'NONE'`). If this footer ever
    // starts writing the watering itself, that is a second implementation of "mark watered" that will
    // drift from the row's own.
    expect(recordSoilReading).not.toHaveBeenCalled();
  });

  it('a HOLD verdict still offers Close alone — it already applied its own postpone', async () => {
    previewSoilReading.mockResolvedValueOnce({
      measuredOn: PLANT_TODAY, wetness: 0.8, target: 0.4, recommendation: 'HOLD',
      suggestedPostponeToOn: '2026-08-21', basis: 'MEASURED_SLOPE', unavailableReason: null,
    });
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'survey' });
    await w.find('input[type="number"]').setValue(9);
    await findCalculateButton(w).trigger('click');
    await flushPromises();

    expect(verdictButton(w, 'common.done')).toBeUndefined();
    expect(verdictButton(w, 'common.postpone')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// RETRACTED 2026-08-10 (owner's ruling) — the whole describe
// `a survey refused for a missing wateringRelation recovers instead of dead-ending`, three cases:
// `reveals the question rather than showing the generic failure`, `stays on the measure step so the retry
// is a real retry`, and `the answered retry carries the relation and succeeds`.
//
// THE DEFECT THEY WERE WRITTEN FOR: QA defect 3, the recovery half. A survey on a plant watered EARLIER
// today showed a generic "please try again" for a request the server would refuse identically forever —
// the 400-recovery branch that reveals the question was itself gated to voluntary mode, so the mode that
// needed it most was the one walled off from it. Two of four QA fixture plants were unusable for a day.
//
// They are unreachable now rather than wrong: the survey sends no `wateringRelation` on any branch, and the
// API derives the relation for a today-dated reading, so there is no refusal left to recover from. The
// recovery itself is NOT deleted — it survives, voluntary-only, in `a 400 naming wateringRelation REVEALS
// the question ... (voluntary mode)` above, where a back-dated reading on a stale `wateringDays` snapshot
// can still be refused and no one can derive the answer (care events store a date, not a time).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------------------------------
// QA defect 6 (granularity) and UX-2 (a button that dies silently), together because they share the
// footer. The step rule is the LOCAL half of the shared contract's own check — the server enforces the
// same thing through `rawValueRangeRefinement`, so these cases pin that the two agree rather than that the
// client is the guarantee.
// ---------------------------------------------------------------------------------------------------
describe('the reading field enforces the instrument\'s declared granularity', () => {
  function blockedText(w: ReturnType<typeof mount>) {
    return w.find('.mp-modal-blocked').exists() ? w.find('.mp-modal-blocked').text() : undefined;
  }

  it('refuses a fraction on the CLOSED probe scale', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(5.5);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    expect(rawValueError(w)).toBe('reading.valueOffStep|1|1');
  });

  // ⚠️ THE CASE THE OBVIOUS FIX BREAKS — see the shared refinement's own test of the same name. The scale
  // declares `rawStep: 1` too, but grams are open-ended (`rawMax: null`) and 1234.5 g is a real reading.
  it('still accepts a FRACTIONAL weight on the open-ended kitchen scale', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }), { mode: 'voluntary' });
    await readingInput(w).setValue(1234.5);
    expect(rawValueError(w)).toBeUndefined();
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });

  it('reports the BOUNDS problem, not the step one, when a value breaks both', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(99.5);
    // Two faults, one message, and it must be the one the owner can act on.
    expect(rawValueError(w)).toBe('reading.valueOutOfRange|1|10');
  });

  // MOVED 2026-08-10 — `says WHY the primary action is unavailable instead of dying silently`.
  // Written for QA UX-2: an uncalibrated scale left the primary button dead and mute, so the owner had no
  // way out of the dialog but to guess. Its ONLY vehicle was the calibration block, and that block left
  // this modal — an instrument still missing its anchors is no longer offered IN A SURVEY (the owner is
  // routed to `PlantCalibrationModal` instead), so `reading.missingCalibration` has no path to THIS
  // footer any more. The UX-2 property itself is NOT retracted: the cases below still assert the footer
  // states the value bound, the off-step fault, and the unanswered same-day question.
  //
  // ⚠️ CORRECTED 2026-08-10 (review finding F1). This comment used to say the case was RETRACTED and that
  // its assertion had "moved to `PlantCalibrationModal`". The first half was fine; the second was FALSE
  // when it was written — that surface rendered no blocking reason at all, and `reading.missingCalibration`
  // had zero readers in the entire repo. The destination has since been given the affordance for real, and
  // the case now lives there as `says WHY Save is unavailable instead of dying silently — both weights
  // empty`. A justification nobody measured is how a deletion becomes a regression with a paper trail.

  // REWRITTEN 2026-08-10: was `mountSurvey`. Survey mode does not ask the question any more, so this case
  // would have been asserting a blocking reason that can never appear — it is re-pointed at VOLUNTARY
  // mode, the one place the question (and therefore this blocking reason) still exists.
  it('names the unanswered same-day question when that is what blocks (voluntary mode)', async () => {
    const w = mountModal(
      makeData({ instruments: [galvanicProbe], wateringDays: [todayYmd()] }), { mode: 'voluntary' },
    );
    await w.find('input[type="number"]').setValue(5);
    expect(blockedText(w)).toBe('reading.missingWateringRelation');
  });

  // ⚠️ REWRITTEN 2026-08-10 (QA round 3, defect 4). It used to assert `blockedText(w)).toBeUndefined()`,
  // on the reasoning that the field already says it inline and repeating it reads as two separate faults.
  // QA overturned that from the owner's side: typing `11` into a field labelled `Reading (1–10 index)`
  // greyed the button out with nothing beside it — and the same for `0`, `1.5`, `-5` and `1e3`. In a tall
  // dialog the field scrolls out of view while the footer does not, and the footer is where the eye goes
  // when a button will not press. Kept and inverted rather than deleted: the old assertion records a
  // judgement that was made deliberately and turned out to be wrong in front of a user.
  it('names the value fault in the footer too — the SAME sentence the field shows', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(99);
    // One sentence in two places. Two DIFFERENT wordings for one fault is what actually reads as two
    // faults, so this asserts they are identical rather than merely both present.
    expect(rawValueError(w)).toBe('reading.valueOutOfRange|1|10');
    expect(blockedText(w)).toBe('reading.valueOutOfRange|1|10');
  });

  it('names the off-step fault in the footer as well', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(5.5);
    expect(blockedText(w)).toBe('reading.valueOffStep|1|1');
  });

  // MOVED 2026-08-10 — two more calibration blocking-reason cases, with the defects they were written
  // for, and both for the same reason as `says WHY the primary action is unavailable` above: THIS footer
  // can no longer be blocked by a calibration, because a survey never offers an instrument missing one.
  //   • `says the span is INVERTED, not that the weights are missing, when both are filled`
  //       — QA round 3, defect 5: an inverted pair (800 watered / 1500 dry) was stated correctly ON the
  //         field while the footer said "fill in both reference weights first" about two boxes the owner
  //         was looking at. A blocking reason describing a state the owner can see is false costs him the
  //         trust he needs to believe the next one.
  //   • `still says the weights are missing when they genuinely are`
  //       — defect 5's counter-case, so the correct message was not lost to the fix.
  //
  // ⚠️ CORRECTED 2026-08-10 (review finding F1). This comment claimed the `spanInvalid` and
  // `missingCalibration` copy "still binds". `spanInvalid` did — as an inline field error — but no test
  // asserted its TEXT anywhere (finding F7), and `missingCalibration` bound to nothing at all: it had zero
  // code readers and sat orphaned in both locale files. Both are real again on the destination surface,
  // and both are asserted there: `PlantCalibrationModal.test.ts` › `says the span is INVERTED, not that
  // the weights are missing, when both are filled` and › `says WHY Save is unavailable ... both weights
  // empty`, with the inline `spanInvalid` sentence pinned by name in `blocks submit until the calibration
  // span is strictly positive`.

  it('says nothing at all once the form is submittable', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(5);
    expect(blockedText(w)).toBeUndefined();
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------
// QA UX-3, filed as UX and treated as correctness. The finger was shown the wooden stick's guidance
// verbatim — a pot-derived "insert to about 7 cm" — because both rows declared `protocolKind: 'insertion'`.
// That instruction cannot be followed with a finger, it contradicts the Settings copy, and it contradicts
// FINGER_DEPTH_PENALTY, which exists because the finger samples the top ~3 cm.
// ---------------------------------------------------------------------------------------------------
describe('the protocol shown matches the instrument, not the pot', () => {
  const finger = {
    id: 'finger' as const, kind: 'moisture' as const, unit: 'level', scale: 'finger-dry-to-damp',
    direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: false,
    protocolKind: 'shallow-insertion' as const,
    captureKind: 'ordinal' as const,
    rawMin: 1, rawMax: 3, rawStep: 1, calibration: null,
  };

  it('the finger gets its own shallow protocol, never the pot-derived depth', () => {
    const w = mountModal(makeData({ instruments: [finger] }), { mode: 'voluntary' });
    expect(w.text()).toContain('reading.protocolShallow');
    // `protocol` IS supplied in this fixture (potSizeCm 20, depth 7). The point is that a real, available
    // pot depth must still not be printed for this instrument — the failure was never a missing number.
    expect(w.text()).not.toContain('reading.protocol|');
  });

  it('the wooden stick still gets the pot-derived insertion depth', () => {
    const w = mountModal(makeData({ instruments: [woodenStick] }), { mode: 'voluntary' });
    expect(w.text()).toContain('reading.protocol|7|3');
    expect(w.text()).not.toContain('reading.protocolShallow');
  });

  it('the kitchen scale still gets the whole-pot protocol', () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }), { mode: 'voluntary' });
    expect(w.text()).toContain('reading.protocolWholePot');
  });

  it('the finger states its protocol even when the pot size is unknown', () => {
    // An `insertion` row falls back to "add the pot diameter and we'll tell you how deep". The finger never
    // needs that fallback: its depth was never the pot's to give.
    const w = mountModal(makeData({ instruments: [finger], protocol: null }), { mode: 'voluntary' });
    expect(w.text()).toContain('reading.protocolShallow');
    expect(w.text()).not.toContain('reading.protocolUnknownPot');
  });
});

// QA UX-5. `<input type="date">` renders in the BROWSER's locale, never the app's, so `08/10/2026` is
// 10 August to one reader and 8 October to another and nothing said which.
describe('the measured-on date is stated unambiguously', () => {
  function dateGroupHint(w: ReturnType<typeof mount>) {
    return w.findAllComponents({ name: 'FormGroup' })
      .find((g) => g.props('label') === 'reading.measuredOn')?.props('hint');
  }

  it('spells the chosen date out in the app locale beside the native control', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="date"]').setValue('2026-08-09');
    // The stub's `d()` formats from LOCAL components, so this also pins that the hint is not one day off.
    expect(dateGroupHint(w)).toBe('2026-08-09');
  });

  it('survey mode has no date field, so nothing to disambiguate', () => {
    const w = mountSurvey(makeData({ instruments: [galvanicProbe] }));
    expect(dateGroupHint(w)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------
// The second QA round (2026-08-10). Both of these are "the app silently accepts something the owner never
// meant", and neither could be caught by anything downstream: every value involved is legal on the scale
// it lands on, so range, step and the server all pass it.
// ---------------------------------------------------------------------------------------------------
describe('switching instruments does not carry the reading across scales', () => {
  const twoInstruments = () => makeData({ instruments: [woodenStick, galvanicProbe] as never });

  function pickInstrument(w: ReturnType<typeof mount>, index: number) {
    return instrumentSegButtons(w)[index]!.trigger('click');
  }

  it('clears an ordinal level when moving to a numeric instrument', async () => {
    const w = mountModal(twoInstruments(), { mode: 'voluntary' });
    // The stick's third state stores `3`. On the probe that is a legal 1..10 conductance reading, so
    // nothing downstream can tell it was carried rather than measured.
    await w.findAll('.mp-seg')[1]!.findAll('button')[2]!.trigger('click');
    await pickInstrument(w, 1);

    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('');
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
  });

  it('clears a numeric value when moving to another instrument', async () => {
    const w = mountModal(twoInstruments(), { mode: 'voluntary' });
    await pickInstrument(w, 1);
    await w.find('input[type="number"]').setValue(5);
    await pickInstrument(w, 0);
    await pickInstrument(w, 1);

    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('');
  });

  // RETRACTED 2026-08-10 — `clears calibration anchors too — they describe one instrument on one pot`.
  // Written for QA round 2's "the app silently accepts something the owner never meant" pair: anchors are
  // per (pot, instrument), so numbers typed for one instrument describe nothing on another's scale, and
  // every value involved is legal wherever it lands so nothing downstream could catch the carry. Moved to
  // `PlantCalibrationModal.test.ts`, rebased onto two calibratable fixtures (the probe is not offered on a
  // calibration-setup screen). The READING half of the same rule stays here, in the two cases above.
});

describe('a measurement cannot be dated in the future', () => {
  function tomorrow() {
    const t = new Date();
    t.setDate(t.getDate() + 15);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  function blockedText(w: ReturnType<typeof mount>) {
    return w.find('.mp-modal-blocked').exists() ? w.find('.mp-modal-blocked').text() : undefined;
  }

  it('blocks the save and says why — the `max` attribute does not stop a TYPED date', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(5);
    await w.find('input[type="date"]').setValue(tomorrow());

    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    expect(blockedText(w)).toBe('reading.measuredOnFuture');
  });

  it('reports the date before the value — a date you must fix anyway makes the rest noise', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="date"]').setValue(tomorrow());
    expect(blockedText(w)).toBe('reading.measuredOnFuture');
  });

  it('a SERVER refusal about measuredOn says what it is about, not "try again"', async () => {
    // Still reachable with the field guarded: the client compares against the BROWSER's today, the server
    // against the PLANT's, and across the midnight gap those are different days.
    recordSoilReading.mockRejectedValueOnce(proxiedError(
      400, 'measuredOn must be today or earlier for this plant (its local today is 2026-08-10)',
    ));
    const w = mountModal(makeData({ instruments: [galvanicProbe] }), { mode: 'voluntary' });
    await w.find('input[type="number"]').setValue(5);
    await findSaveButton(w).trigger('click');
    await flushPromises();

    expect(w.text()).toContain('reading.measuredOnFuture');
    expect(w.text()).not.toContain('reading.saveFailed');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// THE REQUEST BODY, PER VERDICT BRANCH, ON A DAY THAT CARRIES A WATERING.
//
// ⚠️ RETRACTED-AND-INVERTED 2026-08-10, and the four cases this replaces are named here with the defect
// they were written for, because their coverage is being removed BY DESIGN and not because they went red:
//   • `WATER_NOW sends it — its verdict is NONE, so the API can derive nothing`
//   • `HOLD sends it`
//   • `UNAVAILABLE carries it through the deferred save the owner may tap much later`
//   • `and NO branch sends it on an ordinary day`
//
// THE DEFECT (QA round 4, 2026-08-10): the survey's three branches build three DIFFERENT create bodies,
// and the WATER_NOW one silently omitted `wateringRelation` — justified by a comment pointing at a real
// API exemption that this branch had stopped qualifying for the day it started writing `verdict: 'NONE'`.
// Nothing broke at the seam: two independently correct pieces stopped meeting, and from the UI the three
// branches are indistinguishable until the 400 arrives. A test asserting only "the save was called" or
// "the verdict rendered" could not tell them apart at all, so those cases asserted the BODY.
//
// THE OWNER'S RULING (2026-08-10) deletes the field instead of sending it: a survey reading is taken NOW,
// so a watering already recorded for today necessarily precedes it, and the API derives that. The lesson
// survives inverted and the method is unchanged — assert the BODY, per branch, on the day the field used
// to be mandatory. If any branch ever starts sending it again, exactly one of these cases goes red, which
// is the property the round-4 suite existed to buy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('no verdict branch sends wateringRelation — the API derives it', () => {
  // ⚠️ `mockReset`, not `mockClear`. `mockClear` wipes recorded CALLS but leaves a queued
  // `mockResolvedValueOnce` in place, so a preview queued by an earlier suite and never consumed is handed
  // to the FIRST case here — which is how the WATER_NOW case once read back `verdict: 'POSTPONE'` and
  // looked like a defect in the code rather than in the harness. Every case here queues its own preview.
  beforeEach(() => {
    previewSoilReading.mockReset();
    recordSoilReading.mockReset();
    recordSoilReading.mockResolvedValue({ readingId: 'r1' });
  });

  /** Run a full survey on a plant already watered TODAY and hand back the body that reached
   *  `recordSoilReading`. */
  async function surveyBodyOnAWateringDay(preview: SoilReadingPreview) {
    previewSoilReading.mockResolvedValueOnce(preview);
    // ⚠️ `todayYmd()`, NOT `PLANT_TODAY`. In survey mode `measuredOn` stays pinned to the BROWSER's day
    // (the field is not rendered), so that is the day `isWateringDay` checks `wateringDays` against —
    // while the WRITE is dated by `preview.measuredOn`, the PLANT's day. Using the plant's day here would
    // make `isWateringDay` false and every assertion below vacuous for the wrong reason: the point is that
    // the field is absent even on a day the modal itself recognises as a watering day.
    const w = mountSurvey(makeData({ instruments: [galvanicProbe], wateringDays: [todayYmd()] }));
    await readingInput(w).setValue(9);
    // The guard that keeps this suite honest, inverted from the round-4 version: the control must NOT be
    // there. If it reappeared, the owner could answer it and these bodies would carry a relation again.
    expect(wateringRelationSeg(w), 'the survey must not ask the same-day question').toBeUndefined();
    // …and the absent question must not be silently gating the button either.
    expect(findCalculateButton(w).attributes('disabled')).toBeUndefined();
    await findCalculateButton(w).trigger('click');
    await flushPromises();
    return { w, body: recordSoilReading.mock.calls.at(-1)?.[1] };
  }

  it('WATER_NOW sends none — the write is still made, just without the field', async () => {
    const { body } = await surveyBodyOnAWateringDay(waterNowPreview);
    expect(body).toBeDefined();
    expect(body!.verdict).toBe('NONE');
    expect(body).not.toHaveProperty('wateringRelation');
  });

  it('HOLD sends none', async () => {
    const { body } = await surveyBodyOnAWateringDay(holdPreview);
    expect(body!.verdict).toBe('POSTPONE');
    expect(body).not.toHaveProperty('wateringRelation');
  });

  it('UNAVAILABLE sends none through the deferred save the owner may tap much later', async () => {
    const { w } = await surveyBodyOnAWateringDay(unavailablePreview);
    // UNAVAILABLE writes nothing on arrival (owner ruling 2026-08-09) — it is OFFERED.
    expect(recordSoilReading).not.toHaveBeenCalled();
    await findSaveButton(w).trigger('click');
    await flushPromises();
    const body = recordSoilReading.mock.calls.at(-1)![1];
    expect(body.verdict).toBe('NONE');
    expect(body).not.toHaveProperty('wateringRelation');
  });

  it('and none of them sends it on an ordinary day either', async () => {
    for (const preview of [waterNowPreview, holdPreview]) {
      recordSoilReading.mockClear();
      previewSoilReading.mockResolvedValueOnce(preview);
      const w = mountSurvey(makeData({ instruments: [galvanicProbe], wateringDays: [] }));
      await readingInput(w).setValue(9);
      expect(wateringRelationSeg(w)).toBeUndefined();
      await findCalculateButton(w).trigger('click');
      await flushPromises();
      const body = recordSoilReading.mock.calls.at(-1)![1];
      expect(body).not.toHaveProperty('wateringRelation');
    }
  });

  // The counter-case, and the boundary of this whole change. Voluntary mode is where the relation is
  // genuinely UNDERIVABLE — care events store a date and no time, so a back-dated reading and a watering
  // on that same past day have no order between them and only the owner knows. A "the client never sends
  // it" fix that reached in here would silently discard the one answer nobody else can supply.
  it('but VOLUNTARY mode still sends it — nobody can derive a back-dated reading\'s order', async () => {
    const w = mountModal(
      makeData({ instruments: [galvanicProbe], wateringDays: [todayYmd()] }), { mode: 'voluntary' },
    );
    await readingInput(w).setValue(5);
    const seg = wateringRelationSeg(w);
    expect(seg, 'voluntary mode must still ask').toBeDefined();
    await seg!.findAll('button')[0]!.trigger('click');   // BEFORE
    await findSaveButton(w).trigger('click');
    await flushPromises();
    expect(recordSoilReading.mock.calls.at(-1)![1].wateringRelation).toBe('BEFORE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// AN UNCALIBRATED INSTRUMENT IS NOT OFFERED, AND THE OWNER IS ROUTED TO CALIBRATE IT
// (owner-ruled 2026-08-10, spec §3.4).
//
// The scale's two per-pot anchors used to be collected HERE, mid-survey. That is circular: one anchor is
// "the pot freshly watered", so supplying it means watering the plant — the very decision the survey has
// not made yet. The primary button stayed disabled until both were filled, so a survey on an uncalibrated
// pot could not be completed AT ALL, and no test caught it because every fixture either already had a
// calibration or used another instrument.
//
// Filtering the instrument out closes that dead end and would open a fresh one — an empty picker — so the
// third empty state is asserted here too, distinct from the "you own no instruments" one it must never
// borrow: the owner already added an instrument, so sending him to Settings would be false AND a dead end.
//
// ⚠️ THE FILTER IS SURVEY-SCOPED, and the two cases below that mount `voluntary` were REWRITTEN on
// 2026-08-10 (review finding F6) to mount `survey` instead. They were not wrong about the filter; they were
// pointed at the wrong mode, and because they passed there, they made a filter that ran in BOTH modes look
// deliberate. The spec says *"an uncalibrated scale is not offered IN THE SURVEY"* (§3.4) and the API says
// *"a missing calibration yields a NULL wetness — the reading is still RECORDED (it is the owner's data)"*
// (`soil-reading.write-core.ts`), so the voluntary path must keep offering it: back-dating a raw weight is
// a capability, and calibrating the pot later makes every stored raw reading interpretable retroactively.
// The mode difference is now pinned in BOTH directions — hidden in the survey, offered in voluntary.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('an uncalibrated instrument is not offered IN A SURVEY', () => {
  // The preceding suite leaves `recordSoilReading` reset to a bare `mockResolvedValue` with its calls
  // still recorded; the last case here counts calls, so start from a clean, working default.
  beforeEach(() => {
    setInstrumentCalibration.mockClear();
    recordSoilReading.mockReset();
    recordSoilReading.mockResolvedValue({ readingId: 'r1' });
  });

  // REWRITTEN 2026-08-10 (finding F6) — was `mode: 'voluntary'`. See the describe header.
  it('filters an uncalibrated scale out of the SURVEY picker but keeps a calibrated one', () => {
    const withUncalibrated = mountSurvey(
      makeData({ instruments: [galvanicProbe, kitchenScaleNoCalibration] }),
    );
    expect(instrumentSegButtons(withUncalibrated)).toHaveLength(1);
    expect(withUncalibrated.text()).not.toContain('settings.instruments.name.kitchen-scale');

    // Same pot, same instruments, one calibration: the scale is a perfectly good choice again. Without
    // this half the filter could be "never offer a scale" and the case above would not notice.
    const withCalibrated = mountSurvey(
      makeData({ instruments: [galvanicProbe, kitchenScaleCalibrated] }),
    );
    expect(instrumentSegButtons(withCalibrated)).toHaveLength(2);
    expect(withCalibrated.text()).toContain('settings.instruments.name.kitchen-scale');
  });

  // REWRITTEN 2026-08-10 (finding F6) — was `mode: 'voluntary'`. See the describe header.
  it('never defaults the SURVEY selection to an instrument it refuses to offer', () => {
    // The uncalibrated scale is FIRST in the list, which is the slot `instrumentId`'s default reads.
    const w = mountSurvey(makeData({ instruments: [kitchenScaleNoCalibration, galvanicProbe] }));
    const buttons = instrumentSegButtons(w);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true');
    expect(buttons[0]!.text()).toBe('settings.instruments.name.galvanic-probe');
  });

  // ---------------------------------------------------------------------------------------------------
  // THE OTHER DIRECTION (review finding F6). The commit that introduced the filter ran it in both modes,
  // which removed a capability the backend preserves on purpose: in voluntary mode a pot whose only
  // instrument was an uncalibrated scale rendered no number field and no date field, so the owner could
  // not record a back-dated raw weight at all. Nothing is computed on this path — the row is stored with a
  // null wetness, honestly — and calibrating the pot later makes those stored weights interpretable.
  // ---------------------------------------------------------------------------------------------------

  it('STILL OFFERS an uncalibrated scale in voluntary mode — a raw reading is the owner\'s data', () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }), { mode: 'voluntary' });
    // Not the survey's empty state: there is a real control here.
    expect(w.text()).not.toContain('reading.calibration.notCalibratedYet');
    const buttons = instrumentSegButtons(w);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.text()).toBe('settings.instruments.name.kitchen-scale');
    // The two fields the filter used to remove: the number and the date.
    expect(w.find('input[type="number"]').exists()).toBe(true);
    expect(w.find('input[type="date"]').exists()).toBe(true);
  });

  it('records that back-dated raw reading, uncalibrated instrument and all', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }), { mode: 'voluntary' });
    await readingInput(w).setValue(1500);
    await w.find('input[type="date"]').setValue('2026-08-01');
    await findSaveButton(w).trigger('click');
    await flushPromises();

    expect(recordSoilReading).toHaveBeenCalledTimes(1);
    const [, body] = recordSoilReading.mock.calls.at(-1)!;
    expect(body.instrumentId).toBe('kitchen-scale');
    expect(body.rawValue).toBe(1500);
    expect(body.measuredOn).toBe('2026-08-01');
    // And no calibration is written on the way — this modal never collects anchors, in either mode.
    expect(setInstrumentCalibration).not.toHaveBeenCalled();
  });

  it('shows the CALIBRATE-THIS-POT state — never the "you own no instruments" one — when the only ' +
    'instrument the owner enabled is an uncalibrated scale', () => {
    const w = mountSurvey(makeData({ instruments: [kitchenScaleNoCalibration] }));
    expect(w.text()).toContain('reading.calibration.notCalibratedYet');
    // The false message. The owner DID add an instrument; telling him to add one in Settings would send
    // him somewhere that cannot help, which is the whole reason these are two separate states.
    expect(w.text()).not.toContain('reading.noInstruments');
    // And no control at all: an empty picker is the trap this state exists to replace.
    expect(w.find('.mp-seg').exists()).toBe(false);
    expect(w.find('input[type="number"]').exists()).toBe(false);
  });

  it('offers a real link to THIS plant\'s page, where calibration lives, and closes on the way', async () => {
    const w = mountSurvey(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const link = w.find('a.nuxt-link');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('reading.calibration.calibrateAction');
    // FINDING F5 — ONE TRANSLATABLE UNIT, not three concatenated fragments. The sentence used to be
    // `<span>{{ t(...) }}</span>{{ ' ' }}<NuxtLink>`, which keys both halves but hard-codes English word
    // order in the template, so no translator could move the link. Asserting the link is INSIDE the
    // `i18n-t` element is what distinguishes the two renderings — both produce the same visible text.
    const sentence = w.find('.i18n-t');
    expect(sentence.exists()).toBe(true);
    expect(sentence.text()).toContain('reading.calibration.notCalibratedYet');
    expect(sentence.find('a.nuxt-link').exists()).toBe(true);
    // The plant page, not /settings: calibration is per (pot, instrument), so it can only be done from a
    // plant. `plantId` comes from this modal's own props.
    expect(link.attributes('href')).toBe('/plants/plant-1');

    await link.trigger('click');
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('still shows the "add one in Settings" state when the owner truly owns nothing', () => {
    const w = mountSurvey(makeData({ instruments: [] }));
    expect(w.text()).toContain('reading.noInstruments');
    expect(w.text()).not.toContain('reading.calibration.notCalibratedYet');
    expect(w.find('a.nuxt-link').attributes('href')).toBe('/settings');
  });

  it('never writes a calibration from this modal — that is setup now, and it happens elsewhere', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }), { mode: 'voluntary' });
    // No anchor fields to type into any more: the reading is the ONLY number on the form.
    expect(w.findAll('input[type="number"]')).toHaveLength(1);
    await readingInput(w).setValue(1500);
    await findSaveButton(w).trigger('click');
    await flushPromises();
    expect(setInstrumentCalibration).not.toHaveBeenCalled();
    expect(recordSoilReading).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// A SELECTION MUST NOT OUTLIVE THE INSTRUMENT IT NAMES (review finding F4, 2026-08-10).
//
// `usableInstruments` is derived from a PROP. It changes under the owner — the plant page refetches after a
// save, /settings is edited in another tab, a calibration is retracted — and `instrumentId` was only ever
// (re)defaulted at setup and on open. MEASURED: with the probe removed from `data` while a survey was open,
// the owner saw the "not calibrated yet" alert AND a footer reading "enter a reading first", pointing at a
// field that was not on screen. A blocking reason describing a state the owner can see is false is exactly
// the class QA round 3's defect 5 was filed for.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('a stale instrument selection never survives the list it came from', () => {
  function blockedText(w: ReturnType<typeof mount>) {
    return w.find('.mp-modal-blocked').exists() ? w.find('.mp-modal-blocked').text() : undefined;
  }
  function calculateButtonExists(w: ReturnType<typeof mount>) {
    return w.findAll('button').some((b) => b.text().includes('reading.calculate'));
  }

  it('leaks no blocking reason when the selected instrument leaves the list mid-survey', async () => {
    const w = mountSurvey(makeData({ instruments: [galvanicProbe, kitchenScaleNoCalibration] }));
    expect(instrumentSegButtons(w)).toHaveLength(1);

    // The probe is withdrawn; the uncalibrated scale is all that is left, and a survey does not offer it.
    await w.setProps({ data: makeData({ instruments: [kitchenScaleNoCalibration] }) });

    expect(w.text()).toContain('reading.calibration.notCalibratedYet');
    // The measured symptom: `reading.missingValue`, an instruction to fill a field that is not rendered.
    expect(blockedText(w)).toBeUndefined();
  });

  it('offers no primary button in EITHER empty state — a dead control is not an explanation', async () => {
    const noneUsable = mountSurvey(makeData({ instruments: [kitchenScaleNoCalibration] }));
    expect(noneUsable.text()).toContain('reading.calibration.notCalibratedYet');
    expect(calculateButtonExists(noneUsable)).toBe(false);
    expect(blockedText(noneUsable)).toBeUndefined();

    const noInstruments = mountSurvey(makeData({ instruments: [] }));
    expect(noInstruments.text()).toContain('reading.noInstruments');
    expect(calculateButtonExists(noInstruments)).toBe(false);
    expect(blockedText(noInstruments)).toBeUndefined();
  });

  it('falls back to a still-usable instrument rather than to nothing', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe, woodenStick] as never }),
      { mode: 'voluntary' });
    await instrumentSegButtons(w)[1]!.trigger('click');
    expect(instrumentSegButtons(w)[1]!.attributes('aria-pressed')).toBe('true');

    // The stick is withdrawn. The probe is still perfectly usable, so the owner lands on it — the same
    // thing the open watcher would have done — instead of on an empty picker.
    await w.setProps({ data: makeData({ instruments: [galvanicProbe] }) });

    const buttons = instrumentSegButtons(w);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.text()).toBe('settings.instruments.name.galvanic-probe');
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true');
    // And the reading taken on the withdrawn instrument goes with it — a number on a scale that is gone.
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEFERRED SAVE ACROSS THE PLANT'S MIDNIGHT (review finding F2, 2026-08-10).
//
// `pending.measuredOn` is frozen at PREVIEW time. "Guardar lectura" is tapped at an arbitrary later moment
// — the component's own comment says "much later" — so if the plant's local day advances in between, the
// write is BACK-DATED, and a `WATER DONE` on that day makes it a 400 naming `wateringRelation`: a
// back-dated reading's side of the watering is genuinely underivable, because care events store a date and
// no time. The removed branch was argued away as "unreachable by construction"; it is narrow, not absent.
//
// The recovery is NOT a reveal (this step renders no measure form, and `showWateringRelation` is
// voluntary-only, so there would be no control to answer through) and NOT a re-date (nobody here knows the
// plant's current day — that is why the preview supplies it — and inventing one would fabricate the
// measurement's date). It is: say the day ended, and ask for a fresh measurement.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the deferred UNAVAILABLE save survives the plant rolling over midnight', () => {
  beforeEach(() => {
    recordSoilReading.mockReset();
    recordSoilReading.mockResolvedValue({ readingId: 'r1' });
  });

  /** Reach the UNAVAILABLE verdict, where the deferred save is offered. */
  async function reachDeferredSave() {
    previewSoilReading.mockResolvedValueOnce(unavailablePreview);
    const w = mountSurvey(makeData({ instruments: [galvanicProbe] }));
    await readingInput(w).setValue(9);
    await findCalculateButton(w).trigger('click');
    await flushPromises();
    expect(recordSoilReading).not.toHaveBeenCalled();
    return w;
  }

  it('says the day ended and asks for a fresh measurement — never "please try again"', async () => {
    const w = await reachDeferredSave();
    recordSoilReading.mockRejectedValueOnce(proxiedError(
      400, 'wateringRelation is required when a WATER DONE exists on measuredOn',
    ));
    await findSaveButton(w).trigger('click');
    await flushPromises();

    expect(w.text()).toContain('reading.dayRolledOver');
    // The old handling. A retry sends a byte-identical body and is refused identically, forever, so
    // "please try again" is advice that can never work.
    expect(w.text()).not.toContain('reading.saveFailed');
  });

  it('still falls back to the generic message for any OTHER failure', async () => {
    const w = await reachDeferredSave();
    recordSoilReading.mockRejectedValueOnce(proxiedError(500, 'upstream exploded'));
    await findSaveButton(w).trigger('click');
    await flushPromises();

    expect(w.text()).toContain('reading.saveFailed');
    expect(w.text()).not.toContain('reading.dayRolledOver');
  });
});
