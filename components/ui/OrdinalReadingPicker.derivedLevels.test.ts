// @vitest-environment happy-dom
//
// Code-review finding (round on 25f3a7e, [Important]): the level-count-from-bounds guarantee ("derived from
// `rawMin`/`rawMax`, never a literal `3`") was true of the CODE but unproven by the original suite, because
// both ordinal rows in the real shared contract (`wooden-stick`, `finger`) happen to declare exactly three
// levels today — hardcoding `count = 3` inside the component stayed green against every assertion in
// `OrdinalReadingPicker.test.ts`. This file closes that gap with the same technique
// `components/AgentChat.test.ts` already uses for a different scoped package: `vi.mock` with
// `importOriginal`, overriding ONE row's `rawMax` so the real contract's bounds genuinely diverge from `3`.
//
// Isolated into its OWN file (rather than folded into `OrdinalReadingPicker.test.ts`) because `vi.mock` is
// module-scoped: declaring it there would silently widen `wooden-stick` for every sibling assertion in that
// file too, including the ones that specifically pin it at 3. Keeping the mock in a file of its own means
// every other test in the family keeps reading the REAL, un-mocked bounds.
import { describe, it, expect, vi } from 'vitest';
import { computed, inject } from 'vue';
import { mount } from '@vue/test-utils';

vi.stubGlobal('computed', computed);
vi.stubGlobal('inject', inject);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

vi.mock('@retaxmaster/my-plants-species-schema/soil-instrument-constants', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@retaxmaster/my-plants-species-schema/soil-instrument-constants')
  >();
  return {
    ...actual,
    INSTRUMENTS: {
      ...actual.INSTRUMENTS,
      // ONLY `wooden-stick`'s bounds are widened — `finger` (and every numeric row) stays the REAL row, so
      // this is a genuine divergence from today's coincidental "both ordinal rows happen to be 1..3", not a
      // fabricated fifth instrument.
      'wooden-stick': { ...actual.INSTRUMENTS['wooden-stick'], rawMax: 4 },
    },
  };
});

// `vi.mock` calls above are hoisted by vitest above every import in this file, so this static import — and
// the component's OWN import of the same module inside `OrdinalReadingPicker.vue` — both resolve to the
// widened row.
import OrdinalReadingPicker from './OrdinalReadingPicker.vue';

describe('OrdinalReadingPicker — the level count is genuinely DERIVED, not pinned by coincidence', () => {
  it("renders 4 options when the underlying row's own rawMax is wider than today's real data ever is", () => {
    const w = mount(OrdinalReadingPicker, { props: { instrumentId: 'wooden-stick', modelValue: null } });
    expect(w.findAll('button')).toHaveLength(4);
  });
});
