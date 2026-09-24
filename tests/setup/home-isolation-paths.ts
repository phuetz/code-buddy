/**
 * Fonctions pures de l'isolation du HOME (tests/setup/home-isolation.ts), sans effet de bord :
 * un test peut les recharger sous un `node:path` simulé (hôte Windows sur un poste Linux).
 *
 * `platform` désigne la plateforme dont on manipule les chemins. Elle choisit l'API de chemins
 * (`path.win32` ou `path.posix`), jamais le séparateur de l'hôte : sous Windows, une plateforme
 * POSIX simulée rend des chemins POSIX. Le système de fichiers n'est consulté que pour l'hôte.
 */
import fs from 'node:fs';
import path from 'node:path';

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

function realpathOrUndefined(p: string): string | undefined {
  try {
    return fs.realpathSync.native(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return undefined;
    }
  }
}

/**
 * Forme canonique de `p` : l'ancêtre existant le plus proche passe par `realpath` natif (liens
 * macOS, noms courts 8.3 Windows), la partie qui n'existe pas encore lui est rattachée telle
 * quelle. Sans cela, `XDG_CONFIG_HOME` (pas encore créé) garde la forme courte `RUNNER~1` du
 * TEMP Windows quand le HOME, lui, est développé : il ne serait plus « sous » le HOME.
 */
export function canonicalPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const api = pathApi(platform);
  let resolved = api.resolve(p);
  if (platform === process.platform) {
    const missing: string[] = [];
    for (let current = resolved; ; ) {
      const real = realpathOrUndefined(current);
      if (real !== undefined) {
        resolved = api.join(real, ...missing.reverse());
        break;
      }
      const parent = api.dirname(current);
      if (parent === current) break;
      missing.push(api.basename(current));
      current = parent;
    }
  }
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** `a` vaut `b` ou se trouve dessous (comparaison canonique). */
export function isSameOrInside(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const ca = canonicalPath(a, platform);
  const cb = canonicalPath(b, platform);
  const sep = pathApi(platform).sep;
  return ca === cb || ca.startsWith(cb.endsWith(sep) ? cb : cb + sep);
}

/** Variables d'environnement qui font de `home` le HOME du processus et de ses enfants. */
export function isolatedHomeEnv(home: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const api = pathApi(platform);
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: api.join(home, '.config'),
    XDG_DATA_HOME: api.join(home, '.local', 'share'),
    XDG_STATE_HOME: api.join(home, '.local', 'state'),
    XDG_CACHE_HOME: api.join(home, '.cache'),
  };
  if (platform === 'win32') {
    const parsed = path.win32.parse(home);
    env.HOMEDRIVE = parsed.root.replace(/[\\/]+$/, '');
    env.HOMEPATH = home.slice(env.HOMEDRIVE.length) || '\\';
    env.APPDATA = path.win32.join(home, 'AppData', 'Roaming');
  }
  return env;
}

/** Emplacement par défaut des navigateurs Playwright pour l'appelant (avant bascule). */
export function callerPlaywrightBrowsersPath(
  env: NodeJS.ProcessEnv,
  callerHome: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return undefined;
  if (platform === 'win32') return undefined; // %LOCALAPPDATA%\ms-playwright : LOCALAPPDATA n'est pas basculé.
  const api = pathApi(platform);
  if (platform === 'darwin') return api.join(callerHome, 'Library', 'Caches', 'ms-playwright');
  return api.join(env.XDG_CACHE_HOME || api.join(callerHome, '.cache'), 'ms-playwright');
}
