import { describe, expect, it, vi } from 'vitest';
import type { ImageCodecPort } from '@retaxmaster/agents-realtime-client';
import { useImageCompression, savingsOf } from './useImageCompression';

// A canvas-free fake codec port (the optimiseImage seam). measure/decode report an over-ceiling image;
// encode returns a much smaller WebP blob. This exercises the REAL optimiseImage pipeline with no DOM.
function makePort(encodeSpy?: (size: { width: number; height: number }) => void): ImageCodecPort {
  return {
    async measure() { return { width: 4000, height: 3000 }; },
    async decode() { return { image: {}, width: 4000, height: 3000 }; },
    async encode(_image, size) { encodeSpy?.(size); return new Blob([new Uint8Array(50_000)], { type: 'image/webp' }); },
    async canEncode(mime) { return mime === 'image/webp'; },
  };
}

function jpeg(bytes = 500_000): File {
  return new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
}

describe('useImageCompression', () => {
  it('compresses through optimiseImage at the IMAGE_MAX_EDGE ceiling and rewrites the filename/mime', async () => {
    const seen: { width: number; height: number }[] = [];
    const { compress } = useImageCompression();
    const out = await compress(jpeg(), { port: makePort((s) => seen.push(s)) });
    // 4000x3000 scaled to a 1600 long edge → encode receives 1600x1200 (proves IMAGE_MAX_EDGE flows through).
    expect(seen[0].width).toBe(1600);
    expect(seen[0].height).toBe(1200);
    expect(out.wasOptimised).toBe(true);
    expect(out.sentBytes).toBeLessThan(out.originalBytes);
    expect(out.mimeType).toBe('image/webp');
    expect(out.filename).toBe('photo.webp');
  });

  it('HD toggle passes the original through untouched (originalQuality escape hatch)', async () => {
    const { compress } = useImageCompression();
    const file = jpeg();
    const out = await compress(file, { hd: true, port: makePort() });
    expect(out.wasOptimised).toBe(false);
    expect(out.sentBytes).toBe(file.size);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.filename).toBe('photo.jpg');
  });

  it('savingsOf returns 0 for a non-optimised photo (never a fake saving) and the delta otherwise', () => {
    expect(savingsOf({ wasOptimised: false, originalBytes: 500_000, sentBytes: 500_000 })).toBe(0);
    expect(savingsOf({ wasOptimised: true, originalBytes: 500_000, sentBytes: 50_000 })).toBe(450_000);
  });
});
