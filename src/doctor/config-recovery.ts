/**
 * Restauration de la configuration utilisateur depuis `.last-good`.
 * Le fichier actif illisible ou refusé n'est pas réécrit sans `--fix`.
 */

import { existsSync, readFileSync } from 'node:fs';

import { configLastGoodPath, writeRejectedConfig } from '../config/config-backup.js';
import { assessUserConfigText, resolveUserConfigFile } from '../config/toml-config.js';
import { writeFileAtomicSync } from '../utils/atomic-write.js';
import type { DoctorCheck, FixResult } from './index.js';

import '../config/model-catalogue.js';

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function restoreUserConfigFromLastGood(): { ok: boolean; message: string } {
  const file = resolveUserConfigFile();
  const goodPath = configLastGoodPath(file);
  const good = readText(goodPath);
  if (good === null) {
    return { ok: false, message: 'aucune copie last-good' };
  }
  const problem = assessUserConfigText(good);
  if (problem) {
    return { ok: false, message: `last-good refusé : ${problem}` };
  }
  if (existsSync(file)) {
    const current = readText(file);
    if (current !== null) writeRejectedConfig(file, current, 'restauré depuis last-good');
  }
  writeFileAtomicSync(file, good.endsWith('\n') ? good : `${good}\n`, { mode: 0o600 });
  return { ok: true, message: 'configuration restaurée depuis last-good' };
}

function fixRestore(): Promise<FixResult> {
  const result = restoreUserConfigFromLastGood();
  return Promise.resolve({
    success: result.ok,
    message: result.message,
    action: 'restore-user-config',
  });
}

/** Contrôle du fichier utilisateur résolu par CODEBUDDY_CONFIG puis CODEBUDDY_HOME. */
export function checkUserConfigRecovery(): DoctorCheck {
  const file = resolveUserConfigFile();
  const goodExists = existsSync(configLastGoodPath(file));
  if (!existsSync(file)) {
    if (!goodExists) {
      return { name: 'User config file', status: 'ok', message: 'absent' };
    }
    return {
      name: 'User config file',
      status: 'warn',
      message: 'absent; last-good can be restored with --fix',
      fixable: true,
      fix: fixRestore,
    };
  }
  const text = readText(file);
  if (text === null) {
    return {
      name: 'User config file',
      status: 'error',
      message: goodExists ? 'unreadable — --fix restores last-good' : 'unreadable — no last-good',
      fixable: goodExists,
      ...(goodExists ? { fix: fixRestore } : {}),
    };
  }
  const problem = assessUserConfigText(text);
  if (!problem) {
    return { name: 'User config file', status: 'ok', message: 'valid' };
  }
  return {
    name: 'User config file',
    status: 'error',
    message: goodExists ? `${problem} — --fix restores last-good` : `${problem} — no last-good`,
    fixable: goodExists,
    ...(goodExists ? { fix: fixRestore } : {}),
  };
}
