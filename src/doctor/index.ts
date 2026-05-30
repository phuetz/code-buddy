import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export interface FixResult {
  success: boolean;
  message: string;
  action: string;
}

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fixable?: boolean;
  fix?: () => Promise<FixResult>;
}

function commandExists(cmd: string): boolean {
  try {
    const lookupCommand = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(lookupCommand, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getCommandAvailability(cmd: string): 'installed' | 'not found' {
  return commandExists(cmd) ? 'installed' : 'not found';
}

function checkNodeVersion(): DoctorCheck {
  const major = parseInt(process.version.slice(1), 10);
  if (major >= 18) {
    return { name: 'Node.js version', status: 'ok', message: `${process.version} (>= 18 required)` };
  }
  return { name: 'Node.js version', status: 'error', message: `${process.version} — Node.js >= 18 is required` };
}

function checkDependencies(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const required: Array<{ cmd: string; label: string; level: 'error' | 'warn' }> = [
    { cmd: 'rg', label: 'ripgrep (rg)', level: 'warn' },
    { cmd: 'sox', label: 'sox (voice input)', level: 'warn' },
    { cmd: 'rtk', label: 'RTK (token compressor)', level: 'warn' },
    { cmd: 'icm', label: 'ICM (infinite context memory)', level: 'warn' },
  ];

  for (const dep of required) {
    const availability = getCommandAvailability(dep.cmd);
    checks.push({
      name: dep.label,
      status: availability === 'installed' ? 'ok' : dep.level,
      message: availability,
    });
  }

  const audioPlayers = ['ffplay', 'aplay', 'mpv'];
  const found = audioPlayers.filter(cmd => commandExists(cmd));
  checks.push({
    name: 'Audio playback',
    status: found.length > 0 ? 'ok' : 'warn',
    message: found.length > 0 ? `available: ${found.join(', ')}` : 'no player found (install ffplay, aplay, or mpv)',
  });

  return checks;
}

function checkApiKeys(): DoctorCheck[] {
  const keys = ['GROK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'];
  return keys.map(key => ({
    name: `API key: ${key}`,
    status: process.env[key] ? 'ok' as const : 'warn' as const,
    message: process.env[key] ? 'set' : 'not set',
  }));
}

/**
 * ChatGPT Codex OAuth credentials check (Phase d.23). `warn` when no
 * credentials present (user might be using API keys instead — non-fatal).
 * `error` only when the file is corrupt or refresh fails.
 */
async function checkChatGptOAuth(): Promise<DoctorCheck> {
  try {
    const { hasCodexCredentials, getChatGptAuth, getCodexAuthFilePath } = await import(
      '../providers/codex-oauth.js'
    );
    if (!hasCodexCredentials()) {
      return {
        name: 'ChatGPT OAuth',
        status: 'warn',
        message: `not signed in (run \`/login chatgpt\` to use your ChatGPT subscription) — file: ${getCodexAuthFilePath()}`,
      };
    }
    const auth = await getChatGptAuth();
    if (!auth) {
      return {
        name: 'ChatGPT OAuth',
        status: 'error',
        message: `credential file present but unreadable — try \`/logout chatgpt\` then \`/login chatgpt\``,
      };
    }
    const parts: string[] = [];
    if (auth.email) parts.push(auth.email);
    if (auth.plan_type) parts.push(`Plan: ${auth.plan_type}`);
    if (auth.is_fedramp) parts.push('FedRAMP');
    return {
      name: 'ChatGPT OAuth',
      status: 'ok',
      message: parts.length > 0 ? parts.join(' · ') : 'signed in',
    };
  } catch (err) {
    return {
      name: 'ChatGPT OAuth',
      status: 'error',
      message: `check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkConfigFiles(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const codeBuddyDir = join(cwd, '.codebuddy');
  const dirExists = existsSync(codeBuddyDir);
  checks.push({
    name: '.codebuddy directory',
    status: dirExists ? 'ok' : 'warn',
    message: dirExists ? 'exists' : 'not found',
    fixable: !dirExists,
    fix: !dirExists ? async () => fixMissingCodebuddyDir(cwd) : undefined,
  });

  const configFile = join(cwd, '.codebuddy', 'config.json');
  checks.push({
    name: 'config.json',
    status: existsSync(configFile) ? 'ok' : 'warn',
    message: existsSync(configFile) ? 'exists' : 'not found',
  });

  // Check settings.json for corruption
  const settingsFile = join(cwd, '.codebuddy', 'settings.json');
  if (existsSync(settingsFile)) {
    const settingsCorrupt = isJsonCorrupted(settingsFile);
    checks.push({
      name: 'settings.json',
      status: settingsCorrupt ? 'error' : 'ok',
      message: settingsCorrupt ? 'corrupted (invalid JSON)' : 'valid',
      fixable: settingsCorrupt,
      fix: settingsCorrupt ? async () => fixCorruptedSettings(cwd) : undefined,
    });
  }

  // Check for config schema migration (missing required sections)
  if (existsSync(settingsFile) && !isJsonCorrupted(settingsFile)) {
    const needsMigration = checkSettingsMigration(settingsFile);
    if (needsMigration) {
      checks.push({
        name: 'settings.json schema',
        status: 'warn',
        message: 'uses legacy maxToolRounds field (migrate to maxRounds)',
        fixable: true,
        fix: async () => fixSettingsMigration(settingsFile),
      });
    }
  }

  return checks;
}

function checkStaleLockFiles(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const staleLockFiles = findStaleLockFiles(cwd);

  if (staleLockFiles.length > 0) {
    checks.push({
      name: 'Stale lock files',
      status: 'warn',
      message: `${staleLockFiles.length} stale lock file(s) found (>1h old)`,
      fixable: true,
      fix: async () => fixStaleLockFiles(staleLockFiles),
    });
  } else {
    checks.push({
      name: 'Stale lock files',
      status: 'ok',
      message: 'none found',
    });
  }

  return checks;
}

function checkTtsProviders(): DoctorCheck[] {
  const providers: Array<{ cmd: string; label: string }> = [
    { cmd: 'edge-tts', label: 'edge-tts' },
    { cmd: 'espeak', label: 'espeak' },
  ];

  const found = providers.filter(p => commandExists(p.cmd));

  try {
    // Check if kokoro-js is installed in workspace node_modules
    import.meta.resolve?.('kokoro-js');
    found.push({ cmd: 'kokoro', label: 'kokoro (npm)' });
  } catch {
    // ignore
  }

  return [{
    name: 'TTS providers',
    status: found.length > 0 ? 'ok' : 'warn',
    message: found.length > 0 ? `available: ${found.map(p => p.label).join(', ')}` : 'none found (install edge-tts, espeak or use kokoro via npm)',
  }];
}

function checkDiskSpace(cwd: string): DoctorCheck {
  try {
    const stats = statfsSync(cwd);
    const freeBytes = stats.bfree * stats.bsize;
    const freeGB = freeBytes / (1024 ** 3);
    if (freeGB < 1) {
      return { name: 'Disk space', status: 'warn', message: `${freeGB.toFixed(2)} GB free (< 1 GB)` };
    }
    return { name: 'Disk space', status: 'ok', message: `${freeGB.toFixed(1)} GB free` };
  } catch {
    return { name: 'Disk space', status: 'warn', message: 'unable to check' };
  }
}

function checkGit(cwd: string): DoctorCheck {
  if (!commandExists('git')) {
    return { name: 'Git', status: 'error', message: 'git not found' };
  }
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    return { name: 'Git', status: 'ok', message: 'installed, inside a git repo' };
  } catch {
    return { name: 'Git', status: 'warn', message: 'installed, but not inside a git repo' };
  }
}

// ============================================================================
// Fix helpers
// ============================================================================

const DEFAULT_SETTINGS = {
  maxRounds: 30,
  autonomyLevel: 'confirm',
  enableRAG: true,
  parallelTools: true,
  temperature: 0.7,
  enableCheckpoints: true,
  enableTelemetry: false,
};

function isJsonCorrupted(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    return false;
  } catch {
    return true;
  }
}

function checkSettingsMigration(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    return 'maxToolRounds' in parsed && !('maxRounds' in parsed);
  } catch {
    return false;
  }
}

function findStaleLockFiles(cwd: string): string[] {
  const staleFiles: string[] = [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  // Check common lock file locations
  const lockLocations = [
    join(cwd, '.codebuddy'),
    join(cwd, '.codebuddy', 'daemon'),
    join(cwd, '.codebuddy', 'sessions'),
  ];

  for (const dir of lockLocations) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.lock') || entry.endsWith('.pid')) {
          const fullPath = join(dir, entry);
          try {
            const stat = statSync(fullPath);
            if (stat.mtimeMs < oneHourAgo) {
              staleFiles.push(fullPath);
            }
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return staleFiles;
}

// ============================================================================
// Fix functions
// ============================================================================

async function fixMissingCodebuddyDir(cwd: string): Promise<FixResult> {
  const codeBuddyDir = join(cwd, '.codebuddy');
  try {
    mkdirSync(codeBuddyDir, { recursive: true });
    logger.info(`Created .codebuddy directory at ${codeBuddyDir}`);
    return {
      success: true,
      message: `Created .codebuddy directory at ${codeBuddyDir}`,
      action: 'create-codebuddy-dir',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to create .codebuddy directory: ${msg}`,
      action: 'create-codebuddy-dir',
    };
  }
}

async function fixCorruptedSettings(cwd: string): Promise<FixResult> {
  const settingsFile = join(cwd, '.codebuddy', 'settings.json');
  try {
    // Ensure directory exists
    const dir = join(cwd, '.codebuddy');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(settingsFile, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    logger.info(`Recreated settings.json with defaults at ${settingsFile}`);
    return {
      success: true,
      message: `Recreated settings.json with defaults`,
      action: 'recreate-settings',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to recreate settings.json: ${msg}`,
      action: 'recreate-settings',
    };
  }
}

async function fixSettingsMigration(filePath: string): Promise<FixResult> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    const merged = { ...parsed };
    if ('maxToolRounds' in merged && !('maxRounds' in merged)) {
      merged.maxRounds = merged.maxToolRounds;
      delete merged.maxToolRounds;
    }
    writeFileSync(filePath, JSON.stringify(merged, null, 2));
    logger.info(`Migrated settings.json schema at ${filePath}`);
    return {
      success: true,
      message: 'Migrated maxToolRounds to maxRounds in settings.json',
      action: 'migrate-settings-schema',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to migrate settings.json: ${msg}`,
      action: 'migrate-settings-schema',
    };
  }
}

async function fixStaleLockFiles(lockFiles: string[]): Promise<FixResult> {
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const file of lockFiles) {
    try {
      unlinkSync(file);
      deleted.push(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${file}: ${msg}`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      message: `Deleted ${deleted.length}/${lockFiles.length} lock files. Errors: ${errors.join('; ')}`,
      action: 'delete-stale-locks',
    };
  }

  logger.info(`Deleted ${deleted.length} stale lock file(s)`);
  return {
    success: true,
    message: `Deleted ${deleted.length} stale lock file(s)`,
    action: 'delete-stale-locks',
  };
}

// ============================================================================
// Public API
// ============================================================================

export async function runDoctorChecks(cwd?: string): Promise<DoctorCheck[]> {
  const dir = cwd ?? process.cwd();
  return [
    checkNodeVersion(),
    ...checkDependencies(),
    ...checkApiKeys(),
    await checkChatGptOAuth(),
    ...checkConfigFiles(dir),
    ...checkStaleLockFiles(dir),
    ...checkTtsProviders(),
    checkDiskSpace(dir),
    checkGit(dir),
  ];
}

export async function runFixes(checks: DoctorCheck[]): Promise<FixResult[]> {
  const results: FixResult[] = [];
  for (const check of checks) {
    if (check.fixable && check.fix) {
      try {
        const result = await check.fix();
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          success: false,
          message: `Unexpected error fixing "${check.name}": ${msg}`,
          action: 'unknown',
        });
      }
    }
  }
  return results;
}
