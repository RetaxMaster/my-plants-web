<script setup lang="ts">
import { createChatClient, createTranscript, type ChatClient, type ConsoleEntry } from '@retaxmaster/claude-realtime-client';
import { Console, Composer, ThemeSelector, useTheme } from '@retaxmaster/claude-realtime-client/vue';
import type { KnowledgeChatTurn } from '../types/api';

const props = defineProps<{
  // Our internal cuid session id; null for a brand-new chat not yet created.
  sessionId: string | null;
  initialClaudeSessionId: string | null;
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

// Translate the Composer's own CHROME (label / hint / Send-Stop buttons / connection + retry
// states) — NOT the streamed transcript content (spec §2). The package renders these from its
// English DEFAULT_LABELS unless a `labels` override is passed; the Composer merges
// `{ ...injected, ...props.labels }`, so this partial override wins. A computed so it re-translates
// on a live locale switch.
// NOTE: `Console` (the transcript) has NO `labels` prop and reads its own labels from the package's
// private `crt-labels` injection, whose Symbol is not exported — so `Console`'s internal
// "Jump to latest" affordance cannot be overridden through the public API. It is a minor,
// package-chrome English leak (an internal scroll button), out of reach until the package exports
// the injection key; `composer.jumpToLatest` is kept below so it applies automatically if it ever does.
const composerLabels = computed(() => ({
  promptLabel: t('knowledgeEngine.composer.promptLabel'),
  // Deliberately the app's OWN placeholder (was knowledgeEngine.composerPlaceholder), NOT the
  // package default "Type a message…" — keeps the English output byte-identical to pre-i18n.
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
  jumpToLatest: t('knowledgeEngine.composer.jumpToLatest'),
  overloaded: t('knowledgeEngine.composer.overloaded'),
  retrying: t('knowledgeEngine.composer.retrying'),
  retry: t('knowledgeEngine.composer.retry'),
}));

// Chat theming (claude-realtime-client). The package paints ALL its color from a namespaced --crt-*
// custom-property set that a "theme" maps over; style.css only ships structure. We render our OWN shell
// (Console + Composer, not the package's ChatPanel), so we must apply a theme ourselves or every
// --crt-* resolves to nothing and the chat renders unstyled. `useTheme` writes the tokens onto our root
// element (themeRoot), follows the OS light/dark while on `auto`, and persists the user's pick. The
// ThemeSelector in the toolbar is bound to it.
const themeRoot = ref<HTMLElement | null>(null);
const { theme, setTheme } = useTheme({
  target: themeRoot,
  defaultTheme: 'auto',
  persist: true,
  storageKey: 'crt-theme-knowledge',
});

// Benign rate-limit notice suppression. The package maps any stream-json `rate_limit_event` line to a
// system entry `"· <rateLimitNotice>"`. The real claude CLI emits those lines as rolling-window STATUS
// (not an actual limit hit), so the label is misleading noise. There is no stable kind/marker on the
// entry to key off — only its text — so we set a UNIQUE sentinel as the notice and filter system
// entries whose text is that sentinel (defensively also matching the package default text, in case the
// option is ever ignored). Genuine run failures never come through here — they surface via the stream's
// terminal `done`/failure path — so nothing real is hidden.
const RATE_LIMIT_MARKER = '__mp_rate_limit_event__';
const RATE_LIMIT_TEXTS = new Set([`· ${RATE_LIMIT_MARKER}`, '· rate limit reached']);
const isRateLimitNotice = (e: ConsoleEntry) => e.kind === 'system' && RATE_LIMIT_TEXTS.has(e.text);

const currentSessionId = ref<string | null>(props.sessionId);
const claudeSessionId = ref<string | null>(props.initialClaudeSessionId);
const draft = ref('');
const streaming = ref(false);
const error = ref<string | null>(null);

const transcript = createTranscript({ rateLimitNotice: RATE_LIMIT_MARKER });
const transcriptEntries = ref<ConsoleEntry[]>([]);
let activeStream: ChatClient | null = null;

// Locked once an existing session never settled its UUID (its first run died pre-init): a blank UUID
// must NEVER fall through to start() (that would graft an unrelated run / mint a new session).
const notResumable = computed(
  () => props.initialTurns.length > 0 && currentSessionId.value !== null && claudeSessionId.value === null,
);
const canSend = computed(() => !streaming.value && !notResumable.value);

function sync() {
  // Shallow-clone each entry so Vue sees new identity on in-place merges (tool-result updates), and drop
  // the benign rate-limit system notices so they never render.
  transcriptEntries.value = transcript.entries
    .filter((e) => !isRateLimitNotice(e))
    .map((e) => ({ ...e }));
}

// Settle the session UUID once, from ANY line carrying session_id (stable across all lines,
// including --resume turns). Never overwritten.
function captureUuid(line: unknown) {
  if (claudeSessionId.value) return;
  let obj: unknown = line;
  if (typeof line === 'string') {
    try { obj = JSON.parse(line); } catch { return; }
  }
  const uuid = (obj as { session_id?: unknown; sessionId?: unknown })?.session_id ?? (obj as { sessionId?: unknown })?.sessionId;
  if (typeof uuid === 'string' && uuid) claudeSessionId.value = uuid;
}

function closeStream() {
  if (activeStream) { activeStream.close(); activeStream = null; }
  streaming.value = false;
}

function openStreamForTurn(turn: KnowledgeChatTurn) {
  // Never overwrite a live handle: close any prior stream first so a client can't leak (e.g. after a
  // ticket-fetch error left one connected, or when starting a new turn). Idempotent — no-op if none.
  closeStream();
  transcript.bindRun(turn.runId); // seal previous, promote this turn as the ingest target
  const client = createChatClient({ socketUrl, fetchTicket: (runId) => runs.mintSocketTicket(runId) });
  client.on('reset', () => { transcript.resetActiveTurn(); sync(); }); // backlog replay on every (re)join
  client.on('state', (s) => { streaming.value = s === 'connecting' || s === 'streaming' || s === 'reconnecting'; });
  client.on('line', (line) => { transcript.ingest(line); captureUuid(line); sync(); });
  client.on('done', () => { void finalizeTurn(turn); });
  client.on('error', () => { streaming.value = false; });
  activeStream = client;
  client.connect(String(turn.runId)); // runId MUST be a string — the server authorizes STOP by strict ===
}

// After `done`, re-read the authoritative NDJSON (a socket can lag the terminal by one poll), then
// refresh the session list.
async function finalizeTurn(turn: KnowledgeChatTurn) {
  closeStream();
  try {
    const log = await runs.fetchLog(turn.logUrl);
    transcript.bindRun(turn.runId);
    transcript.resetActiveTurn();
    for (const l of log.split('\n')) if (l.trim()) { transcript.ingest(l); captureUuid(l); }
    sync();
  } catch { /* best-effort reconcile */ }
  emit('changed');
}

async function rebuildAndStream() {
  // 1. One pending turn per initial prompt, in order.
  for (const turn of props.initialTurns) transcript.pushUserPrompt(turn.prompt);
  // 2. Rebuild finished turns from their logs, sequentially; stop at the first active turn.
  let activeTurn: KnowledgeChatTurn | null = null;
  for (const turn of props.initialTurns) {
    if (turn.isActive) { activeTurn = turn; break; }
    transcript.bindRun(turn.runId);
    try {
      const log = await runs.fetchLog(turn.logUrl);
      for (const l of log.split('\n')) if (l.trim()) { transcript.ingest(l); captureUuid(l); }
    } catch { /* a purged/missing log just renders empty */ }
  }
  sync();
  // 3. The single active turn gets a LIVE stream.
  if (activeTurn) openStreamForTurn(activeTurn);
}

async function submit() {
  const text = draft.value.trim();
  if (!text || !canSend.value) return;
  error.value = null;
  streaming.value = true;
  transcript.pushUserPrompt(text);
  draft.value = '';
  try {
    let runId: string;
    if (currentSessionId.value && claudeSessionId.value) {
      // Existing, resumable session → add a run.
      ({ runId } = await sessions.resume(currentSessionId.value, text));
    } else {
      // Brand-new session → create it (first run).
      const res = await sessions.create(text);
      currentSessionId.value = res.sessionId;
      runId = res.runId;
      emit('created', res.sessionId);
    }
    const turn: KnowledgeChatTurn = {
      runId,
      prompt: text,
      status: 'QUEUED',
      isActive: true,
      logUrl: `/knowledge-chat/runs/${runId}/log`,
    };
    emit('changed');
    openStreamForTurn(turn);
  } catch (e: unknown) {
    streaming.value = false;
    const status = (e as { statusCode?: number; response?: { status?: number } })?.statusCode
      ?? (e as { response?: { status?: number } })?.response?.status;
    error.value = status === 409
      ? t('knowledgeEngine.runInProgress')
      : status === 422 || status === 400
        ? t('knowledgeEngine.sendNotResumable')
        : t('knowledgeEngine.sendError');
  }
}

function stop() {
  activeStream?.stop();
}

onMounted(() => { void rebuildAndStream(); });
onBeforeUnmount(() => closeStream());
</script>

<template>
  <div ref="themeRoot" class="mp-kchat">
    <div class="mp-kchat__toolbar">
      <ThemeSelector :model-value="theme" @update:model-value="setTheme" />
    </div>
    <Console :entries="transcriptEntries" :claude-label="$t('knowledgeEngine.claudeLabel')" :busy="streaming" />
    <p v-if="notResumable" class="mp-kchat__note">
      {{ $t('knowledgeEngine.cantContinue') }}
    </p>
    <Composer
      v-model="draft"
      :running="streaming"
      :can-send="canSend"
      :error="error ?? undefined"
      :labels="composerLabels"
      @submit="submit"
      @stop="stop"
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
  justify-content: flex-end;
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
</style>
