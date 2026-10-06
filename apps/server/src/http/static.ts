import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function fileIn(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const full = resolve(join(root, normalize(decoded)));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

/** Serves a built SPA with index.html fallback. Does nothing when the directory is missing. */
export function registerStatic(app: FastifyInstance, dir: string): boolean {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) return false;

  app.get('/*', { schema: { hide: true } }, (req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (path === '/api' || path.startsWith('/api/')) {
      reply.callNotFound();
      return;
    }
    const file = fileIn(root, path);
    const target = file ?? index;
    const isAsset = file !== null && file !== index;
    return reply
      .type(MIME[extname(target).toLowerCase()] ?? 'application/octet-stream')
      .header('cache-control', isAsset ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(createReadStream(target));
  });
  return true;
}
