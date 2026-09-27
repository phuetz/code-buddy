/**
 * « Exporter le site » d'App Studio (main process).
 *
 * L'export zip livre les SOURCES ; bolt.new publie un site. Pour un
 * utilisateur local, l'équivalent utile est le site CONSTRUIT, prêt à poser
 * sur n'importe quel hébergement statique (ou à ouvrir hors ligne) :
 * - projet npm avec script `build` : `npm run build`, puis copie du dossier
 *   de sortie (dist, build, out) ;
 * - site statique : copie des fichiers du projet (sans node_modules, .git,
 *   .codebuddy à aucun niveau).
 * Aucun fichier `.env`/`.env.*` n'est jamais copié, ni d'un site statique ni
 * d'un dossier construit.
 * La copie va dans `<dossier choisi>/<nom du projet>-site` (jamais d'écrasement
 * silencieux : un suffixe numérique est ajouté si le dossier existe).
 * Le lanceur de build et la boîte de dialogue sont injectés (testables).
 *
 * @module main/studio/site-export-service
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

import { buildStudioChildEnv, killProcessTree, killableSpawnOptions } from './child-env.js';
import { assertTrustedRoot } from './studio-versions-service.js';

export interface SiteExportResult {
  savedTo: string;
  kind: 'build' | 'static';
  files: number;
  buildLog?: string[];
}

export type SiteExportOutcome =
  | { ok: true; data: SiteExportResult }
  | { ok: false; canceled?: boolean; error: string; buildLog?: string[] };

export interface SiteExportDeps {
  trustedRoots?: () => string[];
  chooseDirectory: (defaultPath: string) => Promise<string | null>;
  /** Lanceur du build ; reçoit les variables du projet quand `resolveProjectEnv` est fourni. */
  runBuild?: (cwd: string, extraEnv?: Record<string, string>) => Promise<{ code: number | null; output: string[] }>;
  /**
   * Variables propres au projet (ses secrets, par ex.) ajoutées par-dessus
   * l'environnement minimal du build : les clés de l'hôte n'y arrivent jamais.
   */
  resolveProjectEnv?: (root: string) => Promise<Record<string, string>>;
}

const BUILD_OUTPUT_DIRS = ['dist', 'build', 'out'];
/** Exclus au PREMIER niveau d'un site statique (sorties de build). */
const STATIC_TOP_EXCLUDES = new Set(['.studio-probe-dist', 'dist', 'build']);
/** Exclus à TOUT niveau (dépendances, dépôts, état interne). */
const ANY_LEVEL_EXCLUDES = new Set(['node_modules', '.git', '.codebuddy']);
const BUILD_TIMEOUT_MS = 5 * 60_000;

/** `.env`, `.env.local`, `.env.production`… : secrets, jamais publiés. */
export function isEnvFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.');
}

/**
 * Faut-il copier `rel` (relatif à la source copiée) ? Les `.env*` ne sortent
 * jamais, quel que soit le niveau ; pour un site statique, on écarte aussi
 * node_modules/.git/.codebuddy à tout niveau et les sorties de build à la racine.
 */
export function shouldCopySitePath(rel: string, kind: 'build' | 'static'): boolean {
  if (rel === '') return true;
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some(isEnvFileName)) return false;
  if (kind === 'build') return true;
  if (parts.some((part) => ANY_LEVEL_EXCLUDES.has(part))) return false;
  return !STATIC_TOP_EXCLUDES.has(parts[0] ?? '');
}

export interface NpmBuildOptions {
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
  /** Environnement de l'hôte dont on lit la liste blanche (défaut `process.env`). */
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * `npm run build` avec un environnement en liste blanche (jamais les clés de
 * l'hôte) ; au délai dépassé, tout l'arbre de processus est arrêté.
 */
export const runNpmBuild = (cwd: string, options: NpmBuildOptions = {}): Promise<{ code: number | null; output: string[] }> =>
  new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
    const output: string[] = [];
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd,
      shell: isWin,
      windowsHide: true,
      ...killableSpawnOptions(),
      env: buildStudioChildEnv({ ...options.extraEnv, CI: 'true', FORCE_COLOR: '0' }, options.baseEnv),
    });
    const push = (chunk: Buffer) => {
      output.push(...String(chunk).split(/\r?\n/).filter(Boolean));
      if (output.length > 400) output.splice(0, output.length - 400);
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    const timer = setTimeout(() => {
      output.push(`build interrompu après ${Math.round(timeoutMs / 1000)} s`);
      killProcessTree(child);
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      output.push(String(error));
      resolve({ code: null, output });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += await countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) n += 1;
  }
  return n;
}

async function freeTarget(parent: string, base: string): Promise<string> {
  let candidate = path.join(parent, base);
  for (let i = 2; await exists(candidate); i += 1) candidate = path.join(parent, `${base}-${i}`);
  return candidate;
}

export class SiteExportService {
  constructor(private readonly deps: SiteExportDeps) {}

  async exportSite(input: unknown): Promise<SiteExportOutcome> {
    try {
      const rootInput = (input as { root?: unknown } | null)?.root;
      const root = await assertTrustedRoot(rootInput, this.deps.trustedRoots);
      let source = root;
      let kind: SiteExportResult['kind'] = 'static';
      let buildLog: string[] | undefined;

      const pkgPath = path.join(root, 'package.json');
      if (await exists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
        if (!pkg.scripts?.build) {
          return { ok: false, error: 'Le projet n’a pas de script « build » dans package.json.' };
        }
        const extraEnv = this.deps.resolveProjectEnv
          ? await this.deps.resolveProjectEnv(root).catch(() => ({}))
          : undefined;
        const runBuild =
          this.deps.runBuild ?? ((dir: string, env?: Record<string, string>) => runNpmBuild(dir, { extraEnv: env }));
        const run = await (extraEnv ? runBuild(root, extraEnv) : runBuild(root));
        buildLog = run.output.slice(-40);
        if (run.code !== 0) {
          return { ok: false, error: `npm run build a échoué (code ${run.code ?? 'null'}).`, buildLog };
        }
        let found: string | null = null;
        for (const dir of BUILD_OUTPUT_DIRS) {
          if (await exists(path.join(root, dir, 'index.html'))) {
            found = path.join(root, dir);
            break;
          }
        }
        if (!found) {
          return { ok: false, error: 'Build réussi mais aucun dossier de sortie avec index.html (dist, build, out).', buildLog };
        }
        source = found;
        kind = 'build';
      } else if (!(await exists(path.join(root, 'index.html')))) {
        return { ok: false, error: 'Ni package.json ni index.html : rien à exporter comme site.' };
      }

      const parent = await this.deps.chooseDirectory(path.dirname(root));
      if (!parent) return { ok: false, canceled: true, error: 'annulé' };
      const target = await freeTarget(parent, `${path.basename(root) || 'projet'}-site`);
      const inside = path.relative(root, target);
      if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
        return { ok: false, error: 'Choisis un dossier HORS du projet pour y exporter le site.' };
      }
      await fs.cp(source, target, {
        recursive: true,
        dereference: false,
        filter: (src) => shouldCopySitePath(path.relative(source, src), kind),
      });
      return { ok: true, data: { savedTo: target, kind, files: await countFiles(target), ...(buildLog ? { buildLog } : {}) } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
