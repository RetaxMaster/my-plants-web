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
import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import TaskRow from './TaskRow.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('ref', ref);
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
