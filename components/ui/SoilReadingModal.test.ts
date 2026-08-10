// @vitest-environment happy-dom
//
// Harness mirrors components/ui/RepotDoneForm.test.ts: Vue's own reactivity primitives and the bare Nuxt
// auto-imports (`useI18n`/`useApi`) are stubbed as globals, because outside Nuxt's build pipeline (plain
// vitest + @vue/test-utils, no auto-import shim) they don't exist. Modal/Button/FormGroup/AppIcon are
// stubbed to plain passthroughs (their own behavior is irrelevant here); Input/SegmentedControl/Alert/
// InstrumentCalibrationFields are left REAL so their actual rendered markup — disabled state, option
// count, alert text — can be asserted, the same choice `stubsWithRealInputs()` makes in RepotDoneForm's
// own test file.
//
// 2026-08-09 redesign ("the modal answers the question instead of asking three of ours"): every test below
// now mounts with an EXPLICIT `mode`, never relying on the component's own default — see `mountModal`'s own
// comment for why that matters for the mutation proofs this file's spec calls for.
import { describe, it, expect, vi, afterEach } from 'vitest';
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
  'i18n-t': {
    props: ['keypath', 'tag'],
    template: '<span class="i18n-t">{{ keypath }}<slot name="settings" /></span>',
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
function rawValueError(w: ReturnType<typeof mount>) {
  const group = w.findAllComponents({ name: 'FormGroup' })
    .find((g) => String(g.props('label')).startsWith('reading.value|'));
  return group?.props('error');
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

  it('offers every selected instrument, one segment each', () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe, kitchenScaleNoCalibration] }));
    expect(instrumentSegButtons(w)).toHaveLength(2);
  });

  it('shows the calibration fields only when the chosen instrument needs one AND the pot has none', async () => {
    const uncalibrated = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    expect(uncalibrated.find('.mp-calib').exists()).toBe(true);

    const calibrated = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    expect(calibrated.find('.mp-calib').exists()).toBe(false);

    // An instrument that never needs calibration (the probe) never shows the fields either.
    const noCalibNeeded = mountModal(makeData({ instruments: [galvanicProbe] }));
    expect(noCalibNeeded.find('.mp-calib').exists()).toBe(false);
  });

  it('blocks submit until the calibration span is strictly positive', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const [saturatedInput, dryInput] = w.findAll('.mp-calib input');
    // The calibration fields render BEFORE the reading-value field, so the last `input[type="number"]`
    // (never the first) is the raw reading — filling it keeps this assertion scoped to the calibration
    // span alone, so only calibration gates the button below, not an empty reading value.
    const numberInputs = w.findAll('input[type="number"]');
    await numberInputs[numberInputs.length - 1]!.setValue(500);

    await saturatedInput!.setValue(1200);
    await dryInput!.setValue(1200);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    expect(w.find('.mp-calib__err').exists()).toBe(true);

    await saturatedInput!.setValue(1850);
    await dryInput!.setValue(1200);
    expect(w.find('.mp-calib__err').exists()).toBe(false);
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });

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
      await w.find('input[type="number"]').setValue(-50);
      expect(findSaveButton(w).attributes('disabled')).toBeDefined();
      expect(rawValueError(w)).toBe('reading.valueBelowMin|0');
    });

    it('accepts an arbitrarily large weight — grams genuinely have no ceiling', async () => {
      const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
      await w.find('input[type="number"]').setValue(1_000_000);
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

  // Fix wave 1, item 1a/1c: the reopen-reset watcher's own comment claimed it reset "EVERY field a
  // previous session could have left stale" while silently leaving the calibration anchors
  // (`saturatedValue`/`dryValue`) untouched. The API's own comment records that a REPOT invalidates a
  // calibration — anchors typed for the OLD pot and abandoned without saving must never sit pre-filled,
  // one tap from being written as the NEW pot's anchors.
  it('resets the calibration anchors too on close/reopen (fix wave 1, item 1a)', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const [saturatedInput, dryInput] = w.findAll('.mp-calib input');
    await saturatedInput!.setValue(1850);
    await dryInput!.setValue(1200);
    expect((saturatedInput!.element as HTMLInputElement).value).toBe('1850');
    expect((dryInput!.element as HTMLInputElement).value).toBe('1200');

    // Close, then reopen — the same modal instance a page reuse never re-mounts.
    await w.setProps({ open: false });
    await w.setProps({ open: true });

    const [saturatedAfter, dryAfter] = w.findAll('.mp-calib input');
    expect((saturatedAfter!.element as HTMLInputElement).value).toBe('');
    expect((dryAfter!.element as HTMLInputElement).value).toBe('');
  });

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
    const input = w.find('input[type="number"]');
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
  it('shows the question ONLY when measuredOn is a watering day', () => {
    const onWateringDay = mountModal(makeData({ wateringDays: [todayYmd()] }), { mode: 'voluntary' });
    expect(wateringRelationSeg(onWateringDay)).toBeTruthy();

    const notWateringDay = mountModal(makeData({ wateringDays: [] }), { mode: 'voluntary' });
    expect(wateringRelationSeg(notWateringDay)).toBeUndefined();
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

  it('never renders the watering-relation control, even on a watering day — impossible by construction', () => {
    const w = mountSurvey(makeData({ instruments: [galvanicProbe], wateringDays: [todayYmd()] }));
    expect(wateringRelationSeg(w)).toBeUndefined();
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
    recordSoilReading.mockRejectedValueOnce({
      statusCode: 400,
      data: { message: 'wateringRelation is required: this plant was already watered on measuredOn' },
    });
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

  it('a 400 about anything ELSE keeps the generic message and does NOT reveal the question', async () => {
    recordSoilReading.mockRejectedValueOnce({ statusCode: 400, data: { message: 'rawValue must be finite' } });
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
