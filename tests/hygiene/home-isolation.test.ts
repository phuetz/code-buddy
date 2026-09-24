/**
 * Isolation du HOME par fichier de test (tests/setup/home-isolation.ts, incident du 24/09/2026).
 * Aucune assertion ne touche le HOME appelant : seules des comparaisons de chaînes le nomment.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Lance Vitest sur un fichier jetable avec le setup d'isolation (sans globalSetup : le HOME jetable
 * est créé sous `os.tmpdir()` du processus enfant). Renvoie la sortie brute et le code.
 */
function runWithIsolationSetup(fixtureLines: string[], env: NodeJS.ProcessEnv = process.env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-garde-home-'));
  try {
    // Le fichier jetable doit résoudre `vitest` depuis le dépôt.
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    fs.writeFileSync(path.join(dir, 'garde.fixture.ts'), [...fixtureLines, ''].join('\n'));
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
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000, env },
    );
    return { output: `${run.stdout}\n${run.stderr}`, status: run.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('HOME jetable posé avant les imports', () => {
  it('os.homedir() est un dossier jetable distinct du HOME appelant', () => {
    expect(callerHome).not.toBe('');
    expect(canonicalPath(os.homedir())).not.toBe(canonicalPath(callerHome));
    expect(path.basename(os.homedir())).toBe('home');
    expect(path.basename(path.dirname(os.homedir()))).toMatch(/^codebuddy-vitest-/);
    expect(process.env.USERPROFILE).toBe(process.env.HOME);
    for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
      expect(isSameOrInside(process.env[key] ?? '', os.homedir()), key).toBe(true);
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
    // XDG suit l'API de chemins de la plateforme visée, pas celle de l'hôte.
    expect(env.XDG_CONFIG_HOME).toBe(path.win32.join(env.HOME ?? '', '.config'));
    expect(env.XDG_CACHE_HOME).toBe(path.win32.join(env.HOME ?? '', '.cache'));
  });

  it('POSIX : pas de variable Windows', () => {
    const env = isolatedHomeEnv('/tmp/x/home', 'linux');
    expect(env.HOMEDRIVE).toBeUndefined();
    expect(env.APPDATA).toBeUndefined();
    expect(env.XDG_CONFIG_HOME).toBe(path.posix.join('/tmp/x/home', '.config'));
  });

  it('un chemin pas encore créé, sous un dossier atteint par un lien, est comparé à sa forme canonique', () => {
    // Même mécanisme que le nom court 8.3 du TEMP Windows (RUNNER~1) : le HOME existe et realpath le
    // développe, XDG_CONFIG_HOME n'existe pas encore. Une jonction ne demande pas de droit sous Windows.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-canon-'));
    try {
      const real = path.join(base, 'reel');
      fs.mkdirSync(path.join(real, 'home'), { recursive: true });
      const link = path.join(base, 'lien');
      fs.symlinkSync(real, link, 'junction');
      const home = path.join(link, 'home');
      expect(canonicalPath(path.join(home, '.config', 'absent'))).toBe(
        path.join(canonicalPath(home), '.config', 'absent'),
      );
      expect(isSameOrInside(path.join(home, '.config'), home)).toBe(true);
      expect(isSameOrInside(path.join(home, '.config'), path.join(real, 'home'))).toBe(true);
      expect(isSameOrInside(path.join(link, 'home2', '.config'), home)).toBe(false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('Playwright garde les navigateurs de l’appelant', () => {
    // Plateforme POSIX simulée : chemin POSIX quel que soit l'hôte (sous Windows, path.join rendait des « \\ »).
    expect(callerPlaywrightBrowsersPath({}, '/home/runner', 'linux')).toBe(
      path.posix.join('/home/runner', '.cache', 'ms-playwright'),
    );
    expect(callerPlaywrightBrowsersPath({ XDG_CACHE_HOME: '/c' }, '/home/runner', 'linux')).toBe(
      path.posix.join('/c', 'ms-playwright'),
    );
    expect(callerPlaywrightBrowsersPath({}, '/Users/r', 'darwin')).toBe(
      path.posix.join('/Users/r', 'Library', 'Caches', 'ms-playwright'),
    );
    expect(callerPlaywrightBrowsersPath({}, 'C:\\Users\\r', 'win32')).toBeUndefined();
    expect(callerPlaywrightBrowsersPath({ PLAYWRIGHT_BROWSERS_PATH: '/p' }, '/home/runner', 'linux')).toBeUndefined();
  });
});

describe('garde : un test qui rend le HOME appelant échoue fort', () => {
  it('la garde du setup arrête un fichier dont le HOME redevient celui de l’appelant', () => {
    // Un beforeAll remet HOME sur le HOME appelant : le test ne doit pas s'exécuter.
    const { output, status } = runWithIsolationSetup([
      "import { beforeAll, it } from 'vitest';",
      'beforeAll(() => {',
      `  process.env.HOME = process.env.${CALLER_HOME_ENV};`,
      `  process.env.USERPROFILE = process.env.${CALLER_HOME_ENV};`,
      '});',
      "it('corps du test', () => { console.log('CORPS_EXECUTE'); });",
    ]);
    expect(output).toContain('garde Vitest (HOME isolé)');
    expect(output).toContain('au début du test');
    expect(output).not.toContain('CORPS_EXECUTE');
    expect(status).not.toBe(0);
  }, 90_000);
});

describe('dossier temporaire atteint par un lien (comme le TEMP 8.3 des runners Windows)', () => {
  it('les XDG_* restent sous os.homedir() quand TMPDIR/TEMP passe par un lien', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-tmp-lien-'));
    try {
      const real = path.join(base, 'reel');
      fs.mkdirSync(real);
      const link = path.join(base, 'lien');
      fs.symlinkSync(real, link, 'junction');
      // Spécificateur d'import au format de Vite (« / » aussi sous Windows).
      const helpers = JSON.stringify(
        path.join(REPO_ROOT, 'tests', 'setup', 'home-isolation-paths.ts').split(path.sep).join('/'),
      );
      const { output, status } = runWithIsolationSetup(
        [
          "import os from 'node:os';",
          "import { expect, it } from 'vitest';",
          `import { isSameOrInside } from ${helpers};`,
          "it('xdg sous le home', () => {",
          `  expect(os.tmpdir().startsWith(${JSON.stringify(link)})).toBe(true);`,
          "  for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {",
          '    expect(isSameOrInside(process.env[k] ?? "", os.homedir()), k).toBe(true);',
          '  }',
          "  console.log('XDG_SOUS_HOME');",
          '});',
        ],
        // os.tmpdir() lit TMPDIR sous POSIX, TEMP/TMP sous Windows.
        // Sans le parent hérité du globalSetup, le HOME jetable de l'enfant est créé sous ce lien.
        { ...process.env, CODEBUDDY_VITEST_HOME_PARENT: '', TMPDIR: link, TEMP: link, TMP: link },
      );
      expect(output).toContain('XDG_SOUS_HOME');
      expect(status, output).toBe(0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 90_000);
});

describe('hôte Windows simulé : node:path vaut path.win32', () => {
  afterEach(() => {
    vi.doUnmock('node:path');
    vi.resetModules();
  });

  it('une plateforme POSIX simulée garde des chemins POSIX et compare en POSIX', async () => {
    vi.resetModules();
    vi.doMock('node:path', () => ({ ...path.win32, default: path.win32 }));
    const sim = await import('../setup/home-isolation-paths.js');
    expect(sim.callerPlaywrightBrowsersPath({}, '/home/runner', 'linux')).toBe(
      path.posix.join('/home/runner', '.cache', 'ms-playwright'),
    );
    expect(sim.callerPlaywrightBrowsersPath({}, '/Users/r', 'darwin')).toBe(
      path.posix.join('/Users/r', 'Library', 'Caches', 'ms-playwright'),
    );
    expect(sim.isolatedHomeEnv('/tmp/x/home', 'linux').XDG_CACHE_HOME).toBe(path.posix.join('/tmp/x/home', '.cache'));
    expect(sim.isSameOrInside('/a/b/c', '/a/b', 'linux')).toBe(true);
    expect(sim.isSameOrInside('/a/bc', '/a/b', 'linux')).toBe(false);
  });
});
