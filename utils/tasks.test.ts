import { describe, expect, it } from 'vitest';
import { dueState, groupByPlant, type DueTask } from './tasks.js';

const today = new Date('2026-06-18');

describe('task scheduling helpers (pure)', () => {
  it('classifies due dates relative to today', () => {
    expect(dueState(new Date('2026-06-18'), today)).toEqual({ kind: 'today', days: 0 });
    expect(dueState(new Date('2026-06-17'), today)).toEqual({ kind: 'overdue', days: 1 });
    expect(dueState(new Date('2026-06-19'), today)).toEqual({ kind: 'tomorrow', days: 1 });
    expect(dueState(new Date('2026-06-23'), today)).toEqual({ kind: 'inDays', days: 5 });
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
