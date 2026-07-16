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
  test: {
    include: ['utils/**/*.test.ts', 'i18n/**/*.test.ts', 'components/**/*.test.ts', 'types/**/*.test.ts', 'composables/**/*.test.ts'],
    // Node stays the DEFAULT (keeps util/i18n tests hermetic); component test files opt into a DOM
    // per-file via `// @vitest-environment happy-dom` at the top of the file.
    environment: 'node',
  },
});
