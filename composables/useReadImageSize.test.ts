import { describe, expect, it } from 'vitest';
import { parseImageSize } from './useReadImageSize';

// Minimal real headers, byte-parsed (NO decode). Build tiny fixtures in-test.

function buildPngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  // 8-byte PNG signature.
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length (4 bytes, unused by the parser) + type "IHDR" at 8..15.
  b.set([0x00, 0x00, 0x00, 0x0d], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}

function buildJpegSof0(width: number, height: number): Uint8Array {
  // SOI, then an SOF0 (0xFFC0) marker segment: length(2) + precision(1) + height(2) + width(2) + ...
  const b = new Uint8Array(19);
  b[0] = 0xff; b[1] = 0xd8; // SOI
  b[2] = 0xff; b[3] = 0xc0; // SOF0
  const dv = new DataView(b.buffer);
  dv.setUint16(4, 17); // segment length (precision+H+W+1 component*3 + 2)
  b[6] = 0x08; // precision
  dv.setUint16(7, height);
  dv.setUint16(9, width);
  b[11] = 0x01; // number of components
  b[12] = 0x01; b[13] = 0x11; b[14] = 0x00; // component 1
  b[15] = 0xff; b[16] = 0xd9; // EOI (unused, just padding to satisfy the `i + 9 < length` scan bound)
  return b;
}

function buildWebpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  b.set([0x00, 0x00, 0x00, 0x00], 4); // RIFF size (unused)
  b.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
  b.set([0x56, 0x50, 0x38, 0x58], 12); // 'VP8X'
  b.set([0x00, 0x00, 0x00, 0x00], 16); // chunk size (unused)
  b[20] = 0x00; // flags
  b[21] = 0x00; b[22] = 0x00; b[23] = 0x00; // reserved
  const w = width - 1;
  const h = height - 1;
  b[24] = w & 0xff; b[25] = (w >> 8) & 0xff; b[26] = (w >> 16) & 0xff;
  b[27] = h & 0xff; b[28] = (h >> 8) & 0xff; b[29] = (h >> 16) & 0xff;
  return b;
}

function buildWebpVp8(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  b.set([0x00, 0x00, 0x00, 0x00], 4);
  b.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
  b.set([0x56, 0x50, 0x38, 0x20], 12); // 'VP8 '
  b.set([0x00, 0x00, 0x00, 0x00], 16); // chunk size (unused)
  b[20] = 0x00; b[21] = 0x00; b[22] = 0x00; // frame tag (unused by the parser)
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; // start code
  b[26] = width & 0xff; b[27] = (width >> 8) & 0x3f;
  b[28] = height & 0xff; b[29] = (height >> 8) & 0x3f;
  return b;
}

function buildWebpVp8l(width: number, height: number): Uint8Array {
  const b = new Uint8Array(25);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  b.set([0x00, 0x00, 0x00, 0x00], 4);
  b.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // 'VP8L'
  b.set([0x00, 0x00, 0x00, 0x00], 16); // chunk size (unused)
  b[20] = 0x2f; // signature
  const w = width - 1;
  const h = height - 1;
  const bits = (w & 0x3fff) | ((h & 0x3fff) << 14);
  b[21] = bits & 0xff;
  b[22] = (bits >> 8) & 0xff;
  b[23] = (bits >> 16) & 0xff;
  b[24] = (bits >> 24) & 0xff;
  return b;
}

describe('parseImageSize', () => {
  it('reads PNG IHDR dimensions', () => {
    // 8-byte PNG signature + IHDR chunk with width=0x00002000 (8192), height=0x00002000.
    const png = buildPngHeader(8192, 8192);
    expect(parseImageSize(png)).toEqual({ width: 8192, height: 8192 });
  });
  it('reads JPEG SOF0 dimensions', () => {
    expect(parseImageSize(buildJpegSof0(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });
  it('reads WebP VP8X (extended) dimensions', () => {
    expect(parseImageSize(buildWebpVp8x(5000, 4000))).toEqual({ width: 5000, height: 4000 });
  });
  it('reads WebP VP8 (lossy) dimensions', () => {
    expect(parseImageSize(buildWebpVp8(1024, 768))).toEqual({ width: 1024, height: 768 });
  });
  it('reads WebP VP8L (lossless) dimensions', () => {
    expect(parseImageSize(buildWebpVp8l(640, 480))).toEqual({ width: 640, height: 480 });
  });
  it('returns null for an unparseable/unknown container (FAIL OPEN)', () => {
    expect(parseImageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
