// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, watch, inject } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import { useProfileMeta } from '../composables/useProfileMeta';
import PlantProfileModal from './PlantProfileModal.vue';
import SelectFieldReal from './ui/SelectField.vue';
import type { GrowthHabit } from '@retaxmaster/my-plants-species-schema/plant-profile-constants';

// Nuxt auto-imports (`ref`/`computed`/`watch`/`useI18n`/`useApi`/`useProfileMeta`) don't exist as globals
// outside Nuxt's build pipeline (plain vitest + @vue/test-utils, no auto-import shim) — same technique
// ProgressForm.test.ts / PlantDetail.test.ts use. Real vue-i18n messages are used here (not a mocked
// passthrough `t`), because the growth-habit provenance/warning assertions (Spec 2 §5.4) are on the ACTUAL
// user-facing text, not just a key name — and `useProfileMeta` is the REAL composable so `growthHabitLabel`
// resolves real species-habit wording too, instead of a stubbed empty option list.
const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, es } }).global;

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
// The REAL SelectField.vue (mounted only by the QA-defect-F test below, via `stubOverrides`) calls
// `inject('mpFieldId', ...)` in its own setup — same requirement RepotDoneForm.test.ts / pages/index.test.ts
// already stub for the same reason.
vi.stubGlobal('inject', inject);
vi.stubGlobal('useI18n', () => ({ t: i18n.t }));
vi.stubGlobal('useProfileMeta', useProfileMeta);

// Passthrough exposing BOTH label and hint (the contract: the pot-size AND the growth-habit fields pass a
// hint). UiSelectField/UiButton/UiModal are collapsed to REAL v-model / event contracts (same technique
// PlantDetail.test.ts uses) so a real `setValue`/click drives the component's own state, not a shallow stub.
const UiFormGroupStub = {
  props: ['label', 'hint'],
  template: '<div><span class="lbl">{{ label }}</span><span class="hint">{{ hint }}</span><slot /></div>',
};
const UiSelectFieldStub = {
  props: ['modelValue', 'options', 'placeholder', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)">'
    + '<option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
};
const UiButtonStub = {
  props: ['disabled', 'loading', 'color', 'variant'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
};
const UiModalStub = {
  props: ['modelValue', 'title'],
  emits: ['update:modelValue'],
  template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
};

const stubs = {
  UiFormGroup: UiFormGroupStub,
  UiSelectField: UiSelectFieldStub,
  UiButton: UiButtonStub,
  UiModal: UiModalStub,
  UiSlider: true,
  UiSwitch: true,
  UiInput: true,
};

let lastPatch: Record<string, unknown> | undefined;

function stubApi(profile: Record<string, unknown>) {
  lastPatch = undefined;
  vi.stubGlobal('useApi', () => ({
    getPlantProfile: () => Promise.resolve({
      windowDistance: null,
      potType: null,
      soilMix: null,
      growthHabit: null,
      growLight: null,
      hasDrainage: null,
      nearHeater: null,
      potSizeCm: null,
      ageMonths: null,
      ...profile,
    }),
    updatePlantProfile: (_id: string, patch: Record<string, unknown>) => {
      lastPatch = patch;
      return Promise.resolve();
    },
  }));
}

function savedPatch() {
  return lastPatch;
}

// Mounts CLOSED then opens it (mirrors a real caller toggling `v-model`), so the `watch(open, ...)` fetch
// actually runs — a component mounted already-open would skip that watcher and never pick up `profile`.
async function mountModal({
  profile = {},
  speciesGrowthHabit = null,
  stubOverrides = {},
}: {
  profile?: Record<string, unknown>;
  speciesGrowthHabit?: GrowthHabit | null;
  stubOverrides?: Record<string, unknown>;
} = {}) {
  stubApi(profile);
  const w = mount(PlantProfileModal, {
    props: { modelValue: false, plantId: 'p1', speciesGrowthHabit },
    global: { mocks: { $t: i18n.t }, stubs: { ...stubs, ...stubOverrides } },
  });
  await w.setProps({ modelValue: true });
  await flushPromises();
  return w;
}

describe('PlantProfileModal pot-size field', () => {
  it('renders the rim-diameter label AND the rim-to-rim hint', async () => {
    const w = await mountModal();
    expect(w.text()).toContain('Pot diameter (at the rim)');
    expect(w.text()).toContain('Measure rim-to-rim across the top');
  });
});

describe('growth habit — inheritance and the trailing warning (Spec 2 §5.4)', () => {
  it('shows the inherited species habit with its provenance when the profile has none', async () => {
    const wrapper = await mountModal({
      profile: { growthHabit: null },
      speciesGrowthHabit: 'climber',
    });
    expect(wrapper.text()).toContain('inherited from the species');
  });

  it('does NOT show the provenance note when the owner set the habit themselves', async () => {
    const wrapper = await mountModal({
      profile: { growthHabit: 'upright' },
      speciesGrowthHabit: 'climber',
    });
    expect(wrapper.text()).not.toContain('inherited from the species');
  });

  it('SAYS what selecting `trailing` does, rather than letting the owner discover it by silence', async () => {
    const wrapper = await mountModal({ profile: { growthHabit: null }, speciesGrowthHabit: null });
    await wrapper.find('[data-test="growth-habit-select"]').setValue('trailing');
    expect(wrapper.text()).toContain('removes the height signal');
  });

  it('the field stays EDITABLE on an inherited value, and saving sends the chosen habit', async () => {
    const wrapper = await mountModal({ profile: { growthHabit: null }, speciesGrowthHabit: 'climber' });
    await wrapper.find('[data-test="growth-habit-select"]').setValue('trailing');
    await wrapper.find('[data-test="profile-save"]').trigger('click');
    await flushPromises();
    expect(savedPatch()).toMatchObject({ growthHabit: 'trailing' });
  });

  it('leaving an inherited habit untouched does NOT persist it (no copy-on-save)', async () => {
    // A save that wrote the inherited value into the profile would be a copy — the exact fork the
    // read-time fallback exists to avoid. It must stay null until the owner picks something.
    const wrapper = await mountModal({ profile: { growthHabit: null }, speciesGrowthHabit: 'climber' });
    await wrapper.find('[data-test="profile-save"]').trigger('click');
    await flushPromises();
    expect(savedPatch()?.growthHabit).toBeNull();
  });

  // QA defect F: the growth-habit field used to pass BOTH `:options="withNotSet(growthHabitOptions)"` and a
  // `:placeholder`, and the REAL SelectField.vue renders its own `<option value="">` whenever `placeholder`
  // is truthy — on top of the enabled blank option `withNotSet` already prepends. That produced TWO blank
  // options where only one is selectable. The passthrough `UiSelectFieldStub` above never rendered a
  // placeholder option at all, so it could never have caught this — this test mounts the REAL SelectField.vue
  // instead, which is the only way to see the actual duplicate (or its absence) in the DOM.
  it('renders exactly one selectable <option value=""> (QA defect F — no duplicate blank option)', async () => {
    const wrapper = await mountModal({
      profile: { growthHabit: null },
      speciesGrowthHabit: 'climber',
      stubOverrides: { UiSelectField: SelectFieldReal, Icon: true },
    });
    const growthHabitSelect = wrapper.find('[data-test="growth-habit-select"]');
    expect(growthHabitSelect.exists()).toBe(true);
    const blankOptions = growthHabitSelect.findAll('option[value=""]');
    expect(blankOptions.length).toBe(1);
    // And it must be selectable (not the disabled placeholder the old bug left behind), carrying the
    // inherited habit's own label — never a generic "pick an option" once a species habit exists to show.
    expect((blankOptions[0]!.element as HTMLOptionElement).disabled).toBe(false);
    expect(blankOptions[0]!.text()).toContain('inherited from the species');
  });
});
