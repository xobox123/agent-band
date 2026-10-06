import { ConfigError, loadConfig } from './platform/config.ts';
import { start } from './server.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = await start(config);

  const shutdown = (): void => {
    server.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(err);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
