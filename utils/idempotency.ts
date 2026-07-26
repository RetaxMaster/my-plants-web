// Global, agnostic client plumbing for the createPlant-idempotency feature (Task 8): given a request's
// method + path + existing fetch opts, decides whether to attach an `Idempotency-Key` header and returns a
// NEW opts object — never mutates the caller's. Pure (no Nuxt/composable imports) so it unit-tests directly
// under plain node/vitest; `composables/useApi.ts`'s `api()` is the sole caller (Task 9's plant-create flow
// then PINS its own key by pre-setting the header before calling `api()`, which this helper must preserve).
import { IDEMPOTENCY_KEY_HEADER } from '@retaxmaster/my-plants-species-schema';

// Only POST is in scope. PATCH/PUT/DELETE already mutate a resource identified by its URL, so a network
// retry is naturally idempotent by path — adding a key there would be scope creep with no defect it fixes.
// A missing method defaults to GET (ofetch's own default), which never attaches a key either way.
const MUTATING_METHOD = 'POST';

// Belt-and-suspenders per the design: the nuxt-auth-utils `/api/_auth/*` endpoints are never routed through
// `api()`'s NestJS proxy in the first place (they're handled by nuxt-auth-utils itself), so this only guards
// a theoretical future `/auth/*` NestJS route from ever being auto-tagged. Case-insensitive, matches any
// path starting with `/auth/`.
function isExcludedPath(path: string): boolean {
  return /^\/auth\//i.test(path);
}

// Fetch/HTTP header names are case-insensitive on the wire, but a plain JS object key lookup is not — find
// the existing key (if any) so a caller-pinned `idempotency-key` / `IDEMPOTENCY-KEY` / etc. is recognized
// and never double-set under a second casing.
function findHeaderKey(headers: Record<string, unknown>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(headers).find((k) => k.toLowerCase() === lower);
}

// This codebase's `opts.headers` is always a plain object (or undefined) at every call site today — no
// caller passes a `Headers` instance or a tuple array through `useApi.ts`. Handling only those two shapes
// (undefined + plain object) keeps this pure and simple, as documented in the task; a future call site
// wanting `Headers`/array support would need this helper extended, not worked around.
export interface OptsWithHeaders {
  method?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Returns a NEW opts object with an `Idempotency-Key` header attached, IFF:
 *   - `method` is a mutating POST (uppercase-compared; a missing method is treated as GET → no attach), AND
 *   - `path` is not excluded (currently: anything starting with `/auth/`, case-insensitive).
 *
 * If the caller already pinned a key in `opts.headers` (case-insensitive header-name match), that pinned
 * key is preserved untouched — this is the path plant-create (Task 9) uses to control its own retry key.
 * Otherwise a fresh key is minted per call via `crypto.randomUUID()` (available in both the browser and
 * Node 18+/SSR via `globalThis.crypto`).
 *
 * The caller's `opts` (and its `opts.headers`) are never mutated — a new object is always returned, even
 * on the no-op branches, so callers can rely on referential-transparency semantics.
 */
// Not generic on purpose: every call site (useApi.ts's api(), and this file's own tests) either casts the
// input `as any` or works fine against this single stable shape — a generic that tried to preserve the
// caller's exact input type would infer down to the narrow literal type of whatever was passed at each
// call site (including `undefined`), which breaks reading `.headers` back off the result.
export function withIdempotencyKey(
  method: string | undefined,
  path: string,
  opts?: OptsWithHeaders,
): OptsWithHeaders {
  const upperMethod = (method ?? 'GET').toUpperCase();
  const base = opts ?? {};

  if (upperMethod !== MUTATING_METHOD || isExcludedPath(path)) {
    // No-op branch, but still return a fresh shallow copy so "return a NEW opts object" holds unconditionally.
    return { ...base };
  }

  const existingHeaders = { ...(base.headers ?? {}) };
  const pinnedKey = findHeaderKey(existingHeaders, IDEMPOTENCY_KEY_HEADER);
  const headerName = pinnedKey ?? IDEMPOTENCY_KEY_HEADER;
  const value = pinnedKey ? existingHeaders[pinnedKey] : crypto.randomUUID();

  return {
    ...base,
    headers: {
      ...existingHeaders,
      [headerName]: value,
    },
  };
}
