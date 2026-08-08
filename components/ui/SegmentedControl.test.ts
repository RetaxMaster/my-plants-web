// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, inject, provide, ref, useId } from 'vue';
import { mount } from '@vue/test-utils';
import SegmentedControl from './SegmentedControl.vue';
import FormGroup from './FormGroup.vue';

// Same house pattern as TaskRow.test.ts / ImageLightbox.test.ts: `components/ui/*.vue` relies on Nuxt's
// auto-imports, which vitest has no Nuxt to provide, so the few these two components use are stubbed onto
// globalThis with the REAL Vue implementations — they only read the current instance, so provide/inject
// still resolve across the parent/child boundary exactly as in the app. This is what lets the tests below
// mount the REAL FormGroup; a stub provides nothing and would prove nothing about the association.
vi.stubGlobal('computed', computed);
vi.stubGlobal('provide', provide);
vi.stubGlobal('inject', inject);
vi.stubGlobal('useId', useId);

const options = [
  { key: 'es', label: 'Español' },
  { key: 'en', label: 'English' },
];

describe('SegmentedControl', () => {
  it('marks the active option with aria-pressed=true and the others false', () => {
    const wrapper = mount(SegmentedControl, { props: { options, modelValue: 'es' } });
    const buttons = wrapper.findAll('button');
    expect(buttons[0].attributes('aria-pressed')).toBe('true');
    expect(buttons[1].attributes('aria-pressed')).toBe('false');
  });

  it('emits update:modelValue with the clicked key', async () => {
    const wrapper = mount(SegmentedControl, { props: { options, modelValue: 'es' } });
    await wrapper.findAll('button')[1].trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['en']);
  });

  it('does not re-emit when the active option is clicked again', async () => {
    const wrapper = mount(SegmentedControl, { props: { options, modelValue: 'es' } });
    await wrapper.findAll('button')[0].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('exposes role=group with the aria-label', () => {
    const wrapper = mount(SegmentedControl, { props: { options, modelValue: 'es', ariaLabel: 'Language' } });
    const group = wrapper.get('[role="group"]');
    expect(group.attributes('aria-label')).toBe('Language');
  });
});

// The FormGroup association. This component was the only one of the five controls a FormGroup wraps that
// injected neither of its ids, so commit 91f6610 (`<select>` -> SegmentedControl on /plants/new) turned a
// correctly-labelled field into an unnamed button group behind a `<label for>` pointing at nothing. These
// tests mount the REAL FormGroup — a stub would provide nothing and prove nothing — and assert the wiring
// the browser probe measured: the `for` target must EXIST and be a button (a `role="group"` div cannot take
// a `for` at all), it must be the ALREADY-SELECTED segment (so the label click, which really does activate
// its target, can never change the answer), it must keep its OWN accessible name against Chrome's habit of
// taking a button's name from an associated label, and the group must be named via `aria-labelledby`.
describe('SegmentedControl — the FormGroup label association', () => {
  const inGroup = (opts: { modelValue?: string; ariaLabel?: string; label?: string } = {}) => {
    const { modelValue = 'es', ariaLabel } = opts;
    // `'label' in opts`, not a destructuring default: a destructuring default also fires for an EXPLICIT
    // `undefined`, which is exactly the labelless case one of the tests below needs to construct.
    const label = 'label' in opts ? opts.label : 'Substrate';
    const model = ref(modelValue);
    const wrapper = mount(
      defineComponent({
        components: { FormGroup, SegmentedControl },
        setup: () => ({ model, options, ariaLabel, label }),
        template:
          '<FormGroup :label="label"><SegmentedControl v-model="model" :options="options" :aria-label="ariaLabel" /></FormGroup>',
      }),
    );
    return { wrapper, model };
  };

  it("the label's `for` target EXISTS — and is a button, the only thing a <label for> can associate with", () => {
    const { wrapper } = inGroup();
    const forId = wrapper.get('label').attributes('for');
    expect(forId).toBeTruthy();
    const target = wrapper.find(`#${forId}`);
    expect(target.exists()).toBe(true);
    expect(target.element.tagName).toBe('BUTTON');
  });

  it('targets the ALREADY-SELECTED segment, and follows the selection', async () => {
    // Load-bearing, not cosmetic: clicking a label ACTIVATES its target (measured in Chromium). Pointing it
    // at the selected segment makes that activation a no-op inside `choose()`, so the label can never
    // silently change the owner's answer.
    const { wrapper, model } = inGroup();
    expect(wrapper.get(`#${wrapper.get('label').attributes('for')}`).text()).toBe('Español');
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(model.value).toBe('en');
    expect(wrapper.get(`#${wrapper.get('label').attributes('for')}`).text()).toBe('English');
  });

  it("the targeted button keeps its OWN name — Chrome would otherwise announce it as the field's label", () => {
    const { wrapper } = inGroup();
    const forId = wrapper.get('label').attributes('for');
    // aria-label, not a self-referencing aria-labelledby: only aria-label was measured to beat the
    // associated `<label for>`. It repeats the visible text verbatim (WCAG 2.5.3 "Label in Name").
    expect(wrapper.get(`#${forId}`).attributes('aria-label')).toBe('Español');
    // ...and only the targeted one carries it — the others are named by their content, as before.
    expect(wrapper.findAll('button')[1]!.attributes('aria-label')).toBeUndefined();
  });

  it('names the GROUP via aria-labelledby pointing back at the FormGroup label', () => {
    const { wrapper } = inGroup();
    const labelId = wrapper.get('label').attributes('id');
    expect(labelId).toBeTruthy();
    expect(wrapper.get('[role="group"]').attributes('aria-labelledby')).toBe(labelId);
  });

  it('an explicit ariaLabel still wins — LocaleToggle and the blog editor are untouched', () => {
    const { wrapper } = inGroup({ ariaLabel: 'Language' });
    const group = wrapper.get('[role="group"]');
    expect(group.attributes('aria-label')).toBe('Language');
    expect(group.attributes('aria-labelledby')).toBeUndefined();
  });

  it('a labelless FormGroup hands out NO aria-labelledby — never a reference to an element that is not rendered', () => {
    // FormGroup renders its <label> under `v-if="label"`, which is exactly why the label id is provided as
    // a computed: a dangling aria-labelledby is the same "target does not exist" defect being fixed here.
    const { wrapper } = inGroup({ label: undefined });
    expect(wrapper.find('label').exists()).toBe(false);
    expect(wrapper.get('[role="group"]').attributes('aria-labelledby')).toBeUndefined();
  });

  it('outside a FormGroup nothing is injected: no id, no aria-label, no aria-labelledby', () => {
    const wrapper = mount(SegmentedControl, { props: { options, modelValue: 'es' } });
    expect(wrapper.get('[role="group"]').attributes('aria-labelledby')).toBeUndefined();
    for (const b of wrapper.findAll('button')) {
      expect(b.attributes('id')).toBeUndefined();
      expect(b.attributes('aria-label')).toBeUndefined();
    }
  });
});
