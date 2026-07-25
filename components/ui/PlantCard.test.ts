// @vitest-environment happy-dom
//
// This is the ONE card shared by /plants, /pantheon and /gifted (the fork-prevention fix: three
// near-identical card copies collapsed into this component). Its two behaviors that must NOT regress
// back into a per-page fork are exactly what this test pins: (1) the `variant` prop is what applies the
// pantheon/gifted commemorative modifier classes (never a page re-forking its own class strings), and
// (2) the due-count status badge only ever shows when the caller explicitly passes a `dueCount` — the
// modeled difference between the active `/plants` list and the frozen sections, which pass none.
import { describe, it, expect, vi } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import PlantCard from './PlantCard.vue';

// `computed` is normally a Nuxt auto-import; plain vitest + @vue/test-utils doesn't provide that global,
// so a bare `computed()` call inside the component's setup() throws "computed is not defined" — stub the
// real implementation as a global, same technique MeasureInfoModal.test.ts / ProgressForm.test.ts use.
vi.stubGlobal('computed', computed);
vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }));

const PLANT = {
  nickname: 'Gus',
  speciesScientificName: 'Ficus lyrata',
  speciesCommonNameEs: null,
  speciesCommonNameEn: null,
  speciesSlug: 'ficus-lyrata',
  coverImageUrl: null,
};

const stubs = {
  UiCard: { props: ['to', 'padded', 'class'], template: '<div class="stub-card" :data-class="Array.isArray($props.class) ? $props.class.filter(Boolean).join(\' \') : $props.class"><slot /></div>' },
  UiPlantPhoto: {
    props: ['src', 'alt', 'height', 'class'],
    template: '<div class="stub-photo" :data-class="Array.isArray($props.class) ? $props.class.filter(Boolean).join(\' \') : $props.class"><slot name="chips" /></div>',
  },
  UiPhotoChip: { props: ['icon', 'label'], template: '<span class="stub-chip">{{ label }}</span>' },
  UiPlantName: { props: ['title', 'scientific'], template: '<span class="stub-name">{{ title }}</span>' },
  UiPlantStatusBadge: { props: ['plant', 'dueCount'], template: '<span class="stub-badge" :data-due="dueCount" />' },
  UiAppIcon: true,
};

function mountCard(props: Record<string, unknown> = {}) {
  return mount(PlantCard, {
    props: { plant: PLANT, to: '/plants/p1', ...props },
    global: { stubs, mocks: { $t: (k: string) => k } },
  });
}

describe('UiPlantCard', () => {
  it('applies no modifier class and shows no badge by default (the /plants shape, minus the badge decision)', () => {
    const w = mountCard();
    expect(w.get('.stub-card').attributes('data-class')).toBe('');
    expect(w.get('.stub-photo').attributes('data-class')).toBe('mp-plant-card__banner');
    expect(w.find('.stub-badge').exists()).toBe(false);
  });

  it('shows the due-count badge only when dueCount is explicitly passed (the /plants list)', () => {
    const w = mountCard({ dueCount: 3 });
    const badge = w.get('.stub-badge');
    expect(badge.attributes('data-due')).toBe('3');
  });

  it('shows the badge even for dueCount=0 — "0" is a real value, not "omit"', () => {
    const w = mountCard({ dueCount: 0 });
    expect(w.find('.stub-badge').exists()).toBe(true);
    expect(w.get('.stub-badge').attributes('data-due')).toBe('0');
  });

  it('applies the pantheon modifier classes to the card and the photo, and omits the badge', () => {
    const w = mountCard({ variant: 'pantheon' });
    expect(w.get('.stub-card').attributes('data-class')).toBe('mp-card--pantheon');
    expect(w.get('.stub-photo').attributes('data-class')).toBe('mp-plant-card__banner mp-plantphoto--pantheon');
    expect(w.find('.stub-badge').exists()).toBe(false);
  });

  it('applies the gifted modifier classes to the card and the photo, and omits the badge', () => {
    const w = mountCard({ variant: 'gifted' });
    expect(w.get('.stub-card').attributes('data-class')).toBe('mp-card--gifted');
    expect(w.get('.stub-photo').attributes('data-class')).toBe('mp-plant-card__banner mp-plantphoto--gifted');
    expect(w.find('.stub-badge').exists()).toBe(false);
  });

  it('renders the place chip only when a placeLabel is given', () => {
    expect(mountCard().find('.stub-chip').exists()).toBe(false);
    expect(mountCard({ placeLabel: 'Study' }).get('.stub-chip').text()).toBe('Study');
  });

  it('renders no place chip for an empty-string placeLabel (frozen plants with no snapshot)', () => {
    expect(mountCard({ placeLabel: '' }).find('.stub-chip').exists()).toBe(false);
  });

  it('titles the card from the nickname, falling back to the species name', () => {
    expect(mountCard().get('.stub-name').text()).toBe('Gus');
    expect(
      mountCard({ plant: { ...PLANT, nickname: null, speciesCommonNameEn: 'Fiddle-leaf fig' } })
        .get('.stub-name')
        .text(),
    ).toBe('Fiddle-leaf fig');
  });
});
