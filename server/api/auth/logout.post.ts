import { decodeJwtPayload } from '~/utils/sessionSlide';
import { tombstoneJti, invalidateMemo } from '~/utils/refreshMemo';

export default defineEventHandler(async (event) => {
  const { apiBase } = useRuntimeConfig(event);
  const session = await getUserSession(event);
  const token = session.secure?.token;
  if (token) {
    // Tombstone FIRST: a slide refresh already in flight must be discarded when it resolves, not allowed
    // to reopen the session we are closing (utils/slideRunner.ts re-checks the tombstone before writing).
    const jti = decodeJwtPayload(token)?.jti;
    if (jti) { tombstoneJti(jti, Date.now()); invalidateMemo(jti); }
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
