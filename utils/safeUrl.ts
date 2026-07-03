// Guard for author-supplied link targets (the blogpost CTA link). Blogpost fields are now authored
// through the UI and edited freely, so a stored `javascript:`/`data:` URL rendered straight into an
// <a href> would be a clickable XSS vector — the same threat renderMarkdown neutralises for body
// links. Allow only absolute http(s) URLs and site-relative paths; return null for anything else so
// the caller can render no button at all.
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Site-relative links (`/premium`) are safe; reject protocol-relative `//host` (treated as absolute).
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}
