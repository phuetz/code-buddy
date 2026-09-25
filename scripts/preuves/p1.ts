/** Real, local proof probes. Run only through p1.sh with an isolated HOME. */
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = process.env.P1_WORK;
if (!root) throw new Error('P1_WORK is required');
fs.mkdirSync(root, { recursive: true });
let failedAssertions = 0;

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function assertObserved(label: string, passed: boolean): void {
  process.stdout.write(`ASSERTION ${label}: ${passed ? 'OK' : 'ÉCHEC'}\n`);
  if (!passed) failedAssertions += 1;
}

async function toolsProbe(): Promise<void> {
  const { getAllCodeBuddyTools } = await import('../../src/codebuddy/tools.js');
  const tools = await getAllCodeBuddyTools();
  const names = tools.map((tool) => tool.function.name);
  report({ total: names.length, unique: new Set(names).size, sample: names.slice(0, 12) });
  assertObserved('230 outils uniques exposés', new Set(names).size === 230);
}

async function providersProbe(): Promise<void> {
  const { getDirectRuntimeProviderCatalog } = await import('../../src/providers/provider-catalog.js');
  const catalog = getDirectRuntimeProviderCatalog();
  report({ directProviderCount: catalog.length, ids: catalog.map((provider) => provider.id) });
  assertObserved('Ollama présent dans le catalogue', catalog.some((provider) => provider.id === 'ollama'));
}

async function ragProbe(): Promise<void> {
  const { ToolSelectionStrategy } = await import('../../src/agent/execution/tool-selection-strategy.js');
  const strategy = new ToolSelectionStrategy({ maxTools: 12, modelName: 'qwen3:4b-instruct' });
  const query = 'Read the contents of a file in this workspace';
  const first = await strategy.selectToolsForQuery(query);
  const second = await strategy.selectToolsForQuery(query);
  report({ count: first.tools.length, selected: first.tools.map((tool) => tool.function.name), fromCacheFirst: first.fromCache, fromCacheSecond: second.fromCache, originalTokens: first.selection?.originalTokens, reducedTokens: first.selection?.reducedTokens });
  assertObserved('sélection réduit les tokens et conserve view_file', (first.selection?.originalTokens ?? 0) > (first.selection?.reducedTokens ?? 0) && first.tools.some((tool) => tool.function.name === 'view_file'));
}

async function contextProbe(): Promise<void> {
  const { ContextManagerV2 } = await import('../../src/context/context-manager-v2.js');
  const { SegmentArchive } = await import('../../src/context/segment-archive.js');
  const { ContextExpandTool } = await import('../../src/tools/context-expand-tool.js');
  const archive = new SegmentArchive(root);
  const manager = new ContextManagerV2({ maxContextTokens: 1200, responseReserveTokens: 150, recentMessagesCount: 2, enableEnhancedCompression: true, model: 'qwen3:4b-instruct' }, archive);
  const messages = [
    { role: 'system', content: 'Règles de conversation.' },
    ...Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Tour ${index}: ${'indice turquoise et vérifiable '.repeat(18)} unique-${index}` })),
  ];
  const before = manager.getStats(messages);
  manager.requestManualCompaction();
  const compacted = manager.prepareMessagesRaw(messages);
  const after = manager.getStats(compacted);
  const reversibleManager = new ContextManagerV2({ maxContextTokens: 1200, responseReserveTokens: 150, recentMessagesCount: 2, enableEnhancedCompression: false, model: 'qwen3:4b-instruct' }, archive);
  reversibleManager.requestManualCompaction();
  const reversible = reversibleManager.prepareMessagesRaw(messages);
  const segments = archive.list(reversibleManager.getSessionId());
  const exactSegment = segments.find((segment) => JSON.stringify(segment.messages).includes('unique-0'));
  const expanded = exactSegment ? await new ContextExpandTool({ archive }).execute({ segment_id: exactSegment.segmentId }, { sessionId: reversibleManager.getSessionId() } as never) : null;
  report({ messagesBefore: messages.length, messagesAfter: compacted.length, tokensBefore: before.totalTokens, tokensAfter: after.totalTokens, reversibleMessages: reversible.length, segmentMarker: reversible.some((message) => typeof message.content === 'string' && message.content.includes('[segment:')), segments: segments.length, expandSuccess: expanded?.success, exactRestored: typeof expanded?.output === 'string' && expanded.output.includes('unique-0'), expandChars: typeof expanded?.output === 'string' ? expanded.output.length : 0, error: expanded?.error });
  assertObserved('compression et restauration exacte', after.totalTokens < before.totalTokens && segments.length > 0 && expanded?.success === true && typeof expanded.output === 'string' && expanded.output.includes('unique-0'));
}

async function episodeProbe(): Promise<void> {
  const { runEpisodeConsolidation } = await import('../../src/sensory/episodic-journal.js');
  const cwd = path.join(root, 'episode');
  fs.mkdirSync(cwd, { recursive: true });
  process.chdir(cwd);
  const result = await runEpisodeConsolidation({ cwd, readConversation: async () => [
    { role: 'user', content: 'Demain, prendre le train bleu.' },
    { role: 'assistant', content: 'Je vais retenir le train bleu pour demain.' },
    { role: 'user', content: 'On en reparle plus tard ?' },
  ] });
  const journal = path.join(cwd, '.codebuddy', 'companion', 'episodes.jsonl');
  const journalLines = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').length : 0;
  const memoryFile = path.join(cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md');
  const promoted = fs.existsSync(memoryFile) && fs.readFileSync(memoryFile, 'utf8').includes('episode:recent');
  report({ count: result?.count, topics: result?.topics.length, openLoops: result?.openLoops?.length, journalLines, promoted, line: result?.line });
  assertObserved('épisode journalisé et promu', result?.count === 3 && journalLines === 1 && promoted);
}

async function forgettingProbe(): Promise<void> {
  const { PersistentMemoryManager } = await import('../../src/memory/persistent-memory.js');
  const manager = new PersistentMemoryManager({ projectMemoryPath: path.join(root, 'forget', 'project.md'), userMemoryPath: path.join(root, 'forget', 'user.md') });
  await manager.initialize();
  const stored = await manager.remember('demo-temporary', 'Le phare est turquoise', { scope: 'project', category: 'context' });
  const future = new Date(Date.now() + 90 * 86_400_000);
  const forgotten = await manager.applyForgetting('project', { now: future });
  const archived = await manager.listArchived('project');
  const restored = await manager.restoreFromArchive('demo-temporary', 'project');
  report({ stored: stored.status, forgotten: forgotten.forgotten.length, retention: forgotten.forgotten[0]?.retention, archived: archived.length, restored: restored?.result.status });
  assertObserved('oubli archivé puis restauré', stored.status === 'stored' && forgotten.forgotten.length === 1 && archived.length === 1 && restored?.result.status === 'stored');
}

async function permissionsProbe(): Promise<void> {
  const { PermissionModeManager } = await import('../../src/security/permission-modes.js');
  const manager = new PermissionModeManager();
  const decisions: Record<string, unknown> = {};
  for (const mode of ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const) {
    manager.setMode(mode);
    decisions[mode] = Object.fromEntries(['view_file', 'create_file', 'bash'].map((tool) => {
      const decision = manager.checkPermission('echo preuve', tool);
      return [tool, { allowed: decision.allowed, prompted: decision.prompted }];
    }));
  }
  report({ modes: Object.keys(decisions).length, decisions });
  const plan = decisions.plan as Record<string, { allowed: boolean }>;
  assertObserved('cinq modes et écriture refusée en plan', Object.keys(decisions).length === 5 && plan.create_file.allowed === false && plan.view_file.allowed === true);
}

async function sandboxProbe(): Promise<void> {
  const { confineSpawn, detectNativeSandboxCapabilities } = await import('../../src/security/native-sandbox.js');
  process.env.CODEBUDDY_NATIVE_SANDBOX = 'auto';
  const capabilities = detectNativeSandboxCapabilities();
  const parentEscape = path.join(root, 'outside-probe.txt');
  const project = path.join(root, 'sandbox-project');
  fs.mkdirSync(project, { recursive: true });
  const inside = path.join(project, 'inside-probe.txt');
  const wrapped = confineSpawn({ file: '/bin/sh', args: ['-c', 'printf dedans > "$1"; printf dehors > "$2"', 'sh', inside, parentEscape], cwd: project, projectRoot: project, env: process.env, network: false });
  if (!wrapped.ok) {
    report({ recommended: capabilities.recommended, wrapped });
    assertObserved('confinement noyau opérationnel', false);
    return;
  }
  const executed = spawnSync(wrapped.file, wrapped.args, { cwd: project, env: wrapped.env, encoding: 'utf8', timeout: 10000 });
  report({ recommended: capabilities.recommended, backend: wrapped.backend, exitCode: executed.status, stderr: executed.stderr.trim(), insideExists: fs.existsSync(inside), outsideExists: fs.existsSync(parentEscape) });
  assertObserved('écriture interne admise et échappée refusée', wrapped.backend !== 'none' && fs.existsSync(inside) && !fs.existsSync(parentEscape));
}

async function fallbackProbe(): Promise<void> {
  const probeServer = createServer();
  await new Promise<void>((resolve) => probeServer.listen(0, '127.0.0.1', resolve));
  const deadPort = (probeServer.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probeServer.close(() => resolve()));
  process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
  process.env.CODEBUDDY_FALLBACK_CHAIN = 'ollama:qwen3:4b-instruct@http://127.0.0.1:11434';
  const { CodeBuddyClient } = await import('../../src/codebuddy/client.js');
  const { getGlobalEventBus } = await import('../../src/events/event-bus.js');
  const events: unknown[] = [];
  getGlobalEventBus().on('provider:fallback', (event) => events.push(event));
  const client = new CodeBuddyClient('jeton-factice', 'gpt-4o', `http://127.0.0.1:${deadPort}/v1`, { enableCredentialPool: false });
  const response = await client.chat([{ role: 'user', content: 'Réponds avec un seul mot : indigo.' }], []);
  report({ deadPort, answer: response.choices[0]?.message.content, actualModel: response.model, fallbackEvents: events });
  assertObserved('bascule du port fermé vers Ollama', response.model === 'qwen3:4b-instruct' && events.length > 0);
}

async function subagentsProbe(): Promise<void> {
  process.chdir(root);
  process.env.CODEBUDDY_HEADLESS = 'true';
  process.env.CODEBUDDY_PROMPT_COMPACT = 'true';
  process.env.CODEBUDDY_MAX_CONTEXT = '8192';
  process.env.CODEBUDDY_MAX_TOKENS = '128';
  process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY = 'true';
  const { handleTeam } = await import('../../src/commands/handlers/team-handlers.js');
  const { createDefaultBatchSpawnFn, executeBatchPlan } = await import('../../src/commands/handlers/batch-handlers.js');
  const teamStarted = await handleTeam(['start', 'Vérifier deux indices locaux']);
  const member = await handleTeam(['add', 'researcher', 'lecteur']);
  const teamStatus = await handleTeam(['status']);
  const teamStopped = await handleTeam(['stop']);
  fs.writeFileSync(path.join(root, 'indice-a.txt'), 'A = indigo\n');
  fs.writeFileSync(path.join(root, 'indice-b.txt'), 'B = turquoise\n');
  const events: string[] = [];
  const spawn = createDefaultBatchSpawnFn({
    cwd: root,
    apiKey: 'ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:4b-instruct',
    maxToolRounds: 3,
    concurrency: 2,
    eventSink: (event) => events.push(`${event.agentId}:${event.kind}`),
  });
  const results = await executeBatchPlan({
    goal: 'Lire deux fichiers indépendants',
    units: [
      { label: 'indice-a', instruction: 'Utilise view_file pour lire indice-a.txt et donne la couleur exacte.', verifyOnly: true },
      { label: 'indice-b', instruction: 'Utilise view_file pour lire indice-b.txt et donne la couleur exacte.', verifyOnly: true },
    ],
  }, spawn);
  report({ teamStarted: teamStarted.entry?.content, member: member.entry?.content, teamStatus: teamStatus.entry?.content, teamStopped: teamStopped.entry?.content, batch: results, eventCount: events.length, eventSample: events.slice(0, 12) });
  assertObserved('équipe sans tâche déléguée et deux unités batch terminées', results.length === 2 && results.every((result) => result.success) && events.length > 0 && teamStatus.entry?.content.includes('TEAM MEMBERS (1)') === true && teamStopped.entry?.content.includes('0/0 tasks completed') === true);
}

async function swarmProbe(): Promise<void> {
  process.chdir(root);
  process.env.CODEBUDDY_HEADLESS = 'true';
  process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY = 'true';
  process.env.CODEBUDDY_SWARM_CONCURRENCY = '2';
  process.env.CODEBUDDY_SWARM_MAX_TURNS = '4';
  process.env.CODEBUDDY_SWARM_MAX_COST_USD = '1';
  const { handleSwarm } = await import('../../src/commands/handlers/swarm-handler.js');
  const result = await handleSwarm(['Lis', 'indice.txt', 'et', 'rapporte', 'sa', 'couleur.']);
  report({ content: result.entry?.content, failed: result.failed });
  assertObserved('essaim terminé avec succès', result.entry?.content.includes('Success: yes') === true);
}

async function fleetProbe(): Promise<void> {
  const { startServer, stopServer } = await import('../../src/server/index.js');
  const { createApiKey } = await import('../../src/server/auth/api-keys.js');
  const { FleetListener } = await import('../../src/fleet/fleet-listener.js');
  process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = root;
  process.env.CODEBUDDY_PEER_PROVIDER = 'ollama';
  process.env.CODEBUDDY_PEER_MODEL = 'qwen3:4b-instruct';
  process.env.CODEBUDDY_CKG_SYNC = 'true';
  fs.writeFileSync(path.join(root, 'fleet-indice.txt'), 'preuve-fleet-turquoise\n');
  const { CollectiveKnowledgeGraph, getCollectiveKnowledgeGraph } = await import('../../src/memory/collective-knowledge-graph.js');
  getCollectiveKnowledgeGraph().remember({ type: 'fact', name: 'phare-federe', text: 'Le phare fédéré est turquoise.', agentId: 'source' });
  const { key } = createApiKey({ name: 'preuve-locale', userId: 'preuve', scopes: ['fleet:listen', 'peer:invoke'] });
  const started = await startServer({ port: 0, host: '127.0.0.1', authEnabled: true, websocketEnabled: true, rateLimit: false, logging: false, docsEnabled: false });
  const port = (started.server.address() as AddressInfo).port;
  const listener = new FleetListener({ url: `ws://127.0.0.1:${port}/ws`, apiKey: key, connectTimeoutMs: 10000, authTimeoutMs: 10000 });
  try {
    await listener.connect();
    const chat = await listener.request('peer.chat', { prompt: 'Réponds uniquement: turbine' });
    const tool = await listener.request('peer.tool.invoke', { tool: 'view_file', args: { file_path: 'fleet-indice.txt' } });
    const denied: Record<string, string> = {};
    for (const [label, request] of Object.entries({
      allowlist: { tool: 'bash', args: { command: 'echo interdit' } },
      workspace: { tool: 'view_file', args: { file_path: '../hors-zone.txt' } },
    })) {
      try {
        await listener.request('peer.tool.invoke', request);
        denied[label] = 'ACCEPTED';
      } catch (error) {
        denied[label] = error instanceof Error ? error.message : String(error);
      }
    }
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file,remember';
    try {
      await listener.request('peer.tool.invoke', { tool: 'remember', args: { key: 'interdit', value: 'interdit' } });
      denied.fleetSafe = 'ACCEPTED';
    } catch (error) {
      denied.fleetSafe = error instanceof Error ? error.message : String(error);
    } finally {
      delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
    }
    const target = new CollectiveKnowledgeGraph({ ledgerPath: path.join(root, 'ckg-destination.jsonl'), agentId: 'destination' });
    const { pullFromPeer } = await import('../../src/fleet/peer-ckg-bridge.js');
    const federation = await pullFromPeer('source-locale', { ckg: target, statePath: path.join(root, 'ckg-cursor.json'), request: (method, params) => listener.request(method, params) });
    report({ port, chat, tool, denied, federation: { fetched: federation.fetched, ingested: federation.ingested, skipped: federation.skipped } });
    assertObserved('flotte, trois barrières et fédération', (chat as { providerResolved?: string }).providerResolved === 'ollama' && (tool as { output?: string }).output?.includes('preuve-fleet-turquoise') === true && (denied.allowlist ?? '').includes('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE') && (denied.fleetSafe ?? '').includes('TOOL_NOT_FLEET_SAFE') && (denied.workspace ?? '').includes('PATH_OUTSIDE_PEER_WORKSPACE') && federation.ingested === 1);
  } finally {
    await listener.disconnect().catch(() => undefined);
    await stopServer(started.server);
  }
}

const probes: Record<string, () => Promise<void>> = {
  tools: toolsProbe,
  providers: providersProbe,
  rag: ragProbe,
  context: contextProbe,
  episode: episodeProbe,
  forgetting: forgettingProbe,
  permissions: permissionsProbe,
  sandbox: sandboxProbe,
  fallback: fallbackProbe,
  subagents: subagentsProbe,
  swarm: swarmProbe,
  fleet: fleetProbe,
};
const selected = process.argv[2];
if (!selected || !probes[selected]) throw new Error(`Unknown probe: ${selected}`);
const startedAt = Date.now();
await probes[selected]();
report({ probe: selected, durationMs: Date.now() - startedAt });
// Several product singletons keep unrefed telemetry handles alive. The probe
// has awaited its observable result, so terminate this one-shot driver here.
process.exit(failedAssertions > 0 ? 1 : 0);
