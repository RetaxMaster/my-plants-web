import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['utils/**/*.test.ts', 'i18n/**/*.test.ts', 'components/**/*.test.ts'],
    // Node stays the DEFAULT (keeps util/i18n tests hermetic); component test files opt into a DOM
    // per-file via `// @vitest-environment happy-dom` at the top of the file.
    environment: 'node',
  },
});
