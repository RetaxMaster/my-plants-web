// @vitest-environment happy-dom
//
// The regression this file exists for: a progress entry logged MINUTES ago rendered as "yesterday"
// in the plant's history. The API dates every event as a calendar day in the plant's city timezone
// ("2026-07-13"), and the timeline compared that day against a "today" it derived from the UTC clock.
// In any negative offset (Mexico City is UTC-6) the UTC calendar day flips to tomorrow at 18:00 local
// — so from 18:00 until midnight, everything the owner did TODAY read as "yesterday".
//
// Hence the two clocks below: the same entry, the same day, one before 18:00 and one after. Both must
// say "today". The evening case is the one that used to fail.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import HistoryTimeline from './HistoryTimeline.vue';
import type { HistoryItem } from '../types/api.js';

const REAL_TZ = process.env.TZ;

// Minimal stand-ins for the Nuxt auto-imports the component resolves off the global scope. The
// translation stub returns the KEY, so the assertions below name the branch taken ("history.today"
// vs "history.yesterday") and stay independent of the Spanish/English wording.
beforeAll(() => {
  process.env.TZ = 'America/Mexico_City'; // UTC-6: the offset that exposes the bug
  vi.stubGlobal('useI18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }));
});

afterAll(() => {
  // Hermetic: leave the ambient timezone exactly as we found it.
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

const entry: HistoryItem = {
  kind: 'progress',
  entryId: 'e1',
  occurredOn: '2026-07-13',
  health: 'GOOD',
  photoCount: 2,
  tagCount: 0,
};

function renderAt(localClock: Date, items: HistoryItem[] = [entry]) {
  vi.useFakeTimers();
  vi.setSystemTime(localClock);
  return mount(HistoryTimeline, {
    props: { items },
    global: { stubs: { UiAppIcon: true } },
  }).get('.mp-history__date').text();
}

describe('HistoryTimeline — the day label is the OWNER\'s calendar day, not the UTC one', () => {
  it('says "today" for an entry logged today, in the morning', () => {
    expect(renderAt(new Date(2026, 6, 13, 9, 15))).toBe('history.today');
  });

  it('says "today" for an entry logged today, at 23:15 local (when UTC is already the 14th)', () => {
    // The reported bug: the owner logs progress at night and the timeline immediately calls it "yesterday".
    expect(renderAt(new Date(2026, 6, 13, 23, 15))).toBe('history.today');
  });

  it('says "yesterday" only when the day really did turn over', () => {
    expect(renderAt(new Date(2026, 6, 14, 9, 15))).toBe('history.yesterday');
  });

  it('counts whole calendar days back, still measured locally in the evening', () => {
    expect(renderAt(new Date(2026, 6, 18, 23, 45))).toBe('history.daysAgo:{"n":5}');
  });

  it('never reads "yesterday" for an action logged today either (same clock, other branch)', () => {
    const action: HistoryItem = { kind: 'action', task: 'WATER', type: 'DONE', occurredOn: '2026-07-13' };
    expect(renderAt(new Date(2026, 6, 13, 22, 0), [action])).toBe('history.today');
  });
});
