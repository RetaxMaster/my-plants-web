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

// THE LAST ELEMENT THAT HELD FOCUS OUTSIDE ANY OVERLAY — module-level, for the same reason the lock count
// is: it is a fact about the PAGE, not about one overlay (QA, 2026-08-11).
//
// An overlay saves what to give focus back to when it closes. Saving `document.activeElement` is right when
// an overlay opens from the page, and WRONG when one overlay opens another: the active element is then a
// control inside the OUTGOING panel — the survey's "calíbrala" link — which is unmounted moments later. The
// incoming dialog is left holding a reference to a detached node, so closing it focused nothing and dumped
// a keyboard user on `<body>` at the top of the document, with the whole header to Tab through again.
// Measured on the calibration dialog: `document.activeElement.tagName === 'BODY'` after Escape, after
// Cancelar, after the × and after a successful save, while the measuring modal it was opened from restored
// correctly — which is exactly the asymmetry that gives the cause away.
//
// So an overlay opened from INSIDE another overlay inherits the page-level opener instead of pointing at a
// doomed node. The whole hand-off chain then returns focus where the owner actually started.
let lastFocusOutsideOverlay: HTMLElement | null = null;

function captureOpener(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active == null || active === document.body) return lastFocusOutsideOverlay;
  if (active.closest('[role="dialog"]') != null) return lastFocusOutsideOverlay;
  lastFocusOutsideOverlay = active;
  return active;
}

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

  // Return focus to the element that opened the overlay. Called from the consumer's Transition `@after-leave`
  // — i.e. when the dialog has ACTUALLY left the screen — NOT eagerly when `isOpen` flips false. Eager
  // restore moved focus (and the focus ring) to the background opener while the dialog was still visibly
  // fading out (~--dur-normal), which reads as "Escape didn't close it" and provokes a second press. Keeping
  // focus inside the dialog until it is gone, then restoring, makes a single Escape close cleanly with focus
  // correctly back on the opener.
  //
  // ⚠️ IT MUST NOT STEAL FOCUS ANOTHER OVERLAY HAS ALREADY CLAIMED (QA, 2026-08-11). One overlay can hand
  // straight over to another — the measuring survey's "calíbrala" link closes the survey and opens the
  // calibration dialog in the same tick — and the two focus lifecycles then race. The new dialog moves
  // focus into itself on its own `nextTick`, and the OLD one's leave transition finishes afterwards and
  // yanks focus back to the button behind the backdrop. Measured consequence: `document.activeElement` was
  // the background "¿Necesitas regar?" button, so Escape reached nothing and did not close the dialog, and
  // Enter re-opened the survey UNDERNEATH it — two stacked panels with two visible Cancelar rows. Reachable
  // by keyboard only, because the backdrop still blocks the mouse.
  //
  // So the restore is CONDITIONAL: it happens only when nothing else has taken focus in the meantime. On an
  // ordinary close that is exactly the case — the panel is gone and `document.activeElement` has fallen
  // back to `<body>` — so the single-Escape behaviour the comment above describes is unchanged. When focus
  // sits inside some OTHER live element, that element is the current owner and this overlay is no longer
  // entitled to move it.
  function restoreFocus() {
    if (!import.meta.client) return;
    const active = document.activeElement as HTMLElement | null;
    const claimedElsewhere =
      active != null && active !== document.body && !(panelRef.value?.contains(active) ?? false);
    // No `isConnected` guard here, deliberately: `.focus()` on a detached node is a silent no-op, so the
    // guard would be a branch with no observable behaviour and therefore no test that could ever fail on
    // it. `captureOpener` is what actually prevents a detached opener being stored in the first place.
    if (!claimedElsewhere) previouslyFocused?.focus?.();
    previouslyFocused = null;
  }

  // The open-side work, factored out because it now has TWO triggers — see `onMounted` below.
  async function onOpened() {
    previouslyFocused = captureOpener();
    acquireLock();
    await nextTick();
    const focusables = focusableWithin(panelRef.value);
    (focusables[0] ?? panelRef.value)?.focus();
  }

  watch(isOpen, async (open) => {
    if (!import.meta.client) return;
    if (open) {
      await onOpened();
    } else {
      // Scroll-lock releases immediately (the page must not scroll behind a fading dialog); focus restoration
      // is deferred to `restoreFocus()` in the leave transition's `@after-leave`.
      releaseLock();
    }
  });

  // AN OVERLAY CAN BE MOUNTED ALREADY OPEN, and that must behave exactly like one that opened (QA,
  // 2026-08-11). The watcher above only ever sees a TRANSITION, so a consumer whose flag is already true at
  // mount got no scroll-lock and — the part that shows — no focus move, leaving a dialog on screen with
  // focus still on whatever was behind it: Escape reaches nothing, Tab walks the page underneath.
  //
  // It is reachable through an ordinary product path, not a contrived one: a deep link that opens a dialog
  // on arrival (`/plants/:id?calibrate=1`) sets the flag during the page's own setup, before this component
  // exists. Handling it HERE, once, is what keeps every such consumer from having to defer its own open by
  // a tick and get that timing right individually.
  onMounted(async () => {
    if (!import.meta.client || !isOpen.value) return;
    await onOpened();
  });

  // An overlay UNMOUNTED while still open (e.g. a route change) never runs its leave transition, so restore
  // focus here as a safety net. On a normal close, @after-leave already nulled previouslyFocused → no-op.
  onBeforeUnmount(() => { releaseLock(); restoreFocus(); });

  return { onKeydown, onBackdrop, restoreFocus };
}
