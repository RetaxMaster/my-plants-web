// vue-i18n runtime options for @nuxtjs/i18n. Message CATALOGUES are the lazy
// per-locale JSON files (i18n/locales/*.json); this file carries the non-message
// vue-i18n options. fallbackLocale 'en' means any missing key falls back to the
// English value (so a half-translated key never renders blank). Phase 3 adds
// datetimeFormats/numberFormats here for locale-aware $d/$n.
export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'en',
  // Keyed by the ACTIVE locale `code` (en/es) — the same key vue-i18n uses for
  // $d/d resolution — NOT the BCP-47 language (en-US/es-MX). Keying by language
  // would make $d find no format and fall back to a default/ISO rendering.
  datetimeFormats: {
    en: { long: { weekday: 'long', month: 'long', day: 'numeric' } },
    es: { long: { weekday: 'long', month: 'long', day: 'numeric' } },
  },
}));
