/**
 * Mobile PWA Router
 *
 * Serves the mobile PWA static assets under /__codebuddy__/mobile/
 * Same mount pattern as /__codebuddy__/canvas/ and /__codebuddy__/a2ui/.
 */

import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { buildMobileStatus } from './status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveMobilePwaAssetsDir(here = __dirname): string {
  const candidates = [
    path.join(here, 'assets'),
    path.resolve(here, '../../../src/server/mobile/assets'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return candidates[0] ?? path.join(here, 'assets');
}

export const MOBILE_PWA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const ASSETS_DIR = resolveMobilePwaAssetsDir();

const mobilePwaRouter = Router();

mobilePwaRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// `res.sendFile(absolutePath)` makes `send` apply its dotfile policy to EVERY
// segment of the path, so any install under a hidden directory — the norm for a
// global npm install (`~/.nvm/versions/node/...`, `~/.npm-global`) — 404s on its
// own bundled assets. Serving them relative to `root` scopes that policy to the
// requested name, and keeps the directory confinement `send` gives us.
export function sendAsset(res: Response, fileName: string, root: string = ASSETS_DIR): void {
  res.sendFile(fileName, { root });
}

function sendHtml(res: Response, fileName: string): void {
  res.setHeader('Content-Security-Policy', MOBILE_PWA_CSP);
  sendAsset(res, fileName);
}

mobilePwaRouter.get('/', (_req: Request, res: Response) => {
  sendHtml(res, 'index.html');
});

mobilePwaRouter.get('/manifest.webmanifest', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  sendAsset(res, 'manifest.webmanifest');
});

mobilePwaRouter.get('/sw.js', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/__codebuddy__/mobile/');
  sendAsset(res, 'sw.js');
});

mobilePwaRouter.use(
  '/assets',
  express.static(ASSETS_DIR, {
    index: false,
    fallthrough: false,
    dotfiles: 'deny',
  }),
);

mobilePwaRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'mobile-pwa',
    timestamp: Date.now(),
    endpoints: [
      '/__codebuddy__/mobile/',
      '/__codebuddy__/mobile/manifest.webmanifest',
      '/__codebuddy__/mobile/sw.js',
      '/__codebuddy__/mobile/status',
      '/__codebuddy__/mobile/assets/{*path}',
    ],
  });
});

mobilePwaRouter.get('/status', async (_req: Request, res: Response) => {
  res.json(await buildMobileStatus());
});

mobilePwaRouter.get('/pairing-qr', (_req: Request, res: Response) => {
  logger.debug('Mobile PWA: pairing-qr is a placeholder; JWT is entered on the device');
  res.json({
    type: 'mobile-pairing',
    version: '1.0',
    timestamp: Date.now(),
    placeholder: true,
  });
});

export function isMobilePwaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_MOBILE_PWA === 'true';
}

export { mobilePwaRouter };
export default mobilePwaRouter;
