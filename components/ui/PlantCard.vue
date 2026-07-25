<script setup lang="ts">
// The shared list-card row: banner photo (with an optional place chip), name + scientific, a chevron,
// and (only for the active `/plants` list) the due-count status badge. `/plants`, `/pantheon` and
// `/gifted` all render this ONE component instead of three near-identical copies — see the fork-
// prevention rule in the workspace guide (no parallel per-context copies of a shared surface).
import { plantTitle } from '../../utils/displayName.js';

defineOptions({ inheritAttrs: false });

// `plant` is typed loosely (rather than importing the `Plant` API type) so this card also fits any
// future list of plant-shaped records without a type-import coupling; the fields it actually reads are
// exactly the ones every plant list already carries.
const props = withDefaults(
  defineProps<{
    plant: {
      coverImageUrl?: string | null;
      nickname?: string | null;
      speciesCommonNameEs?: string | null;
      speciesCommonNameEn?: string | null;
      speciesScientificName?: string | null;
      speciesSlug?: string | null;
    };
    to: string;
    // The commemorative sections (pantheon/gifted) apply a design-pass modifier class to the card AND
    // the photo; the default (undefined) is the active `/plants` look. See assets/css/chrome.css for
    // `.mp-card--pantheon`/`.mp-card--gifted`/`.mp-plantphoto--pantheon`/`.mp-plantphoto--gifted`.
    variant?: 'pantheon' | 'gifted';
    // The chip rendered over the photo; each list resolves it from a different source (place lookup
    // for `/plants`, `frozenPlaceLabel` snapshot for the frozen sections) so the card just renders
    // whatever label it is handed, or nothing when null/empty.
    placeLabel?: string | null;
    // The due-count status badge only applies to the ACTIVE `/plants` list — a frozen plant carries no
    // care-engine data. `null`/`undefined` (the default) omits the badge entirely; passing a number
    // (including 0) shows it. This is the prop that models the badge-on/off difference between lists.
    dueCount?: number | null;
    class?: unknown;
  }>(),
  {
    variant: undefined,
    placeLabel: null,
    dueCount: null,
  },
);

const { locale } = useI18n();

const title = computed(() => plantTitle(props.plant, locale.value));
const cardModifierClass = computed(() => (props.variant ? `mp-card--${props.variant}` : null));
const photoModifierClass = computed(() => (props.variant ? `mp-plantphoto--${props.variant}` : null));
const showBadge = computed(() => props.dueCount !== null && props.dueCount !== undefined);
</script>

<template>
  <UiCard :to="to" :padded="false" :class="[cardModifierClass, props.class]">
    <UiPlantPhoto
      :src="plant.coverImageUrl"
      :alt="$t('plantPhoto.alt', { name: title })"
      :height="118"
      :class="['mp-plant-card__banner', photoModifierClass]"
    >
      <template v-if="placeLabel" #chips>
        <UiPhotoChip icon="map-pin" :label="placeLabel" />
      </template>
    </UiPlantPhoto>
    <div class="mp-plant-card__row">
      <div class="mp-plant-card__info">
        <UiPlantName :title="title" :scientific="plant.speciesScientificName ?? undefined" />
      </div>
      <UiPlantStatusBadge v-if="showBadge" :plant="plant" :due-count="dueCount ?? 0" />
      <UiAppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
    </div>
  </UiCard>
</template>

<style scoped>
/* Banner sits flush at the card's top edge (the card clips it to its rounded corners); square its own
   corners so only the card radius shows. */
.mp-plant-card__banner {
  border-radius: 0;
}

.mp-plant-card__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.mp-plant-card__info {
  flex: 1;
  min-width: 0;
}
</style>
