/**
 * Channel status routes.
 *
 * Exposes the ChannelManager runtime state without leaking channel secrets.
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/index.js';

export function createChannelRoutes(): Router {
  const router = Router();

  router.get('/status', asyncHandler(async (_req, res) => {
    const { getChannelManager } = await import('../../channels/index.js');
    const statusByType = getChannelManager().getStatus();
    const channels = Object.values(statusByType).map((status) => ({
      type: status.type,
      connected: status.connected,
      authenticated: status.authenticated,
      lastActivity: status.lastActivity?.toISOString() ?? null,
      error: status.error ?? null,
      info: status.info ?? {},
    }));

    res.json({
      total: channels.length,
      connected: channels.filter((channel) => channel.connected).length,
      channels,
    });
  }));

  return router;
}
