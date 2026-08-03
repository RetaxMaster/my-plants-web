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
//   - `components/PlantDetail.vue` never passes `:pending-verdict` at all. This is the "not opted in"
//     shape, and it is what F1 broke: TaskRow's own `pendingVerdict: null` default used to make this
//     indistinguishable from the opted-in "no pending evaluation" case.
import { describe, it, expect, vi } from 'vitest';
import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import TaskRow from './TaskRow.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('ref', ref);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
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
  it('a caller that OMITS pendingVerdict entirely (PlantDetail.vue\'s exact shape) gets classic Done/Postpone, NOT "time to evaluate"', () => {
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

  it('a caller that passes pendingVerdict: \'RE-EVALUATE\' (not due yet) still shows "time to evaluate"', () => {
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
