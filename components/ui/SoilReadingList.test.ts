// @vitest-environment happy-dom
//
// The readings history (QA UX-1, 2026-08-10). Harness mirrors SoilReadingModal.test.ts: Vue primitives and
// the `useI18n` auto-import are stubbed as globals, and `t` ECHOES its key so an assertion can tell "this
// exact string was selected" from "some string rendered".
import { describe, it, expect, vi } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import SoilReadingList from './SoilReadingList.vue';
import type { PlantSoilReadings } from '~/types/api';
import { ymdFromLocalDate } from '../../utils/localDate.js';

vi.stubGlobal('computed', computed);
vi.stubGlobal('useI18n', () => ({
  // Key-echoing, EXTENDED to echo the interpolation params too (F5, 2026-08-10). A plain `k => k` stub makes
  // the number invisible: `t('reading.wetnessPct', { pct: 76 })` and `t('reading.wetnessPct', { pct: 0 })`
  // would render the same string, so no assertion could tell a correct percentage from a wrong one and the
  // whole moisture-rendering suite would be unfalsifiable. Appending the params keeps the "this exact key was
  // selected" property AND pins the value that was fed into it.
  t: (k: string, params?: Record<string, unknown>) => (params ? `${k} ${JSON.stringify(params)}` : k),
  // Formats from LOCAL components, never `toISOString()` — see SoilReadingModal.test.ts's own note on the
  // harness defect that only exists east of Greenwich.
  d: (date: Date) => ymdFromLocalDate(date),
}));

const stubs = { UiBadge: { props: ['color', 'size'], template: '<span class="badge"><slot /></span>' } };

const woodenStick = {
  id: 'wooden-stick' as const, kind: 'moisture' as const, unit: 'level', scale: 'stick-clean-to-damp',
  direction: 'higher-is-wetter' as const, comparableAcrossPots: false, requiresCalibration: false,
  protocolKind: 'insertion' as const, captureKind: 'ordinal' as const,
  rawMin: 1, rawMax: 3, rawStep: 1, calibration: null,
};
const galvanicProbe = {
  ...woodenStick,
  id: 'galvanic-probe' as const, unit: '1–10 index', scale: 'galvanic-1-10',
  captureKind: 'numeric' as const, rawMax: 10,
};

function makeData(overrides: Partial<PlantSoilReadings> = {}): PlantSoilReadings {
  return {
    instruments: [woodenStick], protocol: null, readings: [], wateringDays: [], ...overrides,
  } as PlantSoilReadings;
}

function mountList(data: PlantSoilReadings) {
  return mount(SoilReadingList, { props: { data }, global: { stubs } });
}

const reading = (over: Record<string, unknown> = {}) => ({
  id: 'r1', instrumentId: 'wooden-stick', rawValue: 3, wetness: 0.8,
  measuredOn: '2026-08-09', verdict: 'NONE', ...over,
});

describe('SoilReadingList', () => {
  it('renders an ORDINAL reading as its named state, never the raw number', () => {
    const w = mountList(makeData({ readings: [reading({ rawValue: 3 })] as never }));
    // The whole reason the ordinal capture exists: the owner never chose a number, and handing one back
    // would invite them to reason about a scale we deliberately refused to publish.
    expect(w.text()).toContain('reading.levels.wooden-stick.3');
    // The bare stored value, alone, is what must never appear. (A regex like /\b3\b$/ would be useless
    // here: the level KEY itself ends in `.3`, so it matches the correct output too.)
    expect(w.find('.mp-readinglist__value').text()).not.toBe('3');
  });

  it('renders a NUMERIC reading with its unit', () => {
    const w = mountList(makeData({
      instruments: [galvanicProbe] as never,
      readings: [reading({ instrumentId: 'galvanic-probe', rawValue: 7 })] as never,
    }));
    expect(w.find('.mp-readinglist__value').text()).toBe('7 settings.instruments.unit.galvanic-probe');
  });

  // ⚠️ REWRITTEN 2026-08-10 (QA regression). The previous version asserted the bare value `7` here and
  // PASSED, because it used a NUMERIC instrument — for which "value with no unit" is a defensible floor.
  // The same fallback applied to an ORDINAL instrument rendered `3`, the raw level, which is exactly what
  // the case above forbids. The test covered the combination that looked fine and never the one that broke.
  it('still names the state for an instrument the owner has since DESELECTED', () => {
    // Deselecting changes what the owner measures with from now on; it does not rewrite what they measured
    // before. The label comes from the CONTRACT's catalogue, keyed by the reading's own instrument id, so
    // the owner's current ticks cannot reach it.
    const w = mountList(makeData({
      instruments: [] as never,
      readings: [reading({ instrumentId: 'wooden-stick', rawValue: 3 })] as never,
    }));
    expect(w.find('.mp-readinglist__value').text()).toBe('reading.levels.wooden-stick.3');
  });

  it('still shows the unit for a DESELECTED numeric instrument', () => {
    const w = mountList(makeData({
      instruments: [] as never,
      readings: [reading({ instrumentId: 'galvanic-probe', rawValue: 7 })] as never,
    }));
    expect(w.find('.mp-readinglist__value').text()).toBe('7 settings.instruments.unit.galvanic-probe');
  });

  it('falls back to the bare value ONLY for an id the contract does not know', () => {
    // The genuine no-honest-label case: a row retired from the catalogue in some future release, leaving
    // readings behind. This is what the fallback always claimed to be for.
    const w = mountList(makeData({
      instruments: [] as never,
      readings: [reading({ instrumentId: 'tensiometer', rawValue: 7 })] as never,
    }));
    expect(w.find('.mp-readinglist__value').text()).toBe('7');
  });

  // F5 (QA, 2026-08-10): the first calibration BACKFILLED the old readings — `wetness` really did go from
  // `null` to a number in the database — and this list rendered byte-identically before and after. The owner
  // weighed the pot twice and saw no payoff at all. These two cases are the payoff, and its honest absence.
  it('shows the interpreted moisture as a ROUNDED PERCENTAGE, alongside the raw value', () => {
    // 0.756 is chosen so the assertion is falsifiable in BOTH directions at once: forget the ×100 and it is
    // `1`, forget the rounding and it is `75.60000000000001`. A tidy fixture like 0.75 would survive the
    // second mutation unchanged (75 either way) and quietly stop testing anything.
    const w = mountList(makeData({ readings: [reading({ rawValue: 1450, wetness: 0.756 })] as never }));
    expect(w.find('.mp-readinglist__wetness').text()).toBe('reading.wetnessPct {"pct":76}');
    // Alongside, not instead of: the raw value the owner actually recorded stays on the row.
    expect(w.find('.mp-readinglist__value').text()).toContain('1450');
  });

  it('marks an UNINTERPRETED reading honestly — never as zero, never as a blank', () => {
    // A reading taken before this pot was calibrated has no moisture, and `0`/`0%`/an empty gap would each be
    // a positive claim ("bone dry" / "nothing here") about a measurement we deliberately declined to read.
    const w = mountList(makeData({ readings: [reading({ wetness: null })] as never }));
    const cell = w.find('.mp-readinglist__wetness');
    expect(cell.text()).toBe('reading.wetnessUnknown');
    // Not the interpreted key with a zero in it, and not empty — the two ways this could silently regress.
    expect(w.text()).not.toContain('reading.wetnessPct');
    expect(cell.text()).not.toBe('');
    // And it must not LOOK like an interpreted one either: same words in the same style is the same defect.
    expect(cell.classes()).toContain('mp-readinglist__wetness--unknown');
  });

  it('badges only a verdict that says something', () => {
    const w = mountList(makeData({
      readings: [
        reading({ id: 'a', verdict: 'NONE' }),
        reading({ id: 'b', verdict: 'POSTPONE' }),
      ] as never,
    }));
    // Badging every row "none" would bury the rows that carry a real decision.
    const badges = w.findAll('.badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.text()).toBe('reading.verdictBadge.POSTPONE');
  });

  it('renders the date from its LOCAL components', () => {
    const w = mountList(makeData({ readings: [reading({ measuredOn: '2026-08-09' })] as never }));
    // A bare `new Date('2026-08-09')` is UTC midnight read back through the local clock, so west of
    // Greenwich every date here would render one day early.
    expect(w.find('.mp-readinglist__date').text()).toBe('2026-08-09');
  });

  it('states the empty case rather than rendering an empty list', () => {
    const w = mountList(makeData({ readings: [] }));
    expect(w.text()).toContain('reading.historyEmpty');
    expect(w.findAll('.mp-readinglist__row')).toHaveLength(0);
  });
});
