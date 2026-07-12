<script setup lang="ts">
import {
  AgentSelector, Console, Composer, RunFailureNotice, ThemeSelector, useAgentChat, useTheme,
  type ChatDriver,
} from '@retaxmaster/agents-realtime-client/vue';
import type { AgentProvider, AgentProviderStatus } from '@retaxmaster/agents-realtime-protocol';
import type { KnowledgeChatProvider, KnowledgeChatTurn } from '../types/api';

const props = defineProps<{
  // Our internal cuid session id; null for a brand-new chat not yet created.
  sessionId: string | null;
  // The agent this conversation belongs to, and ITS session id (Claude UUID / Codex thread id). The agent
  // session id is what proves a real agent session exists — and therefore what LOCKS the agent.
  initialProvider: KnowledgeChatProvider | null;
  initialProviderSessionId: string | null;
  initialTurns: KnowledgeChatTurn[];
}>();

const emit = defineEmits<{
  // Fires once a brand-new session's first run is created (page selects it + refreshes the list).
  (e: 'created', sessionId: string): void;
  // Fires on any run start/terminal so the page can refresh session statuses.
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const sessions = useKnowledgeChatSessions();
const runs = useKnowledgeChatRuns();
const socketUrl = useRuntimeConfig().public.knowledgeChatSocketUrl;

// Every user-facing string the package renders is INJECTED — it ships English defaults and no product
// copy. ONE merged set feeds the Console, the Composer, the AgentSelector and the failure notice, so a
// live locale switch re-translates all of them (hence a computed).
const chatLabels = computed(() => ({
  promptLabel: t('knowledgeEngine.composer.promptLabel'),
  promptPlaceholder: t('knowledgeEngine.composer.promptPlaceholder'),
  send: t('knowledgeEngine.composer.send'),
  stop: t('knowledgeEngine.composer.stop'),
  running: t('knowledgeEngine.composer.running'),
  stopping: t('knowledgeEngine.composer.stopping'),
  enterToSend: t('knowledgeEngine.composer.enterToSend'),
  shiftEnterNewline: t('knowledgeEngine.composer.shiftEnterNewline'),
  genericError: t('knowledgeEngine.composer.genericError'),
  connected: t('knowledgeEngine.composer.connected'),
  reconnecting: t('knowledgeEngine.composer.reconnecting'),
  disconnected: t('knowledgeEngine.composer.disconnected'),
  you: t('knowledgeEngine.you'),
  // Console chrome. In 0.x these were UNREACHABLE: Console read its labels from a private injection whose
  // Symbol was not exported, so the transcript's own affordances leaked English. 1.0.0 gives Console a
  // `labels` prop, so that leak is closed here.
  jumpToLatest: t('knowledgeEngine.console.jumpToLatest'),
  thinking: t('knowledgeEngine.console.thinking'),
  expandText: t('knowledgeEngine.console.expandText'),
  collapse: t('knowledgeEngine.console.collapse'),
  seeAll: t('knowledgeEngine.console.seeAll'),
  copy: t('knowledgeEngine.console.copy'),
  copied: t('knowledgeEngine.console.copied'),
  // Failure + retry.
  overloaded: t('knowledgeEngine.composer.overloaded'),
  retrying: t('knowledgeEngine.composer.retrying'),
  retry: t('knowledgeEngine.composer.retry'),
  runFailed: t('knowledgeEngine.runFailed'),
  // The agent picker's own chrome.
  selectProvider: t('knowledgeEngine.agent.select'),
  notInstalled: t('knowledgeEngine.agent.notInstalled'),
  notAuthenticated: t('knowledgeEngine.agent.notAuthenticated'),
  authCta: t('knowledgeEngine.agent.authCta'),
  providerLockedLabel: t('knowledgeEngine.agent.locked'),
  noProviderAvailable: t('knowledgeEngine.agent.noneAvailable'),
}));

// Display names for the picker (the package falls back to the bare protocol id, e.g. "codex").
const providerLabels: Partial<Record<AgentProvider, string>> = { claude: 'Claude', codex: 'Codex' };

// Chat theming. The package paints ALL its color from a namespaced --crt-* custom-property set that a
// "theme" maps over; style.css only ships structure. We render our OWN shell (Console + Composer, not the
// package's ChatPanel), so we must apply a theme ourselves or every --crt-* resolves to nothing and the
// chat renders unstyled. useTheme writes the tokens onto themeRoot, follows the OS light/dark while on
// `auto`, and persists the user's pick.
const themeRoot = ref<HTMLElement | null>(null);
const { theme, setTheme } = useTheme({
  target: themeRoot,
  defaultTheme: 'auto',
  persist: true,
  storageKey: 'crt-theme-knowledge',
});

const currentSessionId = ref<string | null>(props.sessionId);
const draft = ref('');
const error = ref<string | null>(null);
const providers = ref<AgentProviderStatus[]>([]);
// True when the DB says this conversation HAS settled turns but the engine could restore none of them.
// It is not an error and not an empty chat — it is a transcript we can no longer read. See restore().
const transcriptUnavailable = ref(false);
// Stronger, and reported by the API: the AGENT no longer holds this conversation's session. It is not just
// unreadable, it is UN-CONTINUABLE — a resume would hand the agent a session id it rejects. We know this for
// a fact, so we say it and stop the send, rather than inviting a message that is guaranteed to fail.
const agentSessionMissing = ref(false);

// The host seams the chat client drives. Both calls NAME THE AGENT, because our /execute does: the engine
// spawns a provider-neutral runner and cannot guess which CLI to drive.
const driver: ChatDriver = {
  async start(provider, prompt) {
    // An EXISTING conversation can land here: one whose opening turn never got an agent off the ground
    // (signed out, missing binary, refused at the availability gate) has no agent session, so the client
    // treats the next send as a fresh start. That must RETRY that conversation's opening turn — possibly
    // on a different agent — not silently create a second conversation and orphan the first.
    if (currentSessionId.value) {
      const res = await sessions.resume(currentSessionId.value, prompt, provider as KnowledgeChatProvider);
      emit('changed');
      return { runId: res.runId };
    }
    const res = await sessions.create(prompt, provider as KnowledgeChatProvider);
    currentSessionId.value = res.sessionId;
    emit('created', res.sessionId);
    emit('changed');
    return { runId: res.runId };
  },
  async resume(_provider, _providerSessionId, prompt) {
    // The agent and its session id are the CONVERSATION's, not the caller's — the API reads both off the
    // session row, so a resume can never be pointed at another agent's memory.
    if (!currentSessionId.value) throw new Error('Cannot resume without a session');
    const res = await sessions.resume(currentSessionId.value, prompt);
    emit('changed');
    return { runId: res.runId };
  },
};

const chat = useAgentChat({
  socketUrl,
  fetchTicket: (runId) => runs.mintSocketTicket(runId),
  driver,
  initialProvider: props.initialProvider ?? undefined,
  rateLimitNotice: t('knowledgeEngine.rateLimitReached'),
  userLabel: t('knowledgeEngine.you'),
});

// Everything the package renders, we render. The engine (2.0.0) no longer confuses Claude's benign quota
// telemetry with an alarm: `quota.updated` is a SNAPSHOT that lands on the turn's meta line, and the
// `rate_limit` notice now fires ONLY on the rise into `exhausted`. Filtering it — which we used to do —
// would now hide the one notice that means something.
const entries = computed(() => chat.entries.value);
const streaming = computed(() =>
  ['connecting', 'streaming', 'reconnecting'].includes(chat.state.value),
);

// A conversation whose opening turn never established an agent session is NOT a dead end. It has no agent
// memory behind it, so there is nothing for a second agent to contradict: the next send simply RETRIES
// that opening turn, and the agent picker stays unlocked so the user can retry on the OTHER agent. (This
// is the package's own lock rule: commit the agent on proof of a real session, never on the mere attempt —
// otherwise a signed-out agent traps the conversation on itself forever, with deletion the only escape.)
// It used to render a "this can't be continued" note; that note was the trap.
const needsFirstTurnRetry = computed(
  () =>
    props.initialTurns.length > 0 &&
    currentSessionId.value !== null &&
    props.initialProviderSessionId === null &&
    // …and it has not been retried successfully yet. `chat.sessionId` is set the moment a run establishes an
    // agent session, so the note disappears exactly when it stops being true — instead of lingering under a
    // fresh, working transcript.
    chat.sessionId.value === null,
);
const noProviderAvailable = computed(
  () => providers.value.length > 0 && !providers.value.some((p) => p.available),
);
const canSend = computed(() => !streaming.value && !noProviderAvailable.value && !agentSessionMissing.value);

async function loadProviders(force = false) {
  try {
    providers.value = await sessions.providers(force);
    // Keep a FREE conversation on an agent the engine would actually run: an unavailable selection moves
    // to the first available one, so a send cannot die at the engine's gate. A LOCKED conversation is left
    // alone — its agent owns its memory, and no other agent can read it.
    chat.applyAvailability(providers.value);
  } catch {
    /* the picker simply renders nothing selectable; the composer's notice explains it */
  }
}

// The signed-out agent's "sign in" call-to-action. The package never runs an auth flow itself — it only
// reports that the user asked. We cannot sign an agent in from the browser (it is a CLI on the server), so
// we say where to do it and offer a re-probe for when they have.
const authNotice = ref<string | null>(null);
function onAuthRequest(provider: AgentProvider) {
  authNotice.value = t('knowledgeEngine.agent.authHint', { agent: providerLabels[provider] ?? provider });
}
async function recheckProviders() {
  authNotice.value = null;
  await loadProviders(true); // force: bypass the ~30s probe cache — they just signed in
}

async function submit() {
  const text = draft.value.trim();
  if (!text || !canSend.value) return;
  error.value = null;
  chat.pushUserPrompt(text, t('knowledgeEngine.you'));
  draft.value = '';
  try {
    // The agent session id IS the conversation's memory: present → continue it; absent → this is a
    // brand-new conversation and the driver creates it.
    if (chat.sessionId.value) await chat.resume(chat.sessionId.value, text);
    else await chat.start(text);
  } catch (e: unknown) {
    const status = (e as { statusCode?: number; response?: { status?: number } })?.statusCode
      ?? (e as { response?: { status?: number } })?.response?.status;
    error.value = status === 409
      ? t('knowledgeEngine.runInProgress')
      : status === 422 || status === 400
        ? t('knowledgeEngine.sendRejected')
        : t('knowledgeEngine.sendError');
  }
}

// Rebuild the conversation from the engine's CANONICAL history (the same AgentEvents a live turn
// produces), so a reopened chat keeps its rich tool cards and diffs instead of degrading to plain text.
//
// We no longer fetch and parse the raw NDJSON log: since agents-realtime 1.0.0 that log also carries
// out-of-band lines (header, identity, internal events) that must be filtered exactly the way the socket
// filters them — re-deriving that rule in the browser would fork engine logic into the frontend.
// seedHistory also PRIMES the agent session id and LOCKS the conversation to its agent.
async function restore() {
  if (!props.sessionId || !props.initialProviderSessionId) return;
  // seedHistory is what primes the agent session id AND locks the conversation to its agent. It must run
  // even when the transcript comes back EMPTY (an old run, a purged agent transcript): the conversation
  // still belongs to that agent and is still resumable, and leaving the picker unlocked would offer to
  // switch it to an agent that cannot read a word of its memory.
  try {
    const history = await sessions.history(props.sessionId);
    chat.seedHistory(history);
    // A conversation predating agents-realtime 1.0.0 cannot be restored: its run logs are in the old raw
    // format the current engine does not read, and the agent may have purged its own copy of the session
    // by now. That is an unavoidable consequence of the breaking change — but a SILENT empty console would
    // be a lie by omission, so we say so. Compared against the TERMINAL turns only: the one still-running
    // turn is deliberately absent from history (the socket streams it), so its absence is not a loss.
    const settledTurns = props.initialTurns.filter((turn) => !turn.isActive).length;
    transcriptUnavailable.value = settledTurns > 0 && history.turns.length === 0;
    agentSessionMissing.value = history.agentSessionMissing === true;
  } catch {
    /* the API already degrades an unreadable transcript to an empty one; a hard failure just renders empty */
  }
}

// A run still in flight when the page (re)loads: re-attach the live stream to it. The engine replays that
// run's log from the start, so nothing streamed while we were away is lost. Its prompt needs a user bubble
// first — the seeded history holds only TERMINAL turns, by design, so this turn is not in it.
function attachActiveRun() {
  const active = props.initialTurns.find((turn) => turn.isActive);
  if (!active) return;
  chat.pushUserPrompt(active.prompt, t('knowledgeEngine.you'));
  chat.connect(String(active.runId)); // runId MUST be a string — the server authorizes STOP by strict ===
}

// A run just went terminal → the session list's status chip is stale. (Covers success, failure and
// cancellation alike.)
watch(streaming, (isStreaming, was) => {
  if (was && !isStreaming) emit('changed');
});

onMounted(async () => {
  await Promise.all([loadProviders(), restore()]);
  attachActiveRun();
});
onBeforeUnmount(() => chat.close());
</script>

<template>
  <div ref="themeRoot" class="mp-kchat">
    <div class="mp-kchat__toolbar">
      <AgentSelector
        :providers="providers"
        :selected="chat.selectedProvider.value"
        :locked="chat.providerLocked.value"
        :busy="chat.providerBusy.value"
        :provider-labels="providerLabels"
        :labels="chatLabels"
        @select="chat.setProvider"
        @auth-request="onAuthRequest"
      />
      <ThemeSelector :model-value="theme" :labels="chatLabels" @update:model-value="setTheme" />
    </div>

    <p v-if="authNotice" class="mp-kchat__note">
      {{ authNotice }}
      <button type="button" class="mp-kchat__recheck" @click="recheckProviders">
        {{ $t('knowledgeEngine.agent.recheck') }}
      </button>
    </p>

    <Console
      :entries="entries"
      :agent-label="$t('knowledgeEngine.agentLabel')"
      :labels="chatLabels"
      :busy="streaming"
    />

    <!-- The package's own failure surface, REUSED rather than re-implemented: it already knows which
         failures are retryable, and keeps `rate_limited` bounded so an hours-away reset cannot spin the
         UI or strand it. -->
    <RunFailureNotice
      :failure="chat.failure.value"
      :retrying="chat.retrying.value"
      :labels="chatLabels"
      @retry="chat.retry()"
    />

    <p v-if="agentSessionMissing" class="mp-kchat__note">
      {{ $t('knowledgeEngine.agentSessionMissing') }}
    </p>
    <p v-else-if="transcriptUnavailable" class="mp-kchat__note">
      {{ $t('knowledgeEngine.transcriptUnavailable') }}
    </p>

    <p v-if="needsFirstTurnRetry" class="mp-kchat__note">
      {{ $t('knowledgeEngine.firstTurnFailed') }}
    </p>

    <Composer
      v-model="draft"
      :running="streaming"
      :can-send="canSend"
      :disabled="noProviderAvailable"
      :error="noProviderAvailable ? chatLabels.noProviderAvailable : (error ?? undefined)"
      :labels="chatLabels"
      @submit="submit"
      @stop="chat.stop()"
    />
  </div>
</template>

<style scoped>
.mp-kchat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  /* min-width: 0 lets the transcript Console shrink and scroll internally instead of forcing the
     column wider than the viewport (mobile horizontal overflow). */
  min-width: 0;
  width: 100%;
  /* Fill the parent card. flex:1 makes us take the card body's height; --crt-height:100% lets the
     package console grow to fill the column (its default is a fixed 60vh, which floated inside the
     taller card). The console still scrolls internally thanks to the min-height:0 chain below. */
  flex: 1 1 auto;
  height: 100%;
  --crt-height: 100%;
}
.mp-kchat__toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: none;
}
/* Let the embedded console take the remaining height and scroll internally. */
.mp-kchat :deep(.crt-console-wrap) {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}
.mp-kchat :deep(.crt-console) {
  height: 100%;
  min-height: 0;
}
.mp-kchat__note {
  flex: none;
  font: 13px var(--font-sans);
  color: var(--care-caution-text);
}
.mp-kchat__recheck {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--brand-600);
  text-decoration: underline;
  cursor: pointer;
}
</style>
