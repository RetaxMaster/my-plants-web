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
  // `data-modal-stub` is a stable hook naming THIS element as the Modal's own rendered panel, distinct from
  // the component's outer (possibly multi-root/fragment) template — the containment assertion below needs
  // a concrete node to check against, not "is it anywhere in the mounted tree".
  Modal: {
    props: ['modelValue', 'title', 'size'],
    template: '<div data-modal-stub v-if="modelValue"><slot /><slot name="footer" /></div>',
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
    // Containment, not mere existence (round-3 review): asserting only `exists()` also passes if the alert
    // were rendered as a SIBLING outside <Modal>, which is exactly the regression F2 fixed. The modal stub
    // marks its own rendered panel with `data-modal-stub`; the alert must be a genuine DOM descendant of it.
    const modalPanel = w.find('[data-modal-stub]');
    expect(modalPanel.exists()).toBe(true);
    expect(modalPanel.element.contains(alert.element)).toBe(true);
  });
});

describe('RepotEvaluationModal — frozen answers survive a close + re-open (code review finding V12)', () => {
  const signs = [
    { id: 's1', label: 'Roots circling the drainage holes' },
    { id: 's2', label: 'Stunted growth this season' },
  ];

  it('keeps the checked signs when the modal closes (open=false, e.g. X/Escape/backdrop) and the ' +
    'parent reopens it frozen — the exact sequence pages/index.vue\'s onEvaluate resume produces', async () => {
    const w = mountModal({ signs, frozen: false });
    await w.find('input[type="checkbox"][value="s1"]').setValue(true);
    expect((w.find('input[type="checkbox"][value="s1"]').element as HTMLInputElement).checked).toBe(true);

    // The parent freezes once a submit is attempted, then the owner closes (X/Escape/backdrop set the
    // `open` prop to false without going through "start over") and reopens — resuming, per the parent's
    // fix, keeps `frozen` true across that reopen.
    await w.setProps({ frozen: true });
    await w.setProps({ open: false });
    await w.setProps({ open: true });

    const checkbox = w.find('input[type="checkbox"][value="s1"]');
    expect(checkbox.exists()).toBe(true);
    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
    // The inputs stay disabled — this is a frozen retry, not an editable form.
    expect((checkbox.element as HTMLInputElement).disabled).toBe(true);
  });

  it('still resets the answers on a genuinely fresh re-open (no outstanding key, frozen stays false)', async () => {
    const w = mountModal({ signs, frozen: false });
    await w.find('input[type="checkbox"][value="s1"]').setValue(true);

    // A fresh attempt — e.g. a different plant, or this same plant after "start over" — reopens with
    // frozen still false, and the pre-existing reset behavior must be unchanged.
    await w.setProps({ open: false });
    await w.setProps({ open: true });

    const checkbox = w.find('input[type="checkbox"][value="s1"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(false);
  });
});

// X2: the V12 suite above only ever proves a component-LOCAL answer (typed in by the test itself) survives
// a close/reopen — it never once passes the `frozenAnswers` PROP, so it can never catch a regression in the
// hydrate-FROM-the-prop branch of `watch(open, ...)` (W3's own fix). These tests mount the REAL component
// with `frozenAnswers` driving the resume directly — the RENDERED checkbox/radio state must reflect the
// PROP, not whatever the fields happened to hold locally, and the emitted `submit` body on a retry must
// match what is rendered (never a second, independently-tracked "what will actually be sent").
describe('RepotEvaluationModal — W3: frozenAnswers hydrates the REAL component (never a component-local ' +
  'answer that merely happens to survive)', () => {
  const signs = [
    { id: 's1', label: 'Roots circling the drainage holes' },
    { id: 's2', label: 'Stunted growth this season' },
  ];

  // The Button stub renders plain <button> tags (no distinguishing class) — same convention as the
  // existing "start over" test above, which finds it by its (mocked passthrough) i18n key text.
  function findSubmitButton(w: ReturnType<typeof mountModal>) {
    return w.findAll('button').find((b) => b.text().includes('repotEval.submit'))!;
  }

  it('a "signs" frozenAnswers hydrates the checked signs — rendered AND resubmitted', async () => {
    // `watch(open, ...)` only runs on a false→true TRANSITION (never on the initial mount value) — same
    // reason the existing V12 suite above always starts `open: false` and flips it. Mount closed, THEN open
    // frozen, so the resume path (not the mount) is what's under test.
    const w = mountModal({ signs, frozen: true, frozenAnswers: { answer: 'signs', signIds: ['s2'] }, open: false });
    await w.setProps({ open: true });

    const s1 = w.find('input[type="checkbox"][value="s1"]');
    const s2 = w.find('input[type="checkbox"][value="s2"]');
    expect((s1.element as HTMLInputElement).checked).toBe(false);
    expect((s2.element as HTMLInputElement).checked).toBe(true);
    expect((s2.element as HTMLInputElement).disabled).toBe(true); // frozen — a retry, not an editable form

    await findSubmitButton(w).trigger('click');
    expect(w.emitted('submit')![0]![0]).toEqual({ answer: 'signs', signIds: ['s2'] });
  });

  it('a "no-signs" frozenAnswers hydrates the exclusive radio — rendered AND resubmitted', async () => {
    const w = mountModal({ signs, frozen: true, frozenAnswers: { answer: 'no-signs' }, open: false });
    await w.setProps({ open: true });

    const noSigns = w.find('input[type="radio"][value="no-signs"]');
    expect((noSigns.element as HTMLInputElement).checked).toBe(true);
    expect(w.findAll('input[type="checkbox"]').every((c) => !(c.element as HTMLInputElement).checked)).toBe(true);

    await findSubmitButton(w).trigger('click');
    expect(w.emitted('submit')![0]![0]).toEqual({ answer: 'no-signs' });
  });

  it('changing which plant\'s snapshot is frozen updates the RENDERED answers on the next resume — a ' +
    'detour through a DIFFERENT plant\'s (fresh, unfrozen) modal must not leave THIS plant\'s reopened, ' +
    'frozen modal showing the wrong answers', async () => {
    // Plant A fails and freezes with signIds ['s1'].
    const w = mountModal({ signs, frozen: true, frozenAnswers: { answer: 'signs', signIds: ['s1'] }, open: false });
    await w.setProps({ open: true });
    expect((w.find('input[value="s1"]').element as HTMLInputElement).checked).toBe(true);

    // Close A, open a DIFFERENT plant's modal instance fresh (frozen: false, no frozenAnswers) and check a
    // DIFFERENT sign — simulating the SAME shared modal component now showing plant B.
    await w.setProps({ open: false });
    await w.setProps({ frozen: false, frozenAnswers: null, open: true });
    await w.find('input[value="s2"]').setValue(true);
    expect((w.find('input[value="s2"]').element as HTMLInputElement).checked).toBe(true);

    // Close B without submitting, then resume A: the REAL component must hydrate from A's frozenAnswers
    // again, never leaving B's leftover checked state visible under A's frozen, about-to-be-retried modal.
    await w.setProps({ open: false });
    await w.setProps({ frozen: true, frozenAnswers: { answer: 'signs', signIds: ['s1'] }, open: true });

    expect((w.find('input[value="s1"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('input[value="s2"]').element as HTMLInputElement).checked).toBe(false);

    await findSubmitButton(w).trigger('click');
    expect(w.emitted('submit')!.at(-1)![0]).toEqual({ answer: 'signs', signIds: ['s1'] });
  });
});
