// The BFF error envelope, pinned.
//
// This module had NO test file until QA round 3 (2026-08-10), and the cost of that showed up one directory
// over: `SoilReadingModal.vue` hand-rolled its own `e.data.message ?? e.message` lookup, which reads
// `undefined` and then ofetch's bare status line, so its two recovery branches never executed in a browser
// — while every unit test around them passed, because each one fabricated the un-nested shape the browser
// never receives.
//
// So these cases assert the envelope itself, in the shape h3 + ofetch actually produce. The companion proof
// that this shape is real (rather than merely what we believe) lives in `server/api/proxy.wire.test.ts`,
// which drives the REAL proxy over a REAL socket.
import { describe, it, expect } from 'vitest';
import { upstreamErrorBody, upstreamErrorCode, upstreamErrorMessage, upstreamErrorStatus } from './upstreamError.js';

/**
 * What ofetch hands the browser when the BFF re-throws an upstream failure.
 *
 * COPIED FROM A MEASUREMENT, not from a mental model: `server/api/proxy.wire.test.ts` drives the real proxy
 * over a real socket and prints exactly this. In particular the envelope has NO `message` key — an earlier
 * draft of this helper invented one (`message: 'Upstream error'`), which would have made these cases assert
 * a shape the browser never sends, i.e. the very defect this file exists to prevent, one level up.
 */
function proxied(statusCode: number, upstreamBody: Record<string, unknown>) {
  return {
    statusCode,
    // `message` is ofetch's own summary of the failed request — the string the old `?? err.message`
    // fallback landed on, and it contains none of the API's words.
    message: `[POST] "http://localhost/api/x": ${statusCode} Bad Request`,
    data: { statusCode, statusMessage: 'Bad Request', stack: [], data: upstreamBody },
  };
}

describe('upstreamErrorMessage', () => {
  it('reads the API\'s own message from ONE LEVEL DEEPER than it looks', () => {
    const err = proxied(400, { statusCode: 400, message: 'wateringRelation is required: …', error: 'Bad Request' });
    expect(upstreamErrorMessage(err)).toBe('wateringRelation is required: …');
  });

  // ⚠️ THE WHOLE POINT, AS A TEST. Both halves of the naive lookup — `err.data.message ?? err.message` —
  // are pinned here, because that is why such a lookup does not merely duplicate this module: it silently
  // matches nothing, on every proxied failure, forever, with nothing thrown and nothing logged.
  it('is what the naive `err.data.message ?? err.message` fallback can NEVER reach', () => {
    const err = proxied(400, { message: 'measuredOn must be today or earlier' });
    expect((err.data as { message?: string }).message).toBeUndefined();
    expect(err.message).not.toContain('measuredOn');
    expect(upstreamErrorMessage(err)).toBe('measuredOn must be today or earlier');
  });

  it('joins the ARRAY form a validation pipe produces, so callers never branch on which shape they got', () => {
    // `ZodValidationPipe` maps issues to `string[]`; a thrown `BadRequestException(string)` sends a string.
    // Both come out of the same throw site family, and a consumer that handled only one would handle only
    // the errors it happened to be written against.
    const err = proxied(400, { message: ['dryValue: dryValue -500 is outside the kitchen-scale scale (0..open-ended)'] });
    expect(upstreamErrorMessage(err)).toContain('outside the kitchen-scale scale');
  });

  it('falls back to an UN-nested body, for a client-side or future non-proxied failure', () => {
    expect(upstreamErrorMessage({ statusCode: 400, data: { message: 'direct' } })).toBe('direct');
  });

  it('returns an empty string rather than throwing when there is no body at all', () => {
    expect(upstreamErrorMessage(new Error('network'))).toBe('');
    expect(upstreamErrorMessage(null)).toBe('');
    expect(upstreamErrorMessage(undefined)).toBe('');
    expect(upstreamErrorMessage({ data: 'not an object' })).toBe('');
  });
});

describe('upstreamErrorBody / status / code (the existing surface, previously untested)', () => {
  it('unwraps the upstream body', () => {
    expect(upstreamErrorBody(proxied(409, { status: 'EXPIRED' }))).toEqual({ status: 'EXPIRED' });
  });

  it('reads a status the proposal surface depends on', () => {
    expect(upstreamErrorStatus(proxied(409, { status: 'EXPIRED' }))).toBe('EXPIRED');
    // Typed as `string | undefined` on purpose: the API answers 'UNKNOWN' for a vanished row, which is
    // outside the proposal-status enum.
    expect(upstreamErrorStatus(proxied(409, { status: 'UNKNOWN' }))).toBe('UNKNOWN');
    expect(upstreamErrorStatus(proxied(409, { status: 42 }))).toBeUndefined();
  });

  it('reads the code from whichever field the client library populated', () => {
    expect(upstreamErrorCode({ statusCode: 400 })).toBe(400);
    expect(upstreamErrorCode({ response: { status: 503 } })).toBe(503);
    expect(upstreamErrorCode({})).toBeUndefined();
  });
});
