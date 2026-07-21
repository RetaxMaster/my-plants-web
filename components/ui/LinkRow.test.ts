// @vitest-environment happy-dom
//
// LinkRow is the shared chrome extracted out of HistoryTimeline.vue's 'progress' and 'clinical' branches
// (they had grown byte-identical wrappers around two different icons/labels/events). This is the ONE test
// that proves the chrome itself — a real <button> with an icon, a slotted label, a date and a chevron —
// keeps its accessibility affordances: a native button is focusable and keyboard-operable by default
// (Space/Enter fire a click) with NO extra ARIA wiring, and its accessible name is computed from its own
// text content, so the slotted label alone is what a screen reader announces.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import LinkRow from './LinkRow.vue';

const ICON_STUB = {
  props: ['name', 'size', 'color'],
  template: '<span class="icon-stub" :data-name="name" />',
};

function mountRow(slotText = 'Progress logged') {
  return mount(LinkRow, {
    props: { icon: 'camera', dateLabel: 'today' },
    slots: { default: slotText },
    global: { stubs: { UiAppIcon: ICON_STUB } },
  });
}

describe('LinkRow (shared clickable-row chrome)', () => {
  it('renders as a native <button> — focus and keyboard operability come from that alone, never re-implemented', () => {
    const w = mountRow();
    const root = w.element;
    expect(root.tagName).toBe('BUTTON');
    expect(root.getAttribute('type')).toBe('button');
    // No explicit tabindex override: a native <button> is in the tab order by default, and pinning
    // tabindex="-1" here (accidentally or otherwise) would silently remove it from keyboard navigation
    // with no visual sign anything had changed.
    expect(root.hasAttribute('tabindex')).toBe(false);
    expect(root.hasAttribute('disabled')).toBe(false);
  });

  it("the slotted label IS the button's accessible name (no aria-label override hiding it)", () => {
    const w = mountRow('Clinical record created');
    expect(w.attributes('aria-label')).toBeUndefined();
    // A native button with no aria-label/aria-labelledby gets its accessible name from its own text
    // content — asserting the slot text is that content is what proves the label is actually announced.
    expect(w.text()).toContain('Clinical record created');
  });

  it('forwards the icon prop to UiAppIcon and always renders the trailing chevron', () => {
    const w = mountRow();
    const icons = w.findAll('.icon-stub');
    expect(icons).toHaveLength(2);
    expect(icons[0]!.attributes('data-name')).toBe('camera');
    expect(icons[1]!.attributes('data-name')).toBe('chevron-right');
  });

  it('renders the date label', () => {
    const w = mountRow();
    expect(w.get('.mp-history__date').text()).toBe('today');
  });

  it('emits "click" exactly once per click, with no payload', async () => {
    const w = mountRow();
    await w.get('button').trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
    expect(w.emitted('click')![0]).toEqual([]);
  });

  it('keeps the same classes HistoryTimeline.vue styles, so no CSS had to fork', () => {
    const w = mountRow();
    expect(w.classes()).toContain('mp-history__row');
    expect(w.classes()).toContain('mp-history__row--link');
    // .get() throws if the element is missing, so reaching this line already proves it exists.
    expect(w.get('.mp-history__text').text()).toContain('Progress logged');
  });
});
