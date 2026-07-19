<script setup lang="ts">
import {
  AgentSelector, Console, Composer, RunFailureNotice, ThemeSelector, useAgentChat, useTheme,
  type ChatDriver,
} from '@retaxmaster/agents-realtime-client/vue';
// The transcript's label set is a CORE type (the Vue layer only re-exports the components), and it is the
// contract the `labels` thunk must satisfy in full.
import type { TranscriptLabels } from '@retaxmaster/agents-realtime-client';
import { parseCommandInput } from '@retaxmaster/agents-realtime-protocol';
import type { AgentProvider, AgentProviderStatus, CommandDescriptor } from '@retaxmaster/agents-realtime-protocol';
import type {
  ChatProposalsAdapter, ChatRunsAdapter, ChatSessionsAdapter, DoctorProposal,
  DoctorProposalConflictStatus, KnowledgeChatProvider, KnowledgeChatTurn,
} from '../types/api';
// Explicit, not via Nuxt's `utils/` auto-import: this component is mounted under plain Vitest (no Nuxt
// module graph), so an auto-imported helper would be `undefined` at runtime in exactly the tests that
// exercise the conflict path.
import { upstreamErrorCode, upstreamErrorStatus } from '../utils/upstreamError.js';

const props = defineProps<{
  // Our internal cuid session id; null for a brand-new chat not yet created.
  sessionId: string | null;
  // The agent this conversation belongs to, and ITS session id (Claude UUID / Codex thread id). The agent
  // session id is what proves a real agent session exists — and therefore what LOCKS the agent.
  initialProvider: KnowledgeChatProvider | null;
  initialProviderSessionId: string | null;
  initialTurns: KnowledgeChatTurn[];
  // --- Injected scope (fork-prevention: one component, per-consumer dependencies) ---
  // The sessions source (KE pool or a plant-scoped doctor); shaped by ChatSessionsAdapter.
  sessions: ChatSessionsAdapter;
  // The runs source (mints the socket ticket for this consumer's routes).
  runs: ChatRunsAdapter;
  // The engine's Socket.IO URL for THIS consumer (KE engine vs doctor engine).
  socketUrl: string;
  // The i18n namespace whose subtree carries this consumer's copy ('knowledgeEngine' | 'diagnose'). Every
  // string is resolved as `${i18nNamespace}.<suffix>`, so both namespaces expose the same leaf-key shape.
  i18nNamespace: string;
  // A per-consumer theme storage key so the two chats don't fight over one persisted preference.
  themeStorageKey?: string;
  // The doctor's write-proposal source. OPTIONAL: the Knowledge Engine injects nothing and therefore has
  // no approval surface at all — not a hidden one, an absent one. Injected scope, one component (the same
  // fork-prevention shape as `sessions` and `runs` above).
  proposals?: ChatProposalsAdapter;
}>();

const emit = defineEmits<{
  // Fires once a brand-new session's first run is created (page selects it + refreshes the list).
  (e: 'created', sessionId: string): void;
  // Fires on any run start/terminal so the page can refresh session statuses.
  (e: 'changed'): void;
}>();

const { t, locale } = useI18n();
const sessions = props.sessions;
const runs = props.runs;
const socketUrl = props.socketUrl;
// Namespaced translate: resolves this consumer's copy. Use everywhere a bare knowledgeEngine.* key was read.
const tns = (key: string, named?: Record<string, unknown>) => t(`${props.i18nNamespace}.${key}`, named ?? {});

// Every user-facing string the package renders is INJECTED — it ships English defaults and no product
// copy. ONE merged set feeds the Console, the Composer, the AgentSelector and the failure notice, so a
// live locale switch re-translates all of them (hence a computed).
const chatLabels = computed(() => ({
  promptLabel: tns('composer.promptLabel'),
  promptPlaceholder: tns('composer.promptPlaceholder'),
  send: tns('composer.send'),
  stop: tns('composer.stop'),
  running: tns('composer.running'),
  stopping: tns('composer.stopping'),
  enterToSend: tns('composer.enterToSend'),
  shiftEnterNewline: tns('composer.shiftEnterNewline'),
  genericError: tns('composer.genericError'),
  connected: tns('composer.connected'),
  reconnecting: tns('composer.reconnecting'),
  disconnected: tns('composer.disconnected'),
  you: tns('you'),
  // Console chrome. In 0.x these were UNREACHABLE: Console read its labels from a private injection whose
  // Symbol was not exported, so the transcript's own affordances leaked English. 1.0.0 gives Console a
  // `labels` prop, so that leak is closed here.
  jumpToLatest: tns('console.jumpToLatest'),
  thinking: tns('console.thinking'),
  expandText: tns('console.expandText'),
  collapse: tns('console.collapse'),
  seeAll: tns('console.seeAll'),
  copy: tns('console.copy'),
  copied: tns('console.copied'),
  // Failure + retry.
  overloaded: tns('composer.overloaded'),
  retrying: tns('composer.retrying'),
  retry: tns('composer.retry'),
  runFailed: tns('runFailed'),
  // The agent picker's own chrome.
  selectProvider: tns('agent.select'),
  notInstalled: tns('agent.notInstalled'),
  notAuthenticated: tns('agent.notAuthenticated'),
  authCta: tns('agent.authCta'),
  providerLockedLabel: tns('agent.locked'),
  noProviderAvailable: tns('agent.noneAvailable'),
  // Transcript chrome (the scroll region is keyboard-focusable in 2.0.0 and needs an accessible name).
  transcriptLabel: tns('console.transcriptLabel'),
  // Quota. `quota.updated` is a SNAPSHOT on the turn's meta line — "· cuota 84% · se renueva 18:40" — and it
  // is NOT an alarm. The alarm is a separate notice, and it now fires only when the quota is truly exhausted.
  quotaUsage: tns('console.quotaUsage'),
  quotaResets: tns('console.quotaResets'),
  // The close line. The WORDS are strings; anything shaped by a NUMBER is a function, because the package
  // cannot guess a plural rule (English has 2 forms, Polish 3, Japanese 1) — so it hands us the count and
  // renders what we return. Note the default changed: a one-turn run used to render the wrong "1 turns".
  runDone: tns('console.runDone'),
  tokens: tns('console.tokens'),
  formatTurns: (n: number) =>
    n === 1 ? tns('console.turnOne') : tns('console.turnOther', { n }),
  formatDuration: (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}min`),
  // Claude publishes a price; Codex publishes NO price anywhere in its protocol, so that field is simply
  // absent on a Codex run and the package renders nothing. We never substitute a zero — "$0.0000" would tell
  // the user the run was free.
  formatCost: (usd: number) => `$${usd.toFixed(4)}`,
  // Commands.
  commandLead: tns('command.lead'),
  commandSucceeded: tns('command.succeeded'),
  commandFailed: tns('command.failed'),
  commandRefused: tns('command.refused'),
  commandsGroupLabel: tns('command.groupLabel'),
  commandUnsupported: tns('command.unsupported'),
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
  storageKey: props.themeStorageKey ?? 'crt-theme-agent',
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
  async start(provider, prompt, opts) {
    // A command cannot OPEN a conversation: its title comes from the first prompt, and there is no agent
    // session for it to act on. `submit()` blocks it before it can get here; this is the structural backstop.
    if (opts?.command) throw new Error('A command cannot start a conversation');
    // An EXISTING conversation can land here: one whose opening turn never got an agent off the ground
    // (signed out, missing binary, refused at the availability gate) has no agent session, so the client
    // treats the next send as a fresh start. That must RETRY that conversation's opening turn — possibly
    // on a different agent — not silently create a second conversation and orphan the first.
    if (currentSessionId.value) {
      const res = await sessions.resume(currentSessionId.value, { prompt }, provider as KnowledgeChatProvider);
      emit('changed');
      return { runId: res.runId };
    }
    const res = await sessions.create(prompt, provider as KnowledgeChatProvider);
    currentSessionId.value = res.sessionId;
    emit('created', res.sessionId);
    emit('changed');
    return { runId: res.runId };
  },
  async resume(_provider, _providerSessionId, prompt, opts) {
    // The agent and its session id are the CONVERSATION's, not the caller's — the API reads both off the
    // session row, so a resume can never be pointed at another agent's memory.
    if (!currentSessionId.value) throw new Error('Cannot resume without a session');
    // The command travels in its OWN field, exactly as it arrived. We never rebuild it into text.
    const res = await sessions.resume(
      currentSessionId.value,
      opts?.command ? { command: opts.command } : { prompt },
    );
    emit('changed');
    return { runId: res.runId };
  },
};

// The run-close line, the quota line, the rate-limit notice and command-result text are BAKED into each
// entry's `text` the moment useAgentChat processes an AgentEvent — they are NOT read from the `labels` prop
// Console/Composer consume later (that prop only reaches each component's own chrome: transcriptLabel,
// commandLead, thinking). So the transcript needs its OWN complete label set, supplied here.
//
// It is a THUNK, and that is the whole point (2.1.0): the package re-reads it ONCE PER TURN. A live language
// switch therefore re-translates NEW turns while a turn already in flight keeps the locale it was born in —
// which is the honest behaviour, since its text was baked when it ran. Until 2.1.0 these options were read
// once at construction and the transcript spoke its mount-time locale forever; that limit is now gone.
//
// Every key is REQUIRED and the thunk is never merged with the package's English defaults — a partial set is
// a compile error rather than a silently half-translated screen. That is what surfaced the five labels below
// (session, stopped, truncated, file change, unsupported event) as English leaks we had never noticed.
//
// THE TRAP, and why every formatter below is PINNED to a captured locale. The package snapshots the label set
// once per turn — but a snapshot only freezes the STRINGS. A FUNCTION is captured by reference and runs when
// the package calls it, which for the close line is when the run ENDS. So a formatter that reads `locale.value`
// at call time would answer with the locale of whoever is looking, not the one the turn was born in: start a
// run in English, switch to Spanish before it finishes, and the close line renders "✓ done (1 turno, 3s)" —
// half the sentence in each language. Pinning the locale at thunk-read time makes the whole snapshot coherent
// and keeps the package's promise: a turn in flight speaks the language it started in.
const transcriptLabels = computed<TranscriptLabels>(() => {
  const loc = locale.value;
  const intl = loc === 'es' ? 'es-MX' : 'en-US';
  // Translate against the PINNED locale (not the live one), under this consumer's namespace.
  const at = (key: string, named?: Record<string, unknown>) =>
    t(`${props.i18nNamespace}.${key}`, named ?? {}, { locale: loc });

  return {
    rateLimitNotice: at('rateLimitReached'),
    // Notice kinds we do not translate individually; the package renders the notice's own text. Empty is a
    // real answer here, not a gap — it is exactly what the package's own defaults carry.
    noticeLabels: {},
    commandLabels: {
      succeeded: at('command.succeeded'),
      failed: at('command.failed'),
      refused: at('command.refused'),
    },
    // NEW in 2.2.0. A refused command carries a machine-readable CODE alongside the engine's English prose, and
    // a code we CAN translate. We map only the three codes whose sentence is OURS to author: the refused set
    // (`/clear`), an unknown command, an unharvestable catalog. The other two codes — `provider_unsupported`
    // (the agent CLI's own words) and `host_refused` (already in the host's language) — we deliberately DO NOT
    // map, so the package falls back to the engine's prose (`rejectionReasons?.[code] ?? reason`): we never
    // translate a sentence we did not write.
    rejectionReasons: {
      unsupported_command: at('rejectionReasons.unsupportedCommand'),
      unknown_command: at('rejectionReasons.unknownCommand'),
      catalog_unavailable: at('rejectionReasons.catalogUnavailable'),
    },
    quotaUsageLabel: at('console.quotaUsage'),
    quotaResetsLabel: at('console.quotaResets'),
    // The package's default reset formatter is `toLocaleTimeString()` with no locale, so it follows the
    // SERVER/BROWSER locale rather than the app's — which rendered "se renueva 3:00:00 PM": a 12-hour clock,
    // with seconds, inside Spanish copy. A reset time is a clock reading, so give it the app's locale and drop
    // the seconds (nobody's quota resets on a particular second). Receives epoch MILLISECONDS.
    //
    // `hourCycle` is set EXPLICITLY, and that is the whole point: `es-MX` defaults to a 12-hour clock (it
    // renders "03:00 p.m."), so naming the locale alone does not get you a 24-hour time — Mexico writes 24h
    // in this kind of UI, and the CLDR default disagrees. en-US keeps h12, which is correct for it.
    formatQuotaReset: (ms: number) =>
      new Date(ms).toLocaleTimeString(intl, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: loc === 'es' ? 'h23' : 'h12',
      }),
    sessionLabel: at('console.session'),
    runDoneLabel: at('console.runDone'),
    // NEW in 2.1.0. A command that failed used to close under the green "done" line — the screen asserted a
    // success the log never claimed. It now closes "✗ falló", and this is the word it uses. The RUN still
    // succeeded (the process ran and exited 0): the run and the command are different facts, and only the
    // rendered line changed. Our DB and every count are untouched.
    runFailedLabel: at('console.runFailed'),
    // Anything shaped by a NUMBER is a function, because the package cannot guess a plural rule (English has
    // 2 forms, Polish 3, Japanese 1) — it hands us the count and renders what we return.
    formatTurns: (n: number) =>
      n === 1 ? at('console.turnOne') : at('console.turnOther', { n }),
    formatDuration: (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}min`),
    // Claude publishes a price; Codex publishes NO price anywhere in its protocol, so that field is simply
    // absent on a Codex run and the package renders nothing. We never substitute a zero — "$0.0000" would tell
    // the user the run was free.
    formatCost: (usd: number) => `$${usd.toFixed(4)}`,
    tokensLabel: at('console.tokens'),
    stoppedNote: at('console.stopped'),
    truncatedNote: at('console.truncated'),
    fileChangeLabel: at('console.fileChange'),
    unsupportedEventLabel: at('console.unsupportedEvent'),
    // Empty tool output. The package's default is the English "(no output)"; give it the app's words. It lives
    // in the labels thunk (not a useAgentChat option) because it is a per-turn transcript label like the rest.
    noOutputNote: at('console.noOutput'),
    // The package groups thousands with a fixed en-US separator so two machines render alike. We can do better:
    // this is the APP's locale, which is the one the reader is actually looking at.
    formatNumber: (n: number) => n.toLocaleString(intl),
  };
});

const chat = useAgentChat({
  socketUrl,
  fetchTicket: (runId) => runs.mintSocketTicket(runId),
  driver,
  initialProvider: props.initialProvider ?? undefined,
  // userLabel is a THUNK (not a baked string) on purpose: client 2.2.0 repaints already-rendered turns when a
  // locale source changes, but only for the thunks you actually pass. A seeded/live user bubble stays frozen in
  // the language it was born in unless its label is a thunk — so switching EN↔ES would leave old bubbles reading
  // "You"/"Tú". It follows the LIVE locale (unlike the per-turn formatters above), which is what makes it reflow.
  userLabel: () => tns('you'),
  labels: () => transcriptLabels.value,
  // The auto-retry system note (↻) the package writes on a retryable failure. As a thunk it is both translated
  // (the default is the English "Retrying…") and armed for repaint on a live language switch, like userLabel.
  retryNote: () => tns('composer.retrying'),
});

// The composer's `/` autocomplete. The package NEVER fetches this itself — our API proxies the engine's
// catalog behind admin auth and we hand it over. It is per-AGENT (Claude ships its own skills; Codex has its
// own set), so it reloads when the selection changes. An empty list is a valid answer: the composer simply
// degrades to plain prose and never blocks typing.
const commands = ref<CommandDescriptor[]>([]);
async function loadCommands(provider: AgentProvider | null) {
  if (!provider) { commands.value = []; return; }
  try {
    const catalog = await sessions.commands(provider as KnowledgeChatProvider);
    commands.value = catalog.commands;
  } catch {
    commands.value = []; // no autocomplete is a degraded UI, not a broken one
  }
}
watch(() => chat.selectedProvider.value, (p) => void loadCommands(p), { immediate: true });

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
  authNotice.value = tns('agent.authHint', { agent: providerLabels[provider] ?? provider });
}
async function recheckProviders() {
  authNotice.value = null;
  await loadProviders(true); // force: bypass the ~30s probe cache — they just signed in
}

async function submit() {
  const text = draft.value;
  if (!text.trim() || !canSend.value) return;
  error.value = null;

  // The SAME function the engine's /execute validator uses. Two implementations of "is this a command?" is
  // two chances to disagree about where a command starts — and the `/` must be at index 0 (a leading space
  // is prose), which is exactly the rule a host that composes prompts can accidentally break.
  const command = parseCommandInput(text);

  if (command && !chat.sessionId.value) {
    error.value = tns('commandNeedsConversation');
    return;
  }
  // A command turn leads with the ENGINE's `command.started`, never an optimistic user bubble — that is what
  // makes it render identically live and on replay, and never twice. So: push a bubble for a prompt, and only
  // for a prompt.
  if (!command) chat.pushUserPrompt(text.trim(), () => tns('you'));
  draft.value = '';
  try {
    // useAgentChat re-parses the raw text and hands the driver `{ command }`; we pass the text through
    // untouched. Never trim, never prepend — a prepended character decapitates a command.
    //
    // The agent session id IS the conversation's memory: present → continue it; absent → this is a
    // brand-new conversation and the driver creates it.
    if (chat.sessionId.value) await chat.resume(chat.sessionId.value, text);
    else await chat.start(text);
  } catch (e: unknown) {
    const status = (e as { statusCode?: number; response?: { status?: number } })?.statusCode
      ?? (e as { response?: { status?: number } })?.response?.status;
    error.value = status === 409
      ? tns('runInProgress')
      : status === 422 || status === 400
        ? tns('sendRejected')
        : tns('sendError');
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
  // A command turn has no user bubble to restore — the engine's replayed `command.started` leads it. Only a
  // PROMPT turn needs its bubble re-pushed (seeded history holds only TERMINAL turns, by design).
  if (active.prompt) chat.pushUserPrompt(active.prompt, () => tns('you'));
  chat.connect(String(active.runId)); // runId MUST be a string — the server authorizes STOP by strict ===
}

// --- Doctor write proposals (spec 2026-07-18 §5.3, §5.3.1, §6.2, §6.4) ---------------------------------
//
// The agent cannot write anything. It files a proposal; the owner approves it here. Everything rendered
// comes from the SERVER (the canonical operation list), never from the agent's prose summary.

const pendingProposal = ref<DoctorProposal | null>(null);
// The id the owner dismissed. Dismiss is NOT a decline (§5.3): it only closes the banner. The proposal
// stays PENDING server-side and the server expires it when the next run starts — so we track WHICH id was
// dismissed rather than a bare boolean, and a genuinely new proposal reopens the banner on its own.
const dismissedProposalId = ref<string | null>(null);
const proposalBusy = ref(false);
const proposalError = ref<string | null>(null);
const skipPermissions = ref(false);
const skipBusy = ref(false);
const skipError = ref<string | null>(null);

// Truthiness, NOT `!== null`. The wire has already produced one value that is neither a proposal nor
// `null` (an empty 200 body arrives as `''`), and an adapter is an INJECTED interface this component does
// not own, so it cannot assume the declared `DoctorProposal | null` holds at runtime. A `!== null` guard
// waves `undefined` straight through into `.id` and throws inside a computed — where the failure surfaces
// as an unhandled rejection rather than a visible error, which is the silent-degradation mode §5.3.1
// exists to prevent. `refreshProposal` normalizes on assignment too; this is the second line.
const showProposalBanner = computed(
  () => !!pendingProposal.value && pendingProposal.value.id !== dismissedProposalId.value,
);

function resolutionErrorMessage(e: unknown): string {
  if (upstreamErrorCode(e) !== 409) return tns('proposal.applyError');
  // §5.3.1: the server is authoritative and the button is only a request. A 409 carries the TERMINAL
  // status, so we can tell the owner which of the two races they lost instead of a generic failure.
  // Read the STATUS, never the message — the two endpoints answer in one shape precisely so the UI does
  // not have to parse prose. Note the status is NOT confined to the proposal-status enum: the API sends
  // 'UNKNOWN' when the row has vanished entirely, which falls through to the generic "already resolved".
  //
  // ⚠️ Read it through `upstreamErrorStatus`, NEVER as `e.data.status`. Every call in this app is proxied
  // by the Nuxt BFF, which re-wraps the upstream body under h3's own `data` key — so the field the API's
  // e2e sees at the top level sits one level deeper in the browser. `e.data.status` is `undefined` here
  // in every real run, which silently collapsed the EXPIRED branch: the owner was told "someone else
  // resolved this" when in fact the agent had superseded the proposal with a newer one, and
  // `proposal.conflict.expired` was dead copy. `server/api/proxy.wire.test.ts` pins the real shape.
  const terminal = upstreamErrorStatus(e) as DoctorProposalConflictStatus | undefined;
  return terminal === 'EXPIRED' ? tns('proposal.conflict.expired') : tns('proposal.conflict.resolved');
}

// THE ONLY read path. Called from exactly two places — onMounted and the run-terminal watcher below —
// which is the whole delivery model (§6.2). There is no timer in this component and there must never be
// one: polling a database for a state that already announces itself on `done` is waste plus latency.
async function refreshProposal() {
  if (!props.proposals || !currentSessionId.value) return;
  try {
    // `?? null` keeps the ref's declared invariant TRUE at runtime rather than merely on paper: the
    // adapter is injected, so "it cannot return undefined" is a claim about someone else's code.
    const next = (await props.proposals.pending(currentSessionId.value)) ?? null;
    pendingProposal.value = next;
    // A NEW proposal is a new request for consent: an earlier dismissal must not silently swallow it.
    if (next && next.id !== dismissedProposalId.value) dismissedProposalId.value = null;
  } catch {
    // A failed read leaves the previous banner alone rather than blanking it: the chat keeps working and
    // the next `done` re-reads. It is a missing notification, never a wrong one.
  }
}

async function loadSkipPermissions() {
  if (!props.proposals || !currentSessionId.value) return;
  try {
    const settings = await props.proposals.getSettings(currentSessionId.value);
    skipPermissions.value = settings.skipPermissions;
  } catch {
    skipError.value = tns('proposal.settingsError');
  }
}

async function approveProposal() {
  if (!props.proposals || !currentSessionId.value || !pendingProposal.value) return;
  proposalBusy.value = true;
  proposalError.value = null;
  try {
    await props.proposals.approve(currentSessionId.value, pendingProposal.value.id);
    pendingProposal.value = null;
    dismissedProposalId.value = null;
  } catch (e: unknown) {
    // FAIL VISIBLY (§5.3.1). Approving an expired proposal must tell the owner the request died and the
    // doctor may re-issue it — a silent no-op would let them believe the change landed.
    proposalError.value = resolutionErrorMessage(e);
    await refreshProposal();
  } finally {
    proposalBusy.value = false;
  }
}

async function declineProposal() {
  if (!props.proposals || !currentSessionId.value || !pendingProposal.value) return;
  proposalBusy.value = true;
  proposalError.value = null;
  try {
    await props.proposals.decline(currentSessionId.value, pendingProposal.value.id);
    pendingProposal.value = null;
    dismissedProposalId.value = null;
  } catch (e: unknown) {
    proposalError.value = resolutionErrorMessage(e);
    await refreshProposal();
  } finally {
    proposalBusy.value = false;
  }
}

// Dismiss sends NOTHING. It closes the banner and leaves the proposal PENDING; the server expires it when
// the next run starts and tells the agent, which may then re-issue it.
function dismissProposal() {
  if (!pendingProposal.value) return;
  dismissedProposalId.value = pendingProposal.value.id;
  proposalError.value = null;
}

async function setSkipPermissions(value: boolean) {
  if (!props.proposals || !currentSessionId.value) return;
  skipBusy.value = true;
  skipError.value = null;
  try {
    // The rendered value follows the SERVER's answer, never the click: a rejected PATCH must not leave the
    // screen claiming the gate is off while it is on.
    const settings = await props.proposals.setSettings(currentSessionId.value, value);
    skipPermissions.value = settings.skipPermissions;
  } catch {
    skipError.value = tns('skipPermissions.error');
  } finally {
    skipBusy.value = false;
  }
}

// A run just went terminal → the session list's status chip is stale. (Covers success, failure and
// cancellation alike.)
watch(streaming, (isStreaming, was) => {
  if (!was || isStreaming) return;
  emit('changed');
  // TRIGGER 2 of 2 (§6.2). `done` is the run-finished event the client already subscribes to; at this
  // component's level it surfaces as the state leaving the streaming set. A proposal is filed at the END
  // of a turn by construction, so this is the moment it becomes visible. No polling anywhere.
  void refreshProposal();
});

onMounted(async () => {
  // TRIGGER 1 of 2 (§6.2): mount covers a reload, a closed laptop, a new device and a dropped socket —
  // the proposal lives in the database, so it survives all of them.
  await Promise.all([loadProviders(), restore(), refreshProposal(), loadSkipPermissions()]);
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

    <!-- Above the chat, per §6.4. Disabled until a session exists, because the setting is stored PER
         SESSION and a brand-new conversation has no row to hold it yet. -->
    <AgentSkipPermissions
      v-if="proposals"
      :model-value="skipPermissions"
      :i18n-namespace="i18nNamespace"
      :busy="skipBusy"
      :disabled="!currentSessionId"
      :error-message="skipError"
      @update:model-value="setSkipPermissions"
    />

    <p v-if="authNotice" class="mp-kchat__note">
      {{ authNotice }}
      <button type="button" class="mp-kchat__recheck" @click="recheckProviders">
        {{ $t(`${i18nNamespace}.agent.recheck`) }}
      </button>
    </p>

    <Console
      :entries="entries"
      :agent-label="$t(`${i18nNamespace}.agentLabel`)"
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
      {{ $t(`${i18nNamespace}.agentSessionMissing`) }}
    </p>
    <p v-else-if="transcriptUnavailable" class="mp-kchat__note">
      {{ $t(`${i18nNamespace}.transcriptUnavailable`) }}
    </p>

    <p v-if="needsFirstTurnRetry" class="mp-kchat__note">
      {{ $t(`${i18nNamespace}.firstTurnFailed`) }}
    </p>

    <!-- The platform's OWN notice zone — outside the package's Console, where RunFailureNotice and the
         transcript notes already live. The consent surface must never be a transcript entry: the agent
         writes the transcript. -->
    <AgentProposalBanner
      v-if="proposals && showProposalBanner && pendingProposal"
      :proposal="pendingProposal"
      :i18n-namespace="i18nNamespace"
      :busy="proposalBusy"
      :error-message="proposalError"
      @approve="approveProposal"
      @decline="declineProposal"
      @dismiss="dismissProposal"
    />

    <!-- The banner is gone but the attempt failed: the failure must still be on screen, or an approve that
         hit an expired proposal would look exactly like an approve that worked (§5.3.1). -->
    <p v-if="proposals && proposalError && !showProposalBanner" class="mp-kchat__note" role="alert">
      {{ proposalError }}
      <button type="button" class="mp-kchat__recheck" @click="proposalError = null">
        {{ $t('common.close') }}
      </button>
    </p>

    <Composer
      v-model="draft"
      :running="streaming"
      :can-send="canSend"
      :disabled="noProviderAvailable"
      :error="noProviderAvailable ? chatLabels.noProviderAvailable : (error ?? undefined)"
      :labels="chatLabels"
      :commands="commands"
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
/* Let the embedded console take the remaining height and scroll internally.
 *
 * ⚠️ `min-height: 0` here was a MEASURED defect, not a theoretical one. With the consent banner present
 * the column's free space goes negative, and `min-height: 0` let this track shrink to LITERALLY ZERO —
 * while its child `.crt-console` cannot: that element is `box-sizing: border-box` with `padding: 1rem`,
 * so its used height FLOORS at 32px no matter what its `height: 100%` resolves to. A 32px child inside a
 * 0px `overflow: visible` parent paints 32px past its own track, straight over the block below it.
 * Measured in Chromium on the real page: console track 352→352, console element 352→384, banner heading
 * 377→398 — a 7px overlap across the heading of the most safety-critical component in the app.
 *
 * Two independent guards, because either one alone leaves a hole:
 *   `min-height` — the transcript must never collapse to nothing; the owner reads it to decide.
 *   `overflow: hidden` — whatever the track's height, the console can never paint outside it. This is
 *      what protects EVERY sibling below, not just today's banner (the same collapse put the mobile
 *      "first turn never reached an agent" notice under the console too — one root cause, one fix).
 *      Safe for the package's own UI: `.crt-console__jump` is absolutely positioned INSIDE this wrap
 *      (which is `position: relative`), and `.crt-console` keeps its own `overflow-y: auto`.
 */
/*
 * `flex-basis: 0` (not `auto`) is what makes the CONSENT SURFACE win the space fight, and it is the
 * difference between a usable banner and a token one. Under `auto` both tracks shrink in proportion to
 * their content, so the transcript — whose content is effectively unbounded — claimed most of the column
 * and squeezed the banner to 64px of a 692px proposal: measured. With basis 0 the console asks for
 * NOTHING and simply absorbs whatever is left over, so the banner shrinks only after the console has
 * reached the `min-height` floor below. Re-measured: banner 310px, console 96px, nothing clipped.
 * No effect when there is no banner — the console still grows to fill the whole column (418px, identical
 * to before), because with nothing to compete with, "all the leftover space" IS the whole column.
 */
.mp-kchat :deep(.crt-console-wrap) {
  flex: 1 1 0;
  min-height: 6rem;
  min-width: 0;
  overflow: hidden;
}
/* The composer is the owner's only way to answer the agent. It must never be the thing that gets
   squeezed out: the parent card is `overflow: hidden`, so a pushed-down composer is not merely small,
   it is GONE. Measured alongside the overlap above — with the banner open the composer sat 270px below
   the panel and was clipped away entirely. */
.mp-kchat :deep(.crt-composer) {
  flex: none;
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
/* On a phone the column is far tighter (the toolbar and the Skip Permissions switch both wrap, costing
   ~300px more than on desktop), and the transcript is the one thing here that is ALSO reachable by
   scrolling within itself. So its floor drops and the consent surface keeps the difference. The floor
   stays non-zero on purpose: at zero the console's `box-sizing: border-box` padding would again make the
   element taller than its track and paint over whatever sits below it — the exact defect above. */
@media (max-width: 720px) {
  .mp-kchat :deep(.crt-console-wrap) {
    min-height: 3rem;
  }
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
