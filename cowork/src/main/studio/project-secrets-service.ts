/**
 * Secrets d'un projet App Studio (clés d'API, jetons…), à la manière de
 * l'onglet « Secrets » de bolt.new — mais en local et sans jamais sortir.
 *
 * Règles, toutes appliquées ici (processus principal) :
 * - les valeurs sont rangées HORS du dossier du projet (dossier de données de
 *   Cowork, un fichier 0600 par projet, nommé par le sha256 du chemin réel) :
 *   ni l'agent (qui lit le projet), ni les versions (`.codebuddy/…git`), ni
 *   l'export zip ne peuvent les voir ;
 * - le renderer ne reçoit jamais une valeur : seulement les noms et une
 *   longueur (`list`) ;
 * - elles n'entrent que dans l'environnement des processus du projet (serveur
 *   de dev, build) : Vite expose `VITE_*` lu dans `process.env` ;
 * - tout texte qui part vers le modèle, s'affiche ou se journalise passe par
 *   `redact`, qui masque aussi les valeurs d'un `.env*` déjà présent dans le
 *   projet ;
 * - aucune valeur n'est journalisée (le service n'écrit aucun journal de
 *   valeur ; les erreurs ne citent que le nom).
 *
 * @module main/studio/project-secrets-service
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertTrustedRoot } from './studio-versions-service.js';

export type SecretsResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SecretEntry {
  key: string;
  /** Longueur de la valeur (jamais la valeur). */
  length: number;
}

/** Remplacement affiché à la place d'une valeur secrète. */
export const REDACTED = '[secret masqué]';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_VALUE = 8 * 1024;
const MAX_KEYS = 100;
/** En dessous, une valeur est trop courte pour être masquée sans casser le texte. */
const MIN_REDACT_LENGTH = 4;
const PROJECT_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local'];

export function isValidSecretKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** Lit un fichier au format dotenv (KEY=valeur, # commentaires, guillemets simples). */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1] as string] = value;
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Masque chaque valeur (la plus longue d'abord : une valeur peut en contenir une autre). */
export function redactText(text: string, values: readonly string[]): string {
  if (!text) return text;
  const list = [...new Set(values.filter((v) => typeof v === 'string' && v.length >= MIN_REDACT_LENGTH))].sort(
    (a, b) => b.length - a.length,
  );
  let out = text;
  for (const value of list) {
    if (out.includes(value)) out = out.replace(new RegExp(escapeRegExp(value), 'g'), REDACTED);
  }
  return out;
}

export interface ProjectSecretsOptions {
  /** Dossier de stockage (hors projet), ex. `<userData>/studio-secrets`. */
  storeDir: string;
  trustedRoots?: () => string[];
}

export class ProjectSecretsService {
  private readonly storeDir: string;
  private readonly trustedRoots: (() => string[]) | undefined;

  constructor(options: ProjectSecretsOptions) {
    this.storeDir = options.storeDir;
    this.trustedRoots = options.trustedRoots;
  }

  private fileFor(realRoot: string): string {
    const id = createHash('sha256').update(realRoot).digest('hex').slice(0, 32);
    return path.join(this.storeDir, `${id}.json`);
  }

  private async readVars(realRoot: string): Promise<Record<string, string>> {
    try {
      const raw = JSON.parse(await fs.readFile(this.fileFor(realRoot), 'utf8')) as { vars?: unknown };
      const vars = raw.vars && typeof raw.vars === 'object' ? (raw.vars as Record<string, unknown>) : {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) if (isValidSecretKey(k) && typeof v === 'string') out[k] = v;
      return out;
    } catch {
      return {};
    }
  }

  private async writeVars(realRoot: string, vars: Record<string, string>): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true, mode: 0o700 });
    const file = this.fileFor(realRoot);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ vars }), { mode: 0o600 });
    await fs.rename(tmp, file);
    if (process.platform !== 'win32') await fs.chmod(file, 0o600).catch(() => undefined);
  }

  private root(root: unknown): Promise<string> {
    return assertTrustedRoot(root, this.trustedRoots);
  }

  /** Noms et longueurs : c'est tout ce que le renderer reçoit. */
  async list(root: unknown): Promise<SecretsResult<SecretEntry[]>> {
    try {
      const vars = await this.readVars(await this.root(root));
      return {
        ok: true,
        data: Object.keys(vars)
          .sort()
          .map((key) => ({ key, length: (vars[key] ?? '').length })),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async set(root: unknown, key: unknown, value: unknown): Promise<SecretsResult<SecretEntry[]>> {
    try {
      const real = await this.root(root);
      if (!isValidSecretKey(key)) return { ok: false, error: 'nom de variable invalide (lettres, chiffres, _)' };
      if (typeof value !== 'string' || value.length === 0) return { ok: false, error: `valeur vide pour ${key}` };
      if (value.length > MAX_VALUE || /[\r\n\0]/.test(value)) return { ok: false, error: `valeur refusée pour ${key}` };
      const vars = await this.readVars(real);
      if (!(key in vars) && Object.keys(vars).length >= MAX_KEYS) return { ok: false, error: 'trop de secrets' };
      vars[key] = value;
      await this.writeVars(real, vars);
      return this.list(real);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async remove(root: unknown, key: unknown): Promise<SecretsResult<SecretEntry[]>> {
    try {
      const real = await this.root(root);
      if (!isValidSecretKey(key)) return { ok: false, error: 'nom de variable invalide' };
      const vars = await this.readVars(real);
      delete vars[key];
      await this.writeVars(real, vars);
      return this.list(real);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Variables à injecter dans les processus du projet (processus principal seulement). */
  async envFor(root: string): Promise<Record<string, string>> {
    try {
      return await this.readVars(await fs.realpath(root));
    } catch {
      return {};
    }
  }

  /** Toutes les valeurs à masquer : secrets rangés + valeurs des `.env*` du projet. */
  async valuesFor(root: string): Promise<string[]> {
    let real: string;
    try {
      real = await fs.realpath(root);
    } catch {
      return [];
    }
    const values = Object.values(await this.readVars(real));
    for (const name of PROJECT_ENV_FILES) {
      const text = await fs.readFile(path.join(real, name), 'utf8').catch(() => null);
      if (text) values.push(...Object.values(parseDotenv(text)));
    }
    return values;
  }

  async redact(root: unknown, text: unknown): Promise<SecretsResult<string>> {
    if (typeof text !== 'string') return { ok: false, error: 'texte invalide' };
    try {
      const real = await this.root(root);
      return { ok: true, data: redactText(text, await this.valuesFor(real)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Cherche une valeur secrète dans les fichiers d'un dossier exporté (site
   * construit). Renvoie les chemins relatifs fautifs — jamais la valeur.
   */
  async findLeaks(root: string, dir: string): Promise<string[]> {
    const values = (await this.valuesFor(root)).filter((v) => v.length >= MIN_REDACT_LENGTH);
    if (values.length === 0) return [];
    const leaks: string[] = [];
    const walk = async (current: string): Promise<void> => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.isFile()) {
          const buf = await fs.readFile(abs).catch(() => null);
          if (!buf || buf.length > 20 * 1024 * 1024) continue;
          const text = buf.toString('latin1');
          const utf = buf.toString('utf8');
          if (values.some((v) => utf.includes(v) || text.includes(v))) leaks.push(path.relative(dir, abs));
        }
      }
    };
    await walk(dir);
    return leaks.sort();
  }
}

/**
 * Export du site : un secret du projet ne doit JAMAIS sortir dans le site
 * exporté (une variable VITE_ est intégrée au bundle). Dossier exporté
 * supprimé et export refusé si une valeur s'y retrouve.
 */
export async function guardSiteExport<T extends { ok: boolean }>(
  service: Pick<ProjectSecretsService, 'findLeaks'>,
  root: unknown,
  outcome: T,
): Promise<T | { ok: false; error: string }> {
  const savedTo = (outcome as { data?: { savedTo?: unknown } }).data?.savedTo;
  if (!outcome.ok || typeof root !== 'string' || typeof savedTo !== 'string') return outcome;
  const leaks = await service.findLeaks(root, savedTo).catch(() => [] as string[]);
  if (leaks.length === 0) return outcome;
  await fs.rm(savedTo, { recursive: true, force: true }).catch(() => undefined);
  return {
    ok: false,
    error:
      `Export annulé : un secret du projet se retrouve dans le site construit (${leaks.slice(0, 3).join(', ')}). ` +
      "Une variable VITE_ est publique une fois construite : ne l'y mettez pas.",
  };
}

export const PROJECT_SECRETS_CHANNELS = {
  list: 'studio.secrets.list',
  set: 'studio.secrets.set',
  remove: 'studio.secrets.remove',
  redact: 'studio.secrets.redact',
} as const;

export function registerProjectSecretsIpc(
  ipcMain: { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void },
  service: ProjectSecretsService,
): void {
  ipcMain.handle(PROJECT_SECRETS_CHANNELS.list, (_e, root) => service.list(root));
  ipcMain.handle(PROJECT_SECRETS_CHANNELS.set, (_e, root, key, value) => service.set(root, key, value));
  ipcMain.handle(PROJECT_SECRETS_CHANNELS.remove, (_e, root, key) => service.remove(root, key));
  ipcMain.handle(PROJECT_SECRETS_CHANNELS.redact, (_e, root, text) => service.redact(root, text));
}
