import { defineConfig } from 'vitest/config';

/** `npm run loadtest --workspace server`. Kept out of the normal test run: it takes a minute. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['loadtest/**/*.load.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
