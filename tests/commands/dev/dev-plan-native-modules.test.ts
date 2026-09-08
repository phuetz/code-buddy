/**
 * `buddy dev plan` must not depend on a native addon.
 *
 * Windows CI killed this command with exit code 3228369023 (`0xC06D007F`,
 * the delay-load helper's "module not found" SEH exception) after it had
 * already printed the repo profile — intermittently, and with an empty stderr
 * because such an exception is raised below the JavaScript layer and no
 * `try/catch` can observe it.
 *
 * A module trace of the command on Linux showed seven native addons being
 * opened, none of which `dev plan` uses: three of them through floating
 * promises started while a module was merely being evaluated.
 *
 * These two tests hold that ground from the two sides that matter:
 *   - no optional native addon is opened on the path at all, which is the only
 *     protection against a failure that JavaScript cannot catch;
 *   - and if one is opened anyway, a load failure leaves the command's own
 *     exit code and PLAN.md intact.
 */
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
  nativeModules: string[];
}

const repoRoot = process.cwd();
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const roots: string[] = [];

/**
 * A CommonJS preload that observes — and optionally fails — every native
 * addon load. `Module._extensions['.node']` is the single entry point the
 * CommonJS loader uses for a `.node` file, whichever loader asked for it.
 */
const NATIVE_PROBE = `
const fs = require('node:fs');
const Module = require('node:module');
const record = process.env.GK_NATIVE_RECORD;
const fail = process.env.GK_NATIVE_FAIL === '1';
const original = Module._extensions['.node'];
Module._extensions['.node'] = function (module, filename) {
  try { fs.appendFileSync(record, filename + '\\n'); } catch { /* best effort */ }
  if (fail) {
    const error = new Error('simulated native load failure: ' + filename);
    error.code = 'ERR_DLOPEN_FAILED';
    throw error;
  }
  return original.call(this, module, filename);
};
`;

function runDevPlan(
  port: number,
  home: string,
  cwd: string,
  probeDir: string,
  objective: string,
  failNativeLoads: boolean,
): Promise<ChildResult> {
  const preload = path.join(probeDir, 'native-probe.cjs');
  const record = path.join(probeDir, 'native-loads.txt');
  fs.writeFileSync(preload, NATIVE_PROBE);
  fs.writeFileSync(record, '');

  // The runner exports NODE_OPTIONS (heap size); append, never replace it.
  // tsx runs the entry point in a child process of its own, so the probe has
  // to travel through NODE_OPTIONS rather than through argv.
  const nodeOptions = [process.env.NODE_OPTIONS, `--require "${preload}"`]
    .filter(Boolean)
    .join(' ');

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
        GROK_API_KEY: 'gk-native-test-key',
        GROK_BASE_URL: `http://127.0.0.1:${port}/v1`,
        GROK_MODEL: 'gk-native-test-model',
        CODEBUDDY_PROVIDER: 'grok',
        CODEBUDDY_DISABLE_MCP: 'true',
        HOME: home,
        USERPROFILE: home,
        LOG_LEVEL: 'error',
        NO_COLOR: '1',
        NODE_OPTIONS: nodeOptions,
        GK_NATIVE_RECORD: record,
        GK_NATIVE_FAIL: failNativeLoads ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 45000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (exitCode) => {
      clearTimeout(timer);
      const nativeModules = fs.readFileSync(record, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      resolve({ exitCode, stderr, stdout, timedOut, nativeModules });
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
      id: 'gk-native-dev-plan',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'gk-native-test-model',
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
    name: 'gk-native-toy',
    private: true,
    scripts: { test: 'node --test' },
  }));
  return cwd;
}

const PLAN_BODY = [
  '1. Edit src/add.js so add(a, b) returns a + b',
  '2. Re-run npm test',
].join('\n');

/** Optional addons the command has no use for; each is a Windows DLL hazard. */
const FORBIDDEN_NATIVE_PACKAGES = [
  'onnxruntime-node',
  'sharp',
  'usearch',
  'tree-sitter',
  'tree-sitter-bash',
  'tree-sitter-typescript',
  'better-sqlite3',
];

function loadedPackages(nativeModules: string[]): string[] {
  const found = new Set<string>();
  for (const file of nativeModules) {
    const posix = file.replace(/\\/g, '/');
    for (const pkg of FORBIDDEN_NATIVE_PACKAGES) {
      if (posix.includes(`/node_modules/${pkg}/`)) found.add(pkg);
    }
  }
  return [...found].sort();
}

async function withPlanRun(
  failNativeLoads: boolean,
  assertions: (result: ChildResult, cwd: string) => void,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(repoRoot, '.gk-dev-plan-native-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const probeDir = path.join(root, 'probe');
  fs.mkdirSync(probeDir, { recursive: true });
  const cwd = seedToyCwd(root);
  const server = await fakePlanServer(PLAN_BODY);

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    const result = await runDevPlan(
      address.port,
      home,
      cwd,
      probeDir,
      'corrige le bug',
      failNativeLoads,
    );
    expect(result.timedOut, `${result.stderr}\n${result.stdout}`).toBe(false);
    assertions(result, cwd);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('buddy dev plan native module loading', () => {
  it('opens no optional native addon on its path', async () => {
    await withPlanRun(false, (result) => {
      expect(result.exitCode, `${result.stderr}\n${result.stdout}`).toBe(0);
      expect(
        loadedPackages(result.nativeModules),
        `native addons opened by \`dev plan\`:\n${result.nativeModules.join('\n')}`,
      ).toEqual([]);
    });
  }, 60000);

  it('still exits 0 and writes PLAN.md when every native load fails', async () => {
    await withPlanRun(true, (result, cwd) => {
      expect(result.exitCode, `${result.stderr}\n${result.stdout}`).toBe(0);
      const planPath = path.join(cwd, 'PLAN.md');
      expect(fs.existsSync(planPath), result.stdout).toBe(true);
      expect(fs.readFileSync(planPath, 'utf8')).toContain('Objective: corrige le bug');
    });
  }, 60000);
});
