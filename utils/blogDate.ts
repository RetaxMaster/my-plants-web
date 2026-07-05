// Format a blogpost's ISO `publishedAt` into a short, localized date (e.g. "Jun 12, 2026" / "12 jun
// 2026"). Locale-driven via toLocaleDateString; publishedAt arrives as an ISO string over JSON.
export function formatBlogDate(locale: string, iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// The FULL byline date for an article: long month + time with a.m./p.m., joined with "a las"/"at"
// (e.g. "3 de julio de 2026 a las 8:30 p.m." / "July 3, 2026 at 8:30 PM"). A FIXED time zone is used so
// the SSR render and the client render produce the identical string (no hydration mismatch on a
// server in a different zone than the visitor).
const BLOG_TZ = 'America/Mexico_City';
// ICU inserts a NARROW NO-BREAK SPACE (U+202F) before a.m./p.m.; built via fromCharCode so the source
// carries no invisible character. Normalized to a plain space for a clean, copyable byline.
const NNBSP = new RegExp(String.fromCharCode(0x202f), 'g');
export function formatBlogDateFull(locale: string, iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const loc = locale === 'es' ? 'es-MX' : 'en-US';
  const date = new Intl.DateTimeFormat(loc, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: BLOG_TZ,
  }).format(d);
  const time = new Intl.DateTimeFormat(loc, {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: BLOG_TZ,
  }).format(d).replace(NNBSP, ' ');
  return `${date} ${locale === 'es' ? 'a las' : 'at'} ${time}`;
}
