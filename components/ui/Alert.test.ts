// @vitest-environment happy-dom
//
// Same house pattern as Button.test.ts: outside Nuxt's build pipeline the auto-imports Alert.vue relies on
// (`computed`) do not exist, so Vue's own implementation is stubbed onto globalThis.
import { describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import Alert from './Alert.vue';

vi.stubGlobal('computed', computed);

// AppIcon is a leaf with no rules of its own (it renders one glyph), and outside Nuxt it cannot resolve the
// `Icon` component it wraps — the one case the project's stub rule explicitly allows.
const global = { stubs: { AppIcon: true } };

// WHY THIS FILE EXISTS (2026-08-15). `announce` is the prop that decides whether an alert INTERRUPTS a
// screen reader, and the owner ruling behind PlantDetail's single readings notice is stated in those terms:
// one failure is one interruption. `PlantDetail.test.ts` counts the alerts that carry the prop — it cannot
// count `aria-live` regions, because it stubs UiAlert to reach the slot. That leaves the other half of the
// chain, `announce ⇒ role="alert" aria-live="assertive"`, asserted nowhere at all: this component had no
// test of its own. Nothing about the ruling holds if this half silently stops being true, so it is pinned
// here, on the real component.
describe('UiAlert — the announcement contract', () => {
  it('carries NEITHER attribute by default — an alert does not interrupt unless it asks to', () => {
    const w = mount(Alert, { props: { description: 'x' }, global });
    expect(w.attributes('role')).toBeUndefined();
    expect(w.attributes('aria-live')).toBeUndefined();
  });

  // Positive control for the case above: the attributes CAN appear, so their absence there is the default
  // being honoured rather than a mount that rendered no root element to read attributes from.
  it('announce turns into role="alert" aria-live="assertive" on the root', () => {
    const w = mount(Alert, { props: { description: 'x', announce: true }, global });
    expect(w.attributes('role')).toBe('alert');
    expect(w.attributes('aria-live')).toBe('assertive');
  });

  // The valueless-attribute form is how every call site in this codebase writes it (`announce`, never
  // `:announce="true"`), and it only casts to `true` because the prop is declared Boolean. A refactor that
  // widened the prop's type would silently make every one of those call sites silent.
  it('treats the valueless `announce` attribute as true — the form every call site actually uses', () => {
    const w = mount(Alert, { props: { description: 'x', announce: '' as unknown as boolean }, global });
    expect(w.attributes('aria-live')).toBe('assertive');
  });
});
