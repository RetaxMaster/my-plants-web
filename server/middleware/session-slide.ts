import { decodeJwtPayload, decideSlide } from '~/utils/sessionSlide';

// Slides the session on every authenticated API request:
//   Clock A (cookie) — always re-issued so its Max-Age never lapses.
//   Clock B (JWT)    — lazily re-minted via POST /auth/refresh once the token is >15 days old.
// Scoped to /api/** (every meaningful authenticated interaction — including the on-load /api/auth/me —
// hits the API), excluding the auth endpoints which own their own session writes. Non-API and asset
// requests are ignored so we don't re-seal on every static asset.
export default defineEventHandler(async (event) => {
  const path = event.path;
  if (!path.startsWith('/api/')) return;
  if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/logout')) return;
  if (path.startsWith('/api/acting-as')) return; // owns its own session write — don't double-seal

  const session = await getUserSession(event);
  const token = session.secure?.token;
  if (!session.user || !token) return; // anonymous — nothing to slide

  const claims = decodeJwtPayload(token);
  if (!claims) {
    // An undecodable token can never be forwarded successfully — clear so the request 401s cleanly.
    await clearUserSession(event);
    return;
  }

  if (decideSlide(claims, Date.now()) === 'refresh') {
    const { apiBase } = useRuntimeConfig(event);
    try {
      const res = await $fetch<{ token: string }>(`${apiBase}/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      // Preserve user + actingAs; the explicit `actingAs: null` fallback prevents h3 from re-hydrating
      // a stale value from the incoming cookie (same reasoning as login.post.ts / acting-as.delete.ts).
      await replaceUserSession(event, {
        user: session.user,
        secure: { token: res.token },
        actingAs: session.actingAs ?? null,
      });
    } catch (err: unknown) {
      const status = (err as { statusCode?: number; response?: { status?: number } })?.statusCode
        ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        // Hard failure (token revoked / past the 90-day cap) — clear → clean re-login.
        await clearUserSession(event);
      }
      // Transient failure (no status / 5xx): keep the still-valid token and retry next request.
    }
  } else {
    // Token still fresh — re-issue the cookie so Clock A's Max-Age resets.
    await setUserSession(event, {});
  }
});
