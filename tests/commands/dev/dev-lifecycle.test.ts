import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

interface ChildResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

const repoRoot = process.cwd();
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const roots: string[] = [];

function runDevPlan(
  port: number,
  home: string,
  cwd: string,
  objective = 'R17 lifecycle plan',
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      tsxCli,
      path.join(repoRoot, 'src', 'index.ts'),
      'dev',
      'plan',
      objective,
    ], {
      cwd,
      env: {
        ...process.env,
        GROK_API_KEY: 'r17-test-key',
        GROK_BASE_URL: `http://127.0.0.1:${port}/v1`,
        GROK_MODEL: 'r17-test-model',
        CODEBUDDY_PROVIDER: 'grok',
        CODEBUDDY_DISABLE_MCP: 'true',
        HOME: home,
        USERPROFILE: home,
        LOG_LEVEL: 'error',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 45000); // instable sous charge du balayage complet (2× 15 s dépassés le 03/09), passe seul en ~2 s
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stderr, stdout, timedOut });
    });
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function fakePlanServer(content: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      connection: 'close',
    });
    res.write(`data: ${JSON.stringify({
      id: 'r17-dev-plan',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'r17-test-model',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function seedToyCwd(root: string): string {
  const cwd = path.join(root, 'toy');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'gk18-toy',
    private: true,
    scripts: { test: 'node --test' },
  }));
  return cwd;
}

describe('buddy dev plan lifecycle', () => {
  it('returns after a plan has been streamed from a fake provider and writes PLAN.md', async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, '.r17-dev-plan-'));
    roots.push(root);
    const home = path.join(root, 'home');
    const cwd = seedToyCwd(root);
    const planBody = [
      '1. Edit src/add.js so add(a, b) returns a + b',
      '2. Re-run npm test',
      '3. Leave the fake CI red until fix-ci',
    ].join('\n');
    const server = await fakePlanServer(planBody);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const result = await runDevPlan(address.port, home, cwd, 'corrige le bug');
      expect(result.timedOut, `${result.stderr}\n${result.stdout}`).toBe(false);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Edit src/add.js');
      const planPath = path.join(cwd, 'PLAN.md');
      expect(fs.existsSync(planPath), result.stdout).toBe(true);
      expect(fs.readFileSync(planPath, 'utf8')).toContain('Objective: corrige le bug');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('exits 1 and does not write PLAN.md when the model returns an empty plan', async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, '.r17-dev-plan-'));
    roots.push(root);
    const home = path.join(root, 'home');
    const cwd = seedToyCwd(root);
    const server = await fakePlanServer('');

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const result = await runDevPlan(address.port, home, cwd, 'corrige le bug');
      expect(result.timedOut, `${result.stderr}\n${result.stdout}`).toBe(false);
      expect(result.exitCode, `${result.stderr}\n${result.stdout}`).toBe(1);
      expect(fs.existsSync(path.join(cwd, 'PLAN.md'))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
