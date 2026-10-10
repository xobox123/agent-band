import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:4870' },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/test-setup.ts'],
    // jsdom rendering of whole screens is CPU bound and several times slower when the machine is
    // oversubscribed. These are ceilings for hung tests; passing tests finish as soon as they can.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
