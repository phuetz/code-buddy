import express, { Router, type Request, type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { A2AJsonRpcAdapter, rpcError } from '../../protocols/a2a/jsonrpc-v1.js';
import { authenticateA2APeer, readA2APeers, validateA2AUrl, type A2APeers } from '../../protocols/a2a/peer-config.js';
import { createCodeBuddyTaskExecutor } from '../../protocols/a2a/codebuddy-executor.js';
import type { TaskExecutor } from '../../protocols/a2a/index.js';
import { buildCodeBuddyAgentCard } from './a2a-protocol.js';
import { initializeToolRegistry } from '../../codebuddy/tools.js';
import { getPeerMethodHandler } from '../websocket/peer-method-registry.js';
import { createRouteRateLimiter } from '../middleware/rate-limit.js';

export function createA2AJsonRpcRoutes(options: { publicUrl: string; peers?: A2APeers; executor?: TaskExecutor; timeoutMs?: number }): Router {
  const peers = options.peers ?? readA2APeers();
  const url = validateA2AUrl(options.publicUrl).href;
  const router = Router();
  const identities = new WeakMap<Request, string>();
  const allowedTools = ['view_file', 'list_directory', 'search'];
  const executor = options.executor ?? createCodeBuddyTaskExecutor({ allowedTools, executeTool: async (name, args, task) => {
    const invoke = getPeerMethodHandler('peer.tool.invoke');
    if (!invoke) return { success: false, error: 'Read-only peer bridge unavailable' };
    // Reuse all three existing gates: operator allowlist, fleetSafe, real workspace containment.
    const result: unknown = await invoke({ tool: name, args }, { connectionId: `a2a:${task.metadata?.peerId ?? 'unknown'}`,
      scopes: ['peer:invoke'], traceId: randomUUID(), depth: 0 });
    if (!result || typeof result !== 'object' || typeof (result as { output?: unknown }).output !== 'string' || (result as { error?: unknown }).error || (result as { success?: unknown }).success === false) {
      return { success: false, error: 'Read-only peer bridge returned an invalid or failed result' };
    }
    return { success: true, output: (result as { output: string }).output };
  } });
  if (!options.executor) initializeToolRegistry();
  const adapter = new A2AJsonRpcAdapter(executor, options.timeoutMs, Object.keys(peers).length);
  const localCard = buildCodeBuddyAgentCard();
  const card = { name: localCard.name, description: 'Code Buddy read-only A2A text subset; filesystem access requires configured peer workspace and permissions.',
    version: localCard.version, supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    skills: localCard.skills.filter(skill => ['code-search', 'code-read'].includes(skill.id)),
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, security: [{ bearer: [] }] };
  router.get(['/.well-known/agent-card.json', '/.well-known/agent.json'], (_req, res) => res.json(card));
  router.post('/a2a/v1', (req, res, next) => {
    const peer = authenticateA2APeer(peers, req.headers.authorization);
    if (!peer) { res.status(401).json({ error: 'A2A peer authentication required' }); return; }
    identities.set(req, peer); next();
  }, createRouteRateLimiter({ windowMs: 60000, maxRequests: 10, keyPrefix: 'a2a-jsonrpc-v1', keyGenerator: req => identities.get(req) ?? 'unauthorized' }),
  express.json({ limit: '1mb' }), async (req, res, next) => {
    try {
      const version = req.headers['a2a-version'];
      if (Array.isArray(version)) { res.json(rpcError(req.body?.id, -32602, 'Invalid A2A-Version')); return; }
      res.json(await adapter.handle(identities.get(req)!, req.body, version));
    } catch (error) { next(error); }
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const tooLarge = error?.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json(rpcError(null, tooLarge ? -32600 : -32700, tooLarge ? 'Body exceeds 1 MiB' : 'Invalid A2A request'));
  };
  router.use(errors);
  return router;
}
