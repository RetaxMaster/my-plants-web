// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed, watch } from 'vue';
import PlantProfileModal from './PlantProfileModal.vue';

// Nuxt auto-imports (`ref`/`computed`/`watch`/`useId`/`useI18n`/`useApi`/`useProfileMeta`) don't exist as
// globals outside Nuxt's build pipeline (plain vitest + @vue/test-utils, no auto-import shim) — same
// technique ProgressForm.test.ts uses.
vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useId', () => 'test-id');
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useApi', () => ({
  getPlantProfile: () => Promise.resolve({
    windowDistance: null, potType: null, soilMix: null, growthHabit: null,
    growLight: null, hasDrainage: null, nearHeater: null, potSizeCm: null, ageMonths: null,
  }),
  updatePlantProfile: () => Promise.resolve(),
}));
vi.stubGlobal('useProfileMeta', () => ({
  windowDistanceOptions: computed(() => []),
  potTypeOptions: computed(() => []),
  soilMixOptions: computed(() => []),
  growthHabitOptions: computed(() => []),
}));

function mountProfileModal(props: Record<string, unknown> = {}) {
  return mount(PlantProfileModal, {
    props: { open: true, plantId: 'p1', ...props },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        // Passthrough exposing BOTH label and hint (the contract: the pot-size field passes a hint).
        UiFormGroup: { props: ['label', 'hint'], template: '<div><span class="lbl">{{ label }}</span><span class="hint">{{ hint }}</span><slot /></div>' },
        UiSlider: true, UiSelectField: true, UiSwitch: true, UiInput: true, UiButton: true,
        UiModal: { template: '<div><slot /></div>' },
      },
    },
  });
}

describe('PlantProfileModal pot-size field', () => {
  it('renders the rim-diameter label AND the rim-to-rim hint', () => {
    const w = mountProfileModal();
    expect(w.text()).toContain('plantProfile.potSize');     // "Pot diameter (at the rim)"
    expect(w.text()).toContain('plantProfile.potSizeHint'); // "Measure rim-to-rim across the top…"
  });
});
