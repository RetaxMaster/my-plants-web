export default defineEventHandler(async (event) => {
  const { apiBase } = useRuntimeConfig(event);
  const session = await getUserSession(event);
  const token = session.secure?.token;

  // event.path is like "/api/plants?x=1"; strip the leading "/api" so it maps to NestJS.
  const path = event.path.replace(/^\/api/, '');
  const method = event.method;

  // Build a clean header set: never forward the incoming Host/Cookie to NestJS.
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (session.actingAs?.ownerId) headers['x-act-as-owner'] = session.actingAs.ownerId;
  const contentType = getRequestHeader(event, 'content-type');
  if (contentType) headers['content-type'] = contentType;

  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(event);

  try {
    return await $fetch(`${apiBase}${path}`, { method, headers, body });
  } catch (err: unknown) {
    // Surface the upstream status (notably 401) to the client.
    const e = err as {
      statusCode?: number;
      statusMessage?: string;
      data?: unknown;
      response?: { status?: number };
    };
    throw createError({
      statusCode: e?.statusCode ?? e?.response?.status ?? 500,
      statusMessage: e?.statusMessage ?? 'Upstream error',
      data: e?.data,
    });
  }
});
