export default defineEventHandler(async (event) => {
  const body = await readBody<{ username: string; password: string }>(event);
  const { apiBase } = useRuntimeConfig(event);
  try {
    const res = await $fetch<{ token: string; user: { username: string; role: 'USER' | 'ADMIN' } }>(
      `${apiBase}/auth/login`,
      {
        method: 'POST',
        body: { username: body?.username, password: body?.password },
      },
    );
    // The JWT goes under `secure` (server-only) so it never reaches the browser.
    await setUserSession(event, { user: res.user, secure: { token: res.token } });
    return { user: res.user };
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' });
  }
});
