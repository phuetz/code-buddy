/**
 * Régression de sécurité — `NODE_OPTIONS` / `NODE_PATH` ne doivent JAMAIS être
 * transmis aux sous-processus lancés par l'agent.
 *
 * Chaîne réelle reproduite ici (identique à celle des points de `spawn` de
 * `bash-tool.ts:142`, `streaming-executor.ts:146`, `execution-policy.ts:52/250`) :
 *
 *     process.env  →  getFilteredEnv()  →  ShellEnvPolicy.buildEnv()  →  spawn(env)
 *
 * Pourquoi c'est exploitable : `src/index.ts:176` charge le `.env` du répertoire
 * de lancement dans `process.env`. Un dépôt hostile (ou n'importe quelle écriture
 * dans `.env`) posant `NODE_OPTIONS=--require ./evil.js` faisait exécuter du
 * JavaScript arbitraire par TOUT sous-processus `node`/`npm` déclenché par
 * l'agent, avant même le code visé. `NODE_PATH` permet le même détournement par
 * substitution de module.
 *
 * Les deux cas ci-dessous exécutent un VRAI sous-processus `node` et vérifient
 * que le marqueur d'injection n'apparaît pas.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getFilteredEnv } from '../../src/tools/bash/command-validator.js';
import { getShellEnvPolicy, resetShellEnvPolicy } from '../../src/security/shell-env-policy.js';
import { SAFE_ENV_VARS } from '../../src/tools/bash/security-patterns.js';
import { BLOCKED_ENV_VARS, sanitizeEnvVars } from '../../src/security/env-blocklist.js';

const MARKER = 'CODEBUDDY_ENV_INJECTION_MARKER';

let snapshot: NodeJS.ProcessEnv;
let workDir: string;

/** Environnement exactement tel que l'agent le passe à `spawn`. */
function subprocessEnv(): NodeJS.ProcessEnv {
  return getShellEnvPolicy().buildEnv(getFilteredEnv());
}

beforeEach(() => {
  snapshot = { ...process.env };
  resetShellEnvPolicy();
  workDir = mkdtempSync(join(tmpdir(), 'cb-env-injection-'));
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k];
  Object.assign(process.env, snapshot);
  resetShellEnvPolicy();
  rmSync(workDir, { recursive: true, force: true });
});

describe('injection par NODE_OPTIONS', () => {
  it('ne laisse pas NODE_OPTIONS traverser la politique d\'environnement', () => {
    process.env.NODE_OPTIONS = '--require /tmp/evil.js';
    expect(subprocessEnv().NODE_OPTIONS).toBeUndefined();
  });

  it('n\'exécute pas le script d\'un --require hérité dans un vrai sous-processus node', () => {
    const evil = join(workDir, 'evil.cjs');
    writeFileSync(evil, `process.stdout.write('${MARKER}\\n');\n`);
    process.env.NODE_OPTIONS = `--require ${evil}`;

    const res = spawnSync(process.execPath, ['-e', 'void 0'], {
      env: subprocessEnv() as NodeJS.ProcessEnv,
      encoding: 'utf8',
      cwd: workDir,
    });

    expect(`${res.stdout ?? ''}${res.stderr ?? ''}`).not.toContain(MARKER);
  });

  it('NODE_OPTIONS est retiré de l\'allowlist et présent dans la liste bloquée', () => {
    expect(SAFE_ENV_VARS.has('NODE_OPTIONS')).toBe(false);
    expect(BLOCKED_ENV_VARS.has('NODE_OPTIONS')).toBe(true);
    expect(sanitizeEnvVars({ NODE_OPTIONS: '--require /tmp/evil.js' })).not.toHaveProperty('NODE_OPTIONS');
  });
});

describe('détournement par NODE_PATH', () => {
  it('ne laisse pas NODE_PATH traverser la politique d\'environnement', () => {
    process.env.NODE_PATH = '/tmp/evil-modules';
    expect(subprocessEnv().NODE_PATH).toBeUndefined();
  });

  it('ne permet pas de résoudre un module planté via NODE_PATH hérité', () => {
    writeFileSync(join(workDir, 'evilmod.js'), `process.stdout.write('${MARKER}\\n');\n`);
    process.env.NODE_PATH = workDir;

    const res = spawnSync(
      process.execPath,
      ['-e', "try { require('evilmod'); } catch { process.stdout.write('MODULE_NOT_FOUND'); }"],
      { env: subprocessEnv() as NodeJS.ProcessEnv, encoding: 'utf8', cwd: tmpdir() },
    );

    expect(`${res.stdout ?? ''}${res.stderr ?? ''}`).not.toContain(MARKER);
  });

  it('NODE_PATH est retiré de l\'allowlist et présent dans la liste bloquée', () => {
    expect(SAFE_ENV_VARS.has('NODE_PATH')).toBe(false);
    expect(BLOCKED_ENV_VARS.has('NODE_PATH')).toBe(true);
  });
});

describe('non-régression : les variables Node légitimes passent toujours', () => {
  it('laisse passer NODE_ENV et PATH', () => {
    process.env.NODE_ENV = 'test';
    process.env.PATH = '/usr/bin:/bin';
    const env = subprocessEnv();
    expect(env.NODE_ENV).toBe('test');
    expect(env.PATH).toBe('/usr/bin:/bin');
  });
});
