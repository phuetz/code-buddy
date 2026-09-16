import { Router, type RequestHandler } from 'express';
import { DeviceAuthError, getDeviceAuthStore, type DeviceAuthStore } from '../auth/device-store.js';
import { createRouteRateLimiter } from '../middleware/rate-limit.js';

/** Public proof-of-possession endpoints; code issuance remains local to the CLI. */
export function createDeviceAuthRoutes(secret: string, store?: DeviceAuthStore): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const getStore = () => store ?? getDeviceAuthStore();
  for (const route of ['register', 'challenge', 'verify'] as const) {
    const limit = createRouteRateLimiter({
      maxRequests: 10, windowMs: 60_000, keyPrefix: `device-auth:${route}`,
      // Do not trust arbitrary X-Forwarded-For on these unauthenticated routes.
      keyGenerator: req => req.socket.remoteAddress ?? 'unknown',
      handler: (_req, res) => { res.status(429).json({ error: 'Too many requests' }); },
    });
    const handle: RequestHandler = async (req, res) => {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown> : {};
      try {
        const service = getStore();
        const result = route === 'register'
          ? await service.register(body.pairingCode, body.deviceName, body.publicKeyJwk)
          : route === 'challenge'
            ? service.challenge(body.deviceId)
            : await service.verify(body.deviceId, body.nonce, body.signature, secret);
        res.json(result);
      } catch (error) {
        const failure = error instanceof DeviceAuthError ? error : new DeviceAuthError(503);
        res.status(failure.status).json({ error: failure.message });
      }
    };
    router.post(`/${route}`, limit, handle);
  }
  return router;
}
