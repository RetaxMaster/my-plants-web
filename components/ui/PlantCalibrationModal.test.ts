// @vitest-environment happy-dom
//
// MOVED here 2026-08-10 from SoilReadingModal.test.ts. The assertions are unchanged — only their host is.
// The calibration left the measuring modal because demanding it there is CIRCULAR: one anchor is "the pot
// freshly watered", so supplying it means watering the plant, which is the decision the survey has not made
// yet. See docs/superpowers/specs/2026-08-10-the-survey-stops-asking-design.md §1.
//
// That LATER task has landed (commit 338762e): `SoilReadingModal.vue` no longer carries a calibration block
// and no longer carries these cases, so this file is now the ONLY host of the calibration coverage. The
// double coverage the original version of this comment described — deliberate at the time, so the old
// modal's still-live block could not go untested if the removal stalled — is gone with the duplication.
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
  // Mirrors SoilReadingModal.test.ts's own stub for the same "no instruments at all" empty state: `i18n-t`
  // renders the keypath and its named slots so a test can assert both the sentence AND that the slot really
  // is a NuxtLink.
  'i18n-t': {
    props: ['keypath', 'tag'],
    template: '<span class="i18n-t">{{ keypath }}<slot name="settings" /></span>',
  },
  NuxtLink: { props: ['to'], template: '<a class="nuxt-link" :href="to"><slot /></a>' },
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
  return {
    // Far in the past by default (QA round 4, DEF-5), so no pre-existing case trips the new
    // pre-acquisition refusal; the cases that are ABOUT it override it.
    acquiredOn: '2020-01-01',
    instruments: [kitchenScaleCalibrated], protocol, readings: [], wateringDays: [],
    ...overrides,
  };
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
function saveButtonExists(w: ReturnType<typeof mount>) {
  return w.findAll('button').some((b) => b.text().includes('reading.calibration.save'));
}
// The footer's blocked-reason paragraph — `ModalBlockedReason.vue`, rendered REAL (it is imported by the
// component under test, not stubbed), so this reads the sentence the component actually chose.
function blockedText(w: ReturnType<typeof mount>) {
  return w.find('.mp-modal-blocked').exists() ? w.find('.mp-modal-blocked').text() : undefined;
}

// No real row other than the kitchen scale has `requiresCalibration: true` today — `INSTRUMENT_IDS` in the
// shared contract lists exactly one (see soil-instrument-constants.ts). This fixture exists solely to
// exercise the "two or more calibratable instruments enabled" branch, a shape the real catalogue cannot
// produce yet but the component must still handle correctly once it does.
const fakeSecondCalibratableInstrument = {
  ...kitchenScaleCalibrated, id: 'wooden-stick' as const, calibration: { saturatedValue: 3, dryValue: 1 },
};
// Same fabrication, uncalibrated — used where the test cares about switching between two calibratable
// instruments that both START empty, rather than about one of them arriving pre-filled.
const fakeSecondCalibratableInstrumentUncalibrated = {
  ...kitchenScaleNoCalibration, id: 'wooden-stick' as const,
};

describe('PlantCalibrationModal', () => {
  // -----------------------------------------------------------------------------------------------------
  // Finding A (spec review of commit b988f96) — the picker used to be built from EVERY enabled instrument,
  // with no filter, so a non-calibratable one (the probe, the stick, the finger) could be selected on this
  // calibration-SETUP screen and land on a dead end: no fields, no alert, no explanation, Save permanently
  // disabled. Fixed by building every list from `requiresCalibration` instruments only, and by skipping the
  // picker entirely when there is only one such instrument to choose from — a one-segment control is noise.
  // -----------------------------------------------------------------------------------------------------

  it('shows the NONE-CALIBRATABLE empty-state alert (never the "add an instrument" one) when an ' +
    'instrument is enabled but none of them needs calibration (finding A; corrected 2026-08-10, review of ' +
    'commit b988f96\'s retarget — the owner here already has an instrument, so sending them to Settings ' +
    'again would be false and pointless)', () => {
    const w = mountModal(makeData({ instruments: [galvanicProbe] }));
    expect(w.text()).toContain('reading.calibration.noneCalibratable');
    expect(w.text()).not.toContain('reading.noInstruments');
    expect(w.find('.mp-seg').exists()).toBe(false);
    expect(w.find('.mp-calib').exists()).toBe(false);
  });

  // -----------------------------------------------------------------------------------------------------
  // Corrected 2026-08-10 (review of commit b988f96) — the retarget above reused `reading.noInstruments` for
  // BOTH "no instruments enabled at all" and "instruments enabled, none calibratable", which made the first
  // (true) message fire for the second (false) case. The two are now separate branches with separate keys;
  // this block covers the ORIGINAL case, the one `reading.noInstruments` is actually true for.
  // -----------------------------------------------------------------------------------------------------

  it('shows the "add an instrument" empty state, with a real Settings link, when NO instrument is ' +
    'enabled at all', () => {
    const w = mountModal(makeData({ instruments: [] }));
    expect(w.text()).toContain('reading.noInstruments');
    expect(w.text()).not.toContain('reading.calibration.noneCalibratable');
    const link = w.find('a.nuxt-link');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('/settings');
    expect(w.find('.mp-seg').exists()).toBe(false);
    expect(w.find('.mp-calib').exists()).toBe(false);
  });

  it('closes the modal when the Settings link is followed', async () => {
    const w = mountModal(makeData({ instruments: [] }));
    await w.find('a.nuxt-link').trigger('click');
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('never offers the moisture probe on a pot with a kitchen scale AND a probe enabled — a ' +
    'non-calibratable instrument has no place on a calibration-setup screen (finding A)', () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleCalibrated, galvanicProbe] }));
    // Exactly one CALIBRATABLE instrument is enabled (the scale), so the picker never renders at all —
    // the owner goes straight to its fields, and the probe is never a choice in the first place.
    expect(w.find('.mp-seg').exists()).toBe(false);
    expect(w.find('.mp-calib').exists()).toBe(true);
    expect(w.text()).not.toContain('settings.instruments.name.galvanic-probe');
  });

  it('keeps the picker when two or more calibratable instruments are enabled, and still excludes ' +
    'the probe (finding A)', () => {
    const w = mountModal(makeData({
      instruments: [kitchenScaleCalibrated, fakeSecondCalibratableInstrument, galvanicProbe] as never,
    }));
    expect(instrumentSegButtons(w)).toHaveLength(2);
    expect(w.text()).not.toContain('settings.instruments.name.galvanic-probe');
  });

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
    // Finding F7: this used to assert the error element merely EXISTS, which passes for any sentence at all
    // — including the wrong one. `reading.calibration.spanInvalid` had no assertion anywhere in the repo,
    // so the copy that tells the owner which of the two weights is wrong was unguarded.
    expect(w.find('.mp-calib__err').text()).toBe('reading.calibration.spanInvalid');

    await saturatedInput!.setValue(1850);
    await dryInput!.setValue(1200);
    expect(w.find('.mp-calib__err').exists()).toBe(false);
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });

  // MOVED here 2026-08-10 (finding B, spec review of commit b988f96) from SoilReadingModal.test.ts, where
  // it guarded a QA-round-3 fix: a calibrated pot must still show its own (prefilled) fields, not just an
  // uncalibrated one. The first two sub-cases are unchanged. The third is REBASED: the original mounted a
  // non-calibratable-only fixture (the probe alone) to prove fields hide for it, but finding A now filters
  // the probe out of the picker entirely, so "select the probe and see no fields" is not a reachable path
  // any more — mounting probe-only now lands on the EMPTY-STATE alert instead (a different property, its
  // own test above), not on "fields hidden for the selected instrument". The isolation property this case
  // exists for — an instrument with `requiresCalibration: false` never earns the fields, even sitting
  // alongside a calibratable one — is proven instead by mounting both together and confirming the probe
  // never reaches the screen at all, neither as a field nor as a picker segment.
  it('shows the calibration fields whenever the instrument USES one — calibrated pot included', () => {
    const uncalibrated = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    expect(uncalibrated.find('.mp-calib').exists()).toBe(true);

    const calibrated = mountModal(makeData({ instruments: [kitchenScaleCalibrated] }));
    expect(calibrated.find('.mp-calib').exists()).toBe(true);

    const withNonCalibratable = mountModal(makeData({ instruments: [kitchenScaleCalibrated, galvanicProbe] }));
    expect(withNonCalibratable.find('.mp-calib').exists()).toBe(true);
    expect(withNonCalibratable.text()).not.toContain('settings.instruments.name.galvanic-probe');
  });

  // MOVED here 2026-08-10 (finding B) from SoilReadingModal.test.ts, where it guarded a fix-wave-1 reopen
  // bug: the same modal instance, closed and reopened without re-mounting, must forget the anchors the
  // owner typed but never saved — otherwise a value abandoned on one instrument silently reappears. No
  // plumbing trimmed: this modal never had a reading value or a `recordSoilReading` call to strip.
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

  // REBASED 2026-08-10 (finding A): originally mounted with `[kitchenScaleNoCalibration, galvanicProbe]`
  // and switched TO the probe to prove its fields stay hidden — but the probe is never offered by the
  // picker any more (it isn't calibratable), so that path no longer exists. Rebased onto two calibratable
  // fixtures so the property under test — switching instruments must never carry one instrument's
  // typed-but-unsaved anchors onto another's scale — is proven the same way it always was: type into one,
  // switch away, switch back, confirm nothing leaked.
  it('clears calibration anchors too — they describe one instrument on one pot', async () => {
    const w = mountModal(makeData({
      instruments: [kitchenScaleNoCalibration, fakeSecondCalibratableInstrumentUncalibrated] as never,
    }));
    const anchors = w.findAll('input[type="number"]');
    await anchors[0]!.setValue(1850);
    await anchors[1]!.setValue(1200);
    // Switching instruments must never carry one instrument's typed-but-unsaved anchors onto another's
    // scale; switching back to the first must show it empty again, never carrying the abandoned numbers.
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

  // -----------------------------------------------------------------------------------------------------
  // REINSTATED 2026-08-10 (review finding F1) — QA's UX-2, on the surface that inherited the fields.
  //
  // Two cases were deleted from `SoilReadingModal.test.ts` in commit 338762e — `says WHY the primary action
  // is unavailable instead of dying silently` and `still says the weights are missing when they genuinely
  // are` — on the stated grounds that the assertion had "moved to PlantCalibrationModal". It had not:
  // nothing here rendered a reason, `reading.missingCalibration` had zero readers repo-wide, and an
  // uncalibrated pot showed the owner four strings (title, explanation, Cancel, a dead Save). These are
  // those two cases, plus the counter-case defect 5 was filed for and the bound case the ordering protects.
  // -----------------------------------------------------------------------------------------------------

  it('says WHY Save is unavailable instead of dying silently — both weights empty', () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    expect(blockedText(w)).toBe('reading.missingCalibration');
  });

  it('still says the weights are missing when only ONE of them is filled', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const [saturatedInput] = w.findAll('.mp-calib input');
    await saturatedInput!.setValue(1850);
    expect(findSaveButton(w).attributes('disabled')).toBeDefined();
    expect(blockedText(w)).toBe('reading.missingCalibration');
  });

  it('says the span is INVERTED, not that the weights are missing, when both are filled', async () => {
    // QA round 3, defect 5: an inverted pair was stated correctly ON the field while the footer said "fill
    // in both reference weights first" about two boxes the owner was looking at. A blocking reason
    // describing a state the owner can see is false.
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const [saturatedInput, dryInput] = w.findAll('.mp-calib input');
    await saturatedInput!.setValue(800);
    await dryInput!.setValue(1500);
    expect(blockedText(w)).toBe('reading.calibration.spanInvalid');
    expect(blockedText(w)).not.toBe('reading.missingCalibration');
  });

  it('names the BOUND fault, not the span one, in the footer too — the same sentence the field shows',
    async () => {
      const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
      const [saturatedInput, dryInput] = w.findAll('.mp-calib input');
      // BOTH faults are genuinely true for this pair — `-500` is below the scale's floor AND the span is
      // inverted — which is what makes this a test of the ORDERING rather than of one condition wearing an
      // ordering's name. A negative weight is the more basic fault and the one the owner can act on.
      await saturatedInput!.setValue(-500);
      await dryInput!.setValue(1200);
      // One sentence in two places. Two DIFFERENT wordings for one fault is what reads as two faults, so
      // this asserts they are identical rather than merely both present.
      expect(w.find('.mp-calib__err').text()).toBe('reading.calibration.belowMin|0');
      expect(blockedText(w)).toBe('reading.calibration.belowMin|0');
    });

  it('says nothing at all once the anchors are savable', async () => {
    const w = mountModal(makeData({ instruments: [kitchenScaleNoCalibration] }));
    const [saturatedInput, dryInput] = w.findAll('.mp-calib input');
    await saturatedInput!.setValue(1850);
    await dryInput!.setValue(1200);
    expect(blockedText(w)).toBeUndefined();
    expect(findSaveButton(w).attributes('disabled')).toBeUndefined();
  });

  it('offers no Save at all in either empty state — a dead button beside an alert is the same mute end',
    () => {
      const noInstruments = mountModal(makeData({ instruments: [] }));
      expect(saveButtonExists(noInstruments)).toBe(false);
      expect(blockedText(noInstruments)).toBeUndefined();

      const noneCalibratable = mountModal(makeData({ instruments: [galvanicProbe] }));
      expect(saveButtonExists(noneCalibratable)).toBe(false);
      expect(blockedText(noneCalibratable)).toBeUndefined();
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
