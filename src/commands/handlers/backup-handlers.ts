/**
 * Backup CLI Handlers
 *
 * Native Engine v2026.3.8 alignment: `buddy backup create/verify/list/restore`
 * Local backup management for `.codebuddy/` configuration and workspace data.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join, basename, dirname, resolve, relative, isAbsolute, sep, win32 } from 'path';
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

interface BackupArchiveFile {
  path: string;
  content: string;
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
      return handleBackupList(parts.slice(1));
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
  try {
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
  } catch (err) {
    return {
      handled: true,
      exitCode: 1,
      response: describeBackupIoError(err, `create the backup directory ${backupDir}`),
    };
  }

  // Collect files to backup
  const skipped: SkippedFile[] = [];
  const files = collectFiles(sourcePath, sourcePath, { onlyConfig, noWorkspace }, skipped);
  if (files.length === 0) {
    return {
      handled: true,
      exitCode: 1,
      response:
        `No files to back up in ${sourcePath}. ` +
        `The directory is empty, or every file was skipped ` +
        `(screenshots/, tool-results/, runs/, browser-data/, and files larger than 1 MB are not included).`,
    };
  }

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
    files: files.map(f => ({ path: f.relativePath, content: f.content.toString('base64') })),
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    fileCount: files.length,
  };

  try {
    writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  } catch (err) {
    return {
      handled: true,
      exitCode: 1,
      response: describeBackupIoError(err, `write backup ${backupPath}`),
    };
  }

  const fileList = files.length <= 12
    ? ` (${files.map((file) => file.relativePath).join(', ')})`
    : '';
  const skippedLine = skipped.length === 0
    ? ''
    : `Skipped: ${skipped.length} (${skipped.map((item) => `${item.relativePath}: ${item.reason}`).join('; ')})`;

  return {
    handled: true,
    response: [
      `Backup created: ${backupPath}`,
      `Source: ${sourcePath} (current project .codebuddy/; does not include ~/.codebuddy)`,
      `Files: ${files.length}${fileList}`,
      `Size: ${formatBackupSize(backupData.totalSize)}`,
      skippedLine,
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
    if (!isSupportedBackupVersion(manifest.version)) {
      return {
        handled: true,
        exitCode: 1,
        response:
          `Invalid backup ${fullPath}: unsupported backup format (need version 1.x), got ${manifest.version}`,
      };
    }

    const payloadError = verifyArchivePayloads(manifest, data.files);
    if (payloadError) {
      return {
        handled: true,
        exitCode: 1,
        response: `Invalid backup ${fullPath}: ${payloadError}`,
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
      response: describeUnreadableBackup(fullPath, err),
    };
  }
}

/**
 * List available backups
 */
async function handleBackupList(args: string[] = []): Promise<CommandHandlerResult> {
  const outputIdx = args.indexOf('--output');
  const customOutput = outputIdx >= 0 ? args[outputIdx + 1] : undefined;
  const backupDir = customOutput
    ? join(customOutput)
    : BACKUP_DIR;

  if (!existsSync(backupDir)) {
    return {
      handled: true,
      response: 'No backups found.',
    };
  }

  const files = readdirSync(backupDir)
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
    const fullPath = join(backupDir, f);
    const stat = statSync(fullPath);
    return `  ${f}  (${formatBackupSize(stat.size)}, ${stat.mtime.toLocaleDateString()})`;
  });

  return {
    handled: true,
    response: `Backups in ${backupDir}:\n${lines.join('\n')}`,
  };
}

/**
 * Restore from a backup (with confirmation message)
 */
async function handleBackupRestore(args: string[]): Promise<CommandHandlerResult> {
  const confirm = args.includes('--confirm');
  const filePath = args.find((arg) => arg !== '--confirm' && !arg.startsWith('--'));
  if (!filePath) {
    return {
      handled: true,
      exitCode: 1,
      response: 'Usage: backup restore <file> [--confirm]',
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
    if (!isSupportedBackupVersion(manifest.version)) {
      return {
        handled: true,
        exitCode: 1,
        response:
          `Invalid backup ${fullPath}: unsupported backup format (need version 1.x), got ${String(manifest.version)}`,
      };
    }

    const destRoot = resolve(join(process.cwd(), '.codebuddy'));
    let extras: string[] = [];
    try {
      extras = extraFilesNotInArchive(
        destRoot,
        manifest.files.map((file) => file.path),
      );
    } catch {
      extras = [];
    }

    if (!confirm) {
      return {
        handled: true,
        response: [
          `Ready to restore backup: ${basename(fullPath)}`,
          `Created: ${manifest.createdAt}`,
          `Files: ${manifest.files.length}`,
          '',
          'This merges into the current project .codebuddy/: archive files are overwritten, extra files are left in place.',
          formatExtraFilesLine(extras) || 'No extra files are present in .codebuddy/.',
          'To confirm, run: backup restore <file> --confirm',
        ].join('\n'),
      };
    }

    const payloadError = verifyArchivePayloads(manifest, data.files);
    if (payloadError) {
      return {
        handled: true,
        exitCode: 1,
        response: `Cannot restore ${fullPath}: ${payloadError}`,
      };
    }

    const archiveFiles = data.files as BackupArchiveFile[];

    try {
      mkdirSync(destRoot, { recursive: true });

      const destinations = new Map<string, string>();
      for (const manifestFile of manifest.files) {
        const dest = resolveRestoreDestination(destRoot, manifestFile.path);
        if (!dest) {
          return {
            handled: true,
            exitCode: 1,
            response: `Cannot restore ${fullPath}: path escapes destination: ${manifestFile.path}`,
          };
        }
        destinations.set(manifestFile.path, dest);
      }

      for (const [archivePath, dest] of destinations) {
        const safetyError = getRestorePathSafetyError(destRoot, dest);
        if (safetyError) {
          return {
            handled: true,
            exitCode: 1,
            response: `Cannot restore ${fullPath}: unsafe destination for ${archivePath}: ${safetyError}`,
          };
        }
      }

      const restored: string[] = [];
      for (const manifestFile of manifest.files) {
        const archiveFile = archiveFiles.find((file) => file.path === manifestFile.path);
        if (!archiveFile) {
          return {
            handled: true,
            exitCode: 1,
            response: `Cannot restore ${fullPath}: archive payload is missing ${manifestFile.path}`,
          };
        }
        const content = Buffer.from(archiveFile.content, 'base64');
        const dest = destinations.get(manifestFile.path)!;
        mkdirSync(dirname(dest), { recursive: true });
        const safetyError = getRestorePathSafetyError(destRoot, dest);
        if (safetyError) {
          return {
            handled: true,
            exitCode: 1,
            response: `Cannot restore ${fullPath}: unsafe destination for ${manifestFile.path}: ${safetyError}`,
          };
        }
        writeFileSync(dest, content);
        const reread = readFileSync(dest);
        const expectedChecksum = fileChecksum(content);
        const actualChecksum = fileChecksum(reread);
        if (actualChecksum !== expectedChecksum || actualChecksum !== manifestFile.checksum) {
          return {
            handled: true,
            exitCode: 1,
            response: `Restore verification failed for ${manifestFile.path}: on-disk hash does not match the archive`,
          };
        }
        restored.push(manifestFile.path);
      }

      return {
        handled: true,
        response: [
          `Restored backup: ${basename(fullPath)}`,
          `Files: ${restored.length}`,
          `Verified: sha256 match for ${restored.length} file(s)`,
          extras.length === 0
            ? 'Merged: no extra files were present in .codebuddy/.'
            : `Merged: ${formatExtraFilesLine(extras)}`,
        ].join('\n'),
      };
    } catch (err) {
      return {
        handled: true,
        exitCode: 1,
        response: describeBackupIoError(err, `write restored files from ${fullPath}`),
      };
    }
  } catch (err) {
    return {
      handled: true,
      exitCode: 1,
      response: describeUnreadableBackup(fullPath, err),
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CollectedFile {
  relativePath: string;
  size: number;
  checksum: string;
  content: Buffer;
}

interface SkippedFile {
  relativePath: string;
  reason: string;
}

function fileChecksum(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Dummy dest used only to decide whether an archive path would escape on restore. */
const VERIFY_PATH_ROOT = resolve('/codebuddy-backup-dest');

function isSupportedBackupVersion(version: unknown): boolean {
  return typeof version === 'string' && /^1(\.|$)/.test(version);
}

function formatBackupSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeUnreadableBackup(fullPath: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/JSON|Unexpected token|Unterminated|not valid JSON/i.test(message)) {
    return `This file is not a readable Code Buddy backup (truncated or not JSON): ${fullPath}`;
  }
  return `Cannot read backup ${fullPath}: ${message}`;
}

function describeBackupIoError(err: unknown, action: string): string {
  const e = err as NodeJS.ErrnoException;
  const target = e.path ? ` (${e.path})` : '';
  if (e.code === 'ENOSPC') {
    return `Cannot ${action}: no space left on the device${target}.`;
  }
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    return `Cannot ${action}: permission denied${target}.`;
  }
  if (e.code === 'ENOTDIR') {
    return `Cannot ${action}: the output path is not a directory${target}.`;
  }
  if (e.code === 'EISDIR') {
    return `Cannot ${action}: expected a file, got a directory${target}.`;
  }
  return `Cannot ${action}: ${e.message ?? String(err)}`;
}

/** True when `candidate` is destRoot itself or a file/dir under it. */
function isInsideDestRoot(destRoot: string, candidate: string): boolean {
  const rel = relative(destRoot, candidate);
  return rel === '' || (
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

/** Reject symlinks in the destination path before any archive bytes are written. */
function getRestorePathSafetyError(destRoot: string, candidate: string): string | null {
  const root = resolve(destRoot);
  const dest = resolve(candidate);
  if (!isInsideDestRoot(root, dest)) return 'path escapes destination';

  const relativePath = relative(root, dest);
  const segments = relativePath === '' ? [] : relativePath.split(sep);
  let current = root;
  for (let index = -1; index < segments.length; index++) {
    if (index >= 0) current = join(current, segments[index]!);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink()) return `symbolic link is forbidden: ${current}`;
    if (index < segments.length - 1 && !stat.isDirectory()) {
      return `path component is not a directory: ${current}`;
    }
  }
  return null;
}

/**
 * Resolve an archive entry against destRoot. Returns null when the path
 * is absolute, contains a NUL, uses win32 separators to walk out, or
 * resolves outside destRoot (the `../../etc/x` class of restores).
 */
export function resolveRestoreDestination(destRoot: string, archivePath: string): string | null {
  if (typeof archivePath !== 'string' || archivePath.length === 0) return null;
  if (archivePath.includes('\0')) return null;
  if (isAbsolute(archivePath) || win32.isAbsolute(archivePath)) return null;
  // Archives may carry Windows separators. Treat `\` as `/` so `..\..\etc\x`
  // cannot land as a literal filename on POSIX or a traversal on win32.
  const normalized = archivePath.replace(/\\/g, '/');
  if (normalized !== archivePath && (isAbsolute(normalized) || win32.isAbsolute(normalized))) {
    return null;
  }
  const root = resolve(destRoot);
  const dest = resolve(root, normalized);
  if (!isInsideDestRoot(root, dest)) return null;
  return dest;
}

function verifyArchivePayloads(
  manifest: BackupManifest,
  files: unknown,
): string | null {
  const archiveFiles = files as BackupArchiveFile[] | undefined;
  if (manifest.files.length === 0 || !Array.isArray(archiveFiles) || archiveFiles.length === 0) {
    return 'archive is empty: no file payloads found';
  }
  if (archiveFiles.length !== manifest.files.length) {
    return 'archive payload does not match the manifest';
  }
  for (const manifestFile of manifest.files) {
    if (!resolveRestoreDestination(VERIFY_PATH_ROOT, manifestFile.path)) {
      return `path escapes destination: ${manifestFile.path}`;
    }
    const archiveFile = archiveFiles.find((file) => file.path === manifestFile.path);
    if (!archiveFile || typeof archiveFile.content !== 'string') {
      return `archive payload is missing ${manifestFile.path}`;
    }
    const content = Buffer.from(archiveFile.content, 'base64');
    if (content.toString('base64') !== archiveFile.content) {
      return `archive payload is not valid base64: ${manifestFile.path}`;
    }
    if (content.length !== manifestFile.size) {
      return `archive size mismatch: ${manifestFile.path}`;
    }
    if (fileChecksum(content) !== manifestFile.checksum) {
      return `archive checksum mismatch: ${manifestFile.path}`;
    }
  }
  return null;
}

function collectFiles(
  dir: string,
  base: string,
  opts: { onlyConfig: boolean; noWorkspace: boolean },
  skipped: SkippedFile[] = [],
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

      if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
        skipped.push({ relativePath, reason: 'symbolic link' });
        continue;
      }

      if (entry.isDirectory()) {
        if (opts.noWorkspace && relativePath === 'knowledge') continue;
        results.push(...collectFiles(fullPath, base, opts, skipped));
      } else {
        // Config-only mode: only include config files
        if (opts.onlyConfig && !configPatterns.some(p => relativePath.startsWith(p) || relativePath === p)) {
          continue;
        }

        try {
          const stat = statSync(fullPath);
          if (stat.size > 1024 * 1024) {
            skipped.push({ relativePath, reason: 'larger than 1 MB' });
            continue;
          }

          const content = readFileSync(fullPath);
          const checksum = fileChecksum(content);

          results.push({
            relativePath,
            size: stat.size,
            checksum,
            content,
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

function listProfileRelativeFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (typeof name !== 'string' || name.length === 0) continue;
      const full = join(dir, name);
      const rel = relative(root, full).replace(/\\/g, '/');
      if (rel === '.backup-restore-staging' || rel.startsWith('.backup-restore-staging/')) continue;
      if (typeof entry !== 'object' || entry === null) {
        results.push(rel);
        continue;
      }
      if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
        results.push(rel);
        continue;
      }
      if (typeof entry.isDirectory === 'function' && entry.isDirectory()) walk(full);
      else results.push(rel);
    }
  };
  if (!existsSync(root)) return [];
  walk(root);
  return results.sort();
}

function extraFilesNotInArchive(destRoot: string, archivePaths: string[]): string[] {
  const inArchive = new Set(archivePaths);
  return listProfileRelativeFiles(destRoot).filter((filePath) => !inArchive.has(filePath));
}

function formatExtraFilesLine(extras: string[]): string {
  if (extras.length === 0) return '';
  const shown = extras.slice(0, 12);
  const more = extras.length > 12 ? `; …and ${extras.length - 12} more` : '';
  return `${extras.length} extra file(s) not in the archive will be left in place: ${shown.join(', ')}${more}`;
}

function resolveBackupPath(filePath: string): string {
  if (filePath.includes('/') || filePath.includes('\\')) {
    return filePath;
  }
  // Assume it's just a filename in the default backup dir
  return join(BACKUP_DIR, filePath);
}
