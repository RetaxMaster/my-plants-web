import { calendarDaysBetween, ymdToLocalDate } from './localDate.js';

export type TaskCode = 'WATER' | 'FERTILIZE' | 'REPOT' | 'ROTATE' | 'CLEAN_LEAVES' | 'MIST' | 'PROGRESS';

// The six species-scheduled tasks that appear as read-only action notes in the history timeline.
export type CareActionTask = Exclude<TaskCode, 'PROGRESS'>;

export interface DueTask {
  plantId: string;
  task: TaskCode;
  nextDueOn: string; // ISO date
}

// Pure, language-free due classification consumed by useTaskMeta (wording lives in i18n).
export type DueKind = 'overdue' | 'today' | 'tomorrow' | 'inDays';
export interface DueState { kind: DueKind; days: number }

// Takes `nextDueOn` as the API sends it — a bare calendar day, `YYYY-MM-DD` — on purpose. Handing this
// function a Date invited the caller to write `new Date(nextDueOn)`, which parses as UTC midnight and
// therefore names the PREVIOUS day for anyone west of Greenwich. Keeping the string until the one helper
// that knows how to read it (calendarDaysBetween, via ymdToLocalDate) makes that mistake unrepresentable.
export function dueState(nextDueOn: string, today: Date = new Date()): DueState {
  const diff = calendarDaysBetween(today, ymdToLocalDate(nextDueOn));
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
