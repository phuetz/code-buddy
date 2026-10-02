import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateShellExecution, executeInWorkspaceSandbox } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import { validateCommand } from '../../src/tools/bash/command-validator.js';
import { probeNativeSandbox } from '../sandbox/native-sandbox-ready.js';

const readiness = await probeNativeSandbox();
let root: string | undefined;
afterEach(() => { vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); if (root) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'capabilities-banc-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'tiny-audit', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'tiny-audit', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'tiny-audit', version: '1.0.0' } } }));
  fs.writeFileSync(path.join(root, '.npmrc'), 'secret=DO_NOT_READ');
  getPermissionModeManager().setMode('dontAsk');
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,git-local,npm-registry');
  return root;
}

describe.sequential('capacité headless accordée par opérateur', () => {
  it('npm --version et audit sont confinés ; push, secrets et shell non approuvé restent fermés', async () => {
    const cwd = fixture();
    expect((await evaluateShellExecution('npm --version', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('npm audit --json', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('npm view undici@6.29.0 dependencies', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('npm view undici --registry=https://example.invalid', cwd)).action).not.toBe('sandbox');
    const recordedAnalysis = `npm audit --json > "$TMPDIR/audit.json"; python3 -c "\nimport json\nprint('audit')\n"`;
    expect((await evaluateShellExecution(recordedAnalysis, cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('npm audit --json; node -e "$(cat forbidden)"', cwd)).action).not.toBe('sandbox');
    expect((await evaluateShellExecution('git add package.json', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('git push origin main', cwd)).action).not.toBe('sandbox');
    expect((await evaluateShellExecution('npm publish', cwd)).action).not.toBe('sandbox');
    expect(validateCommand(`cat '${cwd}/.npmrc'`).valid).toBe(false);
    expect((await evaluateShellExecution('npm audit --json && curl https://example.invalid', cwd)).action).not.toBe('sandbox');
  });

  it('exécute audit, tests et commit local sans TTY, en gardant le réseau général fermé', async () => {
    const cwd = fixture();
    if (!readiness.ready) return;
    for (const command of ['npm --version', 'npm audit --json', 'npm test', 'git add package.json package-lock.json', 'git commit -m fixture']) {
      const result = await executeInWorkspaceSandbox(command, cwd, 30000);
      expect(result.available, result.reason).toBe(true);
      expect(result.result?.exitCode, result.result?.stderr + '\n' + result.result?.stdout).toBe(0);
    }
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd, encoding: 'utf8' }).trim()).toBe('fixture');
    const server = http.createServer((_request, response) => response.end('host-network'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      expect(await (await fetch(endpoint)).text()).toBe('host-network');
      const network = await executeInWorkspaceSandbox(`node -e "fetch('${endpoint}').then(() => process.exit(0)).catch(() => process.exit(42))"`, cwd, 5000);
      expect(network.result?.exitCode).toBe(42);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 120000);
});

it('refuse le détournement du broker vers un fichier extérieur au workspace', async () => {
  const cwd = fixture();
  if (!readiness.ready) return;
  const outside = path.join(path.dirname(cwd), path.basename(cwd) + '-private.json');
  fs.writeFileSync(outside, '{"private":"DO_NOT_READ"}');
  try {
    fs.unlinkSync(path.join(cwd, 'package.json'));
    fs.symlinkSync(outside, path.join(cwd, 'package.json'));
    const result = await executeInWorkspaceSandbox('npm audit --json', cwd, 30000);
    expect(result.result?.exitCode).toBe(1);
    expect(result.result?.stderr).toContain('non-secret workspace file');
    expect(result.result?.stdout).not.toContain('DO_NOT_READ');
  } finally { fs.unlinkSync(outside); }
});
