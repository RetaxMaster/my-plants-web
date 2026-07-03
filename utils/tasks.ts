export type TaskCode = 'WATER' | 'FERTILIZE' | 'REPOT' | 'ROTATE' | 'CLEAN_LEAVES' | 'MIST' | 'PROGRESS';

// The six species-scheduled tasks that appear as read-only action notes in the history timeline.
export type CareActionTask = Exclude<TaskCode, 'PROGRESS'>;

export interface DueTask {
  plantId: string;
  task: TaskCode;
  nextDueOn: string; // ISO date
}

export const TASK_LABELS: Record<TaskCode, string> = {
  WATER: 'Water',
  FERTILIZE: 'Fertilize',
  REPOT: 'Repot',
  ROTATE: 'Rotate',
  CLEAN_LEAVES: 'Clean leaves',
  MIST: 'Mist leaves',
  PROGRESS: 'Log progress',
};

// Past-tense phrasing for completed actions in the history timeline ("Watered 3 days ago").
export const TASK_PAST_LABELS: Record<CareActionTask, string> = {
  WATER: 'Watered',
  FERTILIZE: 'Fertilized',
  REPOT: 'Repotted',
  ROTATE: 'Rotated',
  CLEAN_LEAVES: 'Cleaned leaves',
  MIST: 'Misted',
};

const MS_DAY = 86_400_000;

function dayDiff(due: Date, today: Date): number {
  const a = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((a - b) / MS_DAY);
}

export function dueLabel(due: Date, today: Date = new Date()): string {
  const diff = dayDiff(due, today);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

export function groupByPlant(tasks: DueTask[]): Map<string, DueTask[]> {
  const grouped = new Map<string, DueTask[]>();
  for (const t of tasks) {
    const list = grouped.get(t.plantId) ?? [];
    list.push(t);
    grouped.set(t.plantId, list);
  }
  return grouped;
}
