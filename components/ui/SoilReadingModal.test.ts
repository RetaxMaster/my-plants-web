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
    const todayYmd = new Date().toLocaleDateString('en-CA');
    const measuredOnInput = w.findAll('input[type="date"]')[0]!;
    expect(measuredOnInput.attributes('max')).toBe(todayYmd);
  });
});
