import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../fixtures/b-audit-python-heredoc.json';
import { parseBashCommand } from '../../src/security/bash-parser.js';
import { evaluateShellExecution, executeInWorkspaceSandbox } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

afterEach(() => { vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); });

it('rejoue le heredoc littéral de B sans confondre le script Python avec le shell', async (context) => {
  parseBashCommand(':');
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!parseBashCommand(':').usedTreeSitter) context.skip();
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,npm-registry');
  getPermissionModeManager().setMode('dontAsk');
  const decision = await evaluateShellExecution(fixture.command.replace('WORKSPACE_PLACEHOLDER', process.cwd()), process.cwd());
  expect(decision.parsedSegments.map(argv => argv[0])).toEqual(['cd', 'npm', 'python3']);
  expect(decision.simpleSequence).toBe(true);
  expect(decision.action).toBe('sandbox');
});

it('ne classe pas comme shell les substitutions écrites dans un heredoc cité', async (context) => {
  parseBashCommand(':');
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!parseBashCommand(':').usedTreeSitter) context.skip();
  const decision = await evaluateShellExecution("node - <<'JS'\nconsole.log('$(rm -rf /)');\nJS\n", process.cwd());
  expect(decision.parsedSegments.map(argv => argv[0])).toEqual(['node']);
  expect(decision.action).toBe('sandbox');
});

it.each([
  "npm audit --json | node - <<JS\n$(rm -rf /)\nJS\n",
  "npm audit --json | node - <<'JS'\nconsole.log('x');\nJS\nrm -rf /",
  "npm audit --json | node - <<'JS'\nconsole.log('x');\n",
])('ne transmet pas le grant npm à un heredoc expansible, incomplet ou suivi d’un refus dur', async (command) => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,npm-registry');
  getPermissionModeManager().setMode('dontAsk');
  expect((await evaluateShellExecution(command, process.cwd())).action).not.toBe('sandbox');
});

it.skipIf(process.platform !== 'linux')('exécute le vrai script littéral et garde les métadonnées Git en lecture seule', async () => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,git-local');
  getPermissionModeManager().setMode('dontAsk');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'heredoc-native-'));
  fs.mkdirSync(path.join(workspace, '.git'));
  const config = path.join(workspace, '.git', 'config');
  fs.writeFileSync(config, 'protected metadata');
  try {
    const command = "node - <<'JS'\nconst fs = require('node:fs');\nconsole.log('LITERAL_BODY_EXECUTED');\ntry { fs.writeFileSync('.git/config', 'smuggled'); process.exitCode = 10; } catch { console.log('GIT_WRITE_DENIED'); }\nJS\n";
    const execution = await executeInWorkspaceSandbox(command, workspace, 30000);
    expect(execution.available, execution.reason).toBe(true);
    expect(execution.result?.sandboxed).toBe(true);
    expect(execution.result?.exitCode, execution.result?.stderr).toBe(0);
    expect(execution.result?.stdout).toContain('LITERAL_BODY_EXECUTED');
    expect(execution.result?.stdout).toContain('GIT_WRITE_DENIED');
    expect(fs.readFileSync(config, 'utf8')).toBe('protected metadata');
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
