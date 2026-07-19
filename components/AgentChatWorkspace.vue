<script setup lang="ts">
import type { ChatProposalsAdapter, ChatRunsAdapter, ChatWorkspaceSessionsAdapter, KnowledgeChatSessionDetail } from '../types/api';

const props = defineProps<{
  // The scoped sessions source (list/fetch/create/resume/remove/history/providers/commands). Both
  // useKnowledgeChatSessions() and useDoctorChatSessions(plantId) satisfy this superset (Task 3/5).
  sessions: ChatWorkspaceSessionsAdapter;
  runs: ChatRunsAdapter;              // mints this consumer's socket ticket
  socketUrl: string;                  // KE engine vs doctor engine
  i18nNamespace: string;              // 'knowledgeEngine' | 'diagnose' — every shell string resolves as `${ns}.<suffix>`
  themeStorageKey: string;            // distinct per consumer so the two chats don't fight over one preference
  scopeKey: string;                   // unique useAsyncData cache key ('knowledge' | `diagnose-${plantId}`)
  // Optional, forwarded verbatim to the inner <AgentChat>: the doctor page injects a plant-scoped
  // proposals adapter, the Knowledge Engine injects nothing and therefore has no approval surface.
  proposals?: ChatProposalsAdapter;
}>();

const { t } = useI18n();
const tns = (key: string, named?: Record<string, unknown>) => t(`${props.i18nNamespace}.${key}`, named ?? {});

// The session list — keyed by scopeKey so KE and each plant's diagnose have independent caches.
const { data: sessionList, refresh } = await useAsyncData(
  `agent-chat-sessions-${props.scopeKey}`,
  () => props.sessions.list(),
  { default: () => [] },
);

const selected = ref<string | null>(null);
const detail = ref<KnowledgeChatSessionDetail | null>(null);
const loadingDetail = ref(false);
const newChatSeq = ref(0);

async function openSession(sid: string | null) {
  selected.value = sid;
  if (sid === null) { detail.value = null; return; }
  loadingDetail.value = true;
  try { detail.value = await props.sessions.fetch(sid); } finally { loadingDetail.value = false; }
}
function newChat() { newChatSeq.value += 1; void openSession(null); }
async function onCreated(sessionId: string) { selected.value = sessionId; await refresh(); }
async function onChanged() { await refresh(); }
async function removeSession(sid: string) {
  try { await props.sessions.remove(sid); }
  catch { if (import.meta.client) alert(tns('deleteError')); return; }
  if (selected.value === sid) { newChatSeq.value += 1; await openSession(null); }
  await refresh();
}
// Brand-new chats mount under 'new-N'; existing under their id. Adopting a new id (onCreated) does NOT
// change the key mid-stream (the live stream is already running).
const chatKey = computed(() => (detail.value ? detail.value.id : `new-${newChatSeq.value}`));
</script>

<template>
  <div>
    <slot name="header" />
    <div class="mp-kchat-layout">
      <aside class="mp-kchat-list">
        <UiButton size="sm" variant="solid" color="neutral" block @click="newChat">{{ $t(`${i18nNamespace}.newChat`) }}</UiButton>
        <UiCard v-if="!sessionList?.length" padded>
          <UiEmptyState>{{ $t(`${i18nNamespace}.noConversations`) }}</UiEmptyState>
        </UiCard>
        <ul v-else class="mp-kchat-list__items">
          <li v-for="s in sessionList" :key="s.id" class="mp-kchat-list__item" :class="{ 'is-active': s.id === selected }">
            <button type="button" class="mp-kchat-list__open" @click="openSession(s.id)">
              <span class="mp-kchat-list__title">{{ s.title }}</span>
              <span class="mp-kchat-list__meta">
                <UiBadge v-if="s.status" :color="s.status === 'RUNNING' ? 'green' : 'neutral'" size="xs">{{ $t(`${i18nNamespace}.runStatus.${s.status}`) }}</UiBadge>
                <span class="mp-kchat-list__turns">{{ $t(`${i18nNamespace}.turns`, { n: s.turns }, s.turns) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="mp-kchat-list__del"
              :disabled="s.status === 'RUNNING' || s.status === 'QUEUED'"
              :title="$t(`${i18nNamespace}.deleteConversation`)"
              @click="removeSession(s.id)"
            >
              <UiAppIcon name="trash" :size="15" color="currentColor" />
            </button>
          </li>
        </ul>
      </aside>

      <section class="mp-kchat-main">
        <UiCard padded class="mp-kchat-panel">
          <ClientOnly>
            <div v-if="loadingDetail" class="mp-kchat-main__loading">{{ $t('common.loading') }}</div>
            <AgentChat
              v-else
              :key="chatKey"
              :session-id="detail?.id ?? null"
              :initial-provider="detail?.provider ?? null"
              :initial-provider-session-id="detail?.providerSessionId ?? null"
              :initial-turns="detail?.turns ?? []"
              :sessions="sessions"
              :runs="runs"
              :socket-url="socketUrl"
              :i18n-namespace="i18nNamespace"
              :theme-storage-key="themeStorageKey"
              :proposals="proposals"
              @created="onCreated"
              @changed="onChanged"
            />
            <template #fallback>
              <div class="mp-kchat-main__loading">{{ $t(`${i18nNamespace}.loadingChat`) }}</div>
            </template>
          </ClientOnly>
        </UiCard>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* MOVED here verbatim from the admin KE page — the ONE copy of the chat-workspace layout. Two shrinkable
   grid tracks so the transcript Console scrolls INTERNALLY instead of forcing horizontal overflow, and a
   viewport-anchored panel height so the console gets a definite-height chain. */
.mp-kchat-layout { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
.mp-kchat-list { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.mp-kchat-main { min-width: 0; }
.mp-kchat-list__items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mp-kchat-list__item { display: flex; align-items: stretch; gap: 4px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.mp-kchat-list__item.is-active { border-color: var(--accent-cafe-ink); }
.mp-kchat-list__open { flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 8px 10px; cursor: pointer; }
.mp-kchat-list__title { display: block; font: 600 13px var(--font-sans); color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-kchat-list__meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.mp-kchat-list__turns { font: 12px var(--font-sans); color: var(--text-muted); }
.mp-kchat-list__del { background: none; border: none; padding: 0 8px; color: var(--text-muted); cursor: pointer; }
.mp-kchat-list__del:disabled { opacity: 0.4; cursor: not-allowed; }
.mp-kchat-panel { height: calc(100vh - 12rem); min-height: 30rem; display: flex; min-width: 0; overflow: hidden; }
.mp-kchat-panel :deep(.mp-card__body) { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.mp-kchat-main__loading { font: 14px var(--font-sans); color: var(--text-muted); }

@media (max-width: 720px) {
  .mp-kchat-layout { grid-template-columns: 1fr; }
  .mp-kchat-panel { height: 70vh; }
}
</style>
