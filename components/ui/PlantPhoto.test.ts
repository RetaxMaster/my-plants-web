// @vitest-environment happy-dom
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useSlots } from 'vue';
import PlantPhoto from './PlantPhoto.vue';

// `useSlots` is normally a Nuxt auto-import; plain vitest + @vue/test-utils (no auto-import shim) doesn't
// provide that global, so the component's own `useSlots()` call throws "useSlots is not defined" — stub the
// real `vue` implementation as a global, the same technique ImageLightbox.test.ts / ProgressForm.test.ts use.
vi.stubGlobal('useSlots', useSlots);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('UiPlantPhoto — the clickable affordance', () => {
  it('is inert by default: no button, no event', async () => {
    const w = mount(PlantPhoto, { props: { src: '/a.png', alt: 'a plant' } });
    expect(w.find('button').exists()).toBe(false);
  });

  // A real <button>, not a click handler on the <img>: this must be reachable by keyboard and announced
  // as an action, which a bare click listener on an image is neither.
  it('renders a real button and emits `open` when clickable', async () => {
    const w = mount(PlantPhoto, {
      props: { src: '/a.png', alt: 'a plant', clickable: true, openLabel: 'View photo' },
    });
    const button = w.find('button.mp-plantphoto__open');
    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-label')).toBe('View photo');
    await button.trigger('click');
    expect(w.emitted('open')).toHaveLength(1);
  });

  // Nothing to open. A viewer showing the generic leafy default would be an affordance that lies.
  it('renders no button when there is no photo, even if clickable', () => {
    const w = mount(PlantPhoto, { props: { src: null, clickable: true, openLabel: 'View photo' } });
    expect(w.find('button.mp-plantphoto__open').exists()).toBe(false);
  });
});
