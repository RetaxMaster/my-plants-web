export default defineEventHandler(async (event) => {
  const { apiBase } = useRuntimeConfig(event);
  const session = await getUserSession(event);
  const token = session.secure?.token;
  if (token) {
    try {
      await $fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* expired/invalid upstream — still clear locally */
    }
  }
  await clearUserSession(event);
  return { ok: true };
});
