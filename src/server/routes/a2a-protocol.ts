/**
 * A2A Protocol Routes
 *
 * Google Agent-to-Agent protocol endpoints:
 * - GET  /api/a2a/.well-known/agent.json — Agent card discovery
 * - GET  /api/a2a/agents — List registered agents
 * - POST /api/a2a/tasks/send — Submit a task to an agent
 * - GET  /api/a2a/tasks/:id — Get task status
 * - POST /api/a2a/tasks/:id/cancel — Cancel a task
 */

import { Router } from 'express';
import { asyncHandler, requireScope } from '../middleware/index.js';
import {
  A2AAgentClient,
  createAgentCard,
  getTaskResult,
} from '../../protocols/a2a/index.js';

export function createA2AProtocolRoutes(): Router {
  const router = Router();
  const client = new A2AAgentClient();

  // Agent card discovery (well-known endpoint per A2A spec)
  router.get('/.well-known/agent.json', (_req, res) => {
    const hostCard = createAgentCard({
      name: 'Code Buddy',
      description: 'Multi-provider AI coding agent with specialized sub-agents',
      skills: [
        { id: 'code-edit', name: 'Code Editing', description: 'Edit and refactor code', inputModes: ['text/plain'], outputModes: ['text/plain'] },
        { id: 'code-debug', name: 'Debugging', description: 'Find and fix bugs', inputModes: ['text/plain'], outputModes: ['text/plain'] },
        { id: 'code-review', name: 'Code Review', description: 'Analyze code quality', inputModes: ['text/plain'], outputModes: ['text/plain'] },
        { id: 'planning', name: 'Planning', description: 'Create and execute multi-step plans', inputModes: ['text/plain'], outputModes: ['text/plain'] },
      ],
    });
    res.json(hostCard);
  });

  // List registered agents
  router.get('/agents', requireScope('admin'), (_req, res) => {
    const agents = client.listAgents();
    const cards = agents.map((name) => ({
      name,
      card: client.getAgentCard(name),
    }));
    res.json({ agents: cards });
  });

  // Submit a task
  router.post('/tasks/send', requireScope('admin'), asyncHandler(async (req, res) => {
    const { agent: agentName, message } = req.body;

    if (!agentName || !message) {
      res.status(400).json({ error: 'Missing required fields: agent, message' });
      return;
    }

    try {
      const task = await client.submitTask(agentName, message);
      res.json({
        id: task.id,
        status: task.status,
        result: getTaskResult(task),
        artifacts: task.artifacts,
      });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }));

  // Get task status
  router.get('/tasks/:id', requireScope('admin'), (req, res) => {
    // Search across all registered agents for the task
    for (const agentName of client.listAgents()) {
      const server = (client as any).agents?.get(agentName);
      if (server && typeof server.getTask === 'function') {
        const task = server.getTask(req.params.id);
        if (task) {
          res.json({
            id: task.id,
            status: task.status,
            result: getTaskResult(task),
            artifacts: task.artifacts,
            history: task.history,
          });
          return;
        }
      }
    }
    res.status(404).json({ error: 'Task not found' });
  });

  // Cancel a task
  router.post('/tasks/:id/cancel', requireScope('admin'), (req, res) => {
    for (const agentName of client.listAgents()) {
      const server = (client as any).agents?.get(agentName);
      if (server && typeof server.cancelTask === 'function') {
        const cancelled = server.cancelTask(req.params.id);
        if (cancelled) {
          res.json({ cancelled: true, id: req.params.id });
          return;
        }
      }
    }
    res.status(404).json({ error: 'Task not found or already completed' });
  });

  // Find agents by skill
  router.get('/agents/by-skill/:skillId', requireScope('admin'), (req, res) => {
    const skillId = String(req.params.skillId);
    const agents = client.findAgentsWithSkill(skillId);
    res.json({ skill: skillId, agents });
  });

  // Expose the client for external registration
  (router as any).a2aClient = client;

  return router;
}
