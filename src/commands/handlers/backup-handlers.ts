/**
 * Backup CLI Handlers
 *
 * Native Engine v2026.3.8 alignment: `buddy backup create/verify/list/restore`
 * Local backup management for `.codebuddy/` configuration and workspace data.
 * HOMEBACKUP1: Added --profile support for home profile backup with strict whitelist.
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

export interface CommandHandlerResult {
  handled: boolean;
  response?: string;
  /** Non-zero when the CLI should fail (usage, missing file, unknown subcommand). */
  exitCode?: number;
}

/** Default backup directory */
const BACKUP_DIR = join(homedir(), '.codebuddy', 'backups');

// HOMEBACKUP1: Profile backup configuration
/** Default max file size for profile backups (5 MB) */
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
/** Default total backup size limit (200 MB) */
export const DEFAULT_MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200 Mo
/** Home profile directory */
export const HOME_PROFILE_DIR = join(homedir(), '.codebuddy');

/**
 * Whitelist patterns for home profile backup.
 * These are relative paths from the home profile directory.
 * Only files matching these patterns will be considered for backup.
 */
export const PROFILE_BACKUP_WHITELIST = [
  'settings.json',
  'user-settings.json',
  'memory.md',
  'CODEBUDDY_MEMORY.md',
  'reminders.json',
  'snoozes.json',
  'pending-acks.json',
  'speech-hotwords.txt',
  'mcp.json',
  'identity-links.json',
  'vision.env',
  // JSON files in personas directory (no images)
  'personas/*.json',
  // SKILL.md files in skills directory
  'skills/**/SKILL.md',
  // Self-improvement store
  'self-improvement/store/',
  // Collective ledger
  'collective/ckg-ledger.jsonl',
];

/**
 * Blacklist patterns for home profile backup - ABSOLUTE.
 * Files matching these patterns will NEVER be backed up, even if explicitly requested.
 * These patterns are checked against the filename (not path).
 */
export const PROFILE_BACKUP_BLACKLIST = [
  '*.env',
  '*auth*',
  'credentials*',
  '*token*',
  '*secret*',
  '*.enc',
];

/**
 * Check if a filename matches any blacklist pattern.
 * Blacklist matching is case-insensitive.
 */
export function isBlacklisted(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  for (const pattern of PROFILE_BACKUP_BLACKLIST) {
    const lowerPattern = pattern.toLowerCase();
    // Convert glob pattern to regex using string replacements
    const starRegExp = new RegExp('\\*', 'g');
    const questionRegExp = new RegExp('\\?', 'g');
    const dotRegExp = new RegExp('\\.', 'g');
    const regexPattern = lowerPattern
      .replace(starRegExp, '.*')
      .replace(questionRegExp, '.')
      .replace(dotRegExp, '\\.');
    
    const regex = new RegExp('^.*' + regexPattern + '.*$');
    if (regex.test(lowerFilename)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple string replacement for backslashes
 */
function normalizePathForMatching(path: string): string {
  let result = '';
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '\\') {
      result += '/';
    } else {
      result += path[i];
    }
  }
  return result;
}

/**
 * Simple glob pattern matching for whitelist
 */
function matchesPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizePathForMatching(path);
  const normalizedPattern = normalizePathForMatching(pattern);
  
  // Handle directory patterns
  if (normalizedPattern.endsWith('/')) {
    const dirPrefix = normalizedPattern.slice(0, -1);
    return normalizedPath === dirPrefix || normalizedPath.startsWith(dirPrefix + '/');
  }
  
  // Handle **/ patterns
  if (normalizedPattern.includes('**/')) {
    const parts = normalizedPattern.split('**/');
    const prefix = parts[0] || '';
    const suffix = parts[1] || '';
    
    // Simple check: path starts with prefix and ends with suffix
    if (prefix && !normalizedPath.startsWith(prefix)) return false;
    if (suffix && !normalizedPath.endsWith(suffix)) return false;
    
    // Check that the middle part exists
    const middleStart = prefix ? prefix.length : 0;
    const middleEnd = suffix ? normalizedPath.length - suffix.length : normalizedPath.length;
    const middlePart = normalizedPath.slice(middleStart, middleEnd);
    return middlePart.length >= 0; // Always true if we get here
  }
  
  // Handle * patterns (simple wildcards)
  if (normalizedPattern.includes('*')) {
    const patternParts = normalizedPattern.split('*').filter(part => part !== '');
    let currentPos = 0;
    
    for (const part of patternParts) {
      const foundPos = normalizedPath.indexOf(part, currentPos);
      if (foundPos === -1) return false;
      currentPos = foundPos + part.length;
    }
    return true;
  }
  
  // Exact match
  return normalizedPath === normalizedPattern;
}

export function isWhitelisted(relativePath: string): boolean {
  for (const pattern of PROFILE_BACKUP_WHITELIST) {
    if (matchesPattern(relativePath, pattern)) {
      return true;
    }
  }
  return false;
}

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

  // HOMEBACKUP1: Extract profile-related flags that apply to all subcommands
  const profileIndex = parts.indexOf('--home-profile');
  const profileMode = profileIndex >= 0;
  
  const scopeIndex = parts.indexOf('--scope');
  const scopeValue = scopeIndex >= 0 && scopeIndex + 1 < parts.length 
    ? parts[scopeIndex + 1]?.toLowerCase() 
    : undefined;
  
  const dryRun = parts.includes('--dry-run');

  switch (subcommand) {
    case 'create':
      return handleBackupCreate(parts.slice(1), { profileMode, scope: scopeValue, dryRun });
    case 'verify':
      return handleBackupVerify(parts.slice(1), { profileMode, scope: scopeValue });
    case 'list':
      return handleBackupList(parts.slice(1));
    case 'restore':
      return handleBackupRestore(parts.slice(1), { profileMode, scope: scopeValue });
    default:
      return {
        handled: true,
        exitCode: 1,
        response: `Unknown backup subcommand: ${subcommand}\nUsage: backup create|verify|list|restore [--home-profile] [--scope home|project|both] [--dry-run]`,
      };
  }
}

// HOMEBACKUP1: Options for profile backup
export interface ProfileBackupOptions {
  profileMode: boolean;
  scope?: string;
  dryRun?: boolean;
}

/**
 * Create a backup of .codebuddy/ directory
 */
async function handleBackupCreate(flags: string[], profileOpts?: ProfileBackupOptions): Promise<CommandHandlerResult> {
  const onlyConfig = flags.includes('--only-config');
  const noWorkspace = flags.includes('--no-include-workspace');
  const outputIdx = flags.indexOf('--output');
  const outputPath = outputIdx >= 0 ? flags[outputIdx + 1] : undefined;
  
  // HOMEBACKUP1: Profile backup options
  const doProfileBackup = profileOpts?.profileMode || false;
  const scope = profileOpts?.scope || (doProfileBackup ? 'home' : 'project');
  const dryRun = profileOpts?.dryRun || false;

  // Validate scope
  if (scope && !['home', 'project', 'both'].includes(scope)) {
    return {
      handled: true,
      exitCode: 1,
      response: `Invalid scope: ${scope}. Must be one of: home, project, both`,
    };
  }

  // Determine source paths based on scope
  const sources: { path: string; type: 'project' | 'home' }[] = [];
  
  if (scope === 'both' || scope === 'project') {
    const cwd = process.cwd();
    const sourcePath = join(cwd, '.codebuddy');
    if (existsSync(sourcePath)) {
      sources.push({ path: sourcePath, type: 'project' });
    }
  }
  
  if (scope === 'both' || scope === 'home') {
    if (existsSync(HOME_PROFILE_DIR)) {
      sources.push({ path: HOME_PROFILE_DIR, type: 'home' });
    }
  }

  if (sources.length === 0) {
    return {
      handled: true,
      exitCode: 1,
      response: scope === 'home' 
        ? `No home profile directory found at ${HOME_PROFILE_DIR}.`
        : `No .codebuddy/ directory found at ${join(process.cwd(), '.codebuddy')}. Create one with \`buddy --init\` first.`,
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

  // HOMEBACKUP1: Collect files from all sources
  const allSkipped: SkippedFile[] = [];
  const allFiles: CollectedFile[] = [];
  const sourceDescriptions: string[] = [];

  for (const source of sources) {
    const basePath = source.path;
    const relativeBase = source.type === 'home' ? HOME_PROFILE_DIR : join(process.cwd(), '.codebuddy');
    
    if (source.type === 'home') {
      // For home profile, use profile-specific collection with whitelist/blacklist
      const profileFiles = collectProfileFiles(
        basePath, 
        HOME_PROFILE_DIR, 
        { 
          maxFileSize: DEFAULT_MAX_FILE_SIZE,
          maxTotalSize: DEFAULT_MAX_TOTAL_SIZE,
        },
        allSkipped
      );
      allFiles.push(...profileFiles.files);
      sourceDescriptions.push(`${HOME_PROFILE_DIR} (profile)`);
    } else {
      // For project, use existing collection
      const projectFiles = collectFiles(basePath, basePath, { onlyConfig, noWorkspace }, allSkipped);
      allFiles.push(...projectFiles);
      sourceDescriptions.push(`${basePath} (project)`);
    }
  }

  if (allFiles.length === 0) {
    const sourceList = sourceDescriptions.join(', ');
    return {
      handled: true,
      exitCode: 1,
      response:
        `No files to back up in ${sourceList}. ` +
        `The directories are empty, or every file was skipped.` + (dryRun ? ' (dry run)' : ''),
    };
  }

  // HOMEBACKUP1: Check total size against limit
  const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > DEFAULT_MAX_TOTAL_SIZE) {
    return {
      handled: true,
      exitCode: 1,
      response: `Total backup size (${formatBackupSize(totalSize)}) exceeds maximum allowed size of ${formatBackupSize(DEFAULT_MAX_TOTAL_SIZE)}`,
    };
  }

  // Build manifest
  const manifest: BackupManifest & { scope?: string; profile?: boolean } = {
    version: '2.0.0', // HOMEBACKUP1: Bumped version for profile support
    createdAt: new Date().toISOString(),
    files: allFiles.map(f => ({
      path: f.relativePath,
      size: f.size,
      checksum: f.checksum,
    })),
    flags: {
      onlyConfig,
      includeWorkspace: !noWorkspace,
    },
    scope: scope !== 'project' ? scope : undefined,
    profile: doProfileBackup || scope === 'home' || scope === 'both' ? true : undefined,
  };

  // Generate backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const scopeSuffix = scope === 'home' ? '-profile' : scope === 'both' ? '-full' : '';
  const backupName = `codebuddy-backup-${timestamp}${scopeSuffix}.json`;
  const backupPath = join(backupDir, backupName);

  // HOMEBACKUP1: Dry run mode - list what would be backed up without writing
  if (dryRun) {
    const sourceList = sourceDescriptions.join(', ');
    const fileList = allFiles.length <= 12
      ? ` (${allFiles.map((file) => file.relativePath).join(', ')})`
      : '';
    const skippedLine = allSkipped.length === 0
      ? ''
      : `Skipped: ${allSkipped.length} (${allSkipped.map((item) => `${item.relativePath}: ${item.reason}`).join('; ')})`;

    return {
      handled: true,
      response: [
        `[DRY RUN] Would create backup: ${backupPath}`,
        `Source: ${sourceList}`,
        `Files: ${allFiles.length}${fileList}`,
        `Size: ${formatBackupSize(totalSize)}`,
        skippedLine,
        onlyConfig ? '(config only)' : '',
        noWorkspace ? '(workspace excluded)' : '',
        `Actual scope: ${scope}`,
      ].filter(Boolean).join('\n'),
    };
  }

  // Write backup as JSON (portable, no tar dependency needed)
  const backupData = {
    manifest,
    files: allFiles.map(f => ({ path: f.relativePath, content: f.content.toString('base64') })),
    totalSize,
    fileCount: allFiles.length,
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

  const fileList = allFiles.length <= 12
    ? ` (${allFiles.map((file) => file.relativePath).join(', ')})`
    : '';
  const skippedLine = allSkipped.length === 0
    ? ''
    : `Skipped: ${allSkipped.length} (${allSkipped.map((item) => `${item.relativePath}: ${item.reason}`).join('; ')})`;

  return {
    handled: true,
    response: [
      `Backup created: ${backupPath}`,
      `Source: ${sourceDescriptions.join(', ')}`,
      `Files: ${allFiles.length}${fileList}`,
      `Size: ${formatBackupSize(totalSize)}`,
      skippedLine,
      onlyConfig ? '(config only)' : '',
      noWorkspace ? '(workspace excluded)' : '',
      doProfileBackup ? `(profile backup: scope=${scope})` : '',
    ].filter(Boolean).join('\n'),
  };
}

/**
 * Verify a backup file
 */
async function handleBackupVerify(args: string[], _profileOpts?: ProfileBackupOptions): Promise<CommandHandlerResult> {
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
async function handleBackupRestore(args: string[], profileOpts?: ProfileBackupOptions): Promise<CommandHandlerResult> {
  const confirm = args.includes('--confirm');
  const filePath = args.find((arg) => arg !== '--confirm' && !arg.startsWith('--'));
  if (!filePath) {
    return {
      handled: true,
      exitCode: 1,
      response: 'Usage: backup restore <file> [--confirm] [--home-profile] [--scope home|project|both]',
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

  // HOMEBACKUP1: Determine restore scope from manifest or flags
  let restoreScope = profileOpts?.scope;
  let isProfileBackup = profileOpts?.profileMode;

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
    // HOMEBACKUP1: Support version 2.x for profile backups
    if (!isSupportedBackupVersion(manifest.version) && manifest.version !== '2.0.0') {
      return {
        handled: true,
        exitCode: 1,
        response:
          `Invalid backup ${fullPath}: unsupported backup format (need version 1.x or 2.x), got ${String(manifest.version)}`,
      };
    }

    // HOMEBACKUP1: Determine scope from manifest if not specified in flags
    const manifestScope = (manifest as BackupManifest & { scope?: string }).scope;
    const manifestProfile = (manifest as BackupManifest & { profile?: boolean }).profile;
    
    restoreScope = restoreScope || manifestScope || (manifestProfile ? 'home' : 'project');
    isProfileBackup = isProfileBackup || manifestProfile || restoreScope === 'home' || restoreScope === 'both';

    // Determine destination based on scope
    let destRoots: string[] = [];
    if (restoreScope === 'both' || restoreScope === 'project') {
      const projectDest = resolve(join(process.cwd(), '.codebuddy'));
      destRoots.push(projectDest);
    }
    if (restoreScope === 'both' || restoreScope === 'home') {
      destRoots.push(HOME_PROFILE_DIR);
    }
    
    if (destRoots.length === 0) {
      destRoots = [resolve(join(process.cwd(), '.codebuddy'))];
    }
    
    // TypeScript can't infer that destRoots[0] is defined, so we need to assert it
    const destRoot: string = destRoots[0]!;
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
          `This merges into ${destRoot}: archive files are overwritten, extra files are left in place.`,
          formatExtraFilesLine(extras) || 'No extra files are present.',
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
  return typeof version === 'string' && (/^1(\.|$)/.test(version) || /^2(\.|$)/.test(version));
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

// HOMEBACKUP1: Collect files from home profile with whitelist/blacklist and size limits
interface ProfileBackupLimits {
  maxFileSize: number;
  maxTotalSize: number;
}

interface ProfileBackupResult {
  files: CollectedFile[];
  totalSize: number;
}

function collectProfileFiles(
  dir: string,
  base: string,
  limits: ProfileBackupLimits,
  skipped: SkippedFile[] = [],
): ProfileBackupResult {
  const results: CollectedFile[] = [];
  let currentTotalSize = 0;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = fullPath.slice(base.length + 1).replace(/\\/g, '/');

      // Skip directories that are not in whitelist
      const isDir = typeof entry.isDirectory === 'function' && entry.isDirectory();
      const isSymlink = typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink();
      
      if (isSymlink) {
        skipped.push({ relativePath, reason: 'symbolic link' });
        continue;
      }

      // Always skip blacklisted files by name
      const filename = entry.name;
      if (isBlacklisted(filename)) {
        skipped.push({ relativePath, reason: 'blacklisted (secret file)' });
        continue;
      }

      // Only process files/directories that are whitelisted
      if (!isWhitelisted(relativePath) && !isDir) {
        // For files, they must be explicitly whitelisted
        if (!isDir) {
          skipped.push({ relativePath, reason: 'not in whitelist' });
          continue;
        }
      }

      if (isDir) {
        // For directories, check if any files within would be whitelisted
        const dirPrefix = relativePath.endsWith('/') ? relativePath : relativePath + '/';
        const hasWhitelistedDescendant = PROFILE_BACKUP_WHITELIST.some(pattern => {
          if (pattern.endsWith('/')) {
            // Directory pattern
            const patternPrefix = pattern.slice(0, -1);
            return dirPrefix.startsWith(patternPrefix + '/') || dirPrefix === patternPrefix + '/';
          } else if (pattern.includes('/')) {
            // Pattern with path
            const patternParts = pattern.split('/');
            const dirParts = dirPrefix.split('/');
            return dirParts[0] === patternParts[0];
          }
          return false;
        });

        if (hasWhitelistedDescendant) {
          // Recurse into directory if it might contain whitelisted files
          const dirResult = collectProfileFiles(fullPath, base, limits, skipped);
          const dirFiles = dirResult.files;
          const dirTotalSize = dirResult.totalSize;
          
          // Check if adding this directory would exceed the total size limit
          if (currentTotalSize + dirTotalSize <= limits.maxTotalSize) {
            results.push(...dirFiles);
            currentTotalSize += dirTotalSize;
          } else {
            // Add files until we hit the limit
            for (const file of dirFiles) {
              if (currentTotalSize + file.size <= limits.maxTotalSize) {
                results.push(file);
                currentTotalSize += file.size;
              } else {
                skipped.push({ 
                  relativePath: file.relativePath, 
                  reason: `exceeds total size limit (${formatBackupSize(limits.maxTotalSize)})` 
                });
              }
            }
          }
        } else {
          // Directory has no whitelisted content
          skipped.push({ relativePath, reason: 'directory not in whitelist' });
          continue;
        }
      } else {
        // It's a file
        try {
          const stat = statSync(fullPath);
          
          // Check file size limit
          if (stat.size > limits.maxFileSize) {
            skipped.push({ 
              relativePath, 
              reason: `larger than ${formatBackupSize(limits.maxFileSize)}` 
            });
            continue;
          }

          // Check total size limit
          if (currentTotalSize + stat.size > limits.maxTotalSize) {
            skipped.push({ 
              relativePath, 
              reason: `exceeds total size limit (${formatBackupSize(limits.maxTotalSize)})` 
            });
            continue;
          }

          // Read file content
          const content = readFileSync(fullPath);
          const checksum = fileChecksum(content);

          results.push({
            relativePath,
            size: stat.size,
            checksum,
            content,
          });
          
          currentTotalSize += stat.size;
        } catch {
          // Skip unreadable files
          skipped.push({ relativePath, reason: 'unreadable' });
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return { files: results, totalSize: currentTotalSize };
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
