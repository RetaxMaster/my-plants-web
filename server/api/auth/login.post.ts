export default defineEventHandler(async (event) => {
  const body = await readBody<{ username: string; password: string }>(event);
  const { apiBase } = useRuntimeConfig(event);
  try {
    const res = await $fetch<{ token: string; user: { username: string; ownerId: string; role: 'USER' | 'ADMIN' } }>(
      `${apiBase}/auth/login`,
      {
        method: 'POST',
        body: { username: body?.username, password: body?.password },
      },
    );
    // A fresh login must start as YOURSELF, never inheriting a stale `actingAs` from a previous
    // session on this browser (e.g. an admin who was impersonating navigates to /login and signs in
    // again without logging out). setUserSession can't clear it (defu ignores null); replaceUserSession
    // alone can't either, because its clear() makes h3 re-hydrate `actingAs` from the incoming request
    // cookie before applying the new data. Passing `actingAs: null` explicitly makes replaceUserSession's
    // Object.assign overwrite that re-hydrated value. The JWT goes under `secure` (server-only).
    await replaceUserSession(event, { user: res.user, secure: { token: res.token }, actingAs: null });
    return { user: res.user };
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' });
  }
});
