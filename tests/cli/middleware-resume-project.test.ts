/**
 * `--resume` et `--continue` depuis un autre répertoire : la session reprise
 * appartient au projet B, le processus tourne dans A. Les plafonds [middleware]
 * sont ceux de B, et le max_turns de A n'est pas transmis comme une option
 * de ligne de commande. Vrai binaire (tsx), serveur local compatible OpenAI,
 * maison jetable.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function cleanEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string'
      && entry[0] !== 'FORCE_COLOR'
      && entry[0] !== 'MAX_COST'
      && entry[0] !== 'YOLO_MODE'
      && entry[0] !== 'CODEBUDDY_CONFIG'
      && entry[0] !== 'CODEBUDDY_HOME',
    ),
  );
}

function toolCall(hit: number, stream: boolean): string {
  const call = {
    id: `call_${hit}`,
    type: 'function',
    function: { name: 'probe_budget', arguments: JSON.stringify({ n: hit }) },
  };
  const usage = { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 };
  if (!stream) {
    return JSON.stringify({
      id: `chatcmpl-${hit}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'qa-mock-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: `tour ${hit}`, tool_calls: [call] },
        finish_reason: 'tool_calls',
      }],
      usage,
    });
  }
  const pieces = [
    {
      id: `chatcmpl-${hit}`,
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: `tour ${hit}`, tool_calls: [{ index: 0, ...call }] },
        finish_reason: null,
      }],
    },
    {
      id: `chatcmpl-${hit}`,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage,
    },
  ];
  return `${pieces.map((piece) => `data: ${JSON.stringify(piece)}\n\n`).join('')}data: [DONE]\n\n`;
}

const hits = { count: 0 };
let server: http.Server | undefined;
let port = 0;
let homeDir = '';
let dirA = '';
let dirB = '';

function run(cwd: string, extra: string[]): Promise<{ exitCode: number | null; stderr: string; hits: number }> {
  hits.count = 0;
  const args = [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('src/index.ts'),
    ...extra,
    '--prompt',
    'continue jusqu\'au plafond',
    '--api-key',
    'test-key',
    '--base-url',
    `http://127.0.0.1:${port}/v1`,
    '--model',
    'qa-mock-model',
    '--no-self-heal',
    '--quiet',
    '--disabled-tools',
    '*',
    '--output-format',
    'json',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: {
        ...cleanEnv(),
        HOME: homeDir,
        USERPROFILE: homeDir,
        CODEBUDDY_SESSIONS_DIR: path.join(homeDir, '.codebuddy', 'sessions'),
        CODEBUDDY_RUNS_DIR: path.join(homeDir, '.codebuddy', 'runs'),
        CODEBUDDY_DISABLE_MCP: 'true',
        CODEBUDDY_HEADLESS: 'true',
        CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
        LOG_LEVEL: 'error',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stderr, hits: hits.count }));
  });
}

function sessionId(): string {
  const files = fs.readdirSync(path.join(homeDir, '.codebuddy', 'sessions')).filter((f) => f.endsWith('.json'));
  expect(files).toHaveLength(1);
  return files[0]!.replace(/\.json$/u, '');
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url ?? '').includes('/chat/completions')) {
        hits.count += 1;
        let stream = false;
        try {
          stream = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean }).stream === true;
        } catch { /* corps illisible : réponse simple */ }
        res.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' });
        res.end(toolCall(hits.count, stream));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port attendu');
  port = address.port;
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-resume-project-'));
  dirA = path.join(homeDir, 'projet-a');
  dirB = path.join(homeDir, 'projet-b');
  for (const [dir, turns] of [[dirA, 8], [dirB, 3]] as const) {
    fs.mkdirSync(path.join(dir, '.codebuddy'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.codebuddy', 'config.toml'), `[middleware]\nmax_turns = ${turns}\nmax_cost = 50\n`);
  }
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (homeDir) fs.rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('--resume / --continue depuis un autre projet', () => {
  it('le premier tour dans B s\'arrête sur les 3 tours de B', async () => {
    const first = await run(dirB, []);
    expect(first.hits, first.stderr).toBe(3);
    sessionId();
  }, 180_000);

  it('--resume depuis A garde les 3 tours de B, pas les 8 de A', async () => {
    const resumed = await run(dirA, ['--resume', sessionId()]);
    expect(resumed.hits, resumed.stderr).toBe(3);
  }, 180_000);

  it('--continue depuis A garde les 3 tours de B, pas les 8 de A', async () => {
    const continued = await run(dirA, ['--continue']);
    expect(continued.hits, continued.stderr).toBe(3);
  }, 180_000);

  it('--max-tool-rounds reste prioritaire sur le fichier de B', async () => {
    const forced = await run(dirA, ['--resume', sessionId(), '--max-tool-rounds', '2']);
    expect(forced.hits, forced.stderr).toBe(2);
  }, 180_000);
});
