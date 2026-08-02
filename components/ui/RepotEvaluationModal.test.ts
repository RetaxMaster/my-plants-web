// @vitest-environment happy-dom
//
// Round-2 review (Codex) found F2 not actually closed: `pages/index.vue` showed the REPOT error as a
// page-level banner, but `onEvaluationSubmit` deliberately keeps THIS modal open on failure, and
// `Modal.vue` teleports its backdrop to <body> with `position: fixed; z-index: 1000` covering the whole
// viewport — so the page-level banner rendered BEHIND the still-open modal, invisible to the owner. The
// fix: this component now takes its own optional `error` prop and renders it via the REAL `Alert`
// component inside its own body, above the backdrop. This test proves the alert actually RENDERS in the
// DOM when `error` is set (not just that the prop is accepted), using the real Alert.vue (only its AppIcon
// dependency is stubbed) so the assertion covers Alert's own `role="alert"` markup too.
import { describe, it, expect, vi } from 'vitest';
import { ref, computed, watch } from 'vue';
import { mount } from '@vue/test-utils';
import RepotEvaluationModal from './RepotEvaluationModal.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

const stubs = {
  // Collapsed to a real-ish v-model/slot contract (same technique PlantProfileModal.test.ts's UiModalStub
  // uses) so the default AND footer slots — where the Alert and the submit button live — actually render.
  Modal: {
    props: ['modelValue', 'title', 'size'],
    template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
  },
  Button: { props: ['disabled', 'icon'], template: '<button :disabled="disabled"><slot /></button>' },
  AppIcon: true, // Alert.vue's own icon dependency; irrelevant to this assertion.
};

function mountModal(props: Record<string, unknown> = {}) {
  return mount(RepotEvaluationModal, {
    props: { open: true, signs: [], ...props },
    global: { mocks: { $t: (k: string) => k }, stubs },
  });
}

describe('RepotEvaluationModal — the error prop renders INSIDE the modal body (round-2 F2 fix)', () => {
  it('renders no alert when error is absent', () => {
    const w = mountModal();
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('renders no alert when error is explicitly null', () => {
    const w = mountModal({ error: null });
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('renders the message via a role="alert" element when error is set, INSIDE the modal body', () => {
    const w = mountModal({ error: 'Something went wrong. Please try again.' });
    const alert = w.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Something went wrong. Please try again.');
  });
});
