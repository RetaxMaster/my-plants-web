// The shared owner-facing-error seam (F1+F3, 2026-08-15). Every fixture here is built from the MEASURED
// BFF envelope shape documented in `ownerFacingError.ts`'s own file-header comment (`err.data` carries a
// STATUS-PHRASE `message` and a `url` even when there is no inner upstream body) — never a hand-invented
// shape, for the same reason `upstreamError.test.ts` insists on it: a fixture that does not match the wire
// can pass while the real branch it claims to cover never executes.
import { describe, expect, it } from 'vitest';
import { ownerFacingErrorMessage } from './ownerFacingError.js';

const t = (key: string) => key;

/** What ofetch hands the browser through the Nuxt BFF proxy — mirrors `upstreamError.test.ts`'s own
 *  `proxied()` helper, extended with the two fields measured 2026-08-15: the envelope's own `message` (the
 *  STATUS PHRASE, never the API's words) and its `url`. `upstreamBody` is the API's real response body,
 *  nested one level deeper at `data.data`; passing `null` produces the FALLBACK shape — no inner body at
 *  all — which is exactly the case rule 3's status-phrase guard exists for. */
function proxied(statusCode: number, statusMessage: string, upstreamBody: Record<string, unknown> | null) {
  const url = 'http://localhost:3000/api/plants/abc/care-events';
  return {
    statusCode,
    message: `[POST] "${url}": ${statusCode} ${statusMessage}`,
    data: {
      statusCode,
      statusMessage,
      message: statusMessage,
      url,
      stack: [],
      ...(upstreamBody ? { data: upstreamBody } : {}),
    },
  };
}

describe('ownerFacingErrorMessage — rule 1: the "must be today or earlier" refusal', () => {
  it('matches the REAL measured 400 body for a back-dated soil reading (occurredOn)', () => {
    const err = proxied(400, 'Bad Request', {
      message: 'occurredOn must be today or earlier for this plant (its local today is 2026-08-15, you sent 2027-01-01)',
      error: 'Bad Request',
      statusCode: 400,
    });
    expect(ownerFacingErrorMessage(err, t)).toBe('reading.measuredOnFuture');
  });

  it('matches the SAME refusal phrased for plant registration (acquiredOn)', () => {
    const err = proxied(400, 'Bad Request', {
      message: 'acquiredOn must be today or earlier for this plant (its local today is 2026-08-15, you sent 2027-01-01)',
      error: 'Bad Request',
      statusCode: 400,
    });
    expect(ownerFacingErrorMessage(err, t)).toBe('reading.measuredOnFuture');
  });

  it('matches case-insensitively — the API is not obligated to use this exact casing', () => {
    const err = proxied(400, 'Bad Request', { message: 'occurredOn MUST BE TODAY OR EARLIER for this plant' });
    expect(ownerFacingErrorMessage(err, t)).toBe('reading.measuredOnFuture');
  });
});

describe('ownerFacingErrorMessage — rule 2: an owner-readable server sentence is shown verbatim', () => {
  it('passes a plain validation message straight through', () => {
    const err = proxied(400, 'Bad Request', { message: 'wateringRelation is required: …' });
    expect(ownerFacingErrorMessage(err, t)).toBe('wateringRelation is required: …');
  });

  it('passes a domain conflict message straight through', () => {
    const err = proxied(409, 'Conflict', { message: 'An unresolved evaluation already exists for this plant.' });
    expect(ownerFacingErrorMessage(err, t))
      .toBe('An unresolved evaluation already exists for this plant.');
  });

  // POSITIVE CONTROL for rule 3's guards below: this message contains none of their trigger substrings, so
  // it proves the guards are targeted rather than accidentally blocking ordinary prose.
  it('is not blocked by the ofetch-prefix guard just because it starts with a word in brackets', () => {
    const err = proxied(400, 'Bad Request', { message: '[soilMix] must be a known mix slug' });
    // Does NOT match `/^\[[A-Z]+\]\s/` because the bracketed token is lowercase — the guard is specific to
    // ofetch's own `[METHOD]` shape, not to "starts with brackets" in general.
    expect(ownerFacingErrorMessage(err, t)).toBe('[soilMix] must be a known mix slug');
  });
});

describe('ownerFacingErrorMessage — rule 3: falls back to common.errorGeneric', () => {
  it('never shows the ofetch summary line, on the un-nested (client-side) fallback shape', () => {
    // Mirrors `upstreamError.test.ts`'s own "falls back to an un-nested body" case: a client-side or
    // future non-proxied failure puts its body straight at `err.data`, no `.data.data` nesting. Here that
    // body's own `message` happens to BE ofetch's summary shape — the guard exists for exactly this: a
    // string that looks like a real message and is actually the request's own method+URL+status line.
    const clientErr = { statusCode: 400, data: { message: '[POST] "http://localhost/api/x": 400 Bad Request' } };
    expect(ownerFacingErrorMessage(clientErr, t)).toBe('common.errorGeneric');
  });

  // ⚠️ THIS CASE EXISTS BECAUSE A BREAK PROOF FAILED (QA fix round, 2026-08-15). Deleting the
  // `OFETCH_SUMMARY_PREFIX` guard entirely left this file GREEN: every other summary-shaped fixture here
  // carries an ABSOLUTE url, so the `http://` guard caught them all and the prefix guard was never the
  // reason any of them passed. The test above claimed to cover it and did not.
  //
  // The string below is the one QA ACTUALLY SAW ON SCREEN, measured on `/plants/new` before the fix:
  // ofetch builds its summary from the request as the caller wrote it, and every call in this app goes to
  // the BFF by a RELATIVE path — so the summary contains no scheme, no host, and slips straight past the
  // URL guard. The prefix guard is the only thing between it and the owner.
  it('never shows the ofetch summary line when its URL is RELATIVE — the exact string QA saw', () => {
    const clientErr = { statusCode: 400, data: { message: '[POST] "/api/plants": 400 Bad Request' } };
    expect(ownerFacingErrorMessage(clientErr, t)).toBe('common.errorGeneric');
  });

  // The positive control for the guard directly above: a message that merely BEGINS with a bracketed word
  // is not a summary line and must still reach the owner. Without this, the guard could be widened to
  // "anything starting with [" and every test here would stay green.
  it('still shows a real message that happens to open with a bracketed word', () => {
    const err = proxied(400, 'Bad Request', { message: '[Riego] that day has no reading to correct' });
    expect(ownerFacingErrorMessage(err, t)).toBe('[Riego] that day has no reading to correct');
  });

  it('never shows a bare HTTP status phrase — THE case the measured fallback envelope exists to catch', () => {
    // No inner upstream body: `upstreamErrorBody`'s fallback returns `err.data` itself, whose own `message`
    // is the status phrase "Bad Request" — a string that looks usable and says nothing. This is the exact
    // shape a caller reading `upstreamErrorMessage` naively would render verbatim.
    const err = proxied(400, 'Bad Request', null);
    expect(ownerFacingErrorMessage(err, t)).toBe('common.errorGeneric');
  });

  it('never shows a DIFFERENT bare status phrase either — the guard is a set, not one hardcoded string', () => {
    const err = proxied(404, 'Not Found', null);
    expect(ownerFacingErrorMessage(err, t)).toBe('common.errorGeneric');
  });

  it('never shows a message containing a URL', () => {
    const err = proxied(500, 'Internal Server Error', { message: 'See https://example.com/docs for details' });
    expect(ownerFacingErrorMessage(err, t)).toBe('common.errorGeneric');
  });

  it('never shows nothing at all (a network failure with no body whatsoever)', () => {
    expect(ownerFacingErrorMessage(new Error('network'), t)).toBe('common.errorGeneric');
    expect(ownerFacingErrorMessage(null, t)).toBe('common.errorGeneric');
    expect(ownerFacingErrorMessage(undefined, t)).toBe('common.errorGeneric');
  });
});
