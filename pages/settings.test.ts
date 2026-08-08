// @vitest-environment happy-dom
//
// Fix wave 1, item 6: `useAsyncData`'s `error` was never destructured, so a failed `getOwnerInstruments()`
// rendered the header, the lead copy, zero instrument rows, and a headers-only comparison table —
// indistinguishable from a genuinely empty catalogue. The catalogue is never legitimately empty
// (`available` is the full shared-contract table), so an empty render always means something failed. This
// pins the fix: a distinct load-error banner with a retry affordance, same component/shape as
// `PlantDetail.vue`'s `evaluationLoadFailed` banner.
//
// `pages/settings.vue` explicitly IMPORTS its child components (Card/ScreenHeader/SectionTitle/Switch/
// Alert/Button/InstrumentComparisonTable) rather than relying on Nuxt's auto-import — unlike most other
// pages in this test suite (see pages/plants/new.test.ts's `UiScreenHeader`-prefixed stubs), a direct
// `<script setup>` import is inlined at compile time and bypasses Vue's runtime component resolver, so
// `@vue/test-utils`'s `stubs` option cannot intercept it. The REAL component tree is mounted instead — none
// of these are Nuxt-specific beyond the auto-imported composables already stubbed below.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed, inject, useSlots, resolveComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
// Needed because Switch.vue calls Vue's `inject()` directly for FormGroup's field-id wiring — same
// requirement SoilReadingModal.test.ts documents for SegmentedControl. Switch is used bare here (no
// FormGroup ancestor), so it resolves to the declared default (`undefined`), harmless to every assertion
// below.
vi.stubGlobal('inject', inject);
// Card.vue calls Vue's `useSlots()` directly (to decide whether it renders as a link vs a plain div), and
// both Card.vue and Button.vue call `resolveComponent('NuxtLink')` directly (only USED when a `to` prop is
// set — neither call site here ever passes one, so the unregistered name resolves harmlessly).
vi.stubGlobal('useSlots', useSlots);
vi.stubGlobal('resolveComponent', resolveComponent);
vi.stubGlobal('useI18n', () => ({ t: (k: string, params?: Record<string, unknown>) =>
  (params ? `${k}|${Object.values(params).join('|')}` : k) }));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});

// Faithful to Nuxt's REAL `useAsyncData` contract, which is the whole point of this suite: a rejected
// fetcher populates `error` — it does NOT throw to the caller — exactly why `pages/settings.vue` can
// destructure `error` straight off the return value with no try/catch of its own.
vi.stubGlobal('useAsyncData', (_key: string, fn: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  const error = ref<unknown>(null);
  const load = async () => {
    try {
      data.value = await fn();
      error.value = null;
    } catch (e) {
      error.value = e;
    }
  };
  return load().then(() => ({ data, error, refresh: load }));
});

const AVAILABLE = [
  {
    id: 'galvanic-probe', kind: 'moisture', unit: '1–10 index', comparableAcrossPots: false,
    requiresCalibration: false,
  },
  {
    id: 'kitchen-scale', kind: 'moisture', unit: 'grams', comparableAcrossPots: false,
    requiresCalibration: true,
  },
];

let getOwnerInstrumentsImpl: () => Promise<unknown>;
const setOwnerInstrumentsMock = vi.fn(async () => ({ available: AVAILABLE, selected: [] }));

beforeEach(() => {
  getOwnerInstrumentsImpl = async () => ({ available: AVAILABLE, selected: [] });
  setOwnerInstrumentsMock.mockClear();
  vi.stubGlobal('useApi', () => ({
    getOwnerInstruments: () => getOwnerInstrumentsImpl(),
    setOwnerInstruments: setOwnerInstrumentsMock,
  }));
});

// The page's `<script setup>` awaits `useAsyncData` at the top level (async setup), which renders nothing
// without a <Suspense> boundary above it — same convention pages/plants/index.test.ts uses.
async function mountPage() {
  const SettingsPage = (await import('./settings.vue')).default;
  const w = mount(
    { components: { SettingsPage }, template: '<Suspense><SettingsPage /></Suspense>' },
    { global: { mocks: { $t: (k: string) => k } } },
  );
  await flushPromises();
  return w;
}

describe('pages/settings — a failed instruments load (fix wave 1, item 6)', () => {
  it('renders a distinct load-error banner instead of a silent empty catalogue', async () => {
    getOwnerInstrumentsImpl = async () => { throw new Error('network down'); };
    const w = await mountPage();

    expect(w.text()).toContain('settings.instruments.loadError');
    // The catalogue is never legitimately empty — a healthy page always shows both rows.
    expect(w.findAll('.mp-settings__row')).toHaveLength(0);
  });

  it('never shows the load-error banner on a healthy load', async () => {
    const w = await mountPage();
    expect(w.text()).not.toContain('settings.instruments.loadError');
    expect(w.findAll('.mp-settings__row')).toHaveLength(2);
  });

  it('retrying re-runs the SAME fetch and clears the banner once it succeeds', async () => {
    getOwnerInstrumentsImpl = async () => { throw new Error('network down'); };
    const w = await mountPage();
    expect(w.text()).toContain('settings.instruments.loadError');

    // The owner's retry click coincides with the fetch recovering (a real reload would too).
    getOwnerInstrumentsImpl = async () => ({ available: AVAILABLE, selected: [] });
    const retryButton = w.findAll('button').find((b) => b.text().includes('settings.instruments.retry'))!;
    await retryButton.trigger('click');
    await flushPromises();

    expect(w.text()).not.toContain('settings.instruments.loadError');
    expect(w.findAll('.mp-settings__row')).toHaveLength(2);
  });

  it('does not touch the UNRELATED save-failure path — Switch/toggle failures still use their own message', async () => {
    setOwnerInstrumentsMock.mockRejectedValueOnce(new Error('boom'));
    const w = await mountPage();
    // The toggle affordance is Switch.vue's own root control — locate it by its aria role, then flip it
    // to trigger the EXISTING save-failure path, untouched by this fix.
    const switchControl = w.find('[role="switch"]');
    expect(switchControl.exists()).toBe(true);
    await switchControl.trigger('click');
    await flushPromises();

    expect(w.text()).toContain('settings.instruments.saveFailed');
    expect(w.text()).not.toContain('settings.instruments.loadError');
  });
});
