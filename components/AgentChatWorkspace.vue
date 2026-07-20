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

// The workspace owns conversation SELECTION but cannot reach the inner AgentChat's own chat instance
// directly, so that component exposes `abandonConversation()` (Task 21) and we hold a template ref to it.
// `AgentChat` sits behind `v-if="!loadingDetail"` inside `<ClientOnly>`, so `chatRef.value` can legitimately
// be null at some moments (SSR fallback, mid-load) — the optional chaining below is load-bearing, not
// defensive filler.
const chatRef = ref<{ abandonConversation: () => unknown } | null>(null);

/**
 * `chatRef` always points at the CURRENTLY MOUNTED `<AgentChat>` — i.e. the conversation the owner is
 * actively viewing, never one merely referenced by an id passed around in the same call. So this must only
 * be called at a point that is GENUINELY leaving the active conversation, never just because some session id
 * (which might belong to a different, unrelated conversation) is involved in the call.
 *
 * The package's own docs say a host that never calls this can have a first-turn queued message resurface in
 * a DIFFERENT conversation within its one-hour TTL — a remount (this component is keyed on the session id)
 * is NOT enough for the package to infer a switch on its own.
 *
 * The call RETURNS the abandoned draft and we DISCARD it DELIBERATELY, not by omission: silently ignoring
 * the return value is how a user's typed message disappears with no trace, so the discard is named.
 */
function leaveConversation(): void {
  const abandonedDraftDiscardedDeliberately = chatRef.value?.abandonConversation();
  void abandonedDraftDiscardedDeliberately;
}

async function openSession(sid: string | null) {
  // Guarded: re-clicking the ALREADY-open conversation (sid === selected.value) is not an exit — chatRef
  // still points at that exact conversation, and abandoning it here would silently destroy its own queued
  // draft and revoke the blob urls it is currently rendering, for no reason at all. Only a REAL switch (a
  // different id, including to/from null) counts as leaving.
  if (sid !== selected.value) leaveConversation();
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
// Starting a new chat is ALWAYS an exit — even from another already-new, unsaved chat — because chatRef
// still points at that unsaved chat's own AgentChat instance and it may hold its own queued draft. This is
// the one call site that must NOT rely on openSession(null)'s internal guard above: when selected.value is
// already null (already in a new chat), that guard would skip its own call, so this fires explicitly and
// unconditionally instead. A second, guarded-out call from the subsequent openSession(null) would be
// harmless if it ever fired (an already-abandoned conversation just returns null again) — but here it
// legitimately does NOT fire a second time, and that is fine: the explicit call above already did the job.
function newChat() { leaveConversation(); newChatSeq.value += 1; void openSession(null); }
async function onCreated(sessionId: string) { selected.value = sessionId; setSessionQuery(sessionId); await refresh(); }
async function onChanged() { await refresh(); }
async function removeSession(sid: string) {
  try { await props.sessions.remove(sid); }
  catch { if (import.meta.client) alert(tns('deleteError')); return; }
  // Deleting a DIFFERENT (non-selected) conversation must NEVER touch the one the owner is actively
  // viewing — chatRef points at THAT one, not at `sid`. So there is deliberately NO unconditional
  // leaveConversation() call here. When `sid` IS the current session, this branch calls openSession(null),
  // whose own guard above (`null !== selected.value`, true here since selected.value === sid still) fires
  // the abandon at exactly the right moment: after the delete has genuinely succeeded (a failed remove()
  // returns above and never reaches here — nothing was deleted, so the owner never left) and while chatRef
  // still points at the conversation actually being left.
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

    <!-- The consent-banner outlet. AgentChat owns the proposal STATE but teleports the banner's DOM here,
         above the chat panel, so the decision never competes with the transcript for the panel's height.
         Always rendered (never v-if'd): a teleport target must exist in the DOM before the teleporting
         child mounts, and this component cannot know when a proposal will arrive. Empty it costs nothing —
         it has no padding, border or margin until it actually holds the banner. -->
    <div id="mp-proposal-outlet" class="mp-kchat-proposal-outlet" />

    <div class="mp-kchat-layout">
      <aside class="mp-kchat-list">
        <UiButton size="sm" variant="solid" color="neutral" block data-test="new-chat" @click="newChat">{{ $t(`${i18nNamespace}.newChat`) }}</UiButton>
        <UiCard v-if="!sessionList?.length" padded>
          <UiEmptyState>{{ $t(`${i18nNamespace}.noConversations`) }}</UiEmptyState>
        </UiCard>
        <ul v-else class="mp-kchat-list__items">
          <li v-for="s in sessionList" :key="s.id" class="mp-kchat-list__item" :class="{ 'is-active': s.id === selected }">
            <button type="button" class="mp-kchat-list__open" :data-test="`session-item-${s.id}`" @click="openSession(s.id)">
              <span class="mp-kchat-list__title">{{ s.title }}</span>
              <span class="mp-kchat-list__meta">
                <UiBadge v-if="s.status" :color="isRunActive(s.status) ? 'green' : 'neutral'" size="xs">{{ $t(`${i18nNamespace}.runStatus.${s.status}`) }}</UiBadge>
                <span class="mp-kchat-list__turns">{{ $t(`${i18nNamespace}.turns`, { n: s.turns }, s.turns) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="mp-kchat-list__del"
              :data-test="`delete-session-${s.id}`"
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
              ref="chatRef"
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
              proposal-teleport-target="#mp-proposal-outlet"
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

/* THE CONSENT BANNER LIVES OUTSIDE THE CARD — which is what makes this section short.
 *
 * The panel is a fixed-height cage so the transcript scrolls INSIDE it instead of growing the page. That
 * is right for a chat and wrong for a consent surface, and the two used to share the cage: a pending
 * proposal forced the console down to 16rem, which is what "the confirmation takes over the whole chat"
 * looked like from the owner's seat.
 *
 * The banner now teleports to `#mp-proposal-outlet` ABOVE this grid (see the template and AgentChat.vue),
 * so it is not in the cage at all. It sizes to its own content, the page scrolls if it is taller than the
 * viewport, and the transcript keeps its full height whether or not a proposal is pending. Nothing has to
 * be redistributed, so nothing has to be measured.
 *
 * WHAT THIS DELETED, AND WHY THAT IS A GAIN. It replaced a `:has()`-driven block that un-caged the card
 * while a proposal was pending. That block was correct but load-bearing in three files at once, and it had
 * a documented degraded path: on a browser without `:has()` (Firefox <121, Safari <15.4, Chrome/Edge <105)
 * the card stayed a cage, and the owner could get a live "Approve changes" button above a reading region
 * measured at 17px of 1018px on a 390x844 phone — the destructive-delete warning included. It was benign
 * only because of two guards in other files. Moving the banner out removes the cage conflict at its root,
 * so there is no longer a degraded path to guard: no `:has()` support is required by this layout.
 *
 * The two guards it depended on still exist and are still correct (`.mp-proposal` carries neither
 * `min-height: 0` nor `overflow: hidden`; `.mp-kchat` scrolls). Do not treat them as dead — they are what
 * keeps the banner unclippable in ANY host, including the inline fallback when no outlet is provided. */
.mp-kchat-proposal-outlet:not(:empty) { margin-bottom: 16px; }

@media (max-width: 720px) {
  .mp-kchat-layout { grid-template-columns: 1fr; }
  /* 85vh, not 70vh. This was originally raised because a consent banner had to share the column; the
     banner has since moved out of the panel, so that reason is gone — but the measurement underneath it
     still applies to the chat alone. On a 390x844 viewport the chat's own chrome costs 383px (the
     agent/theme toolbar wraps to 134px and the Skip Permissions switch to 76px, against 32px and 40px on
     desktop), so a 70vh panel leaves the transcript a very small window. The panel already sits below the
     fold on a phone, so the page scrolls to it either way and the larger share costs nothing. */
  .mp-kchat-panel { height: 85vh; }
}
</style>
