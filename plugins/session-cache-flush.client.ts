import { flushClientGetCache } from '~/composables/useApi';

// Flush the app-scoped client GET cache whenever the authenticated identity changes, so cached reads from
// one session/owner can never be served to the next in the SAME TAB without a full reload. The client cache
// (composables/useApi.ts) is keyed only by path, and login/logout are SPA navigations (navigateTo), not
// reloads — so a same-tab account switch (User A logs out → User B logs in) would otherwise hand User A's
// cached /plants, /plants/:id, etc. to User B. Keyed on username + the acting-as owner: a change in either
// clears the cache. This makes the "never across users" guarantee structural, covering login, logout, the
// forced-401 logout (session.clear()), and an acting-as switch — not just the acting-as hard reload.
export default defineNuxtPlugin(() => {
  const { user, session } = useUserSession();
  const identity = () => `${user.value?.username ?? ''}::${session.value?.actingAs?.ownerId ?? ''}`;
  // `flush: 'sync'` so the cache is cleared the instant the identity ref changes — before any deferred
  // render/navigation tick could issue a GET on the incoming identity and read a previous user's entry.
  watch(identity, (next, prev) => {
    if (next !== prev) flushClientGetCache();
  }, { flush: 'sync' });
});
