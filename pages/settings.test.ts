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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, inject, useSlots, resolveComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { INSTRUMENT_LIST } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import type { OwnerInstruments } from '../types/api';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';

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
// The passthrough `t` used by every test above/unrelated to the honesty-rule suite below: it stubs `t` as an
// identity function (returns the key itself) so those tests can assert on stable key names regardless of
// copy wording. It cannot tell a REAL translation apart from a raw, untranslated key path — so it could
// never have caught the live defect this task opens with (a missing en.json/es.json entry rendering as
// `settings.instruments.name.wooden-stick`). The honesty-rule describe block below swaps this out for a
// REAL `vue-i18n` instance loaded from the actual locale files, precisely so a missing key genuinely
// reproduces vue-i18n's own fallback behavior (returning the raw keypath) instead of a stub's approximation.
const passthroughT = (k: string, params?: Record<string, unknown>) =>
  (params ? `${k}|${Object.values(params).join('|')}` : k);
vi.stubGlobal('useI18n', () => ({ t: passthroughT }));
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

// FIX (this task): the fixture used to be a hand-written pair of instrument-shaped object literals, and the
// fetcher stub below was typed `Promise<unknown>` — so TypeScript never structurally checked either one
// against the real contract. When `captureKind` landed as a required field on `InstrumentRow`, 39 sites went
// red in the modal's tests while this fixture stayed silently green holding the same incomplete shape (no
// `scale`/`direction`/`protocolKind`/`captureKind`/`rawMin`/`rawMax`/`rawStep`). Sourcing the fixture directly
// from the shared contract's own `INSTRUMENT_LIST` — the exact table the API serves — makes that structurally
// impossible: a fixture that is the real catalogue can never diverge from it, and it also means a future 5th
// instrument (or a 6th) joins these tests with zero edits here, the same "iterate the catalogue" discipline
// the page itself follows.
const AVAILABLE: OwnerInstruments['available'] = [...INSTRUMENT_LIST];

let getOwnerInstrumentsImpl: () => Promise<OwnerInstruments>;
const setOwnerInstrumentsMock = vi.fn(async (): Promise<OwnerInstruments> => ({ available: AVAILABLE, selected: [] }));

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
    expect(w.findAll('.mp-settings__row')).toHaveLength(INSTRUMENT_LIST.length);
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
    expect(w.findAll('.mp-settings__row')).toHaveLength(INSTRUMENT_LIST.length);
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

// The live defect this task opens with: the catalogue grew two new ordinal instruments (`wooden-stick`,
// `finger`) and nobody added their `en.json`/`es.json` copy, so the page rendered raw key paths — literally
// `settings.instruments.name.wooden-stick` — where a name should be. This suite mounts the page against a
// REAL vue-i18n instance (see `realI18n` below) so a missing message genuinely reproduces vue-i18n's own
// fallback behavior instead of a stub's approximation, which is what makes the first test below load-bearing:
// it would have gone red the moment the two new rows joined `INSTRUMENT_IDS` without their copy.
const realI18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, es } }).global;

describe('pages/settings — the instrument ladder honesty rule', () => {
  beforeEach(() => {
    vi.stubGlobal('useI18n', () => ({ t: realI18n.t }));
  });

  // Restore the passthrough stub the rest of the file relies on, so this suite's real-i18n swap stays
  // scoped to its own tests and never leaks into a describe block that runs after it.
  afterEach(() => {
    vi.stubGlobal('useI18n', () => ({ t: passthroughT }));
  });

  it('names every instrument the contract publishes — no raw key paths', async () => {
    const w = await mountPage();
    // A raw, untranslated key path always contains this literal substring (vue-i18n's fallback IS the
    // keypath itself) — a real translation, in either locale, never does. Checking the whole rendered page
    // covers both the row list AND the comparison table, which read the exact same `t(...)` key shapes.
    expect(w.text()).not.toContain('settings.instruments.');
    // Belt and suspenders, anchored to the catalogue rather than a hand-written id list: every row's own
    // name must have rendered as something other than its raw key.
    for (const row of AVAILABLE) {
      expect(w.text()).not.toContain(`settings.instruments.name.${row.id}`);
    }
  });

  it('states a consequence for every instrument', async () => {
    const w = await mountPage();
    // Scoped to `.mp-settings__row` — the baseline "no instrument" block below also uses `.mp-settings__sub`
    // for its own description, and that one is asserted separately in the next test.
    const subs = w.findAll('.mp-settings__row .mp-settings__sub').map((el) => el.text());
    expect(subs).toHaveLength(AVAILABLE.length);
    for (const text of subs) {
      // Real prose, not an empty string or a bare label — long enough to state a consequence, not just
      // name the instrument again.
      expect(text.length).toBeGreaterThan(20);
    }
    // Each instrument's consequence is its OWN — no two rows sharing one copy-pasted sentence.
    expect(new Set(subs).size).toBe(subs.length);
  });

  it('tells the owner what declining to measure means', async () => {
    const w = await mountPage();
    expect(w.text()).toContain(realI18n.t('settings.instruments.noInstrument.title'));
    expect(w.text()).toContain(realI18n.t('settings.instruments.noInstrument.description'));
    // The bottom rung is always visible — it is the state the app is in whenever nothing is selected, not
    // a fact that depends on today's fixture selecting zero instruments.
    expect(w.find('.mp-settings__baseline').exists()).toBe(true);
  });

  it('never publishes a reliability percentage', async () => {
    const w = await mountPage();
    // No figure enters this screen without the command that produced it (care-engine honesty rule,
    // extended here to the instrument ladder) — so no percentage may appear anywhere on the page.
    expect(w.text()).not.toMatch(/\d+\s?%/);
  });
});
