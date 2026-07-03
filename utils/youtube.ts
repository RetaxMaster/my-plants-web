// Extract the 11-char YouTube video id from any common URL form. We render our OWN embed component
// from this id — we never inject a raw <iframe> from post content (that is the security boundary).
const PATTERNS = [
  /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
];

export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  for (const re of PATTERNS) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

// Privacy-friendly embed host (youtube-nocookie). Returns null when the URL yields no id.
export function youtubeEmbedUrl(url: string | null | undefined): string | null {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
