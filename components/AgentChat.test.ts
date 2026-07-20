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
import { ref, computed, watch, defineComponent, nextTick } from 'vue';

// `vi.hoisted` runs BEFORE the imports above, so it cannot use the top-level `ref` — it imports `vue`
// itself. This package is ESM ("type": "module"), so it must be a dynamic `import()`, never `require()`;
// both `vi.hoisted` and `vi.mock` factories accept an async function for exactly this.
const chatStub = await vi.hoisted(async () => {
  const { ref: r } = await import('vue');
  return {
    entries: r([]),
    state: r('idle'),
    // Typed explicitly (not left to `r('agent-session-1')`'s inferred `Ref<string>`): the "brand-new
    // conversation" queue test nulls this out to force `submit()`'s `chat.start` branch.
    sessionId: r<string | null>('agent-session-1'),
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
    // The message-queue members (Task 20). Refs, not `undefined` — AgentChat.vue reads them as the real
    // factory's `UseAgentChatInstance` guarantees (non-optional), so a stub that omitted them would throw
    // at render time in every test in this file, not just the queue ones. Typed explicitly (rather than
    // left to `r(null)`'s inferred `Ref<null>`) because several tests assign a real payload later.
    queuedMessage: r<{ text: string; attachments: unknown[] } | null>(null),
    returnedToComposer: r<{ text: string; attachments: unknown[] } | null>(null),
    restoredDraft: r<{ text: string; attachmentsDropped: boolean } | null>(null),
    clearReturned: vi.fn(),
    clearRestored: vi.fn(),
    enqueueMessage: vi.fn(),
    cancelQueued: vi.fn(),
    // Not wired by Task 20 (that is Task 21's `abandonConversation()` + the workspace exits) — added now
    // so Task 21 finds it already on the stub.
    abandonConversation: vi.fn(),
  };
});

// A spy over the package's `useAgentChat` call itself (not just its returned stub), so a test can assert
// on the OPTIONS object AgentChat hands it — e.g. `systemLabel`, which is a useAgentChat option, not a
// Composer prop.
const useAgentChatSpy = vi.hoisted(() => vi.fn());

vi.mock('@retaxmaster/agents-realtime-client/vue', async () => {
  const { defineComponent: dc, ref: r } = await import('vue');
  const stub = (name: string, cls: string) =>
    dc({
      name,
      inheritAttrs: false,
      props: ['entries', 'labels', 'busy', 'agentLabel', 'running', 'canSend', 'disabled', 'error',
              'commands', 'failure', 'retrying', 'providers', 'selected', 'locked', 'providerLabels',
              'modelValue', 'attachmentsEnabled', 'attachmentCaps', 'urlRegistry', 'attachments',
              'queuedText', 'queuedAttachmentCount', 'queueingEnabled'],
      template: `<div class="${cls}" />`,
    });
  return {
    AgentSelector: stub('AgentSelector', 'stub-selector'),
    Console: stub('Console', 'stub-console'),
    Composer: stub('Composer', 'stub-composer'),
    RunFailureNotice: stub('RunFailureNotice', 'stub-failure'),
    ThemeSelector: stub('ThemeSelector', 'stub-theme'),
    useTheme: () => ({ theme: r('auto'), setTheme: vi.fn() }),
    useAgentChat: (options: unknown) => { useAgentChatSpy(options); return chatStub; },
  };
});
// `createObjectUrlRegistry` is a real `vi.fn()` (not a bare literal) so a later test can spy on
// `releaseAll` / assert `urlFor`'s minted value — Tasks 20/21 need that, this task only needs the shape.
const urlRegistryStub = {
  urlFor: vi.fn((_surface: string, item: { id: string }) => `blob:stub-${item.id}`),
  release: vi.fn(),
  releaseSurface: vi.fn(),
  releaseAll: vi.fn(),
  dispose: vi.fn(),
  size: 0,
  onTurnSealed: vi.fn(),
  onTurnSuperseded: vi.fn(),
};
// `createObjectUrlRegistry` is stubbed (a test must never mint a real object url), but `mergeIntoComposer`
// is left as the REAL package export via `importOriginal` — a hand-rolled stub of the merge rule would
// prove nothing about the fix this file exists to guard (the project's own lesson: several shipped defects
// trace back to fixtures shaped by hand rather than by the real system they stand in for).
vi.mock('@retaxmaster/agents-realtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retaxmaster/agents-realtime-client')>();
  return {
    ...actual,
    createObjectUrlRegistry: vi.fn(() => urlRegistryStub),
  };
});
// AgentChat.vue now pulls CHAT_ATTACHMENT_CAPS from utils/chatSend.ts, which imports these constants
// straight from the protocol package (never retyped) — so the mock must carry them too, or importing
// chatSend.ts throws before a single test in this file can run.
vi.mock('@retaxmaster/agents-realtime-protocol', () => ({
  parseCommandInput: () => null,
  DEFAULT_ATTACHMENT_MAX_COUNT: 6,
  DEFAULT_ATTACHMENT_MAX_FILE_BYTES: 10 * 1024 * 1024,
  DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES: 20 * 1024 * 1024,
  IMAGE_MIME_ALLOWLIST: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
}));

import AgentChat from './AgentChat.vue';
import type { ChatProposalsAdapter } from '../types/api';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('onMounted', (fn: () => unknown) => { void fn(); });
vi.stubGlobal('onBeforeUnmount', () => {});
// `mergeIntoDraft` (the shared merge helper behind BUG 1's fix) uses Nuxt's auto-imported `nextTick` to
// restore the caret after a merge — stubbed the same way as the other auto-imports above, or every path
// that calls it throws `ReferenceError: nextTick is not defined` under plain Vitest.
vi.stubGlobal('nextTick', nextTick);
// The catalogue's REAL thirteen `composer.errors.<code>` codes (verified in en.json/es.json under both
// namespaces) — mirrored here only to give the stub `te()` something honest to answer against. `t` stays
// an identity function on purpose (Ruling 1): asserting on the RESOLVED KEY, not translated prose, is what
// keeps this a component test rather than an i18n test.
const KNOWN_ERROR_CODES = new Set([
  'attachment_corrupt', 'attachment_count_exceeded', 'attachment_too_large', 'attachment_total_exceeded',
  'attachment_type_not_allowed', 'attachment_write_failed', 'attachments_unavailable', 'message_too_long',
  'payload_too_large', 'request_failed', 'send_network', 'send_no_response', 'send_stalled',
]);
vi.stubGlobal('useI18n', () => ({
  t: (k: string) => k,
  te: (k: string) => KNOWN_ERROR_CODES.has(k.split('.').pop() ?? ''),
  locale: ref('en'),
}));

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
    // The FULL SessionHistory shape. A partial object here type-errors under `nuxt typecheck`, which
    // covers test files — and it should: a double looser than the real contract is how a test goes
    // green against code that could never receive that shape in production.
    history: vi.fn(async () => ({
      turns: [], provider: 'claude' as const, providerSessionId: 'agent-session-1',
      agentSessionMissing: false,
    })),
    providers: vi.fn(async () => []),
    commands: vi.fn(async () => ({ provider: 'claude' as const, commands: [] })),
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
      // Cast at the boundary. One test below deliberately hands over an adapter that BREAKS its declared
      // contract (resolving `undefined` where `DoctorProposal | null` is promised) to prove the runtime
      // hardening — a violation the type system cannot express by construction, since the type is the
      // very thing being violated.
      ...(proposals ? { proposals: proposals as unknown as ChatProposalsAdapter } : {}),
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

// ⚠️ THIS DOUBLE MUST MIRROR THE PROXIED WIRE, NOT THE API's OWN RESPONSE.
//
// It used to build `{ statusCode: 409, data: { status } }` — the shape NestJS emits and the shape the
// API's e2e asserts. The browser never sees that shape: every call goes through the Nuxt BFF
// (`server/api/[...].ts`), which re-throws with h3's `createError({ data: <upstream body> })`, so the
// upstream body arrives ONE LEVEL DEEPER, at `err.data.data`. The old double was therefore more
// convenient than reality and made a broken `e.data.status` read look correct: `conflict.expired` was
// dead copy in production while these tests were green — the exact "a double that cannot fail the
// property it proves" trap this project keeps hitting.
//
// The real envelope is measured, not assumed: `server/api/proxy.wire.test.ts` drives the actual handler
// over a real socket and pins it. Keep the two in step — if that test's expectations change, so must this.
const conflict = (status: string) =>
  Object.assign(new Error('conflict'), {
    statusCode: 409,
    data: {
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'Conflict',
      data: { message: 'proposal is no longer pending', status },
    },
  });

beforeEach(() => {
  chatStub.state.value = 'idle';
  chatStub.sessionId.value = 'agent-session-1';
  // The queue refs are MODULE-LEVEL shared state (see the leak warning below) — a test that sets
  // `returnedToComposer`/`restoredDraft` and forgets to reset it would leak its notice into every
  // later test's `w.text()` assertion.
  chatStub.queuedMessage.value = null;
  chatStub.returnedToComposer.value = null;
  chatStub.restoredDraft.value = null;
  useAgentChatSpy.mockClear();
  chatStub.enqueueMessage.mockClear();
  chatStub.cancelQueued.mockClear();
  // Reset the two clear-callbacks as well. Without this, a `toHaveBeenCalledTimes(1)` assertion on either
  // one is only correct because its test happens to be the FIRST in the file to trigger that seam —
  // inserting a test above it would silently inflate the count and turn a real assertion vacuous. That is
  // this project's single most repeated failure class; two lines buy immunity from it.
  chatStub.clearReturned.mockClear();
  chatStub.clearRestored.mockClear();
  chatStub.start.mockClear();
  chatStub.resume.mockClear();
});
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

  // The sixteen strings 3.0.0 added to ChatPanelLabels are ALL optional on the Composer's `labels` prop,
  // each with an English `??` fallback — so omitting them is not a compile error and would silently ship
  // untranslated English into this EN/ES app. i18n/chat-labels.completeness.test.ts guards the TRANSLATION
  // strings exist; this guards they actually reach the Composer.
  it('passes every new 3.0.0 label through to the Composer', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    const labels = w.findComponent({ name: 'Composer' }).props('labels') as Record<string, string>;

    for (const key of [
      'systemMessageLabel', 'attachmentsLabel', 'attach', 'removeAttachment',
      'queuedLabel', 'queuedHint', 'queuedCancel', 'queuedEdit',
      'queuedAttachmentsDropped', 'queuedReturned',
    ]) {
      expect(labels[key], `missing label: ${key}`).toBeTruthy();
    }
  });

  it('passes systemMessageLabel into useAgentChat so the system bubble is not named "System" in Spanish', async () => {
    mountChat(undefined);
    await flushPromises();
    // systemLabel is a useAgentChat OPTION, not a Composer prop — it names the author of a host-originated
    // system bubble. Without it the Spanish UI labels the new bubble "System".
    expect(useAgentChatSpy.mock.calls[0][0]).toHaveProperty('systemLabel');
  });

  // `useAgentChat` is mocked wholesale in this file (it returns `chatStub`, whose `start`/`resume` are
  // bare `vi.fn()`s), so the real package never invokes OUR driver. The driver is unit-tested directly by
  // pulling it off the options `useAgentChat` was called with — exactly how the `systemLabel` test below
  // reaches a useAgentChat OPTION that has no Composer-prop equivalent either.
  it('forwards attachments from the Composer through the driver to the API', async () => {
    const sessions = {
      ...makeSessions(),
      create: vi.fn(async () => ({ sessionId: 's1', runId: 'r1', ticket: 't' })),
    };
    // A brand-new conversation (no session yet), so `driver.start` takes the `sessions.create` branch —
    // mirroring the plan's `sessionsAdapter.create` assertion.
    mountChat(undefined, { sessions, sessionId: null, initialProviderSessionId: null });
    await flushPromises();

    const driver = useAgentChatSpy.mock.calls[useAgentChatSpy.mock.calls.length - 1][0].driver;
    const encoded = [{ id: 'a1', filename: 'fern.png', mimeType: 'image/png', data: 'eA==' }];
    // The driver used to read only opts.command and DROP opts.attachments silently.
    await driver.start('claude', 'look at this', { attachments: encoded });

    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'look at this', attachments: encoded }),
      'claude',
    );
  });

  it('enables attachments on the Composer and hands it the caps and a url registry', async () => {
    const w = mountChat(undefined);
    const composer = w.findComponent({ name: 'Composer' });

    expect(composer.props('attachmentsEnabled')).toBe(true);
    expect(composer.props('attachmentCaps')).toMatchObject({ maxCount: 6 });
    expect(composer.props('urlRegistry')).toBeTruthy();
  });
});

// Task 20: turning the package's queue on. `useAgentChat` already queues by default; the gap was OUR OWN
// gate (`canSend = !streaming && …`) and `submit()`'s early return, which meant a mid-run message was
// refused before the queue ever saw it. Spec §5: a mid-run submit QUEUES instead of being refused, and is
// sent automatically when the turn ends CLEANLY — a failed or cancelled turn returns it to the composer,
// intact and editable, with a notice.
describe('the message queue', () => {
  it('QUEUES a mid-run submit instead of refusing it', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    chatStub.state.value = 'streaming';
    await flushPromises();

    await w.findComponent({ name: 'Composer' }).vm.$emit('submit', 'while you think', []);
    await flushPromises();

    expect(chatStub.enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'while you think' }),
    );
    expect(chatStub.start).not.toHaveBeenCalled();
    expect(chatStub.resume).not.toHaveBeenCalled();
  });

  it('renders an auto-sent queued message WITHOUT a refresh — bubble and thumbnails', async () => {
    mountChat(undefined);
    await flushPromises();
    const onQueuedMessageSent = useAgentChatSpy.mock.calls[0][0].onQueuedMessageSent;

    const attachment = { id: 'a1', filename: 'x.png', mimeType: 'image/png', blob: new Blob(['x']) };
    onQueuedMessageSent({ text: 'queued one', attachments: [attachment] });

    // A send-only assertion passes straight through the failure: the handler must MINT the transcript's
    // object urls as well as push the bubble, or the message appears only after a refresh.
    expect(chatStub.pushUserPrompt).toHaveBeenCalledWith(
      'queued one',
      expect.anything(),
      expect.objectContaining({ attachments: [expect.objectContaining({ previewUrl: expect.any(String) })] }),
    );
  });

  // Ruling 1: the test i18n stub is an IDENTITY function (`t: (k) => k`), so `tns('composer.queuedReturned')`
  // renders the literal namespaced key, never the English prose. Asserting the KEY still genuinely fails
  // when the notice is not rendered at all — which is the property this test exists to prove.
  //
  // This is the REGRESSION test for the silent-loss defect: a returned queued message used to render this
  // exact notice while the payload itself was thrown away (never merged into `draft`/`attachments`, never
  // in localStorage, never sent — just gone). So this test asserts the WHOLE contract, not just the notice:
  // the text and attachments must actually land back in the composer, `clearReturned()` must be called, and
  // — the part a naive fix gets wrong — the notice must SURVIVE that clear rather than flashing and vanishing
  // (a template gated directly on `chat.returnedToComposer.value` goes null the instant `clearReturned()`
  // runs, so this is the one assertion that catches "moved the merge in but left the template as-is").
  it('merges a returned queued message into the draft and attachments, and the notice survives the clear', async () => {
    const w = mountChat(undefined);
    await flushPromises();

    const attachment = { id: 'r1', filename: 'r.png', mimeType: 'image/png', blob: new Blob(['r']) };
    chatStub.returnedToComposer.value = { text: 'came back', attachments: [attachment] };
    await nextTick();

    const composer = w.findComponent({ name: 'Composer' });
    expect(composer.props('modelValue')).toBe('came back');
    expect(composer.props('attachments')).toEqual([attachment]);
    expect(chatStub.clearReturned).toHaveBeenCalledTimes(1);

    // clearReturned() already ran (the watcher calls it synchronously after merging) — a package ref that
    // is now null must not be what the notice depends on.
    chatStub.returnedToComposer.value = null;
    await nextTick();
    expect(w.text()).toContain('composer.queuedReturned');

    const note = w.findAll('.mp-kchat__note').find((n) => n.text().includes('composer.queuedReturned'));
    expect(note).toBeTruthy();
    await note!.find('button').trigger('click');
    await nextTick();
    expect(w.text()).not.toContain('composer.queuedReturned');
  });

  // The merge rule is NOT "replace the composer" — `mergeIntoComposer` (the real package function, per the
  // `importOriginal` mock above) PREPENDS the returned text ahead of whatever the owner already typed,
  // separated by a blank line. A test built on a hand-written stub of this rule would not catch a host that
  // merely overwrote the draft, which is exactly the pre-fix behaviour for `onEditQueued` below.
  it('merges rather than overwrites: existing draft text is preserved with the returned text prepended', async () => {
    const w = mountChat(undefined);
    await flushPromises();

    await w.findComponent({ name: 'Composer' }).vm.$emit('update:modelValue', 'still typing');
    await nextTick();

    chatStub.returnedToComposer.value = { text: 'came back', attachments: [] };
    await nextTick();

    expect(w.findComponent({ name: 'Composer' }).props('modelValue')).toBe('came back\n\nstill typing');
  });

  it('a restored draft lands in the composer and clearRestored is called', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    chatStub.restoredDraft.value = { text: 'restored', attachmentsDropped: true };
    await nextTick();

    expect(w.findComponent({ name: 'Composer' }).props('modelValue')).toBe('restored');
    expect(chatStub.clearRestored).toHaveBeenCalledTimes(1);
    // Persistence is text-only, so a restored message has lost its attachments and must SAY SO — this
    // asserts the notice is DISPLAYED, not merely present in the catalogue.
    expect(w.text()).toContain('composer.queuedAttachmentsDropped');
  });

  // The notice must NOT render for a restored draft that carried no attachments to begin with — otherwise
  // every page reload of a plain-text draft would falsely warn about lost images.
  it('does not surface the dropped-attachments notice when nothing was dropped', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    chatStub.restoredDraft.value = { text: 'restored', attachmentsDropped: false };
    await nextTick();

    expect(w.text()).not.toContain('composer.queuedAttachmentsDropped');
  });

  it('passes the queue state through to the Composer', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    chatStub.queuedMessage.value = { text: 'queued text', attachments: [{} as never, {} as never] };
    await nextTick();

    const composer = w.findComponent({ name: 'Composer' });
    expect(composer.props('queuedText')).toBe('queued text');
    expect(composer.props('queuedAttachmentCount')).toBe(2);
    expect(composer.props('queueingEnabled')).toBe(true);
  });

  it('cancelling the queued message calls cancelQueued', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    await w.findComponent({ name: 'Composer' }).vm.$emit('cancel-queued');
    expect(chatStub.cancelQueued).toHaveBeenCalledTimes(1);
  });

  // Editing the queued message must not just clear it — the text and attachments must come BACK into the
  // composer, or "edit" is indistinguishable from "cancel".
  it('editing the queued message returns its text and attachments to the composer draft', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    const queuedAttachment = { id: 'q1', filename: 'q.png', mimeType: 'image/png', blob: new Blob(['q']) };
    chatStub.cancelQueued.mockReturnValueOnce({ text: 'edit me', attachments: [queuedAttachment] });

    await w.findComponent({ name: 'Composer' }).vm.$emit('edit-queued');
    await nextTick();

    const composer = w.findComponent({ name: 'Composer' });
    expect(composer.props('modelValue')).toBe('edit me');
    expect(composer.props('attachments')).toEqual([queuedAttachment]);
  });

  // `onEditQueued` used to OVERWRITE `draft`/`attachments` with the cancelled queued payload — so anything
  // the owner had typed since queuing it was silently destroyed. It must go through the same merge as the
  // other two paths (prepend, union attachments by id), and — per the reference implementation it mirrors —
  // it shows NO notice: the owner explicitly asked for the message back, so there is nothing to announce.
  it('editing the queued message MERGES into an already-non-empty draft instead of overwriting it, and shows no notice', async () => {
    const w = mountChat(undefined);
    await flushPromises();

    await w.findComponent({ name: 'Composer' }).vm.$emit('update:modelValue', 'still typing');
    await nextTick();

    const queuedAttachment = { id: 'q1', filename: 'q.png', mimeType: 'image/png', blob: new Blob(['q']) };
    chatStub.cancelQueued.mockReturnValueOnce({ text: 'edit me', attachments: [queuedAttachment] });

    await w.findComponent({ name: 'Composer' }).vm.$emit('edit-queued');
    await nextTick();

    const composer = w.findComponent({ name: 'Composer' });
    expect(composer.props('modelValue')).toBe('edit me\n\nstill typing');
    expect(composer.props('attachments')).toEqual([queuedAttachment]);
    expect(w.text()).not.toContain('composer.queuedReturned');
    expect(w.text()).not.toContain('composer.queuedAttachmentsDropped');
  });

  // `translateSendError` (AgentChat.vue, local — Ruling 2) must never let a raw snake_case code reach the
  // owner. This fixture carries NEITHER a `code` NOR a status any tier recognises (500, no `data`), so it
  // must fall all the way through to tier 3 — the generic message.
  it('falls back to the generic error and never renders a raw code for a wholly unrecognised send failure', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    chatStub.resume.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));

    await w.findComponent({ name: 'Composer' }).vm.$emit('submit', 'hello', []);
    await flushPromises();

    expect(w.findComponent({ name: 'Composer' }).props('error')).toBe('diagnose.composer.genericError');
  });

  // The positive case: a RECOGNISED code (one of the thirteen at `<namespace>.composer.errors.<code>`)
  // resolves to ITS OWN key, never the generic fallback — proving the lookup is real, not always-generic.
  it('resolves a recognised send-failure code to its own translated key', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    chatStub.resume.mockRejectedValueOnce(
      Object.assign(new Error('too large'), { statusCode: 413, data: { code: 'attachment_too_large' } }),
    );

    await w.findComponent({ name: 'Composer' }).vm.$emit('submit', 'hello', []);
    await flushPromises();

    expect(w.findComponent({ name: 'Composer' }).props('error'))
      .toBe('diagnose.composer.errors.attachment_too_large');
  });

  // TIER 2: a genuine 409 "run already in progress" race carries NO `code` field at all (Nest's default
  // `ConflictException` body is `{statusCode, message, error}`) — but the STATUS alone is more specific
  // than the generic message, and the project's own rule (spec §7) is that a generic fallback is only
  // correct once nothing more specific is known. 422/400 without a `code` gets the same treatment
  // (`sendRejected`), proven by the second assertion so both surviving status branches are pinned, not
  // just one of them.
  it('resolves a codeless 409 to "run in progress" and a codeless 422 to "send rejected" — tier 2', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    chatStub.resume.mockRejectedValueOnce(Object.assign(new Error('conflict'), { statusCode: 409 }));

    await w.findComponent({ name: 'Composer' }).vm.$emit('submit', 'hello', []);
    await flushPromises();
    expect(w.findComponent({ name: 'Composer' }).props('error')).toBe('diagnose.runInProgress');

    chatStub.resume.mockRejectedValueOnce(Object.assign(new Error('unprocessable'), { statusCode: 422 }));
    await w.findComponent({ name: 'Composer' }).vm.$emit('submit', 'hello again', []);
    await flushPromises();
    expect(w.findComponent({ name: 'Composer' }).props('error')).toBe('diagnose.sendRejected');
  });

  // A failed send must leave the images ATTACHED AND RETRYABLE — clearing them unconditionally would make
  // the owner re-find and re-attach every one of them after doing nothing wrong (Task 18 exists because a
  // large attachment send CAN fail: a stalled socket, a 413, a dead connection). Only the QUEUE branch
  // clears unconditionally, because there the message really did move into the queue.
  it('keeps the attachments in the composer when a non-queued send fails', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    const attachment = { id: 'a1', filename: 'x.png', mimeType: 'image/png', blob: new Blob(['x']) };
    chatStub.resume.mockRejectedValueOnce(new Error('offline'));

    // Mirror the real Composer: it keeps its OWN attachment state synced up through `v-model:attachments`
    // (`update:attachments`) as the user attaches files, and passes that same state as `submit`'s second
    // argument — so the ref this test must find non-empty AFTER the failure is the v-model ref, not the
    // `submit()` call's own local parameter (which the earlier "forwards attachments…" tests already cover).
    const composer = w.findComponent({ name: 'Composer' });
    await composer.vm.$emit('update:attachments', [attachment]);
    await nextTick();
    await composer.vm.$emit('submit', 'hello', [attachment]);
    await flushPromises();

    expect(w.findComponent({ name: 'Composer' }).props('attachments')).toEqual([attachment]);
  });

  // The seam Task 19's own test never exercised: Task 19 pulls `driver` off the `useAgentChat` spy and calls
  // `driver.start(...)` directly, so nothing in the suite ever drove attachments through the REAL path — a
  // Composer `submit` event, through `submit()`, onto `chat.start`/`chat.resume`. That is exactly where an
  // attachment could be silently dropped between the click and the wire.
  it('forwards attachments from a Composer submit into chat.start for a brand-new conversation', async () => {
    // `chat.sessionId` (the AGENT session id `submit()` branches on) is chatStub-level, not the component's
    // own `currentSessionId` — it defaults to a truthy value module-wide, so the "start" branch needs it
    // explicitly nulled for this one test (restored in the outer beforeEach for every other test).
    chatStub.sessionId.value = null;
    const w = mountChat(undefined);
    await flushPromises();
    const attachment = { id: 'a1', filename: 'x.png', mimeType: 'image/png', blob: new Blob(['x']) };

    await w.findComponent({ name: 'Composer' }).vm.$emit('submit', 'look at this', [attachment]);
    await flushPromises();

    expect(chatStub.start).toHaveBeenCalledWith(
      'look at this',
      expect.objectContaining({ attachments: [attachment] }),
    );
  });

  it('forwards attachments from a Composer submit into chat.resume for an existing conversation', async () => {
    const w = mountChat(undefined); // default chatStub.sessionId.value === 'agent-session-1' (truthy)
    await flushPromises();
    const attachment = { id: 'a2', filename: 'y.png', mimeType: 'image/png', blob: new Blob(['y']) };

    await w.findComponent({ name: 'Composer' }).vm.$emit('submit', 'and this', [attachment]);
    await flushPromises();

    expect(chatStub.resume).toHaveBeenCalledWith(
      'agent-session-1',
      'and this',
      expect.objectContaining({ attachments: [attachment] }),
    );
  });
});

// Task 21: the workspace shell owns conversation SELECTION but cannot reach this component's chat instance
// (`chat`, the useAgentChat() return value) directly — so it must be exposed. This is the seam
// AgentChatWorkspace.test.ts's stub fakes; here we prove the REAL exposed method actually does both halves
// of its job: forwards to the package's own abandonConversation() so the queued-message TTL entry is
// cleared, AND releases every object url this component minted — because a standalone Composer (unlike
// ChatPanel) owns its urlRegistry itself, so nothing else will ever release them on a conversation switch.
describe('AgentChat — defineExpose(abandonConversation) (Task 21)', () => {
  it('calls chat.abandonConversation() AND urlRegistry.releaseAll(), and returns the abandoned payload', async () => {
    const w = mountChat(undefined);
    await flushPromises();
    const abandoned = { text: 'draft in progress', attachments: [] };
    chatStub.abandonConversation.mockReturnValueOnce(abandoned);
    urlRegistryStub.releaseAll.mockClear();

    const result = (w.vm as unknown as { abandonConversation: () => unknown }).abandonConversation();

    expect(chatStub.abandonConversation).toHaveBeenCalledTimes(1);
    expect(urlRegistryStub.releaseAll).toHaveBeenCalledTimes(1);
    expect(result).toEqual(abandoned);
  });
});
