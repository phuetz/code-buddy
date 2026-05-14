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
import { createRouteRateLimiter } from '../middleware/rate-limit.js';
import {
  A2AAgentClient,
  A2AAgentServer,
  type AgentCard,
  createAgentCard,
  getTaskResult,
} from '../../protocols/a2a/index.js';
import { createCodeBuddyTaskExecutor } from '../../protocols/a2a/codebuddy-executor.js';
import { initializeToolRegistry } from '../../codebuddy/tools.js';

/**
 * Code Buddy's local AgentCard. The skills declared here are the ONLY
 * capabilities a remote peer can invoke against this instance via
 * /tasks/send. They must stay in lockstep with the fleet-safe tool list
 * (see `src/tools/metadata.ts:fleetSafe`) — declaring `code-edit` here
 * while the executor only exposes read tools would be a dishonest card.
 *
 * Mutating skills (write/exec) intentionally NOT exposed in V1; they
 * require an upgraded scope + per-peer quota that lives in the V2 backlog.
 */
function buildCodeBuddyAgentCard(): AgentCard {
  return createAgentCard({
    name: 'Code Buddy',
    description:
      'Multi-provider AI coding agent. A2A inbound surface is read-only: search, view, web fetch, codebase analysis, reasoning. Mutating skills (edit/exec) require an upgraded scope and are not exposed by default.',
    skills: [
      {
        id: 'code-search',
        name: 'Code search',
        description: 'grep + symbol/reference lookup across the codebase',
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
      {
        id: 'code-read',
        name: 'Code read',
        description: 'view files and list directories',
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
      {
        id: 'codebase-analysis',
        name: 'Codebase analysis',
        description: 'graph + map + impact + bug-finder (static analysis only)',
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
      {
        id: 'web-query',
        name: 'Web query',
        description: 'web_search + web_fetch + firecrawl scraping',
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
      {
        id: 'reasoning',
        name: 'Reasoning',
        description: 'Tree-of-thought analysis on a problem (no host effects)',
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  });
}

function getAgentServer(client: A2AAgentClient, name: string): A2AAgentServer | undefined {
  return (client as unknown as { agents: Map<string, A2AAgentServer> }).agents?.get(name);
}

/**
 * Normalise the inbound `message` field of POST /tasks/send into a plain string.
 * Accepts either a raw string or an A2A Message object `{role, parts: [{type:'text', text}]}`,
 * which is what cross-host callers send. submitTask() expects a string and embeds it
 * verbatim into a Message; passing an object would nest it as `text: <object>` and
 * the downstream spoke would forward garbage to its model backend.
 */
function extractMessageText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object') {
    const parts = (message as { parts?: unknown }).parts;
    if (Array.isArray(parts)) {
      const texts = parts
        .filter((p): p is { type: string; text: string } =>
          !!p && typeof p === 'object' &&
          (p as { type?: unknown }).type === 'text' &&
          typeof (p as { text?: unknown }).text === 'string')
        .map((p) => p.text);
      if (texts.length > 0) return texts.join('\n');
    }
  }
  return JSON.stringify(message);
}

function extractMetadata(metadata: unknown): Record<string, string> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!key) continue;
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = String(value);
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

interface A2ARouter extends Router { a2aClient?: A2AAgentClient; }

export function createA2AProtocolRoutes(): Router {
  const router = Router();
  const client = new A2AAgentClient();

  // Ensure the legacy ToolRegistry is populated before the inbound
  // executor needs it. initializeToolRegistry() is idempotent — safe to
  // call multiple times. Without this, getFleetSafeTools() returns []
  // when a peer hits /tasks/send before any local code path has touched
  // the registry.
  try {
    initializeToolRegistry();
  } catch {
    // Best-effort: tool registration failures shouldn't prevent the
    // route from booting. The executor checks for empty tool lists and
    // fails the task explicitly.
  }

  // Register Code Buddy itself as a local A2A agent so /tasks/send has
  // a target. Without this, the agents Map stays empty and every
  // submitTask resolves to a "not found" error.
  const codebuddyCard = buildCodeBuddyAgentCard();
  const codebuddyServer = new A2AAgentServer(codebuddyCard, createCodeBuddyTaskExecutor());
  client.registerAgent('codebuddy', codebuddyServer);

  // Agent card discovery (well-known endpoint per A2A spec). Returns the
  // same card the inbound executor honors — keeps discovery and
  // execution in lockstep.
  router.get('/.well-known/agent.json', (_req, res) => {
    res.json(buildCodeBuddyAgentCard());
  });

  // Rate limit /tasks/send to protect the LLM provider quota and prevent
  // a hostile peer from flooding. 10 req/min per auth subject is a
  // conservative V1 default — tunable via env once we have telemetry.
  const tasksSendLimiter = createRouteRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
  });

  // List registered agents (local in-process + remote cross-host)
  router.get('/agents', requireScope('admin'), (_req, res) => {
    const agents = client.listAgents();
    const cards = agents.map((name) => ({
      name,
      card: client.getAgentCard(name),
    }));
    const remotes = client.listRemoteAgents().map((r) => ({
      name: r.name,
      url: r.url,
      card: r.card,
      lastHeartbeat: r.lastHeartbeat,
    }));
    res.json({ agents: cards, remoteAgents: remotes });
  });

  // Submit a task. Body accepts EITHER {agent} (Niveau 2 explicit routing)
  // OR {skill} (Niveau 3 auto-routing — hub finds matching spoke and delegates).
  // Both `message` is required regardless of routing mode.
  router.post('/tasks/send', tasksSendLimiter, requireScope('admin'), asyncHandler(async (req, res) => {
    const { agent: agentName, skill: skillId, message, metadata } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Missing required field: message' });
      return;
    }

    const resolved = client.resolveTarget({ agent: agentName, skill: skillId });
    if ('error' in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    try {
      const messageText = extractMessageText(message);
      const task = await client.submitTask(resolved.agentKey, messageText, extractMetadata(metadata));
      res.json({
        id: task.id,
        status: task.status,
        result: getTaskResult(task),
        artifacts: task.artifacts,
        routedTo: resolved.agentKey,
      });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }));

  // Get task status
  router.get('/tasks/:id', requireScope('admin'), (req, res) => {
    // Search across all registered agents for the task
    for (const agentName of client.listAgents()) {
      const server = getAgentServer(client, agentName);
      if (server && typeof server.getTask === 'function') {
        const task = server.getTask(String(req.params.id));
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
      const server = getAgentServer(client, agentName);
      if (server && typeof server.cancelTask === 'function') {
        const cancelled = server.cancelTask(String(req.params.id));
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

  // ── Fleet endpoints (V0.3 — register/heartbeat for cross-host spokes) ──
  //
  // Auth: scope 'read' (lower than 'admin') so any tailnet client can register.
  // Mesh privé Tailscale = sécurité de base ; ouvrir 'admin' uniquement aux
  // opérations destructives (tasks/send arbitraire).

  // Register a remote agent's card (called by spoke at boot)
  // Body : { name: string, url: string, card: AgentCard }
  router.post('/agents/register', requireScope('read'), (req, res) => {
    const { name, url, card } = req.body || {};
    if (!name || typeof name !== 'string' ||
        !url || typeof url !== 'string' ||
        !card || typeof card !== 'object' ||
        !Array.isArray(card.skills)) {
      res.status(400).json({
        error: 'Missing or invalid fields. Required: name (string), url (string), card.skills (array)',
      });
      return;
    }
    client.registerRemoteCard(String(name), {
      url: String(url),
      card: card as AgentCard,
      lastHeartbeat: Date.now(),
    });
    res.json({ status: 'registered', agent: name, url });
  });

  // Heartbeat — called periodically by spoke to maintain liveness
  router.post('/agents/:name/heartbeat', requireScope('read'), (req, res) => {
    const ok = client.touchRemoteAgent(String(req.params.name));
    if (!ok) {
      res.status(404).json({ error: 'agent not registered' });
      return;
    }
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Unregister — called by spoke on graceful shutdown
  router.delete('/agents/:name', requireScope('read'), (req, res) => {
    const ok = client.unregisterRemoteAgent(String(req.params.name));
    if (!ok) {
      res.status(404).json({ error: 'agent not registered' });
      return;
    }
    res.json({ status: 'unregistered', agent: req.params.name });
  });

  // Expose the client for external registration
  (router as A2ARouter).a2aClient = client;

  return router;
}
