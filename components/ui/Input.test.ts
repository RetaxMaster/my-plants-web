// @vitest-environment happy-dom
//
// Same house pattern as SegmentedControl.test.ts: outside Nuxt's build pipeline, the auto-imports Input.vue
// and FormGroup.vue rely on (`computed`, `provide`, `inject`, `useId`) don't exist, so they are stubbed onto
// globalThis with Vue's own implementations — real enough that provide()/inject() resolve across the
// parent/child boundary exactly as in the app. That is what lets the tests below mount the REAL FormGroup
// around a REAL Input — a stub would provide nothing and prove nothing about the injection wiring this file
// exists to cover (F7a, QA 2026-08-15).
import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, inject, provide, ref, useId } from 'vue';
import { mount } from '@vue/test-utils';
import Input from './Input.vue';
import FormGroup from './FormGroup.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('provide', provide);
vi.stubGlobal('inject', inject);
vi.stubGlobal('useId', useId);

function mountBare(props: { error?: string } = {}) {
  return mount(Input, { props: { modelValue: '', ...props } });
}

function mountInGroup(opts: { groupError?: string; fieldError?: string } = {}) {
  return mount(
    defineComponent({
      components: { FormGroup, Input },
      setup: () => {
        const model = ref('');
        return { model, groupError: opts.groupError, fieldError: opts.fieldError };
      },
      template:
        '<FormGroup label="Field" :error="groupError"><Input v-model="model" :error="fieldError" /></FormGroup>',
    }),
  );
}

describe('Input — validation styling (F7a, QA 2026-08-15)', () => {
  it('is invalid when its own `error` prop is set directly — no FormGroup involved', () => {
    const w = mountBare({ error: 'Required' });
    expect(w.find('input').classes()).toContain('mp-input__field--invalid');
    expect(w.find('input').attributes('aria-invalid')).toBe('true');
  });

  it('stays valid — no --invalid class, no aria-invalid — when nothing anywhere carries an error', () => {
    const w = mountInGroup();
    expect(w.find('input').classes()).not.toContain('mp-input__field--invalid');
    expect(w.find('input').attributes('aria-invalid')).toBeUndefined();
  });

  // THE ACTUAL DEFECT. FormGroup's `error` prop never reached the Input sitting in its slot, so a field
  // under a visible validation message (e.g. SoilReadingModal.vue's `measuredOn` date field, which only ever
  // passed :error to the surrounding FormGroup) stayed styled as valid — including its focus ring, since
  // `invalid` drove both `--invalid` and (via CSS) which ring color rendered. This is the positive control:
  // it proves the injection wiring actually makes an Input invalid with NO explicit `error` prop on itself.
  it('becomes invalid from the surrounding FormGroup alone — no explicit `error` prop on the field itself', () => {
    const w = mountInGroup({ groupError: 'This date is wrong' });
    expect(w.find('input').classes()).toContain('mp-input__field--invalid');
    expect(w.find('input').attributes('aria-invalid')).toBe('true');
  });

  // The two pre-existing double-passing call sites (SoilReadingModal.vue's value field, RepotDoneForm.vue's
  // pot-size field) pass :error to BOTH the FormGroup and the Input. This must keep rendering invalid exactly
  // as before — the field-level prop is never allowed to make the group's error "cancel out" the field's own.
  it('stays invalid when the FormGroup AND the field both carry an error (double-passing call sites)', () => {
    const w = mountInGroup({ groupError: 'Group says X', fieldError: 'Field says Y' });
    expect(w.find('input').classes()).toContain('mp-input__field--invalid');
    expect(w.find('input').attributes('aria-invalid')).toBe('true');
  });
});
