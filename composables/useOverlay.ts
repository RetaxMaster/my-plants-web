import type { Ref } from 'vue';

// The one selector both overlays use to find tabbable elements (identical to Modal.vue's original).
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Visible, enabled focusables inside `panel`, in DOM order. The offsetParent check filters hidden nodes;
// the `=== document.activeElement` fallback keeps the currently-focused element in the set even if a test
// environment reports it hidden.
export function focusableWithin(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

// Cyclic Tab containment: wrap first<->last, and pull a stray focus (outside the panel) back inside.
export function trapTab(panel: HTMLElement | null, event: KeyboardEvent): void {
  const focusables = focusableWithin(panel);
  if (focusables.length === 0) {
    event.preventDefault();
    panel?.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey) {
    if (active === first || !panel?.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else {
    if (active === last || !panel?.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }
}

export interface UseOverlayOptions {
  onClose: () => void;
  // Optional: when provided, ArrowLeft/ArrowRight call onArrow(-1)/onArrow(1). UiModal omits it.
  onArrow?: (direction: -1 | 1) => void;
}

// Shared overlay behaviour: scroll-lock while open, save the previously-focused element and restore it on
// close, move focus into the panel on open, and provide the keydown (Escape / Tab-trap / optional arrows)
// and backdrop-click handlers. Call from setup(); `isOpen` and `panelRef` are the caller's refs.
// Module-level scroll-lock refcount shared by EVERY overlay (SHOULD-FIX 6): with a lightbox opened on top of
// a modal, each overlay would otherwise reset `body.overflow=''` on its own close and unlock the page while
// the other is still open. Restore the body only when the LAST overlay releases. Each useOverlay instance
// contributes at most one to the count (its `holdsLock` guard), so open/close/unmount can't double-count.
let overlayLockCount = 0;

export function useOverlay(isOpen: Ref<boolean>, panelRef: Ref<HTMLElement | null>, options: UseOverlayOptions) {
  let previouslyFocused: HTMLElement | null = null;
  let holdsLock = false; // does THIS overlay currently contribute to the shared lock?

  function acquireLock() {
    if (!import.meta.client || holdsLock) return;
    holdsLock = true;
    overlayLockCount += 1;
    document.body.style.overflow = 'hidden';
  }

  function releaseLock() {
    if (!import.meta.client || !holdsLock) return;
    holdsLock = false;
    overlayLockCount = Math.max(0, overlayLockCount - 1);
    if (overlayLockCount === 0) document.body.style.overflow = ''; // only the LAST overlay restores the page
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      options.onClose();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(panelRef.value, event);
      return;
    }
    if (options.onArrow) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        options.onArrow(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        options.onArrow(1);
      }
    }
  }

  function onBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) options.onClose();
  }

  watch(isOpen, async (open) => {
    if (!import.meta.client) return;
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      acquireLock();
      await nextTick();
      const focusables = focusableWithin(panelRef.value);
      (focusables[0] ?? panelRef.value)?.focus();
    } else {
      releaseLock();
      previouslyFocused?.focus?.();
      previouslyFocused = null;
    }
  });

  onBeforeUnmount(() => releaseLock()); // an overlay unmounted while open still releases its single hold

  return { onKeydown, onBackdrop };
}
