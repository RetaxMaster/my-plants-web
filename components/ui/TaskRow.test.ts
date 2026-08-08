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
    template: '<button class="stub-btn" :data-icon="icon"><slot /></button>',
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

  it('clears the typed date once the schedule moves, so the NEXT Done starts empty', async () => {
    const w = mountRow({ withDoneDate: true, task: 'WATER', status: 'overdue', dueLabel: '2 days overdue' });
    await w.find('input[type="date"]').setValue('2026-08-01');
    await clickDone(w);
    expect(w.emitted('done')![0]).toEqual([{ task: 'WATER', occurredOn: '2026-08-01' }]);

    // The completion landed and the parent re-rendered the row with its new due date.
    await w.setProps({ status: 'upcoming', dueLabel: 'in 7 days' });
    expect((w.find('input[type="date"]').element as HTMLInputElement).value).toBe('');
    await clickDone(w);
    expect(w.emitted('done')![1]).toEqual([{ task: 'WATER', occurredOn: undefined }]);
  });

  it('does NOT clear on the emit itself — the REPOT emit only OPENS the Done form, it does not complete it', async () => {
    // Load-bearing negative. `PlantDetail.vue`'s `onRepotDone` captures the emitted `occurredOn` into
    // `doneFormOccurredOn`; clearing on the emit would mean that dismissing the form and pressing Done
    // again re-emits `undefined`, and `onRepotDoneConfirm`'s `|| today()` would then write the repot on
    // TODAY instead of the day the owner typed — a silent wrong-day write traded for a stale one.
    const w = mountRow({ pendingVerdict: null, allowStandaloneDone: true, withDoneDate: true });
    await w.find('input[type="date"]').setValue('2026-08-01');
    await clickDone(w);
    await clickDone(w); // the owner dismissed the form and pressed Done again; nothing has completed yet
    expect(w.emitted('done')![1]).toEqual([{ task: 'REPOT', occurredOn: '2026-08-01' }]);
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
