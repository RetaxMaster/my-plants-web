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
// The SAME canonical helper the component itself imports (Task 25/A3) — computing an expected "today" via a
// second implementation here would be exactly the fork this project's "no new forks" rule forbids, and would
// silently disagree with the component around a midnight rollover.
import { todayYmd } from '../../utils/localDate.js';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
// Needed by the new frozen-state tests below, which mount the REAL Input/SelectField (not stubbed) to
// assert their actual `disabled` attribute — both call Vue's `inject()` for FormGroup's field-id wiring.
vi.stubGlobal('inject', inject);
// `t` echoes the key AND appends any interpolated values. Keeping the key visible preserves every existing
// assertion that matches on the key; appending the params is what lets a test assert that a value actually
// REACHED the rendered string (the frozen `occurredOn` below), rather than only that some label rendered.
vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) =>
    params ? `${k} ${Object.values(params).join(' ')}` : k,
}));
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
  // The REAL implementation, copied deliberately rather than faked to something convenient: the component
  // builds its mix options through it, so a stub that returned a different SHAPE (say, without the empty
  // option) would make every assertion about the "I don't know" option below vacuous. It is three lines
  // and has no dependencies of its own. See composables/useProfileMeta.ts.
  withNotSet: (opts: { value: string; label: string }[], notSetLabel?: string | null) =>
    [{ value: '', label: notSetLabel ?? 'plantProfile.pickOption' }, ...opts],
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

// Task 25 (spec §2.3/§2.4, A3/A4). The date the repot is recorded on moves INTO this form: previously it
// lived on the Today card's own back-date input (or PlantDetail.vue's `today()`), with `frozenSnapshot.
// occurredOn` surfaced only via a read-only echo paragraph shown while frozen — two live "sources" for one
// date. Now the form owns a single, always-live date field: seeded from the caller (or today) on a fresh
// open, hydrated from the outstanding attempt's own envelope on a frozen resume, and EMITTED as part of the
// confirm payload, so exactly one editable date surface exists for one submission.
describe('RepotDoneForm — Task 25 (A3/A4): the form owns its own date field', () => {
  function findConfirmButton(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.confirm'))!;
  }

  async function mountReal(props: Record<string, unknown> = {}) {
    const w = mount(RepotDoneForm, {
      props: { open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: false, ...props },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    // `watch(open, ...)` only fires on a false→true TRANSITION — same convention as every other describe
    // block in this file.
    await w.setProps({ open: true });
    return w;
  }

  it('opens with the seeded date, and defaults to today when nothing is seeded', async () => {
    const seeded = await mountReal({ seedOccurredOn: '2026-07-01' });
    expect((seeded.find('input[type="date"]').element as HTMLInputElement).value).toBe('2026-07-01');

    const unseeded = await mountReal();
    expect((unseeded.find('input[type="date"]').element as HTMLInputElement).value).toBe(todayYmd());
  });

  it('EMITS the date as part of the payload — the form owns the date now, not the caller', async () => {
    const w = await mountReal({ seedOccurredOn: '2026-07-01' });

    await findConfirmButton(w).trigger('click');
    const payload = w.emitted('confirm')![0]![0] as Record<string, unknown>;
    expect(payload.occurredOn).toBe('2026-07-01');
  });

  it('carries a `max` of today, so the browser stops the year typo with no round trip', async () => {
    // A4 (spec §2.4). This matters MORE on this form than anywhere else: it is opened AUTOMATICALLY by the
    // app with the date pre-filled, and a form that opens by itself invites confirming without reading.
    // `occurredOn` here is what dates the repot AND what `substrate_refreshed_on` is set to, so a one-digit
    // year typo silences the plant's feeding for over a year with nothing failing.
    const w = await mountReal();
    expect(w.find('input[type="date"]').attributes('max')).toBe(todayYmd());
  });

  it('a FROZEN resume hydrates the date from the outstanding attempt\'s own envelope, not from the clock',
  async () => {
    // `seedOccurredOn` is deliberately DIFFERENT from `frozenSnapshot.occurredOn`, and neither is today —
    // proving the resume reads the envelope, never the seed and never `todayYmd()`.
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: true,
        seedOccurredOn: '2026-06-15',
        frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 20, soilMix: 'potting-mix' } },
      },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });
    expect((w.find('input[type="date"]').element as HTMLInputElement).value).toBe('2026-08-01');
  });

  it('the date input is DISABLED while frozen, like every other field', async () => {
    const w = await mountReal({
      frozen: true,
      frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 20, soilMix: 'potting-mix' } },
    });
    expect(w.find('input[type="date"]').attributes('disabled')).toBeDefined();
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
        frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 30, soilMix: 'cactus-mix', charged: false } },
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
    expect(w.emitted('confirm')![0]![0]).toEqual({
      potSizeCm: 30, soilMix: 'cactus-mix', charged: false, occurredOn: '2026-08-01',
    });
  });

  // The DATE the retry will send. It lives one level up in the frozen envelope from the three fields above,
  // and it was surfaced nowhere — while the card's own back-date input behind this modal stays editable, so
  // the card could read one day and the frozen retry carry another. On a feature whose whole point is
  // recording the repot on the day it actually happened, and whose `occurredOn` is what dates
  // `substrate_refreshed_on`, that is the one field a frozen form must state.
  //
  // REWRITTEN by Task 25 (A3): the field used to be a read-only echo PARAGRAPH (`.mp-repotdone__occurredon`,
  // shown only while frozen); it is now the SAME always-live date INPUT the rest of this file exercises —
  // this test now asserts the input's rendered VALUE instead of the paragraph's text.
  it('states the date the frozen retry will actually send — the field the card behind it can contradict', async () => {
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: true,
        frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 30, soilMix: 'cactus-mix' } },
      },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });
    // The date is read from the ENVELOPE, not from any live page state — the same one source the hydrated
    // fields above come from, so the display and the request cannot disagree.
    expect((w.find('input[type="date"]').element as HTMLInputElement).value).toBe('2026-08-01');
  });

  // RETRACTED by Task 25 (A3): the paragraph this test asserted the absence of no longer exists at all — the
  // date field is now ALWAYS rendered, live and editable, whether frozen or not (there is no separate echo
  // to say nothing while unfrozen). Its replacement, covering the unfrozen case, lives in the "Task 25
  // (A3/A4)" describe block above ("opens with the seeded date, and defaults to today when nothing is
  // seeded"); this test now asserts the one thing that genuinely still distinguishes "unfrozen" here — the
  // field is editable, not disabled.
  it('the date field stays a live, editable input while UNFROZEN — no separate echo is needed', async () => {
    const w = mount(RepotDoneForm, {
      props: { open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: false, frozenSnapshot: null },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });
    expect(w.find('input[type="date"]').attributes('disabled')).toBeUndefined();
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
        frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 30, soilMix: 'cactus-mix' } },
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
    expect(payload).toEqual({ potSizeCm: 30, soilMix: 'cactus-mix', occurredOn: '2026-08-01' });
    expect('charged' in payload).toBe(false);
  });

  it('changing which plant\'s snapshot is frozen updates the RENDERED values on the next resume — a ' +
    'detour through a DIFFERENT plant\'s (fresh, unfrozen) form must not leave THIS plant\'s reopened, ' +
    'frozen form showing the wrong values', async () => {
    // Plant A fails and freezes with its own snapshot.
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix', frozen: true,
        frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 20, soilMix: 'potting-mix', charged: true } },
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
      frozen: true, frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 20, soilMix: 'potting-mix', charged: true } },
      currentPotSizeCm: 20, currentSoilMix: 'potting-mix', open: true,
    });

    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('20');
    expect((w.find('select').element as HTMLSelectElement).value).toBe('potting-mix');

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')!.at(-1)![0]).toEqual({
      potSizeCm: 20, soilMix: 'potting-mix', charged: true, occurredOn: '2026-08-01',
    });
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
    expect(payload).toEqual({ potSizeCm: 20, soilMix: 'potting-mix', occurredOn: todayYmd() });
    expect(Object.prototype.hasOwnProperty.call(payload, 'charged')).toBe(false);
  });

  it('choosing "reused" (index 2) emits `charged: false`', async () => {
    const w = await mountReal();
    const segButtons = w.findAll('.mp-seg button');
    await segButtons[2]!.trigger('click'); // 'reused'

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({
      potSizeCm: 20, soilMix: 'potting-mix', charged: false, occurredOn: todayYmd(),
    });
  });

  it('choosing "fresh" (index 1) emits `charged: true`', async () => {
    const w = await mountReal();
    const segButtons = w.findAll('.mp-seg button');
    await segButtons[1]!.trigger('click'); // 'fresh'

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({
      potSizeCm: 20, soilMix: 'potting-mix', charged: true, occurredOn: todayYmd(),
    });
  });

  it('an empty-profile open (no recorded soil mix) leaves the select genuinely EMPTY — never silently ' +
    'pre-selecting the catalogue\'s first entry', async () => {
    const w = await mountReal({ currentSoilMix: null });

    expect((w.find('select').element as HTMLSelectElement).value).toBe('');
  });
});

// QA round-3 defect D2. FIX D above gave the FRESH-SUBSTRATE question a three-option treatment ("I don't
// know" included) and stopped at that — the SOIL MIX beside it kept a DISABLED placeholder as its only
// empty option, and `canConfirm` required a concrete mix. So an owner who genuinely did not know what they
// had repotted into could not complete the repot at all: a dead end on the feature's own main path,
// reachable by simply not remembering what was in the bag.
//
// The engine has had a first-class answer for this the whole time — a null mix routes to
// `CHARGE_UNKNOWN_MIX_DAYS`, a named constant kept separate from `CHARGE_DEFAULT_DECLARED` precisely so a
// no-evidence derivation can never be mistaken for a declared one (ledger L28/L29) — so this fix invents
// no semantics. It writes `null`.
describe('RepotDoneForm — QA D2: "I don\'t know" is a selectable answer for the soil mix, and it writes ' +
  'null', () => {
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

  it('offers the empty option as an ENABLED, selectable "I don\'t know" — not a disabled placeholder, ' +
    'which is what made the answer unreachable', async () => {
    const w = await mountReal({ currentSoilMix: null });
    const blank = w.findAll('option').find((o) => (o.element as HTMLOptionElement).value === '')!;

    expect(blank).toBeDefined();
    expect((blank.element as HTMLOptionElement).disabled).toBe(false);
    expect(blank.text()).toBe('repotDone.soilMixUnknown');
    // Exactly ONE blank option: passing a SelectField `:placeholder` alongside the prepended empty option
    // renders a SECOND, disabled one (QA defect F, in the profile form) and the owner sees two identical
    // blanks of which only one works.
    expect(w.findAll('option').filter((o) => (o.element as HTMLOptionElement).value === '').length).toBe(1);
  });

  it('lets the owner CONFIRM with no mix chosen — the defect was that this button never enabled', async () => {
    const w = await mountReal({ currentSoilMix: null });
    expect(findConfirmButton(w).attributes('disabled')).toBeUndefined();
  });

  it('emits `soilMix: null` EXPLICITLY when the owner does not know — never an omitted key, because a ' +
    'repot replaces the medium and an omitted key would leave the plant\'s OLD mix standing as a claim ' +
    'about a pot it is no longer in', async () => {
    const w = await mountReal({ currentSoilMix: null });
    await findConfirmButton(w).trigger('click');

    const payload = w.emitted('confirm')![0]![0] as Record<string, unknown>;
    expect(payload).toEqual({ potSizeCm: 20, soilMix: null, occurredOn: todayYmd() });
    expect(Object.prototype.hasOwnProperty.call(payload, 'soilMix')).toBe(true);
  });

  it('lets an owner who HAD a recorded mix go back to "I don\'t know" — the answer is reachable from a ' +
    'filled form, not only from an empty one', async () => {
    const w = await mountReal({ currentSoilMix: 'cactus-mix' });
    expect((w.find('select').element as HTMLSelectElement).value).toBe('cactus-mix');

    await w.find('select').setValue('');
    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({ potSizeCm: 20, soilMix: null, occurredOn: todayYmd() });
  });

  // QA round 4 REWROTE this case. It used to assert that "I don't know" applies to the mix but NEVER to
  // the diameter — which is exactly the rule QA hit: on a plant with no recorded pot size the "Same as
  // before" chip is disabled too, so a required diameter left the owner unable to record a repot they had
  // really performed without inventing a number. What survives of the old claim is the half that was
  // always right: an empty, unanswered field still blocks confirm. Saying "I don't know" is now an ANSWER,
  // and it is the only thing that unblocks it besides a real number.
  it('an empty, UNANSWERED diameter still blocks confirm — the escape is an explicit "I don\'t know", not ' +
    'a blank field', async () => {
    const w = await mountReal({ currentSoilMix: null, currentPotSizeCm: null });
    expect(findConfirmButton(w).attributes('disabled')).toBeDefined();

    await w.find('input[type="number"]').setValue('22');
    expect(findConfirmButton(w).attributes('disabled')).toBeUndefined();
  });

  it('round-trips a frozen snapshot whose `soilMix` is null back to "I don\'t know" — never to a concrete ' +
    'mix, which would convert a non-answer into a claim the owner never made (the same class of defect ' +
    'as FIX D3\'s `charged` hydration)', async () => {
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix',
        frozen: true, frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 30, soilMix: null } },
      },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });

    expect((w.find('select').element as HTMLSelectElement).value).toBe('');
    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({ potSizeCm: 30, soilMix: null, occurredOn: '2026-08-01' });
  });
});

// QA round-4 finding 2. The diameter was the one field on this form with no "I don't know" path, and
// "Mark as repotted" stayed disabled until it held a number. On a plant whose profile records no pot size,
// "Same as before" is disabled too — there is nothing to copy — so the owner could not complete a repot
// they had genuinely performed without inventing a diameter. An invented number is worse than an absent
// one: the engine cannot tell it is a guess, and it feeds the crowding ratio for the rest of the plant's
// life.
describe('RepotDoneForm — QA round-4 finding 2: "I don\'t know" is an answer for the pot diameter too, and ' +
  'it writes null', () => {
  function findConfirmButton(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.confirm'))!;
  }
  function findUnknownChip(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.potSizeUnknown'))!;
  }
  function findSameAsBeforeChip(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.sameAsBefore'))!;
  }

  async function mountReal(props: Record<string, unknown> = {}) {
    const w = mount(RepotDoneForm, {
      props: { open: false, currentPotSizeCm: null, currentSoilMix: null, frozen: false, ...props },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });
    return w;
  }

  // The exact repro QA ran, as a test: the fixture's `Gus` — empty profile, no recorded pot size. Both
  // escapes were closed at once, which is what made the flow un-completable rather than merely awkward.
  it('THE DEFECT: on a plant with no recorded pot size, "Same as before" is unavailable — so without an ' +
    '"I don\'t know" the repot could not be recorded at all', async () => {
    const w = await mountReal({ currentPotSizeCm: null });
    expect(findSameAsBeforeChip(w).attributes('disabled')).toBeDefined();
    expect(findConfirmButton(w).attributes('disabled')).toBeDefined();

    await findUnknownChip(w).trigger('click');
    expect(findConfirmButton(w).attributes('disabled')).toBeUndefined();
  });

  it('emits `potSizeCm: null` EXPLICITLY — never an omitted key, because a repot replaces the pot and an ' +
    'omitted key would leave the OLD diameter standing as a claim about a pot the plant is no longer in',
  async () => {
    const w = await mountReal({ currentPotSizeCm: null });
    await findUnknownChip(w).trigger('click');
    await findConfirmButton(w).trigger('click');

    const payload = w.emitted('confirm')![0]![0] as Record<string, unknown>;
    expect(payload).toEqual({ potSizeCm: null, soilMix: null, occurredOn: todayYmd() });
    expect(Object.prototype.hasOwnProperty.call(payload, 'potSizeCm')).toBe(true);
  });

  it('is reachable from a FILLED form too, and pressing it CLEARS the number so the answer and the field ' +
    'can never disagree', async () => {
    const w = await mountReal({ currentPotSizeCm: 18 });
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('18');

    await findUnknownChip(w).trigger('click');
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('');
    expect(w.find('input[type="number"]').attributes('disabled')).toBeDefined();

    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({ potSizeCm: null, soilMix: null, occurredOn: todayYmd() });
  });

  // A toggle whose state is only inferable from "the input went blank" is not an affordance. `aria-pressed`
  // is what makes the answer announced as well as visible — the same reasoning as finding 3's disabled
  // checkboxes in RepotEvaluationModal.vue.
  it('announces its pressed state, and un-pressing returns to an EMPTY unanswered field rather than ' +
    'restoring the number the owner just disowned', async () => {
    const w = await mountReal({ currentPotSizeCm: 18 });
    expect(findUnknownChip(w).attributes('aria-pressed')).toBe('false');

    await findUnknownChip(w).trigger('click');
    expect(findUnknownChip(w).attributes('aria-pressed')).toBe('true');

    await findUnknownChip(w).trigger('click');
    expect(findUnknownChip(w).attributes('aria-pressed')).toBe('false');
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('');
    expect(findConfirmButton(w).attributes('disabled')).toBeDefined();
  });

  it('round-trips a frozen snapshot whose `potSizeCm` is null back to "I don\'t know" — never to a number, ' +
    'and never to a blank field that silently re-blocks confirm', async () => {
    const w = mount(RepotDoneForm, {
      props: {
        open: false, currentPotSizeCm: 20, currentSoilMix: 'potting-mix',
        frozen: true, frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: null, soilMix: 'cactus-mix' } },
      },
      global: { mocks: { $t: (k: string) => k }, stubs: stubsWithRealInputs() },
    });
    await w.setProps({ open: true });

    expect(findUnknownChip(w).attributes('aria-pressed')).toBe('true');
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('');
    await findConfirmButton(w).trigger('click');
    expect(w.emitted('confirm')![0]![0]).toEqual({
      potSizeCm: null, soilMix: 'cactus-mix', occurredOn: '2026-08-01',
    });
  });

  it('a genuinely fresh re-open never opens PRE-PRESSED — an empty field is "not answered yet", which is ' +
    'not the same statement as "I don\'t know"', async () => {
    const w = await mountReal({ currentPotSizeCm: null });
    await findUnknownChip(w).trigger('click');
    expect(findUnknownChip(w).attributes('aria-pressed')).toBe('true');

    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect(findUnknownChip(w).attributes('aria-pressed')).toBe('false');
    expect(findConfirmButton(w).attributes('disabled')).toBeDefined();
  });

  // Found in a REAL browser while verifying finding 4, and introduced by this very fix: the substrate
  // segmented control already renders an "I don't know" in this same dialog, so a second bare one made two
  // buttons share an accessible name — the exact defect finding 4 exists to remove. The visible label stays
  // bare (it must match its siblings); the accessible name disambiguates and CONTAINS the visible text, as
  // WCAG 2.5.3 "Label in Name" requires.
  it('does not collide with the substrate control\'s own "I don\'t know" — the two buttons resolve to ' +
    'DIFFERENT accessible names', async () => {
    const w = await mountReal({ currentPotSizeCm: null });
    const names = w.findAll('button').map((b) => b.attributes('aria-label') ?? b.text().trim());
    const bare = names.filter((n) => n === 'repotDone.potSizeUnknown' || n === 'repotDone.substrateUnknown');

    expect(findUnknownChip(w).attributes('aria-label')).toBe('repotDone.potSizeUnknownAria');
    // The substrate one is the only button left carrying a bare "I don't know" name.
    expect(bare).toEqual(['repotDone.substrateUnknown']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('stays frozen with the rest of the form while an idempotency key is outstanding', async () => {
    const w = await mountReal({ currentPotSizeCm: 18, frozen: true, frozenSnapshot: { occurredOn: '2026-08-01', payload: { potSizeCm: 18, soilMix: null } } });
    expect(findUnknownChip(w).attributes('disabled')).toBeDefined();
    expect(findSameAsBeforeChip(w).attributes('disabled')).toBeDefined();
  });
});
