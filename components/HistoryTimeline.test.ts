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
import LinkRow from './ui/LinkRow.vue';
import type { HistoryItem } from '../types/api.js';

// The 'progress' and 'clinical' rows now render through the shared UiLinkRow component (extracted to
// kill a byte-identical chrome fork between the two branches) rather than an inline <button> literal in
// this template — so the mount needs the REAL component registered under its auto-import name, or Vue
// cannot resolve <UiLinkRow> at all and every row below it silently renders as an empty unknown tag.
const GLOBAL_STUBS = { components: { UiLinkRow: LinkRow }, stubs: { UiAppIcon: true } };

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
  processingCount: 0,
  tagCount: 0,
};

function renderAt(localClock: Date, items: HistoryItem[] = [entry]) {
  vi.useFakeTimers();
  vi.setSystemTime(localClock);
  return mount(HistoryTimeline, {
    props: { items },
    global: GLOBAL_STUBS,
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

// This is the coverage a Codex quality-review round proved was MISSING: three mutations — swapping the
// Spanish label for the English one, pointing the template at a nonexistent i18n key, and rewriting the
// whole branch as a non-interactive <div> with no click handler and no recordId in any payload — all
// survived the full suite AND typecheck (vue-i18n keys aren't typechecked here, and nothing asserted the
// row was clickable at all). Each assertion below is aimed at exactly one of those three.
describe('HistoryTimeline — the clinical row (a doctor-authored case note)', () => {
  const record: HistoryItem = { kind: 'clinical', recordId: 'rec-1', occurredOn: '2026-07-13' };

  function mountClinical() {
    // TZ is already pinned to America/Mexico_City for the whole file by the top-level beforeAll above.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 13, 9, 15)); // same day as the record → "today"
    return mount(HistoryTimeline, {
      props: { items: [record] },
      global: GLOBAL_STUBS,
    });
  }

  it('renders the row as a real <button> — catches it silently becoming an inert <div>', () => {
    const w = mountClinical();
    // querySelector, not w.get('.mp-history__row'), so a rewrite to a non-button element that KEPT the
    // class name would still be caught by the tagName assertion below.
    const row = w.element.querySelector('.mp-history__row');
    expect(row).not.toBeNull();
    expect(row!.tagName).toBe('BUTTON');
  });

  it('emits openRecord with the record\'s id when clicked — catches a click handler that forgot the payload', async () => {
    const w = mountClinical();
    await w.get('.mp-history__row').trigger('click');
    expect(w.emitted('openRecord')).toEqual([['rec-1']]);
    // The row must never ALSO fire openEntry (that would mean the branch resolution itself is wrong,
    // e.g. a stray fallthrough to the progress case).
    expect(w.emitted('openEntry')).toBeUndefined();
  });

  it('shows the clinical-record label — catches the template pointing at a stale/nonexistent i18n key', () => {
    const w = mountClinical();
    // The stubbed t() returns the key verbatim, so asserting THIS exact key is what a raw-key-path
    // regression (wrong key name) or a hardcoded-English regression would both actually break.
    expect(w.get('.mp-history__text').text()).toBe('history.clinicalRecordCreated');
  });

  it('shows the relative day label alongside the button, from the same shared helper as every other row', () => {
    const w = mountClinical();
    expect(w.get('.mp-history__date').text()).toBe('history.today');
  });
});
