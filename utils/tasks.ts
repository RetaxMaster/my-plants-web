export type TaskCode = 'WATER' | 'FERTILIZE' | 'REPOT' | 'ROTATE' | 'CLEAN_LEAVES' | 'MIST' | 'PROGRESS';

// The six species-scheduled tasks that appear as read-only action notes in the history timeline.
export type CareActionTask = Exclude<TaskCode, 'PROGRESS'>;

export interface DueTask {
  plantId: string;
  task: TaskCode;
  nextDueOn: string; // ISO date
}

const MS_DAY = 86_400_000;

function dayDiff(due: Date, today: Date): number {
  const a = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((a - b) / MS_DAY);
}

// Pure, language-free due classification consumed by useTaskMeta (wording lives in i18n).
export type DueKind = 'overdue' | 'today' | 'tomorrow' | 'inDays';
export interface DueState { kind: DueKind; days: number }

export function dueState(due: Date, today: Date = new Date()): DueState {
  const diff = dayDiff(due, today);
  if (diff < 0) return { kind: 'overdue', days: Math.abs(diff) };
  if (diff === 0) return { kind: 'today', days: 0 };
  if (diff === 1) return { kind: 'tomorrow', days: 1 };
  return { kind: 'inDays', days: diff };
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
