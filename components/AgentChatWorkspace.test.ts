// @vitest-environment happy-dom
//
// <AgentChatWorkspace> is the ONE shared session-list + chat-panel shell consumed by BOTH the admin
// Knowledge-Engine page and the plant-diagnose page (fork-prevention, Spec 3 §5.1). The risk this file guards
// against is a WIRING regression: the shell forwarding the wrong scope (KE adapters/socket on the doctor
// view, or vice versa) would pass every composable/i18n test while breaking the product. So we mount the
// shell with fake, per-consumer scope and assert it (a) forwards exactly that scope into the inner
// <AgentChat>, and (b) drives the injected sessions adapter for list/open/delete.
//
// `useI18n`/`useAsyncData` are bare Nuxt auto-imports the shell calls at setup; outside Nuxt's build they are
// stubbed as globals (same technique as ProgressForm.test / HistoryTimeline.test). The shell `await`s
// useAsyncData, so it is an ASYNC-setup component — mounted under <Suspense> and flushed.
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, defineComponent, h, Suspense } from 'vue';
import AgentChatWorkspace from './AgentChatWorkspace.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

// Minimal stand-in for Nuxt's useAsyncData: resolve the fetcher, expose data (seeded from opts.default) + a
// working refresh. The shell awaits this, so it must return synchronously (a plain object, not a promise).
vi.stubGlobal('useAsyncData', (_key: string, fn: () => Promise<unknown>, opts?: { default?: () => unknown }) => {
  const data = ref<unknown>(opts?.default ? opts.default() : null);
  void fn().then((v) => { data.value = v; });
  return { data, refresh: vi.fn(async () => { data.value = await fn(); }) };
});

function makeScope(sessions: Array<{ id: string; title: string; status: string | null; turns: number }>) {
  const sessionsApi = {
    list: vi.fn(async () => sessions),
    fetch: vi.fn(async (sid: string) => ({ id: sid, provider: 'claude', providerSessionId: null, turns: [] })),
    remove: vi.fn(async () => ({ ok: true })),
    create: vi.fn(), resume: vi.fn(), history: vi.fn(), providers: vi.fn(), commands: vi.fn(),
  };
  const runsApi = { mintSocketTicket: vi.fn() };
  return { sessionsApi, runsApi };
}

// Explicit AgentChat stub declaring the injected props so we can read exactly what the shell forwarded.
const AgentChatStub = defineComponent({
  name: 'AgentChat',
  props: ['sessionId', 'initialProvider', 'initialProviderSessionId', 'initialTurns', 'sessions', 'runs', 'socketUrl', 'i18nNamespace', 'themeStorageKey', 'proposals'],
  template: '<div class="agent-chat-stub" />',
});
const slotStub = (name: string) => defineComponent({ name, template: '<div><slot /></div>' });

async function mountShell(props: Record<string, unknown>) {
  const stubs = {
    AgentChat: AgentChatStub,
    ClientOnly: slotStub('ClientOnly'),
    UiCard: slotStub('UiCard'),
    UiEmptyState: slotStub('UiEmptyState'),
    UiButton: true, UiBadge: true, UiAppIcon: true,
  };
  // Async-setup component → mount under Suspense, then flush the resolved setup.
  const Wrapper = defineComponent({
    render() { return h(Suspense, null, { default: () => h(AgentChatWorkspace as unknown as Parameters<typeof h>[0], props), fallback: () => h('div') }); },
  });
  const wrapper = mount(Wrapper, { global: { stubs, mocks: { $t: (k: string) => k } } });
  await flushPromises();
  return wrapper;
}

describe('AgentChatWorkspace (the shared shell)', () => {
  it('forwards the injected scope (adapters, socket URL, namespace, theme key) into the inner AgentChat', async () => {
    const { sessionsApi, runsApi } = makeScope([{ id: 's1', title: 'S1', status: null, turns: 2 }]);
    const wrapper = await mountShell({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'http://doctor:8400',
      i18nNamespace: 'diagnose', themeStorageKey: 'crt-theme-diagnose', scopeKey: 'diagnose-p1',
    });
    const chat = wrapper.findComponent(AgentChatStub);
    expect(chat.exists()).toBe(true);
    expect(chat.props('socketUrl')).toBe('http://doctor:8400');
    expect(chat.props('i18nNamespace')).toBe('diagnose');
    expect(chat.props('themeStorageKey')).toBe('crt-theme-diagnose');
    expect(chat.props('sessions')).toBe(sessionsApi); // the SAME adapter object, not a copy
    expect(chat.props('runs')).toBe(runsApi);
  });

  it('renders the session list from the injected adapter and wires open + delete to THAT adapter', async () => {
    const { sessionsApi, runsApi } = makeScope([
      { id: 's1', title: 'First', status: null, turns: 1 },
      { id: 's2', title: 'Second', status: null, turns: 3 },
    ]);
    const wrapper = await mountShell({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });
    expect(wrapper.findAll('.mp-kchat-list__item')).toHaveLength(2);
    await wrapper.findAll('.mp-kchat-list__open')[0].trigger('click');
    expect(sessionsApi.fetch).toHaveBeenCalledWith('s1');
    await wrapper.findAll('.mp-kchat-list__del')[1].trigger('click');
    expect(sessionsApi.remove).toHaveBeenCalledWith('s2');
  });

  it('drives KE vs Doctor consumers off the SAME shell with their OWN scope — never cross-wired', async () => {
    const ke = makeScope([{ id: 'k1', title: 'KE', status: null, turns: 0 }]);
    const keChat = (await mountShell({
      sessions: ke.sessionsApi, runs: ke.runsApi, socketUrl: 'http://ke:8300',
      i18nNamespace: 'knowledgeEngine', themeStorageKey: 'crt-theme-knowledge', scopeKey: 'knowledge',
    })).findComponent(AgentChatStub);
    expect(keChat.props('i18nNamespace')).toBe('knowledgeEngine');
    expect(keChat.props('socketUrl')).toBe('http://ke:8300');
    expect(keChat.props('sessions')).toBe(ke.sessionsApi);

    const doc = makeScope([{ id: 'd1', title: 'Doc', status: null, turns: 0 }]);
    const docChat = (await mountShell({
      sessions: doc.sessionsApi, runs: doc.runsApi, socketUrl: 'http://doctor:8400',
      i18nNamespace: 'diagnose', themeStorageKey: 'crt-theme-diagnose', scopeKey: 'diagnose-p1',
    })).findComponent(AgentChatStub);
    expect(docChat.props('i18nNamespace')).toBe('diagnose');
    expect(docChat.props('socketUrl')).toBe('http://doctor:8400');
    expect(docChat.props('sessions')).toBe(doc.sessionsApi);
  });
});

describe('AgentChatWorkspace — the optional proposals adapter', () => {
  const proposalsApi = () => ({
    pending: vi.fn(), approve: vi.fn(), decline: vi.fn(), getSettings: vi.fn(), setSettings: vi.fn(),
  });

  it('forwards the doctor adapter through to the inner chat, as the SAME object', async () => {
    const { sessionsApi, runsApi } = makeScope([{ id: 's1', title: 'S1', status: null, turns: 1 }]);
    const proposals = proposalsApi();
    const chat = (await mountShell({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'http://doctor:8400',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
      proposals,
    })).findComponent(AgentChatStub);
    expect(chat.props('proposals')).toBe(proposals);
  });

  // The other direction, and the one that actually matters: the Knowledge Engine injects NO adapter, so
  // its chat cannot render an approval surface at all. Not hidden by a flag — absent. A shell that
  // defaulted or fabricated an adapter would silently give the KE a consent UI for a capability its agent
  // does not have, and no KE test would notice.
  it('forwards NOTHING when the consumer injects no adapter (the Knowledge Engine)', async () => {
    const { sessionsApi, runsApi } = makeScope([{ id: 'k1', title: 'KE', status: null, turns: 1 }]);
    const chat = (await mountShell({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'http://ke:8300',
      i18nNamespace: 'knowledgeEngine', themeStorageKey: 'k2', scopeKey: 'knowledge',
    })).findComponent(AgentChatStub);
    expect(chat.props('proposals')).toBeUndefined();
  });

  // Two consumers off one shell must not leak into each other: mounting the doctor first must not leave
  // the KE holding its adapter.
  it('keeps the two consumers independent when both are mounted', async () => {
    const doc = makeScope([{ id: 'd1', title: 'Doc', status: null, turns: 0 }]);
    const proposals = proposalsApi();
    const docChat = (await mountShell({
      sessions: doc.sessionsApi, runs: doc.runsApi, socketUrl: 'http://doctor:8400',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1', proposals,
    })).findComponent(AgentChatStub);

    const ke = makeScope([{ id: 'k1', title: 'KE', status: null, turns: 0 }]);
    const keChat = (await mountShell({
      sessions: ke.sessionsApi, runs: ke.runsApi, socketUrl: 'http://ke:8300',
      i18nNamespace: 'knowledgeEngine', themeStorageKey: 'k2', scopeKey: 'knowledge',
    })).findComponent(AgentChatStub);

    expect(docChat.props('proposals')).toBe(proposals);
    expect(keChat.props('proposals')).toBeUndefined();
  });
});
