import { describe, expect, it } from 'vitest';
import { TASK_LABELS, dueLabel, groupByPlant, type DueTask } from './tasks.js';

const today = new Date('2026-06-18');

describe('task presentation helpers', () => {
  it('maps task codes to human labels', () => {
    expect(TASK_LABELS.WATER).toBe('Water');
    expect(TASK_LABELS.CLEAN_LEAVES).toBe('Clean leaves');
  });

  it('labels due dates relative to today', () => {
    expect(dueLabel(new Date('2026-06-18'), today)).toBe('Today');
    expect(dueLabel(new Date('2026-06-17'), today)).toBe('Overdue');
    expect(dueLabel(new Date('2026-06-19'), today)).toBe('Tomorrow');
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
