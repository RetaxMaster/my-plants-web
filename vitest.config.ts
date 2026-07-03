import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['utils/**/*.test.ts', 'i18n/**/*.test.ts'], environment: 'node' },
});
