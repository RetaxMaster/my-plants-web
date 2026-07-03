export default defineNuxtConfig({
  modules: ['nuxt-auth-utils', '@nuxt/fonts', '@nuxt/icon', '@nuxtjs/color-mode'],
  css: ['~/assets/css/design-system.css', '@retaxmaster/claude-realtime-client/style.css'],
  colorMode: { classSuffix: '', dataValue: 'theme', preference: 'light', fallback: 'light' },
  typescript: { strict: true, typeCheck: false, tsConfig: { compilerOptions: { types: ['node'] } } },
  app: {
    head: {
      // The chat console references Hanken Grotesk / JetBrains Mono / Newsreader; the client package
      // never injects font <link>s (privacy/CSP), so we load them here.
      link: [
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
