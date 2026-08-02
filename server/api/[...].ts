import { IDEMPOTENCY_KEY_HEADER } from '@retaxmaster/my-plants-species-schema';
import { isChatAttachmentPath } from '../../utils/chatAttachmentPath.js';

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

  // Forward the browser's IDEMPOTENCY KEY to the API, when present.
  //
  // The key is a client-generated opaque token (a UUID minted in the browser) the API uses to recognize a
  // retried createPlant submission as the SAME attempt rather than a second plant — without this header
  // reaching NestJS, that whole safeguard is a silent no-op end to end. `getRequestHeader` is h3's
  // case-insensitive lookup, so this reads the header regardless of how the browser cased it.
  //
  // Sanitized before forwarding for the same reason `x-locale` is: this value is attacker-controllable (any
  // request header is), and it must never be able to inject a second header or an arbitrary payload into
  // the upstream request. A token is bounded, printable, CRLF-free ASCII — anything else is dropped and the
  // request proceeds with no idempotency key, same as if the browser had never sent one. The 191 upper bound
  // matches the API's `idempotency_keys.key` VARCHAR(191) column exactly: a longer key would otherwise pass
  // this check and only fail once it reaches the database, so it is dropped here instead — same non-idempotent
  // fallback as an over-length or malformed key.
  const idempotencyKey = getRequestHeader(event, IDEMPOTENCY_KEY_HEADER);
  if (idempotencyKey && /^[A-Za-z0-9._~+/=-]{1,191}$/.test(idempotencyKey)) {
    headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
  }

  // Read the raw body binary-safe (Buffer, not a UTF-8 string): multipart image uploads carry raw
  // binary bytes that a default 'utf8' decode would mangle (invalid sequences → U+FFFD), breaking the
  // backend's image decode. ofetch/$fetch forwards a Buffer body untouched and JSON parses fine from it.
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(event, false);

  // ── THE BINARY BRANCH (spec 2026-08-01 §3.4) ─────────────────────────────────────────────────────
  //
  // Chat-attachment recall is the ONLY route in this app whose response is not JSON, and the generic
  // passthrough below cannot carry it: `$fetch` returns the PARSED body (a byte array becomes an
  // index-keyed object, invalid UTF-8 becomes U+FFFD), and the catch rebuilds the failure through
  // `createError`, which renumbers nothing but re-wraps everything and drops the upstream headers.
  //
  // So these paths get the response side of the same discipline the request side already has
  // (`readRawBody(event, false)` — binary-safe, never UTF-8-decoded): fetch, copy the upstream STATUS
  // and CONTENT-TYPE verbatim, and write the raw bytes through untouched.
  //
  // The status matters as much as the bytes. A 410 is the COMMON answer for an old conversation (the
  // engine's 48 h retention), and it is what tells the browser to render an honest "this image is no
  // longer available" placeholder instead of an error — a proxy that flattened it would make normal
  // behaviour look broken.
  if (method === 'GET' && isChatAttachmentPath(path)) {
    const upstream = await fetch(`${apiBase}${path}`, { method: 'GET', headers });
    setResponseStatus(event, upstream.status);
    const upstreamType = upstream.headers.get('content-type');
    if (upstreamType) setResponseHeader(event, 'content-type', upstreamType);
    // A Buffer returned from an h3 handler is sent as-is — no serializer, no re-encode.
    return Buffer.from(await upstream.arrayBuffer());
  }

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
