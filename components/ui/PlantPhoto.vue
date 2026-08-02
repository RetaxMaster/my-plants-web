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
    /** Make the photo openable. Renders a real, keyboard-reachable button over the image and emits
     *  `open`; the CALLER decides what opening means (today: the shared ImageLightbox). Inert by
     *  default, so every existing usage is byte-for-byte unchanged. */
    clickable?: boolean;
    /** The accessible name for that button. REQUIRED in practice when `clickable` — an icon-free
     *  full-bleed control with no label is invisible to a screen reader. Localized by the caller: this
     *  is a design-system primitive and owns no copy. */
    openLabel?: string;
  }>(),
  {
    src: null,
    alt: '',
    height: 128,
    clickable: false,
    openLabel: '',
  },
);

const emit = defineEmits<{ open: [] }>();

const slots = useSlots();
</script>

<template>
  <div
    :class="['mp-plantphoto', { 'mp-plantphoto--empty': !src }, props.class]"
    :style="{ height: height + 'px' }"
    v-bind="$attrs"
  >
    <img v-if="src" :src="src" :alt="alt" class="mp-plantphoto__img" loading="lazy" />

    <!-- Only when there is something to open: a viewer over the generic leafy default would be an
         affordance that lies. It sits UNDER the chips/overlay in the stacking order so the existing
         edit control keeps working. -->
    <button
      v-if="clickable && src"
      type="button"
      class="mp-plantphoto__open"
      :aria-label="openLabel"
      @click="emit('open')"
    />

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

/* A full-bleed, invisible control over the photo. It is a real <button> (keyboard-reachable, announced
   as an action) rather than a click handler on the image, and it sits BELOW the chips/overlay layers so
   the cover-edit affordance above it still receives its own clicks. */
.mp-plantphoto__open {
  position: absolute;
  inset: 0;
  z-index: 0;
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
}

.mp-plantphoto__open:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-plantphoto__chips,
.mp-plantphoto__overlay {
  position: absolute;
  z-index: 1;
}

.mp-plantphoto__chips {
  left: var(--space-2);
  bottom: var(--space-2);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  max-width: calc(100% - var(--space-4));
}

.mp-plantphoto__overlay {
  top: var(--space-2);
  right: var(--space-2);
}
</style>
