// @vitest-environment happy-dom
//
// EXPLICIT OWNER RULING (Spec 4 §7): the gardener is reachable through ONE action in the /plants page
// header, NOT one per plant card. A per-card button would read as "the gardener OF THIS PLANT", which is
// the Doctor's role, and repeating it under every card is an invitation to exactly the role confusion the
// whole two-agent design exists to prevent.
//
// The assertion that actually pins that ruling is the COUNT AGAINST A MULTI-PLANT GARDEN: a per-card
// button renders once per plant, so mounting three plants and demanding exactly one entry is a test a
// regression cannot pass. "It is not inside a card" alone would be vacuous — a selector that matches
// nothing is `false` whether the rule holds or not.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import UiScreenHeader from '../../components/ui/ScreenHeader.vue';

const PLANTS = [
  { id: 'p1', nickname: 'Gus', speciesScientificName: 'Ficus lyrata', placeId: 'pl1', coverImageUrl: null },
  { id: 'p2', nickname: 'Randy', speciesScientificName: 'Nephrolepis biserrata', placeId: 'pl1', coverImageUrl: null },
  { id: 'p3', nickname: 'Mila', speciesScientificName: 'Monstera deliciosa', placeId: 'pl1', coverImageUrl: null },
];

// The page reaches for these through Nuxt's auto-imports, so they are globals here rather than module
// imports. `computed` must be stubbed too for the same reason — this SFC does not import it explicitly.
vi.stubGlobal('computed', computed);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useIsDesktop', () => ref(true));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});
vi.stubGlobal('navigateTo', vi.fn());

let plants = PLANTS;

beforeEach(() => {
  plants = PLANTS;
  vi.stubGlobal('useApi', () => ({
    listPlants: async () => plants,
    todaysTasks: async () => [],
    listPlaces: async () => [{ id: 'pl1', name: 'Study' }],
  }));
  // Faithful enough for this page: it awaits the fetcher and reads `.data`. Returning a ref of the real
  // resolved value (rather than a fixture chosen here) keeps the assertion about the PAGE's behaviour.
  vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
    data: ref(await fn()),
  }));
});

// `UiScreenHeader` is deliberately the REAL component, registered explicitly (Nuxt's auto-import does not
// exist under vitest, and an unregistered component renders as an inert unknown element that silently
// swallows its slots). It owns the `#action` slot's placement and the `.mp-screen-header` class this test
// asserts against, so stubbing it would leave the test measuring markup invented right here.
const components = { UiScreenHeader };

const stubs = {
  UiAppIcon: true,
  UiCard: { props: ['to', 'padded'], template: '<div class="stub-card"><slot /></div>' },
  UiCardGrid: { template: '<div class="stub-grid"><slot /></div>' },
  UiEmptyState: { template: '<div><slot /></div>' },
  UiPlantPhoto: { template: '<div><slot name="chips" /></div>' },
  UiPhotoChip: { props: ['icon', 'label'], template: '<span>{{ label }}</span>' },
  UiPlantName: { props: ['title', 'scientific'], template: '<span>{{ title }}</span>' },
  UiPlantStatusBadge: { props: ['plant', 'dueCount'], template: '<span />' },
  // `to` is deliberately NOT declared on this stub. The real UiButton declares it (and renders a
  // NuxtLink), which means Vue consumes it and it never reaches the DOM — leaving the destination of
  // this action unassertable. Undeclared, it falls through as a plain attribute, so the test can pin
  // WHERE the header action points, which is half the owner's ruling: garden-wide, never plant-scoped.
  UiButton: {
    props: ['icon', 'variant', 'color'],
    emits: ['click'],
    template: '<button @click="$emit(\'click\')"><slot /></button>',
  },
};

// The page's `<script setup>` awaits `useAsyncData` at the top level, which makes its setup async — and
// an async setup renders NOTHING without a <Suspense> boundary above it (Vue warns, and every `find()`
// then comes back empty, i.e. every assertion here would pass or fail for the wrong reason). So the page
// is mounted inside a Suspense host, exactly as Nuxt's own page renderer does.
async function mountPage() {
  const PlantsIndex = (await import('./index.vue')).default;
  const w = mount(
    { components: { PlantsIndex }, template: '<Suspense><PlantsIndex /></Suspense>' },
    { global: { components, stubs, mocks: { $t: (k: string) => k } } },
  );
  await flushPromises();
  return w;
}

describe('the /plants gardener entry point', () => {
  it('renders the gardener action EXACTLY once, in the page header, across a multi-plant garden', async () => {
    const w = await mountPage();
    expect(w.findAll('.stub-card')).toHaveLength(3); // the garden really does have three plants…
    expect(w.findAll('[data-testid="gardener-entry"]')).toHaveLength(1); // …and exactly one gardener action
    expect(w.find('.mp-screen-header [data-testid="gardener-entry"]').exists()).toBe(true);
  });

  it('renders NO gardener action inside the plant grid', async () => {
    const w = await mountPage();
    const grid = w.find('.stub-grid');
    expect(grid.exists()).toBe(true); // guards the selector: an absent grid would make the next line vacuous
    expect(grid.find('[data-testid="gardener-entry"]').exists()).toBe(false);
  });

  it('still offers the gardener when the garden is empty — it is a garden-wide surface, not a per-plant one', async () => {
    plants = [];
    const w = await mountPage();
    expect(w.findAll('[data-testid="gardener-entry"]')).toHaveLength(1);
  });

  it('links to /gardener rather than to any plant-scoped route', async () => {
    const w = await mountPage();
    // Readable as a DOM attribute only because the stub leaves `to` undeclared — see the stub's comment.
    expect(w.get('[data-testid="gardener-entry"]').attributes('to')).toBe('/gardener');
  });
});
