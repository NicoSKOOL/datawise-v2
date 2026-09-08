import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Scoped to the worker so vitest does not walk up and load the SPA's
// vite.config.ts (which pulls in build-only plugins not installed here).
export default defineConfig({
  resolve: {
    alias: {
      // @cloudflare/workers-oauth-provider imports "cloudflare:workers" at
      // the top level, which only exists inside workerd. This worker's test
      // suite runs on plain Node, so we stub the one symbol it needs.
      'cloudflare:workers': path.resolve(__dirname, 'src/test-support/cloudflare-workers-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: {
      // node_modules packages are externalized (loaded via Node's native
      // import, bypassing the alias above) by default. This package must go
      // through Vite's resolver so the cloudflare:workers alias applies.
      deps: { inline: ['@cloudflare/workers-oauth-provider'] },
    },
  },
});
