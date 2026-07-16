// A COURTESY check (spec §6.1) — it saves the user a pointless multi-MB upload on mobile data. It is NOT a
// security control: the browser is the client and can be bypassed. The API re-enforces MAX_IMAGE_PIXELS by
// decoding server-side (the real guard). This reads only the HEADER BYTES of the three formats we accept and
// FAILS OPEN: an unparseable header returns null and the file passes through — the client is never a stricter
// gate than the server. No decode, no canvas, no createObjectURL — nothing to revoke, nothing to leak.
export interface ImageSize { width: number; height: number }

export function parseImageSize(bytes: Uint8Array): ImageSize | null {
  return parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
}

function parsePng(b: Uint8Array): ImageSize | null {
  // 8-byte signature, then IHDR (length+type at 8..15, width/height big-endian at 16..23).
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const dv = new DataView(b.buffer, b.byteOffset);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function parseJpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null; // SOI
  let i = 2;
  const dv = new DataView(b.buffer, b.byteOffset);
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0..SOF15 (baseline/progressive), excluding DHT(0xC4)/DNL(0xC8)/DAC(0xCC): height at +5, width at +7.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
    }
    const len = dv.getUint16(i + 2);
    i += 2 + len;
  }
  return null;
}

function parseWebp(b: Uint8Array): ImageSize | null {
  // 'RIFF'....'WEBP' then a VP8 / VP8L / VP8X chunk. Parse ALL THREE — a phone-exported WebP is usually
  // VP8 (lossy) or VP8L (lossless), so handling only VP8X would fail-open on the common case.
  if (b.length < 16 || b[0] !== 0x52 /* R */ || b[8] !== 0x57 /* 'W' of WEBP */) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);

  if (fourcc === 'VP8X') {
    // Extended: explicit 24-bit (value-1) canvas dims at 24..29, little-endian.
    if (b.length < 30) return null;
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width: w, height: h };
  }

  if (fourcc === 'VP8 ') {
    // Lossy: after the 'VP8 ' chunk header (12..15) + chunk size (16..19) comes the frame tag (20..22),
    // the 3-byte start code 0x9d 0x01 0x2a (23..25), then 14-bit width and height little-endian at 26..29.
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const w = (b[26] | (b[27] << 8)) & 0x3fff;
    const h = (b[28] | (b[29] << 8)) & 0x3fff;
    return { width: w, height: h };
  }

  if (fourcc === 'VP8L') {
    // Lossless: after the 'VP8L' chunk header + size, byte 20 is the 0x2f signature, then 14-bit width and
    // 14-bit height (each minus 1) packed little-endian across bytes 21..24.
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { width: w, height: h };
  }

  return null; // unknown WebP variant → fail open
}

// Read only a small header slice — never the whole file, never a decode.
export async function readImageSize(file: File): Promise<ImageSize | null> {
  try {
    const slice = await file.slice(0, 64 * 1024).arrayBuffer();
    return parseImageSize(new Uint8Array(slice));
  } catch {
    return null; // fail open
  }
}
