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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, watch, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import RepotEvaluationModal from './RepotEvaluationModal.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
// A mutable, reassignable `locale` ref the tests below can drive directly (QA defect B fix — the modal
// watches `locale` to ask its parent to reload the sign catalogue on a language switch). Reassigned fresh
// in `beforeEach` so a locale change in one test never bleeds into the next; the `useI18n` factory reads
// the OUTER `mockLocale` binding by closure, so reassigning it here is visible to every subsequent mount.
let mockLocale = ref('en');
// Returns the KEY, and — when the call passes params — the key plus its interpolated values. That second
// half matters for the help-toggle suite at the bottom: its whole claim is that eleven toggles resolve to
// DIFFERENT names, which a stub that discarded the interpolation would flatten into one identical key and
// make the assertion vacuously false. Same passthrough shape as RepotVerdictModal.test.ts's.
vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) =>
    (params ? `${k}|${Object.values(params).join('|')}` : k),
  locale: mockLocale,
}));

beforeEach(() => {
  mockLocale = ref('en');
});

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

function mountModal(props: Record<string, unknown> = {}, opts: { attach?: boolean } = {}) {
  return mount(RepotEvaluationModal, {
    props: { open: true, signs: [], ...props },
    global: { mocks: { $t: (k: string) => k }, stubs },
    // `attach: true` mounts into the real document instead of Vue Test Utils' default DETACHED element.
    // Only the D1 suite needs it, and it needs it absolutely: a DOM implementation runs an input's
    // activation behavior (checkedness, the native `change`) only for a CONNECTED element, so a
    // `.click()` on a detached radio silently does nothing at all — measured, not assumed. A suite whose
    // whole point is that the native activation path behaves correctly cannot run off the document.
    ...(opts.attach ? { attachTo: document.body } : {}),
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

// Owner ruling (substrate:13 addendum, informative-only context): `typicalIntervalMonths` is copy shown
// next to the questionnaire — how often this species is typically repotted. It must render when present and
// render NOTHING (no empty/"unknown" sentence) when null/absent, since an un-curated species or a still-
// pending fetch must never surface a broken-looking line.
describe('RepotEvaluationModal — typicalIntervalMonths context line (informative-only)', () => {
  it('renders the context line when the prop is a number', () => {
    const w = mountModal({ typicalIntervalMonths: 18 });
    expect(w.find('.mp-repoteval__typicalinterval').exists()).toBe(true);
    expect(w.find('.mp-repoteval__typicalinterval').text()).toContain('repotEval.typicalInterval');
  });

  it('renders NOTHING when the prop is null', () => {
    const w = mountModal({ typicalIntervalMonths: null });
    expect(w.find('.mp-repoteval__typicalinterval').exists()).toBe(false);
  });

  it('renders NOTHING when the prop is absent entirely', () => {
    const w = mountModal();
    expect(w.find('.mp-repoteval__typicalinterval').exists()).toBe(false);
  });
});

// QA defect B fix: the sign catalogue is DATA resolved server-side in the request locale (see
// `composables/useApi.ts`'s locale-keyed GET cache and `PlantDetail.vue`'s `watch: [locale]` on its own
// fetch). This modal has no fetch of its own — it asks the parent to redo ITS fetch by emitting
// `reload-signs`, and only while the modal is actually open (a closed modal has nothing on screen to go
// stale, so it must stay silent and let the parent's normal re-open flow fetch fresh signs instead).
describe('RepotEvaluationModal — reload-signs on a locale switch (QA defect B)', () => {
  it('emits reload-signs when the locale changes while the modal is open', async () => {
    const w = mountModal({ open: true });
    mockLocale.value = 'es';
    await nextTick();
    expect(w.emitted('reload-signs')).toBeTruthy();
    expect(w.emitted('reload-signs')!.length).toBe(1);
  });

  it('does NOT emit reload-signs when the locale changes while the modal is closed', async () => {
    const w = mountModal({ open: false });
    mockLocale.value = 'es';
    await nextTick();
    expect(w.emitted('reload-signs')).toBeFalsy();
  });
});

// FIX E — "No signs yet" / "I couldn't check it" used to stick once clicked: every sign checkbox stayed
// disabled and the only escape was closing the whole modal (costly on mobile). Clicking an ALREADY-selected
// answer now clears it back to 'none'.
//
// ⚠️ EVERY CLICK IN THIS SUITE GOES THROUGH THE ELEMENT'S OWN `.click()`, NEVER `trigger('click')`, AND
// THAT IS THE POINT OF THE SUITE — see `clickRadio` below. This is the QA-round-3 D1 regression: the
// original FIX E bound `:checked` + `@click.prevent`, which in a REAL browser leaves the radio rendering
// UNSELECTED (the browser's legacy-canceled-activation behavior restores checkedness AFTER the listeners,
// overwriting Vue's own `el.checked = true`), and this very suite asserted `.checked === true` and passed
// anyway — because `trigger('click')` dispatches a SYNTHETIC event that runs none of those activation
// steps, so `preventDefault()` was inert and Vue's write was never contradicted. A synthetic click cannot
// falsify a defect that only the native activation steps produce.
describe('RepotEvaluationModal — FIX E + QA D1: the exclusive answers RENDER as selected, and are ' +
  'deselectable', () => {
  const signs = [
    { id: 's1', label: 'Roots circling the drainage holes' },
  ];

  /**
   * A REAL user click: `HTMLElement.click()` runs the full activation path (legacy-pre-activation ->
   * dispatch -> activation-or-canceled behavior, plus the native `change` a radio fires when its
   * checkedness actually changes). `trigger('click')` implements NONE of it — it dispatches a synthetic
   * event, so `preventDefault()` is inert and the radio's checkedness is never touched by the DOM at all.
   *
   * Returns the element's checkedness read SYNCHRONOUSLY, before any await — i.e. the DOM's OWN answer to
   * the click, with Vue's (async, microtask-flushed) re-render deliberately not yet applied. That read is
   * what makes this defect falsifiable HERE, and it is worth stating why the obvious assertion is not
   * enough:
   *
   *   In a real browser the two halves interleave — the microtask checkpoint that flushes Vue's render
   *   runs BETWEEN the click listener returning and the rest of the dispatch algorithm, so Vue writes
   *   `el.checked = true` and the canceled-activation behavior then overwrites it back to false. Measured
   *   in Chromium against the shipped build: `.checked === false`, `hasAttribute('checked') === true`.
   *   happy-dom cannot reproduce that interleaving, because it invokes listeners from inside its own JS
   *   call stack — the stack never empties mid-dispatch, so no microtask checkpoint occurs and Vue's write
   *   lands AFTER the restore, where it survives. Asserting `.checked` only after `await nextTick()` is
   *   therefore GREEN under both the broken and the fixed binding here: verified by running exactly that
   *   mutation, which is why this helper exists in this shape.
   *
   *   The synchronous read has no such blind spot: it asks the DOM whether the activation was CANCELLED,
   *   which is the actual root cause and is implemented faithfully. Cancelled -> false; not cancelled ->
   *   true. Assert BOTH — the synchronous value (the click was not cancelled) and the post-render value
   *   (Vue agrees with the DOM) — because either alone can be satisfied by a shape that is wrong in the
   *   other half.
   */
  async function clickRadio(el: HTMLInputElement): Promise<boolean> {
    el.click();
    const survivedActivation = el.checked;
    await nextTick();
    return survivedActivation;
  }

  // Every mount in this suite is ATTACHED (see `mountModal`'s own note) and therefore has to be torn down:
  // an orphaned mount leaves its radios in the document under the SAME `name`, and a radio group is scoped
  // to the document, so a later test's clicks would resolve against a group still holding this test's
  // inputs.
  const mounted: { unmount: () => void }[] = [];
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
  });
  function mountAttached(props: Record<string, unknown>) {
    const w = mountModal(props, { attach: true });
    mounted.push(w);
    return w;
  }

  const radio = (w: ReturnType<typeof mountModal>, value: string) =>
    w.find(`input[type="radio"][value="${value}"]`).element as HTMLInputElement;

  it('a clicked exclusive answer RENDERS as selected — the DOM `checked` PROPERTY, which is what drives ' +
    'both the visual state and what a screen reader announces (QA D1)', async () => {
    const w = mountAttached({ signs, frozen: false });
    const noSigns = radio(w, 'no-signs');

    const survivedActivation = await clickRadio(noSigns);

    // THE assertion the defect failed: the click's activation must NOT be cancelled, because a cancelled
    // one restores checkedness to its pre-click value and no amount of Vue re-rendering wins that race in
    // a real browser. See `clickRadio` for why this is read synchronously.
    expect(survivedActivation).toBe(true);
    // ...and Vue's own render agrees with the DOM — the PROPERTY, never the attribute, since only the
    // property drives the visual state and what a screen reader announces.
    expect(noSigns.checked).toBe(true);
    // And the answer really was recorded — proving the two halves agree, so a future fix cannot satisfy
    // one of them alone.
    expect((w.find('input[type="checkbox"][value="s1"]').element as HTMLInputElement).disabled).toBe(true);
  });

  it('exposes the two answers as a NAMED radio group, so assistive tech announces what they are ' +
    'alternatives to', () => {
    const w = mountAttached({ signs, frozen: false });
    const group = w.find('[role="radiogroup"]');
    expect(group.exists()).toBe(true);
    expect(group.attributes('aria-label')).toBe('repotEval.exclusiveGroupLabel');
    expect(group.findAll('input[type="radio"]').length).toBe(2);
  });

  it('clicking a SELECTED exclusive answer again clears it and re-enables the sign checkboxes', async () => {
    const w = mountAttached({ signs, frozen: false });
    const noSigns = radio(w, 'no-signs');

    expect(await clickRadio(noSigns)).toBe(true);
    expect(noSigns.checked).toBe(true);
    // Selecting an exclusive answer disables every sign checkbox (existing, unchanged behavior).
    expect((w.find('input[type="checkbox"][value="s1"]').element as HTMLInputElement).disabled).toBe(true);

    // Clicking the SAME radio again must clear it, not leave it stuck selected.
    await clickRadio(noSigns);
    expect(noSigns.checked).toBe(false);
    expect((w.find('input[type="checkbox"][value="s1"]').element as HTMLInputElement).disabled).toBe(false);
  });

  it('clicking a DIFFERENT exclusive answer switches to it, never toggling the first one back on', async () => {
    const w = mountAttached({ signs, frozen: false });
    const noSigns = radio(w, 'no-signs');
    const couldNotCheck = radio(w, 'could-not-check');

    expect(await clickRadio(noSigns)).toBe(true);
    expect(noSigns.checked).toBe(true);

    expect(await clickRadio(couldNotCheck)).toBe(true);
    expect(noSigns.checked).toBe(false);
    expect(couldNotCheck.checked).toBe(true);
  });

  it('a cleared answer is genuinely cleared on the WIRE too, not merely visually — the submit button ' +
    'goes back to disabled', async () => {
    const w = mountAttached({ signs, frozen: false });
    const noSigns = radio(w, 'no-signs');
    const submit = () => w.findAll('button').find((b) => b.text().includes('repotEval.submit'))!;

    expect(submit().attributes('disabled')).toBeDefined();
    await clickRadio(noSigns);
    expect(submit().attributes('disabled')).toBeUndefined();
    await clickRadio(noSigns);
    expect(submit().attributes('disabled')).toBeDefined();
  });
});

// QA round-4 finding 3. Choosing an exclusive answer sets every sign checkbox to `disabled=true`, which is
// correct and stays — the two answers are alternatives, the server rejects the contradiction with a 400,
// and the FROZEN state has to disable them regardless (the answers must not change under an outstanding
// idempotency key). What was wrong was that the disabled state was INVISIBLE: the wrapping label kept
// `opacity: 1`, `pointer-events: auto` and `cursor: pointer`, so the rows looked and felt clickable and
// silently did nothing.
//
// WHY THE DISABLE WAS KEPT rather than making the boxes enabled and having a tick clear the radio (the
// direction that already works, via `watch(checked, ...)`): the frozen state must stay disabled whatever is
// decided about the exclusive one, so the visible treatment is needed either way — one mechanism now covers
// both. And a dimmed row states "these are alternatives to what you picked", where a row that silently
// erased the answer given two lines below would be a second, less legible way of saying the same thing.
describe('RepotEvaluationModal — QA round-4 finding 3: a disabled sign row LOOKS disabled', () => {
  const signs = [
    { id: 's1', label: 'Roots circling the drainage holes' },
    { id: 's2', label: 'Water runs straight through' },
  ];
  const signRows = (w: ReturnType<typeof mountModal>) =>
    w.findAll('.mp-repoteval__list .mp-repoteval__check');
  const exclusiveRows = (w: ReturnType<typeof mountModal>) =>
    w.findAll('.mp-repoteval__exclusive .mp-repoteval__check');

  it('marks nothing disabled while both answers are still open', () => {
    const w = mountModal({ signs, frozen: false });
    for (const row of [...signRows(w), ...exclusiveRows(w)]) {
      expect(row.classes()).not.toContain('mp-repoteval__check--disabled');
    }
  });

  it('THE DEFECT: choosing an exclusive answer disables every sign row AND says so visibly', async () => {
    const w = mountModal({ signs, frozen: false });
    await w.findAll('.mp-repoteval__exclusive input[type="radio"]')[0]!.setValue(true);

    for (const row of signRows(w)) {
      // Both halves, together: inert (the input really is disabled) AND legible (the row says so). The
      // defect was exactly the first without the second.
      expect(row.find('input[type="checkbox"]').attributes('disabled')).toBeDefined();
      expect(row.classes()).toContain('mp-repoteval__check--disabled');
    }
    // The exclusive answers themselves stay live — the owner must be able to change or clear their choice.
    for (const row of exclusiveRows(w)) {
      expect(row.classes()).not.toContain('mp-repoteval__check--disabled');
    }
  });

  it('marks EVERY row — signs and exclusive answers alike — while frozen, since all of them really are ' +
    'disabled under an outstanding idempotency key', () => {
    const w = mountModal({ signs, frozen: true });
    for (const row of [...signRows(w), ...exclusiveRows(w)]) {
      expect(row.classes()).toContain('mp-repoteval__check--disabled');
    }
  });

  it('clears the treatment again when the exclusive answer is deselected — the state is derived, never a ' +
    'one-way flag', async () => {
    const w = mountModal({ signs, frozen: false });
    const radio = w.findAll('.mp-repoteval__exclusive input[type="radio"]')[0]!;
    await radio.setValue(true);
    expect(signRows(w)[0]!.classes()).toContain('mp-repoteval__check--disabled');

    await radio.trigger('click'); // `onExclusiveClick` deselects the already-selected answer
    expect(signRows(w)[0]!.classes()).not.toContain('mp-repoteval__check--disabled');
    expect(signRows(w)[0]!.find('input[type="checkbox"]').attributes('disabled')).toBeUndefined();
  });
});

// Found in a REAL browser while verifying finding 4: every sign renders a help toggle with the SAME visible
// text, so eleven buttons in one dialog shared one accessible name — finding 4's defect at eleven-fold
// scale. The visible text stays as it is (it is the same affordance on every row); the accessible name
// names WHICH sign it expands, and contains the visible text so WCAG 2.5.3 "Label in Name" still holds.
describe('RepotEvaluationModal — the per-sign help toggles have DISTINCT accessible names', () => {
  const signs = [
    { id: 's1', label: 'Roots circling the drainage holes', help: 'Look underneath the pot.' },
    { id: 's2', label: 'Water runs straight through', help: 'Water it and watch the drainage.' },
    { id: 's3', label: 'The pot is cracked', help: 'Check the sides of the pot.' },
  ];

  it('names each toggle after its own sign, so a role+name query can never match two', () => {
    const w = mountModal({ signs });
    const toggles = w.findAll('.mp-repoteval__helptoggle');
    const names = toggles.map((b) => b.attributes('aria-label')!);

    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const [i, n] of names.entries()) expect(n).toBe(`repotEval.helpToggleFor|${signs[i]!.label}`);
  });

  it('keeps the shared VISIBLE text — the accessible name disambiguates, it does not replace the label', () => {
    const w = mountModal({ signs });
    for (const b of w.findAll('.mp-repoteval__helptoggle')) {
      expect(b.text()).toBe('repotEval.helpToggle');
    }
  });
});
