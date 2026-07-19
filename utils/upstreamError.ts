/**
 * Reading an error that came back THROUGH the Nuxt BFF proxy (`server/api/[...].ts`).
 *
 * Every backend call in this app is proxied. The proxy catches the upstream failure and re-throws it with
 * h3's `createError({ statusCode, statusMessage, data: <upstream body> })`. h3 serializes that as a JSON
 * body `{ statusCode, statusMessage, message, data }`, and ofetch hands the client that WHOLE body as
 * `err.data`. So the upstream's own body — the one the API's e2e sees at the top level — sits at
 * `err.data.data` in the browser, ONE LEVEL DEEPER than anywhere else.
 *
 * That single level is not trivia. `err.data.status` reads `undefined` instead of `'EXPIRED'`, and an
 * expired proposal was therefore explained to the owner as "someone else resolved this" — on the consent
 * surface, where the owner's whole model of what happened comes from that one sentence.
 *
 * This module is the ONE place that knows the envelope. Consumers ask for the upstream body or its status
 * and never index into `data.data` themselves; when the proxy's shape changes, it changes here.
 */

/** The upstream (NestJS) response body, unwrapped from the BFF envelope. `null` when there is none. */
export function upstreamErrorBody(err: unknown): Record<string, unknown> | null {
  const outer = (err as { data?: unknown } | null | undefined)?.data;
  // The h3 envelope. Accepted only when `data` is a plain object: h3 also emits `statusMessage`/`message`
  // siblings, and a non-object `data` is not a body we can read fields out of.
  const inner = (outer as { data?: unknown } | null | undefined)?.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>;
  // Fallback: an error raised on the CLIENT side of the proxy (a direct `$fetch`, or a future non-proxied
  // call) is already un-nested. Reading both shapes is deliberate and is the SAFE direction — the harm
  // here is only ever failing to find a field, never inventing one.
  if (outer && typeof outer === 'object' && !Array.isArray(outer)) return outer as Record<string, unknown>;
  return null;
}

/**
 * The upstream body's `status` field, when it is a string.
 *
 * Deliberately typed as `string | undefined` rather than a status enum: the API answers `'UNKNOWN'` for a
 * row that has vanished, which is outside `DoctorProposalStatus`. A read type NARROWER than what the
 * server can emit lies to the compiler exactly where it matters.
 */
export function upstreamErrorStatus(err: unknown): string | undefined {
  const status = upstreamErrorBody(err)?.status;
  return typeof status === 'string' ? status : undefined;
}

/** The HTTP status code of a proxied failure, from whichever field the client library populated. */
export function upstreamErrorCode(err: unknown): number | undefined {
  const e = err as { statusCode?: number; response?: { status?: number } } | null | undefined;
  return e?.statusCode ?? e?.response?.status;
}
