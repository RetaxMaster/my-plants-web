export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);
  if (session.user?.role !== 'ADMIN') {
    throw createError({ statusCode: 403, statusMessage: 'Admin only' });
  }
  const body = await readBody<{ ownerId?: string }>(event);
  const ownerId = body?.ownerId?.trim();
  if (!ownerId) throw createError({ statusCode: 400, statusMessage: 'ownerId required' });

  const { apiBase } = useRuntimeConfig(event);
  const token = session.secure?.token;
  // Resolve the display label server-side; this also validates the owner exists & is admin-visible.
  const owners = await $fetch<{ ownerId: string; username: string; role: 'USER' | 'ADMIN' | null }[]>(
    `${apiBase}/owners`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const target = owners.find((o) => o.ownerId === ownerId);
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Unknown owner' });

  await setUserSession(event, { actingAs: { ownerId: target.ownerId, label: target.username } });
  return { actingAs: { ownerId: target.ownerId, label: target.username } };
});
