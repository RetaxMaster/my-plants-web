export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' });
  // setUserSession merges (defu) and cannot delete a key — rebuild the session without `actingAs`,
  // preserving identity (user) and the sealed token (secure).
  await replaceUserSession(event, { user: session.user, secure: session.secure });
  return { actingAs: null };
});
