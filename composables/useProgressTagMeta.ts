// The ONE place that turns a progress tag KEY into a human label (spec §1.2). Every chip render site uses
// this — never a second lookup. The API sends only `{ key, group }`; the label is our i18n concern. The
// missing-key path renders a LOCALIZED generic ("Etiqueta" / "Tag"), never `progress.tags.FOO` and never a
// title-cased English guess (which would reintroduce the very leak we are closing). The parity test makes
// the fallback unreachable for known keys.
export function useProgressTagMeta() {
  const { t, te } = useI18n();
  const tagLabel = (key: string): string => {
    const path = `progress.tags.${key}`;
    return te(path) ? t(path) : t('progress.tags.unknown');
  };
  return { tagLabel };
}
