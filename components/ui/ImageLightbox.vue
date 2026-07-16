<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import { useOverlay } from '../../composables/useOverlay';

// A caller-agnostic image descriptor: `alt` already localized/formatted by the caller (the gallery passes
// the photo's date via the existing photos.alt key). Keeps the primitive independent of PlantPhotoItem.
export interface LightboxImage {
  src: string;
  alt: string;
}

const props = defineProps<{ images: LightboxImage[] }>();
const open = defineModel<boolean>({ default: false });
// The opener sets the starting position; prev/next mutate it. Two-way so it is controllable + testable.
const index = defineModel<number>('index', { default: 0 });

const panelRef = ref<HTMLElement | null>(null);

const current = computed(() => props.images[index.value] ?? null);
const hasNav = computed(() => props.images.length > 1);
const canPrev = computed(() => index.value > 0);
const canNext = computed(() => index.value < props.images.length - 1);

function close() {
  open.value = false;
}

// CLAMP at both ends — no wrap-around (spec §4.1: a small plant gallery is not a carousel).
function step(direction: -1 | 1) {
  const target = index.value + direction;
  if (target < 0 || target > props.images.length - 1) return;
  index.value = target;
}

const { onKeydown, onBackdrop, restoreFocus } = useOverlay(open, panelRef, { onClose: close, onArrow: step });
</script>

<template>
  <Teleport to="body">
    <Transition name="mp-lightbox-fade" @after-leave="restoreFocus">
      <div
        v-if="open"
        class="mp-lightbox__backdrop"
        @mousedown="onBackdrop"
        @keydown="onKeydown"
      >
        <div
          ref="panelRef"
          class="mp-lightbox__panel"
          role="dialog"
          aria-modal="true"
          :aria-label="current?.alt"
          tabindex="-1"
          @mousedown="onBackdrop"
        >
          <button
            type="button"
            class="mp-lightbox__ctl mp-lightbox__close"
            :aria-label="$t('common.close')"
            @click="close"
          >
            <AppIcon name="x-mark" :size="24" />
          </button>

          <button
            v-if="hasNav"
            type="button"
            class="mp-lightbox__ctl mp-lightbox__nav mp-lightbox__nav--prev"
            :disabled="!canPrev"
            :aria-label="$t('lightbox.prev')"
            @click="step(-1)"
          >
            <AppIcon name="chevron-left" :size="28" />
          </button>

          <img v-if="current" :src="current.src" :alt="current.alt" class="mp-lightbox__img" />

          <button
            v-if="hasNav"
            type="button"
            class="mp-lightbox__ctl mp-lightbox__nav mp-lightbox__nav--next"
            :disabled="!canNext"
            :aria-label="$t('lightbox.next')"
            @click="step(1)"
          >
            <AppIcon name="chevron-right" :size="28" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mp-lightbox__backdrop {
  position: fixed;
  inset: 0;
  /* JUSTIFIED literal (NIT 2): one rung above UiModal's z-index 1000 so a lightbox opened from a modal sits
     on top. If the design system defines a z-index scale/token, use the token one step above the modal layer. */
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  /* Deliberate near-opaque scrim (single-look photo viewer), following UiModal's rgba backdrop precedent.
     Solid colour only — NO blur / backdrop-filter (perf invariant). */
  background: rgba(0, 0, 0, 0.9);
}

.mp-lightbox__panel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  outline: none;
}

.mp-lightbox__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain; /* fit-to-screen without cropping */
  border-radius: var(--radius-md);
}

.mp-lightbox__ctl {
  position: absolute;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* JUSTIFIED literal (NIT 2): the WCAG 2.5.5 minimum touch-target size, a standards constant — not a
     spacing choice. Use the design system's touch-target token here if one exists. */
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--radius-pill); /* fully round control chip — the design system's circle token */
  background: var(--surface-card);
  color: var(--text-strong);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

.mp-lightbox__ctl:hover {
  background: var(--surface-sunken);
}

.mp-lightbox__ctl:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-lightbox__ctl:disabled {
  opacity: 0.35;
  cursor: default;
}

.mp-lightbox__close {
  top: var(--space-4);
  right: var(--space-4);
}

.mp-lightbox__nav {
  top: 50%;
  transform: translateY(-50%);
}

.mp-lightbox__nav--prev {
  left: var(--space-4);
}

.mp-lightbox__nav--next {
  right: var(--space-4);
}

/* Finite opacity fade only — never an infinite loop, never on a blurred node (perf invariant). */
.mp-lightbox-fade-enter-active,
.mp-lightbox-fade-leave-active {
  transition: opacity var(--dur-normal) var(--ease-out);
}

.mp-lightbox-fade-enter-from,
.mp-lightbox-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .mp-lightbox-fade-enter-active,
  .mp-lightbox-fade-leave-active {
    transition: none;
  }
}
</style>
