/**
 * The chat send path with attachments (spec 4.1).
 *
 * Chat sends were plain `$fetch` with a JSON body: zero pre-flight, zero stall watchdog. Production once
 * hung FOREVER on a progress upload because nginx's client_max_body_size closed the socket mid-upload, and
 * a browser fetch() in that state NEVER settles — an infinite spinner rather than an error. The requirement
 * is that the attachment send FAILS VISIBLY, so this mirrors utils/upload.ts's XHR treatment: a pre-flight
 * refusal before any byte goes on the wire, plus two watchdogs on deliberately separate budgets.
 */
// THE CAPS ARE IMPORTED, NOT RETYPED — same rule as the API's body-limit.ts. Spec 4.1 asks for ONE shared
// cap declaration; hardcoding `6` and `20 * 1024 * 1024` here would be a third copy (API, chatSend,
// AgentChat) of a value the protocol package already publishes. The failure that causes is silent and
// asymmetric: if the package raises DEFAULT_ATTACHMENT_MAX_COUNT to 8, the API follows and stays green
// while the browser still refuses the 7th image, and nothing goes red.
import {
  DEFAULT_ATTACHMENT_MAX_COUNT,
  DEFAULT_ATTACHMENT_MAX_FILE_BYTES,
  DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES,
  IMAGE_MIME_ALLOWLIST,
} from '@retaxmaster/agents-realtime-protocol';

export const CHAT_MAX_ATTACHMENT_COUNT = DEFAULT_ATTACHMENT_MAX_COUNT;
export const CHAT_MAX_FILE_BYTES = DEFAULT_ATTACHMENT_MAX_FILE_BYTES;
export const CHAT_MAX_TOTAL_BYTES = DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES;
/** Note the spread: the package exports a runtime `Set` (typed `ReadonlySet` at the type level), not an array. */
export const CHAT_ALLOWED_MIMES: readonly string[] = [...IMAGE_MIME_ALLOWLIST];
/** The cap object the Composer takes, derived from the same three constants — never a fourth literal. */
export const CHAT_ATTACHMENT_CAPS = {
  maxCount: CHAT_MAX_ATTACHMENT_COUNT,
  maxFileBytes: CHAT_MAX_FILE_BYTES,
  maxTotalBytes: CHAT_MAX_TOTAL_BYTES,
} as const;

/** Re-armed on every upload progress event: the socket went quiet mid-body. */
export const CHAT_STALL_TIMEOUT_MS = 30_000;
/** Armed once the body is fully sent: the server accepted the bytes and then never answered. */
export const CHAT_RESPONSE_TIMEOUT_MS = 90_000;

export type ChatSendErrorCode =
  | 'attachment_count_exceeded' | 'attachment_total_exceeded' | 'attachment_too_large'
  | 'attachment_type_not_allowed' | 'send_stalled' | 'send_no_response' | 'send_network';

export type ChatAttachmentPayload = { id: string; filename: string; mimeType: string; data: string };

// Base64's raw length OVER-counts the decoded byte size whenever the payload isn't a multiple of 3 bytes —
// `Math.floor(base64.length * 3 / 4)` alone reports up to 2 bytes too many, which means a real client would
// refuse a payload the server considers perfectly legal (verified empirically against Node's own encoder
// over 7,000+ byte lengths from 0 to 2 MB, both exhaustive small sizes and random larger ones: zero
// mismatches once padding is subtracted). Padding characters ('=') are the correction: at most two, and
// only in the final two positions.
const decodedBytes = (base64: string): number => {
  const len = base64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (base64[len - 1] === '=') padding++;
  if (base64[len - 2] === '=') padding++;
  return Math.floor((len * 3) / 4) - padding;
};

/**
 * The client-side pre-flight. It is a fast local refusal with a translated message, NOT a substitute for
 * the API's own validation — a client that skips this must still be refused server-side, which the API's
 * DTO guarantees.
 */
export function checkChatSendLimits(
  _text: string,
  attachments: readonly ChatAttachmentPayload[],
): { code: ChatSendErrorCode } | null {
  if (attachments.length > CHAT_MAX_ATTACHMENT_COUNT) return { code: 'attachment_count_exceeded' };
  // Per-file checked BEFORE the total, deliberately — the reverse order was tried and reverted (see the
  // feature ledger). CHAT_MAX_TOTAL_BYTES is exactly 2 * CHAT_MAX_FILE_BYTES, so a single attachment that
  // alone breaks the total cap always also breaks the per-file cap. Reporting 'attachment_total_exceeded'
  // in that case is a NEUTRAL-fallback violation: told to a user holding exactly ONE oversized image,
  // "those images are too large together, try fewer" is not a coarser answer, it is a WRONG one the user
  // cannot act on (§7's rule: a sibling fallback in the right family is still wrong, never a substitute for
  // the specific code). Per-file-first guarantees a single oversized file is always named for what it is.
  for (const a of attachments) {
    if (!CHAT_ALLOWED_MIMES.includes(a.mimeType)) return { code: 'attachment_type_not_allowed' };
    if (decodedBytes(a.data) > CHAT_MAX_FILE_BYTES) return { code: 'attachment_too_large' };
  }
  const total = attachments.reduce((sum, a) => sum + decodedBytes(a.data), 0);
  if (total > CHAT_MAX_TOTAL_BYTES) return { code: 'attachment_total_exceeded' };
  return null;
}

function makeChatSendError(code: ChatSendErrorCode, statusCode = 0) {
  // Shaped like an ofetch/h3 error so useApi's existing translation path handles it unchanged.
  return Object.assign(new Error(code), { statusCode, data: { code } });
}

export async function sendChatJson<T>(
  url: string,
  body: unknown,
  opts: { xhrFactory?: () => XMLHttpRequest } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = (opts.xhrFactory ?? (() => new XMLHttpRequest()))();
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const clearWatchdog = () => { if (watchdog !== null) clearTimeout(watchdog); watchdog = null; };
    const fail = (code: ChatSendErrorCode, statusCode = 0) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      xhr.abort();
      reject(makeChatSendError(code, statusCode));
    };
    const arm = (ms: number, code: ChatSendErrorCode) => {
      clearWatchdog();
      watchdog = setTimeout(() => fail(code), ms);
    };

    // Two budgets, deliberately separate: a stall mid-body is a different failure from a server that
    // accepted every byte and then went silent, and they deserve different patience.
    xhr.upload.onprogress = () => arm(CHAT_STALL_TIMEOUT_MS, 'send_stalled');
    xhr.upload.onload = () => arm(CHAT_RESPONSE_TIMEOUT_MS, 'send_no_response');
    xhr.onerror = () => fail('send_network');
    xhr.onload = () => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      if (xhr.status >= 200 && xhr.status < 300) {
        // ⚠️ THE PARSE MUST BE GUARDED, AND THE ORDER IS WHY.
        //
        // `settled` and `clearWatchdog()` already ran above, so a throw from here escapes into the XHR
        // event handler — NOT into the promise executor — and the promise NEVER settles, with both
        // watchdogs already disarmed. That is precisely the never-settling request this file exists to
        // eliminate (see the header: a browser fetch() left in that state hangs forever, which this
        // project has already shipped once). A 2xx carrying a non-JSON body — an HTML error page from a
        // proxy, a truncated response — is the reachable trigger. The error branch below already guards
        // its parse; this one did not.
        let parsed: T;
        try {
          parsed = xhr.responseText ? (JSON.parse(xhr.responseText) as T) : (undefined as T);
        } catch {
          reject(makeChatSendError('send_network', xhr.status));
          return;
        }
        resolve(parsed);
      } else {
        let parsed: unknown;
        try { parsed = JSON.parse(xhr.responseText); } catch { parsed = undefined; }
        // The API's own mapped code rides through untouched so the caller can translate it.
        reject(Object.assign(new Error('chat send failed'), { statusCode: xhr.status, data: parsed }));
      }
    };

    xhr.open('POST', url);
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.withCredentials = true;
    arm(CHAT_STALL_TIMEOUT_MS, 'send_stalled');
    xhr.send(JSON.stringify(body));
  });
}
