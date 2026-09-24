/**
 * Isolation du HOME par fichier de test (tests/setup/home-isolation.ts, incident du 24/09/2026).
 * Aucune assertion ne touche le HOME appelant : seules des comparaisons de chaînes le nomment.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Import statique : le chemin du jeton est figé au chargement du module, comme lors de l'incident.
import { getCodexAuthFilePath } from '../../src/providers/codex-oauth.js';
import {
  CALLER_HOME_ENV,
  callerPlaywrightBrowsersPath,
  canonicalPath,
  isSameOrInside,
  isolatedHomeEnv,
} from '../setup/home-isolation.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const callerHome = process.env[CALLER_HOME_ENV] ?? '';

describe('HOME jetable posé avant les imports', () => {
  it('os.homedir() est un dossier jetable distinct du HOME appelant', () => {
    expect(callerHome).not.toBe('');
    expect(canonicalPath(os.homedir())).not.toBe(canonicalPath(callerHome));
    expect(path.basename(os.homedir())).toBe('home');
    expect(path.basename(path.dirname(os.homedir()))).toMatch(/^codebuddy-vitest-/);
    expect(process.env.USERPROFILE).toBe(process.env.HOME);
    for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
      expect(isSameOrInside(process.env[key] ?? '/', os.homedir())).toBe(true);
    }
  });

  it('un chemin figé au chargement d’un module (jeton Codex de /logout) tombe dans le HOME jetable', () => {
    const authPath = getCodexAuthFilePath();
    expect(authPath).toBe(path.join(os.homedir(), '.codebuddy', 'codex-auth.json'));
    expect(authPath).not.toBe(path.join(callerHome, '.codebuddy', 'codex-auth.json'));
  });

  it('CODEBUDDY_HOME est jetable et hors du profil appelant', () => {
    const profile = process.env.CODEBUDDY_HOME ?? '';
    expect(profile).not.toBe('');
    expect(isSameOrInside(profile, path.join(callerHome, '.codebuddy'))).toBe(false);
  });

  it('un processus enfant hérite du HOME jetable', () => {
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("os").homedir())'], {
      encoding: 'utf8',
    });
    expect(child.status).toBe(0);
    expect(canonicalPath(child.stdout)).toBe(canonicalPath(os.homedir()));
  });

  it('git utilise une identité neutre du HOME jetable', () => {
    const gitconfig = fs.readFileSync(path.join(os.homedir(), '.gitconfig'), 'utf8');
    expect(gitconfig).toContain('tests@example.invalid');
  });
});

describe('fonctions de comparaison et d’environnement', () => {
  it('isSameOrInside ne confond pas un préfixe de nom avec un parent', () => {
    expect(isSameOrInside('/a/b', '/a/b', 'linux')).toBe(true);
    expect(isSameOrInside('/a/b/c', '/a/b', 'linux')).toBe(true);
    expect(isSameOrInside('/a/bc', '/a/b', 'linux')).toBe(false);
  });

  it('Windows : comparaison sans casse', () => {
    expect(isSameOrInside('C:\\Users\\Runner\\X', 'c:\\users\\runner', 'win32')).toBe(true);
    expect(isSameOrInside('C:\\Users\\RunnerX', 'c:\\users\\runner', 'win32')).toBe(false);
  });

  it('Windows : HOMEDRIVE, HOMEPATH et APPDATA suivent le HOME jetable', () => {
    const env = isolatedHomeEnv('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\codebuddy-vitest-x\\home', 'win32');
    expect(env.USERPROFILE).toBe(env.HOME);
    expect(env.HOMEDRIVE).toBe('C:');
    expect(env.HOMEPATH).toBe('\\Users\\RUNNER~1\\AppData\\Local\\Temp\\codebuddy-vitest-x\\home');
    expect(env.APPDATA).toBe('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\codebuddy-vitest-x\\home\\AppData\\Roaming');
    expect(env.LOCALAPPDATA).toBeUndefined();
  });

  it('POSIX : pas de variable Windows', () => {
    const env = isolatedHomeEnv('/tmp/x/home', 'linux');
    expect(env.HOMEDRIVE).toBeUndefined();
    expect(env.APPDATA).toBeUndefined();
  });

  it('Playwright garde les navigateurs de l’appelant', () => {
    expect(callerPlaywrightBrowsersPath({}, '/home/runner', 'linux')).toBe('/home/runner/.cache/ms-playwright');
    expect(callerPlaywrightBrowsersPath({ XDG_CACHE_HOME: '/c' }, '/home/runner', 'linux')).toBe('/c/ms-playwright');
    expect(callerPlaywrightBrowsersPath({}, '/Users/r', 'darwin')).toBe('/Users/r/Library/Caches/ms-playwright');
    expect(callerPlaywrightBrowsersPath({}, 'C:\\Users\\r', 'win32')).toBeUndefined();
    expect(callerPlaywrightBrowsersPath({ PLAYWRIGHT_BROWSERS_PATH: '/p' }, '/home/runner', 'linux')).toBeUndefined();
  });
});

describe('garde : un test qui rend le HOME appelant échoue fort', () => {
  it('la garde du setup arrête un fichier dont le HOME redevient celui de l’appelant', () => {
    // Fichier et config jetables : un beforeAll remet HOME sur le HOME appelant, le test ne doit pas s'exécuter.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-garde-home-'));
    try {
      // Le fichier jetable doit résoudre `vitest` depuis le dépôt.
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
      const fixture = path.join(dir, 'garde.fixture.ts');
      fs.writeFileSync(
        fixture,
        [
          "import { beforeAll, it } from 'vitest';",
          'beforeAll(() => {',
          `  process.env.HOME = process.env.${CALLER_HOME_ENV};`,
          `  process.env.USERPROFILE = process.env.${CALLER_HOME_ENV};`,
          '});',
          "it('corps du test', () => { console.log('CORPS_EXECUTE'); });",
          '',
        ].join('\n'),
      );
      const config = path.join(dir, 'vitest.garde.config.mjs');
      fs.writeFileSync(
        config,
        [
          "import { defineConfig } from 'vitest/config';",
          'export default defineConfig({ test: {',
          `  root: ${JSON.stringify(dir)},`,
          "  include: ['garde.fixture.ts'],",
          `  setupFiles: [${JSON.stringify(path.join(REPO_ROOT, 'tests', 'setup', 'home-isolation.ts'))}],`,
          '} });',
          '',
        ].join('\n'),
      );
      const run = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', config],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
      );
      const output = `${run.stdout}\n${run.stderr}`;
      expect(output).toContain('garde Vitest (HOME isolé)');
      expect(output).toContain('au début du test');
      expect(output).not.toContain('CORPS_EXECUTE');
      expect(run.status).not.toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
