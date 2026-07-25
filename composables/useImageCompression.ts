// THE single shared upload-compression seam (spec §3b). Every upload entry point in the app — progress
// create, progress edit, the cover photo, and Spec 4's import batch — maps each selected file through this
// before assembling its FormData, so compression lives in exactly ONE place (no per-call duplication).
//
// It is a thin wrapper over `optimiseImage` from @retaxmaster/agents-realtime-client (already a dependency):
// resize the long edge to IMAGE_MAX_EDGE, prefer WebP with a JPEG fallback, apply EXIF orientation, fail
// OPEN (a compression failure uploads the original — never blocks the send), grow-guard, PNG passthrough.
// We reimplement none of that (fork-prevention) — we only supply options and shape the result for FormData.
import { optimiseImage, DEFAULT_IMAGE_QUALITY } from '@retaxmaster/agents-realtime-client';
import type { ImageCodecPort, OptimiseImageOptions } from '@retaxmaster/agents-realtime-client';
import { IMAGE_MAX_EDGE } from '@retaxmaster/my-plants-species-schema/image-limits';

// What the seam hands a caller: the bytes to send (blob), the wire filename/mime (extension rewritten from
// the encoded format), and honest before/after sizes for the savings indicator.
export interface CompressedUpload {
  blob: Blob;
  filename: string;
  mimeType: string;
  originalBytes: number;
  sentBytes: number;
  wasOptimised: boolean;
}

// Client quality (spec §3a): the package default (0.9). The client is transport; the backend re-encodes at
// WebP q82. Double WebP at a 1600 px edge is visually negligible, and lowering it saves far less than the
// resize already did — no measured reason to go below the default.
const CLIENT_QUALITY = DEFAULT_IMAGE_QUALITY;

export interface CompressOptions {
  /** HD / original escape hatch — send the untouched original for a photo that really matters. Default off. */
  hd?: boolean;
  /** Inject a codec port in unit tests (the DOM-backed default is used in the browser). */
  port?: ImageCodecPort;
}

/** The saving to show, in bytes. NEVER a fake number: a non-optimised photo (PNG passthrough, HD toggle, or
 *  growth guard) saved nothing, so it returns 0 and the UI shows "original" instead of a bogus reduction. */
export function savingsOf(r: Pick<CompressedUpload, 'wasOptimised' | 'originalBytes' | 'sentBytes'>): number {
  if (!r.wasOptimised) return 0;
  return Math.max(0, r.originalBytes - r.sentBytes);
}

export function useImageCompression() {
  async function compress(file: File, opts: CompressOptions = {}): Promise<CompressedUpload> {
    const passthrough = (): CompressedUpload => ({
      blob: file, filename: file.name, mimeType: file.type,
      originalBytes: file.size, sentBytes: file.size, wasOptimised: false,
    });
    // SSR safety (spec §4): optimiseImage resolves its DOM codec port lazily, and uploads are user-initiated
    // in the browser. Off the client (and with no injected test port) return the file untouched.
    if (!opts.port && !import.meta.client) return passthrough();
    try {
      const options: OptimiseImageOptions = {
        maxEdge: IMAGE_MAX_EDGE,
        quality: CLIENT_QUALITY,
        originalQuality: opts.hd === true,
      };
      if (opts.port) options.port = opts.port;
      const r = await optimiseImage(file, file.name, file.type, options);
      return {
        blob: r.blob, filename: r.filename, mimeType: r.mimeType,
        originalBytes: r.originalBytes, sentBytes: r.sentBytes, wasOptimised: r.wasOptimised,
      };
    } catch {
      // Defensive fail-open on top of optimiseImage's own: a compression failure must NEVER block the send.
      return passthrough();
    }
  }
  return { compress };
}
