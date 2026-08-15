// @vitest-environment happy-dom
//
// repoteval:27's own adversarial code review (code-reviewer, opus, round 1) found this component had NO
// test file at all — "there is no test file for pages/index.vue or for TaskRow.vue at all — 503/503 green
// is vacuous here" — which is exactly how F1 (the `pendingVerdict: null` default silently disabling
// PlantDetail.vue's REPOT card) shipped undetected. This file closes that gap for real: it pins the
// `showEvaluate` state machine against BOTH of this component's real call sites, not a hypothetical one.
//
// The two real call sites, verified directly against the current source (not assumed):
//   - `pages/index.vue` passes `:pending-verdict="pendingEvaluationFor(plantId)?.verdict ?? null"` — ALWAYS
//     a defined value (a verdict string or `null`), NEVER omitted. This is the "opted in" shape.
//   - `components/PlantDetail.vue` ALSO passes it now — `:pending-verdict="t3.pendingEvaluation?.verdict
//     ?? null"` — so both call sites are opted in today. (CORRECTED 2026-08-02: this comment used to say
//     PlantDetail "never passes `:pending-verdict` at all", which was already false against the source when
//     it was written. The stale half mattered, because it described the exact case F1 was about: TaskRow's
//     former `pendingVerdict: null` DEFAULT made a non-opted-in caller indistinguishable from an opted-in
//     "no pending evaluation" one, which is why the prop is deliberately left UNDEFAULTED. The
//     not-opted-in shape is still real and still pinned below — it is simply no longer PlantDetail that
//     exercises it in production.)
import { describe, it, expect, vi } from 'vitest';
import { computed, ref, watch } from 'vue';
import { mount } from '@vue/test-utils';
import TaskRow from './TaskRow.vue';
import { todayYmd } from '../../utils/localDate.js';

vi.stubGlobal('computed', computed);
vi.stubGlobal('ref', ref);
vi.stubGlobal('watch', watch);
// `d` (vue-i18n's date formatter) is exercised by the V13 `reevaluateNoticeDate` computed — stub it as a
// plain passthrough so the pending-note branch renders without needing a real i18n date formatter.
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, d: (date: Date) => date.toISOString() }));
// `TaskRow.vue` imports `useTaskMeta` via an EXPLICIT `~/composables/useTaskMeta` path (unlike every other
// `components/ui/*.vue` file, which relies on Nuxt's auto-import) — `vi.stubGlobal` only intercepts a
// global reference, never an explicit import statement, so the module itself must be mocked.
vi.mock('~/composables/useTaskMeta', () => ({
  useTaskMeta: () => ({
    TASK_ICONS: { REPOT: 'magnifying-glass', WATER: 'droplet' },
    taskLabel: (t: string) => t,
  }),
}));

const stubs = {
  AppIcon: true,
  Badge: { template: '<span><slot /></span>' },
  Button: {
    props: ['size', 'color', 'variant', 'icon'],
    template: '<button class="stub-btn" :data-icon="icon" :data-variant="variant"><slot /></button>',
  },
};

function mountRow(props: Record<string, unknown> = {}) {
  return mount(TaskRow, {
    props: { task: 'REPOT', status: 'today', dueLabel: 'Today', ...props },
    global: { stubs, mocks: { t: (k: string) => k } },
  });
}

describe('UiTaskRow — the REPOT showEvaluate state machine (repoteval:27, F1 regression coverage)', () => {
  it('a caller that OMITS pendingVerdict entirely (a generic not-yet-migrated consumer — no real call site has this shape today) gets classic Done/Postpone, NOT "time to evaluate"', () => {
    const w = mountRow(); // no pendingVerdict prop at all — undefined
    const buttons = w.findAll('.stub-btn');
    const icons = buttons.map((b) => b.attributes('data-icon'));
    expect(icons).toContain('check'); // Done
    expect(icons).not.toContain('magnifying-glass'); // never the evaluate action
  });

  it('a caller that explicitly passes pendingVerdict: null (pages/index.vue\'s exact shape, no pending evaluation) shows "time to evaluate"', () => {
    const w = mountRow({ pendingVerdict: null });
    const buttons = w.findAll('.stub-btn');
    const icons = buttons.map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(icons).not.toContain('check');
  });

  it('a caller that passes pendingVerdict: \'REPOT\' (a verdict is in) gets classic Done/Postpone back', () => {
    const w = mountRow({ pendingVerdict: 'REPOT' });
    const buttons = w.findAll('.stub-btn');
    const icons = buttons.map((b) => b.attributes('data-icon'));
    expect(icons).toContain('check');
    expect(icons).not.toContain('magnifying-glass');
  });

  it('a caller that passes pendingVerdict: \'RE-EVALUATE\' with NO pendingReevaluateOn (defensive: missing date treated as arrived, per V13 constraint 5) still shows "time to evaluate"', () => {
    const w = mountRow({ pendingVerdict: 'RE-EVALUATE' });
    const buttons = w.findAll('.stub-btn');
    const icons = buttons.map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(icons).not.toContain('check');
  });

  it('a non-REPOT task is never affected by pendingVerdict at all, omitted or not', () => {
    const withNone = mountRow({ task: 'WATER' });
    const withNull = mountRow({ task: 'WATER', pendingVerdict: null });
    for (const w of [withNone, withNull]) {
      const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
      expect(icons).toContain('check');
      expect(icons).not.toContain('magnifying-glass');
    }
  });
});

// V13: the card must not offer the evaluate affordance while a RE-EVALUATE verdict's `reevaluateOn` has
// not arrived yet (the server 409s that exact attempt — see repot-evaluation.write-core.ts). "Arrived" is
// answered on the OWNER's local calendar day via `dueState` (utils/tasks.ts), never a UTC-derived
// comparison, so these dates are built from local Date components, not toISOString().
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function daysFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return ymdLocal(d);
}

describe('UiTaskRow — V13: RE-EVALUATE gated by reevaluateOn (server refuses an early re-evaluation)', () => {
  it('reevaluateOn in the FUTURE: hides the evaluate affordance AND the classic Done/Postpone, shows the pending note instead', () => {
    const w = mountRow({ pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: daysFromToday(5) });
    const buttons = w.findAll('.stub-btn');
    const icons = buttons.map((b) => b.attributes('data-icon'));
    expect(icons).not.toContain('magnifying-glass');
    expect(icons).not.toContain('check');
    expect(w.find('.mp-taskrow__pending-note').exists()).toBe(true);
  });

  it('reevaluateOn is TODAY: the affordance is offered again (arrived, not just past)', () => {
    const w = mountRow({ pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: daysFromToday(0) });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(w.find('.mp-taskrow__pending-note').exists()).toBe(false);
  });

  it('reevaluateOn in the PAST: the affordance is offered (overdue counts as arrived)', () => {
    const w = mountRow({ pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: daysFromToday(-3) });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(w.find('.mp-taskrow__pending-note').exists()).toBe(false);
  });

  it('reevaluateOn is null (defensive: should not happen for a real RE-EVALUATE row) is treated as arrived', () => {
    const w = mountRow({ pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: null });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(w.find('.mp-taskrow__pending-note').exists()).toBe(false);
  });

  it('a REPOT verdict (already confirmed) is unaffected by pendingReevaluateOn — classic Done/Postpone regardless', () => {
    const w = mountRow({ pendingVerdict: 'REPOT', pendingReevaluateOn: daysFromToday(5) });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('check');
    expect(icons).not.toContain('magnifying-glass');
    expect(w.find('.mp-taskrow__pending-note').exists()).toBe(false);
  });
});

// QA round-3 defect D3, presentation half. `care-plan.service.ts`'s `todaysTasks` now surfaces a REPOT row
// on the strength of an unresolved 'REPOT' verdict alone, whatever its computed date says, and reports
// `nextDueOn` UNCHANGED (nothing rewrote the schedule). So a plant evaluated early arrives here with
// `status: 'upcoming'` and a due label like "in 675 days" — under which the card would offer an urgent
// action with a not-due-for-two-years badge and, worse, NO Postpone at all, since Postpone is hidden for
// 'upcoming'. Postpone was deliberately removed from plant detail, so Today is the only place that offers
// the Done | Postpone pair the verdict modal's own copy promises the owner.
describe('UiTaskRow — QA D3: an unresolved REPOT verdict outranks an upcoming due date', () => {
  const upcomingWithVerdict = {
    task: 'REPOT', status: 'upcoming', dueLabel: 'in 675 days', pendingVerdict: 'REPOT',
  } as const;

  it('offers POSTPONE alongside Done on an upcoming REPOT that carries a verdict — the affordance the ' +
    'verdict modal promises, in the only place that still has it', () => {
    const w = mountRow({ ...upcomingWithVerdict });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('check');
    expect(icons).toContain('clock');
  });

  it('replaces the misleading due label with the verdict\'s own badge, instead of announcing an urgent ' +
    'action as not due for two years', () => {
    const w = mountRow({ ...upcomingWithVerdict });
    expect(w.text()).toContain('repotEval.verdictNowBadge');
    expect(w.text()).not.toContain('in 675 days');
  });

  it('leaves an OVERDUE verdict-carrying row completely alone — overdue is both more urgent and more ' +
    'accurate than "repot now", so the date keeps the badge', () => {
    const w = mountRow({ task: 'REPOT', status: 'overdue', dueLabel: '3 days late', pendingVerdict: 'REPOT' });
    expect(w.text()).toContain('3 days late');
    expect(w.text()).not.toContain('repotEval.verdictNowBadge');
    expect(w.findAll('.stub-btn').map((b) => b.attributes('data-icon'))).toContain('clock');
  });

  it('does NOT touch an upcoming REPOT with a RE-EVALUATE verdict — that one means "come back later", ' +
    'and re-badging it "repot now" would be a lie', () => {
    const w = mountRow({
      task: 'REPOT', status: 'upcoming', dueLabel: 'in 30 days',
      pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: '2099-01-01',
    });
    expect(w.text()).toContain('in 30 days');
    expect(w.text()).not.toContain('repotEval.verdictNowBadge');
  });

  it('does NOT touch a non-REPOT upcoming row, whatever a stray pendingVerdict says', () => {
    const w = mountRow({ task: 'WATER', status: 'upcoming', dueLabel: 'in 4 days', pendingVerdict: 'REPOT' });
    expect(w.text()).toContain('in 4 days');
    expect(w.text()).not.toContain('repotEval.verdictNowBadge');
  });
});

// Owner request, 2026-08-07. `/plants/:id` keeps a standalone "Done" beside "Time to evaluate": the owner
// may have repotted the plant already — for whatever reason, and possibly on a day that is not today — and
// must be able to record it without first answering a questionnaire about a plant that is now in its new
// pot. Today does NOT change: one action per card there, and Done appears only once a verdict has said the
// repot is needed.
//
// Expressed as a PROP on this one shared component rather than a second component, because both surfaces
// render the same row and a fork is how the next change silently misses one of them.
describe('UiTaskRow — allowStandaloneDone: Done beside "time to evaluate", on the plant page only', () => {
  it('offers BOTH actions when the surface opts in and no verdict is pending — the questionnaire AND a Done', () => {
    const w = mountRow({ pendingVerdict: null, allowStandaloneDone: true });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(icons).toContain('check');
  });

  // THE TEST THAT MUST GO RED IF DONE EVER LEAKS ONTO TODAY. Today's exact prop shape is "pendingVerdict
  // passed, allowStandaloneDone absent" — asserted here for BOTH states in which the state machine
  // withholds Done, since either one leaking would put a second action on a triage card.
  it('does NOT offer Done on a surface that did not opt in — Today, unchanged, in both withholding states', () => {
    const noVerdict = mountRow({ pendingVerdict: null });
    expect(noVerdict.findAll('.stub-btn').map((b) => b.attributes('data-icon'))).toEqual(['magnifying-glass']);

    const pendingReevaluate = mountRow({ pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: daysFromToday(5) });
    expect(pendingReevaluate.findAll('.stub-btn')).toHaveLength(0);
    expect(pendingReevaluate.find('.mp-taskrow__pending-note').exists()).toBe(true);
  });

  // The owner may contradict the app: the questionnaire said "not yet, back in N days" and they repotted
  // anyway. The card must still let them say so — the note explains the app's position, the Done records
  // theirs. (The server side of the same case: `completeRepotCore` SUPERSEDES that RE-EVALUATE row rather
  // than resolving it, and the client must not name it — see utils/repotEvaluation.test.ts.)
  it('offers Done alongside the "we\'ll ask again on <date>" note, when the owner repotted anyway', () => {
    const w = mountRow({
      pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: daysFromToday(90), allowStandaloneDone: true,
    });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(w.find('.mp-taskrow__pending-note').exists()).toBe(true);
    expect(icons).toContain('check');
    expect(icons).not.toContain('magnifying-glass'); // the date has not arrived; the server would 409
  });

  // A REPOT Postpone means "yes, it needs it, but I can't right now" — a CONCLUSION, which is exactly what
  // the questionnaire replaced. There is no postponing a repot nobody has established is needed.
  it('never unlocks Postpone, in either withholding state', () => {
    for (const props of [
      { pendingVerdict: null, allowStandaloneDone: true },
      { pendingVerdict: 'RE-EVALUATE', pendingReevaluateOn: daysFromToday(5), allowStandaloneDone: true },
    ]) {
      const icons = mountRow(props).findAll('.stub-btn').map((b) => b.attributes('data-icon'));
      expect(icons).not.toContain('clock');
    }
  });

  it('changes NOTHING once a REPOT verdict is in — the classic Done | Postpone pair, opted in or not', () => {
    for (const extra of [{}, { allowStandaloneDone: true }]) {
      const icons = mountRow({ pendingVerdict: 'REPOT', ...extra })
        .findAll('.stub-btn').map((b) => b.attributes('data-icon'));
      expect(icons).toContain('check');
      expect(icons).toContain('clock');
      expect(icons).not.toContain('magnifying-glass');
    }
  });

  it('is inert on every non-REPOT task — a WATER row is byte-identical opted in or not', () => {
    for (const extra of [{}, { allowStandaloneDone: true }]) {
      const icons = mountRow({ task: 'WATER', status: 'today', ...extra })
        .findAll('.stub-btn').map((b) => b.attributes('data-icon'));
      expect(icons).toEqual(['check', 'clock']);
    }
  });

  // Rewritten (fix-taskrow-repot-date). This pair used to read "…and ideally I can set the date too" and
  // proved it by calling `setValue` on the box — but `allowStandaloneDone` does NOT change what makes this
  // input readonly: `:readonly="task === 'REPOT'"` (TaskRow.vue) is unconditional on the task alone, so the
  // standalone branch's back-date is JUST as readonly as the classic one. A real owner cannot type a custom
  // historical date here either way — `PlantDetail.vue`'s `onDone` always routes a REPOT Done through
  // `onRepotDone`, which opens `RepotDoneForm` (Task 25's own, genuinely editable, `occurredOn` field) —
  // that form is where "I repotted it a few days ago" actually gets recorded, never this card.
  it('the standalone-Done branch back-date is readonly too — the box shows (and Done emits) the seeded default, not a value typed here', async () => {
    const w = mountRow({ pendingVerdict: null, allowStandaloneDone: true, withDoneDate: true });
    const input = w.find('input[type="date"]');
    expect(input.attributes('readonly')).toBeDefined();
    expect((input.element as HTMLInputElement).value).toBe(todayYmd());

    await w.findAll('.stub-btn').find((b) => b.attributes('data-icon') === 'check')!.trigger('click');
    expect(w.emitted('done')![0]).toEqual([{ task: 'REPOT', occurredOn: todayYmd() }]);
  });

  // A REPOT `occurredOn: undefined` is no longer reachable at all: the field that used to go blank when
  // "the owner typed no date" is READONLY now (Task 26), so there is no owner action that leaves it empty —
  // it always carries the seeded default. `allowStandaloneDone` makes no difference to that.
  it('never emits occurredOn: undefined for REPOT any more — the readonly field cannot be left blank', async () => {
    const w = mountRow({ pendingVerdict: null, allowStandaloneDone: true, withDoneDate: true });
    await w.findAll('.stub-btn').find((b) => b.attributes('data-icon') === 'check')!.trigger('click');
    expect(w.emitted('done')![0]).toEqual([{ task: 'REPOT', occurredOn: todayYmd() }]);
  });
});

// The back-date is not a sticky default. `PlantDetail.vue` keys its rows by TASK, so the instance survives
// the post-completion refresh and a date typed once rode along on the next Done — silently, on the one
// input whose whole purpose is "record it on the day it actually happened".
describe('UiTaskRow — the back-date does not survive a recorded completion', () => {
  const clickDone = (w: ReturnType<typeof mountRow>) =>
    w.findAll('.stub-btn').find((b) => b.attributes('data-icon') === 'check')!.trigger('click');

  it('clears the typed date once the completion is APPLIED, so the NEXT Done starts empty', async () => {
    const w = mountRow({ withDoneDate: true, task: 'WATER', status: 'overdue', dueLabel: '2 days overdue' });
    await w.find('input[type="date"]').setValue('2026-08-01');
    await clickDone(w);
    expect(w.emitted('done')![0]).toEqual([{ task: 'WATER', occurredOn: '2026-08-01' }]);

    // The parent recorded it and bumped the APPLIED counter; the schedule moved too.
    await w.setProps({ status: 'upcoming', dueLabel: 'in 7 days', appliedCompletions: 1 });
    expect((w.find('input[type="date"]').element as HTMLInputElement).value).toBe('');
    await clickDone(w);
    expect(w.emitted('done')![1]).toEqual([{ task: 'WATER', occurredOn: undefined }]);
  });

  // ⚠️ THE REGRESSION THE OLD MECHANISM COULD NOT FAIL ON (spec §2.4, the textual-identity trap). The
  // recomputed schedule renders the SAME sentence it already showed — Vue's `watch` fires on a CHANGE, so
  // a label-keyed reset never runs and Hecho stays enabled over a stale date, reading as a failed submit.
  it('clears it even when the due label renders the IDENTICAL string it already showed', async () => {
    const w = mountRow({ withDoneDate: true, task: 'WATER', status: 'today', dueLabel: 'Today' });
    await w.find('input[type="date"]').setValue('2026-08-01');
    await w.setProps({ dueLabel: 'Today', appliedCompletions: 1 }); // label byte-identical, on purpose
    expect((w.find('input[type="date"]').element as HTMLInputElement).value).toBe('');
  });

  // ⚠️ AND IT MUST NOT FIRE ON A NON-APPLIED OUTCOME (spec §3.2). The parent does not bump the counter for
  // an "already recorded on that day" result, so the typed date STAYS — a row that silently cleared it
  // would tell the owner his back-date was recorded when nothing was written.
  it('keeps the typed date when the submit changed nothing', async () => {
    const w = mountRow({ withDoneDate: true, task: 'WATER', status: 'today', dueLabel: 'Today' });
    await w.find('input[type="date"]').setValue('2026-08-01');
    await w.setProps({ outcomeNote: 'tasks.alreadyRecorded.neutral' }); // no counter bump
    expect((w.find('input[type="date"]').element as HTMLInputElement).value).toBe('2026-08-01');
  });

  it('renders the outcome sentence the parent hands it, and nothing when there is none', async () => {
    const silent = mountRow({ task: 'FERTILIZE', status: 'today' });
    expect(silent.find('.mp-taskrow__outcome-note').exists()).toBe(false);
    const noisy = mountRow({
      task: 'FERTILIZE', status: 'today', outcomeNote: 'tasks.alreadyRecorded.fertilizeSameDay',
    });
    expect(noisy.find('.mp-taskrow__outcome-note').text()).toBe('tasks.alreadyRecorded.fertilizeSameDay');
  });

  // A locale switch used to reset the box as a documented false positive of the label watcher. It no
  // longer can, and that is strictly better: nothing the owner did not do touches his typed date.
  it('a due-label change ALONE never touches the typed date any more', async () => {
    const w = mountRow({ withDoneDate: true, task: 'WATER', status: 'today', dueLabel: 'Today' });
    await w.find('input[type="date"]').setValue('2026-08-01');
    await w.setProps({ dueLabel: 'Hoy' });
    expect((w.find('input[type="date"]').element as HTMLInputElement).value).toBe('2026-08-01');
  });

  it('does NOT clear on the emit itself — the REPOT emit only OPENS the Done form, it does not complete it', async () => {
    // Load-bearing negative. `PlantDetail.vue`'s `onRepotDone` captures the emitted `occurredOn` into
    // `doneFormOccurredOn`; clearing on the emit would mean that dismissing the form and pressing Done
    // again re-emits `undefined`, and `onRepotDoneConfirm`'s `|| today()` would then write the repot on
    // TODAY instead of the day the owner typed — a silent wrong-day write traded for a stale one.
    //
    // Rewritten (level-1 integration review, finding 4 — the D17 pattern left behind in this one test). The
    // REPOT back-date input is `readonly` (TaskRow.vue:259) — a real owner cannot type into it at all — so
    // calling `setValue('2026-08-01')` on it, as this test used to, proved only that jsdom does not enforce
    // `readonly`: the assertion would pass even if the component's own seeding were completely broken,
    // because the value it checked was one WE injected around the readonly guard, not one the component
    // produced. This version reads the real seeded value straight off the DOM (`todayYmd()`, the only value
    // REPOT ever seeds — see the sibling test below, substrate:26) and proves THAT value survives two
    // emits in a row, untouched by us.
    const w = mountRow({ pendingVerdict: null, allowStandaloneDone: true, withDoneDate: true });
    const input = w.find('input[type="date"]').element as HTMLInputElement;
    expect(input.hasAttribute('readonly')).toBe(true);
    expect(input.value).toBe(todayYmd());

    await clickDone(w);
    await clickDone(w); // the owner dismissed the form and pressed Done again; nothing has completed yet
    expect(w.emitted('done')![1]).toEqual([{ task: 'REPOT', occurredOn: todayYmd() }]);
  });
});

// Task 26 (substrate plan): once RepotDoneForm owns its own editable `occurredOn` (Task 25), this row's
// back-date becomes the ONE thing it seeds the form with — not a second live input the owner could edit
// independently. Two editable date surfaces for one submission is a disagreement, not a redundancy.
describe('UiTaskRow — the REPOT back-date is display-only, seeding the completion form (substrate:26)', () => {
  it('REPOT: the back-date is DISPLAY-ONLY — it seeds the form and is not editable here', () => {
    const w = mountRow({ withDoneDate: true, pendingVerdict: 'REPOT' });
    const input = w.find('input[type="date"]');
    expect(input.attributes('readonly')).toBeDefined();
  });

  // Rewritten (fix-taskrow-repot-date). The previous version of this test called `setValue('2026-08-01')`
  // on the readonly input before asserting the emit — a REAL owner cannot type into a `readonly` field at
  // all (no keyboard entry, no picker), so that call proved the wiring FROM the input to the emit works,
  // never that the input actually HAS a shown value to emit. It was a false green: `doneDate` shipped
  // initialized to `''` and never seeded for REPOT, so in a real browser the field rendered BLANK and Done
  // emitted `occurredOn: undefined` — this exact test still passed throughout, because `setValue` supplied
  // the missing value the component itself was failing to produce. The fix asserts the REAL rendered value
  // directly — no `setValue` — then confirms that same value is what gets emitted.
  it('REPOT: the input is seeded with a real shown date (today) — not blank — and that is what gets emitted', async () => {
    const w = mountRow({ withDoneDate: true, pendingVerdict: 'REPOT' });
    const input = w.find('input[type="date"]').element as HTMLInputElement;
    expect(input.value).toBe(todayYmd());

    await w.findAll('.stub-btn').find((b) => b.attributes('data-icon') === 'check')!.trigger('click');
    expect(w.emitted('done')![0]).toEqual([{ task: 'REPOT', occurredOn: todayYmd() }]);
  });

  // The seam substrate:29 depends on (`pages/index.vue`'s `seed-occurred-on`) does not render this input at
  // all — the Today page never passes `withDoneDate` — so the seed must survive independently of the input
  // being on screen: a real value must flow through the `done` emit even when there is nothing to read it
  // off of in the DOM.
  it('REPOT: emits a real occurredOn even when the back-date input never renders (withDoneDate omitted, pages/index.vue\'s shape)', async () => {
    const w = mountRow({ pendingVerdict: 'REPOT' });
    expect(w.find('input[type="date"]').exists()).toBe(false);

    await w.findAll('.stub-btn').find((b) => b.attributes('data-icon') === 'check')!.trigger('click');
    expect(w.emitted('done')![0]).toEqual([{ task: 'REPOT', occurredOn: todayYmd() }]);
  });

  // V3 fix (code review) — REPOT's date box is READONLY (the test right above pins that), so `doneDate` is
  // never something the owner typed; it was only ever the SEED `repotDoneDateDefault()` computed at
  // mount/reset time, and it could go stale exactly the way AF-1 found Today's own `today` going stale: a
  // tab left open across local midnight kept emitting the day the row happened to MOUNT on, not the day
  // Done was actually pressed. That stale seed then won over `RepotDoneForm.vue`'s own live `todayYmd()`
  // fallback (`props.seedOccurredOn || todayYmd()`), because a non-empty seed is always truthy. `onDone`
  // now re-reads `todayYmd()` live for REPOT instead of trusting the frozen `doneDate` ref.
  it('REPOT: a Done pressed after the tab crossed local midnight emits the NEW day, not the day the row mounted on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 50)); // Jan 1, 23:59:50 local — the row mounts here
      const w = mountRow({ pendingVerdict: 'REPOT' });
      // No re-render/prop change happens — nothing that would trigger the `appliedCompletions` watcher's
      // reset. The tab simply sits open, exactly the AF-1 scenario.
      vi.setSystemTime(new Date(2026, 0, 2, 0, 0, 10)); // rolled past local midnight
      await w.findAll('.stub-btn').find((b) => b.attributes('data-icon') === 'check')!.trigger('click');
      expect(w.emitted('done')![0]).toEqual([{ task: 'REPOT', occurredOn: '2026-01-02' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('every OTHER task keeps an editable back-date, unchanged', () => {
    const w = mountRow({ task: 'WATER', withDoneDate: true });
    const input = w.find('input[type="date"]');
    expect(input.attributes('readonly')).toBeUndefined();
  });

  it('the back-date input carries a `max` of today (A4)', () => {
    const repot = mountRow({ withDoneDate: true, pendingVerdict: 'REPOT' });
    expect(repot.find('input[type="date"]').attributes('max')).toBe(todayYmd());

    const water = mountRow({ task: 'WATER', withDoneDate: true });
    expect(water.find('input[type="date"]').attributes('max')).toBe(todayYmd());
  });
});

// The measure affordance (measured:22, spec §4.8): an affordance on the WATER task, never a separate task
// or mode — `suggestMeasuring` is deliberately undefaulted so an un-opted-in caller renders byte-identical
// to before this prop existed, the same pattern `pendingVerdict` already established.
describe('UiTaskRow — the measure affordance on WATER (measured:22)', () => {
  it('renders NO measure button when suggestMeasuring is omitted — an un-opted caller is unchanged', () => {
    const w = mountRow({ task: 'WATER' });
    expect(w.text()).not.toContain('reading.measureAction');
  });

  it('renders the measure button unemphasised at false and emphasised at true', () => {
    const unemphasised = mountRow({ task: 'WATER', suggestMeasuring: false });
    const unemphasisedBtn = unemphasised.findAll('.stub-btn').find((b) => b.text() === 'reading.measureAction');
    expect(unemphasisedBtn).toBeTruthy();
    expect(unemphasisedBtn!.attributes('data-variant')).toBe('ghost');

    const emphasised = mountRow({ task: 'WATER', suggestMeasuring: true });
    const emphasisedBtn = emphasised.findAll('.stub-btn').find((b) => b.text() === 'reading.measureAction');
    expect(emphasisedBtn).toBeTruthy();
    expect(emphasisedBtn!.attributes('data-variant')).toBe('solid');
  });

  it('never renders the measure button on a non-WATER task, even when the prop is passed', () => {
    const w = mountRow({ task: 'REPOT', pendingVerdict: 'REPOT', suggestMeasuring: true });
    expect(w.text()).not.toContain('reading.measureAction');
  });

  it('emits `measure` when clicked', async () => {
    const w = mountRow({ task: 'WATER', suggestMeasuring: true });
    const btn = w.findAll('.stub-btn').find((b) => b.text() === 'reading.measureAction')!;
    await btn.trigger('click');
    expect(w.emitted('measure')).toHaveLength(1);
  });
});

// The survey shape itself — `showEvaluate` (the questionnaire button), `verdictWithholdsDone` (Done AND
// Postpone withheld until a verdict exists) — was gated to REPOT by a CONDITION, not by structure. This
// generalises the gate via `canSurvey`, so a WATER row can offer the same "question first" shape once the
// owner has a way to answer it. It does NOT build the watering survey itself — that is a later task.
//
// THE LOAD-BEARING CONSTRAINT: REPOT can always be surveyed (its signs are visual, free, answerable by
// looking at the pot). WATER cannot — its survey needs a soil reading, which needs an instrument the owner
// may not have selected. Withholding Done from an owner who declined to buy a moisture meter would lock him
// out of his own app over a feature he chose not to use, so `canSurvey: false` (the default) must leave the
// row byte-identical to what it has always been.
describe('UiTaskRow — the survey shape is task-agnostic (spec §5.1)', () => {
  // ⚠️ REWRITTEN 2026-08-11 (QA round 4, DEF-3; owner-ruled). Its old title was "...withholds Done AND
  // Postpone", and that second half was the defect: an owner who had selected an instrument could not
  // defer a watering at all — the row offered "¿Necesitas regar?" and nothing else, and the only escape
  // was to switch his probe off in Settings. "No tengo tiempo ahorita" is an answer about HIS OWN
  // AVAILABILITY; no measurement can answer it, so demanding one is incoherent. Done stays withheld for
  // the opposite reason: recording a watering while the app is still offering to tell you whether to water
  // defeats the feature. The Done half of this case is therefore UNCHANGED and still asserted.
  it('a WATER row that CAN be surveyed offers the survey, withholds Done, and KEEPS Postpone', () => {
    const w = mountRow({ task: 'WATER', status: 'today', canSurvey: true });
    // The copy IS the reframe — a QUESTION ("Do you need to water?"), never REPOT's "Time to evaluate".
    // `t` is mocked as identity (see the top of this file), so the rendered text is the i18n KEY itself —
    // pinning it here is what catches a REPOT-namespaced key silently leaking onto the WATER row.
    expect(w.text()).toContain('reading.surveyQuestion');
    expect(w.text()).not.toContain('repotEval.cardAction');
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass'); // the survey affordance
    expect(icons).not.toContain('check'); // Done withheld — unchanged
    expect(icons).toContain('clock'); // ⚠️ DEF-3: Posponer is BACK
  });

  // §2.1's opted-in surface, beside the case above which pins Today's default. Same row, same instrument,
  // one prop apart — which is the entire difference between the two surfaces.
  it('the OPTED-IN surface offers the survey AND Done on the same WATER row', () => {
    const w = mountRow({
      task: 'WATER', status: 'today', canSurvey: true, allowStandaloneDone: true, withDoneDate: true,
    });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(icons).toContain('check');
    expect(icons).toContain('clock');
    expect(w.find('input[type="date"]').exists()).toBe(true);
  });

  // ⚠️ THE SCOPE OF DEF-3, AND THE HALF THAT MUST NOT MOVE. REPOT's own withholding is untouched: a REPOT
  // Posponer means "yes, it needs it, but I can't right now" — a CONCLUSION — and there is no such thing as
  // postponing a repot nobody has established is needed. A fix written as "the survey never withholds
  // Postpone" (dropping the `task !== 'WATER'` term) passes the case above and turns this one RED.
  it('DEF-3 is WATER-only — a REPOT questionnaire still withholds Postpone', () => {
    const w = mountRow({ task: 'REPOT', status: 'today', pendingVerdict: null });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('magnifying-glass');
    expect(icons).not.toContain('check');
    expect(icons).not.toContain('clock');
  });

  // The second clause of the rule is unchanged and still binds: a task that is not due yet has nothing to
  // postpone, survey or no survey. A fix that returned Posponer unconditionally turns this RED.
  it('DEF-3 does not put Posponer on a WATER row that is not due yet', () => {
    const w = mountRow({ task: 'WATER', status: 'upcoming', canSurvey: true });
    expect(w.findAll('.stub-btn').map((b) => b.attributes('data-icon'))).not.toContain('clock');
  });

  // THE LOAD-BEARING CASE. An owner with no instrument must not be locked out of his own app.
  it('a WATER row with NO way to measure behaves exactly as it does today', () => {
    const explicit = mountRow({ task: 'WATER', status: 'today', canSurvey: false });
    const omitted = mountRow({ task: 'WATER', status: 'today' }); // canSurvey omitted — default false
    for (const w of [explicit, omitted]) {
      expect(w.text()).not.toContain('reading.surveyQuestion'); // no survey copy at all
      const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
      expect(icons).not.toContain('magnifying-glass'); // no survey affordance
      expect(icons).toContain('check'); // Done, exactly as before
      expect(icons).toContain('clock'); // Postpone, exactly as before
    }
  });

  // ⚠️ REWRITTEN 2026-08-11 (QA round 4, DEF-3). The claim under test is unchanged and is the important
  // one: `allowStandaloneDone` re-opens Done and NEVER unlocks Postpone. What changed is that Postpone is
  // no longer WITHHELD on this row at all, so its presence here says nothing about that prop — it is
  // DEF-3's doing. Asserted on a not-yet-due row instead, which is the one state where the two rules can
  // still be told apart: `allowStandaloneDone` re-opens Done there, and Postpone stays away because the
  // task is not due. A fix that let `allowStandaloneDone` unlock Postpone turns this RED.
  it('allowStandaloneDone re-opens Done and NEVER Postpone, exactly as it does for REPOT', () => {
    const due = mountRow({ task: 'WATER', status: 'today', canSurvey: true, allowStandaloneDone: true });
    expect(due.text()).toContain('reading.surveyQuestion'); // the survey question is still on offer
    const dueIcons = due.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(dueIcons).toContain('magnifying-glass'); // the survey is still on offer
    expect(dueIcons).toContain('check'); // Done re-opened

    const upcoming = mountRow({
      task: 'WATER', status: 'upcoming', canSurvey: true, allowStandaloneDone: true,
    });
    const upcomingIcons = upcoming.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(upcomingIcons).toContain('check'); // Done re-opened here too
    expect(upcomingIcons).not.toContain('clock'); // and Postpone is STILL not unlocked by it
  });

  it('every REPOT case is unchanged', () => {
    // `canSurvey` is inert on REPOT — its own state machine is entirely `pendingVerdict`-driven and does not
    // consult this prop at all, whatever value a caller happens to pass. And REPOT keeps its OWN copy key —
    // branching the label on `task` must never touch the string a REPOT row was already showing.
    const noVerdict = mountRow({ pendingVerdict: null, canSurvey: true });
    expect(noVerdict.findAll('.stub-btn').map((b) => b.attributes('data-icon'))).toEqual(['magnifying-glass']);
    expect(noVerdict.text()).toContain('repotEval.cardAction');
    expect(noVerdict.text()).not.toContain('reading.surveyQuestion');

    const repotVerdict = mountRow({ pendingVerdict: 'REPOT', canSurvey: false });
    const repotIcons = repotVerdict.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(repotIcons).toContain('check');
    expect(repotIcons).toContain('clock');
    expect(repotIcons).not.toContain('magnifying-glass');

    const omitted = mountRow(); // no canSurvey prop at all — REPOT, no pendingVerdict opt-in
    const omittedIcons = omitted.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(omittedIcons).toContain('check');
    expect(omittedIcons).not.toContain('magnifying-glass');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// QA 2026-08-11, finding 3 — A MEASURED "WATER NOW" READS AS DUE TODAY (owner-ruled;
// docs/care-engine.md §7.20.15).
//
// The owner's words: the schedule was a *prediction*, the measurement is the *observation*, and measuring
// so that the prediction still wins defeats the point of measuring. MEASURED before the fix: a survey
// answering "riega ahora" on a task the calendar put nine days out left the row saying "faltan 9 días",
// rendered NO Posponer (it is withheld on an `upcoming` row), consumed the survey for the day, and put the
// plant in Today not at all. The app said water it now and left no trace anywhere the owner would look.
//
// The API's half SURFACES the row (`nextDueOn` reported unchanged, nothing written); this component's half
// is what turns it into a card the owner can act on. The RULE itself lives in `utils/waterSurvey.ts` and is
// applied identically by both pages to the status they hand `onDone` — a local copy here is how the badge
// and the handler would come to disagree.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('UiTaskRow — a measured WATER_NOW overrides an upcoming due date', () => {
  const upcomingWater = { task: 'WATER', status: 'upcoming', dueLabel: 'in 9 days' } as const;

  // THE BEFORE HALF. Without it every assertion below would pass just as well against a component that
  // ignored `status` entirely and always rendered "today".
  it('leaves an upcoming WATER row alone when nothing was measured today', () => {
    const w = mountRow({ ...upcomingWater, todaysVerdict: null, canSurvey: false });
    expect(w.text()).toContain('in 9 days');
    expect(w.text()).not.toContain('reading.verdictNowBadge');
    expect(w.findAll('.stub-btn').map((b) => b.attributes('data-icon'))).not.toContain('clock');
  });

  it('renders POSPONER — the control the whole finding is about — once today\'s reading says WATER_NOW', () => {
    const w = mountRow({ ...upcomingWater, todaysVerdict: 'WATER_NOW', canSurvey: false });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).toContain('check'); // Hecho
    expect(icons).toContain('clock'); // Posponer — withheld on `upcoming`, restored by the measurement
  });

  it('replaces the contradictory "in 9 days" label with the verdict\'s own badge', () => {
    const w = mountRow({ ...upcomingWater, todaysVerdict: 'WATER_NOW', canSurvey: false });
    expect(w.text()).toContain('reading.verdictNowBadge');
    expect(w.text()).not.toContain('in 9 days');
    // WATER's own key, never REPOT's — branching the badge on the task must not let one row borrow the
    // other's wording ("Trasplantar ya" on a watering).
    expect(w.text()).not.toContain('repotEval.verdictNowBadge');
  });

  // The two verdicts that must change nothing, and they are wrong in opposite directions: POSTPONE is the
  // instruction to leave the task alone (it moved its own date), and NONE decided nothing at all.
  it.each(['POSTPONE', 'NONE'] as const)('does NOT override on a %s verdict', (verdict) => {
    const w = mountRow({ ...upcomingWater, todaysVerdict: verdict, canSurvey: false });
    expect(w.text()).toContain('in 9 days');
    expect(w.text()).not.toContain('reading.verdictNowBadge');
  });

  it('never touches a NON-WATER row, whatever verdict is passed alongside it', () => {
    const w = mountRow({ task: 'FERTILIZE', status: 'upcoming', dueLabel: 'in 9 days', todaysVerdict: 'WATER_NOW' });
    expect(w.text()).toContain('in 9 days');
    expect(w.text()).not.toContain('reading.verdictNowBadge');
  });

  // Scoped to `upcoming`, exactly like the REPOT sibling: an already-overdue watering keeps its overdue
  // reading, which is both more urgent and more accurate than "water now".
  it('leaves an OVERDUE row alone — overdue outranks "water now"', () => {
    const w = mountRow({ task: 'WATER', status: 'overdue', dueLabel: '3 days late', todaysVerdict: 'WATER_NOW' });
    expect(w.text()).toContain('3 days late');
    expect(w.text()).not.toContain('reading.verdictNowBadge');
  });

  // A caller that has not opted in renders exactly as before — the prop defaults to `null`, and this is the
  // shape every non-WATER consumer of this component has.
  it('a caller that OMITS todaysVerdict renders unchanged', () => {
    const w = mountRow({ ...upcomingWater });
    expect(w.text()).toContain('in 9 days');
    expect(w.text()).not.toContain('reading.verdictNowBadge');
  });

  // ---- QA round 3, HIGH (2026-08-11): the promotion's EXIT, at the badge ------------------------------
  //
  // A verdict is a stored fact and nothing retracts it, so the override above had no end: press Hecho and
  // the card came back byte-identical — "Riega ahora", Hecho AND Posponer — surviving a full reload, and
  // the only rational reading left to the owner was "it didn't work". `promptAnsweredToday` retires it.
  //
  // Mutation, both directions: dropping `&& !promptAnsweredToday` from `effectiveTaskStatus` turns the two
  // cases below RED; inverting it to `&& promptAnsweredToday` turns the three un-answered cases above RED.
  it('drops the verdict badge once the owner has ANSWERED the card', () => {
    const w = mountRow({ ...upcomingWater, todaysVerdict: 'WATER_NOW', promptAnsweredToday: true, canSurvey: false });
    expect(w.text()).toContain('in 9 days');
    expect(w.text()).not.toContain('reading.verdictNowBadge');
  });

  // Posponer is the control the finding was ABOUT, so it is the one that has to go back: the card is no
  // longer claiming the watering is due, and Posponer is withheld on an `upcoming` row.
  it('withdraws POSPONER again once the card has been answered', () => {
    const w = mountRow({ ...upcomingWater, todaysVerdict: 'WATER_NOW', promptAnsweredToday: true, canSurvey: false });
    const icons = w.findAll('.stub-btn').map((b) => b.attributes('data-icon'));
    expect(icons).not.toContain('clock');
  });

  // The exit is not a general mute — a genuinely OVERDUE watering keeps saying so after the owner answers
  // some other prompt that day. (A mutation that returns `'upcoming'` whenever the day was answered would
  // silence a real overdue row, and this is what catches it.)
  it('never quiets a row the calendar itself made overdue', () => {
    const w = mountRow({
      task: 'WATER', status: 'overdue', dueLabel: '3 days late',
      todaysVerdict: 'WATER_NOW', promptAnsweredToday: true,
    });
    expect(w.text()).toContain('3 days late');
  });

  // A caller that omits the new prop renders exactly as it did before it existed — the default is `false`,
  // which is the honest "nothing has answered this" reading, and it is what the Today page relies on.
  it('a caller that OMITS promptAnsweredToday still gets the promotion', () => {
    const w = mountRow({ ...upcomingWater, todaysVerdict: 'WATER_NOW', canSurvey: false });
    expect(w.text()).toContain('reading.verdictNowBadge');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// QA round 4, DEF-2 (HIGH) — the promotion's SECOND exit, at this component's own seam.
//
// Water the pot (the card leaves Today), then measure it and get "Riega ahora": this row promoted itself to
// due-today and offered Hecho — a 200 the API's one-watering-per-day dedup discards, permanently.
//
// ⚠️ `promptAnsweredToday` IS FALSE THROUGHOUT, deliberately: the watering PRECEDES the reading, so the
// API's own `since` bound correctly refuses to count it as an ANSWER. That is what makes the two props two
// props. Dropping `wateredToday` from the `effectiveTaskStatus` call turns these RED; inverting it turns
// the un-watered cases above RED.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('UiTaskRow — DEF-2: a pot watered today is not promoted by a measurement', () => {
  const upcomingWaterRow = {
    task: 'WATER' as const, status: 'upcoming' as const, dueLabel: 'in 9 days', canSurvey: false,
  };

  it('leaves the row upcoming, with its own due label, when the pot was watered today', () => {
    const w = mountRow({ ...upcomingWaterRow, todaysVerdict: 'WATER_NOW', wateredToday: true });
    expect(w.text()).toContain('in 9 days');
    expect(w.text()).not.toContain('reading.verdictNowBadge');
    // And no Posponer: the row is back to being not-yet-due, which is the state it was always in.
    expect(w.findAll('.stub-btn').map((b) => b.attributes('data-icon'))).not.toContain('clock');
  });

  it('a caller that OMITS wateredToday still gets the promotion — the default is inert', () => {
    const w = mountRow({ ...upcomingWaterRow, todaysVerdict: 'WATER_NOW' });
    expect(w.text()).toContain('reading.verdictNowBadge');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// QA round 5, F1 (MEDIUM) — the THIRD door onto one defect: a Hecho the server throws away.
//
// The measured repro, 3/3 on Nina (UI in ES, UI in EN, direct API): the plant is watered today, so the
// survey has closed (`canOfferWaterSurvey`'s fourth condition) and this row falls back to its classic shape
// — date box + Hecho. Pressing Hecho with the box empty opened "¿Por qué riegas antes de tiempo?", and the
// answer was posted as `occurredOn: <today>` — which the API's one-`WATER DONE`-per-day dedup declines to
// write, returning an ordinary `200 {"ok":true}`. No care event, no date movement, no toast, no visual
// change at all. The app asked the owner a question and threw the answer away.
//
// ⚠️ THE TWO DIRECTIONS THIS BLOCK PINS, because pinning only the first is pinning half the rule:
//   • restore the offered Done (drop `&& !doneWouldBeDiscarded` from `showDone`) -> the withholding cases RED
//   • withhold Done from a BACK-DATED watering (collapse the rule to bare `wateredToday`, i.e. stop reading
//     the date box) -> the back-dating case RED
// The second is the flow QA verified WORKING in this same round: an owner who watered two days ago types
// that day into this very box and records it correctly (History gained "Regada · hace 2 días", the schedule
// advanced). With the survey on offer that box is the only route to a past watering, so a fix that closes
// it trades one silent discard for one lost capability.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('UiTaskRow — F1: a WATER Done the API would discard is never offered', () => {
  const wateredWaterRow = {
    task: 'WATER' as const, status: 'today' as const, dueLabel: 'Today', canSurvey: false,
    withDoneDate: true, wateredToday: true,
  };
  const doneButton = (w: ReturnType<typeof mountRow>) =>
    w.findAll('.stub-btn').find((b) => b.attributes('data-icon') === 'check');

  it('withholds Hecho on a pot already watered today, and says so instead of going silent', () => {
    const w = mountRow(wateredWaterRow);
    expect(doneButton(w)).toBeUndefined();
    expect(w.text()).toContain('tasks.wateredTodayNote');
    // The route that still works is named, because a control that merely vanishes reads as a bug.
    expect(w.text()).toContain('tasks.wateredTodayBackdate');
  });

  // ⚠️ THE DATE BOX SURVIVES THE WITHHOLDING. Hiding the whole Done slot would have hidden the one control
  // that can turn the refusal back into an acceptance — the fix eating its own escape hatch.
  it('keeps the back-date input rendered while Hecho is withheld', () => {
    const w = mountRow(wateredWaterRow);
    expect(w.find('input[type="date"]').exists()).toBe(true);
  });

  it('BRINGS Hecho BACK the moment an earlier day is typed, and emits that day', async () => {
    const w = mountRow(wateredWaterRow);
    await w.find('input[type="date"]').setValue('2026-08-09');

    const done = doneButton(w);
    expect(done).toBeDefined();
    expect(w.text()).not.toContain('tasks.wateredTodayNote');

    await done!.trigger('click');
    expect(w.emitted('done')![0]).toEqual([{ task: 'WATER', occurredOn: '2026-08-09' }]);
  });

  // Typing TODAY's own date is the same answer as leaving the box empty, and it must be refused the same
  // way — the defect's exact shape, reached through the box instead of past it.
  it('refuses again when the owner types today back into the box', async () => {
    const w = mountRow(wateredWaterRow);
    await w.find('input[type="date"]').setValue('2026-08-09');
    expect(doneButton(w)).toBeDefined();
    await w.find('input[type="date"]').setValue(todayYmd());
    expect(doneButton(w)).toBeUndefined();
  });

  // The other direction of the same rule: nothing was watered today, so nothing is discarded and the row is
  // byte-identical to what it has always been. Inverting the predicate turns this RED.
  it('leaves an unwatered pot\'s Hecho exactly where it was', () => {
    const w = mountRow({ ...wateredWaterRow, wateredToday: false });
    expect(doneButton(w)).toBeDefined();
    expect(w.text()).not.toContain('tasks.wateredTodayNote');
  });

  // QA's own control: pressing Hecho twice on the ROTAR row wrote BOTH events, because the dedup is
  // WATER-only. A rule that fired on every task would delete a legitimate action from five of the six.
  it('never touches a non-WATER row, whatever `wateredToday` says', () => {
    const w = mountRow({ ...wateredWaterRow, task: 'ROTATE' });
    expect(doneButton(w)).toBeDefined();
    expect(w.text()).not.toContain('tasks.wateredTodayNote');
  });

  // DEF-3's asymmetry is untouched: "no tengo tiempo ahorita" is an answer about the owner's availability,
  // and it is not the thing the dedup discards. Withholding it here would leave a due row with no action.
  it('leaves Posponer alone — only the discarded action is withheld', () => {
    const w = mountRow(wateredWaterRow);
    expect(w.findAll('.stub-btn').map((b) => b.attributes('data-icon'))).toContain('clock');
  });

  // A caller with no date box gets the FACT and not the advice: "set an earlier date" would name a control
  // that does not exist on that row.
  it('omits the back-dating sentence when there is no date box to follow it with', () => {
    const w = mountRow({ ...wateredWaterRow, withDoneDate: false });
    expect(w.text()).toContain('tasks.wateredTodayNote');
    expect(w.text()).not.toContain('tasks.wateredTodayBackdate');
  });

  // ⚠️ THIS ASSERTS THE RENDERED PROSE, NOT THE KEY NAMES, AND THAT IS THE WHOLE POINT (QA round 6).
  // The two sentences shipped welded together — "Already watered today.Set an earlier date…" — in both
  // locales and on every viewport, because Vue's default `condense` whitespace handling drops the
  // whitespace-only text node between two sibling interpolations. Every sibling case above stayed green
  // through it: they match KEY NAMES with `toContain`, and `'…NotetasksWateredTodayBackdate'` contains
  // both keys just as happily as the correctly spaced string does. A test that cannot see the defect its
  // own component shipped is this feature's most expensive recurring shape — so this one reads the text
  // the owner actually sees, and pins the separator itself.
  it('puts a SPACE between the two sentences, not just both of them', () => {
    const w = mountRow(wateredWaterRow);
    expect(w.get('.mp-taskrow__discarded-note').text())
      .toBe('tasks.wateredTodayNote tasks.wateredTodayBackdate');
  });
});
