import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkChatSendLimits, CHAT_MAX_ATTACHMENT_COUNT, CHAT_MAX_FILE_BYTES, CHAT_MAX_TOTAL_BYTES } from './chatSend.js';

// A cheap, unpadded fixture for tests that only exercise count/MIME/rough-size branches. Its length is
// `ceil(bytes * 4 / 3)`, which is NOT genuine base64 padding — see `realAtt` below for anything that
// pins an exact byte boundary. Using this for a boundary assertion would be the exact mistake Ruling A
// calls out: it would let a rounding bug hide behind a fixture whose "bytes" were never real.
const att = (bytes: number, id = 'a1') => ({
  id, filename: 'x.png', mimeType: 'image/png', data: 'A'.repeat(Math.ceil((bytes * 4) / 3)),
});

// Genuine base64 of an EXACT byte length, produced by Node's own encoder — the only way to trust a
// boundary test. (Buffer.from(...).toString('base64') is the same algorithm the browser's btoa/FileReader
// path produces; comparing against it is how the fix below was verified empirically, over thousands of
// random byte lengths from 0 to 2 MB, with zero mismatches.)
const realAtt = (bytes: number, id = 'a1') => ({
  id, filename: 'x.png', mimeType: 'image/png', data: Buffer.alloc(bytes, 65).toString('base64'),
});

// This test file runs under vitest's plain `node` environment (utils/** opts out of happy-dom), which has
// no `ProgressEvent`/`Event` globals — the real chatSend.ts implementation never reads the event argument
// it receives from these hooks, so the fake XHR below is untyped on purpose and callers just invoke the
// hooks with no argument.
function makeFakeXhr() {
  const upload: { onprogress: ((e?: unknown) => void) | null; onload: ((e?: unknown) => void) | null } = {
    onprogress: null,
    onload: null,
  };
  return {
    upload,
    aborted: false,
    status: 200,
    responseText: '',
    onerror: null as ((e?: unknown) => void) | null,
    onload: null as ((e?: unknown) => void) | null,
    open: vi.fn(),
    send: vi.fn(),
    setRequestHeader: vi.fn(),
    abort() {
      this.aborted = true;
    },
  };
}

describe('checkChatSendLimits (the pre-flight)', () => {
  it('passes a payload within every cap', () => {
    expect(checkChatSendLimits('hello', [att(1024)])).toBeNull();
  });

  it('refuses too many attachments BEFORE a byte goes on the wire', () => {
    const many = Array.from({ length: CHAT_MAX_ATTACHMENT_COUNT + 1 }, (_, i) => att(16, `a${i}`));
    expect(checkChatSendLimits('hello', many)?.code).toBe('attachment_count_exceeded');
  });

  it('refuses an over-total payload split across files that each stay under the per-file cap', () => {
    // Three 8 MiB files: 24 MiB total (over the 20 MiB total cap) while each individual file (8 MiB) stays
    // under the 10 MiB per-file cap. This is the ONLY way to isolate the total branch: a single file big
    // enough to break the total cap alone (20 MiB) is also always big enough to break the per-file cap
    // (10 MiB, since the total cap is exactly 2x the file cap) — see the single-oversized-file test below
    // for why that overlap case must report 'attachment_too_large', not this code.
    const eightMiB = 8 * 1024 * 1024;
    const attachments = [att(eightMiB, 'a1'), att(eightMiB, 'a2'), att(eightMiB, 'a3')];
    expect(checkChatSendLimits('hello', attachments)?.code).toBe('attachment_total_exceeded');
  });

  it('reports a single oversized file as attachment_too_large, never attachment_total_exceeded, even though it also breaks the total cap', () => {
    // Regression guard for the reorder that was tried and reverted: checking total BEFORE per-file made a
    // user holding exactly one oversized image get told "those images are too large together, try fewer" —
    // wrong advice for someone with one file. Per-file must win this overlap case.
    expect(checkChatSendLimits('hello', [realAtt(CHAT_MAX_TOTAL_BYTES + 1)])?.code).toBe('attachment_too_large');
  });

  it('refuses a disallowed MIME type', () => {
    expect(checkChatSendLimits('hello', [{ ...att(16), mimeType: 'image/svg+xml' }])?.code)
      .toBe('attachment_type_not_allowed');
  });

  // --- Boundary tests, Ruling A: derived from REAL base64 of a REAL byte length, never a hand-typed
  // 'A'.repeat(...) string whose length is only ASSUMED to correspond to a given byte count. The buggy
  // `Math.floor(base64.length * 3 / 4)` formula OVER-counts by up to 2 bytes whenever the raw length isn't
  // a multiple of 3 — e.g. it reports 12 bytes for a genuine 10-byte payload — which means a client running
  // that formula would refuse a payload the server considers perfectly legal. These tests pin the exact
  // boundary so that regression is impossible to reintroduce silently.

  it('passes a single attachment of EXACTLY the per-file cap', () => {
    expect(checkChatSendLimits('hello', [realAtt(CHAT_MAX_FILE_BYTES)])).toBeNull();
  });

  it('refuses a single attachment ONE byte over the per-file cap', () => {
    expect(checkChatSendLimits('hello', [realAtt(CHAT_MAX_FILE_BYTES + 1)])?.code).toBe('attachment_too_large');
  });

  it('passes a total EXACTLY at the total-bytes cap, split across attachments', () => {
    const half = CHAT_MAX_TOTAL_BYTES / 2;
    expect(checkChatSendLimits('hello', [realAtt(half, 'a1'), realAtt(half, 'a2')])).toBeNull();
  });

  it('refuses a total ONE byte over the total-bytes cap, with every individual file at (not over) its own cap', () => {
    // CHAT_MAX_TOTAL_BYTES is exactly 2 * CHAT_MAX_FILE_BYTES, so two attachments each AT the per-file cap
    // plus one more byte lands exactly one byte over the total cap without any single file exceeding its
    // own cap.
    const half = CHAT_MAX_TOTAL_BYTES / 2;
    const attachments = [realAtt(half, 'a1'), realAtt(half, 'a2'), realAtt(1, 'a3')];
    expect(checkChatSendLimits('hello', attachments)?.code).toBe('attachment_total_exceeded');
  });
});

describe('sendChatJson watchdogs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fails VISIBLY when the upload stalls, rather than hanging forever', async () => {
    // Production once hung forever because a hop closed the socket mid-upload and a browser fetch() in
    // that state NEVER settles. This is the assertion that makes that impossible.
    const { sendChatJson, CHAT_STALL_TIMEOUT_MS } = await import('./chatSend.js');
    const xhr = makeFakeXhr(); // never fires progress or load
    const promise = sendChatJson('/api/x', { prompt: 'hi' }, { xhrFactory: () => xhr as unknown as XMLHttpRequest });

    vi.advanceTimersByTime(CHAT_STALL_TIMEOUT_MS + 1);

    await expect(promise).rejects.toMatchObject({ data: { code: 'send_stalled' } });
    expect(xhr.aborted).toBe(true);
  });

  it('fails visibly when the server never responds after the body was sent', async () => {
    const { sendChatJson, CHAT_RESPONSE_TIMEOUT_MS } = await import('./chatSend.js');
    const xhr = makeFakeXhr();
    const promise = sendChatJson('/api/x', { prompt: 'hi' }, { xhrFactory: () => xhr as unknown as XMLHttpRequest });

    xhr.upload.onload?.();
    vi.advanceTimersByTime(CHAT_RESPONSE_TIMEOUT_MS + 1);

    await expect(promise).rejects.toMatchObject({ data: { code: 'send_no_response' } });
  });
});
