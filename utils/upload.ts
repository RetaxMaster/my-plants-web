// Every file upload in the app funnels through here. Uploads are the one request shape big enough for an
// INFRASTRUCTURE layer to refuse before the app ever sees it, and that refusal is silent in the worst way:
// NGINX answers an over-sized body with a 413 and closes the socket while the browser is STILL sending, and
// a fetch() caught in that state never settles — no response, no error, no network event, so not even a
// `finally` runs. The spinner spins forever and the user has no idea the save died. (Reproduced against
// production: 6 photos x 3 MB = 18 MB, and the promise simply never resolved.)
//
// Two defenses, both of which every upload gets for free by going through this module:
//   1. Refuse locally what the server would refuse anyway — so we never build a request doomed at the door.
//   2. Run on XMLHttpRequest, not fetch. XHR reports upload progress, which is the only way a browser can
//      tell a slow upload from a dead one: if the bytes stop moving, the connection is gone, and we abort
//      with a real error instead of hanging.

// Mirrors the API's multer limit (MAX_UPLOAD_BYTES in my-plants-api/src/storage/multipart.config.ts).
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
// Stays under NGINX's `client_max_body_size 100M` for my-plants.retaxmaster.com. The uploader allows 8
// files x 10 MB = 80 MB, so a legal request always fits with headroom for the multipart envelope.
export const MAX_UPLOAD_REQUEST_BYTES = 80 * 1024 * 1024;

// Two different silences, and they must NOT share a budget.
//
// (1) The bytes stopped moving mid-transfer. Nothing legitimate looks like this: even a crawling phone
//     upload fires a progress event every few hundred ms. Silence here means the connection is dead
//     (it is exactly what NGINX's 413-and-close looks like from inside the browser), so we give up fast.
const STALL_TIMEOUT_MS = 30_000;
// (2) Every byte arrived and we are waiting on the backend. Here the app genuinely CANNOT tell a dead
//     server from a working one: the API resizes each photo with sharp and PUTs it to R2 one by one, on
//     an ARM box. So this budget must cover the slowest legitimate save, or we would abort a request that
//     actually succeeded — and the user would retry and duplicate the entry. Measured: ~5 s of server work
//     for 3 photos locally; 90 s leaves a wide margin for 8 photos on the slower production hardware while
//     still guaranteeing the wait ENDS. (The error for this case says "reload and check before retrying"
//     precisely because a timeout here is ambiguous by nature.)
const RESPONSE_TIMEOUT_MS = 90_000;

export type UploadErrorCode =
  | 'upload_file_too_large'
  | 'upload_request_too_large'
  | 'upload_stalled'
  | 'upload_no_response'
  | 'upload_network';

// Shaped like the errors ofetch/h3 hand back (statusCode + data), so callers keep one catch block:
// they read `e.data.code` / `e.data.message` whether the failure came from the API or from here.
export interface UploadError extends Error {
  statusCode: number;
  data: { code: string; message?: string; [key: string]: unknown };
}

export function makeUploadError(code: UploadErrorCode, message?: string, statusCode = 0): UploadError {
  const err = new Error(message ?? code) as UploadError;
  err.statusCode = statusCode;
  err.data = { code, message };
  return err;
}

/** Human-readable size for an error message ("18.4 MB"), not for math. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Every File in a FormData, whatever field names the caller used ('photos', 'cover', 'image', 'photo'). */
export function filesOf(form: FormData): File[] {
  const files: File[] = [];
  form.forEach((value) => {
    if (value instanceof File) files.push(value);
  });
  return files;
}

export interface UploadRejection {
  code: Extract<UploadErrorCode, 'upload_file_too_large' | 'upload_request_too_large'>;
  /** Interpolation values for the i18n message (the caller owns translation; this module owns the rule). */
  params: { name?: string; size: string; max: string };
}

/**
 * The pre-flight. Returns why the server would reject this upload, or null when it is safe to send.
 * Checked BEFORE a single byte goes on the wire — a rejection here costs the user nothing.
 */
export function checkUploadLimits(form: FormData): UploadRejection | null {
  const files = filesOf(form);
  const tooBig = files.find((f) => f.size > MAX_UPLOAD_FILE_BYTES);
  if (tooBig) {
    return {
      code: 'upload_file_too_large',
      params: { name: tooBig.name, size: formatBytes(tooBig.size), max: formatBytes(MAX_UPLOAD_FILE_BYTES) },
    };
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_UPLOAD_REQUEST_BYTES) {
    return {
      code: 'upload_request_too_large',
      params: { size: formatBytes(total), max: formatBytes(MAX_UPLOAD_REQUEST_BYTES) },
    };
  }
  return null;
}

/**
 * POST/PUT a FormData with progress and a dead-connection guard. Resolves with the parsed JSON body;
 * rejects with an ofetch-shaped error carrying the upstream status and body when there is one.
 */
export function uploadFormData<T>(
  url: string,
  form: FormData,
  opts: { method?: 'POST' | 'PUT' | 'PATCH'; onProgress?: (percent: number) => void } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? 'POST', url, true);
    // Same-origin call to the Nitro BFF: the session cookie rides along and the proxy attaches the bearer.
    xhr.withCredentials = true;
    xhr.responseType = 'text';

    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const clearWatchdog = () => clearTimeout(watchdog);
    const fail = (err: UploadError) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      xhr.abort();
      reject(err);
    };
    const succeed = (value: T) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      resolve(value);
    };

    // Re-armed on every sign of life. If it ever fires, the transfer is dead: bytes stopped moving (the
    // 413-and-close case) or the backend went away mid-request.
    const arm = (ms: number, code: Extract<UploadErrorCode, 'upload_stalled' | 'upload_no_response'>) => {
      clearWatchdog();
      watchdog = setTimeout(() => fail(makeUploadError(code)), ms);
    };

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      }
      arm(STALL_TIMEOUT_MS, 'upload_stalled');
    });
    // All bytes are out; from here we're waiting on the backend, which is allowed to take much longer.
    xhr.upload.addEventListener('load', () => arm(RESPONSE_TIMEOUT_MS, 'upload_no_response'));

    xhr.addEventListener('load', () => {
      clearWatchdog();
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        succeed(body as T);
        return;
      }
      // Preserve the API's stable error codes so callers keep mapping them to friendly copy.
      const err = new Error(`Upload failed with status ${xhr.status}`) as UploadError;
      err.statusCode = xhr.status;
      err.data = (body ?? { code: 'upload_failed' }) as UploadError['data'];
      fail(err);
    });
    xhr.addEventListener('error', () => fail(makeUploadError('upload_network')));
    xhr.addEventListener('abort', () => fail(makeUploadError('upload_network')));

    arm(STALL_TIMEOUT_MS, 'upload_stalled');
    xhr.send(form);
  });
}
