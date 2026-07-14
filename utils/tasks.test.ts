import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dueState, groupByPlant, type DueTask } from './tasks.js';

const REAL_TZ = process.env.TZ;

// Pinned to a NEGATIVE offset on purpose. Under UTC every assertion here passes even with the bug in
// place — which is exactly why the bug shipped: the old suite compared two UTC-midnight Dates and never
// once asked what time it was where the owner actually lives.
beforeAll(() => { process.env.TZ = 'America/Mexico_City'; }); // UTC-6
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

const morning = new Date(2026, 5, 18, 9, 0); // Jun 18, 09:00 local — UTC is still the 18th
const evening = new Date(2026, 5, 18, 23, 0); // Jun 18, 23:00 local — UTC has already rolled to the 19th

describe('task scheduling helpers (pure)', () => {
  it('classifies due dates relative to today', () => {
    expect(dueState('2026-06-18', morning)).toEqual({ kind: 'today', days: 0 });
    expect(dueState('2026-06-17', morning)).toEqual({ kind: 'overdue', days: 1 });
    expect(dueState('2026-06-19', morning)).toEqual({ kind: 'tomorrow', days: 1 });
    expect(dueState('2026-06-23', morning)).toEqual({ kind: 'inDays', days: 5 });
  });

  it('classifies them the SAME way in the evening, when the UTC day has already turned over', () => {
    // The regression: after 18:00 local, "today" was read off the UTC clock, so every task slid a day
    // earlier — the task due today shouted "Overdue" and tomorrow's task claimed to be due today.
    expect(dueState('2026-06-18', evening)).toEqual({ kind: 'today', days: 0 });
    expect(dueState('2026-06-17', evening)).toEqual({ kind: 'overdue', days: 1 });
    expect(dueState('2026-06-19', evening)).toEqual({ kind: 'tomorrow', days: 1 });
    expect(dueState('2026-06-23', evening)).toEqual({ kind: 'inDays', days: 5 });
  });

  it('turns the day over at LOCAL midnight, not at 18:00', () => {
    expect(dueState('2026-06-18', new Date(2026, 5, 18, 23, 59, 59))).toEqual({ kind: 'today', days: 0 });
    expect(dueState('2026-06-18', new Date(2026, 5, 19, 0, 0, 1))).toEqual({ kind: 'overdue', days: 1 });
  });

  it('groups due tasks by plant preserving order', () => {
    const tasks: DueTask[] = [
      { plantId: 'a', task: 'WATER', nextDueOn: '2026-06-18' },
      { plantId: 'b', task: 'WATER', nextDueOn: '2026-06-18' },
      { plantId: 'a', task: 'ROTATE', nextDueOn: '2026-06-18' },
    ];
    const grouped = groupByPlant(tasks);
    expect(grouped.get('a')?.map((t) => t.task)).toEqual(['WATER', 'ROTATE']);
    expect(grouped.get('b')?.length).toBe(1);
  });
});
