import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/platform/schema.ts', './src/modules/*/infra/schema.ts', './src/execution/infra/schema.ts'],
  out: './drizzle',
});
