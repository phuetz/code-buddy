/**
 * Un tour d'agent complet, contre un serveur HTTP local compatible OpenAI,
 * s'arrête sur max_turns et max_cost écrits dans config.toml.
 * Aucun profil réel : maison et répertoire de travail jetables.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/memory/persistent-memory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/persistent-memory.js')>();
  actual.PersistentMemoryManager.prototype.initialize = () => Promise.resolve();
  return {
    ...actual,
    initializeMemory: () => Promise.resolve(undefined as never),
  };
});

import { CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';
import { getConfigManager, resetConfigManager } from '../../src/config/toml-config.js';

const previous = {
  home: process.env.HOME,
  codebuddyHome: process.env.CODEBUDDY_HOME,
  config: process.env.CODEBUDDY_CONFIG,
  maxCost: process.env.MAX_COST,
  yolo: process.env.YOLO_MODE,
  fallback: process.env.CODEBUDDY_PROVIDER_FALLBACK,
  argv: process.argv.slice(),
  cwd: process.cwd(),
};

let scratch: string | undefined;
let server: Server | undefined;
const agents: CodeBuddyAgent[] = [];
const adapters: Array<{ dispose(): void }> = [];

function restoreEnv(): void {
  process.chdir(previous.cwd);
  process.argv = previous.argv.slice();
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore('HOME', previous.home);
  restore('CODEBUDDY_HOME', previous.codebuddyHome);
  restore('CODEBUDDY_CONFIG', previous.config);
  restore('MAX_COST', previous.maxCost);
  restore('YOLO_MODE', previous.yolo);
  restore('CODEBUDDY_PROVIDER_FALLBACK', previous.fallback);
}

function toolStream(hit: number): string {
  const args = JSON.stringify({ n: hit });
  const pieces = [
    {
      id: `chatcmpl-${hit}`,
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: 'x'.repeat(4000),
          tool_calls: [{
            index: 0,
            id: `call_${hit}`,
            type: 'function',
            function: { name: 'probe_budget', arguments: '' },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      id: `chatcmpl-${hit}`,
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: args } }],
        },
        finish_reason: null,
      }],
    },
    {
      id: `chatcmpl-${hit}`,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 },
    },
  ];
  return `${pieces.map((piece) => `data: ${JSON.stringify(piece)}\n\n`).join('')}data: [DONE]\n\n`;
}

/** count : toutes les requêtes ; toolTurns : celles qui portent des outils (tours de la boucle). */
function listen(hits: { count: number; toolTurns?: number }): Promise<number> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url ?? '').includes('/chat/completions')) {
        hits.count += 1;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tools?: unknown[] };
          if ((body.tools?.length ?? 0) > 0) hits.toolTurns = (hits.toolTurns ?? 0) + 1;
        } catch { /* corps illisible : pas un tour d'outils */ }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(toolStream(hits.count));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') throw new Error('port attendu');
      resolve(address.port);
    });
  });
}

async function turn(toml: string): Promise<{ hits: number; text: string }> {
  scratch = mkdtempSync(path.join(tmpdir(), 'mw-loop-'));
  mkdirSync(path.join(scratch, '.codebuddy'), { recursive: true });
  writeFileSync(path.join(scratch, '.codebuddy', 'config.toml'), toml);
  process.env.HOME = scratch;
  process.env.CODEBUDDY_HOME = scratch;
  delete process.env.CODEBUDDY_CONFIG;
  delete process.env.MAX_COST;
  delete process.env.YOLO_MODE;
  delete process.env.CODEBUDDY_PROVIDER_FALLBACK;
  process.argv = ['node', 'buddy'];
  process.chdir(scratch);
  const hits = { count: 0 };
  const port = await listen(hits);
  const agent = new CodeBuddyAgent(
    'test-api-key',
    `http://127.0.0.1:${port}/v1`,
    'grok-3-latest',
    undefined,
    false,
  );
  agents.push(agent);
  const parts: string[] = [];
  for await (const event of agent.processUserMessageStream('continue jusqu\'au plafond')) {
    if (event.type === 'content' && typeof event.content === 'string') parts.push(event.content);
  }
  return { hits: hits.count, text: parts.join('\n') };
}

/**
 * Chemin de construction de Cowork : le processus tourne depuis A, la
 * session ouvre le projet B. Seul le fichier de B doit borner la boucle.
 */
async function coworkTurn(processToml: string, projectToml: string): Promise<{ hits: number; text: string }> {
  scratch = mkdtempSync(path.join(tmpdir(), 'mw-loop-cowork-'));
  const processDir = path.join(scratch, 'processus-a');
  const projectDir = path.join(scratch, 'projet-b');
  const profileDir = path.join(scratch, 'profil');
  for (const [dir, body] of [[processDir, processToml], [projectDir, projectToml]] as const) {
    mkdirSync(path.join(dir, '.codebuddy'), { recursive: true });
    writeFileSync(path.join(dir, '.codebuddy', 'config.toml'), body);
  }
  mkdirSync(profileDir, { recursive: true });
  process.env.HOME = profileDir;
  process.env.CODEBUDDY_HOME = profileDir;
  delete process.env.CODEBUDDY_CONFIG;
  delete process.env.MAX_COST;
  delete process.env.YOLO_MODE;
  delete process.env.CODEBUDDY_PROVIDER_FALLBACK;
  process.argv = ['node', 'buddy'];
  process.chdir(processDir);
  const hits = { count: 0 };
  const port = await listen(hits);
  const { CodeBuddyEngineAdapter } = await import('../../src/desktop/codebuddy-engine-adapter.js');
  const adapter = new CodeBuddyEngineAdapter({
    apiKey: 'test-api-key',
    baseURL: `http://127.0.0.1:${port}/v1`,
    model: 'grok-3-latest',
    workingDirectory: projectDir,
  });
  adapters.push(adapter);
  const parts: string[] = [];
  const result = await adapter.runSession(
    'mw-cowork-b',
    [{ role: 'user', content: 'continue jusqu\'au plafond' }],
    (event) => {
      const content = (event as { content?: unknown }).content;
      if (typeof content === 'string') parts.push(content);
    },
  );
  parts.push(result.content);
  return { hits: hits.count, text: parts.join('\n') };
}

afterEach(async () => {
  while (agents.length > 0) {
    const agent = agents.pop();
    try { agent?.dispose(); } catch { /* déjà arrêté */ }
  }
  while (adapters.length > 0) {
    const adapter = adapters.pop();
    try { adapter?.dispose(); } catch { /* déjà arrêté */ }
  }
  if (server) {
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
  restoreEnv();
  resetConfigManager();
  if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  scratch = undefined;
});

describe('middleware — un tour réel s\'arrête sur le fichier', () => {
  it('max_turns = 3 arrête la boucle au troisième appel', async () => {
    const result = await turn('[middleware]\nmax_turns = 3\nmax_cost = 50\n');
    expect(result.hits).toBe(3);
    expect(result.text).toContain('Maximum tool execution rounds reached.');
    expect(result.text).not.toContain('Stopping before tool execution');
  }, 180000);

  it('max_cost = 0.0001 coupe la boucle avant le plafond de tours', async () => {
    const result = await turn('[middleware]\nmax_turns = 4\nmax_cost = 0.0001\n');
    expect(result.hits).toBe(1);
    expect(result.text).toContain('Session cost limit reached');
    expect(result.text).toContain('Stopping before tool execution');
    expect(result.text).not.toContain('Maximum tool execution rounds reached.');
  }, 180000);
});

describe('middleware — Cowork ouvre un projet distinct du cwd', () => {
  it('max_turns = 3 du projet B arrête la boucle, pas le 8 du répertoire A', async () => {
    const result = await coworkTurn(
      '[middleware]\nmax_turns = 8\nmax_cost = 50\n',
      '[middleware]\nmax_turns = 3\nmax_cost = 50\n',
    );
    expect(result.hits).toBe(3);
    expect(result.text).toContain('Maximum tool execution rounds reached.');
  }, 180000);

  it('max_cost = 0.0001 du projet B coupe la boucle au premier appel', async () => {
    const result = await coworkTurn(
      '[middleware]\nmax_turns = 4\nmax_cost = 50\n',
      '[middleware]\nmax_turns = 4\nmax_cost = 0.0001\n',
    );
    expect(result.hits).toBe(1);
    expect(result.text).toContain('Session cost limit reached');
  }, 180000);
});

/** Deux projets A et B, un profil utilisateur, le processus lancé depuis A. */
async function twoProjects(
  processToml: string,
  projectToml: string,
  userToml?: string,
): Promise<{ processDir: string; projectDir: string; port: number; hits: { count: number; toolTurns?: number } }> {
  scratch = mkdtempSync(path.join(tmpdir(), 'mw-loop-switch-'));
  const processDir = path.join(scratch, 'processus-a');
  const projectDir = path.join(scratch, 'projet-b');
  const profileDir = path.join(scratch, 'profil');
  for (const [dir, body] of [[processDir, processToml], [projectDir, projectToml]] as const) {
    mkdirSync(path.join(dir, '.codebuddy'), { recursive: true });
    writeFileSync(path.join(dir, '.codebuddy', 'config.toml'), body);
  }
  mkdirSync(path.join(profileDir, '.codebuddy'), { recursive: true });
  if (userToml !== undefined) writeFileSync(path.join(profileDir, '.codebuddy', 'config.toml'), userToml);
  process.env.HOME = profileDir;
  process.env.CODEBUDDY_HOME = profileDir;
  delete process.env.CODEBUDDY_CONFIG;
  delete process.env.MAX_COST;
  delete process.env.YOLO_MODE;
  delete process.env.CODEBUDDY_PROVIDER_FALLBACK;
  process.argv = ['node', 'buddy'];
  process.chdir(processDir);
  resetConfigManager();
  const hits: { count: number; toolTurns?: number } = { count: 0, toolTurns: 0 };
  const port = await listen(hits);
  return { processDir, projectDir, port, hits };
}

async function drain(agent: CodeBuddyAgent): Promise<string> {
  const parts: string[] = [];
  for await (const event of agent.processUserMessageStream('continue jusqu\'au plafond')) {
    if (event.type === 'content' && typeof event.content === 'string') parts.push(event.content);
  }
  return parts.join('\n');
}

describe('middleware — le projet change après la construction (tour réel)', () => {
  it('reprise : session de B hydratée dans un agent né dans A → 3 appels, pas 8', async () => {
    const { projectDir, port, hits } = await twoProjects(
      '[middleware]\nmax_turns = 8\nmax_cost = 50\n',
      '[middleware]\nmax_turns = 3\nmax_cost = 50\n',
    );
    const agent = new CodeBuddyAgent('test-api-key', `http://127.0.0.1:${port}/v1`, 'grok-3-latest', undefined, false);
    agents.push(agent);
    agent.hydratePersistedSession({
      id: 'mw-reprise-b',
      name: 'reprise',
      workingDirectory: projectDir,
      model: 'grok-3-latest',
      messages: [],
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    });
    const text = await drain(agent);
    expect(hits.count).toBe(3);
    expect(text).toContain('Maximum tool execution rounds reached.');
  }, 180000);

  it('reprise : max_cost = 0.0001 de B coupe au premier appel', async () => {
    const { projectDir, port, hits } = await twoProjects(
      '[middleware]\nmax_turns = 4\nmax_cost = 50\n',
      '[middleware]\nmax_turns = 4\nmax_cost = 0.0001\n',
    );
    const agent = new CodeBuddyAgent('test-api-key', `http://127.0.0.1:${port}/v1`, 'grok-3-latest', undefined, false);
    agents.push(agent);
    agent.hydratePersistedSession({
      id: 'mw-reprise-b-cout',
      name: 'reprise',
      workingDirectory: projectDir,
      model: 'grok-3-latest',
      messages: [],
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    });
    const text = await drain(agent);
    expect(hits.count).toBe(1);
    expect(text).toContain('Session cost limit reached');
  }, 180000);

  it('Cowork : agent réutilisé, second tour dans le projet B → 3 appels', async () => {
    const { processDir, projectDir, port, hits } = await twoProjects(
      '[middleware]\nmax_turns = 5\nmax_cost = 50\n',
      '[middleware]\nmax_turns = 3\nmax_cost = 50\n',
    );
    const { CodeBuddyEngineAdapter } = await import('../../src/desktop/codebuddy-engine-adapter.js');
    const adapter = new CodeBuddyEngineAdapter({
      apiKey: 'test-api-key',
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: 'grok-3-latest',
      workingDirectory: processDir,
    });
    adapters.push(adapter);
    const first = { role: 'user' as const, content: 'continue jusqu\'au plafond' };
    await adapter.runSession('mw-cowork-reuse', [first], () => undefined);
    expect(hits.toolTurns).toBe(5);
    hits.toolTurns = 0;
    // L'identité Cowork inclut le projet : l'agent de A est éliminé et son
    // transcript résumé par deux requêtes sans outils. Seuls les tours comptent.
    await adapter.runSession(
      'mw-cowork-reuse',
      [first, { role: 'assistant', content: 'plafond' }, { role: 'user', content: 'encore' }],
      () => undefined,
      { workingDirectory: projectDir },
    );
    expect(hits.toolTurns).toBe(3);
  }, 180000);

  it('Cowork : profil actif appliqué par applyProfile, sans --profile → 3 appels', async () => {
    const { projectDir, port, hits } = await twoProjects(
      '[middleware]\nmax_cost = 50\n',
      '[middleware]\nmax_cost = 50\n',
      [
        '[middleware]',
        'max_turns = 8',
        '',
        '[profiles.serre]',
        'active_model = "grok-3-latest"',
        '',
        '[profiles.serre.middleware]',
        'max_turns = 3',
        '',
      ].join('\n'),
    );
    process.argv = ['electron', 'cowork'];
    getConfigManager().applyProfile('serre');
    const { CodeBuddyEngineAdapter } = await import('../../src/desktop/codebuddy-engine-adapter.js');
    const adapter = new CodeBuddyEngineAdapter({
      apiKey: 'test-api-key',
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: 'grok-3-latest',
      workingDirectory: projectDir,
    });
    adapters.push(adapter);
    await adapter.runSession('mw-cowork-profil', [{ role: 'user', content: 'continue jusqu\'au plafond' }], () => undefined);
    expect(hits.count).toBe(3);
  }, 180000);
});
