/**
 * Webhook Routes
 *
 * HTTP endpoints for receiving and managing webhook triggers.
 *
 * Endpoints:
 *   POST   /api/webhooks/:source         — Receive a webhook from a source
 *   GET    /api/webhooks/triggers         — List configured triggers
 *   POST   /api/webhooks/triggers         — Add a new trigger
 *   DELETE /api/webhooks/triggers/:id     — Remove a trigger
 *   POST   /api/webhooks/test             — Test a trigger with sample data
 */

import { Router, Request, Response } from 'express';
import { ApiServerError, asyncHandler } from '../middleware/index.js';
import { logger } from '../../utils/logger.js';

const router = Router();

// Lazy-load the WebhookTriggerManager to avoid circular deps
async function getManager() {
  const { getWebhookTriggerManager } = await import('../../triggers/webhook-trigger.js');
  const manager = getWebhookTriggerManager();
  await manager.load();
  return manager;
}

// ============================================================================
// GET /api/webhooks/triggers — List all triggers
// ============================================================================

router.get('/triggers', asyncHandler(async (_req: Request, res: Response) => {
  const manager = await getManager();
  const triggers = manager.listTriggers();
  res.json({ triggers, count: triggers.length });
}));

// ============================================================================
// POST /api/webhooks/triggers — Add a new trigger
// ============================================================================

router.post('/triggers', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body;

  // Validate required fields
  const requiredFields = ['name', 'source', 'events', 'action'];
  for (const field of requiredFields) {
    if (!body[field]) {
      res.status(400).json({ error: `Missing required field: ${field}` });
      return;
    }
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    res.status(400).json({ error: 'events must be a non-empty array of strings' });
    return;
  }

  const validSources = ['github', 'gitlab', 'slack', 'linear', 'pagerduty', 'generic'];
  if (!validSources.includes(body.source)) {
    res.status(400).json({ error: `Invalid source: ${body.source}. Must be one of: ${validSources.join(', ')}` });
    return;
  }

  const manager = await getManager();

  const config = {
    id: body.id || '',
    name: body.name,
    source: body.source,
    events: body.events,
    action: body.action,
    secret: body.secret,
    enabled: body.enabled !== false,
    filters: body.filters,
    createdAt: '',
    fireCount: 0,
  };

  manager.addTrigger(config);
  await manager.save();

  res.status(201).json({ trigger: config });
}));

// ============================================================================
// DELETE /api/webhooks/triggers/:id — Remove a trigger
// ============================================================================

router.delete('/triggers/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  if (!id) {
    res.status(400).json({ error: 'Trigger ID is required' });
    return;
  }

  const manager = await getManager();

  // Support prefix matching (like existing trigger commands)
  const triggers = manager.listTriggers();
  const match = triggers.find(t => t.id === id || t.id.startsWith(id));

  if (!match) {
    res.status(404).json({ error: `Trigger not found: ${id}` });
    return;
  }

  manager.removeTrigger(match.id);
  await manager.save();

  res.json({ removed: match.id });
}));

// ============================================================================
// POST /api/webhooks/test — Test a trigger with sample data
// ============================================================================

router.post('/test', asyncHandler(async (req: Request, res: Response) => {
  const { triggerId, source, sampleEvent } = req.body;

  if (!sampleEvent) {
    res.status(400).json({ error: 'sampleEvent is required in request body' });
    return;
  }

  const manager = await getManager();

  if (triggerId) {
    // Test a specific trigger
    const trigger = manager.getTrigger(triggerId);
    if (!trigger) {
      // Try prefix match
      const match = manager.listTriggers().find(t => t.id.startsWith(triggerId));
      if (!match) {
        res.status(404).json({ error: `Trigger not found: ${triggerId}` });
        return;
      }
    }
  }

  // Simulate receiving the webhook
  const headers: Record<string, string> = sampleEvent.headers || {};
  const body = sampleEvent.body || sampleEvent;
  const webhookSource = source || (triggerId ? manager.getTrigger(triggerId)?.source : 'generic') || 'generic';

  const result = await manager.handleWebhook(webhookSource, headers, body);

  res.json({
    testResult: result,
    note: 'This was a test invocation. No agent actions were dispatched.',
  });
}));

// ============================================================================
// POST /api/webhooks/:source — Receive a webhook
// Keep this parameterized route after every static POST endpoint.
// ============================================================================

router.post('/:source', asyncHandler(async (req: Request, res: Response) => {
  const source = String(req.params.source || '');
  if (!source) {
    res.status(400).json({ error: 'Source parameter is required' });
    return;
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value[0] || '';
    }
  }

  const manager = await getManager();
  const result = await manager.handleWebhook(source, headers, req.body);

  if (result.fired) {
    try {
      const { enqueueWebhookAgentRun } = await import('../webhook-agent-queue.js');
      const accepted = enqueueWebhookAgentRun({
        prompt: result.prompt || '',
        source,
        triggerId: result.triggerId,
        eventType: result.eventType,
      });
      logger.info(`Webhook from ${source} accepted as agent run ${accepted.runId}`);
      res.status(202).json({ status: 'accepted', runId: accepted.runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Webhook from ${source} could not be queued: ${message}`);
      throw ApiServerError.serviceUnavailable(`Webhook agent run was not queued: ${message}`);
    }
  } else if (result.error) {
    logger.warn(`Webhook from ${source} failed: ${result.error}`);
    res.status(400).json({
      status: 'error',
      error: result.error,
      eventType: result.eventType,
    });
  } else {
    // No matching trigger — acknowledge receipt
    res.status(200).json({
      status: 'no_match',
      eventType: result.eventType,
    });
  }
}));

// ============================================================================
// Export
// ============================================================================

export function createWebhookRoutes(): Router {
  return router;
}

export default router;
