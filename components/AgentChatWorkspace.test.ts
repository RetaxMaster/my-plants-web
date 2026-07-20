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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, defineComponent, h, Suspense } from 'vue';
import AgentChatWorkspace from './AgentChatWorkspace.vue';
import type { KnowledgeChatRunStatus } from '../types/api';

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

// --- B5: `?session=<id>` URL sync ------------------------------------------------------------------------
//
// Fake vue-router env, swapped in per test via `routeEnv` (same per-test-mutable-closure technique the
// file already uses for sessionsApi/runsApi). `router.replace` mutates `route.query` in place so a test can
// mount, act, then read `routeEnv.route.query` to see the settled URL — mirroring how a real replace()
// updates the current route. `push` is stubbed too (and asserted never called) so an accidental push doesn't
// silently pass by falling through to `replace`'s mock.
function makeRouteEnv(initialQuery: Record<string, string> = {}) {
  const route: { query: Record<string, unknown> } = { query: { ...initialQuery } };
  const replace = vi.fn((to: { query?: Record<string, unknown> }) => {
    if (to?.query) route.query = { ...to.query };
  });
  const push = vi.fn();
  return { route, replace, push };
}
// Existing tests (predating B5) never touch routeEnv at all — default it to an empty-query env so they mount
// exactly as before. Tests below reassign it before mounting to control the starting `?session=` value.
let routeEnv = makeRouteEnv();
vi.stubGlobal('useRoute', () => routeEnv.route);
vi.stubGlobal('useRouter', () => ({ replace: routeEnv.replace, push: routeEnv.push }));

// Explicit AgentChat stub declaring the injected props so we can read exactly what the shell forwarded.
// Also exposes `abandonConversation` as a method (Task 21): the shell now calls `chatRef.value?.
// abandonConversation()` unconditionally from every conversation-exit path (openSession/newChat/
// removeSession), so any test mounting a real `ref="chatRef"` template ref onto this stub needs the method
// to exist even when the test itself has nothing to say about abandonment — otherwise EVERY test in this
// file that clicks a session/new-chat/delete control would throw "abandonConversation is not a function".
const AgentChatStub = defineComponent({
  name: 'AgentChat',
  props: ['sessionId', 'initialProvider', 'initialProviderSessionId', 'initialTurns', 'sessions', 'runs', 'socketUrl', 'i18nNamespace', 'themeStorageKey', 'proposals'],
  methods: { abandonConversation: () => null },
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

  // ⚠️ LAUNCHING is the launch-lease state and is on the wire (the API's ACTIVE_RUN_STATUSES holds
  // QUEUED, LAUNCHING and RUNNING). The web knew only five statuses, so a LAUNCHING session rendered the
  // raw key path `runStatus.LAUNCHING` and — worse — left delete ENABLED during the one window in which
  // the server is guaranteed to refuse it, turning a disabled button into an avoidable error toast.
  //
  // Every ACTIVE status is asserted, not just the one that was missing: the defect was a hand-written
  // list drifting from the API's, and a test that checks only LAUNCHING would drift the same way.
  // ⚠️ EXHAUSTIVE BY CONSTRUCTION. Two hand-written arrays (active / terminal) would be satisfied by any
  // subset, so a seventh status could be added to the union and tested by neither — the same shape of
  // omission that let LAUNCHING ship unhandled. This Record is keyed by the union, so a new status is a
  // COMPILE error here (web `typecheck` covers test files) until someone classifies it.
  const EXPECT_BUSY: Record<KnowledgeChatRunStatus, boolean> = {
    QUEUED: true, LAUNCHING: true, RUNNING: true,
    SUCCEEDED: false, FAILED: false, CANCELLED: false,
  };
  const statusesWhere = (busy: boolean) =>
    (Object.keys(EXPECT_BUSY) as KnowledgeChatRunStatus[]).filter((s) => EXPECT_BUSY[s] === busy);

  it('treats every ACTIVE run status — including LAUNCHING — as busy', async () => {
    for (const status of statusesWhere(true)) {
      const { sessionsApi, runsApi } = makeScope([{ id: 's1', title: 'S1', status, turns: 1 }]);
      const wrapper = await mountShell({
        sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
        i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
      });
      const del = wrapper.find('.mp-kchat-list__del');
      expect(del.attributes('disabled'), `delete must be disabled while ${status}`).toBeDefined();
      wrapper.unmount();
    }
  });

  it('leaves delete enabled once the run reaches a terminal status', async () => {
    for (const status of statusesWhere(false)) {
      const { sessionsApi, runsApi } = makeScope([{ id: 's1', title: 'S1', status, turns: 1 }]);
      const wrapper = await mountShell({
        sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
        i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
      });
      expect(wrapper.find('.mp-kchat-list__del').attributes('disabled'), `delete must be enabled when ${status}`).toBeUndefined();
      wrapper.unmount();
    }
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

// B5 (LOW/UX): reloading the diagnose page used to drop the selected conversation because the session id
// lived only in component state, not the URL. An owner who reloaded mid-approval landed on a blank
// "new chat" and never saw the pending-proposal banner again. Fixed ONCE in the shared shell (`?session=`),
// so both the doctor page and the KE admin page inherit it — per the anti-fork rule, no per-consumer copy.
describe('AgentChatWorkspace — session id in the URL (B5: reload keeps the pinned conversation)', () => {
  // Every mount in this block is tracked and torn down in afterEach — a leaked mount from an earlier test
  // (e.g. a stray socket/localStorage listener inside AgentChat) is exactly the false-green class this file
  // already guards against in the LAUNCHING loop tests above (explicit unmount there too).
  let mounted: Array<Awaited<ReturnType<typeof mountShell>>>;
  beforeEach(() => { mounted = []; });
  afterEach(() => { for (const w of mounted) w.unmount(); });

  async function mountTracked(props: Record<string, unknown>) {
    const wrapper = await mountShell(props);
    mounted.push(wrapper);
    return wrapper;
  }

  it('restores the conversation pinned in ?session=<id> on mount', async () => {
    routeEnv = makeRouteEnv({ session: 's2' });
    const { sessionsApi, runsApi } = makeScope([
      { id: 's1', title: 'First', status: null, turns: 1 },
      { id: 's2', title: 'Second', status: null, turns: 3 },
    ]);
    const wrapper = await mountTracked({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });

    expect(sessionsApi.fetch).toHaveBeenCalledWith('s2');
    expect(wrapper.findComponent(AgentChatStub).props('sessionId')).toBe('s2');
    const items = wrapper.findAll('.mp-kchat-list__item');
    expect(items[0].classes()).not.toContain('is-active');
    expect(items[1].classes()).toContain('is-active');
    // The URL already matched the restored id, so no redundant replace() fired on mount.
    expect(routeEnv.replace).not.toHaveBeenCalled();
  });

  it('a FAILING restore falls back to new-chat AND clears the stale session param', async () => {
    routeEnv = makeRouteEnv({ session: 'ghost' });
    const { sessionsApi, runsApi } = makeScope([{ id: 's1', title: 'First', status: null, turns: 1 }]);
    sessionsApi.fetch.mockRejectedValueOnce(new Error('404 Not Found'));

    const wrapper = await mountTracked({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });

    expect(sessionsApi.fetch).toHaveBeenCalledWith('ghost');
    // Degraded to the new-chat state — no broken panel pinned to a dead id.
    expect(wrapper.findComponent(AgentChatStub).props('sessionId')).toBeNull();
    expect(wrapper.findAll('.mp-kchat-list__item.is-active')).toHaveLength(0);
    // And the stale param is stripped from the URL, via replace (never push).
    expect(routeEnv.replace).toHaveBeenCalledWith({ query: {} });
    expect(routeEnv.route.query.session).toBeUndefined();
    expect(routeEnv.push).not.toHaveBeenCalled();
  });

  it('selecting a conversation syncs the URL via replace(), never push()', async () => {
    routeEnv = makeRouteEnv({});
    const { sessionsApi, runsApi } = makeScope([
      { id: 's1', title: 'First', status: null, turns: 1 },
      { id: 's2', title: 'Second', status: null, turns: 3 },
    ]);
    const wrapper = await mountTracked({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });

    await wrapper.findAll('.mp-kchat-list__open')[1].trigger('click');

    expect(routeEnv.replace).toHaveBeenCalledWith({ query: { session: 's2' } });
    expect(routeEnv.route.query.session).toBe('s2');
    expect(routeEnv.push).not.toHaveBeenCalled();
  });

  it('adopting a newly-created conversation (onCreated) puts its id in the URL', async () => {
    routeEnv = makeRouteEnv({});
    const { sessionsApi, runsApi } = makeScope([]);
    const wrapper = await mountTracked({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });

    wrapper.findComponent(AgentChatStub).vm.$emit('created', 'brand-new-id');
    await flushPromises();

    expect(routeEnv.replace).toHaveBeenCalledWith({ query: { session: 'brand-new-id' } });
    expect(routeEnv.route.query.session).toBe('brand-new-id');
    expect(routeEnv.push).not.toHaveBeenCalled();
  });

  it('starting a new chat clears the session param from the URL', async () => {
    routeEnv = makeRouteEnv({ session: 's1' });
    const { sessionsApi, runsApi } = makeScope([{ id: 's1', title: 'First', status: null, turns: 1 }]);
    const wrapper = await mountTracked({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });
    expect(routeEnv.route.query.session).toBe('s1'); // sanity: the restore ran first

    // The "New chat" control is the UiButton stub above the session list (stubbed as `true`, which still
    // forwards the fallthrough @click listener onto the stub's root element — verified empirically).
    await wrapper.find('ui-button-stub').trigger('click');

    expect(routeEnv.route.query.session).toBeUndefined();
    expect(routeEnv.push).not.toHaveBeenCalled();
  });

  it('deleting the selected conversation clears the session param from the URL', async () => {
    routeEnv = makeRouteEnv({ session: 's1' });
    const { sessionsApi, runsApi } = makeScope([{ id: 's1', title: 'First', status: null, turns: 1 }]);
    const wrapper = await mountTracked({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });
    expect(routeEnv.route.query.session).toBe('s1'); // sanity: the restore ran first

    await wrapper.find('.mp-kchat-list__del').trigger('click');
    await flushPromises();

    expect(sessionsApi.remove).toHaveBeenCalledWith('s1');
    expect(routeEnv.route.query.session).toBeUndefined();
  });

  it('preserves unrelated query params when syncing the session id', async () => {
    routeEnv = makeRouteEnv({ session: 's1', tab: 'notes' });
    const { sessionsApi, runsApi } = makeScope([
      { id: 's1', title: 'First', status: null, turns: 1 },
      { id: 's2', title: 'Second', status: null, turns: 3 },
    ]);
    const wrapper = await mountTracked({
      sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
      i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
    });

    await wrapper.findAll('.mp-kchat-list__open')[1].trigger('click');

    expect(routeEnv.replace).toHaveBeenLastCalledWith({ query: { tab: 'notes', session: 's2' } });
    expect(routeEnv.route.query).toEqual({ tab: 'notes', session: 's2' });
  });
});

// Task 21: AgentChatWorkspace owns conversation SELECTION for BOTH surfaces (KE + doctor), so the
// leak-prevention call belongs here ONCE rather than forked per consumer. Without it, the agents-realtime
// package's own docs warn that a first-turn queued message can resurface in a DIFFERENT conversation within
// its one-hour persistence window — a remount (this shell keys <AgentChat> on the session id) is NOT enough
// for the package to infer a switch on its own.
//
// `AgentChat` is mounted here as a STUB, so `urlRegistry.releaseAll()` — the OTHER half of the exposed
// `abandonConversation()` contract — can never genuinely run in this file (the real component's
// `defineExpose` body never executes). That half is proven instead in AgentChat.test.ts against the REAL
// component. What IS genuinely observable here, and is what this suite asserts: every one of the four
// "leaving a conversation" call sites reaches the exposed method, and the call happens BEFORE the next
// session's detail is fetched.
describe('AgentChatWorkspace — abandonConversation on every conversation exit (Task 21)', () => {
  const abandonSpy = vi.fn();
  beforeEach(() => { abandonSpy.mockReset(); });

  // A stub that ALSO exposes abandonConversation as a method — Options API components expose their public
  // methods on the instance by default, which is what lets `ref="chatRef"` in AgentChatWorkspace.vue
  // actually resolve to something callable. The shared, prop-only AgentChatStub above cannot serve this
  // suite: it declares no methods, so a template ref to it would resolve to an instance with no
  // `abandonConversation` at all — indistinguishable, from this test's point of view, from the call being
  // missing in production.
  const AgentChatStubWithAbandon = defineComponent({
    name: 'AgentChat',
    props: ['sessionId', 'initialProvider', 'initialProviderSessionId', 'initialTurns', 'sessions', 'runs', 'socketUrl', 'i18nNamespace', 'themeStorageKey', 'proposals'],
    methods: { abandonConversation: abandonSpy },
    template: '<div class="agent-chat-stub" />',
  });

  // The file-level UiButton stub (`true`) renders a shallow `<ui-button-stub>` whose fallthrough attrs catch
  // a native click (existing tests rely on exactly that quirk), but that trick cannot prove a SPY was
  // called on click — for that the element must genuinely dispatch a click Vue's runtime observes. Swap in
  // a stub that renders a real `<button>` instead, scoped to this describe only.
  const ClickableUiButton = defineComponent({
    name: 'UiButton',
    template: '<button type="button" v-bind="$attrs"><slot /></button>',
  });

  async function mountWorkspace() {
    const { sessionsApi, runsApi } = makeScope([
      { id: 'a', title: 'A', status: null, turns: 1 },
      { id: 'b', title: 'B', status: null, turns: 1 },
    ]);
    // 'a' restores as the open conversation on mount, so every exit below has a real "current conversation"
    // to leave.
    routeEnv = makeRouteEnv({ session: 'a' });
    const stubs = {
      AgentChat: AgentChatStubWithAbandon,
      ClientOnly: slotStub('ClientOnly'),
      UiCard: slotStub('UiCard'),
      UiEmptyState: slotStub('UiEmptyState'),
      UiButton: ClickableUiButton, UiBadge: true, UiAppIcon: true,
    };
    const Wrapper = defineComponent({
      render() {
        return h(Suspense, null, {
          default: () => h(AgentChatWorkspace as unknown as Parameters<typeof h>[0], {
            sessions: sessionsApi, runs: runsApi, socketUrl: 'x',
            i18nNamespace: 'diagnose', themeStorageKey: 'k', scopeKey: 'diagnose-p1',
          }),
          fallback: () => h('div'),
        });
      },
    });
    const wrapper = mount(Wrapper, { global: { stubs, mocks: { $t: (k: string) => k } } });
    await flushPromises();
    return { wrapper, sessionsApi, runsApi };
  }

  // PARAMETERISED OVER THE LIST on purpose, so an exit added later FAILS this test instead of silently
  // skipping the call. Testing one member verifies the mechanism but not the wiring — and a missed call on
  // "delete the current session" reproduces exactly the cross-conversation leak this exists to prevent.
  const exits: Array<{ name: string; trigger: (ctx: Awaited<ReturnType<typeof mountWorkspace>>) => Promise<void> }> = [
    { name: 'selecting a different session', trigger: async ({ wrapper }) => { await wrapper.find('[data-test="session-item-b"]').trigger('click'); } },
    { name: 'starting a new chat', trigger: async ({ wrapper }) => { await wrapper.find('[data-test="new-chat"]').trigger('click'); } },
    { name: 'deleting the current session', trigger: async ({ wrapper }) => { await wrapper.find('[data-test="delete-session-a"]').trigger('click'); } },
    { name: 'the disappeared-session fallback', trigger: async ({ wrapper, sessionsApi }) => {
        sessionsApi.fetch.mockRejectedValueOnce(new Error('gone'));
        await wrapper.find('[data-test="session-item-b"]').trigger('click');
      } },
  ];

  for (const exit of exits) {
    it(`calls abandonConversation when ${exit.name}`, async () => {
      const ctx = await mountWorkspace();
      abandonSpy.mockClear();
      await exit.trigger(ctx);
      await flushPromises();
      expect(abandonSpy).toHaveBeenCalled();
    });
  }

  // NOTE WHAT IS ASSERTED, AND WHY IT IS NOT `wrapper.text()`. The obvious version —
  // `expect(wrapper.text()).not.toContain('draft from A')` — is UNFALSIFIABLE here: AgentChat is mounted as
  // a STUB that renders no composer, so that string can never appear no matter how broken the wiring is.
  // It would pass with the whole feature deleted.
  //
  // The real claim is ORDERING: the draft cannot leak into B if the conversation was abandoned before B's
  // detail was fetched. That is observable, and it actually fails when the call is moved after the fetch —
  // see the mutation check run alongside this task.
  it('on an A to B switch, abandon fires BEFORE B loads', async () => {
    const { wrapper, sessionsApi } = await mountWorkspace();
    abandonSpy.mockClear();
    sessionsApi.fetch.mockClear();

    await wrapper.find('[data-test="session-item-b"]').trigger('click');
    await flushPromises();

    expect(abandonSpy).toHaveBeenCalled();
    expect(sessionsApi.fetch).toHaveBeenCalledWith('b');
    expect(abandonSpy.mock.invocationCallOrder[0])
      .toBeLessThan(sessionsApi.fetch.mock.invocationCallOrder.at(-1)!);
  });

  // ⚠️ THE REGRESSION GUARD FOR THE REAL BUG (caught in review, not by the tests above). `chatRef` always
  // points at the CURRENTLY MOUNTED AgentChat — the conversation the owner is actively viewing — never at
  // whatever session id merely happens to be the argument of a call. An earlier version called
  // `leaveConversation()` unconditionally at the top of `removeSession()`, so deleting an UNRELATED
  // conversation from the sidebar silently abandoned the owner's OWN active draft and revoked the blob urls
  // their transcript was rendering right now — with zero error, because the return value is deliberately
  // discarded. Nothing about deleting conversation B may ever touch conversation A.
  it('does NOT call abandonConversation when deleting a DIFFERENT (non-selected) conversation', async () => {
    const { wrapper } = await mountWorkspace(); // 'a' is the open/selected conversation
    abandonSpy.mockClear();

    await wrapper.find('[data-test="delete-session-b"]').trigger('click');
    await flushPromises();

    expect(abandonSpy).not.toHaveBeenCalled();
  });

  // The same class of bug, the other call site: `openSession()` used to fire unconditionally too, so
  // re-clicking the conversation you are ALREADY reading — an entirely ordinary, always-available click —
  // self-inflicted the identical damage (abandoning your own draft, revoking your own images) for no reason.
  // Re-selecting the conversation you are already in is not leaving it.
  it('does NOT call abandonConversation when re-selecting the already-open conversation', async () => {
    const { wrapper } = await mountWorkspace(); // 'a' is already open
    abandonSpy.mockClear();

    await wrapper.find('[data-test="session-item-a"]').trigger('click');
    await flushPromises();

    expect(abandonSpy).not.toHaveBeenCalled();
  });

  // The one exit that must NOT be guarded: starting a new chat is ALWAYS a real exit, even when the owner is
  // already sitting in an unsaved "new chat" (selected.value already null) — that unsaved chat has its OWN
  // AgentChat instance and may hold its own queued draft. `openSession(null)`'s internal guard would SKIP
  // its call here (null === null), so newChat() must fire its own call unconditionally and NOT rely on it.
  it('starting a new chat from an already-new, unsaved chat still abandons (the explicit, unconditional call)', async () => {
    const { wrapper } = await mountWorkspace();
    await wrapper.find('[data-test="new-chat"]').trigger('click'); // enter the "new chat" state first
    await flushPromises();
    abandonSpy.mockClear();

    await wrapper.find('[data-test="new-chat"]').trigger('click'); // new chat AGAIN, from within a new chat
    await flushPromises();

    expect(abandonSpy).toHaveBeenCalled();
  });

  // ⚠️ WHY THIS TEST EXISTS ON ITS OWN, SEPARATE FROM THE PARAMETERISED "deleting the current session" CASE
  // ABOVE: that case deletes the SELECTED session, so it also routes through `openSession(null)` — and
  // `openSession(null)`'s OWN internal call is what actually fires, not anything specific to
  // `removeSession()`. Reviewed and confirmed by mutation: removing `removeSession`'s
  // `if (selected.value === sid) { … await openSession(null); }` branch (or the call inside it) DOES turn
  // that parameterised case red — see the mutation note in the Task 21 report — but a reviewer who only read
  // that one test could still wonder whether it was pinning the right call site. This test makes the ORDER
  // explicit and unmistakable: the abandon must happen strictly AFTER the delete request resolves (a failed
  // delete must never abandon anything, since nothing was actually left), by asserting `sessions.remove` was
  // called before `abandonConversation` was.
  it('abandons the current session only AFTER its delete has resolved, never before', async () => {
    const { wrapper, sessionsApi } = await mountWorkspace(); // 'a' is selected
    abandonSpy.mockClear();
    sessionsApi.remove.mockClear();

    await wrapper.find('[data-test="delete-session-a"]').trigger('click');
    await flushPromises();

    expect(sessionsApi.remove).toHaveBeenCalledWith('a');
    expect(abandonSpy).toHaveBeenCalled();
    expect(sessionsApi.remove.mock.invocationCallOrder[0])
      .toBeLessThan(abandonSpy.mock.invocationCallOrder.at(-1)!);
  });
});
