import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, decideSlide } from './sessionSlide.js';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('decodeJwtPayload', () => {
  it('decodes iat/sst/exp from a well-formed token', () => {
    const claims = decodeJwtPayload(fakeJwt({ iat: 100, sst: 50, exp: 999 }));
    expect(claims).toEqual({ iat: 100, sst: 50, exp: 999 });
  });
  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('a.%%%.c')).toBeNull();
  });
  it('returns null when iat/exp are missing or non-numeric', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeJwtPayload(`h.${b64({ sub: 'x' })}.s`)).toBeNull();
  });
});

describe('decideSlide', () => {
  const iat = 1_000_000, exp = iat + 30 * 24 * 60 * 60; // 30-day token
  const midMs = (iat + (exp - iat) / 2) * 1000;
  it("returns 'slide' before the token's midpoint", () => {
    expect(decideSlide({ iat, exp }, midMs - 1000)).toBe('slide');
  });
  it("returns 'refresh' after the token's midpoint", () => {
    expect(decideSlide({ iat, exp }, midMs + 1000)).toBe('refresh');
  });
});
