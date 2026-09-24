/**
 * Headless slash commands must exit 1 on failure and 0 on success.
 * The interactive TUI never goes through processPromptHeadless.
 * Exit code 1 matches the other headless failures (denied slash, empty reply).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  bodies: string[];
}

const SENTINEL = 'SLASH_EXIT_LLM_SENTINEL';

let server: http.Server;
let port = 0;
const bodies: string[] = [];

function childEnv(homeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue;
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) continue;
    env[key] = value;
  }
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  env.CODEBUDDY_SESSIONS_DIR = path.join(homeDir, '.codebuddy', 'sessions');
  env.CODEBUDDY_RUNS_DIR = path.join(homeDir, '.codebuddy', 'runs');
  env.CODEBUDDY_DISABLE_MCP = 'true';
  env.CODEBUDDY_HEADLESS = 'true';
  env.CODEBUDDY_PROVIDER_FALLBACK = 'false';
  env.CODEBUDDY_REQUEST_TIMEOUT_MS = '5000';
  env.LOG_LEVEL = 'error';
  env.NO_COLOR = '1';
  env.CI = '1';
  delete env.GROK_MODEL;
  delete env.CODEBUDDY_MODEL;
  return env;
}

function entryArgs(cliArgs: string[]): string[] {
  const compiled = process.env.SLASH_EXIT_ENTRY;
  if (compiled) return [path.resolve(compiled), ...cliArgs];
  return [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('src/index.ts'),
    ...cliArgs,
  ];
}

function baseArgs(prompt: string | null, format: 'text' | 'json'): string[] {
  const args = [
    '--api-key',
    'slash-exit-test-key',
    '--base-url',
    `http://127.0.0.1:${port}/v1`,
    '--model',
    'slash-exit-test-model',
    '--max-tool-rounds',
    '1',
    '--no-self-heal',
    '--ephemeral',
    '--quiet',
    '--disabled-tools',
    '*',
    '--output-format',
    format,
  ];
  if (prompt !== null) args.unshift('--prompt', prompt);
  return args;
}

function runCli(options: {
  name: string;
  prompt: string | null;
  format?: 'text' | 'json';
  stdin?: string;
}): Promise<CliResult> {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-exit-home-'));
  const format = options.format ?? 'text';
  const args = entryArgs(baseArgs(options.prompt, format));
  const before = bodies.length;
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: childEnv(homeDir),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (options.stdin !== undefined) {
    child.stdin.end(options.stdin);
  } else {
    child.stdin.end();
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`delai depasse ${options.name}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 90_000);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('error', (error) => {
      clearTimeout(timer);
      fs.rmSync(homeDir, { recursive: true, force: true });
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      const seen = bodies.slice(before);
      const outDir = process.env.SLASH_EXIT_OUT;
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${options.name}.exit`), `${exitCode}\n`);
        fs.writeFileSync(path.join(outDir, `${options.name}.stdout`), stdout);
        fs.writeFileSync(path.join(outDir, `${options.name}.stderr`), stderr);
        fs.writeFileSync(path.join(outDir, `${options.name}.bodies`), seen.join('\n---\n'));
      }
      fs.rmSync(homeDir, { recursive: true, force: true });
      const shown = args.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
      console.log(`CAS ${options.name} COMMANDE node ${shown}`);
      console.log(`CAS ${options.name} EXIT=${exitCode}`);
      console.log(`CAS ${options.name} STDOUT ${JSON.stringify(stdout.slice(0, 500))}`);
      resolve({ exitCode, stdout, stderr, bodies: seen });
    });
  });
}

function detail(result: CliResult): string {
  return `exit=${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function assertNoLlm(result: CliResult, prompt: string): void {
  const sent = result.bodies.filter((body) => body.includes(prompt) || body.includes(SENTINEL));
  expect(sent, detail(result)).toEqual([]);
  expect(result.stdout.includes(SENTINEL), detail(result)).toBe(false);
  expect(result.stderr.includes(SENTINEL), detail(result)).toBe(false);
}

function parseResultJson(stdout: string): { result?: unknown } {
  const line = stdout
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.startsWith('{'))
    .at(-1);
  expect(line, stdout).toBeTruthy();
  return JSON.parse(line ?? '') as { result?: unknown };
}

describe('headless slash exit code', () => {
  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: 'slash-exit-probe',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'slash-exit-test-model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: SENTINEL },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('port serveur absent');
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        server.closeAllConnections?.();
        resolve();
      }, 2_000);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });

  it('commande inconnue : code 1 et le texte Unknown command', async () => {
    const prompt = '/slash-exit-unknown-command';
    const result = await runCli({ name: 'inconnu', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toMatch(/Unknown command/i);
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/config set sans valeur : code 1 et le mode d emploi', async () => {
    const prompt = '/config set';
    const result = await runCli({ name: 'config-set-vide', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Usage: /config set');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/config set --json invalide : code 1 et Invalid JSON', async () => {
    const prompt = '/config set --json {';
    const result = await runCli({ name: 'config-json-invalide', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toMatch(/Invalid JSON/i);
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/theme avec un nom inconnu : code 1 et not found', async () => {
    const prompt = '/theme slash-exit-absent-theme';
    const result = await runCli({ name: 'theme-inconnu', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toMatch(/not found/i);
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/help : code 0 et la liste des commandes', async () => {
    const prompt = '/help';
    const result = await runCli({ name: 'help', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('CODE BUDDY COMMANDS');
    expect(result.exitCode, detail(result)).toBe(0);
  }, 180_000);

  it('/config schemas : code 0 et les schemas', async () => {
    const prompt = '/config schemas';
    const result = await runCli({ name: 'config-schemas', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Available Configuration Schemas');
    expect(result.stdout, detail(result)).toContain('settings.json');
    expect(result.exitCode, detail(result)).toBe(0);
  }, 180_000);

  it('commande inconnue en JSON : code 1 et un objet result', async () => {
    const prompt = '/slash-exit-unknown-command';
    const result = await runCli({ name: 'inconnu-json', prompt, format: 'json' });
    assertNoLlm(result, prompt);
    const parsed = parseResultJson(result.stdout);
    expect(typeof parsed.result, detail(result)).toBe('string');
    expect(String(parsed.result), detail(result)).toMatch(/Unknown command/i);
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('commande inconnue sur stdin : code 1', async () => {
    const prompt = '/slash-exit-unknown-command';
    const result = await runCli({ name: 'inconnu-stdin', prompt: null, stdin: `${prompt}\n` });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toMatch(/Unknown command/i);
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/config set --json --dry-run type incompatible : code 1 et success false', async () => {
    const prompt = '/config set --json --dry-run middleware.max_turns not-a-number';
    const result = await runCli({ name: 'config-json-type', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('"success": false');
    expect(result.stdout, detail(result)).toContain('Type mismatch');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/config set --dry-run type incompatible : code 1', async () => {
    const prompt = '/config set --dry-run middleware.max_turns not-a-number';
    const result = await runCli({ name: 'config-text-type', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Config Set Failed');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/config set --json [] : code 1, batch vide refusé', async () => {
    const prompt = '/config set --json []';
    const result = await runCli({ name: 'config-json-vide', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('non-empty object');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/trigger add sans source : code 1', async () => {
    const prompt = '/trigger add';
    const result = await runCli({ name: 'trigger-add', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('--source is required');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/worktree add sans chemin : code 1', async () => {
    const prompt = '/worktree add';
    const result = await runCli({ name: 'worktree-add', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Usage: /worktree add <path>');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/script run fichier absent : code 1', async () => {
    const prompt = '/script run slash-exit-missing.bs';
    const result = await runCli({ name: 'script-absent', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Script not found:');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('/prompt-cache off : code 0 et la désactivation annoncée', async () => {
    const prompt = '/prompt-cache off';
    const result = await runCli({ name: 'prompt-cache-off', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Prompt caching disabled');
    expect(result.exitCode, detail(result)).toBe(0);
  }, 180_000);

  it('/prompt-cache on : code 0 et l activation annoncée', async () => {
    const prompt = '/prompt-cache on';
    const result = await runCli({ name: 'prompt-cache-on', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Prompt caching enabled');
    expect(result.exitCode, detail(result)).toBe(0);
  }, 180_000);

  it('/fcs validate fichier absent : code 1 et Script not found', async () => {
    const prompt = '/fcs validate missing.fcs';
    const result = await runCli({ name: 'fcs-validate-absent', prompt });
    assertNoLlm(result, prompt);
    expect(result.stdout, detail(result)).toContain('Script not found:');
    expect(result.exitCode, detail(result)).toBe(1);
  }, 180_000);

  it('le gestionnaire /config set ne termine pas le processus', async () => {
    const exitAvant = process.exitCode;
    const { handleConfig } = await import('../../src/commands/handlers/vibe-handlers.js');
    const result = await handleConfig(['set']);
    const text = result.entry?.content ?? '';
    console.log(`CAS handler-config-set failed=${String(result.failed)} EXIT_PROCESS=${String(process.exitCode)}`);
    console.log(`CAS handler-config-set TEXTE ${JSON.stringify(text.slice(0, 240))}`);
    expect(text).toContain('Usage: /config set');
    expect(result.failed, text).toBe(true);
    expect(process.exitCode).toBe(exitAvant);
  }, 180_000);
});
