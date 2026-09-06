/**
 * Mobile PWA Router
 *
 * Serves the mobile PWA static assets under /__codebuddy__/mobile/
 * This follows the same pattern as /__codebuddy__/canvas/ and /__codebuddy__/a2ui/
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, 'assets');

// Mobile PWA router
const mobilePwaRouter = Router();

// Security middleware for PWA assets - add basic security headers
mobilePwaRouter.use((req: Request, res: Response, next: NextFunction) => {
  // Add security headers for PWA
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/**
 * Serve the main PWA HTML file
 */
mobilePwaRouter.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(ASSETS_DIR, 'index.html'));
});

/**
 * Serve static assets (JS, CSS, images, etc.)
 */
mobilePwaRouter.get('/assets/*', async (req: Request, res: Response, next: NextFunction) => {
  const requestedPath = req.params[0] as string;
  const filePath = path.join(ASSETS_DIR, requestedPath);
  
  // Security check: ensure the path stays within assets directory
  if (!filePath.startsWith(ASSETS_DIR)) {
    logger.warn('Mobile PWA: Path traversal attempt detected', { path: requestedPath });
    return res.status(403).send('Forbidden');
  }
  
  // Check if file exists first
  const fs = await import('fs');
  if (!fs.default.existsSync(filePath)) {
    logger.debug('Mobile PWA: Asset not found', { path: requestedPath });
    return next();
  }
  
  res.sendFile(filePath);
});

/**
 * Serve the web manifest for PWA installation
 */
mobilePwaRouter.get('/manifest.webmanifest', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(ASSETS_DIR, 'manifest.webmanifest'));
});

/**
 * Serve the service worker
 */
mobilePwaRouter.get('/sw.js', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/__codebuddy__/mobile/');
  res.sendFile(path.join(ASSETS_DIR, 'sw.js'));
});

/**
 * Health check endpoint for the mobile PWA
 */
mobilePwaRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'mobile-pwa',
    timestamp: Date.now(),
    endpoints: [
      '/__codebuddy__/mobile/',
      '/__codebuddy__/mobile/manifest.webmanifest',
      '/__codebuddy__/mobile/sw.js',
      '/__codebuddy__/mobile/assets/*',
    ],
  });
});

/**
 * Generate mobile pairing QR code data
 * This endpoint returns the data needed to generate a QR code for mobile pairing
 */
mobilePwaRouter.get('/pairing-qr', (req: Request, res: Response) => {
  // Get the current pairing code from the mobile router
  // This is a simple integration point - in production, this would use the mobile router's pairing code
  const pairingData = {
    type: 'mobile-pairing',
    version: '1.0',
    timestamp: Date.now(),
    // The actual pairing code would be obtained from the mobile router
    // For now, return a placeholder - the real implementation would integrate with mobileRoutes
    placeholder: true,
  };
  
  res.json(pairingData);
});

export { mobilePwaRouter };
export default mobilePwaRouter;
