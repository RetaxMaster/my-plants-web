// @vitest-environment happy-dom
//
// Same house pattern as SegmentedControl.test.ts: outside Nuxt's build pipeline, the auto-imports Button.vue
// relies on (`computed`, `resolveComponent`) don't exist, so `computed` is stubbed onto globalThis with
// Vue's own implementation. `resolveComponent('NuxtLink')` is never exercised here — every case below omits
// `to`, so the component branch stays on the plain `<button>` element.
import { describe, expect, it, vi } from 'vitest';
import { computed, resolveComponent } from 'vue';
import { mount } from '@vue/test-utils';
import Button from './Button.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('resolveComponent', resolveComponent);

// F7c (QA 2026-08-15) — a disabled/loading button must carry `mp-btn--disabled`, the class the muted-surface
// CSS (tokens/colors.css's `--surface-sunken`/`--text-faint`/`--border-subtle`) targets, replacing the old
// `opacity: 0.5` treatment that still read as an active brand-green button at 50% opacity, especially in
// dark theme. This file asserts the CLASS the CSS rule keys on (the same style this codebase's other
// component tests use — nobody here asserts computed CSS values directly, since happy-dom has no real layout
// engine to compute them against).
describe('Button — disabled treatment (F7c, QA 2026-08-15)', () => {
  it('an ENABLED button carries no --disabled class, on primary-solid (the QA-measured variant)', () => {
    const w = mount(Button, { props: { color: 'primary', variant: 'solid' } });
    expect(w.classes()).not.toContain('mp-btn--disabled');
  });

  // Positive control: proves the class CAN appear before the exhaustive sweep below relies on its absence
  // meaning something on every other combination.
  it('a DISABLED button carries --disabled, on primary-solid (the exact variant QA measured)', () => {
    const w = mount(Button, { props: { color: 'primary', variant: 'solid', disabled: true } });
    expect(w.classes()).toContain('mp-btn--disabled');
    expect(w.attributes('disabled')).toBeDefined();
  });

  it('a LOADING button also carries --disabled — loading is inert too, same as before this fix', () => {
    const w = mount(Button, { props: { color: 'primary', variant: 'solid', loading: true } });
    expect(w.classes()).toContain('mp-btn--disabled');
    expect(w.attributes('disabled')).toBeDefined();
  });

  // EVERY variant/colour combination, never only primary-solid — the rule the spec calls out explicitly: a
  // rule that covers one variant is exactly the fork this project forbids.
  const colors = ['primary', 'cafe', 'neutral'] as const;
  const variants = ['solid', 'soft', 'ghost'] as const;
  for (const color of colors) {
    for (const variant of variants) {
      it(`carries --disabled on ${color}-${variant} when disabled`, () => {
        const w = mount(Button, { props: { color, variant, disabled: true } });
        expect(w.classes()).toContain('mp-btn--disabled');
        // Still carries its own variant class too — the muted treatment overrides the variant's CSS by
        // specificity (two classes), it does not replace the variant class itself.
        expect(w.classes()).toContain(`mp-btn--${color}-${variant}`);
      });
    }
  }
});
