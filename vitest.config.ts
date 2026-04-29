import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/setup/global.ts'],
    setupFiles: ['./tests/setup/test-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Single shared Postgres container + TRUNCATE per test means files cannot
    // run in parallel — file A's beforeEach TRUNCATE would wipe file B's data
    // mid-test. Tests inside one file are still serial by default.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
