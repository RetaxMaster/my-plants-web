// @vitest-environment happy-dom
//
// Same round-2 F2 fix as RepotEvaluationModal.test.ts: `onRepotDoneConfirm` also deliberately keeps THIS
// modal open on failure, so the page-level banner in `pages/index.vue` rendered invisibly behind it. This
// proves the new `error` prop actually renders a `role="alert"` element (the real Alert.vue, only its
// AppIcon dependency stubbed) inside this modal's own body.
import { describe, it, expect, vi } from 'vitest';
import { ref, computed, watch } from 'vue';
import { mount } from '@vue/test-utils';
import RepotDoneForm from './RepotDoneForm.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
// Auto-imported in RepotDoneForm.vue (no explicit import, same convention TaskRow.test.ts documents for
// useTaskMeta) — stubbed here with a single fixed option, irrelevant to the error-rendering assertion.
vi.stubGlobal('useProfileMeta', () => ({
  soilMixOptions: computed(() => [{ value: 'potting-mix', label: 'Potting mix' }]),
}));

const stubs = {
  Modal: {
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
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
  });
});
