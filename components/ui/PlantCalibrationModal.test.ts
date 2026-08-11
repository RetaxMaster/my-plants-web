// @vitest-environment happy-dom
//
// MOVED here 2026-08-10 from SoilReadingModal.test.ts. The assertions are unchanged — only their host is.
// The calibration left the measuring modal because demanding it there is CIRCULAR: one anchor is "the pot
// freshly watered", so supplying it means watering the plant, which is the decision the survey has not made
// yet. See docs/superpowers/specs/2026-08-10-the-survey-stops-asking-design.md §1.
//
// `SoilReadingModal.vue` still carries the same calibration block and the same test cases at the moment this
// file lands — a LATER task removes both together. Until then the coverage exists in two places on purpose:
// removing it from the old host here, ahead of that task, would leave live code (the old modal's calibration
// block) untested if that later task stalled.
//
// Harness mirrors SoilReadingModal.test.ts: Vue's own reactivity primitives and the bare Nuxt auto-imports
// (`useI18n`/`useApi`) are stubbed as globals, because outside Nuxt's build pipeline they don't exist.
// Modal/Button/FormGroup/AppIcon are stubbed to plain passthroughs; Input/SegmentedControl/Alert/
// InstrumentCalibrationFields are left REAL so their actual rendered markup can be asserted.
import { describe, it, expect, vi } from 'vitest';
import { ref, reactive, computed, watch, inject } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import PlantCalibrationModal from './PlantCalibrationModal.vue';
import type { PlantSoilReadings } from '~/types/api';

vi.stubGlobal('ref', ref);
vi.stubGlobal('reactive', reactive);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
// Needed because SegmentedControl.vue is left REAL and calls Vue's `inject()` directly for FormGroup's
// field-id wiring — same requirement SoilReadingModal.test.ts documents. FormGroup itself IS stubbed below
// (a plain passthrough that never calls `provide()`), so the injected value resolves to its declared default.
vi.stubGlobal('inject', inject);
vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) =>
    (params ? `${k}|${Object.values(params).join('|')}` : k),
}));

const setInstrumentCalibration = vi.fn(() => Promise.resolve({ saturatedValue: 1850, dryValue: 1200 }));
vi.stubGlobal('useApi', () => ({ setInstrumentCalibration }));

const stubs = {
  Modal: {
    props: ['modelValue', 'title'],
    template: '<div data-modal-stub v-if="modelValue"><slot /><slot name="footer" /></div>',
  },
  Button: { props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
  FormGroup: {
    name: 'FormGroup',
    props: ['label', 'hint', 'error', 'required'],
    template: '<div><slot /></div>',
  },
  AppIcon: true,
};

const galvanicProbe = {
  id: 'galvanic-probe' as const, kind: 'moisture' as const, unit: '1–10 index', scale: 'galvanic-1-10',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: false,
  protocolKind: 'insertion' as const,
  captureKind: 'numeric' as const,
  rawMin: 1, rawMax: 10, rawStep: 1, calibration: null,
};
const kitchenScaleNoCalibration = {
  id: 'kitchen-scale' as const, kind: 'moisture' as const, unit: 'grams', scale: 'kitchen-scale-grams',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: true,
  protocolKind: 'whole-pot-mass' as const,
  captureKind: 'numeric' as const,
  rawMin: 0, rawMax: null, rawStep: 1, calibration: null,
};
const kitchenScaleCalibrated = {
  ...kitchenScaleNoCalibration, calibration: { saturatedValue: 1850, dryValue: 1200 },
};
const protocol = { potSizeCm: 20, insertionDepthCm: 7, distanceFromCentreCm: 3 };

function makeData(overrides: Partial<PlantSoilReadings> = {}): PlantSoilReadings {
  return { instruments: [kitchenScaleCalibrated], protocol, readings: [], wateringDays: [], ...overrides };
}

function mountModal(data: PlantSoilReadings) {
  return mount(PlantCalibrationModal, {
    props: { open: true, plantId: 'plant-1', data },
    global: { mocks: { $t: (k: string) => k }, stubs },
  });
}

function instrumentSegButtons(w: ReturnType<typeof mount>) {
  return w.findAll('.mp-seg')[0]!.findAll('button');
}
function pickInstrument(w: ReturnType<typeof mount>, index: number) {
  return instrumentSegButtons(w)[index]!.trigger('click');
}
function findSaveButton(w: ReturnType<typeof mount>) {
  return w.findAll('button').find((b) => b.text().includes('reading.calibration.save'))!;
}

describe('PlantCalibrationModal', () => {
  it('PREFILLS the stored anchors, so the owner sees what this pot is actually calibrated to', () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    const [saturatedInput, dryInput] = w.findAll('.mp-calib input');
    expect((saturatedInput!.element as HTMLInputElement).value).toBe('1850');
    expect((dryInput!.element as HTMLInputElement).value).toBe('1200');
  });

  it('does NOT re-PUT a calibration the owner never touched', async () => {
    // The API treats an anchor MOVE as a retraction of every fraction those anchors produced. Re-sending
    // identical numbers whenever the owner opens the dialog and presses Save would hand it a decision it
    // should never have to make.
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    await findSaveButton(w).trigger('click');
    await flushPromises();
    expect(setInstrumentCalibration).not.toHaveBeenCalled();
  });

  it('DOES PUT a corrected calibration — an edit nobody sent is an edit that did not happen', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    const [saturatedInput] = w.findAll('.mp-calib input');
    await saturatedInput!.setValue(1900);
    await findSaveButton(w).trigger('click');
    await flushPromises();
    expect(setInstrumentCalibration).toHaveBeenCalledWith('plant-1', 'kitchen-scale', {
      saturatedValue: 1900, dryValue: 1200,
    });
  });

  // The client half of the shared contract's `instrumentCalibrationSchemaFor`. QA (round 3, on the old
  // host) typed `-500` into the dry-weight box and the API stored it with a 200; from then on a real
  // 1000 g reading on that pot reported 60 % wet. The span rule could never catch it — `2000 > -500` is
  // perfectly true.
  it('refuses an anchor that is off the instrument\'s own scale, span or no span', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const [saturatedInput, dryInput] = w.findAll('.mp-calib input');
    await saturatedInput!.setValue(2000);
    await dryInput!.setValue(-500);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    // Named as the bound problem it is, not as the span problem it is not.
    expect(w.find('.mp-calib__err').text()).toBe('reading.calibration.belowMin|0');
  });

  it('blocks submit until the calibration span is strictly positive', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const [saturatedInput, dryInput] = w.findAll('.mp-calib input');

    await saturatedInput!.setValue(1200);
    await dryInput!.setValue(1200);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    expect(w.find('.mp-calib__err').exists()).toBe(true);

    await saturatedInput!.setValue(1850);
    await dryInput!.setValue(1200);
    expect(w.find('.mp-calib__err').exists()).toBe(false);
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });

  it('clears calibration anchors too — they describe one instrument on one pot', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration, galvanicProbe] as never }));
    const anchors = w.findAll('input[type="number"]');
    await anchors[0]!.setValue(1850);
    await anchors[1]!.setValue(1200);
    // The probe needs no calibration, so switching to it hides `.mp-calib` entirely; switching back to the
    // scale must show it empty again, never carrying the abandoned numbers.
    await pickInstrument(w, 1);
    await pickInstrument(w, 0);

    const after = w.findAll('input[type="number"]');
    expect((after[0]!.element as HTMLInputElement).value).toBe('');
    expect((after[1]!.element as HTMLInputElement).value).toBe('');
  });

  // ---------------------------------------------------------------------------------------------------
  // New coverage — the old host could not exercise either of these, because neither surface existed there:
  // the old modal never explained the two-weighing protocol on its own terms (the fields sat inside a
  // decision the owner was mid-way through making), and it never had a save action independent of writing
  // a reading.
  // ---------------------------------------------------------------------------------------------------

  it('explains the two weighings, so the owner knows both can happen the same day', () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    expect(w.text()).toContain('reading.calibration.how');
  });

  it('saving emits so the page can refresh', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    const [saturatedInput] = w.findAll('.mp-calib input');
    await saturatedInput!.setValue(1900);
    await findSaveButton(w).trigger('click');
    await flushPromises();
    expect(w.emitted('saved')).toBeTruthy();
  });
});
