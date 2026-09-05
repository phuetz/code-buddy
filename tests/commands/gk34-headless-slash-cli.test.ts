import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface ProviderProbe {
  server: http.Server;
  port: number;
  getRequestBodies: () => string[];
}

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const qaRoot = path.resolve('_qa', 'verifix1', 'headless-slash');
let provider: ProviderProbe;

async function startProvider(): Promise<ProviderProbe> {
  const requestBodies: string[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requestBodies.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'verifix1-headless-slash',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'verifix1-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'CLI_ROUTE_LLM_SENTINEL' },
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
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Expected TCP server address');
  }
  return { server, port: address.port, getRequestBodies: () => [...requestBodies] };
}

async function runCli(prompt: string, homeDir: string): Promise<CliResult> {
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const child = spawn(process.execPath, [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('src/index.ts'),
    '--prompt',
    prompt,
    '--api-key',
    'verifix1-test-key',
    '--base-url',
    `http://127.0.0.1:${provider.port}/v1`,
    '--model',
    'verifix1-model',
    '--max-tool-rounds',
    '1',
    '--no-self-heal',
    '--ephemeral',
    '--quiet',
    '--disabled-tools',
    '*',
    '--output-format',
    'text',
  ], {
    cwd: process.cwd(),
    env: {
      ...cleanEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CODEBUDDY_SESSIONS_DIR: path.join(homeDir, '.codebuddy', 'sessions'),
      CODEBUDDY_RUNS_DIR: path.join(homeDir, '.codebuddy', 'runs'),
      CODEBUDDY_DISABLE_MCP: 'true',
      CODEBUDDY_HEADLESS: 'true',
      CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
      LOG_LEVEL: 'error',
      NODE_ENV: 'development',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

describe('VERIFIX1: CLI headless slash routing', () => {
  beforeAll(async () => {
    await mkdir(qaRoot, { recursive: true });
    provider = await startProvider();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => provider.server.close(() => resolve()));
    await rm(qaRoot, { recursive: true, force: true });
  });

  it('routes buddy -p "/batch" through the slash dispatcher', async () => {
    const homeDir = await mkdtemp(path.join(qaRoot, 'batch-home-'));
    const requestsBefore = provider.getRequestBodies().length;
    const result = await runCli('/batch', homeDir);
    const promptRequests = provider
      .getRequestBodies()
      .slice(requestsBefore)
      .filter((body) => body.includes('/batch'));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: /batch');
    expect(result.stdout).not.toContain('CLI_ROUTE_LLM_SENTINEL');
    expect(promptRequests).toEqual([]);
  }, 60_000);

  it('routes buddy -p "/swarm help" through the slash dispatcher', async () => {
    const homeDir = await mkdtemp(path.join(qaRoot, 'swarm-home-'));
    const requestsBefore = provider.getRequestBodies().length;
    const result = await runCli('/swarm help', homeDir);
    const promptRequests = provider
      .getRequestBodies()
      .slice(requestsBefore)
      .filter((body) => body.includes('/swarm help'));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: /swarm');
    expect(result.stdout).not.toContain('CLI_ROUTE_LLM_SENTINEL');
    expect(promptRequests).toEqual([]);
  }, 60_000);
});
