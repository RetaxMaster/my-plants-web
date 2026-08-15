/**
 * A SOURCE PIN FOR THE INVALID FOCUS RING (F7a, QA fix round 2026-08-15) — and an honest statement about
 * what a unit test in this project can and cannot prove.
 *
 * ⚠️ WHY THIS FILE EXISTS: a break proof failed. Reverting `.mp-input__field--invalid:focus` to the BRAND
 * ring — the exact defect QA reported, an invalid field glowing green under its own red error message —
 * left `Input.test.ts` completely green. It has to: `<style scoped>` in a Vue SFC is compiled and injected
 * by the bundler, and a Vitest/jsdom mount never applies it, so NO mounted assertion in this repo can see
 * a colour, a border or a box-shadow. The suite was not weak; it was structurally blind.
 *
 * ⚠️ WHAT PROVED THE FIX IS NOT THIS FILE. The real proof was measured in real Chrome, both themes, on the
 * soil-reading modal's date field with a genuine validation error rendered beneath it:
 *
 *   before →  class "mp-input__field"                     border rgb(22,163,74)   ring oklch(…149…) — GREEN
 *   after  →  class "mp-input__field mp-input__field--invalid"
 *             aria-invalid="true"                          border rgb(239,68,68)   ring oklch(…25.3…) — RED
 *
 * This file's job is narrower and worth having anyway: it makes DELETION VISIBLE. The mounted tests in
 * `Input.test.ts` already pin the `--invalid` CLASS (which is what a unit test CAN see); these pin the CSS
 * declaration and the tokens it depends on, so a later edit that quietly drops the danger ring, or removes
 * one of the two theme blocks that define it, goes red instead of silently restoring the mixed signal.
 *
 * Reading source text in a test is a blunt instrument and is used here deliberately and sparingly — the
 * same shape as this project's `guide-pair` linters. It asserts that a rule EXISTS, never that it renders.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const inputSfc = read('./Input.vue');
const colors = read('../../assets/css/tokens/colors.css');
const spacing = read('../../assets/css/tokens/spacing.css');

/** The declaration block of a selector, so an assertion is scoped to the rule it names. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('the invalid field does not wear the BRAND focus ring (F7a)', () => {
  it('gives a focused invalid field the danger ring, not the brand one', () => {
    const body = ruleBody(inputSfc, '.mp-input__field--invalid:focus');
    expect(body).toContain('--shadow-focus-danger');
    // The positive control for the assertion above: a focused VALID field must still carry the BRAND ring,
    // so this pair fails if someone "fixes" the mixed signal by making every focus ring red.
    expect(body).not.toContain('var(--shadow-focus)');
    expect(ruleBody(inputSfc, '.mp-input__field:focus')).toContain('var(--shadow-focus)');
  });

  it('defines the danger ring from the same recipe as the brand ring, in BOTH themes', () => {
    // Two definitions, never one: a token declared only in `:root` silently serves its LIGHT value to dark
    // theme, which is how a red ring would end up unreadable on a dark surface without anything failing.
    const brand = colors.match(/--ring-brand:/g) ?? [];
    const danger = colors.match(/--ring-danger:/g) ?? [];
    expect(danger.length).toBe(brand.length);
    expect(danger.length).toBe(2);
    expect(spacing).toContain('--shadow-focus-danger: 0 0 0 3px var(--ring-danger);');
  });
});
