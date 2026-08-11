// @vitest-environment happy-dom
//
// QA round-4 finding 4. Modal.vue's header `×` carried `aria-label="common.close"` — "Close" — and several
// modals ALSO render a footer button whose visible text is "Close" (the repot verdict, the plant cover
// image, the agent chat). Two elements with one accessible name is invisible to a sighted human and fatal
// to a role+name query: `getByRole('button', { name: 'Close' })` matches both, and Playwright's strict mode
// fails the locator outright. Every E2E written against a modal footer would have hit it.
//
// Fixed in Modal.vue rather than at each call site: this `×` is the one button EVERY modal renders, so
// renaming the footers would have been N fixes for one cause and the next modal to add a "Close" footer
// would have reintroduced it.
//
// These assertions run against the REAL en/es strings, not against key names, because the collision is a
// property of the resolved TEXT — a test on keys ('common.close' vs 'common.closeDialog') would pass on a
// locale file that spelled both of them "Close".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ref, watch, nextTick, onBeforeUnmount, onMounted } from 'vue';
import { mount } from '@vue/test-utils';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';
import Modal from './Modal.vue';

// Nuxt auto-imports, supplied here as globals. `useOverlay` is NOT stubbed — Modal.vue imports the real
// one explicitly, and it needs Vue's own reactivity helpers, which are auto-imports too.
vi.stubGlobal('useId', () => 'modal-title-id');
vi.stubGlobal('ref', ref);
vi.stubGlobal('watch', watch);
vi.stubGlobal('nextTick', nextTick);
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount);
// `useOverlay` also runs an onMounted hook — an overlay MOUNTED already open must behave like one that
// opened (focus moves into it), so this hook is part of the behaviour under test, not scaffolding.
vi.stubGlobal('onMounted', onMounted);

type Locale = typeof en;

// Modal.vue teleports to <body>, so an unmount that never runs (an assertion throwing first) would leave
// its buttons behind and make the next test's duplicate-name count meaningless. Clear unconditionally.
afterEach(() => { document.body.innerHTML = ''; });

function mountModal(messages: Locale) {
  const t = (key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages) as string;
  return mount(Modal, {
    props: { modelValue: true, title: 'A dialog' },
    slots: {
      // Exactly what RepotVerdictModal.vue renders — the call site that produced the collision.
      footer: `<button type="button">${t('common.close')}</button>`,
    },
    global: { mocks: { $t: t }, stubs: { AppIcon: true } },
    attachTo: document.body,
  });
}

/** Every button's accessible name, using the two sources that apply here: aria-label wins over content. */
function accessibleNames(): string[] {
  return [...document.querySelectorAll('button')].map(
    (b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim(),
  );
}

describe.each([['en', en], ['es', es]] as const)('Modal — the close affordances have DISTINCT accessible names (%s)', (locale, messages) => {
  it('resolves exactly ONE button to the plain "Close" name — the footer, not the header ×', () => {
    const w = mountModal(messages as Locale);
    const plainClose = (messages as Locale).common.close;

    expect(accessibleNames().filter((n) => n === plainClose)).toHaveLength(1);
    w.unmount();
  });

  it('names the header × for what it closes, and never identically to the footer button', () => {
    const w = mountModal(messages as Locale);
    const x = document.querySelector('.mp-modal__close')!;
    const m = messages as Locale;

    expect(x.getAttribute('aria-label')).toBe(m.common.closeDialog);
    expect(x.getAttribute('aria-label')).not.toBe(m.common.close);
    // The locale itself must keep them distinct — a translation that spelled both the same would
    // reintroduce the collision without touching a line of component code.
    expect(m.common.closeDialog).not.toBe(m.common.close);
    w.unmount();
  });

  it(`(${locale}) has no duplicate accessible name among the modal's buttons at all`, () => {
    const w = mountModal(messages as Locale);
    const names = accessibleNames();

    expect(new Set(names).size).toBe(names.length);
    w.unmount();
  });
});
