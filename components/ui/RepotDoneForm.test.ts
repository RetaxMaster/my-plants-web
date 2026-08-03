// @vitest-environment happy-dom
//
// Same round-2 F2 fix as RepotEvaluationModal.test.ts: `onRepotDoneConfirm` also deliberately keeps THIS
// modal open on failure, so the page-level banner in `pages/index.vue` rendered invisibly behind it. This
// proves the new `error` prop actually renders a `role="alert"` element (the real Alert.vue, only its
// AppIcon dependency stubbed) inside this modal's own body.
import { describe, it, expect, vi } from 'vitest';
import { ref, computed, watch, inject } from 'vue';
import { mount } from '@vue/test-utils';
import RepotDoneForm from './RepotDoneForm.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
// Needed by the new frozen-state tests below, which mount the REAL Input/SelectField (not stubbed) to
// assert their actual `disabled` attribute — both call Vue's `inject()` for FormGroup's field-id wiring.
vi.stubGlobal('inject', inject);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
// Auto-imported in RepotDoneForm.vue (no explicit import, same convention TaskRow.test.ts documents for
// useTaskMeta) — stubbed here with two fixed options (the error-rendering assertions only ever need
// 'potting-mix', still first so `soilMixOptions.value[0]` stays unchanged for them; 'cactus-mix' is needed by
// the W3 frozenSnapshot tests below, which hydrate a DIFFERENT plant's snapshot to prove the real <select>
// reflects the prop, not a hardcoded default).
vi.stubGlobal('useProfileMeta', () => ({
  soilMixOptions: computed(() => [
    { value: 'potting-mix', label: 'Potting mix' },
    { value: 'cactus-mix', label: 'Cactus mix' },
  ]),
}));

// Real Modal/Button/FormGroup/AppIcon stubbed, but Input/SelectField/SegmentedControl left REAL so their
// actual `disabled` attribute (and, below, their actual rendered value) can be asserted — used by both the
// frozen-disabling suite and the W3 hydration suite below (module scope: no closure over either describe
// block's own state, so hoisting it here is a plain dedup, not a fork).
function stubsWithRealInputs() {
  return {
    Modal: {
      props: ['modelValue', 'title'],
      template: '<div data-modal-stub v-if="modelValue"><slot /><slot name="footer" /></div>',
    },
    Button: {
      props: ['disabled', 'icon', 'loading'],
      template: '<button :disabled="disabled"><slot /></button>',
    },
    // `error` is rendered (via a stable `.fg-error` hook), unlike the plain `stubs` map's FormGroup below —
    // FIX C4's inline pot-size validation message needs somewhere to actually show up in the DOM.
    FormGroup: {
      props: ['label', 'hint', 'error'],
      template: '<div><slot /><span v-if="error" class="fg-error">{{ error }}</span></div>',
    },
    AppIcon: true,
  };
}

const stubs = {
  // `data-modal-stub` is a stable hook naming THIS element as the Modal's own rendered panel, distinct from
  // the component's outer (possibly multi-root/fragment) template — the containment assertion below needs
  // a concrete node to check against, not "is it anywhere in the mounted tree".
  Modal: {
    props: ['modelValue', 'title'],
    template: '<div data-modal-stub v-if="modelValue"><slot /><slot name="footer" /></div>',
  },
  Button: { props: ['disabled', 'icon', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
  FormGroup: { props: ['label', 'hint'], template: '<div><slot /></div>' },
  Input: true,
  SelectField: true,
  SegmentedControl: true,
  AppIcon: true, // Alert.vue's own icon dependency; irrelevant to this assertion.
};

function mountForm(props: Record<string, unknown> = {}) {
  return mount(RepotDoneForm, {
    props: { open: true, currentPotSizeCm: null, currentSoilMix: null, ...props },
    global: { mocks: { $t: (k: string) => k }, stubs },
  });
}

describe('RepotDoneForm — the error prop renders INSIDE the modal body (round-2 F2 fix)', () => {
  it('renders no alert when error is absent', () => {
    const w = mountForm();
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('renders no alert when error is explicitly null', () => {
    const w = mountForm({ error: null });
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('renders the message via a role="alert" element when error is set, INSIDE the modal body', () => {
    const w = mountForm({ error: 'Something went wrong. Please try again.' });
    const alert = w.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Something went wrong. Please try again.');
    // Containment, not mere existence (round-3 review): asserting only `exists()` also passes if the alert
    // were rendered as a SIBLING outside <Modal>, which is exactly the regression F2 fixed. The modal stub
    // marks its own rendered panel with `data-modal-stub`; the alert must be a genuine DOM descendant of it.
    const modalPanel = w.find('[data-modal-stub]');
    expect(modalPanel.exists()).toBe(true);
    expect(modalPanel.element.contains(alert.element)).toBe(true);
  });
});

// Code review finding Y2: this form had the exact idempotency defect already fixed on
// RepotEvaluationModal.vue — a retry after a failure could resend the SAME idempotency key with a
// DIFFERENT body (an edited pot size/soil mix/substrate answer), which the server's global idempotency
// interceptor answers 422 forever. The fix reuses RepotEvaluationModal's own `frozen` prop + "start over"
// pattern verbatim (never a second mechanism) — these tests mirror RepotEvaluationModal.test.ts's V12 suite.
describe('RepotDoneForm — frozen while an idempotency key is outstanding (code review finding Y2)', () => {

  it('disables pot size, soil mix and the substrate toggle while frozen', () => {
    const w = mount(RepotDoneForm, {
      props: { open: true, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: true },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    expect(w.find('input[type="number"]').attributes('disabled')).toBeDefined();
    expect(w.find('select').attributes('disabled')).toBeDefined();
    for (const btn of w.findAll('.mp-seg button')) {
      expect(btn.attributes('disabled')).toBeDefined();
    }
  });

  it('leaves every field editable when not frozen', () => {
    const w = mount(RepotDoneForm, {
      props: { open: true, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: false },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    expect(w.find('input[type="number"]').attributes('disabled')).toBeUndefined();
    expect(w.find('select').attributes('disabled')).toBeUndefined();
  });

  it('keeps the confirmed answers when the form closes (X/Escape/backdrop) and the parent reopens it ' +
    'frozen — the same resume sequence RepotEvaluationModal.vue\'s V12 fix relies on', async () => {
    const w = mount(RepotDoneForm, {
      props: { open: true, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: false },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.find('input[type="number"]').setValue(22);
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('22');

    // The parent freezes once a confirm is attempted, then the owner closes and reopens — resuming, per
    // the parent's fix, keeps `frozen` true across that reopen.
    await w.setProps({ frozen: true });
    await w.setProps({ open: false });
    await w.setProps({ open: true });

    const input = w.find('input[type="number"]');
    expect((input.element as HTMLInputElement).value).toBe('22'); // NOT reset to currentPotSizeCm (20)
    expect(input.attributes('disabled')).toBeDefined();
  });

  it('still resets to the current profile on a genuinely fresh re-open (no outstanding key)', async () => {
    const w = mount(RepotDoneForm, {
      props: { open: true, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: false },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.find('input[type="number"]').setValue(22);

    await w.setProps({ open: false });
    await w.setProps({ open: true });

    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('20');
  });

  it('offers "start over" only once frozen AND an error is showing — never mid-flight with no error yet', () => {
    const notYetErrored = mount(RepotDoneForm, {
      props: { open: true, currentPotSizeCm: null, currentSoilMix: null, frozen: true, error: null },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    expect(notYetErrored.text()).not.toContain('repotEval.startOver');

    const errored = mount(RepotDoneForm, {
      props: { open: true, currentPotSizeCm: null, currentSoilMix: null, frozen: true, error: 'Something went wrong.' },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    expect(errored.text()).toContain('repotEval.startOver');
  });

  it('"start over" emits the event the parent uses to clear the key and unfreeze', async () => {
    const w = mount(RepotDoneForm, {
      props: { open: true, currentPotSizeCm: null, currentSoilMix: null, frozen: true, error: 'Something went wrong.' },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    const buttons = w.findAll('button');
    const startOverBtn = buttons.find((b) => b.text().includes('repotEval.startOver'));
    expect(startOverBtn).toBeTruthy();
    await startOverBtn!.trigger('click');
    expect(w.emitted('start-over')).toBeTruthy();
  });
});

// X2: the suite above only ever proves that whatever the fields happened to hold LOCALLY (typed in by the
// test itself) survives a close/reopen — it never once passes the `frozenSnapshot` PROP, so it can never
// catch a regression in the hydrate-FROM-the-prop branch of `watch(open, ...)` (W3's own fix). These tests
// mount the REAL component with `frozenSnapshot` driving the resume directly — the RENDERED input/select/
// segmented-control values must reflect the PROP, not whatever the fields happened to hold locally, and the
// emitted `confirm` body on a retry must match what is rendered.
describe('RepotDoneForm — W3: frozenSnapshot hydrates the REAL component (never fields that merely happen ' +
  'to survive)', () => {
  function findConfirmButton(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.confirm'))!;
  }

  it('hydrates pot size, soil mix and the substrate toggle from frozenSnapshot on a resumed open — not ' +
    'from currentPotSizeCm/currentSoilMix, and resubmits exactly what is rendered', async () => {
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: true,
        frozenSnapshot: { potSizeCm: 30, soilMix: 'cactus-mix', charged: false },
      },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    // `watch(open, ...)` only runs on a false→true TRANSITION (never the initial mount value) — same reason
    // the existing frozen suite above always starts `open: false`/`true` then flips it.
    await w.setProps({ open: true });

    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('30');
    expect((w.find('select').element as HTMLSelectElement).value).toBe('cactus-mix');
    // FIX D1: the control is now three-way — 'unknown' (index 0), 'fresh' (index 1), 'reused' (index 2).
    // charged:false -> the "reused" segment (index 2) is the active one.
    const segButtons = w.findAll('.mp-seg button');
    expect(segButtons[0]!.attributes('aria-pressed')).toBe('false');
    expect(segButtons[1]!.attributes('aria-pressed')).toBe('false');
    expect(segButtons[2]!.attributes('aria-pressed')).toBe('true');

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({ potSizeCm: 30, soilMix: 'cactus-mix', charged: false });
  });

  // FIX D3 — the ONE snapshot shape the two tests around this one never exercise: `charged` OMITTED.
  // `undefined` is falsy exactly like `false`, so the pre-fix ternary (`snapshot.charged ? 'fresh' :
  // 'reused'`) silently rendered "reused" for an owner who had said "I don't know" — and then RESUBMITTED
  // `charged: false`, turning a non-answer into an assertion that the medium carries no reserve. This test
  // exists because a mutation of the fix stayed GREEN against the sibling tests above: both of them pin a
  // present `charged`, so neither can see this branch at all.
  it('hydrates an OMITTED charged back to "I don\'t know" — never silently to "reused" — and resubmits it ' +
    'with no charged key', async () => {
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: true,
        // No `charged` key at all — the wire shape a "I don't know" answer produces.
        frozenSnapshot: { potSizeCm: 30, soilMix: 'cactus-mix' },
      },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });

    const segButtons = w.findAll('.mp-seg button');
    expect(segButtons[0]!.attributes('aria-pressed')).toBe('true');  // 'unknown'
    expect(segButtons[1]!.attributes('aria-pressed')).toBe('false'); // 'fresh'
    expect(segButtons[2]!.attributes('aria-pressed')).toBe('false'); // 'reused'

    await findConfirmButton(w).trigger('click');
    const payload = w.emitted('confirm')![0]![0] as Record<string, unknown>;
    expect(payload).toEqual({ potSizeCm: 30, soilMix: 'cactus-mix' });
    expect('charged' in payload).toBe(false);
  });

  it('changing which plant\'s snapshot is frozen updates the RENDERED values on the next resume — a ' +
    'detour through a DIFFERENT plant\'s (fresh, unfrozen) form must not leave THIS plant\'s reopened, ' +
    'frozen form showing the wrong values', async () => {
    // Plant A fails and freezes with its own snapshot.
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: true,
        frozenSnapshot: { potSizeCm: 20, soilMix: 'potting-mix', charged: true },
      },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('20');

    // Close A, open a DIFFERENT plant's form instance fresh (frozen: false, no frozenSnapshot, a DIFFERENT
    // current profile) and edit a field — simulating the SAME shared form component now showing plant B.
    await w.setProps({ open: false });
    await w.setProps({
      frozen: false, frozenSnapshot: null, currentPotSizeCm: 25, currentSoilMix: 'cactus-mix', open: true,
    });
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('25'); // B's own profile
    await w.find('input[type="number"]').setValue(99); // the owner edits B's field

    // Close B without confirming, then resume A: the REAL component must hydrate from A's frozenSnapshot
    // again, never leaving B's leftover edited value (99) visible under A's frozen, about-to-be-retried form.
    await w.setProps({ open: false });
    await w.setProps({
      frozen: true, frozenSnapshot: { potSizeCm: 20, soilMix: 'potting-mix', charged: true },
      currentPotSizeCm: 20, currentSoilMix: 'potting-mix', open: true,
    });

    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('20');
    expect((w.find('select').element as HTMLSelectElement).value).toBe('potting-mix');

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')!.at(-1)![0]).toEqual({ potSizeCm: 20, soilMix: 'potting-mix', charged: true });
  });
});

// FIX C4/C — a realistic owner input (a decimal pot diameter, or one over the server's ceiling) used to
// reach the server, get a clean 400 back, and then be MISREPORTED as "this plant already has an answer
// waiting" while freezing every field. The root fix lives server-side and in useRepotAttempt.ts (FIX C1-C3);
// this file's own responsibility is to never let the bad value leave the form in the first place.
describe('RepotDoneForm — FIX C4: client-side pot-size validation blocks a bad value before it ever reaches the server', () => {
  function findConfirmButton(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.confirm'))!;
  }

  async function mountReal(props: Record<string, unknown> = {}) {
    const w = mount(RepotDoneForm, {
      props: { open: false, currentPotSizeCm: null, currentSoilMix: 'potting-mix', frozen: false, ...props },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    // `watch(open, ...)` only fires on a false→true TRANSITION — same convention as every other test above.
    await w.setProps({ open: true });
    return w;
  }

  it('a decimal pot diameter (e.g. 22.5) blocks confirm and shows the inline validation message', async () => {
    const w = await mountReal();
    await w.find('input[type="number"]').setValue('22.5');

    expect(findConfirmButton(w).attributes('disabled')).toBeDefined();
    expect(w.find('.fg-error').exists()).toBe(true);
    expect(w.find('.fg-error').text()).toContain('repotDone.potSizeInvalid');
  });

  it('a pot diameter over the server ceiling (e.g. 9999) blocks confirm and shows the inline validation ' +
    'message', async () => {
    const w = await mountReal();
    await w.find('input[type="number"]').setValue('9999');

    expect(findConfirmButton(w).attributes('disabled')).toBeDefined();
    expect(w.find('.fg-error').exists()).toBe(true);
  });

  it('a valid positive integer within range shows no validation message and allows confirm', async () => {
    const w = await mountReal();
    await w.find('input[type="number"]').setValue('22');

    expect(w.find('.fg-error').exists()).toBe(false);
    expect(findConfirmButton(w).attributes('disabled')).toBeUndefined();
  });
});

// FIX D — the substrate control is now three-way and defaults to "I don't know" (never a pre-pressed guess
// in either direction), and an unset soil mix opens genuinely EMPTY rather than silently pre-selecting the
// catalogue's first entry.
describe('RepotDoneForm — FIX D: the substrate answer defaults to "I don\'t know" and an unset mix opens empty', () => {
  function findConfirmButton(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.confirm'))!;
  }

  async function mountReal(props: Record<string, unknown> = {}) {
    const w = mount(RepotDoneForm, {
      props: { open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: false, ...props },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });
    return w;
  }

  it('opens with "I don\'t know" (index 0) pressed by default, and confirming sends NO `charged` key at ' +
    'all — never a guessed true/false', async () => {
    const w = await mountReal();

    const segButtons = w.findAll('.mp-seg button');
    expect(segButtons[0]!.attributes('aria-pressed')).toBe('true'); // 'unknown'
    expect(segButtons[1]!.attributes('aria-pressed')).toBe('false'); // 'fresh'
    expect(segButtons[2]!.attributes('aria-pressed')).toBe('false'); // 'reused'

    await findConfirmButton(w).trigger('click');
    const payload = w.emitted('confirm')![0]![0] as Record<string, unknown>;
    expect(payload).toEqual({ potSizeCm: 20, soilMix: 'potting-mix' });
    expect(Object.prototype.hasOwnProperty.call(payload, 'charged')).toBe(false);
  });

  it('choosing "reused" (index 2) emits `charged: false`', async () => {
    const w = await mountReal();
    const segButtons = w.findAll('.mp-seg button');
    await segButtons[2]!.trigger('click'); // 'reused'

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({ potSizeCm: 20, soilMix: 'potting-mix', charged: false });
  });

  it('choosing "fresh" (index 1) emits `charged: true`', async () => {
    const w = await mountReal();
    const segButtons = w.findAll('.mp-seg button');
    await segButtons[1]!.trigger('click'); // 'fresh'

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({ potSizeCm: 20, soilMix: 'potting-mix', charged: true });
  });

  it('an empty-profile open (no recorded soil mix) leaves the select genuinely EMPTY — never silently ' +
    'pre-selecting the catalogue\'s first entry — and `canConfirm` stays false', async () => {
    const w = await mountReal({ currentSoilMix: null });

    expect((w.find('select').element as HTMLSelectElement).value).toBe('');
    expect(findConfirmButton(w).attributes('disabled')).toBeDefined();
  });
});
