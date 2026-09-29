import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-14`;
  const previous = { home: process.env.HOME, profile: process.env.USERPROFILE };
  process.env.HOME = `${root}/home`;
  process.env.USERPROFILE = `${root}/home`;
  return { root, home: `${root}/home`, previous };
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';
import { findCredentialPathInCommand } from '../../src/tools/bash/command-validator.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

const clean = path.join(qa.root, 'clean');
const protectedRepo = path.join(qa.root, 'protected');
const token = 'FAKE-OAUTH-REPRISE-14';

beforeAll(() => {
  fs.mkdirSync(path.join(qa.home, '.codebuddy'), { recursive: true });
  fs.writeFileSync(path.join(qa.home, '.codebuddy', 'codex-auth.json'),
    JSON.stringify({ access_token: token }));
  fs.mkdirSync(clean, { recursive: true });
  fs.mkdirSync(protectedRepo, { recursive: true });
  execFileSync('git', ['init', '-q', clean], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
  fs.writeFileSync(path.join(clean, 'notes.txt'), 'PUBLIC=example\n');
  execFileSync('git', ['-C', clean, 'add', 'notes.txt']);
  execFileSync('git', ['-C', clean, '-c', 'user.name=Essai',
    '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'public']);
  execFileSync('git', ['init', '-q', protectedRepo], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
  fs.writeFileSync(path.join(protectedRepo, '.env'), 'FAKE_TRACKED=example\n');
  execFileSync('git', ['-C', protectedRepo, 'add', '.env']);
  execFileSync('git', ['-C', protectedRepo, '-c', 'user.name=Essai',
    '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'secret factice']);
  ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previous.home === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previous.home;
  if (qa.previous.profile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previous.profile;
});

describe('execute_code ne lit pas le profil de l’hôte', () => {
  it.each([
    ['javascript', "import fs from 'node:fs'; console.log(fs.readFileSync(process.env.HOME + '/.codebuddy/codex-auth.json', 'utf8'))"],
    ['python', 'import os; print(open(os.path.expanduser("~/.codebuddy/codex-auth.json")).read())'],
    ['shell', 'cat "$HOME/.codebuddy/codex-auth.json"'],
  ] as const)('refuse le jeton via %s dans un dépôt propre', async (language, code) => {
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const result = await registry.execute('execute_code', { language, code }, { cwd: clean });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.success).toBe(false);
  });

  it('refuse aussi le jeton dans un dépôt à secret suivi', async () => {
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const result = await registry.execute('execute_code', {
      language: 'javascript',
      code: "import fs from 'node:fs'; console.log(fs.readFileSync(process.env.HOME + '/.codebuddy/codex-auth.json', 'utf8'))",
    }, { cwd: protectedRepo });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.success).toBe(false);
  });

  it('refuse un HOME fourni par l’appelant et un chemin absolu connu', async () => {
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const result = await registry.execute('execute_code', {
      language: 'javascript',
      env: { HOME: qa.home, USERPROFILE: qa.home },
      code: `import fs from 'node:fs'; console.log(fs.readFileSync(${JSON.stringify(path.join(qa.home, '.codebuddy', 'codex-auth.json'))}, 'utf8'))`,
    }, { cwd: clean });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each([
    ['javascript', 'console.log(6 * 7)'],
    ['typescript', 'const answer: number = 6 * 7; console.log(answer)'],
  ] as const)('conserve un calcul %s local quand le confinement existe', async (language, code) => {
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const result = await registry.execute('execute_code', {
      language, code,
    }, { cwd: clean });
    if (result.success) expect(result.output).toContain('42');
    else expect(result.error ?? result.output).toMatch(/confinement|sandbox|Landlock|seccomp/i);
  });
});

describe('Git échappé depuis un dépôt frère', () => {
  it.each([
    'g\\it -C ../protected show',
    '\\g\\i\\t -C ../protected show',
    'env g\\it -C ../protected show',
  ])('refuse %s avant tout lancement', (command) => {
    expect(findCredentialPathInCommand(command, process.platform, clean)).not.toBeNull();
  });

  it('refuse dans le vrai BashTool avant le bac à sable natif', async () => {
    const result = await new BashTool().execute('g\\it -C ../protected show', 3000, clean);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Git invocation could not be checked/);
    expect(JSON.stringify(result)).not.toContain('FAKE_TRACKED=example');
  });
});
