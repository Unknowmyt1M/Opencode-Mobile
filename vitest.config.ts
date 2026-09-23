import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/opencode-dev/**'],
    hookTimeout: 30000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
