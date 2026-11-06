import { defineConfig } from 'vitest/config';

// Needs the real topology: run `pnpm run infra:up` first.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
