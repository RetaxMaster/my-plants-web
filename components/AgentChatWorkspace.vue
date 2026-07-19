<script setup lang="ts">
import type { ChatProposalsAdapter, ChatRunsAdapter, ChatWorkspaceSessionsAdapter, KnowledgeChatRunStatus, KnowledgeChatSessionDetail } from '../types/api';
import { ACTIVE_RUN_STATUSES } from '../types/api';

// "The session is busy." Mirrors the API's ACTIVE_RUN_STATUSES rather than listing statuses inline:
// LAUNCHING was missing from the old inline pair, which left the delete button enabled during the exact
// window the server refuses the delete. One list, so a future status cannot be added to some checks only.
const isRunActive = (status: KnowledgeChatRunStatus | null | undefined): boolean =>
  !!status && ACTIVE_RUN_STATUSES.includes(status);

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

// The selected conversation lives in the URL as `?session=<id>`, so a reload lands back on the same
// conversation instead of the default "new chat".
//
// This is a SAFETY property on the doctor surface, not a convenience: a pending write proposal renders
// only once its session's detail is loaded, so an owner who left a destructive proposal un-decided and
// then reloaded would land on a blank chat and might never be shown that request again. The state was
// always durable server-side; what was missing was any way back to it.
//
// `router.replace` (never `push`) keeps every sync out of the Back-button history — clicking through a
// dozen conversations must not fill Back with a dozen stops. Every OTHER query param is preserved.
const route = useRoute();
const router = useRouter();

function setSessionQuery(sid: string | null) {
  const current = route.query.session;
  const currentStr = typeof current === 'string' ? current : null;
  if (currentStr === sid) return; // no-op: avoid a redundant history entry
  const query = { ...route.query };
  if (sid === null) delete query.session;
  else query.session = sid;
  void router.replace({ query });
}

async function openSession(sid: string | null) {
  selected.value = sid;
  setSessionQuery(sid);
  if (sid === null) { detail.value = null; return; }
  loadingDetail.value = true;
  try {
    detail.value = await props.sessions.fetch(sid);
  } catch {
    // The pinned session id is stale (deleted, or belongs to another owner — the API 404s it either way).
    // Degrade to the new-chat state rather than rendering a broken panel under a lying URL.
    selected.value = null;
    detail.value = null;
    setSessionQuery(null);
  } finally {
    loadingDetail.value = false;
  }
}
function newChat() { newChatSeq.value += 1; void openSession(null); }
async function onCreated(sessionId: string) { selected.value = sessionId; setSessionQuery(sessionId); await refresh(); }
async function onChanged() { await refresh(); }
async function removeSession(sid: string) {
  try { await props.sessions.remove(sid); }
  catch { if (import.meta.client) alert(tns('deleteError')); return; }
  if (selected.value === sid) { newChatSeq.value += 1; await openSession(null); }
  await refresh();
}

// Restore the selected conversation from the URL on mount. A non-empty `session` query param wins over the
// default "new chat" state; a failed restore is handled inside openSession() itself (falls back + strips
// the param), so this call can never throw or leave a stale param behind.
const initialSessionId = route.query.session;
if (typeof initialSessionId === 'string' && initialSessionId.length > 0) {
  await openSession(initialSessionId);
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
                <UiBadge v-if="s.status" :color="isRunActive(s.status) ? 'green' : 'neutral'" size="xs">{{ $t(`${i18nNamespace}.runStatus.${s.status}`) }}</UiBadge>
                <span class="mp-kchat-list__turns">{{ $t(`${i18nNamespace}.turns`, { n: s.turns }, s.turns) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="mp-kchat-list__del"
              :disabled="isRunActive(s.status)"
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

/* ⚠️ A PENDING PROPOSAL IS NOT ALLOWED TO BE CAGED BY THIS CARD.
 *
 * Normally this panel is a fixed-height cage so the transcript scrolls INSIDE it instead of growing the
 * page — right for a chat. It is wrong for a consent surface. Measured: a four-operation proposal needs
 * 591px of reading, and the cage could offer 185px on a 1440x900 desktop and 17px on a 390x844 phone,
 * because the chat's own chrome costs 268px and 383px respectively. No redistribution of that budget
 * fixes it — on a phone the SIMPLEST possible proposal (one nickname change) already needs 325px.
 *
 * So while a proposal is pending the card stops being a cage: it grows to fit, the banner sizes to its
 * CONTENT with no internal scroll, and the page scrolls — the native way any viewport shows something
 * taller than itself. The spec's "the chat is never blocked" (§5.3) still holds: the composer is still
 * there and still usable, it is simply below the decision rather than above a clipped one.
 *
 * The console MUST be pinned to a definite height here, and that is not optional: with an auto-height
 * card its `height: 100%` resolves to `auto`, and the transcript would grow without bound — making the
 * page as tall as the entire conversation.
 *
 * `:has()` degrades in exactly the right direction. A browser without it keeps the fixed-height card,
 * where the banner's pinned action buttons and its overflow cue still guarantee that nothing — least of
 * all the destructive-delete warning — is ever hidden UNMARKED. That fallback is load-bearing, not
 * decorative: it is what makes this rule an improvement rather than the only thing standing between the
 * owner and an invisible warning. */
.mp-kchat-panel:has(.mp-proposal) { height: auto; min-height: 30rem; }
.mp-kchat-panel:has(.mp-proposal) .mp-kchat { height: auto; }
.mp-kchat-panel:has(.mp-proposal) :deep(.crt-console-wrap) { flex: none; height: 16rem; }

@media (max-width: 720px) {
  .mp-kchat-layout { grid-template-columns: 1fr; }
  /* 70vh was too small once a real consent banner had to share this column. MEASURED on a 390x844
     viewport: the chat's own chrome costs 383px here (the agent/theme toolbar wraps to 134px and the Skip
     Permissions switch to 76px, against 32px and 40px on desktop), which left a 692px proposal just 28px
     of a 70vh panel — a scroll window too small to read one line of. This panel already sits below the
     fold on a phone, so the page scrolls to it either way; taking a larger share of the viewport costs
     nothing and is what makes the approval surface legible. Re-measured at 85vh: the banner gets a usable
     share and still scrolls internally, with nothing clipped. */
  .mp-kchat-panel { height: 85vh; }

  /* A phone has far less room for the transcript once the decision is on screen, and the transcript is
     the one thing here that is also reachable by scrolling within itself. */
  .mp-kchat-panel:has(.mp-proposal) { min-height: 70vh; }
  .mp-kchat-panel:has(.mp-proposal) :deep(.crt-console-wrap) { height: 10rem; }
}
</style>
