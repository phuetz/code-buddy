/**
 * Cloud Task HTTP Routes
 *
 * REST API for submitting and managing background agent tasks.
 *
 * Routes:
 * - POST   /api/cloud/tasks          — Submit a new background task
 * - GET    /api/cloud/tasks          — List all tasks
 * - GET    /api/cloud/tasks/:id      — Get task status and result
 * - GET    /api/cloud/tasks/:id/stream — SSE stream of task progress
 * - POST   /api/cloud/tasks/:id/cancel — Cancel a running task
 * - DELETE /api/cloud/tasks/:id      — Delete a task record
 * - GET    /api/cloud/tasks/:id/logs — Get task execution logs
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/index.js';
import { logger } from '../../utils/logger.js';
import { assertSafeUrl } from '../../security/ssrf-guard.js';

// Helper to extract string param (Express params can be string | string[])
function getStringParam(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param[0] ?? '' : param || '';
}

export function createCloudTaskRoutes(): Router {
  const router = Router();

  // Lazy-load the cloud agent runner to avoid startup overhead
  async function getRunner() {
    const { getCloudAgentRunner } = await import('../../cloud/cloud-agent-runner.js');
    return getCloudAgentRunner();
  }

  /**
   * POST /api/cloud/tasks
   * Submit a new background agent task.
   */
  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { goal, model, maxToolRounds, contextFiles, environment, timeout, notifyOnComplete } = req.body;

      // Validate required fields
      if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
        res.status(400).json({ error: 'goal (non-empty string) is required' });
        return;
      }

      if (goal.length > 10000) {
        res.status(400).json({ error: 'goal must not exceed 10000 characters' });
        return;
      }

      // Validate optional fields
      if (model !== undefined && (typeof model !== 'string' || model.trim().length === 0)) {
        res.status(400).json({ error: 'model must be a non-empty string if provided' });
        return;
      }

      if (maxToolRounds !== undefined && (typeof maxToolRounds !== 'number' || maxToolRounds < 1 || maxToolRounds > 400)) {
        res.status(400).json({ error: 'maxToolRounds must be a number between 1 and 400' });
        return;
      }

      if (contextFiles !== undefined && !Array.isArray(contextFiles)) {
        res.status(400).json({ error: 'contextFiles must be an array of file paths' });
        return;
      }

      if (environment !== undefined && (typeof environment !== 'object' || Array.isArray(environment))) {
        res.status(400).json({ error: 'environment must be an object' });
        return;
      }

      if (timeout !== undefined && (typeof timeout !== 'number' || timeout < 1000 || timeout > 3600000)) {
        res.status(400).json({ error: 'timeout must be a number between 1000 and 3600000 (1s to 1h)' });
        return;
      }

      if (notifyOnComplete !== undefined && typeof notifyOnComplete !== 'string') {
        res.status(400).json({ error: 'notifyOnComplete must be a URL string' });
        return;
      }

      if (notifyOnComplete) {
        const check = await assertSafeUrl(notifyOnComplete);
        if (!check.safe) {
          res.status(400).json({ error: 'notifyOnComplete must be a public http(s) URL' });
          return;
        }
      }

      try {
        const runner = await getRunner();
        const taskId = await runner.submitTask({
          goal: goal.trim(),
          model,
          maxToolRounds,
          contextFiles,
          environment,
          timeout,
          notifyOnComplete,
        });

        const task = await runner.getTaskStatus(taskId);

        res.status(202).json({
          id: taskId,
          status: task.status,
          goal: task.goal,
          startedAt: task.startedAt.toISOString(),
          message: 'Task submitted successfully. Poll GET /api/cloud/tasks/:id for status.',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to submit cloud task', { error: msg });
        res.status(429).json({ error: msg });
      }
    }),
  );

  /**
   * GET /api/cloud/tasks
   * List all tasks.
   */
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
      const statusFilter = req.query.status as string | undefined;

      const runner = await getRunner();
      let tasks = await runner.listTasks(limit);

      // Apply status filter
      if (statusFilter && ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(statusFilter)) {
        tasks = tasks.filter((t) => t.status === statusFilter);
      }

      res.json({
        tasks: tasks.map((t) => ({
          id: t.id,
          status: t.status,
          goal: t.goal.length > 200 ? t.goal.slice(0, 200) + '...' : t.goal,
          model: t.model,
          startedAt: t.startedAt.toISOString(),
          completedAt: t.completedAt?.toISOString(),
          tokensUsed: t.tokensUsed,
          cost: t.cost,
          toolCalls: t.toolCalls,
          filesChanged: t.filesChanged?.length ?? 0,
        })),
        total: tasks.length,
      });
    }),
  );

  /**
   * GET /api/cloud/tasks/:id
   * Get task status and result.
   */
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const taskId = getStringParam(req.params.id);

      try {
        const runner = await getRunner();
        const task = await runner.getTaskStatus(taskId);

        res.json({
          id: task.id,
          status: task.status,
          goal: task.goal,
          model: task.model,
          startedAt: task.startedAt.toISOString(),
          completedAt: task.completedAt?.toISOString(),
          result: task.result,
          error: task.error,
          filesChanged: task.filesChanged,
          tokensUsed: task.tokensUsed,
          cost: task.cost,
          toolCalls: task.toolCalls,
          runId: task.runId,
        });
      } catch (err) {
        res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

  /**
   * GET /api/cloud/tasks/:id/stream
   * SSE stream of task progress events.
   */
  router.get(
    '/:id/stream',
    asyncHandler(async (req: Request, res: Response) => {
      const taskId = getStringParam(req.params.id);

      let runner;
      try {
        runner = await getRunner();
        await runner.getTaskStatus(taskId); // Validate task exists
      } catch (err) {
        res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let eventIndex = 0;
      let closed = false;

      // Send existing events
      const existing = runner.getProgressEvents(taskId);
      for (const event of existing) {
        if (closed) return;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        eventIndex++;
      }

      // Listen for new events
      const onProgress = (event: { taskId: string }) => {
        if (closed || event.taskId !== taskId) return;

        const newEvents = runner.getProgressEvents(taskId, eventIndex);
        for (const evt of newEvents) {
          if (closed) return;
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
          eventIndex++;

          // Close stream when task completes
          if (evt.type === 'completed') {
            res.write('data: [DONE]\n\n');
            res.end();
            closed = true;
          }
        }
      };

      runner.on('progress', onProgress);

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        res.write(': heartbeat\n\n');
      }, 15000);

      // Cleanup on client disconnect
      req.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
        runner.removeListener('progress', onProgress);
      });
    }),
  );

  /**
   * POST /api/cloud/tasks/:id/cancel
   * Cancel a running task.
   */
  router.post(
    '/:id/cancel',
    asyncHandler(async (req: Request, res: Response) => {
      const taskId = getStringParam(req.params.id);

      try {
        const runner = await getRunner();
        const cancelled = await runner.cancelTask(taskId);

        if (cancelled) {
          res.json({ success: true, message: `Task ${taskId} cancelled` });
        } else {
          res.status(409).json({ error: 'Task is not in a cancellable state' });
        }
      } catch (err) {
        res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

  /**
   * DELETE /api/cloud/tasks/:id
   * Delete a task record.
   */
  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const taskId = getStringParam(req.params.id);

      try {
        const runner = await getRunner();
        await runner.deleteTask(taskId);
        res.status(204).send();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes('not found') ? 404 : 409;
        res.status(status).json({ error: msg });
      }
    }),
  );

  /**
   * GET /api/cloud/tasks/:id/logs
   * Get task execution logs.
   */
  router.get(
    '/:id/logs',
    asyncHandler(async (req: Request, res: Response) => {
      const taskId = getStringParam(req.params.id);

      try {
        const runner = await getRunner();
        const logs = runner.getTaskLogs(taskId);

        const format = req.query.format as string | undefined;
        if (format === 'text') {
          res.setHeader('Content-Type', 'text/plain');
          res.send(logs);
        } else {
          res.json({ taskId, logs });
        }
      } catch (err) {
        res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

  return router;
}
