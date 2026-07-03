// One source of truth for choosing a bilingual field by the active locale, with a fallback to the
// other language (so a post authored in only one language never renders empty). ES leads by product
// rule, but this helper is symmetric — the caller passes the active locale.
export function pickLocalized(
  locale: string,
  es: string | null | undefined,
  en: string | null | undefined,
): string | null {
  const preferred = locale === 'es' ? es : en;
  const other = locale === 'es' ? en : es;
  return preferred ?? other ?? null;
}
