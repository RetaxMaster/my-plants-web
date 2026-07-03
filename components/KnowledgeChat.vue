<script setup lang="ts">
import { createChatClient, createTranscript, type ChatClient, type ConsoleEntry } from '@retaxmaster/claude-realtime-client';
import { Console, Composer } from '@retaxmaster/claude-realtime-client/vue';
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

const sessions = useKnowledgeChatSessions();
const runs = useKnowledgeChatRuns();
const socketUrl = useRuntimeConfig().public.knowledgeChatSocketUrl;

const currentSessionId = ref<string | null>(props.sessionId);
const claudeSessionId = ref<string | null>(props.initialClaudeSessionId);
const draft = ref('');
const streaming = ref(false);
const error = ref<string | null>(null);

const transcript = createTranscript();
const transcriptEntries = ref<ConsoleEntry[]>([]);
let activeStream: ChatClient | null = null;

// Locked once an existing session never settled its UUID (its first run died pre-init): a blank UUID
// must NEVER fall through to start() (that would graft an unrelated run / mint a new session).
const notResumable = computed(
  () => props.initialTurns.length > 0 && currentSessionId.value !== null && claudeSessionId.value === null,
);
const canSend = computed(() => !streaming.value && !notResumable.value);

function sync() {
  // Shallow-clone each entry so Vue sees new identity on in-place merges (tool-result updates).
  transcriptEntries.value = transcript.entries.map((e) => ({ ...e }));
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
      ? 'A run is already in progress for this conversation.'
      : status === 422 || status === 400
        ? 'That message could not be sent (too long or not resumable).'
        : 'Could not send your message. Please try again.';
  }
}

function stop() {
  activeStream?.stop();
}

onMounted(() => { void rebuildAndStream(); });
onBeforeUnmount(() => closeStream());
</script>

<template>
  <div class="mp-kchat">
    <Console :entries="transcriptEntries" claude-label="Knowledge Engine" :busy="streaming" />
    <p v-if="notResumable" class="mp-kchat__note">
      This conversation can't be continued — its first turn ended before a session was established.
    </p>
    <Composer
      v-model="draft"
      :running="streaming"
      :can-send="canSend"
      :error="error ?? undefined"
      placeholder="Ask the knowledge engine to research a species…"
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
  height: 100%;
}
.mp-kchat__note {
  font: 13px var(--font-sans);
  color: var(--care-caution-text);
}
</style>
