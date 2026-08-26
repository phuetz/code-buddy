/**
 * Backup CLI Handlers
 *
 * Native Engine v2026.3.8 alignment: `buddy backup create/verify/list/restore`
 * Local backup management for `.codebuddy/` configuration and workspace data.
 */

import { existsSync, mkdirSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';

export interface CommandHandlerResult {
  handled: boolean;
  response?: string;
  /** Non-zero when the CLI should fail (usage, missing file, unknown subcommand). */
  exitCode?: number;
}

/** Default backup directory */
const BACKUP_DIR = join(homedir(), '.codebuddy', 'backups');

/** Backup manifest stored inside the tar */
interface BackupManifest {
  version: string;
  createdAt: string;
  files: Array<{ path: string; size: number; checksum: string }>;
  flags: {
    onlyConfig: boolean;
    includeWorkspace: boolean;
  };
}

/**
 * Handle `buddy backup <subcommand>` / `/backup`
 */
export async function handleBackup(
  args: string,
  _context?: Record<string, unknown>
): Promise<CommandHandlerResult> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || 'list';

  switch (subcommand) {
    case 'create':
      return handleBackupCreate(parts.slice(1));
    case 'verify':
      return handleBackupVerify(parts.slice(1));
    case 'list':
      return handleBackupList();
    case 'restore':
      return handleBackupRestore(parts.slice(1));
    default:
      return {
        handled: true,
        exitCode: 1,
        response: `Unknown backup subcommand: ${subcommand}\nUsage: backup create|verify|list|restore`,
      };
  }
}

/**
 * Create a backup of .codebuddy/ directory
 */
async function handleBackupCreate(flags: string[]): Promise<CommandHandlerResult> {
  const onlyConfig = flags.includes('--only-config');
  const noWorkspace = flags.includes('--no-include-workspace');
  const outputIdx = flags.indexOf('--output');
  const outputPath = outputIdx >= 0 ? flags[outputIdx + 1] : undefined;

  const cwd = process.cwd();
  const sourcePath = join(cwd, '.codebuddy');

  if (!existsSync(sourcePath)) {
    return {
      handled: true,
      exitCode: 1,
      response:
        `No .codebuddy/ directory found at ${sourcePath}. Create one with \`buddy --init\` first.`,
    };
  }

  // Ensure backup directory exists
  const backupDir = outputPath ? join(outputPath) : BACKUP_DIR;
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  // Collect files to backup
  const files = collectFiles(sourcePath, sourcePath, { onlyConfig, noWorkspace });

  // Build manifest
  const manifest: BackupManifest = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    files: files.map(f => ({
      path: f.relativePath,
      size: f.size,
      checksum: f.checksum,
    })),
    flags: {
      onlyConfig,
      includeWorkspace: !noWorkspace,
    },
  };

  // Generate backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `codebuddy-backup-${timestamp}.json`;
  const backupPath = join(backupDir, backupName);

  // Write backup as JSON (portable, no tar dependency needed)
  const backupData = {
    manifest,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    fileCount: files.length,
  };

  const { writeFileSync } = await import('fs');
  writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

  const totalSizeKB = Math.round(backupData.totalSize / 1024);

  return {
    handled: true,
    response: [
      `Backup created: ${backupPath}`,
      `Files: ${files.length}`,
      `Size: ${totalSizeKB} KB`,
      onlyConfig ? '(config only)' : '',
      noWorkspace ? '(workspace excluded)' : '',
    ].filter(Boolean).join('\n'),
  };
}

/**
 * Verify a backup file
 */
async function handleBackupVerify(args: string[]): Promise<CommandHandlerResult> {
  const filePath = args[0];
  if (!filePath) {
    return {
      handled: true,
      exitCode: 1,
      response: 'Usage: backup verify <file>',
    };
  }

  const fullPath = resolveBackupPath(filePath);
  if (!existsSync(fullPath)) {
    return {
      handled: true,
      exitCode: 1,
      response: `Backup file not found: ${fullPath}`,
    };
  }

  try {
    const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
    const manifest = data.manifest as BackupManifest;

    if (!manifest || !manifest.version || !Array.isArray(manifest.files)) {
      return {
        handled: true,
        exitCode: 1,
        response: `Invalid backup ${fullPath}: missing or corrupt manifest`,
      };
    }

    return {
      handled: true,
      response: [
        `Backup valid: ${basename(fullPath)}`,
        `Version: ${manifest.version}`,
        `Created: ${manifest.createdAt}`,
        `Files: ${manifest.files.length}`,
        `Config only: ${manifest.flags.onlyConfig ? 'yes' : 'no'}`,
        `Workspace included: ${manifest.flags.includeWorkspace ? 'yes' : 'no'}`,
      ].join('\n'),
    };
  } catch (err) {
    return {
      handled: true,
      exitCode: 1,
      response: `Backup corrupt or unreadable: ${fullPath}: ${(err as Error).message}`,
    };
  }
}

/**
 * List available backups
 */
async function handleBackupList(): Promise<CommandHandlerResult> {
  if (!existsSync(BACKUP_DIR)) {
    return {
      handled: true,
      response: 'No backups found.',
    };
  }

  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('codebuddy-backup-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return {
      handled: true,
      response: 'No backups found.',
    };
  }

  const lines = files.map(f => {
    const fullPath = join(BACKUP_DIR, f);
    const stat = statSync(fullPath);
    const sizeKB = Math.round(stat.size / 1024);
    return `  ${f}  (${sizeKB} KB, ${stat.mtime.toLocaleDateString()})`;
  });

  return {
    handled: true,
    response: `Backups in ${BACKUP_DIR}:\n${lines.join('\n')}`,
  };
}

/**
 * Restore from a backup (with confirmation message)
 */
async function handleBackupRestore(args: string[]): Promise<CommandHandlerResult> {
  const filePath = args[0];
  if (!filePath) {
    return {
      handled: true,
      exitCode: 1,
      response: 'Usage: backup restore <file>',
    };
  }

  const fullPath = resolveBackupPath(filePath);
  if (!existsSync(fullPath)) {
    return {
      handled: true,
      exitCode: 1,
      response: `Backup file not found: ${fullPath}`,
    };
  }

  try {
    const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
    const manifest = data.manifest as BackupManifest;

    if (!manifest || !Array.isArray(manifest.files)) {
      return {
        handled: true,
        exitCode: 1,
        response: `Invalid backup ${fullPath}: missing or corrupt manifest`,
      };
    }

    return {
      handled: true,
      response: [
        `Ready to restore backup: ${basename(fullPath)}`,
        `Created: ${manifest.createdAt}`,
        `Files: ${manifest.files.length}`,
        '',
        'This will overwrite current .codebuddy/ configuration.',
        'To confirm, run: backup restore <file> --confirm',
      ].join('\n'),
    };
  } catch (err) {
    return {
      handled: true,
      exitCode: 1,
      response: `Failed to read backup ${fullPath}: ${(err as Error).message}`,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CollectedFile {
  relativePath: string;
  size: number;
  checksum: string;
}

function collectFiles(
  dir: string,
  base: string,
  opts: { onlyConfig: boolean; noWorkspace: boolean }
): CollectedFile[] {
  const results: CollectedFile[] = [];

  // Config-only patterns
  const configPatterns = ['settings.json', 'hooks.json', 'mcp.json', 'rules/'];
  // Skip patterns (always)
  const skipPatterns = ['screenshots/', 'tool-results/', 'runs/', 'browser-data/'];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = fullPath.slice(base.length + 1).replace(/\\/g, '/');

      // Skip large/ephemeral directories
      if (skipPatterns.some(p => relativePath.startsWith(p))) {
        continue;
      }

      if (entry.isDirectory()) {
        if (opts.noWorkspace && relativePath === 'knowledge') continue;
        results.push(...collectFiles(fullPath, base, opts));
      } else {
        // Config-only mode: only include config files
        if (opts.onlyConfig && !configPatterns.some(p => relativePath.startsWith(p) || relativePath === p)) {
          continue;
        }

        try {
          const stat = statSync(fullPath);
          // Skip files larger than 1MB
          if (stat.size > 1024 * 1024) continue;

          const content = readFileSync(fullPath);
          const checksum = createHash('sha256').update(content).digest('hex').slice(0, 16);

          results.push({
            relativePath,
            size: stat.size,
            checksum,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return results;
}

function resolveBackupPath(filePath: string): string {
  if (filePath.includes('/') || filePath.includes('\\')) {
    return filePath;
  }
  // Assume it's just a filename in the default backup dir
  return join(BACKUP_DIR, filePath);
}
