/**
 * Régression de sécurité — `PYTHONPATH` ne doit JAMAIS être transmis aux
 * sous-processus lancés par l'agent (même classe d'attaque que `NODE_PATH` :
 * substitution de module).
 *
 * Chaînes réelles reproduites ici :
 *
 *   1. outil bash / sandbox OS (points de `spawn` de `bash-tool.ts:142`,
 *      `streaming-executor.ts:146`, `execution-policy.ts:52/250`) :
 *      process.env → getFilteredEnv() → ShellEnvPolicy.buildEnv() → spawn(env)
 *   2. actions de règles sensorielles (`sensory-action-executor.ts:44`) :
 *      process.env → buildFilteredSubprocessEnv() → spawn(env)
 *
 * Pourquoi c'est exploitable : `src/index.ts` charge le `.env` du répertoire de
 * lancement dans `process.env`. Un dépôt hostile posant
 * `PYTHONPATH=./.cache/py` faisait charger un faux `json.py` (ou n'importe quel
 * module importé) par TOUT `python3` lancé ensuite par l'agent — l'interpréteur
 * place les entrées de `PYTHONPATH` AVANT la bibliothèque standard dans
 * `sys.path`. L'agent lance réellement du Python : `web_scrape` (Scrapling),
 * `object_detect` (YOLO), `browser-use`, `camofox`, `yt-dlp`, `run_script`, et
 * toute commande `python3 …` passée à l'outil bash.
 *
 * Les cas ci-dessous exécutent un VRAI sous-processus `python3` et vérifient que
 * le module substitué ne s'exécute pas.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getFilteredEnv } from '../../src/tools/bash/command-validator.js';
import { getShellEnvPolicy, resetShellEnvPolicy } from '../../src/security/shell-env-policy.js';
import { SAFE_ENV_VARS } from '../../src/tools/bash/security-patterns.js';
import { BLOCKED_ENV_VARS, sanitizeEnvVars } from '../../src/security/env-blocklist.js';
import { buildFilteredSubprocessEnv } from '../../src/utils/subprocess-env.js';

const MARKER = 'CODEBUDDY_PYTHONPATH_INJECTION_MARKER';

/** `python3` disponible ? (sinon les cas « vrai sous-processus » sont ignorés) */
const PYTHON = (() => {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
})();

let snapshot: NodeJS.ProcessEnv;
let workDir: string;
/** Répertoire empoisonné (le faux module) — distinct du répertoire du script. */
let evilDir: string;
/** Répertoire du script victime. */
let scriptDir: string;
let scriptPath: string;

/** Environnement exactement tel que l'outil bash le passe à `spawn`. */
function subprocessEnv(): NodeJS.ProcessEnv {
  return getShellEnvPolicy().buildEnv(getFilteredEnv());
}

beforeEach(() => {
  snapshot = { ...process.env };
  resetShellEnvPolicy();
  workDir = mkdtempSync(join(tmpdir(), 'cb-pythonpath-injection-'));
  evilDir = join(workDir, 'evil');
  scriptDir = join(workDir, 'script');
  mkdirSync(evilDir);
  mkdirSync(scriptDir);
  // Faux module standard : chargé uniquement si PYTHONPATH est hérité.
  writeFileSync(join(evilDir, 'json.py'), `print('${MARKER}')\n`);
  scriptPath = join(scriptDir, 'victime.py');
  writeFileSync(scriptPath, 'import json\nprint("script ok")\n');
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k];
  Object.assign(process.env, snapshot);
  resetShellEnvPolicy();
  rmSync(workDir, { recursive: true, force: true });
});

function runVictim(env: NodeJS.ProcessEnv): string {
  const res = spawnSync(PYTHON as string, [scriptPath], {
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
    cwd: scriptDir,
  });
  return `${res.stdout ?? ''}${res.stderr ?? ''}`;
}

describe('substitution de module par PYTHONPATH — chaîne outil bash', () => {
  it('ne laisse pas PYTHONPATH traverser la politique d\'environnement', () => {
    process.env.PYTHONPATH = '/tmp/evil-modules';
    expect(subprocessEnv().PYTHONPATH).toBeUndefined();
  });

  it.skipIf(!PYTHON)(
    'n\'exécute pas un faux module stdlib planté via PYTHONPATH hérité (vrai sous-processus python)',
    () => {
      process.env.PYTHONPATH = evilDir;
      // Contrôle : avec l'environnement brut, l'injection fonctionne bien.
      expect(runVictim({ ...process.env })).toContain(MARKER);
      // Avec l'environnement réellement passé par l'agent, elle ne doit plus passer.
      expect(runVictim(subprocessEnv())).not.toContain(MARKER);
    },
  );

  it('PYTHONPATH est retiré de l\'allowlist et présent dans la liste bloquée', () => {
    expect(SAFE_ENV_VARS.has('PYTHONPATH')).toBe(false);
    expect(BLOCKED_ENV_VARS.has('PYTHONPATH')).toBe(true);
    expect(sanitizeEnvVars({ PYTHONPATH: '/tmp/evil-modules' })).not.toHaveProperty('PYTHONPATH');
  });
});

describe('substitution de module par PYTHONPATH — chaîne actions sensorielles', () => {
  it('buildFilteredSubprocessEnv ne transmet pas PYTHONPATH', () => {
    process.env.PYTHONPATH = '/tmp/evil-modules';
    expect(buildFilteredSubprocessEnv().PYTHONPATH).toBeUndefined();
  });

  it.skipIf(!PYTHON)(
    'n\'exécute pas le faux module dans un vrai sous-processus python (chaîne sensorielle)',
    () => {
      process.env.PYTHONPATH = evilDir;
      expect(runVictim(buildFilteredSubprocessEnv())).not.toContain(MARKER);
    },
  );

  it('LD_LIBRARY_PATH (substitution de bibliothèque partagée) ne passe pas non plus', () => {
    process.env.LD_LIBRARY_PATH = '/tmp/evil-libs';
    expect(buildFilteredSubprocessEnv().LD_LIBRARY_PATH).toBeUndefined();
    expect(subprocessEnv().LD_LIBRARY_PATH).toBeUndefined();
    expect(BLOCKED_ENV_VARS.has('LD_LIBRARY_PATH')).toBe(true);
    expect(BLOCKED_ENV_VARS.has('LD_PRELOAD')).toBe(true);
  });
});

describe('cousines de PYTHONPATH : injection de code à l\'interpréteur', () => {
  it.each(['PYTHONSTARTUP', 'PYTHONHOME', 'PYTHONBREAKPOINT'])(
    '%s ne traverse aucune des deux chaînes',
    (name) => {
      process.env[name] = '/tmp/evil';
      expect(subprocessEnv()[name]).toBeUndefined();
      expect(buildFilteredSubprocessEnv()[name]).toBeUndefined();
    },
  );

  it.each(['PERL5LIB', 'RUBYLIB', 'RUBYOPT', 'GEM_PATH', 'GEM_HOME'])(
    '%s ne traverse aucune des deux chaînes (absent des allowlists)',
    (name) => {
      process.env[name] = '/tmp/evil';
      expect(SAFE_ENV_VARS.has(name)).toBe(false);
      expect(subprocessEnv()[name]).toBeUndefined();
      expect(buildFilteredSubprocessEnv()[name]).toBeUndefined();
    },
  );
});

describe('non-régression : les variables Python légitimes passent toujours', () => {
  it('laisse passer PYTHONIOENCODING, VIRTUAL_ENV et PATH', () => {
    process.env.PYTHONIOENCODING = 'utf-8';
    process.env.VIRTUAL_ENV = '/home/user/.venv';
    process.env.PATH = '/usr/bin:/bin';
    const env = subprocessEnv();
    expect(env.PYTHONIOENCODING).toBe('utf-8');
    expect(env.VIRTUAL_ENV).toBe('/home/user/.venv');
    expect(env.PATH).toBe('/usr/bin:/bin');
  });

  it.skipIf(!PYTHON)('un script python normal continue de s\'exécuter', () => {
    delete process.env.PYTHONPATH;
    expect(runVictim(subprocessEnv())).toContain('script ok');
  });
});
