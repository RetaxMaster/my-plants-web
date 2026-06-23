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
    // replaceUserSession (not setUserSession) so a fresh login starts as YOURSELF: setUserSession
    // merges via defu and would leave a stale `actingAs` from a previous session on this browser,
    // making the new login silently start while impersonating. Replacing rebuilds the session clean.
    // The JWT goes under `secure` (server-only) so it never reaches the browser.
    await replaceUserSession(event, { user: res.user, secure: { token: res.token } });
    return { user: res.user };
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' });
  }
});
