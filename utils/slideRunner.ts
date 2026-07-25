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
}
