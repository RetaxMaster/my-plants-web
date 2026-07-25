import { applySlide, type SlideDeps } from '~/utils/slideRunner';
import { REFRESH_TIMEOUT_MS } from '~/utils/refreshMemo';

// Slides the session on every authenticated /api/** request. All refresh/clear/replace LOGIC lives in the
// tested pure `applySlide` (utils/slideRunner.ts); this handler only supplies the real Nuxt side effects.
//   Clock A (cookie) — always re-issued so its Max-Age never lapses.
//   Clock B (JWT)    — lazily re-minted via POST /auth/refresh once past the token's midpoint, single-flighted.
export default defineEventHandler(async (event) => {
  const path = event.path;
  if (!path.startsWith('/api/')) return;
  if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/logout')) return;
  if (path.startsWith('/api/acting-as')) return;   // owns its own session write
  if (path.startsWith('/api/_auth/session')) return; // nuxt-auth-utils' OWN session endpoint — never double-seal

  const session = await getUserSession(event);
  const token = session.secure?.token;
  if (!session.user || !token) return; // anonymous — nothing to slide

  const { apiBase } = useRuntimeConfig(event);
  const deps: SlideDeps = {
    refresh: (bearer) =>
      $fetch<{ token: string }>(`${apiBase}/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        // Bounded strictly below the logout tombstone lifetime so a hung refresh can never resolve after
        // the tombstone lapses and reopen a logged-out session (see REFRESH_TIMEOUT_MS). On timeout the
        // fetch aborts and applySlide's catch returns without replacing the session.
        timeout: REFRESH_TIMEOUT_MS,
      }),
    replaceSession: async (newToken) => {
      // Preserve user + actingAs; explicit `actingAs: null` fallback stops h3 re-hydrating a stale value
      // from the incoming cookie (same reasoning as login.post.ts / acting-as.delete.ts).
      await replaceUserSession(event, {
        user: session.user,
        secure: { token: newToken },
        actingAs: session.actingAs ?? null,
      });
    },
    clearSession: async () => { await clearUserSession(event); },
    slideCookie: async () => { await setUserSession(event, {}); },
  };

  await applySlide(deps, token, Date.now());
});
