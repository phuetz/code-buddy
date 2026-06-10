/**
 * BackupBridge — pilot `.codebuddy/` backups from Cowork.
 *
 * `buddy backup create|verify|list|restore` protects the data the GUI
 * itself accumulates (memory, lessons, missions, settings) but had no
 * GUI surface. This bridge calls the same core handler the CLI uses
 * (`commands/handlers/backup-handlers.js` → `handleBackup`), so backup
 * format and paths stay single-sourced. The handler returns operator-
 * facing TEXT (not JSON) — the GUI shows it verbatim, which is honest
 * for v1 rather than fragile text parsing.
 *
 * @module main/tools/backup-bridge
 */

import { loadCoreModule } from '../utils/core-loader';

export interface BackupActionReview {
  ok: boolean;
  error?: string;
  /** The core handler's operator-facing text output, verbatim. */
  output?: string;
}

interface BackupHandlersModule {
  handleBackup: (
    args: string,
    context?: Record<string, unknown>,
  ) => Promise<{ handled: boolean; response?: string }>;
}

async function runBackupCommand(args: string): Promise<BackupActionReview> {
  try {
    const mod = await loadCoreModule<BackupHandlersModule>('commands/handlers/backup-handlers.js');
    if (!mod?.handleBackup) {
      return { ok: false, error: 'Core backup module is unavailable (build the core dist first).' };
    }
    const result = await mod.handleBackup(args);
    if (!result?.handled) {
      return { ok: false, error: `Backup command not handled: ${args}` };
    }
    return { ok: true, output: result.response ?? '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listBackupsForReview(): Promise<BackupActionReview> {
  return runBackupCommand('list');
}

export async function createBackupForReview(
  options: { onlyConfig?: boolean } = {},
): Promise<BackupActionReview> {
  return runBackupCommand(options.onlyConfig ? 'create --only-config' : 'create');
}

export async function verifyBackupForReview(file: string): Promise<BackupActionReview> {
  if (typeof file !== 'string' || !file.trim()) {
    return { ok: false, error: 'A backup file path is required.' };
  }
  return runBackupCommand(`verify ${file.trim()}`);
}

export async function restoreBackupForReview(file: string): Promise<BackupActionReview> {
  if (typeof file !== 'string' || !file.trim()) {
    return { ok: false, error: 'A backup file path is required.' };
  }
  return runBackupCommand(`restore ${file.trim()}`);
}
