export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  typescript: { strict: true, typeCheck: false, tsConfig: { compilerOptions: { types: ['node'] } } },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:8000',
    },
  },
  devServer: { port: 8001 },
  compatibilityDate: '2026-06-18',
});
