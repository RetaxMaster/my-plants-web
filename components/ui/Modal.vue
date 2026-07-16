<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import { useOverlay } from '../../composables/useOverlay';

defineOptions({ inheritAttrs: false });

const props = defineProps<{ title?: string }>();

const open = defineModel<boolean>({ default: false });

const titleId = useId();
const panelRef = ref<HTMLElement | null>(null);

function close() {
  open.value = false;
}

// Scroll-lock, focus save/restore, Escape, Tab-trap, backdrop close — all shared with UiImageLightbox.
const { onKeydown, onBackdrop } = useOverlay(open, panelRef, { onClose: close });
</script>

<template>
  <Teleport to="body">
    <Transition name="mp-modal-fade">
      <div
        v-if="open"
        class="mp-modal__backdrop"
        @mousedown="onBackdrop"
        @keydown="onKeydown"
      >
        <div
          ref="panelRef"
          class="mp-modal__panel"
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
  max-height: calc(100vh - var(--space-8));
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  outline: none;
  overflow: hidden;
}

.mp-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
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
  padding: var(--space-5);
  overflow-y: auto;
}

.mp-modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
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
