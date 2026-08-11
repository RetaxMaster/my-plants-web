// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ImageLightbox from './ImageLightbox.vue';

// `ref`/`computed`/`watch`/`nextTick`/`onBeforeUnmount` are normally Nuxt auto-imports; plain vitest +
// @vue/test-utils (no auto-import shim) doesn't provide those globals, so a bare call inside the component's
// or composable's setup() throws "X is not defined" — stub the real `vue` implementations as globals, the
// same technique ProgressForm.test.ts / PlantProfileModal.test.ts use.
vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('nextTick', nextTick);
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount);
// `useOverlay` also runs an onMounted hook — an overlay MOUNTED already open must behave like one that
// opened (focus moves into it), so this hook is part of the behaviour under test, not scaffolding.
vi.stubGlobal('onMounted', onMounted);

// Content teleports to <body>; query it there. offsetParent shim so the focus-trap sees focusables.
const proto = Object.getPrototypeOf(document.createElement('div'));
const originalOffsetParent = Object.getOwnPropertyDescriptor(proto, 'offsetParent');

beforeAll(() => {
  Object.defineProperty(proto, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.isConnected ? document.body : null;
    },
  });
  // $t / $d stubs: return the key so assertions stay wording-independent.
  vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, d: (v: unknown) => String(v) }));
});

afterAll(() => {
  // Restore exactly: re-install the real descriptor, or DELETE the shim if there never was one (SHOULD-FIX 7).
  if (originalOffsetParent) Object.defineProperty(proto, 'offsetParent', originalOffsetParent);
  else delete (proto as Record<string, unknown>).offsetParent;
  vi.unstubAllGlobals();
});

// ⚠️ EVERY MOUNTED LIGHTBOX IS UNMOUNTED BETWEEN TESTS, and that is load-bearing, not tidiness.
// `useOverlay`'s scroll lock is a MODULE-LEVEL refcount deliberately shared by every overlay (a lightbox
// over a modal must not let either one unlock the page while the other is still open), and an overlay
// mounted ALREADY OPEN now takes that lock at mount, as it should. Wiping `innerHTML` detaches the DOM but
// never runs a component's unmount hooks, so any test leaving an open lightbox behind used to leak a count
// into the next one — and the nested-overlay test, whose whole subject is that refcount, is the one that
// notices. Unmounting releases the lock through the same `onBeforeUnmount` path the app uses.
const mountedLightboxes: { unmount: () => void }[] = [];

afterEach(() => {
  while (mountedLightboxes.length > 0) {
    try { mountedLightboxes.pop()!.unmount(); } catch { /* already unmounted by the test itself */ }
  }
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

const THREE = [
  { src: 'a.jpg', alt: 'Photo A' },
  { src: 'b.jpg', alt: 'Photo B' },
  { src: 'c.jpg', alt: 'Photo C' },
];

// Global stubs for the AppIcon child + the $t/$d template helpers (happy-dom mount has no i18n plugin).
function mountLightbox(props: Record<string, unknown>) {
  const w = mount(ImageLightbox, {
    // `images` is a REQUIRED prop at the component level; the spread of a loose `Record<string, unknown>`
    // defeats vue-tsc's structural check (same cast technique as ProgressForm.test.ts's mountForm).
    props: props as unknown as InstanceType<typeof ImageLightbox>['$props'],
    attachTo: document.body,
    global: {
      stubs: { AppIcon: true },
      mocks: { $t: (k: string) => k, $d: (v: unknown) => String(v) },
    },
  });
  mountedLightboxes.push(w); // released in afterEach — see its comment
  return w;
}

describe('ImageLightbox', () => {
  it('opens showing the image at the given index', () => {
    mountLightbox({ modelValue: true, index: 1, images: THREE });
    const img = document.body.querySelector('.mp-lightbox__img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('b.jpg');
    expect(img.getAttribute('alt')).toBe('Photo B');
  });

  it('clamps at the first photo: prev is disabled, next is enabled', () => {
    mountLightbox({ modelValue: true, index: 0, images: THREE });
    const prev = document.body.querySelector('.mp-lightbox__nav--prev') as HTMLButtonElement;
    const next = document.body.querySelector('.mp-lightbox__nav--next') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
  });

  it('clamps at the last photo: next is disabled, prev is enabled', () => {
    mountLightbox({ modelValue: true, index: 2, images: THREE });
    const prev = document.body.querySelector('.mp-lightbox__nav--prev') as HTMLButtonElement;
    const next = document.body.querySelector('.mp-lightbox__nav--next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(false);
  });

  it('next/prev emit the clamped index update', async () => {
    const wrapper = mountLightbox({ modelValue: true, index: 1, images: THREE });
    await (document.body.querySelector('.mp-lightbox__nav--next') as HTMLButtonElement).click();
    await (document.body.querySelector('.mp-lightbox__nav--prev') as HTMLButtonElement).click();
    const updates = wrapper.emitted('update:index');
    // Vue 3.5's defineModel keeps a LOCAL optimistic value that the getter reads back immediately after a
    // set (it doesn't wait for the prop to round-trip), so the second click steps from the just-emitted 2,
    // not from the original static prop 1 — exactly what a real `v-model:index` binding produces in prod.
    expect(updates?.[0]).toEqual([2]); // from 1 → 2
    expect(updates?.[1]).toEqual([1]); // from 2 → 1 (local value already advanced)
  });

  it('a single-photo set shows no nav controls', () => {
    mountLightbox({ modelValue: true, index: 0, images: [THREE[0]] });
    expect(document.body.querySelectorAll('.mp-lightbox__nav').length).toBe(0);
  });

  it('ArrowRight steps forward; ArrowLeft at index 0 is clamped (no emit)', async () => {
    const wrapper = mountLightbox({ modelValue: true, index: 0, images: THREE });
    const backdrop = document.body.querySelector('.mp-lightbox__backdrop') as HTMLElement;
    backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted('update:index');
    expect(updates).toEqual([[1]]); // only ArrowRight fired
  });

  it('Escape closes (emits update:modelValue false)', async () => {
    const wrapper = mountLightbox({ modelValue: true, index: 0, images: THREE });
    const backdrop = document.body.querySelector('.mp-lightbox__backdrop') as HTMLElement;
    backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('the dark area around the image closes; the image itself does not (backdrop-close actually works)', async () => {
    const wrapper = mountLightbox({ modelValue: true, index: 0, images: THREE });
    // Clicking the IMAGE must NOT close (target = img, not a currentTarget the handler gates on).
    const img = document.body.querySelector('.mp-lightbox__img') as HTMLElement;
    img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    // Clicking the panel's own dark area (target === panel) CLOSES — the panel fills the viewport, so this is
    // what "click outside the image" actually hits. Its @mousedown="onBackdrop" gates on target===currentTarget.
    const panel = document.body.querySelector('.mp-lightbox__panel') as HTMLElement;
    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('the thin backdrop padding strip also closes (target === backdrop)', async () => {
    const wrapper = mountLightbox({ modelValue: true, index: 0, images: THREE });
    const backdrop = document.body.querySelector('.mp-lightbox__backdrop') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('moves focus into the panel on open, and keeps focus IN the dialog on close (no mid-fade escape to the opener)', async () => {
    // The two-Escape bug: focus used to jump back to the background opener the instant `open` flipped false,
    // while the dialog was still visibly fading out — reading as "Escape didn't close it". Focus must stay
    // inside the dialog until the leave transition ends (restoreFocus runs in @after-leave; proven end-to-end
    // by the Playwright check and deterministically by useOverlay.test.ts). Here we pin the anti-regression:
    // focus is NOT restored to the opener the moment the model flips false.
    const opener = document.createElement('button');
    opener.id = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const wrapper = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await wrapper.setProps({ modelValue: true });   // triggers the useOverlay open watcher
    await wrapper.vm.$nextTick();
    const panel = document.body.querySelector('.mp-lightbox__panel') as HTMLElement;
    expect(panel.contains(document.activeElement)).toBe(true); // focus pulled into the overlay

    await wrapper.setProps({ modelValue: false });  // close: focus must NOT eagerly jump to the opener
    await wrapper.vm.$nextTick();
    expect(document.activeElement).not.toBe(opener); // still in-dialog while it fades — no mid-fade escape
  });

  it('traps Tab within the panel (forward Tab from the last control wraps to the first)', async () => {
    mountLightbox({ modelValue: true, index: 0, images: THREE });
    const backdrop = document.body.querySelector('.mp-lightbox__backdrop') as HTMLElement;
    const panel = document.body.querySelector('.mp-lightbox__panel') as HTMLElement;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    focusables[focusables.length - 1].focus();
    backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(focusables[0]);
  });

  // ---- QA 2026-08-11: one overlay handing straight over to another --------------------------------------
  //
  // The measured defect: the measuring survey's "calíbrala" link closes the survey and opens the calibration
  // dialog in the SAME tick. The new dialog moves focus into itself; the old one's focus-restore then ran and
  // yanked focus back to the button behind the backdrop. Escape reached nothing and Enter re-opened the
  // survey UNDERNEATH the dialog — two stacked panels.
  //
  // Driven here through UNMOUNT, which is a real path to the same `restoreFocus` (`onBeforeUnmount` is its
  // safety net for an overlay torn down while still open, e.g. a route change) and needs no component to
  // expose internals. Pinned on the shared overlay behaviour rather than on those two specific components,
  // because the race is the composable's to resolve and any future pair of overlays would hit it identically.
  const panels = () =>
    [...document.body.querySelectorAll('.mp-lightbox__panel')] as HTMLElement[];

  it('HAND-OFF: a closing overlay must not steal focus the next overlay has already taken', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const outgoing = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await outgoing.setProps({ modelValue: true });
    await outgoing.vm.$nextTick();

    // The incoming overlay opens and claims focus, exactly as the calibration dialog does.
    const incoming = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await incoming.setProps({ modelValue: true });
    await incoming.vm.$nextTick();
    const incomingPanel = panels()[1]!;
    expect(incomingPanel.contains(document.activeElement)).toBe(true);

    // Now the outgoing one goes away and runs its restore. It must be a NO-OP here.
    outgoing.unmount();

    expect(document.activeElement).not.toBe(opener);
    expect(incomingPanel.contains(document.activeElement)).toBe(true);
  });

  // THE OTHER DIRECTION, and without it the fix above could be "never restore focus at all" — which would
  // silently break the ordinary single-overlay case the restore exists for.
  it('an ordinary teardown still returns focus to whatever opened it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const w = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await w.setProps({ modelValue: true });
    await w.vm.$nextTick();
    expect(document.activeElement).not.toBe(opener); // focus moved into the dialog

    w.unmount();
    expect(document.activeElement).toBe(opener);
  });

  // THE OTHER END OF THE HAND-OFF.
  //
  // ⚠️ REWRITTEN 2026-08-11 (QA round 2, finding 1). The previous version of this case asserted
  // `document.activeElement).toBe(opener)` — that the dialog the chain ended on returns focus to the PAGE
  // control that BEGAN the chain. It was written for a real defect (focus landing on `<body>` because the
  // stored opener was the unmounted link inside the outgoing panel) and it fixed that defect, but the
  // destination it chose was wrong and QA measured the consequence 2/2: escaping the calibration dialog put
  // focus on the "¿Necesitas regar?" button, and one Enter re-opened the survey the owner had just
  // deliberately left. Escaping a dialog must not be a route back into it.
  //
  // So the assertion is INVERTED rather than deleted — the old one records a judgement that was made on
  // purpose and turned out to be wrong in front of a user — and the case now pins the third destination:
  // the page's `<main>` landmark. Not the abandoned trigger, and not `<body>` at the top of the document,
  // which is the regression the earlier round closed and which must stay closed.
  it('HAND-OFF: the second overlay returns focus to the page CONTENT, not to the abandoned trigger', async () => {
    const main = document.createElement('main');
    document.body.appendChild(main);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const first = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await first.setProps({ modelValue: true });
    await first.vm.$nextTick();
    // Focus is now on a control INSIDE the first panel — the state the "calíbrala" link is in when clicked.
    expect(panels()[0]!.contains(document.activeElement)).toBe(true);

    const second = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await second.setProps({ modelValue: true });
    await second.vm.$nextTick();

    first.unmount();  // the outgoing panel goes away, taking its controls with it
    second.unmount(); // the remaining dialog closes and restores

    expect(document.activeElement).toBe(main);
    expect(document.activeElement).not.toBe(opener);      // pressing Enter must not re-open the first dialog
    expect(document.activeElement).not.toBe(document.body); // and the old `<body>` regression stays closed
  });

  // The NESTED case, and it is what stops the fix above from being "never return focus to a control inside
  // a dialog". A lightbox opened from a thumbnail inside a still-open modal must give focus back to that
  // thumbnail — the opener is still on screen, so there is nothing handed off and nothing abandoned.
  // Distinguished at restore time by `isConnected`, which is the whole of the rule.
  it('NESTED: an overlay opened from a control inside a STILL-OPEN overlay restores to that control', async () => {
    const main = document.createElement('main');
    document.body.appendChild(main);

    const outer = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await outer.setProps({ modelValue: true });
    await outer.vm.$nextTick();
    const thumb = panels()[0]!.querySelector('button:not([disabled])') as HTMLElement;
    thumb.focus();

    const inner = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await inner.setProps({ modelValue: true });
    await inner.vm.$nextTick();

    inner.unmount();            // only the INNER one closes — the outer panel is still mounted
    expect(document.activeElement).toBe(thumb);
    expect(document.activeElement).not.toBe(main);
  });

  // An overlay whose flag is ALREADY true when it mounts (a deep link that opens a dialog on arrival) must
  // behave like one that opened: the watcher only ever sees a TRANSITION, so this is the `onMounted` path.
  // Before it existed, such a dialog rendered with focus still behind it — Escape reached nothing.
  it('MOUNTED ALREADY OPEN: focus still lands inside the dialog, and the page is locked', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const w = mountLightbox({ modelValue: true, index: 0, images: THREE });
    await w.vm.$nextTick();
    await w.vm.$nextTick();

    expect(panels()[0]!.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('NESTED overlays: body scroll stays locked until the LAST overlay closes (SHOULD-FIX 6)', async () => {
    // Two overlays sharing useOverlay's module-level lock refcount (a lightbox opened over a modal is the real
    // case). Opening both locks the body; closing ONE must NOT unlock it; closing the second restores it.
    const outer = mountLightbox({ modelValue: false, index: 0, images: THREE });
    const inner = mountLightbox({ modelValue: false, index: 0, images: THREE });
    await outer.setProps({ modelValue: true }); await outer.vm.$nextTick();
    expect(document.body.style.overflow).toBe('hidden');
    await inner.setProps({ modelValue: true }); await inner.vm.$nextTick();
    expect(document.body.style.overflow).toBe('hidden');
    await inner.setProps({ modelValue: false }); await inner.vm.$nextTick();
    expect(document.body.style.overflow).toBe('hidden'); // outer still open → still locked
    await outer.setProps({ modelValue: false }); await outer.vm.$nextTick();
    expect(document.body.style.overflow).toBe('');        // last overlay closed → page restored
  });
});
