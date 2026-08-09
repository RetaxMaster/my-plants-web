// @vitest-environment happy-dom
//
// QA finding F1 (2026-08-08). `/settings` — the page that owns the whole measured-soil half of the app —
// was UNREACHABLE BY CLICKING on a desktop viewport. The only link to it lived on `/more`, and `/more`
// itself is only reachable from the mobile bottom bar, which the layout collapses to `height: 0` above
// 880px. Meanwhile the measuring modal told the owner to "add an instrument in Settings first". The app
// named a destination it gave no route to.
//
// This file exists because the account menu is the ONE piece of chrome that renders at EVERY viewport, so
// it is what closes that loop — and a link that is load-bearing for a whole feature deserves a test that
// fails when someone tidies it away. The harness stubs the bare Nuxt auto-imports (`useUserSession`,
// `useApi`, `useI18n`, `useAsyncData`, `navigateTo`, `useActingAs`) the same way the sibling component
// tests in this directory do, because outside Nuxt's build pipeline they do not exist.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('onMounted', onMounted);
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useApi', () => ({ listCities: async () => [] }));
vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
  data: ref(await fn()),
}));
vi.stubGlobal('useActingAs', () => ({ actingAs: ref(null), stop: vi.fn() }));
vi.stubGlobal('navigateTo', vi.fn());

const clear = vi.fn();
const user = ref<{ username: string; role: string } | null>({ username: 'retax', role: 'USER' });
vi.stubGlobal('useUserSession', () => ({ user, clear }));

const stubs = {
  AppIcon: { props: ['name', 'size', 'color'], template: '<i :data-icon="name" />' },
  NuxtLink: { props: ['to'], template: '<a class="link" :href="to"><slot /></a>' },
  UiLocaleToggle: true,
  // The acting-as banner's own i18n component; never rendered here (actingAs is null) but Vue still
  // resolves it, and an unresolved component is a warning this file should not be emitting.
  'i18n-t': { props: ['keypath', 'tag'], template: '<span>{{ keypath }}</span>' },
};

async function mountMenu() {
  const AccountMenu = (await import('./AccountMenu.vue')).default;
  const w = mount(
    { components: { AccountMenu }, template: '<Suspense><AccountMenu /></Suspense>' },
    { global: { stubs, mocks: { $t: (k: string) => k } } },
  );
  await flushPromises();
  await w.find('button').trigger('click'); // open the dropdown
  await flushPromises();
  return w;
}

function hrefs(w: Awaited<ReturnType<typeof mountMenu>>) {
  return w.findAll('a.link').map((a) => a.attributes('href'));
}

describe('AccountMenu — the desktop route to /settings (QA F1)', () => {
  beforeEach(() => {
    user.value = { username: 'retax', role: 'USER' };
  });

  it('links to /settings', async () => {
    const w = await mountMenu();
    expect(hrefs(w)).toContain('/settings');
  });

  it('labels it through i18n, never a hardcoded literal', async () => {
    const w = await mountMenu();
    const link = w.findAll('a.link').find((a) => a.attributes('href') === '/settings')!;
    expect(link.text()).toBe('account.settings');
  });

  it('offers it to a plain USER, not only to an ADMIN — instruments are every owner\'s setting', async () => {
    user.value = { username: 'someone', role: 'USER' };
    const w = await mountMenu();
    expect(hrefs(w)).toContain('/settings');
    // …and the admin-only entries really are still admin-only, so this is not a blanket ungating.
    expect(hrefs(w)).not.toContain('/admin');
  });

  it('still offers it to an ADMIN', async () => {
    user.value = { username: 'retax', role: 'ADMIN' };
    const w = await mountMenu();
    expect(hrefs(w)).toContain('/settings');
    expect(hrefs(w)).toContain('/admin');
  });

  it('closes the menu when the link is followed, like every other entry', async () => {
    const w = await mountMenu();
    const link = w.findAll('a.link').find((a) => a.attributes('href') === '/settings')!;
    await link.trigger('click');
    await flushPromises();
    expect(w.findAll('a.link')).toHaveLength(0);
  });
});
