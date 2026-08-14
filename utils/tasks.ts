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

/**
 * ROW ORDER WITHIN ONE PLANT CARD (spec §2.2) — ONE RULE, TWO RENDERERS.
 *
 * `pages/index.vue` applies this to EACH `groupByPlant` bucket, and `components/PlantDetail.vue` applies
 * it to `care.tasks`. Those are the only two surfaces that render a task row, and they must not disagree.
 *
 * ⚠️ DO NOT MOVE THIS INSIDE `groupByPlant`. That helper's contract is order-PRESERVING bucketing and
 * `PlantDetail.vue` never calls it at all, so a sort hidden there would have left the plant page — the
 * surface the defect was reported on — completely unchanged.
 *
 * ⚠️ AND IT ORDERS ROWS, NEVER CARDS. `groupByPlant` returns a `Map`, and sorting the values inside each
 * bucket leaves the Map's key insertion order untouched: a plant with a five-day-overdue watering is never
 * pushed below a plant whose repot can wait (owner decision 4, 2026-08-14). A flat re-sort of the whole
 * Today list would violate exactly that.
 *
 * The API is not touched by any of this: `care-plan.service.ts`'s urgency-group sort still decides which
 * PLANT comes first on Today, and `getCare()`'s `nextDueOn asc` is still the input this re-orders.
 */
// Module-local: read only by `taskCardRank` below, in this same file — no other module imports it (three-
// condition check: no static reference, no basename grep hit outside this file, suite green afterwards).
const TASK_CARD_RANK: Readonly<Record<string, number>> = Object.freeze({
  REPOT: 0,
  WATER: 1,
  FERTILIZE: 2,
});

// Every task the table does not name shares one rank, so their relative order is decided by the date
// tiebreak and then by arrival order — never by an invented ranking nobody asked for.
const TASK_CARD_RANK_DEFAULT = 3;

export function taskCardRank(task: TaskCode): number {
  return TASK_CARD_RANK[task] ?? TASK_CARD_RANK_DEFAULT;
}

export function orderTasksForCard<T extends { task: TaskCode; nextDueOn?: string }>(
  tasks: readonly T[],
): T[] {
  // A COPY, because `Array.prototype.sort` mutates and both callers pass an array they also render from —
  // a re-order that reached the source data would make each render depend on the previous one.
  return [...tasks].sort((a, b) => {
    const byRank = taskCardRank(a.task) - taskCardRank(b.task);
    if (byRank !== 0) return byRank;
    // Compared as the plain `YYYY-MM-DD` strings the API sends: for that format lexicographic order IS
    // chronological order, so no `Date` is constructed and the UTC-midnight trap `dueState`'s own comment
    // describes cannot be reached from here. A missing date sorts LAST (`￿` is above every digit):
    // "unknown" jumping ahead of every known date is the wrong direction to guess in.
    const aDue = a.nextDueOn || '￿';
    const bDue = b.nextDueOn || '￿';
    if (aDue < bDue) return -1;
    if (aDue > bDue) return 1;
    // Equal rank AND equal date: return 0 and let the sort's stability keep the API's own order.
    return 0;
  });
}
