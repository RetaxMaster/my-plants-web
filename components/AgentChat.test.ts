// @vitest-environment happy-dom
//
// The risk this file guards: the approval surface silently degrading. The ways that happens, all tested
// here — polling creeping in (a timer instead of the two triggers), the banner rendering in the wrong
// place (inside the package's Console instead of the platform's own notice zone), a pending proposal
// blocking the composer, and an approve on an expired proposal failing SILENTLY.
//
// AgentChat imports the vendored chat package, so the package is mocked wholesale: we care about OUR
// wiring, not about re-testing a third-party transcript renderer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, watch, defineComponent } from 'vue';

// `vi.hoisted` runs BEFORE the imports above, so it cannot use the top-level `ref` — it imports `vue`
// itself. This package is ESM ("type": "module"), so it must be a dynamic `import()`, never `require()`;
// both `vi.hoisted` and `vi.mock` factories accept an async function for exactly this.
const chatStub = await vi.hoisted(async () => {
  const { ref: r } = await import('vue');
  return {
    entries: r([]),
    state: r('idle'),
    sessionId: r('agent-session-1'),
    selectedProvider: r('claude'),
    providerLocked: r(false),
    providerBusy: r(false),
    failure: r(null),
    retrying: r(null),
    setProvider: vi.fn(),
    applyAvailability: vi.fn(),
    retry: vi.fn(),
    connect: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    pushUserPrompt: vi.fn(),
    start: vi.fn(),
    resume: vi.fn(),
    seedHistory: vi.fn(),
    relabel: vi.fn(),
  };
});

vi.mock('@retaxmaster/agents-realtime-client/vue', async () => {
  const { defineComponent: dc, ref: r } = await import('vue');
  const stub = (name: string, cls: string) =>
    dc({
      name,
      inheritAttrs: false,
      props: ['entries', 'labels', 'busy', 'agentLabel', 'running', 'canSend', 'disabled', 'error',
              'commands', 'failure', 'retrying', 'providers', 'selected', 'locked', 'providerLabels',
              'modelValue'],
      template: `<div class="${cls}" />`,
    });
  return {
    AgentSelector: stub('AgentSelector', 'stub-selector'),
    Console: stub('Console', 'stub-console'),
    Composer: stub('Composer', 'stub-composer'),
    RunFailureNotice: stub('RunFailureNotice', 'stub-failure'),
    ThemeSelector: stub('ThemeSelector', 'stub-theme'),
    useTheme: () => ({ theme: r('auto'), setTheme: vi.fn() }),
    useAgentChat: () => chatStub,
  };
});
vi.mock('@retaxmaster/agents-realtime-client', () => ({}));
vi.mock('@retaxmaster/agents-realtime-protocol', () => ({ parseCommandInput: () => null }));

import AgentChat from './AgentChat.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('onMounted', (fn: () => unknown) => { void fn(); });
vi.stubGlobal('onBeforeUnmount', () => {});
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));

const PENDING = {
  id: 'prop-1',
  status: 'PENDING' as const,
  summary: 'summary text',
  autoApproved: false,
  failureCode: null,
  failureReason: null,
  createdAt: '2026-07-18T10:00:00.000Z',
  operations: [{
    type: 'profile.update' as const,
    targetLabel: 'profile',
    destructive: false,
    changes: [{ field: 'Pot type', before: 'Plastic', after: 'Terracotta' }],
  }],
};

function makeSessions() {
  return {
    create: vi.fn(), resume: vi.fn(),
    history: vi.fn(async () => ({ turns: [], agentSessionMissing: false })),
    providers: vi.fn(async () => []),
    commands: vi.fn(async () => ({ commands: [] })),
  };
}

const BannerStub = defineComponent({
  name: 'AgentProposalBanner',
  props: ['proposal', 'i18nNamespace', 'busy', 'errorMessage'],
  template: '<div class="stub-banner">{{ errorMessage }}</div>',
});
const SkipStub = defineComponent({
  name: 'AgentSkipPermissions',
  props: ['modelValue', 'i18nNamespace', 'busy', 'disabled', 'errorMessage'],
  template: '<div class="stub-skip">{{ errorMessage }}</div>',
});

// Every mount is tracked and torn down. `chatStub` is a MODULE-LEVEL shared object, so a component left
// mounted keeps a live watcher on `chatStub.state` — and the moment a LATER test drives that state, the
// leaked components from earlier tests re-run their proposal fetch against an adapter whose mock queue is
// long exhausted. The symptom is an unhandled rejection attributed to whichever test happened to be
// running, which is why the failure looked unrelated to the test that caused it. Vitest reports those as
// errors alongside a green suite: tests that pass WHILE throwing are a false green, not a pass.
const mounted: { unmount: () => void }[] = [];

function mountChat(proposals: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
  const w = mountChatInner(proposals, extra);
  mounted.push(w);
  return w;
}

function mountChatInner(proposals: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
  return mount(AgentChat, {
    props: {
      sessionId: 'sess-1',
      initialProvider: 'claude',
      initialProviderSessionId: 'agent-session-1',
      initialTurns: [],
      sessions: makeSessions(),
      runs: { mintSocketTicket: vi.fn() },
      socketUrl: 'http://doctor:8400',
      i18nNamespace: 'diagnose',
      ...(proposals ? { proposals } : {}),
      ...extra,
    },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { AgentProposalBanner: BannerStub, AgentSkipPermissions: SkipStub },
    },
  });
}

function makeProposals(overrides: Record<string, unknown> = {}) {
  return {
    pending: vi.fn(async () => PENDING),
    approve: vi.fn(async () => ({ ...PENDING, status: 'APPROVED' as const })),
    decline: vi.fn(async () => ({ ...PENDING, status: 'DECLINED' as const })),
    getSettings: vi.fn(async () => ({ skipPermissions: false })),
    setSettings: vi.fn(async (_s: string, v: boolean) => ({ skipPermissions: v })),
    ...overrides,
  };
}

const conflict = (status: string) =>
  Object.assign(new Error('conflict'), { statusCode: 409, data: { status } });

beforeEach(() => { chatStub.state.value = 'idle'; });
afterEach(async () => {
  while (mounted.length) mounted.pop()!.unmount();
  await flushPromises();
  vi.useRealTimers();
});

describe('AgentChat — the doctor approval surface', () => {
  it('fetches the pending proposal on mount and renders the banner', async () => {
    const proposals = makeProposals();
    const w = mountChat(proposals);
    await flushPromises();
    expect(proposals.pending).toHaveBeenCalledTimes(1);
    expect(proposals.pending).toHaveBeenCalledWith('sess-1');
    expect(w.find('.stub-banner').exists()).toBe(true);
  });

  // §6.2: two triggers, NO POLLING. A timer here would be a regression the product cannot see.
  it('never polls — no further fetch happens as time passes', async () => {
    vi.useFakeTimers();
    const proposals = makeProposals();
    mountChat(proposals);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(proposals.pending).toHaveBeenCalledTimes(1);
  });

  // The second trigger: the package's `done`, which surfaces as the run leaving the streaming states.
  it('refetches when a run finishes', async () => {
    const proposals = makeProposals();
    mountChat(proposals);
    await flushPromises();
    chatStub.state.value = 'streaming';
    await flushPromises();
    chatStub.state.value = 'done';
    await flushPromises();
    expect(proposals.pending).toHaveBeenCalledTimes(2);
  });

  // The run STARTING is not a trigger — only its terminal transition is. A refetch on every state change
  // would be polling by another name, paced by the agent instead of a timer.
  it('does not refetch merely because a run started', async () => {
    const proposals = makeProposals();
    mountChat(proposals);
    await flushPromises();
    chatStub.state.value = 'connecting';
    await flushPromises();
    chatStub.state.value = 'streaming';
    await flushPromises();
    expect(proposals.pending).toHaveBeenCalledTimes(1);
  });

  it('renders the banner BETWEEN the Console and the Composer', async () => {
    const w = mountChat(makeProposals());
    await flushPromises();
    const html = w.html();
    expect(html.indexOf('stub-console')).toBeLessThan(html.indexOf('stub-banner'));
    expect(html.indexOf('stub-banner')).toBeLessThan(html.indexOf('stub-composer'));
  });

  // §5.3 item 5: "The chat is never blocked. The owner may keep typing with a banner open."
  it('leaves the composer sendable while a proposal is pending', async () => {
    const w = mountChat(makeProposals());
    await flushPromises();
    expect(w.findComponent({ name: 'Composer' }).props('canSend')).toBe(true);
  });

  // §5.3.1: approving an expired proposal MUST fail visibly. A silent no-op is the defect.
  it('surfaces a visible failure when approving an expired proposal', async () => {
    const proposals = makeProposals({ approve: vi.fn(async () => { throw conflict('EXPIRED'); }) });
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('approve');
    await flushPromises();
    expect(w.text()).toContain('diagnose.proposal.conflict.expired');
  });

  // The same failure, but the server has ALSO dropped the proposal — so the banner is gone and the error
  // has nowhere to live inside it. This is the exact path the empty-body wire shape would have broken:
  // if "nothing pending" did not normalize to null, the banner would count as still-showing and this
  // fallback would never render, making an expired approve indistinguishable from a successful one.
  it('keeps the failure visible even after the proposal disappears', async () => {
    const proposals = makeProposals({
      approve: vi.fn(async () => { throw conflict('EXPIRED'); }),
      pending: vi.fn()
        .mockResolvedValueOnce(PENDING)   // mount
        .mockResolvedValueOnce(null),     // the post-failure refetch: it is gone
    });
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('approve');
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(false);
    expect(w.text()).toContain('diagnose.proposal.conflict.expired');
  });

  // Render on `status`, never by parsing the message: EXPIRED ("a newer message ended it") and
  // DECLINED-elsewhere are different stories for the owner.
  it('distinguishes an expired proposal from one already resolved elsewhere', async () => {
    const w = mountChat(makeProposals({ approve: vi.fn(async () => { throw conflict('DECLINED'); }) }));
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('approve');
    await flushPromises();
    expect(w.text()).toContain('diagnose.proposal.conflict.resolved');
  });

  // A non-409 is not a race — nothing was applied, and saying "expired" would be a guess.
  it('reports a generic failure when the request failed for a non-conflict reason', async () => {
    const w = mountChat(makeProposals({ approve: vi.fn(async () => { throw new Error('network down'); }) }));
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('approve');
    await flushPromises();
    expect(w.text()).toContain('diagnose.proposal.applyError');
  });

  it('closes the banner and clears any error when the approval succeeds', async () => {
    const proposals = makeProposals();
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('approve');
    await flushPromises();
    expect(proposals.approve).toHaveBeenCalledWith('sess-1', 'prop-1');
    expect(w.find('.stub-banner').exists()).toBe(false);
    expect(w.text()).not.toContain('diagnose.proposal.applyError');
  });

  // Dismiss is NOT a decline (§5.3): it closes the banner and sends nothing.
  it('dismiss closes the banner without calling decline', async () => {
    const proposals = makeProposals();
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('dismiss');
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(false);
    expect(proposals.decline).not.toHaveBeenCalled();
    expect(proposals.approve).not.toHaveBeenCalled();
  });

  // Dismiss means "let me ask something first", so the SAME proposal must stay closed across a refetch —
  // otherwise it reappears the moment the owner's follow-up question finishes, which is nagging.
  it('keeps a dismissed proposal closed when the same one is refetched', async () => {
    const proposals = makeProposals();
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('dismiss');
    await flushPromises();
    chatStub.state.value = 'streaming';
    await flushPromises();
    chatStub.state.value = 'done';
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(false);
  });

  // …but a genuinely NEW proposal is a new request for consent, and an earlier dismissal must not swallow
  // it. This is the difference between "dismissed this one" and "muted the feature".
  it('reopens the banner for a different proposal after a dismissal', async () => {
    const proposals = makeProposals({
      pending: vi.fn()
        .mockResolvedValueOnce(PENDING)
        .mockResolvedValueOnce({ ...PENDING, id: 'prop-2' }),
    });
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('dismiss');
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(false);
    chatStub.state.value = 'streaming';
    await flushPromises();
    chatStub.state.value = 'done';
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(true);
  });

  it('decline calls the adapter and closes the banner', async () => {
    const proposals = makeProposals();
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('decline');
    await flushPromises();
    expect(proposals.decline).toHaveBeenCalledWith('sess-1', 'prop-1');
    expect(w.find('.stub-banner').exists()).toBe(false);
  });

  it('surfaces a visible failure when the decline could not be recorded', async () => {
    const w = mountChat(makeProposals({ decline: vi.fn(async () => { throw new Error('offline'); }) }));
    await flushPromises();
    w.findComponent(BannerStub).vm.$emit('decline');
    await flushPromises();
    expect(w.text()).toContain('diagnose.proposal.applyError');
  });

  // A failed READ must not blank a banner the owner is looking at: a missing notification is recoverable,
  // a wrongly-withdrawn one is not.
  it('leaves the visible banner alone when a refetch fails', async () => {
    const proposals = makeProposals({
      pending: vi.fn()
        .mockResolvedValueOnce(PENDING)
        .mockRejectedValueOnce(new Error('offline')),
    });
    const w = mountChat(proposals);
    await flushPromises();
    chatStub.state.value = 'streaming';
    await flushPromises();
    chatStub.state.value = 'done';
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(true);
  });

  it('loads the skip-permissions setting and pushes a change through the adapter', async () => {
    const proposals = makeProposals();
    const w = mountChat(proposals);
    await flushPromises();
    expect(proposals.getSettings).toHaveBeenCalledWith('sess-1');
    expect(w.findComponent(SkipStub).props('modelValue')).toBe(false);
    w.findComponent(SkipStub).vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(proposals.setSettings).toHaveBeenCalledWith('sess-1', true);
    expect(w.findComponent(SkipStub).props('modelValue')).toBe(true);
  });

  // The rendered value follows the SERVER's answer, never the click. A rejected PATCH leaving the screen
  // claiming approvals are off would be the trap §6.4 exists to prevent.
  it('keeps the server value when the skip-permissions change is rejected', async () => {
    const proposals = makeProposals({ setSettings: vi.fn(async () => { throw new Error('nope'); }) });
    const w = mountChat(proposals);
    await flushPromises();
    w.findComponent(SkipStub).vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(w.findComponent(SkipStub).props('modelValue')).toBe(false);
    expect(w.findComponent(SkipStub).props('errorMessage')).toBe('diagnose.skipPermissions.error');
  });

  // The switch has nowhere to persist a setting until a session row exists.
  it('disables the switch until the conversation has a session', async () => {
    const w = mountChat(makeProposals(), { sessionId: null });
    await flushPromises();
    expect(w.findComponent(SkipStub).props('disabled')).toBe(true);
  });

  it('does not call the adapter at all when there is no session yet', async () => {
    const proposals = makeProposals();
    mountChat(proposals, { sessionId: null });
    await flushPromises();
    expect(proposals.pending).not.toHaveBeenCalled();
    expect(proposals.getSettings).not.toHaveBeenCalled();
  });

  // The Knowledge Engine injects no adapter, so its chat is STRUCTURALLY incapable of showing this surface.
  it('renders no approval surface at all when no proposals adapter is injected', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(false);
    expect(w.find('.stub-skip').exists()).toBe(false);
  });

  // The adapter is an INJECTED interface, so `DoctorProposal | null` is a promise about someone else's
  // code. `undefined` is not `null`, and a `!== null` guard would let it reach `.id` and throw inside a
  // computed — surfacing as an unhandled rejection rather than a visible failure. The wire has already
  // produced one such value (an empty 200 body arrives as `''`), so this is a demonstrated shape, not a
  // hypothetical one.
  it('does not crash when the adapter resolves undefined instead of null', async () => {
    const proposals = makeProposals({ pending: vi.fn(async () => undefined) });
    const w = mountChat(proposals);
    await flushPromises();
    expect(w.find('.stub-banner').exists()).toBe(false);
    expect(w.findComponent({ name: 'Composer' }).props('canSend')).toBe(true);
  });

  it('still emits changed on a terminal run, as it did before', async () => {
    const w = mountChat(makeProposals());
    await flushPromises();
    chatStub.state.value = 'streaming';
    await flushPromises();
    chatStub.state.value = 'done';
    await flushPromises();
    expect(w.emitted('changed')).toBeTruthy();
  });
});
