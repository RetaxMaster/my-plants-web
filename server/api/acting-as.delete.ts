export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' });
  // Clearing actingAs is subtle. setUserSession merges via defu, which ignores null/undefined, so it
  // can't remove the key. replaceUserSession's clear() doesn't help either: h3 then re-hydrates the
  // session from the INCOMING request cookie (which still carries actingAs) before applying the new
  // data. The reliable fix is to pass `actingAs: null` explicitly — replaceUserSession's update is an
  // Object.assign, so it overwrites the re-hydrated actingAs with null. Identity (user) and the sealed
  // token (secure) are preserved; consumers treat a null actingAs as "not impersonating".
  await replaceUserSession(event, { user: session.user, secure: session.secure, actingAs: null });
  return { actingAs: null };
});
