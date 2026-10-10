import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The real-process suite runs separately via `npm run test:slow`.
    exclude: ['**/node_modules/**', 'src/**/*.slow.test.ts'],
    // PGlite startup, migrations and worker polling slow down by 10x or more when the machine is
    // oversubscribed (several full suites in parallel). Waits return as soon as their condition
    // holds, so these are only ceilings for hung tests, not expected durations.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
