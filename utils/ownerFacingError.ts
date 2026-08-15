/**
 * THE ONE SEAM THAT TURNS A FAILED CARE WRITE INTO SOMETHING THE OWNER CAN READ (F1+F3, 2026-08-15).
 *
 * `TaskRow.vue`'s Done/Postpone buttons, and every mutating form on top of `useApi()`, can fail for a
 * reason worth SHOWING the owner (a validation refusal, a same-day conflict) or for a reason that is not
 * (a stack trace, an ofetch summary line, a bare "Bad Request"). `upstreamErrorMessage` (`./upstreamError.js`)
 * already does the hard part — reading the API's own words out from under the Nuxt BFF's envelope — but it
 * hands back WHATEVER string sits there, and not every string it can legitimately return is one an owner
 * should be shown. This function is the ONE place that decides which is which; no caller re-derives that
 * judgment.
 *
 * ---- THE MEASURED SHAPE THIS FUNCTION IS BUILT AGAINST (measured 2026-08-15, do not re-measure) ---------
 *
 * The API's real 400 body, for a back-dated-in-the-future measurement, reads:
 *
 *   {"message":"occurredOn must be today or earlier for this plant (its local today is 2026-08-15, you
 *   sent 2027-01-01)","error":"Bad Request","statusCode":400}
 *
 * — and plant CREATION answers the identical sentence shape with `acquiredOn` in place of `occurredOn`.
 * Through the Nuxt BFF that body arrives at `err.data.data` (see `upstreamError.ts`'s own file-header
 * comment for the proxy's nesting). What matters here is what ELSE arrives alongside it: the h3 envelope
 * sitting at `err.data` ALSO carries a top-level `message` field whose value is the STATUS PHRASE
 * (`"Bad Request"`, `"Not Found"`, …) — never the API's own words — plus a top-level `url` naming the
 * request that failed. That is exactly why rule 3 below has an explicit guard instead of trusting whatever
 * string `upstreamErrorMessage` hands back: `upstreamErrorBody`'s FALLBACK branch (no `err.data.data` to
 * read, so it returns the envelope `err.data` itself) can legitimately return that status-phrase object,
 * and `upstreamErrorMessage` would then read `"Bad Request"` off it — a string that LOOKS like a real
 * message and says nothing at all. Rendering it verbatim would be worse than the generic fallback: an
 * owner reading "Bad Request" learns nothing about what he did wrong and nothing about what to do next.
 *
 * ---- THE THREE RULES, IN ORDER ----------------------------------------------------------------------
 *
 * 1. A "must be today or earlier" refusal gets `reading.measuredOnFuture`, not the raw sentence. This is
 *    `SoilReadingModal.vue`'s own existing pattern (`upstreamMessage.includes('measuredOn')` →
 *    `t('reading.measuredOnFuture')`) — EXTENDED to every caller of this seam, never re-invented. The match
 *    is on the trailing clause (`/must be today or earlier/i`), not on the field name, because the API
 *    phrases the SAME refusal with a different field per surface (`occurredOn` for a care completion,
 *    `acquiredOn` for plant registration) and the owner-facing sentence is identical either way.
 *    ⚠️ KNOWN LIMITATION: this matches an ENGLISH server sentence by substring. If the API's guard message
 *    is reworded, this rule silently stops firing and the case falls through to rule 2 — the API's own
 *    (still English, still honest, just less warmly phrased) sentence — never to rule 4's generic fallback
 *    and never to silence. Degrading to "honest and foreign" rather than "wrong" or "empty" is what makes
 *    this an acceptable failure mode instead of a defect that has to be caught before it ships.
 *
 * 2. Anything else that reads as OWNER-READABLE is shown verbatim — see `isOwnerReadable` below for the
 *    exact test. This is the common case: a Zod validation message, a domain refusal
 *    ("wateringRelation is required: …"), a 409 conflict explanation. These are written FOR a reader, in
 *    plain English, and the owner is the reader.
 *
 * 3. Everything else — empty, an ofetch summary (`[POST] "http://…/api/…": 400 Bad Request`), a message
 *    containing a URL, or a bare HTTP status phrase — falls back to `common.errorGeneric`. This is the
 *    branch the measured fallback shape above exists to protect: without it, a client-side failure whose
 *    BFF envelope carries no inner body at all (a network drop before the request ever reached the API, a
 *    malformed proxy response) would show the owner "Bad Request" and nothing else.
 *
 * `reading.measuredOnFuture` IS REUSED HERE RATHER THAN RELOCATED to a neutral, task-agnostic key. Its
 * English text ("That day hasn't happened yet — pick today or earlier.") never mentions soil readings or
 * measurements, so it already reads correctly for a plant's `acquiredOn` or a repot's `occurredOn` — moving
 * it to a new key would redden three tests `SoilReadingModal.test.ts` already pins, for zero behavioural
 * gain to any caller.
 */
import { upstreamErrorMessage } from './upstreamError.js';

/** Rule 1's match — see the file-header comment for why it is the trailing clause, not the field name. */
const MEASURED_ON_FUTURE_PATTERN = /must be today or earlier/i;

/** ofetch's own summary line shape: `[POST] "http://…": 400 Bad Request` — the method in brackets, a space,
 *  then the rest. Never the API's own words, always this exact prefix shape. */
const OFETCH_SUMMARY_PREFIX = /^\[[A-Z]+\]\s/;

/**
 * The bare HTTP status phrases NestJS/h3 use as `statusMessage` (and, per the measured fallback shape
 * above, sometimes as the envelope's own `message`). Lowercase, matched against the trimmed, lowercased
 * input — never the API's own words, and never useful shown alone.
 */
const BARE_STATUS_PHRASES = new Set([
  'bad request', 'unauthorized', 'payment required', 'forbidden', 'not found',
  'method not allowed', 'request timeout', 'conflict', 'gone', 'payload too large',
  'unprocessable entity', 'too many requests', 'internal server error', 'not implemented',
  'bad gateway', 'service unavailable', 'gateway timeout',
]);

/** Rule 2's own test — see the file-header comment for the full reasoning behind each guard. */
function isOwnerReadable(raw: string): boolean {
  if (!raw) return false;
  if (OFETCH_SUMMARY_PREFIX.test(raw)) return false;
  if (raw.includes('http://') || raw.includes('https://')) return false;
  if (BARE_STATUS_PHRASES.has(raw.toLowerCase().trim())) return false;
  return true;
}

/**
 * THE seam. Every mutating call site that wants to show the OWNER a reason for a failed write calls this —
 * never `upstreamErrorMessage` directly, and never `(e as Error).message`. See the file-header comment for
 * the three rules, in order, and the measured envelope shape they are built against.
 */
export function ownerFacingErrorMessage(
  err: unknown,
  t: (key: string, named?: Record<string, unknown>) => string,
): string {
  const raw = upstreamErrorMessage(err).trim();
  if (MEASURED_ON_FUTURE_PATTERN.test(raw)) return t('reading.measuredOnFuture');
  if (isOwnerReadable(raw)) return raw;
  return t('common.errorGeneric');
}
