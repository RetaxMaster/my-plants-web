<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import { useOverlay } from '../../composables/useOverlay';

defineOptions({ inheritAttrs: false });

// `size` widens the panel for document-style modals (long-form Markdown reads badly at the default
// width). It is opt-in: absent or 'md' keeps the 480px default every other modal already relies on.
const props = defineProps<{ title?: string; size?: 'md' | 'lg' }>();

const open = defineModel<boolean>({ default: false });

const titleId = useId();
const panelRef = ref<HTMLElement | null>(null);

function close() {
  open.value = false;
}

// Scroll-lock, focus save/restore, Escape, Tab-trap, backdrop close — all shared with UiImageLightbox.
const { onKeydown, onBackdrop, restoreFocus } = useOverlay(open, panelRef, { onClose: close });
</script>

<template>
  <Teleport to="body">
    <Transition name="mp-modal-fade" @after-leave="restoreFocus">
      <div
        v-if="open"
        class="mp-modal__backdrop"
        @mousedown="onBackdrop"
        @keydown="onKeydown"
      >
        <div
          ref="panelRef"
          class="mp-modal__panel"
          :class="{ 'mp-modal__panel--lg': props.size === 'lg' }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="props.title ? titleId : undefined"
          tabindex="-1"
          v-bind="$attrs"
        >
          <header v-if="props.title || $slots.header" class="mp-modal__header">
            <slot name="header">
              <h2 :id="titleId" class="mp-modal__title">{{ props.title }}</h2>
            </slot>
            <button
              type="button"
              class="mp-modal__close"
              :aria-label="$t('common.close')"
              @click="close"
            >
              <AppIcon name="x-mark" :size="20" />
            </button>
          </header>

          <div class="mp-modal__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="mp-modal__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mp-modal__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: rgba(0, 0, 0, 0.45);
}

.mp-modal__panel {
  width: 100%;
  max-width: 480px;
  /* Bound to the VISIBLE viewport: `dvh` (dynamic viewport height) shrinks with the mobile browser
     chrome / on-screen keyboard, unlike `vh` (which is the largest, chrome-hidden height and would push
     the header behind the URL bar and the footer behind the bottom nav). `vh` first as the fallback for
     engines without `dvh`. */
  max-height: calc(100vh - var(--space-8));
  max-height: calc(100dvh - var(--space-8));
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  outline: none;
  overflow: hidden;
}

/* Wide variant for document-style modals (e.g. the clinical record). Long-form Markdown — prose,
   tables, code — reads badly at the 480px default: headings wrap and lines feel cramped. 800px is a
   comfortable reading measure that still keeps body text off fatiguing line lengths (the full 1120px
   app container would push past them). Opt in with `size="lg"`; every other modal keeps 480px. */
.mp-modal__panel--lg {
  max-width: 800px;
}

/* The wide document modal gets roomier interior padding (--space-12 = 3rem) so the long-form record
   reads with real breathing room; the header's horizontal padding is bumped to match so the title shares
   the body's left edge. Gated at the 880px desktop breakpoint (see useIsDesktop): below it the panel is
   near full-width and 3rem per side would crush the content, so it keeps the mobile-safe default. */
@media (min-width: 880px) {
  .mp-modal__panel--lg .mp-modal__body {
    padding: var(--space-12);
  }
  .mp-modal__panel--lg .mp-modal__header,
  .mp-modal__panel--lg .mp-modal__footer {
    padding-left: var(--space-12);
    padding-right: var(--space-12);
  }
}

.mp-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  /* Never shrink: the close (X) stays pinned + visible at the top no matter how tall the body is. */
  flex: none;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.mp-modal__title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.mp-modal__close:hover {
  background: var(--surface-sunken);
}

.mp-modal__close:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-modal__body {
  /* Take the leftover height between the fixed header/footer, and scroll INSIDE that box.
     `min-height: 0` is essential: a flex item defaults to `min-height: auto` (won't shrink below its
     content), which would keep the body at full content height and push the footer out of the clipped
     panel — the exact bug where the buttons vanished with no scroll to reach them. */
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-5);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch; /* momentum scrolling on iOS */
}

.mp-modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  /* Never shrink: Cancel/Save stay pinned + visible at the bottom regardless of body height. */
  flex: none;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-subtle);
}

.mp-modal-fade-enter-active,
.mp-modal-fade-leave-active {
  transition: opacity var(--dur-normal) var(--ease-out);
}

.mp-modal-fade-enter-from,
.mp-modal-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .mp-modal-fade-enter-active,
  .mp-modal-fade-leave-active {
    transition: none;
  }
}
</style>
