import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Plafond de tas EXPLICITE pour le processus CLI. `spawn(process.execPath, …)`
// ne reçoit ni l'execArgv du fork Vitest ni aucune consigne : le défaut de V8
// dépend de la RAM de l'hôte — ~4 Go sur les runners Linux et Windows (16 Go),
// mais ~2 Go sur macos-latest (3 vCPU / 7 Go). Or le tour mesuré demande
// RÉELLEMENT entre 1 et 1,5 Go sous Linux (mesuré en abaissant le plafond :
// rouge à 1024, vert à 1536) et davantage sous macOS : il mourait donc
// « JavaScript heap out of memory », code 134, sur le SEUL runner macOS.
//
// Le drapeau passe par NODE_OPTIONS et NON par argv : tsx RELANCE un
// petit-fils node avec son propre chargeur, et un drapeau V8 posé sur la ligne
// de commande du parent ne le suit pas — NODE_OPTIONS, si. (Vérifié : avec le
// drapeau en argv le plafond restait celui du défaut ; via NODE_OPTIONS, le
// petit-fils meurt bien à 256 Mo.) La valeur d'origine est préservée pour ne
// rien perdre de ce que l'hôte demandait.
const CHILD_HEAP_MB = 4096;

function childNodeOptions(inherited: string | undefined): string {
  return [inherited, `--max-old-space-size=${CHILD_HEAP_MB}`]
    .filter(Boolean)
    .join(' ');
}

function getCleanChildEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0] !== 'FORCE_COLOR',
    ),
  );
}

function runHeadless(port: number, options: {
  homeDir: string;
  prompt: string;
  resume?: string;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const args = [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    'src/index.ts',
  ];
  if (options.resume) args.push('--resume', options.resume);
  args.push(
    '--prompt',
    options.prompt,
    '--api-key',
    'test-key',
    '--base-url',
    `http://127.0.0.1:${port}/v1`,
    '--model',
    'qa-mock-model',
    '--max-tool-rounds',
    '1',
    '--no-self-heal',
    '--quiet',
    '--disabled-tools',
    '*',
    '--output-format',
    'json',
  );

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...getCleanChildEnv(),
        NODE_OPTIONS: childNodeOptions(process.env.NODE_OPTIONS),
        HOME: options.homeDir,
        USERPROFILE: options.homeDir,
        CODEBUDDY_SESSIONS_DIR: path.join(options.homeDir, '.codebuddy', 'sessions'),
        CODEBUDDY_RUNS_DIR: path.join(options.homeDir, '.codebuddy', 'runs'),
        CODEBUDDY_TIMELINE: 'true',
        CODEBUDDY_DISABLE_MCP: 'true',
        CODEBUDDY_HEADLESS: 'true',
        CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
        LOG_LEVEL: 'error',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

// Le scénario enchaîne QUATRE tours CLI complets, chacun démarrant tsx et tout
// le graphe de modules. Sur macos-latest (3 vCPU / 7 Go), pendant la suite
// parallèle, les 120 s d'origine ont été franchies sur le job Node 22 alors
// que Node 20 passait — c'est un budget calé sur une machine rapide, pas une
// propriété du code. Il suit donc la machine, comme testTimeout dans
// vitest.config.ts ; un vrai blocage échoue toujours, simplement plus tard.
const TURN_BUDGET_MS =
  process.platform === 'win32' || process.platform === 'darwin' ? 300_000 : 120_000;

describe('GK29 headless resume keeps one timeline session', () => {
  it('appends three --resume turns onto a single session and timeline', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-gk29-resume',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'qa-mock-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'GK29_TURN_OK' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk29-headless-resume-'));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const first = await runHeadless(address.port, { homeDir, prompt: 'first turn' });
      expect(first.exitCode, first.stderr).toBe(0);

      const sessionsDir = path.join(homeDir, '.codebuddy', 'sessions');
      const sessionFiles = fs.readdirSync(sessionsDir).filter((entry) => entry.endsWith('.json'));
      expect(sessionFiles).toHaveLength(1);
      const sessionId = sessionFiles[0]!.replace(/\.json$/u, '');

      for (const prompt of ['second turn', 'third turn']) {
        const result = await runHeadless(address.port, { homeDir, prompt, resume: sessionId });
        expect(result.exitCode, result.stderr).toBe(0);
      }

      const afterFiles = fs.readdirSync(sessionsDir).filter((entry) => entry.endsWith('.json'));
      expect(afterFiles).toEqual([`${sessionId}.json`]);
      const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8')) as {
        messages: Array<{ type: string; content: string }>;
      };
      expect(session.messages.filter((message) => message.type === 'user').map((message) => message.content)).toEqual([
        'first turn',
        'second turn',
        'third turn',
      ]);

      const timelinesDir = path.join(homeDir, '.codebuddy', 'timelines');
      const timelineFiles = fs.readdirSync(timelinesDir).filter((entry) => entry.endsWith('.jsonl'));
      expect(timelineFiles).toHaveLength(1);
      const entries = fs.readFileSync(path.join(timelinesDir, timelineFiles[0]!), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { turn: number });
      expect(entries.map((entry) => entry.turn)).toEqual([1, 2, 3]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, TURN_BUDGET_MS);
});
