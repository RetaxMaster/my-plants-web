// Pure helpers for the sliding-session server middleware. Kept dependency-free and side-effect-free
// so they unit-test under the plain `node` vitest env (the middleware's Nuxt auto-imports don't).

export interface JwtClaims {
  iat: number; // epoch seconds
  exp: number; // epoch seconds
  sst?: number; // epoch seconds; absent on legacy tokens
}

// Decode a JWT's payload segment WITHOUT verifying the signature — the backend remains the authority;
// the BFF only needs iat/sst to decide *when* to refresh. Returns null on any malformation.
export function decodeJwtPayload(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (typeof obj.iat !== 'number' || typeof obj.exp !== 'number') return null;
    const claims: JwtClaims = { iat: obj.iat, exp: obj.exp };
    if (typeof obj.sst === 'number') claims.sst = obj.sst;
    return claims;
  } catch {
    return null;
  }
}

export type SlideAction = 'slide' | 'refresh';

// Refresh once the token is past the MIDPOINT of its own lifetime (iat→exp), i.e. less than half its
// life remains. Derived from the token's own claims so it auto-adjusts if the backend changes the token
// lifetime — no hardcoded duplicate of JWT_EXPIRES_IN. nowMs in ms; claims.iat/exp in epoch seconds.
export function decideSlide(claims: JwtClaims, nowMs: number): SlideAction {
  const midpointMs = (claims.iat + (claims.exp - claims.iat) / 2) * 1000;
  return nowMs > midpointMs ? 'refresh' : 'slide';
}
