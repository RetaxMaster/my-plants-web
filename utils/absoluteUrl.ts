// Resolve a possibly-relative asset URL to an ABSOLUTE http(s) URL against the request origin — used
// for og:image/twitter:image, which must be absolute to be valid. Returns null for empty input or any
// non-http(s) scheme (so a bad cover value omits the image tag instead of emitting a broken one).
export function absoluteUrl(path: string | null | undefined, origin: string): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  try {
    // If `trimmed` is already absolute the base is ignored; if it is relative it resolves against origin.
    const u = new URL(trimmed, origin);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
