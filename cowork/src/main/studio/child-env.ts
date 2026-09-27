/**
 * Environnement des processus enfants d'App Studio (main process).
 *
 * `vite build` et `npm run build` exécutent du code GÉNÉRÉ (config Vite,
 * scripts npm, plugins). Leur transmettre tout `process.env` y ferait fuiter
 * les clés de l'hôte (OPENAI_API_KEY, ANTHROPIC_API_KEY, JWT_SECRET…). On ne
 * garde qu'une liste blanche de variables nécessaires pour trouver les outils,
 * le cache npm, la locale et le proxy, puis on ajoute par-dessus les
 * variables propres au projet (`extra`).
 *
 * @module main/studio/child-env
 */

import { spawn } from 'child_process';

/** Variables de l'hôte transmises aux processus enfants (liste blanche). */
export const STUDIO_CHILD_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'SystemRoot',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'NODE_ENV',
  'npm_config_cache',
  'NPM_CONFIG_CACHE',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'DISPLAY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
];

/**
 * Environnement minimal pour un processus enfant d'App Studio : la liste
 * blanche lue dans `base`, puis `extra` fusionné par-dessus.
 */
export function buildStudioChildEnv(
  extra?: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of STUDIO_CHILD_ENV_ALLOWLIST) {
    const value = base[key];
    if (typeof value === 'string') env[key] = value;
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value === 'string') env[key] = value;
    }
  }
  return env;
}

/** Sous-ensemble d'un ChildProcess utile pour l'arrêter (injectable en test). */
export interface KillableChild {
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface KillTreeDeps {
  platform?: NodeJS.Platform;
  /** `process.kill` (un pid négatif vise tout le groupe de processus). */
  killPid?: (pid: number, signal: NodeJS.Signals) => void;
  /** Lance `taskkill` sous Windows. */
  runTaskkill?: (pid: number) => void;
  /** Délai avant SIGKILL sous POSIX (défaut 2000 ms). */
  graceMs?: number;
}

/**
 * Options de `spawn` pour un enfant qu'on devra pouvoir arrêter AVEC ses
 * descendants : sous POSIX, `detached` en fait le chef d'un groupe de
 * processus, que `killProcessTree` vise par pid négatif.
 */
export function killableSpawnOptions(platform: NodeJS.Platform = process.platform): { detached: boolean } {
  return { detached: platform !== 'win32' };
}

/**
 * Arrête un enfant et TOUT son arbre (vite, esbuild, scripts npm lancent des
 * petits-enfants qu'un simple `child.kill()` laisse orphelins) :
 * - Windows : `taskkill /pid <pid> /T /F` ;
 * - POSIX : SIGTERM au groupe (`-pid`), puis SIGKILL après `graceMs`.
 * L'enfant doit avoir été lancé avec `killableSpawnOptions()`.
 */
export function killProcessTree(child: KillableChild, deps: KillTreeDeps = {}): void {
  const pid = child.pid;
  const platform = deps.platform ?? process.platform;
  if (typeof pid !== 'number' || pid <= 0) {
    child.kill('SIGTERM');
    return;
  }
  if (platform === 'win32') {
    const runTaskkill =
      deps.runTaskkill ??
      ((target: number) => {
        const tk = spawn('taskkill', ['/pid', String(target), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        tk.on('error', () => child.kill());
      });
    try {
      runTaskkill(pid);
    } catch {
      child.kill();
    }
    return;
  }
  const killPid = deps.killPid ?? ((target: number, signal: NodeJS.Signals) => process.kill(target, signal));
  try {
    killPid(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const timer = setTimeout(() => {
    try {
      killPid(-pid, 'SIGKILL');
    } catch {
      /* groupe déjà terminé */
    }
  }, deps.graceMs ?? 2000);
  timer.unref?.();
}
