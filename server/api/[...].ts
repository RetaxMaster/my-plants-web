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

  // Forward the owner's LOCALE to the API, on every request.
  //
  // Some API responses are display strings the SERVER owns and the browser is forbidden to re-derive —
  // the Plant Doctor consent surface is the strict case: its field labels and enum values must arrive
  // already rendered, because a browser that translated them would become a second, drifting description
  // of the write the owner is approving (spec §5.4). The server can only honour that if it knows which
  // language to answer in.
  //
  // Read from the i18n COOKIE rather than plumbing a locale argument through every call site: the locale
  // is internal state + this cookie (`no_prefix` strategy — it is never in the URL), the BFF already
  // receives the cookie on every request, and doing it here means no endpoint can be added later that
  // silently forgets to pass it. `i18n_redirected` is the `detectBrowserLanguage.cookieKey` configured in
  // nuxt.config.ts; keep the two in step.
  //
  // Sanitized before forwarding: this value is attacker-controllable (a cookie is just a request header),
  // and it must never be able to inject a second header or an arbitrary payload. A locale tag is
  // letters, digits and hyphens — anything else is dropped and the API falls back to its own default.
  const locale = parseCookies(event).i18n_redirected;
  if (locale && /^[A-Za-z0-9-]{2,20}$/.test(locale)) headers['x-locale'] = locale;

  // Read the raw body binary-safe (Buffer, not a UTF-8 string): multipart image uploads carry raw
  // binary bytes that a default 'utf8' decode would mangle (invalid sequences → U+FFFD), breaking the
  // backend's image decode. ofetch/$fetch forwards a Buffer body untouched and JSON parses fine from it.
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(event, false);

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
