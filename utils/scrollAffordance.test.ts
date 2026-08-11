// The horizontal scroll hint's arithmetic, pinned at the level it lives at (QA round 5, F4.1). It replaced
// a pure-CSS `background-attachment: local/scroll` shadow whose only possible assertion was "the
// declaration is still in the stylesheet" — and which QA measured still drawing at `scrollLeft = 9999`,
// i.e. still promising more content after the owner had reached the end.
import { describe, it, expect } from 'vitest';
import { hasMoreToScrollRight, SCROLL_END_SLACK_PX } from './scrollAffordance.js';

describe('hasMoreToScrollRight (QA round 5, F4.1)', () => {
  // The real measured geometry of the /settings instrument table at a 390 px viewport: 584.75 px of
  // content (reported as 585) inside a 312 px box, so 273 px of travel.
  const table = { clientWidth: 312, scrollWidth: 585 };

  it('promises more while there IS more to the right', () => {
    expect(hasMoreToScrollRight({ ...table, scrollLeft: 0 })).toBe(true);
    expect(hasMoreToScrollRight({ ...table, scrollLeft: 150 })).toBe(true);
  });

  // ⚠️ THE CASE THE CSS VERSION GOT WRONG, AND THE WHOLE REASON THIS FUNCTION EXISTS. Deleting the
  // comparison (always `true`) turns this RED; inverting it turns the case above RED.
  it('goes quiet at the END of the scroll', () => {
    expect(hasMoreToScrollRight({ ...table, scrollLeft: 273 })).toBe(false);
  });

  // Sub-pixel layout: `scrollWidth`/`clientWidth` are integers rounded from fractional widths, so the end
  // of a scroll routinely lands a fraction short of the arithmetic maximum. Without the slack the hint
  // would stay drawn forever on exactly the tables whose content is fractionally wide — the original
  // defect, reintroduced one rounding error lower down. Setting `SCROLL_END_SLACK_PX` to 0 turns this RED.
  it('treats a sub-pixel remainder as the end', () => {
    expect(SCROLL_END_SLACK_PX).toBeGreaterThan(0);
    expect(hasMoreToScrollRight({ ...table, scrollLeft: 273 - SCROLL_END_SLACK_PX })).toBe(false);
    // ...and one pixel further back is genuinely still scrollable, so the slack cannot grow unnoticed.
    expect(hasMoreToScrollRight({ ...table, scrollLeft: 273 - SCROLL_END_SLACK_PX - 1 })).toBe(true);
  });

  // Nothing overflows: there is no hint to give. This is also what every jsdom/happy-dom mount reports
  // (all layout metrics `0`), so the safe default for an un-measured component is "no hint" rather than a
  // false one.
  it('gives no hint when the content fits', () => {
    expect(hasMoreToScrollRight({ scrollLeft: 0, clientWidth: 312, scrollWidth: 312 })).toBe(false);
    expect(hasMoreToScrollRight({ scrollLeft: 0, clientWidth: 0, scrollWidth: 0 })).toBe(false);
  });
});
