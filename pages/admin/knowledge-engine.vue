<script setup lang="ts">
import type { KnowledgeChatSessionDetail } from '../../types/api';

const { t } = useI18n();
const { user } = useUserSession();
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: t('admin.pageNotFound') });
}

useHead(() => ({ title: t('meta.knowledgeEngine.title') }));
useSeoMeta({ description: () => t('meta.knowledgeEngine.description') });

const sessionsApi = useKnowledgeChatSessions();
const { data: sessions, refresh } = await useAsyncData('knowledge-sessions', () => sessionsApi.list(), {
  default: () => [],
});

// null selection = a brand-new chat (not yet created); a string = an existing session's internal id.
const selected = ref<string | null>(null);
const detail = ref<KnowledgeChatSessionDetail | null>(null);
const loadingDetail = ref(false);

async function openSession(id: string | null) {
  selected.value = id;
  if (id === null) { detail.value = null; return; }
  loadingDetail.value = true;
  try {
    detail.value = await sessionsApi.fetch(id);
  } finally {
    loadingDetail.value = false;
  }
}

// Bumped on every "New chat" so chatKey changes and KnowledgeChat remounts FRESH — otherwise, after a
// brand-new chat created its session (onCreated keeps detail null so the live stream survives), the key
// would stay constant and a later "New chat" would reuse the same component instance, whose internal
// state still points at the previous session — the next prompt would resume the old conversation.
const newChatSeq = ref(0);

function newChat() {
  newChatSeq.value += 1;
  void openSession(null);
}

async function onCreated(sessionId: string) {
  // A brand-new chat just created its session server-side; adopt its id (no remount — the live stream
  // is already running) and refresh the list so it appears.
  selected.value = sessionId;
  await refresh();
}

async function onChanged() {
  await refresh();
}

async function removeSession(id: string) {
  try {
    await sessionsApi.remove(id);
  } catch {
    if (import.meta.client) alert(t('admin.deleteError'));
    return;
  }
  // Deleting the selected conversation resets to a fresh new chat — bump the nonce so KnowledgeChat
  // remounts clean (otherwise, if its detail was never loaded, the stale instance would keep the now
  // deleted session id and the next send would try to resume it).
  if (selected.value === id) {
    newChatSeq.value += 1;
    await openSession(null);
  }
  await refresh();
}

// The KnowledgeChat mount key: brand-new chats mount fresh under 'new'; existing sessions under their
// id. Adopting a new session's id (onCreated) intentionally does NOT change this key mid-stream —
// the component keeps streaming; only a user-driven openSession() switches conversations.
const chatKey = computed(() => (detail.value ? detail.value.id : `new-${newChatSeq.value}`));
</script>

<template>
  <div>
    <UiScreenHeader :eyebrow="$t('admin.eyebrow')" :title="$t('admin.keTitle')" :subtitle="$t('admin.keSubtitle')" />
    <div class="mp-kchat-layout">
      <aside class="mp-kchat-list">
        <UiButton size="sm" variant="solid" color="neutral" block @click="newChat">{{ $t('admin.newChat') }}</UiButton>
        <UiCard v-if="!sessions?.length" padded>
          <UiEmptyState>{{ $t('admin.noConversations') }}</UiEmptyState>
        </UiCard>
        <ul v-else class="mp-kchat-list__items">
          <li v-for="s in sessions" :key="s.id" class="mp-kchat-list__item" :class="{ 'is-active': s.id === selected }">
            <button type="button" class="mp-kchat-list__open" @click="openSession(s.id)">
              <span class="mp-kchat-list__title">{{ s.title }}</span>
              <span class="mp-kchat-list__meta">
                <UiBadge v-if="s.status" :color="s.status === 'RUNNING' ? 'green' : 'neutral'" size="xs">{{ s.status }}</UiBadge>
                <span class="mp-kchat-list__turns">{{ $t('admin.turns', { n: s.turns }, s.turns) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="mp-kchat-list__del"
              :disabled="s.status === 'RUNNING' || s.status === 'QUEUED'"
              :title="$t('admin.deleteConversation')"
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
            <KnowledgeChat
              v-else
              :key="chatKey"
              :session-id="detail?.id ?? null"
              :initial-provider="detail?.provider ?? null"
              :initial-provider-session-id="detail?.providerSessionId ?? null"
              :initial-turns="detail?.turns ?? []"
              @created="onCreated"
              @changed="onChanged"
            />
            <template #fallback>
              <div class="mp-kchat-main__loading">{{ $t('admin.loadingChat') }}</div>
            </template>
          </ClientOnly>
        </UiCard>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mp-kchat-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  align-items: start;
}
/* Both grid tracks MUST be allowed to shrink below their content's min-content, or the transcript
   Console (wide monospace lines) forces the track — and thus the whole grid — past the viewport
   (horizontal overflow on mobile). `min-width: 0` on each grid child is the fix; the Console then
   scrolls internally instead of stretching the layout. */
.mp-kchat-list { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.mp-kchat-main { min-width: 0; }
.mp-kchat-list__items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mp-kchat-list__item {
  display: flex; align-items: stretch; gap: 4px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
}
.mp-kchat-list__item.is-active { border-color: var(--accent-cafe-ink); }
.mp-kchat-list__open { flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 8px 10px; cursor: pointer; }
.mp-kchat-list__title { display: block; font: 600 13px var(--font-sans); color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-kchat-list__meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.mp-kchat-list__turns { font: 12px var(--font-sans); color: var(--text-muted); }
.mp-kchat-list__del { background: none; border: none; padding: 0 8px; color: var(--text-muted); cursor: pointer; }
.mp-kchat-list__del:disabled { opacity: 0.4; cursor: not-allowed; }
/* A DEFINITE, viewport-anchored height (not just a min-height): the package console sizes with
   height:100% down the chain, so an indefinite-height panel would let it grow with the transcript and
   never trigger its own overflow — the whole page grew instead. Bounding the panel here makes the chain
   definite so the console scrolls INTERNALLY. min-height floors it on short viewports. */
.mp-kchat-panel {
  height: calc(100vh - 12rem);
  min-height: 30rem;
  display: flex;
  min-width: 0;
  overflow: hidden;
}
/* Let the card body fill the panel and lay out the chat as a column, so KnowledgeChat (and the package
   console inside it) can grow to the full card height instead of floating at a fixed 60vh. */
.mp-kchat-panel :deep(.mp-card__body) { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.mp-kchat-main__loading { font: 14px var(--font-sans); color: var(--text-muted); }

@media (max-width: 720px) {
  .mp-kchat-layout { grid-template-columns: 1fr; }
  /* Stacked layout: the session list sits above the panel and the app nav is a bottom bar, so give the
     chat a shorter bounded height that still scrolls internally. */
  .mp-kchat-panel { height: 70vh; }
}
</style>
