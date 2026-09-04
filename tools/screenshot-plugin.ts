import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dev-only endpoint: POST /__screenshot?name=foo with a data URL body
 * saves docs/screenshots/foo.png. Used by the debug hook window.game.shot('foo').
 */
export function screenshotPlugin(): Plugin {
  return {
    name: '7heaven-screenshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__screenshot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '', 'http://localhost');
        const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-zA-Z0-9_-]/g, '_');
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', () => {
          const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body);
          if (!m) {
            res.statusCode = 400;
            res.end('bad data url');
            return;
          }
          const dir = join(process.cwd(), 'docs', 'screenshots');
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `${name}.${m[1] === 'png' ? 'png' : 'jpg'}`);
          writeFileSync(file, Buffer.from(m[2]!, 'base64'));
          res.setHeader('content-type', 'text/plain');
          res.end(file);
        });
      });
    },
  };
}
