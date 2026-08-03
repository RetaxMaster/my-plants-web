import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Nuxt's real dev/build pipeline resolves `import.meta.client`/`import.meta.server` (used by useOverlay.ts's
// scroll-lock/focus-restore watcher, useIsDesktop, etc.) through its OWN dedicated Vite plugin — not Vite
// core's built-in definePlugin. Vite core's definePlugin deliberately SKIPS these substitutions for a
// "client"-consumer environment while serving (non-build) — `environment.config.consumer === 'client' &&
// !isBuild` — which is exactly the environment Vitest's `happy-dom` test files run under (a plain top-level
// `define: { 'import.meta.client': true }` in this config only reaches plain `node`-environment test files,
// not happy-dom ones — verified empirically: a `node` test sees `true`, a `happy-dom` test sees `undefined`
// for the identical config). So the composable/component tests below — which are the FIRST in this repo to
// exercise an `import.meta.client`-gated code path under happy-dom — need this dedicated, unconditional
// substitution to see the client-side branch a real browser would run, instead of silently short-circuiting.
function importMetaClientPlugin(): Plugin {
  return {
    name: 'test-import-meta-client',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('/node_modules/')) return null;
      if (!/import\.meta\.(client|server)\b/.test(code)) return null;
      return {
        code: code.replace(/import\.meta\.client\b/g, 'true').replace(/import\.meta\.server\b/g, 'false'),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [importMetaClientPlugin(), vue()],
  // Mirrors `.nuxt/tsconfig.json`'s own `"~": [".."]` / `"~/*": ["../*"]` — Nuxt's real dev/build pipeline
  // resolves this alias through its own tooling, which plain `vitest.config.ts` never sees. Needed the
  // moment a component test mounts a `.vue` file that imports a composable via an explicit `~/composables/
  // ...` path rather than relying on Nuxt's auto-import (TaskRow.vue is the first — every other
  // `components/ui/*.vue` file relies on auto-import, so this alias was never needed before it).
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // `server/**` carries the BFF proxy's wire test: it boots the REAL event handler over a REAL socket,
    // because the shape the browser receives is produced by the proxy and is invisible to both the API's
    // e2e and to any component test that stubs the adapter. Four defects of that family have shipped.
    // ⚠️ `pages/**` is listed for a reason worth keeping: a test file placed under a directory that is
    // NOT in this list is silently never collected, and `npm test` reports green while the assertion has
    // never executed once. The first page-level test in this repo (the gardener entry point, which pins
    // an explicit owner ruling about WHERE that action may appear) would have been exactly that kind of
    // vacuous gate. Adding a test under a new top-level directory means adding it here in the same change.
    include: ['utils/**/*.test.ts', 'i18n/**/*.test.ts', 'components/**/*.test.ts', 'types/**/*.test.ts', 'composables/**/*.test.ts', 'server/**/*.test.ts', 'pages/**/*.test.ts'],
    // Node stays the DEFAULT (keeps util/i18n tests hermetic); component test files opt into a DOM
    // per-file via `// @vitest-environment happy-dom` at the top of the file.
    environment: 'node',
  },
});
