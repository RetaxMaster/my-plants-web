// THE WEB-LEVEL WIRE TEST — it drives the REAL Nuxt BFF proxy over a REAL socket.
//
// Why this file exists (and why an API-side e2e cannot replace it): every consumer in this app reaches
// NestJS through `/api`, never directly. Between the two sits `server/api/[...].ts`, and it RESHAPES what
// the browser sees. This feature has now shipped FOUR defects of exactly one family — "a wire shape the
// API's own green e2e cannot see":
//
//   1. `getPending` returns `null`; Nest sends 200 with an EMPTY body; ofetch's `destr('')` hands the
//      browser the empty STRING — neither `null` nor `{}` (what supertest reports).
//   2. the 409 body's `status` can be `'UNKNOWN'`, outside the proposal-status enum.
//   3. `LAUNCHING` was absent from the web's read type entirely.
//   4. THIS one: the BFF re-wraps the upstream error body one level deeper, so `e.data.status` — which
//      supertest sees at the top level — is `undefined` in the browser and the owner is told "someone
//      else resolved this" when the agent actually superseded the proposal with a newer one.
//
// The unit tests either side of the proxy are all green in every one of those cases, because each one
// asserts the shape its own side produces. Only a test that crosses the proxy can see the shape the
// BROWSER receives. So: a real upstream HTTP server, the real event handler, real h3 serialization, and
// the real `ofetch` client — the same library Nuxt's `$fetch` is built on.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, toNodeListener, defineEventHandler, getRequestHeader, readRawBody, createError, parseCookies, type EventHandler } from 'h3';
import { ofetch } from 'ofetch';
import { upstreamErrorBody, upstreamErrorStatus } from '../../utils/upstreamError.js';

// The upstream stands in for NestJS. Only its RESPONSE SHAPE matters here, and that shape is pinned by
// the API's own e2e (`expect(res.body.status).toBe('EXPIRED')` in plant-doctor-proposals.e2e-spec.ts) —
// a Nest `ConflictException({ message, status })` serializes its object verbatim, with no extra nesting.
let upstream: Server;
let upstreamUrl = '';
let bff: Server;
let bffUrl = '';

// What the upstream answers next. Set per test.
let nextStatus = 200;
let nextBody: unknown = {};
/** The headers the upstream actually received on the last call — what the API gets to act on. */
let lastUpstreamHeaders: Record<string, string | string[] | undefined> = {};
/**
 * Bytes of BODY the upstream actually drained on the last call. Reset per test that reads it (see the
 * near-maximum-attachment test below) — module-level state in a sequential test file must not leak
 * between tests.
 */
let lastUpstreamBodyBytes = 0;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    lastUpstreamHeaders = req.headers;
    // Genuinely DRAIN the request body before answering. The previous version of this handler answered
    // synchronously off the headers alone and never read `req` at all — harmless for the GET-only tests
    // below (no body to drain), but it means a byte counter attached via a second 'request' listener could
    // read zero or short: `res.end()` may complete before the body stream is ever consumed. Accumulating
    // on 'data' and answering on 'end' makes "the upstream received N bytes" an honest measurement for
    // ANY request, GET or POST, with or without a body — while every response byte/status/header this
    // file's other tests assert on is produced exactly as before.
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    req.on('end', () => {
      lastUpstreamBodyBytes = bytes;
      res.statusCode = nextStatus;
      if (nextBody === undefined) {
        res.end(); // an EMPTY body — what Nest sends for a handler returning `null`
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(nextBody));
    });
  });
  upstreamUrl = await listen(upstream);

  // The Nuxt auto-imports the handler relies on, bound to the REAL implementations wherever the behaviour
  // under test depends on them. Only the two that are pure environment — the runtime config and the auth
  // session — are stubbed; every function that touches the request, the error or the response is h3's own.
  const g = globalThis as unknown as Record<string, unknown>;
  g.defineEventHandler = defineEventHandler;
  g.getRequestHeader = getRequestHeader;
  g.parseCookies = parseCookies;
  g.readRawBody = readRawBody;
  g.createError = createError;
  g.$fetch = ofetch; // Nuxt's `$fetch` IS ofetch
  g.useRuntimeConfig = () => ({ apiBase: upstreamUrl });
  g.getUserSession = async () => ({ secure: { token: 'test-token' } });

  const mod = (await import('./[...].js')) as { default: EventHandler };
  const app = createApp();
  app.use(mod.default);
  bff = createServer(toNodeListener(app));
  bffUrl = await listen(bff);
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((r) => upstream.close(() => r())),
    new Promise<void>((r) => bff.close(() => r())),
  ]);
});

/** Perform a request through the BFF exactly as the browser does, and return whatever it threw. */
async function callThroughBff(path: string, headers?: Record<string, string>): Promise<unknown> {
  try {
    return { ok: await ofetch(`${bffUrl}${path}`, { headers }) };
  } catch (err) {
    return { err };
  }
}

describe('the Nuxt BFF proxy, seen from the browser', () => {
  it('nests the upstream error body one level under `data` — the shape the client must read', async () => {
    nextStatus = 409;
    nextBody = { message: 'proposal is no longer pending', status: 'EXPIRED' };
    const { err } = (await callThroughBff('/api/plants/p1/diagnose/sessions/s1/proposals/x/approve')) as {
      err: { statusCode?: number; data?: { data?: unknown; status?: unknown } };
    };

    expect(err.statusCode).toBe(409);
    // THE DEFECT, pinned as a fact about the wire rather than as a claim about the code: the upstream's
    // own top-level `status` is NOT at `e.data.status`. Reading it there yields `undefined`, which is
    // exactly how an EXPIRED conflict came to be explained to the owner as "already resolved".
    expect(err.data?.status).toBeUndefined();
    // h3's `createError({ data })` puts the payload on a `data` key of the serialized body, and ofetch
    // exposes that whole body as `e.data`. So the upstream body lands one level deeper.
    expect(err.data?.data).toEqual({ message: 'proposal is no longer pending', status: 'EXPIRED' });
  });

  it('`upstreamErrorStatus` reads the real proxied error — EXPIRED survives the round trip', async () => {
    nextStatus = 409;
    nextBody = { message: 'proposal is no longer pending', status: 'EXPIRED' };
    const { err } = (await callThroughBff('/api/x')) as { err: unknown };
    expect(upstreamErrorStatus(err)).toBe('EXPIRED');
  });

  it('carries the out-of-enum `UNKNOWN` status through unchanged (a vanished row)', async () => {
    nextStatus = 409;
    nextBody = { message: 'proposal is no longer pending', status: 'UNKNOWN' };
    const { err } = (await callThroughBff('/api/x')) as { err: unknown };
    expect(upstreamErrorStatus(err)).toBe('UNKNOWN');
  });

  it('yields `undefined` when the upstream error carries no status at all', async () => {
    nextStatus = 500;
    nextBody = { message: 'boom' };
    const { err } = (await callThroughBff('/api/x')) as { err: unknown };
    expect(upstreamErrorStatus(err)).toBeUndefined();
    expect(upstreamErrorBody(err)).toEqual({ message: 'boom' });
  });

  it('preserves the upstream STATUS CODE (401 is what drives the app to the login screen)', async () => {
    nextStatus = 401;
    nextBody = { message: 'Unauthorized' };
    const { err } = (await callThroughBff('/api/plants')) as { err: { statusCode?: number } };
    expect(err.statusCode).toBe(401);
  });

  // The locale hand-off. It is a WIRE contract: the API renders the consent surface's field labels and
  // enum values in this language, and the browser is forbidden to re-derive them, so a header that
  // silently stops being sent degrades the owner's approval screen to English with nothing failing.
  describe('locale forwarding', () => {
    it('forwards the i18n cookie to the API as `x-locale`', async () => {
      nextStatus = 200;
      nextBody = { ok: true };
      await callThroughBff('/api/plants/p1/diagnose/sessions/s1/proposals/pending', {
        cookie: 'i18n_redirected=es',
      });
      expect(lastUpstreamHeaders['x-locale']).toBe('es');
    });

    it('sends no `x-locale` at all when the cookie is absent (the API keeps its own default)', async () => {
      nextStatus = 200;
      nextBody = { ok: true };
      await callThroughBff('/api/plants');
      expect(lastUpstreamHeaders['x-locale']).toBeUndefined();
    });

    // A cookie is an attacker-controllable request header. Forwarding it verbatim would let a crafted
    // value reach the API as a header payload of the attacker's choosing.
    it('drops a malformed locale rather than forwarding it', async () => {
      nextStatus = 200;
      nextBody = { ok: true };
      for (const bad of ['es\r\nX-Injected: 1', '../../etc/passwd', 'e', 'a'.repeat(40), '{}']) {
        await callThroughBff('/api/plants', { cookie: `i18n_redirected=${encodeURIComponent(bad)}` });
        expect(lastUpstreamHeaders['x-locale'], `should have dropped ${JSON.stringify(bad)}`).toBeUndefined();
      }
    });

    // The BFF never forwards the browser's Cookie header upstream (the API authenticates on the Bearer
    // token alone); pinning it here keeps the sanitized `x-locale` the ONLY thing that crosses.
    it('never forwards the raw cookie header upstream', async () => {
      nextStatus = 200;
      nextBody = { ok: true };
      await callThroughBff('/api/plants', { cookie: 'i18n_redirected=es; nuxt-session=secret' });
      expect(lastUpstreamHeaders.cookie).toBeUndefined();
    });
  });

  // Regression #1 of the family, re-pinned here now that a harness exists that can actually see it: an
  // empty 200 body reaches the browser as the empty STRING, not `null` and not `{}`.
  it('an EMPTY 200 body arrives at the browser as the empty string', async () => {
    nextStatus = 200;
    nextBody = undefined;
    const { ok } = (await callThroughBff('/api/plants/p1/diagnose/sessions/s1/proposals/pending')) as {
      ok: unknown;
    };
    expect(ok).toBe('');
    expect(ok).not.toBeNull();
  });

  // The BFF reads the raw body as a Buffer and adds no cap of its own — but that is a property to TEST,
  // not to assume. A hop that silently caps or truncates here reproduces, byte for byte, the failure this
  // project already shipped once in production: NGINX's `client_max_body_size` closed the socket
  // mid-upload and the browser's `fetch()` never settled — an infinite spinner with no error. `callThroughBff`
  // is GET-only, so this test drives the BFF directly with a real `fetch` POST instead of extending that
  // helper's contract for every other test in this file.
  it('forwards a near-maximum attachment body to the upstream API without truncating or capping it', async () => {
    lastUpstreamBodyBytes = 0; // per-test reset — module-level state in a sequential suite

    nextStatus = 200;
    nextBody = { ok: true };

    const perFile = 3 * 1024 * 1024;
    const attachments = Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`,
      filename: `photo-${i}.png`,
      mimeType: 'image/png',
      data: Buffer.alloc(perFile, 0x41).toString('base64'),
    }));
    const body = { prompt: 'look', provider: 'claude', attachments };
    const sentBytes = Buffer.byteLength(JSON.stringify(body));

    const res = await fetch(`${bffUrl}/api/knowledge-chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await res.arrayBuffer(); // drain the response so the connection can close cleanly

    expect(res.status).not.toBe(413);
    // The crux of the test: the upstream must have DRAINED exactly as many bytes as the BFF was given —
    // not zero (a harness that never consumed the body), not short (a hop that silently caps or truncates).
    expect(lastUpstreamBodyBytes).toBe(sentBytes);
  }, 30000);
});
