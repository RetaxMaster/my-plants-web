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
  css: ['~/assets/css/design-system.css', '@retaxmaster/claude-realtime-client/style.css'],
  colorMode: { classSuffix: '', dataValue: 'theme', preference: 'light', fallback: 'light' },
  typescript: { strict: true, typeCheck: false, tsConfig: { compilerOptions: { types: ['node'] } } },
  app: {
    head: {
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
    // Persist the nuxt-auth-utils session cookie (default is a browser-session cookie that dies on
    // close — the root cause of "session drops when the browser/phone is killed"). Setting maxAge does
    // NOT weaken httpOnly/secure/sameSite (all still on by default). The server middleware re-issues
    // this cookie on every authenticated request so the window slides and never lapses (Clock A).
    // `password` is required by h3's SessionConfig type; nuxt-auth-utils already reads
    // NUXT_SESSION_PASSWORD via its own env-mapping, this just satisfies the type at the same value.
    session: {
      password: process.env.NUXT_SESSION_PASSWORD ?? '',
      maxAge: Number(process.env.NUXT_SESSION_MAX_AGE ?? 60 * 60 * 24 * 30), // 30 days, in seconds
    },
    public: {
      // v1 local-only: the browser connects DIRECTLY to the embedded engine's localhost Socket.IO
      // (the Nitro proxy is HTTP-only and cannot proxy a WS upgrade). Access is gated by the
      // single-use admin-minted ticket. A production WS reverse-proxy is a deferred deploy concern.
      knowledgeChatSocketUrl: process.env.NUXT_PUBLIC_KNOWLEDGE_CHAT_SOCKET_URL ?? 'http://127.0.0.1:8010',
    },
  },
  devServer: { port: 8001 },
  compatibilityDate: '2026-06-18',
});
