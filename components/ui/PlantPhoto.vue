<script setup lang="ts">
// Horizontal center-cropped plant banner. A real <img object-fit:cover> in a fixed-height box crops any
// source dimensions with no layout shift; when there is no cover photo it shows the design's generic
// leafy default IMAGE (a repo asset at /plant-default.png) — no drop affordance, no placeholder icon.
// Overlaid chips (place/viability) go in the `chips` slot; an optional `overlay` slot (top-right) hosts
// an edit affordance on the detail hero.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    src?: string | null;
    alt?: string;
    height?: number;
    class?: unknown;
  }>(),
  {
    src: null,
    alt: '',
    height: 128,
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
  /* Design's leafy default IMAGE (repo asset, not R2) — the decoration for plants with no cover. */
  background: url('/plant-default.png') center / cover no-repeat, var(--surface-sunken);
}

.mp-plantphoto__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
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
