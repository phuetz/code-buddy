/**
 * Versions locales d'un projet App Studio (main process).
 *
 * bolt.new garde une version par prompt et restaure sans coût ; App Studio
 * affichait la chronologie GLOBALE des instantanés du moteur (clé = cwd du
 * processus, pas celui du projet) et n'en créait aucune pour un dossier qui
 * n'est pas un dépôt git — l'onglet « Versions » restait vide. Ce service tient
 * un historique PROPRE au projet, dans un dépôt git séparé
 * `<projet>/.codebuddy/studio-versions.git` (le `.git` éventuel de
 * l'utilisateur n'est jamais touché) :
 *
 * - `snapshot` : `git add -A` + commit si l'arbre a changé (sinon renvoie la
 *   version courante, sans doublon) ;
 * - `list` : versions récentes avec les fichiers touchés ;
 * - `restore` : instantané de l'état courant PUIS remise de l'arbre de la
 *   version choisie (`read-tree -u --reset`, qui retire aussi les fichiers
 *   créés depuis) PUIS commit — une restauration est donc elle-même annulable ;
 * - `revertPaths` : remet certains chemins dans leur état d'une version (sert
 *   aux fichiers verrouillés et au mode discussion) ;
 * - verrous : liste persistée dans `<projet>/.codebuddy/studio-locks.json`.
 *
 * Aucune commande shell : `execFile('git', …)` avec des arguments séparés.
 * Le lanceur est injectable pour les tests.
 *
 * @module main/studio/studio-versions-service
 */

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export interface StudioVersionChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface StudioVersion {
  id: string;
  label: string;
  createdAt: number;
  files: string[];
  changes: StudioVersionChange[];
}

export type VersionsResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface GitRun {
  (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ code: number; stdout: string; stderr: string }>;
}

const defaultGit: GitRun = (args, options) =>
  new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: options.cwd, env: options.env, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });

/** Dossier du dépôt de versions, relatif à la racine du projet. */
export const VERSIONS_GIT_DIR = path.join('.codebuddy', 'studio-versions.git');
export const LOCKS_FILE = path.join('.codebuddy', 'studio-locks.json');

/** Jamais versionnés : dépendances, sorties de build, état interne. */
export const VERSIONS_EXCLUDES = [
  'node_modules/',
  '.git/',
  '.codebuddy/',
  'dist/',
  'build/',
  '.next/',
  '.studio-probe-dist/',
  '.vite/',
  '*.log',
];

const MAX_LIST = 50;

/** Chemin relatif sûr : pas absolu, pas de remontée, pas d'octet nul. */
export function isSafeRelativePath(rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0')) return false;
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  const parts = rel.split(/[\\/]+/);
  return !parts.some((part) => part === '..');
}

function normalizeRel(rel: string): string {
  return rel.split(/[\\/]+/).filter(Boolean).join('/');
}

/** Analyse la sortie de `git log --format=@@%H%x1f%ct%x1f%s --name-status`. */
export function parseVersionLog(stdout: string): StudioVersion[] {
  const versions: StudioVersion[] = [];
  let current: StudioVersion | null = null;
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('@@')) {
      const [id, ts, ...rest] = line.slice(2).split('\x1f');
      current = { id: id ?? '', createdAt: Number(ts ?? 0) * 1000, label: rest.join('\x1f'), files: [], changes: [] };
      versions.push(current);
    } else if (line && current) {
      const [code = '', ...paths] = line.split('\t');
      const target = paths[paths.length - 1];
      if (!target) continue;
      const letter = code.charAt(0);
      const status: StudioVersionChange['status'] = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified';
      current.files.push(target);
      current.changes.push({ path: target, status });
    }
  }
  return versions;
}

/**
 * La racine demandée doit être (sous) l'un des espaces de travail de confiance
 * (dossiers des sessions, projet actif…), comme pour l'export zip : le
 * renderer ne peut pas faire versionner ou restaurer un dossier arbitraire.
 */
export async function assertTrustedRoot(root: unknown, trustedRoots?: () => string[]): Promise<string> {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) {
    throw new Error('invalid project directory');
  }
  const real = await fs.realpath(root);
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new Error('not a directory');
  if (trustedRoots) {
    const trusted = (
      await Promise.all(
        trustedRoots().map(async (candidate) => {
          try {
            return await fs.realpath(candidate);
          } catch {
            return null;
          }
        }),
      )
    ).filter((c): c is string => Boolean(c));
    const inside = trusted.some((candidate) => {
      const child = path.relative(candidate, real);
      return child === '' || (!child.startsWith('..') && !path.isAbsolute(child));
    });
    if (!inside) throw new Error('project is outside trusted workspaces');
  }
  return real;
}

export class StudioVersionsService {
  private readonly git: GitRun;
  private readonly trustedRoots: (() => string[]) | undefined;
  /** Sérialise les opérations par projet (deux instantanés simultanés se marchent dessus). */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(options: { git?: GitRun; trustedRoots?: () => string[] } = {}) {
    this.git = options.git ?? defaultGit;
    this.trustedRoots = options.trustedRoots;
  }

  /**
   * Opérations DESTRUCTIVES pour les fichiers du projet (restaurer, remettre des
   * chemins, écrire les verrous) : racine de confiance exigée. Les lectures et
   * l'instantané (qui n'écrit que sous .codebuddy/) acceptent un dossier pas
   * encore rattaché à une session — sinon l'état de départ d'une génération
   * (session pas encore créée) ne pourrait jamais être gardé.
   */
  private resolveRoot(root: unknown, destructive = true): Promise<string> {
    return assertTrustedRoot(root, destructive ? this.trustedRoots : undefined);
  }

  private env(root: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_DIR: path.join(root, VERSIONS_GIT_DIR),
      GIT_WORK_TREE: root,
      GIT_AUTHOR_NAME: 'App Studio',
      GIT_AUTHOR_EMAIL: 'app-studio@localhost',
      GIT_COMMITTER_NAME: 'App Studio',
      GIT_COMMITTER_EMAIL: 'app-studio@localhost',
      GIT_TERMINAL_PROMPT: '0',
    };
  }

  private async run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return this.git(['-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      env: this.env(root),
    });
  }

  private async must(root: string, args: string[]): Promise<string> {
    const r = await this.run(root, args);
    if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
    return r.stdout;
  }

  private serialize<T>(root: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(root) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(root, next);
    return next;
  }

  private async ensureRepo(root: string): Promise<void> {
    const gitDir = path.join(root, VERSIONS_GIT_DIR);
    let exists = true;
    try {
      await fs.access(path.join(gitDir, 'HEAD'));
    } catch {
      exists = false;
    }
    if (!exists) {
      await fs.mkdir(gitDir, { recursive: true });
      await this.must(root, ['init', '-q']);
    }
    await fs.mkdir(path.join(gitDir, 'info'), { recursive: true });
    await fs.writeFile(path.join(gitDir, 'info', 'exclude'), `${VERSIONS_EXCLUDES.join('\n')}\n`, 'utf8');
  }

  private async head(root: string): Promise<string | null> {
    const r = await this.run(root, ['rev-parse', '--verify', '-q', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  private async commitAll(root: string, label: string): Promise<{ id: string; changed: boolean }> {
    await this.must(root, ['add', '-A', '--', '.']);
    const head = await this.head(root);
    if (head) {
      const diff = await this.run(root, ['diff', '--cached', '--quiet', 'HEAD', '--']);
      if (diff.code === 0) return { id: head, changed: false };
    }
    const message = label.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Version';
    await this.must(root, ['commit', '-q', '--no-verify', '--allow-empty-message', '-m', message]);
    const id = await this.head(root);
    if (!id) throw new Error('commit produced no HEAD');
    return { id, changed: true };
  }

  async snapshot(rootInput: unknown, label: unknown): Promise<VersionsResult<{ id: string; changed: boolean }>> {
    try {
      const root = await this.resolveRoot(rootInput, false);
      return {
        ok: true,
        data: await this.serialize(root, async () => {
          await this.ensureRepo(root);
          return this.commitAll(root, typeof label === 'string' ? label : 'Version');
        }),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async list(rootInput: unknown): Promise<VersionsResult<StudioVersion[]>> {
    try {
      const root = await this.resolveRoot(rootInput, false);
      return {
        ok: true,
        data: await this.serialize(root, async () => {
          try {
            await fs.access(path.join(root, VERSIONS_GIT_DIR, 'HEAD'));
          } catch {
            return [];
          }
          if (!(await this.head(root))) return [];
          const out = await this.must(root, [
            'log',
            `-n${MAX_LIST}`,
            '--format=@@%H%x1f%ct%x1f%s',
            '--name-status',
          ]);
          return parseVersionLog(out);
        }),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async restore(rootInput: unknown, id: unknown): Promise<VersionsResult<{ id: string; backupId: string }>> {
    try {
      const root = await this.resolveRoot(rootInput);
      if (typeof id !== 'string' || !/^[0-9a-f]{7,64}$/i.test(id)) throw new Error('invalid version id');
      return {
        ok: true,
        data: await this.serialize(root, async () => {
          await this.ensureRepo(root);
          const backup = await this.commitAll(root, 'Avant restauration');
          await this.must(root, ['read-tree', '-u', '--reset', id]);
          const restored = await this.commitAll(root, `Restauration de ${id.slice(0, 7)}`);
          return { id: restored.id, backupId: backup.id };
        }),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Remet `paths` dans leur état de la version `id` : contenu d'origine, ou
   * suppression si le fichier n'existait pas. Renvoie les chemins réellement
   * remis (ceux qui différaient).
   */
  async revertPaths(rootInput: unknown, id: unknown, paths: unknown): Promise<VersionsResult<string[]>> {
    try {
      const root = await this.resolveRoot(rootInput);
      if (typeof id !== 'string' || !/^[0-9a-f]{7,64}$/i.test(id)) throw new Error('invalid version id');
      if (!Array.isArray(paths)) throw new Error('invalid paths');
      const rels = paths.filter((p): p is string => typeof p === 'string' && isSafeRelativePath(p)).map(normalizeRel);
      return {
        ok: true,
        data: await this.serialize(root, async () => {
          await this.ensureRepo(root);
          const reverted: string[] = [];
          for (const rel of rels) {
            const inVersion = (await this.run(root, ['cat-file', '-e', `${id}:${rel}`])).code === 0;
            const abs = path.join(root, rel);
            if (inVersion) {
              const original = await this.must(root, ['show', `${id}:${rel}`]);
              let current: string | null = null;
              try {
                current = await fs.readFile(abs, 'utf8');
              } catch {
                current = null;
              }
              if (current === original) continue;
              await this.must(root, ['checkout', id, '--', rel]);
              reverted.push(rel);
            } else {
              try {
                await fs.rm(abs, { force: false });
                reverted.push(rel);
              } catch {
                /* absent des deux côtés */
              }
            }
          }
          return reverted;
        }),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Chemins modifiés dans l'arbre de travail depuis la version `id` (ajouts, modifs, suppressions). */
  async changedSince(rootInput: unknown, id: unknown): Promise<VersionsResult<string[]>> {
    try {
      const root = await this.resolveRoot(rootInput, false);
      if (typeof id !== 'string' || !/^[0-9a-f]{7,64}$/i.test(id)) throw new Error('invalid version id');
      return {
        ok: true,
        data: await this.serialize(root, async () => {
          await this.ensureRepo(root);
          await this.must(root, ['add', '-A', '--', '.']);
          const out = await this.must(root, ['diff', '--cached', '--name-only', id, '--']);
          // L'index a été mis à jour pour le calcul ; on le remet sur HEAD pour ne rien figer.
          await this.run(root, ['reset', '-q']);
          return out.split('\n').map((l) => l.trim()).filter(Boolean);
        }),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getLocks(rootInput: unknown): Promise<VersionsResult<string[]>> {
    try {
      const root = await this.resolveRoot(rootInput, false);
      try {
        const raw = JSON.parse(await fs.readFile(path.join(root, LOCKS_FILE), 'utf8')) as { locked?: unknown };
        const locked = Array.isArray(raw.locked) ? raw.locked : [];
        return { ok: true, data: locked.filter((p): p is string => typeof p === 'string' && isSafeRelativePath(p)).map(normalizeRel) };
      } catch {
        return { ok: true, data: [] };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async setLocks(rootInput: unknown, paths: unknown): Promise<VersionsResult<string[]>> {
    try {
      const root = await this.resolveRoot(rootInput);
      if (!Array.isArray(paths)) throw new Error('invalid paths');
      const locked = [...new Set(paths.filter((p): p is string => typeof p === 'string' && isSafeRelativePath(p)).map(normalizeRel))].sort();
      await fs.mkdir(path.join(root, '.codebuddy'), { recursive: true });
      const target = path.join(root, LOCKS_FILE);
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ locked }, null, 2)}\n`, 'utf8');
      await fs.rename(tmp, target);
      return { ok: true, data: locked };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
