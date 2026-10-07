import { ConfigError, loadConfig } from './platform/config.ts';
import { CliLocator } from './runner/index.ts';
import { start } from './server.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const cliLocator = new CliLocator({ overrides: config.cliBins });
  for (const [name, d] of Object.entries(await cliLocator.detectAll()))
    console.log(
      d.binary
        ? `${name}: ${d.binary} (${d.version ?? 'unknown version'}, ${d.source})`
        : `${name}: ${d.error}`,
    );
  const server = await start(config, { cliLocator });

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
