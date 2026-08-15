import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Run the suite against core's source rather than its build output, so
      // `pnpm test` needs no prior `pnpm build` and never tests a stale bundle.
      '@fettle/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
});
