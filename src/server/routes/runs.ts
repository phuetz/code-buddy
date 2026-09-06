/**
 * Run observability HTTP routes for the mobile PWA.
 *
 * GET /api/runs
 * GET /api/runs/:id/trajectory
 * GET /api/status  (provider + provider-health.json + fleet)
 */

import { Router, type Request, type Response } from 'express';
import { RunStore } from '../../observability/run-store.js';
import { loadTrajectory, parseTrajectorySince } from '../../observability/run-trajectory-load.js';
import { asyncHandler, requireScope, ApiServerError } from '../middleware/index.js';
import { buildMobileStatus, listFleetPeersForMobile } from '../mobile/status.js';

const router = Router();

function getStringParam(param: string | string[] | undefined): string {
  return (Array.isArray(param) ? param[0] : param) || '';
}

router.get(
  '/runs',
  requireScope('chat', 'sessions'),
  asyncHandler(async (_req: Request, res: Response) => {
    const store = RunStore.getInstance();
    const runs = store.listRuns(50);
    res.json({ runs });
  }),
);

router.get(
  '/runs/:id/trajectory',
  requireScope('chat', 'sessions'),
  asyncHandler(async (req: Request, res: Response) => {
    const runId = getStringParam(req.params.id);
    if (!runId) {
      throw ApiServerError.badRequest('run id is required');
    }
    const store = RunStore.getInstance();
    const record = store.getRun(runId);
    if (!record) {
      throw ApiServerError.notFound('Run');
    }
    let since: number | undefined;
    try {
      since = parseTrajectorySince(
        typeof req.query.since === 'string' ? req.query.since : undefined,
      );
    } catch (error) {
      throw ApiServerError.badRequest(error instanceof Error ? error.message : String(error));
    }
    const trajectory = loadTrajectory(runId, { since, store });
    res.json(trajectory);
  }),
);

router.get(
  '/status',
  requireScope('chat', 'sessions'),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await buildMobileStatus());
  }),
);

router.get(
  '/fleet/peers',
  requireScope('chat', 'sessions'),
  asyncHandler(async (_req: Request, res: Response) => {
    const peers = await listFleetPeersForMobile();
    res.json({ peers });
  }),
);

export default router;
