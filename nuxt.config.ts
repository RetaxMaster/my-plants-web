export default defineNuxtConfig({
  modules: ['nuxt-auth-utils', '@nuxt/fonts', '@nuxt/icon', '@nuxtjs/color-mode', '@nuxtjs/i18n'],
  i18n: {
    // The locale is NEVER in the URL — it is internal state + a cookie. This is the
    // mechanism that satisfies "handle language as internal state, no /en or /es".
    strategy: 'no_prefix',
    // Fallback when the browser is neither en nor es.
    defaultLocale: 'en',
    // Lazy-load each locale's JSON so only the active catalogue ships.
    lazy: true,
    langDir: 'locales',
    // vue-i18n runtime options (fallbackLocale, later datetime/number formats).
    vueI18n: './i18n.config.ts',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'es', language: 'es-MX', name: 'Español', file: 'es.json' },
    ],
    // SSR-safe browser detection with cookie persistence. Under no_prefix there is
    // no URL redirect: the module resolves the active locale from the cookie (if
    // present) else the Accept-Language header, and writes the cookie — all during
    // SSR, so the FIRST HTML paint is already in the resolved locale (no flash, no
    // hydration mismatch). alwaysRedirect:false → once the user picks a locale, the
    // cookie wins over the browser on later visits. redirectOn is deliberately
    // OMITTED: it only governs URL-prefix redirects, which no_prefix never performs.
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      fallbackLocale: 'en',
      alwaysRedirect: false,
    },
  },
  css: ['~/assets/css/design-system.css', '@retaxmaster/agents-realtime-client/style.css'],
  colorMode: { classSuffix: '', dataValue: 'theme', preference: 'light', fallback: 'light' },
  typescript: { strict: true, typeCheck: false, tsConfig: { compilerOptions: { types: ['node'] } } },
  app: {
    head: {
      // Disable the mobile browser's pinch/auto-zoom. Primarily to stop iOS Safari's zoom-on-focus of
      // text inputs (it zooms when a focused field's font-size is < 16px, and our controls use 14px).
      // NOTE: this overrides Nuxt's default `width=device-width, initial-scale=1`. Trade-off owned by
      // the product owner: it also suppresses pinch-to-zoom app-wide (a per-image zoom is a future
      // feature). Caveat: modern iOS ignores `user-scalable=no`; `maximum-scale=1` is what actually
      // curbs the focus-zoom there.
      meta: [
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no',
        },
      ],
      // The chat console references Hanken Grotesk / JetBrains Mono / Newsreader; the client package
      // never injects font <link>s (privacy/CSP), so we load them here.
      link: [
        // Browser-tab icon: the MyPlants sprout, served from public/ at the site root.
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;600&family=Newsreader:ital@0;1&display=swap',
        },
      ],
    },
  },
  runtimeConfig: {
    apiBase: process.env.NUXT_API_BASE ?? 'http://localhost:8000', // SERVER-ONLY: internal NestJS base
    // Persist + SLIDE the nuxt-auth-utils session cookie. IMPORTANT: use `cookie.maxAge` (the cookie's
    // Max-Age attribute, re-sent on every response so the browser's countdown resets = a sliding idle
    // window) — NOT the top-level `session.maxAge`, which is h3's ABSOLUTE lifetime (embeds createdAt in
    // the seal and throws "Session expired!" past it regardless of activity). The absolute ceiling lives
    // in the backend instead (JWT exp + the sst/SESSION_ABSOLUTE_MAX_DAYS 90-day cap). `password` is
    // required by h3's SessionConfig type; nuxt-auth-utils already reads NUXT_SESSION_PASSWORD via its
    // own env-mapping — this just satisfies the type at the same value. httpOnly/secure/sameSite stay on.
    session: {
      password: process.env.NUXT_SESSION_PASSWORD ?? '',
      cookie: {
        maxAge: Number(process.env.NUXT_SESSION_MAX_AGE ?? 60 * 60 * 24 * 30), // 30 days, seconds — idle window
      },
    },
    public: {
      // v1 local-only: the browser connects DIRECTLY to the embedded engine's localhost Socket.IO
      // (the Nitro proxy is HTTP-only and cannot proxy a WS upgrade). Access is gated by the
      // single-use admin-minted ticket. A production WS reverse-proxy is a deferred deploy concern.
      knowledgeChatSocketUrl: process.env.NUXT_PUBLIC_KNOWLEDGE_CHAT_SOCKET_URL ?? 'http://127.0.0.1:8010',
      // The Plant Doctor engine's localhost Socket.IO (a SECOND agents-realtime engine, doctor cwd/role;
      // Spec 3 §2/§5.1). Same direct-connect + single-use-ticket model as the KE socket. Dev = the doctor
      // engine's dev port `8400` (claimed by the API plan in PORTS.md, from the free range 8400–8790 — the KE
      // engine's 8010 is taken and 8011 is NOT free); prod = the doctor wss subdomain. It MUST equal the
      // API's PLANT_DOCTOR_CHAT_ENGINE_PORT. If §2 collapses the two engines into one, this equals
      // knowledgeChatSocketUrl.
      plantDoctorSocketUrl: process.env.NUXT_PUBLIC_PLANT_DOCTOR_SOCKET_URL ?? 'http://127.0.0.1:8400',
    },
  },
  devServer: { port: 8001 },
  compatibilityDate: '2026-06-18',
});
