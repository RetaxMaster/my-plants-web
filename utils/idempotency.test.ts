import { describe, expect, it } from 'vitest';
import { withIdempotencyKey } from './idempotency.js';

describe('withIdempotencyKey', () => {
  it('attaches a non-empty Idempotency-Key to a POST with no pinned key', () => {
    const result = withIdempotencyKey('POST', '/plants', undefined);
    const key = result?.headers?.['Idempotency-Key'];
    expect(typeof key).toBe('string');
    expect(key!.length).toBeGreaterThan(0);
  });

  it('mints a DIFFERENT key on two separate calls', () => {
    const a = withIdempotencyKey('POST', '/plants', undefined);
    const b = withIdempotencyKey('POST', '/plants', undefined);
    expect(a?.headers?.['Idempotency-Key']).not.toBe(b?.headers?.['Idempotency-Key']);
  });

  it('preserves a caller-pinned key instead of overwriting it', () => {
    const opts = { method: 'POST', headers: { 'Idempotency-Key': 'pinned-123' } };
    const result = withIdempotencyKey('POST', '/plants', opts);
    expect(result.headers?.['Idempotency-Key']).toBe('pinned-123');
  });

  it('recognizes a pinned key under a different casing and does not double-set it', () => {
    const opts = { method: 'POST', headers: { 'idempotency-key': 'pinned-casing' } };
    const result = withIdempotencyKey('POST', '/plants', opts);
    // The original casing's value survives, and no sibling 'Idempotency-Key' entry is introduced.
    expect(result.headers?.['idempotency-key']).toBe('pinned-casing');
    expect(result.headers?.['Idempotency-Key']).toBeUndefined();
    expect(Object.keys(result.headers ?? {}).length).toBe(1);
  });

  it('does not attach a header on a GET', () => {
    const result = withIdempotencyKey('GET', '/plants', undefined);
    expect(result?.headers?.['Idempotency-Key']).toBeUndefined();
  });

  it('does not attach on non-POST mutating methods (PUT/PATCH/DELETE)', () => {
    // Only POST is deduped (spec): the server interceptor gates on POST, so the client must not
    // attach a key to other verbs. This pins that contract so a future edit to the method gate fails.
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const result = withIdempotencyKey(method, '/plants', undefined);
      expect(result?.headers?.['Idempotency-Key']).toBeUndefined();
    }
  });

  it('excludes ONLY the /auth/ prefix, not a path merely containing "auth"', () => {
    // The exclusion is a prefix match on `/auth/`, never a substring — a real domain path that happens
    // to contain "auth" (or bare `/auth` with no trailing slash) must still be deduped.
    expect(withIdempotencyKey('POST', '/authenticate', undefined)?.headers?.['Idempotency-Key']).toBeTruthy();
    expect(withIdempotencyKey('POST', '/plants/authorize', undefined)?.headers?.['Idempotency-Key']).toBeTruthy();
    expect(withIdempotencyKey('POST', '/auth', undefined)?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('treats a missing method as GET and does not attach', () => {
    const result = withIdempotencyKey(undefined, '/plants', undefined);
    expect(result?.headers?.['Idempotency-Key']).toBeUndefined();
  });

  it('does not attach on a POST to an excluded /auth/* path', () => {
    const result = withIdempotencyKey('POST', '/auth/login', undefined);
    expect(result?.headers?.['Idempotency-Key']).toBeUndefined();
  });

  it('excludes /auth/* case-insensitively', () => {
    const result = withIdempotencyKey('POST', '/Auth/Login', undefined);
    expect(result?.headers?.['Idempotency-Key']).toBeUndefined();
  });

  it('returns a NEW opts object and does not mutate the caller-supplied opts/headers', () => {
    const originalHeaders = { 'x-custom': '1' };
    const opts = { method: 'POST', headers: originalHeaders };
    const result = withIdempotencyKey('POST', '/plants', opts);

    expect(result).not.toBe(opts);
    expect(result.headers).not.toBe(originalHeaders);
    // The caller's own headers object gained no new keys.
    expect(originalHeaders).toEqual({ 'x-custom': '1' });
    // The result preserves the caller's other headers alongside the new key.
    expect(result.headers?.['x-custom']).toBe('1');
    expect(result.headers?.['Idempotency-Key']).toBeTruthy();
  });
});
