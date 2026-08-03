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
// useTaskMeta) — stubbed here with a single fixed option, irrelevant to the error-rendering assertion.
vi.stubGlobal('useProfileMeta', () => ({
  soilMixOptions: computed(() => [{ value: 'potting-mix', label: 'Potting mix' }]),
}));

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
      FormGroup: { props: ['label', 'hint'], template: '<div><slot /></div>' },
      AppIcon: true,
    };
  }

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
