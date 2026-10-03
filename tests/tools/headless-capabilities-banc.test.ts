import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateShellExecution, executeInWorkspaceSandbox } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
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
    expect((await evaluateShellExecution('npm view undici dist-tags --json', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('npm pack npm@11.21.0 --silent', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('npm pack https://example.invalid/archive.tgz', cwd)).action).not.toBe('sandbox');
    expect((await evaluateShellExecution('npm ls undici --json', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('node -e "console.log(1)"\necho metadata\nnpm ls undici', cwd)).action).toBe('sandbox');
    expect((await evaluateShellExecution('npm audit --json\ncurl https://example.invalid', cwd)).action).not.toBe('sandbox');
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

it('permet le commit local précédé du cd vers la même lane', async () => {
  const cwd = fixture();
  if (!readiness.ready) return;
  const command = `cd '${cwd}' && git add package.json package-lock.json && git commit -m fixture`;
  const result = await executeInWorkspaceSandbox(command, cwd, 30000);
  expect(result.result?.exitCode, result.result?.stderr).toBe(0);
  expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd, encoding: 'utf8' }).trim()).toBe('fixture');
});

it('une commande non Git suivant un saut de ligne ne peut pas écrire dans les métadonnées Git', async () => {
  const cwd = fixture();
  if (!readiness.ready) return;
  const command = `git add package.json\nnode -e "require('node:fs').writeFileSync('.git/smuggled', 'denied')"`;
  const result = await executeInWorkspaceSandbox(command, cwd, 30000);
  expect(result.result?.exitCode).not.toBe(0);
  expect(fs.existsSync(path.join(cwd, '.git/smuggled'))).toBe(false);
});

it.each(['git log --oneline -1', 'git status --short', 'git diff --stat', 'node -e "console.log(1)"'])('explique avant exécution la séparation de la mutation Git et de %s', async verification => {
  const cwd = fixture();
  const tool = new BashTool();
  try {
    const command = `cd '${cwd}' && git add package.json && git commit -m fixture && ${verification}`;
    const decision = await evaluateShellExecution(command, cwd);
    expect(decision.capabilityRefusal).toContain('Separate');
    expect(decision.capabilityRefusal).toContain('git add');
    const result = await tool.execute(command, 30000, cwd);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Separate');
    expect(result.error).not.toContain('Read-only file system');
    expect(fs.existsSync(path.join(cwd, '.git/index'))).toBe(false);
  } finally { tool.dispose(); }
});

it.each([
  '-c user.name=Test -c user.email=test@example.invalid commit -m fixture',
  '-cuser.name=Test commit -m fixture',
  '-c core.hooksPath=/tmp/forbidden-hooks commit -m fixture',
  '-c user.name=Test add package.json',
])('explique le refus des options globales de configuration Git : %s', async operation => {
  const cwd = fixture();
  const tool = new BashTool();
  try {
    const command = `cd '${cwd}' && git ${operation}`;
    const decision = await evaluateShellExecution(command, cwd);
    expect(decision.capabilityRefusal).toContain('without global -c');
    const result = await tool.execute(command, 30000, cwd);
    expect(result.success).toBe(false);
    expect(result.error).toContain('git commit');
    expect(result.error).toContain('No command was executed');
    expect(result.error).not.toContain('Read-only file system');
    expect(fs.existsSync(path.join(cwd, '.git/index'))).toBe(false);
  } finally { tool.dispose(); }
});
