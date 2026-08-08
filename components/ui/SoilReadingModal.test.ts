// @vitest-environment happy-dom
//
// Harness mirrors components/ui/RepotDoneForm.test.ts: Vue's own reactivity primitives and the bare Nuxt
// auto-imports (`useI18n`/`useApi`) are stubbed as globals, because outside Nuxt's build pipeline (plain
// vitest + @vue/test-utils, no auto-import shim) they don't exist. Modal/Button/FormGroup/AppIcon are
// stubbed to plain passthroughs (their own behavior is irrelevant here); Input/SegmentedControl/Alert/
// InstrumentCalibrationFields are left REAL so their actual rendered markup — disabled state, option
// count, alert text — can be asserted, the same choice `stubsWithRealInputs()` makes in RepotDoneForm's
// own test file.
import { describe, it, expect, vi } from 'vitest';
import { ref, reactive, computed, watch, inject } from 'vue';
import { mount } from '@vue/test-utils';
import SoilReadingModal from './SoilReadingModal.vue';
import type { PlantSoilReadings } from '~/types/api';
import { todayYmd } from '../../utils/localDate.js';

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
vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) =>
    (params ? `${k}|${Object.values(params).join('|')}` : k),
}));

const recordSoilReading = vi.fn(() => Promise.resolve({ readingId: 'r1' }));
const setInstrumentCalibration = vi.fn(() => Promise.resolve({ saturatedValue: 1850, dryValue: 1200 }));
vi.stubGlobal('useApi', () => ({ recordSoilReading, setInstrumentCalibration }));

const stubs = {
  // `data-modal-stub` names the rendered panel, same hook RepotDoneForm.test.ts / RepotEvaluationModal.
  // test.ts use — not needed by any assertion below, kept for consistency with the sibling harnesses.
  Modal: {
    props: ['modelValue', 'title'],
    template: '<div data-modal-stub v-if="modelValue"><slot /><slot name="footer" /></div>',
  },
  Button: { props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
  FormGroup: { props: ['label', 'hint'], template: '<div><slot /></div>' },
  AppIcon: true, // Alert.vue's own icon dependency; irrelevant to every assertion here.
};

const galvanicProbe = {
  id: 'galvanic-probe' as const, kind: 'moisture' as const, unit: '1–10 index', scale: 'galvanic-1-10',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: false,
  rawMin: 1, rawMax: 10, rawStep: 1, calibration: null,
};
const kitchenScaleNoCalibration = {
  id: 'kitchen-scale' as const, kind: 'moisture' as const, unit: 'grams', scale: 'kitchen-scale-grams',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: true,
  rawMin: 0, rawMax: null, rawStep: 1, calibration: null,
};
const kitchenScaleCalibrated = {
  ...kitchenScaleNoCalibration, calibration: { saturatedValue: 1850, dryValue: 1200 },
};

const protocol = { potSizeCm: 20, insertionDepthCm: 7, distanceFromCentreCm: 3 };

function makeData(overrides: Partial<PlantSoilReadings> = {}): PlantSoilReadings {
  return { instruments: [galvanicProbe], protocol, readings: [], ...overrides };
}

function mountModal(data: PlantSoilReadings) {
  return mount(SoilReadingModal, {
    props: { open: true, plantId: 'plant-1', data },
    global: { mocks: { $t: (k: string) => k }, stubs },
  });
}

// The instrument picker is always the FIRST `.mp-seg` in the DOM — the verdict picker (always 3 options)
// renders after it, so scoping to index 0 is what keeps this assertion from accidentally counting the
// verdict control's buttons instead.
function instrumentSegButtons(w: ReturnType<typeof mount>) {
  return w.findAll('.mp-seg')[0]!.findAll('button');
}
function verdictSegButtons(w: ReturnType<typeof mount>) {
  return w.findAll('.mp-seg')[1]!.findAll('button');
}
function findSaveButton(w: ReturnType<typeof mount>) {
  return w.findAll('button').find((b) => b.text().includes('reading.save'))!;
}

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

  it('requires a postpone date only for the POSTPONE verdict', async () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }));
    await w.find('input[type="number"]').setValue(5); // a valid raw reading, so only the verdict gates it

    // WATER_NOW (index 2): no postpone date needed.
    await verdictSegButtons(w)[2]!.trigger('click');
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();

    // POSTPONE (index 1): blocked until a date is chosen.
    await verdictSegButtons(w)[1]!.trigger('click');
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();

    const dateInputs = w.findAll('input[type="date"]');
    // The postpone date field only renders once the POSTPONE verdict is active — the last date input.
    await dateInputs[dateInputs.length - 1]!.setValue('2026-08-15');
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });

  it('caps the measured date at today — a reading in the future is not a measurement', () => {
    const w = mountModal(makeData());
    // Uses the app's own `~/utils/localDate` helper for the expected value — NOT a second, independent
    // `new Date().toLocaleDateString('en-CA')` of its own — so this test can actually catch the component
    // reintroducing that exact fork (level-1 integration review finding 3): a duplicated expression here
    // would agree with a duplicated bug in the component and never go red.
    const measuredOnInput = w.findAll('input[type="date"]')[0]!;
    expect(measuredOnInput.attributes('max')).toBe(todayYmd());
  });

  // Level-1 integration review finding 2: the modal is mounted once for the page's life (PlantDetail.vue,
  // no `:key`), and its reopen-watch resets idempotencyKey/error/rawValue/verdict but used to leave
  // `measuredOn` untouched — so logging a back-dated reading, closing the modal, and reopening it to log
  // TODAY's reading showed the stale date, silently recording the new reading under the wrong day. Two
  // readings on the same date is a zero-span pair that corrupts the drying-rate slope fit.
  it('resets measuredOn back to today when the modal is closed and reopened, even after a back-dated reading', async () => {
    const w = mountModal(makeData());
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
      props: { open: false, plantId: 'plant-1', data: makeData({ instruments: [] }) },
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
