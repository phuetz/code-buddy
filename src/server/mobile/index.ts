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
import { isDirectLoopbackRequest } from '../middleware/auth.js';
import { verifyToken } from '../auth/jwt.js';
import { listAlbum, readAlbumEntry } from './album.js';
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

/**
 * The album carries the couple's photos, so unlike the PWA shell it is NOT
 * public. This router is mounted BEFORE the global auth middleware (the shell
 * has to be reachable without a token), so the guard is enforced here: a valid
 * JWT, or a DIRECT loopback request — the same standard `requireLocal-
 * AnonymousAccess` applies, no proxy assertion is trusted.
 */
export function requireAlbumAccess(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const secret = process.env.JWT_SECRET ?? '';
  if (token && secret && verifyToken(token, secret)) {
    next();
    return;
  }
  if (isDirectLoopbackRequest(req.socket.remoteAddress, req.headers)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized', message: 'Album access requires a token' });
}

const ALBUM_ID = /^[0-9a-f]{64}$/;

mobilePwaRouter.get('/album', requireAlbumAccess, async (_req: Request, res: Response) => {
  try {
    // Never a path: the response carries opaque ids and metadata only.
    res.json({ entries: await listAlbum() });
  } catch (error) {
    logger.warn('Mobile album listing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.json({ entries: [] });
  }
});

mobilePwaRouter.get('/album/:id', requireAlbumAccess, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!ALBUM_ID.test(id)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid album id' });
    return;
  }
  const entry = await readAlbumEntry(id);
  if (!entry) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.setHeader('Content-Type', entry.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(entry.bytes);
});

mobilePwaRouter.post('/album/:id/favorite', requireAlbumAccess, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!ALBUM_ID.test(id)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid album id' });
    return;
  }
  const favorite = (req.body as { favorite?: unknown } | undefined)?.favorite !== false;
  const { setSharedPhotoFavorite } = await import('../../companion/shared-photos.js');
  const updated = await setSharedPhotoFavorite(id, favorite);
  if (!updated) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ id, favorite: updated.favorite === true });
});

mobilePwaRouter.delete('/album/:id', requireAlbumAccess, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!ALBUM_ID.test(id)) {
    res.status(400).json({ error: 'Bad request', message: 'Invalid album id' });
    return;
  }
  const { deleteSharedPhoto } = await import('../../companion/shared-photos.js');
  const removed = await deleteSharedPhoto(id);
  if (!removed) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ id, deleted: true });
});

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
      '/__codebuddy__/mobile/album',
      '/__codebuddy__/mobile/album/{id}',
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
