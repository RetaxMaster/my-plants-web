import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dueState, groupByPlant, orderTasksForCard, taskCardRank, type DueTask } from './tasks.js';

const REAL_TZ = process.env.TZ;

// Pinned to a NEGATIVE offset on purpose. Under UTC every assertion here passes even with the bug in
// place — which is exactly why the bug shipped: the old suite compared two UTC-midnight Dates and never
// once asked what time it was where the owner actually lives.
beforeAll(() => { process.env.TZ = 'America/Mexico_City'; }); // UTC-6
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

// code review AF-2 — BOTH halves below are required, and each one alone is not enough:
//
// 1. These two fixtures are built from an EXPLICIT UTC INSTANT (an ISO string ending `Z`), never from
//    `new Date(y, m, d, h, mi)`. The local-component constructor reads the AMBIENT timezone AT
//    CONSTRUCTION TIME — which, for a MODULE-LEVEL `const`, happens the instant this file is imported,
//    BEFORE the `beforeAll` above ever runs. So under an ambient TZ that is not already
//    America/Mexico_City (this laptop's default, but not CI's, not a colleague's, not this machine
//    tomorrow), `evening` used to freeze the WRONG epoch before the pin below had a chance to matter —
//    e.g. under `TZ=UTC` it froze 17:00 local instead of 23:00, so the "does the day turn over after
//    18:00" case below stopped exercising the post-18:00 window AT ALL while staying green, and under
//    `TZ=Asia/Tokyo` the date itself slides to the 17th and the file fails outright. An explicit UTC
//    instant has no ambient dependency: it names one fixed point in time regardless of what TZ is active
//    when this line runs.
// 2. The `process.env.TZ` pin above is STILL required, on the READ side: `dueState` reads a Date's LOCAL
//    calendar day via `getFullYear`/`getMonth`/`getDate`, and those are evaluated against whatever TZ is
//    active at CALL time (inside each `it`, i.e. after `beforeAll`). Without the pin, the same fixed UTC
//    instant would read back as a different local day on every machine — the fixture would be
//    ambient-independent but the ASSERTION would not be.
//
// Proof this now holds under BOTH `TZ=UTC` and `TZ=Asia/Tokyo`, not just this laptop's `America/Chicago`-
// style default: `TZ=UTC npx vitest run utils/tasks.test.ts` and `TZ=Asia/Tokyo npx vitest run
// utils/tasks.test.ts` both pass, and both still exercise the post-18:00 window — `evening` always reads
// as 23:00 America/Mexico_City once `dueState` runs, because the pin controls the READ regardless of the
// ambient TZ the process started under.
const morning = new Date('2026-06-18T15:00:00Z'); // Jun 18, 09:00 America/Mexico_City (UTC-6) — UTC still the 18th
const evening = new Date('2026-06-19T05:00:00Z'); // Jun 18, 23:00 America/Mexico_City (UTC-6) — UTC already the 19th

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

describe('groupByPlant preserves the API\'s ordering (spec §5.1 / D1)', () => {
  it('keeps each plant\'s tasks in the order the API returned them — REPOT first stays first', () => {
    const rows = [
      { plantId: 'a', task: 'REPOT' }, { plantId: 'a', task: 'WATER' },
      { plantId: 'b', task: 'REPOT' }, { plantId: 'a', task: 'FERTILIZE' },
    ] as DueTask[];
    expect([...groupByPlant(rows).get('a')!].map((t) => t.task)).toEqual(['REPOT', 'WATER', 'FERTILIZE']);
  });

  it('keeps the PLANTS themselves in first-appearance order — the most urgent plant stays at the top', () => {
    const rows = [{ plantId: 'b', task: 'REPOT' }, { plantId: 'a', task: 'WATER' }] as DueTask[];
    expect([...groupByPlant(rows).keys()]).toEqual(['b', 'a']);
  });
});

describe('orderTasksForCard — row order WITHIN one plant card (spec §2.2)', () => {
  const row = (task: DueTask['task'], nextDueOn = '2026-06-18'): DueTask =>
    ({ plantId: 'a', task, nextDueOn });

  it('ranks REPOT > WATER > FERTILIZE > everything else', () => {
    const input = [row('MIST'), row('FERTILIZE'), row('CLEAN_LEAVES'), row('WATER'), row('REPOT')];
    expect(orderTasksForCard(input).map((t) => t.task))
      .toEqual(['REPOT', 'WATER', 'FERTILIZE', 'MIST', 'CLEAN_LEAVES']);
  });

  it('puts a verdict-surfaced REPOT first even though its date is the furthest away', () => {
    // The defect §2.2 exists to remove: the questionnaire answers "this plant needs repotting", the row
    // carries a FUTURE date, and it rendered under every routine chore.
    const input = [row('WATER', '2026-06-10'), row('REPOT', '2028-01-01')];
    expect(orderTasksForCard(input).map((t) => t.task)).toEqual(['REPOT', 'WATER']);
  });

  it('breaks a rank tie with nextDueOn ascending', () => {
    const input = [row('MIST', '2026-06-20'), row('ROTATE', '2026-06-18')];
    expect(orderTasksForCard(input).map((t) => t.task)).toEqual(['ROTATE', 'MIST']);
  });

  it('sorts a row with NO date LAST, never first — an unknown date must not jump the queue', () => {
    const dated = row('MIST', '2026-06-20');
    const undated = { plantId: 'a', task: 'ROTATE' } as unknown as DueTask;
    expect(orderTasksForCard([undated, dated]).map((t) => t.task)).toEqual(['MIST', 'ROTATE']);
  });

  it('is STABLE for equal rank and equal date — the API\'s own order survives', () => {
    const a = { plantId: 'a', task: 'ROTATE' as const, nextDueOn: '2026-06-18', tag: 'first' };
    const b = { plantId: 'a', task: 'CLEAN_LEAVES' as const, nextDueOn: '2026-06-18', tag: 'second' };
    const c = { plantId: 'a', task: 'MIST' as const, nextDueOn: '2026-06-18', tag: 'third' };
    expect(orderTasksForCard([a, b, c]).map((t) => t.tag)).toEqual(['first', 'second', 'third']);
  });

  it('does NOT mutate its input — both callers also render from the array they pass', () => {
    const input = [row('WATER'), row('REPOT')];
    const before = input.map((t) => t.task);
    const out = orderTasksForCard(input);
    expect(input.map((t) => t.task)).toEqual(before);
    expect(out).not.toBe(input);
  });

  it('gives every unranked task the SAME rank — the table names three tasks, not six', () => {
    expect(taskCardRank('REPOT')).toBe(0);
    expect(taskCardRank('WATER')).toBe(1);
    expect(taskCardRank('FERTILIZE')).toBe(2);
    expect(taskCardRank('ROTATE')).toBe(taskCardRank('MIST'));
    expect(taskCardRank('CLEAN_LEAVES')).toBe(taskCardRank('PROGRESS'));
  });
});
