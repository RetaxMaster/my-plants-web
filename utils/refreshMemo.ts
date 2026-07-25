// Server-side (single Nitro process) single-flight + resolved-token memo for the sliding-session refresh,
// keyed by the ORIGINAL incoming jti. Pure + dependency-free so it unit-tests under the node vitest env
// (the middleware's Nuxt auto-imports do not). See the sliding-session cascade: multiple SSR sub-calls of
// one render replay the SAME past-midpoint jti; without a RESULT memo a sequential slide re-refreshes.

export interface RefreshResult {
  token: string;
}

// Chosen to sit in `worst-case-SSR-render < MEMO_TTL_MS < SESSION_REFRESH_GRACE_MS (60s)`. The lower bound
// yields one refresh per render; the upper bound guarantees the memo cannot serve a token past the
// superseded jti's server-side grace (the web never learns the server's effectiveAt).
export const MEMO_TTL_MS = 30_000;
// A tombstone must outlive the longest in-flight refresh a logout could race. Kept at the grace length.
export const TOMBSTONE_TTL_MS = 60_000;
// The refresh POST MUST be bounded strictly below TOMBSTONE_TTL_MS. A logout tombstones the jti for
// TOMBSTONE_TTL_MS; if a slide's refresh could resolve AFTER that window (the API hung), applySlide would
// find the tombstone already expired and replace the session — reopening a logged-out session. Capping the
// refresh below the tombstone lifetime guarantees any refresh in flight at logout resolves (or aborts)
// while the tombstone is still active, so it can never reopen the session. Invariant: this < TOMBSTONE_TTL_MS.
export const REFRESH_TIMEOUT_MS = 20_000;

interface MemoEntry {
  expiresAt: number;
  promise?: Promise<RefreshResult>; // in-flight
  result?: RefreshResult;           // resolved (reused within TTL)
}

const memo = new Map<string, MemoEntry>();
const tombstones = new Map<string, number>(); // jti -> tombstone expiry (ms)

// Bounded cleanup so the two maps cannot grow for the life of the Nitro process. A superseded/logged-out
// jti is normally never queried again, so its expired memo/tombstone entry would otherwise leak forever.
// Only RESOLVED-and-expired memo entries are dropped (never one with an in-flight promise — that would let
// a concurrent call re-issue a duplicate refresh); expired tombstones are safe to drop because the bounded
// refresh (REFRESH_TIMEOUT_MS < TOMBSTONE_TTL_MS) guarantees no in-flight refresh can outlive the tombstone.
function prune(now: number): void {
  for (const [key, entry] of memo) {
    if (!entry.promise && now >= entry.expiresAt) memo.delete(key);
  }
  for (const [key, until] of tombstones) {
    if (now >= until) tombstones.delete(key);
  }
}

export async function singleFlightRefresh(
  jti: string,
  now: number,
  doRefresh: () => Promise<RefreshResult>,
): Promise<RefreshResult> {
  const existing = memo.get(jti);
  if (existing && now < existing.expiresAt) {
    if (existing.result) return existing.result;       // sequential reuse
    if (existing.promise) return existing.promise;      // concurrent dedupe
  }
  prune(now);
  const entry: MemoEntry = { expiresAt: now + MEMO_TTL_MS };
  entry.promise = doRefresh()
    .then((result) => { entry.result = result; entry.promise = undefined; return result; })
    .catch((err) => { memo.delete(jti); throw err; }); // reject → evicted, next call re-issues
  memo.set(jti, entry);
  return entry.promise;
}

export function tombstoneJti(jti: string, now: number): void {
  prune(now);
  tombstones.set(jti, now + TOMBSTONE_TTL_MS);
}

export function isTombstoned(jti: string, now: number): boolean {
  const until = tombstones.get(jti);
  if (until === undefined) return false;
  if (now >= until) { tombstones.delete(jti); return false; }
  return true;
}

export function invalidateMemo(jti: string): void {
  memo.delete(jti);
}

// Test-only: reset module state between cases.
export function __resetMemoForTest(): void {
  memo.clear();
  tombstones.clear();
}

// Test-only: observe the live map sizes to prove bounded cleanup (Finding 7).
export function __mapSizesForTest(): { memo: number; tombstones: number } {
  return { memo: memo.size, tombstones: tombstones.size };
}
