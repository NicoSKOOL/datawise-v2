import { defineConfig } from 'vitest/config';

// Scoped to the worker so vitest does not walk up and load the SPA's
// vite.config.ts (which pulls in build-only plugins not installed here).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
