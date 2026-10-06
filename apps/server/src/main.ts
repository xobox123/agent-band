import { buildApp } from './http/app.ts';
import { ConfigError, loadConfig } from './platform/config.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp({ logger: { level: config.logLevel } });

  const shutdown = (): void => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: '127.0.0.1', port: config.port });
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
