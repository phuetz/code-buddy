/**
 * Sauvegardes rotatives du fichier de configuration utilisateur.
 *
 * À côté du fichier actif : `.bak` (précédent immédiat), `.bak.1` …
 * `.last-good` (dernière écriture acceptée) et `.rejected.*`
 * (charge refusée, le fichier actif n'est pas remplacé).
 * Les octets passent par `writeFileAtomicSync`.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

import { writeFileAtomicSync } from '../utils/atomic-write.js';

/** `.bak` plus quatre générations `.bak.1` … `.bak.4`. */
export const CONFIG_BACKUP_SLOTS = 5;

const FILE_MODE = 0o600;

export class ConfigWriteRejectedError extends Error {
  readonly rejectedPath: string;

  constructor(message: string, rejectedPath: string) {
    super(message);
    this.name = 'ConfigWriteRejectedError';
    this.rejectedPath = rejectedPath;
  }
}

export function configBackupPath(file: string, index: number): string {
  if (index <= 0) return `${file}.bak`;
  return `${file}.bak.${index}`;
}

export function configLastGoodPath(file: string): string {
  return `${file}.last-good`;
}

function ensureParent(file: string): void {
  const directory = dirname(file);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
}

function writeOwned(file: string, text: string): void {
  ensureParent(file);
  const payload = text.endsWith('\n') ? text : `${text}\n`;
  writeFileAtomicSync(file, payload, { mode: FILE_MODE });
}

/**
 * Décale les copies existantes puis range le contenu actuel dans `.bak`.
 * Ne fait rien si le fichier actif est absent.
 */
export function rotateConfigBackups(file: string): void {
  if (!existsSync(file)) return;
  const oldest = configBackupPath(file, CONFIG_BACKUP_SLOTS - 1);
  if (existsSync(oldest)) unlinkSync(oldest);
  for (let index = CONFIG_BACKUP_SLOTS - 2; index >= 0; index -= 1) {
    const source = configBackupPath(file, index);
    if (!existsSync(source)) continue;
    renameSync(source, configBackupPath(file, index + 1));
  }
  writeOwned(configBackupPath(file, 0), readFileSync(file, 'utf8'));
}

/** Écrit un texte déjà accepté, après rotation, et rafraîchit `.last-good`. */
export function commitValidConfigText(file: string, text: string): void {
  rotateConfigBackups(file);
  writeOwned(file, text);
  writeOwned(configLastGoodPath(file), text);
}

/** Dépose la charge refusée sans toucher au fichier actif. */
export function writeRejectedConfig(file: string, text: string, reason: string): string {
  const safeReason = reason.replace(/[\r\n]+/g, ' ').slice(0, 500);
  const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const target = `${file}.rejected.${stamp}`;
  writeOwned(target, `# refus: ${safeReason}\n${text}`);
  return target;
}
