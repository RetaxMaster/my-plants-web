/**
 * Reading an error that came back THROUGH the Nuxt BFF proxy (`server/api/[...].ts`).
 *
 * Every backend call in this app is proxied. The proxy catches the upstream failure and re-throws it with
 * h3's `createError({ statusCode, statusMessage, data: <upstream body> })`. h3 serializes that as a JSON
 * body `{ statusCode, statusMessage, stack, data }`, and ofetch hands the client that WHOLE body as
 * `err.data`. So the upstream's own body — the one the API's e2e sees at the top level — sits at
 * `err.data.data` in the browser, ONE LEVEL DEEPER than anywhere else, and the envelope contributes NO
 * `message` of its own (see `upstreamErrorMessage` below for why that second fact matters as much).
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
  // The h3 envelope. Accepted only when `data` is a plain object: h3 also emits `statusCode`/`statusMessage`
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
 * row that has vanished, which is outside `AgentProposalStatus`. A read type NARROWER than what the
 * server can emit lies to the compiler exactly where it matters.
 */
export function upstreamErrorStatus(err: unknown): string | undefined {
  const status = upstreamErrorBody(err)?.status;
  return typeof status === 'string' ? status : undefined;
}

/**
 * THE UPSTREAM'S OWN MESSAGE, as one string. `''` when there is none.
 *
 * ⚠️ THIS EXISTS BECAUSE READING `err.data.message` DIRECTLY IS ALWAYS WRONG, AND FAILS SILENTLY.
 *
 * MEASURED, not assumed — `server/api/proxy.wire.test.ts` drives the real proxy over a real socket and
 * pins this. A 400 whose API body is `{ message: 'wateringRelation is required: …' }` reaches the browser
 * as an error whose `data` is `{ statusCode, statusMessage, stack, data: <the API body> }`. Note what is
 * NOT there: the envelope has **no `message` key at all**. So a caller reading `err.data.message` gets
 * `undefined`, and the usual `?? err.message` fallback lands on ofetch's own summary —
 * `[GET] "http://…/api/…": 400 Bad Request` — which names the method, the URL and the status, and none of
 * the API's words. A caller that tests either one against anything (`.includes('wateringRelation')`, a
 * code, a substring) gets a confident `false` and falls through to its generic branch. Nothing throws;
 * nothing is logged; the recovery code simply never runs.
 *
 * That is not hypothetical. `SoilReadingModal.vue` carried TWO such branches — reveal the same-day-watering
 * question the server says is missing, and explain a future `measuredOn` — and QA (2026-08-10) found the
 * survey dead-ending on a plant watered earlier that day, with "we couldn't save that reading, please try
 * again" on a request that could never succeed. Both branches were correct. Neither had ever executed.
 *
 * Nest sends `message` as a STRING for a thrown `BadRequestException(string)` and as a STRING[] when a
 * validation pipe maps issues (`ZodValidationPipe` does exactly that). Both are joined here so a caller
 * never has to know which shape it got — the difference is an implementation detail of the throw site, and
 * making every consumer branch on it is how one of them ends up handling only the shape it was written
 * against.
 */
export function upstreamErrorMessage(err: unknown): string {
  const message = upstreamErrorBody(err)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join('; ');
  return '';
}

/** The HTTP status code of a proxied failure, from whichever field the client library populated. */
export function upstreamErrorCode(err: unknown): number | undefined {
  const e = err as { statusCode?: number; response?: { status?: number } } | null | undefined;
  return e?.statusCode ?? e?.response?.status;
}
