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
