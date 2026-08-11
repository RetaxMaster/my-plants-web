/**
 * "IS THERE STILL SOMETHING TO THE RIGHT?" — the arithmetic behind a horizontal scroll hint, on its own so
 * it can be proven without a layout engine (QA round 5, F4.1).
 *
 * WHY IT IS A FUNCTION AND NOT THREE LINES INSIDE A COMPONENT. The affordance it drives shipped once
 * already, as a pure-CSS `background-attachment: local/scroll` shadow — elegant, zero JavaScript, and
 * impossible for any test to catch when it went wrong. It went wrong: QA measured it still drawing the
 * "there is more over here" hint at `scrollLeft = 9999`, i.e. after the owner had already reached the end.
 * The only assertion the CSS version could ever support was "the declaration is still in the stylesheet",
 * which is not a statement about behaviour. This version's rule is a value, and a value can be wrong in a
 * test.
 *
 * jsdom reports `0` for every layout metric, so a component test that did not stub these numbers would be
 * asserting against `0 - 0 - 0`, which this function answers `false` to — "nothing to scroll", the correct
 * reading of a box with no width, and the safe default for a hint (absent rather than falsely present).
 */

/**
 * The slack, in CSS pixels, inside which the scroller counts as fully scrolled.
 *
 * Not decoration: `scrollWidth` and `clientWidth` are integers rounded from fractional layout — this
 * project's own instrument table measures `584.75 px` of content in a `312 px` box — so the end of a scroll
 * routinely lands a fraction of a pixel short of the arithmetic maximum. A strict `> 0` test would leave
 * the hint drawn forever on exactly the pots whose table is fractionally wide, which is the defect this
 * whole function replaces, reintroduced one rounding error lower down.
 */
export const SCROLL_END_SLACK_PX = 1;

export function hasMoreToScrollRight(metrics: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): boolean {
  return metrics.scrollWidth - metrics.clientWidth - metrics.scrollLeft > SCROLL_END_SLACK_PX;
}
