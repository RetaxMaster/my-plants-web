export default defineNuxtConfig({
  modules: ['@nuxt/ui', 'nuxt-auth-utils', '@nuxt/fonts', '@nuxt/icon', '@nuxtjs/color-mode'],
  css: ['~/assets/css/design-system.css'],
  colorMode: { classSuffix: '', dataValue: 'theme', preference: 'light', fallback: 'light' },
  typescript: { strict: true, typeCheck: false, tsConfig: { compilerOptions: { types: ['node'] } } },
  runtimeConfig: {
    apiBase: process.env.NUXT_API_BASE ?? 'http://localhost:8000', // SERVER-ONLY: internal NestJS base
    // public.apiBase removed — the browser uses the same-origin /api proxy.
  },
  devServer: { port: 8001 },
  compatibilityDate: '2026-06-18',
});
