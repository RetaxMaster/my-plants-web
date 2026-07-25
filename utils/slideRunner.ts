import { decodeJwtPayload, decideSlide } from './sessionSlide.js';
import { singleFlightRefresh, isTombstoned, invalidateMemo } from './refreshMemo.js';

export interface SlideDeps {
  refresh: (token: string) => Promise<{ token: string }>;
  replaceSession: (newToken: string) => Promise<void>;
  clearSession: () => Promise<void>;
  slideCookie: () => Promise<void>;
}

function isCapExpiry(err: unknown): boolean {
  const msg = (err as { data?: { message?: string } })?.data?.message
    ?? (err as { message?: string })?.message;
  return msg === 'Session expired';
}

export async function applySlide(deps: SlideDeps, token: string, nowMs: number): Promise<void> {
  const claims = decodeJwtPayload(token);
  if (!claims) { await deps.clearSession(); return; }

  if (decideSlide(claims, nowMs) !== 'refresh') { await deps.slideCookie(); return; }

  const jti = claims.jti ?? token;
  let result: { token: string };
  try {
    result = await singleFlightRefresh(jti, nowMs, () => deps.refresh(token));
  } catch (err) {
    if (isCapExpiry(err)) await deps.clearSession();
    return;
  }

  if (isTombstoned(jti, Date.now())) { invalidateMemo(jti); return; }
  await deps.replaceSession(result.token);
  // Check-then-act gap: a concurrent logout can tombstone this jti DURING the await above — between the
  // pre-check and the cookie write. When it does, the session we just re-issued must be torn back down, or
  // a late slide reopens a logged-out session (the exact revocation-cascade class this slide fixes). The
  // re-check is the last op on the request, so the response carries the cleared cookie.
  if (isTombstoned(jti, Date.now())) { await deps.clearSession(); }
}
