<script setup lang="ts">
// Horizontal center-cropped plant banner. A real <img object-fit:cover> in a fixed-height box crops any
// source dimensions with no layout shift; when there is no cover photo it shows the design's generic
// leafy gradient (empty-state look, no drop affordance). Overlaid chips (place/viability) go in the
// `chips` slot; an optional `overlay` slot (top-right) hosts an edit affordance on the detail hero.
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    src?: string | null;
    alt?: string;
    height?: number;
    // Icon shown centered on the generic (no-photo) background.
    placeholderIcon?: string;
    class?: unknown;
  }>(),
  {
    src: null,
    alt: '',
    height: 128,
    placeholderIcon: 'sparkles',
  },
);

const slots = useSlots();
</script>

<template>
  <div
    :class="['mp-plantphoto', { 'mp-plantphoto--empty': !src }, props.class]"
    :style="{ height: height + 'px' }"
    v-bind="$attrs"
  >
    <img v-if="src" :src="src" :alt="alt" class="mp-plantphoto__img" loading="lazy" />
    <div v-else class="mp-plantphoto__placeholder" aria-hidden="true">
      <AppIcon :name="placeholderIcon" :size="Math.round(height * 0.28)" color="var(--photo-empty-ink)" />
    </div>

    <div v-if="slots.chips" class="mp-plantphoto__chips">
      <slot name="chips" />
    </div>
    <div v-if="slots.overlay" class="mp-plantphoto__overlay">
      <slot name="overlay" />
    </div>
  </div>
</template>

<style scoped>
.mp-plantphoto {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-banner);
  background: var(--surface-sunken);
}

.mp-plantphoto--empty {
  background: linear-gradient(135deg, var(--photo-empty-from), var(--photo-empty-to));
}

.mp-plantphoto__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mp-plantphoto__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  opacity: 0.65;
}

.mp-plantphoto__chips {
  position: absolute;
  left: var(--space-2);
  bottom: var(--space-2);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  max-width: calc(100% - var(--space-4));
}

.mp-plantphoto__overlay {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
}
</style>
