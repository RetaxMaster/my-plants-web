// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SegmentedControl from './SegmentedControl.vue';

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
