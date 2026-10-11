import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server-slow',
    include: ['src/**/*.slow.test.ts'],
    // These tests spawn real processes (an `npx tsx` boot takes tens of seconds under load).
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
