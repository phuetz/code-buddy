import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { getFreeSpaceInfo } from '../utils/disk-guard.js';
import { SERVER_CONFIG } from '../config/constants.js';
import { diagnoseServerExposure } from '../server/exposure-diagnostic.js';
import { loadBetterSqlite3, SQLITE_INSTALL_GUIDANCE } from '../database/optional-sqlite.js';
import type { UserSettings } from '../utils/settings-manager.js';

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
  /**
   * A genuinely optional capability (a tool you install only to use one
   * feature). When absent it must NOT inflate the warning count — a fresh
   * machine with only optional tools missing is healthy, and a health-check
   * that keys on the warning total should read it as such.
   */
  optional?: boolean;
}

export interface DoctorSummary {
  passed: number;
  /** Warnings that need attention — excludes absent optional capabilities. */
  warnings: number;
  errors: number;
  /** Optional capabilities not installed — informational, not a warning. */
  optionalNotInstalled: number;
}

/**
 * Aggregate checks into the summary. An optional capability that is absent
 * (status 'warn' + optional) is counted as informational, never as a warning,
 * so `doctor` on a fresh machine reports 0 warnings for missing optional tools.
 */
export function summarizeDoctorChecks(checks: DoctorCheck[]): DoctorSummary {
  let passed = 0;
  let warnings = 0;
  let errors = 0;
  let optionalNotInstalled = 0;
  for (const check of checks) {
    if (check.status === 'error') errors += 1;
    else if (check.status === 'ok') passed += 1;
    else if (check.optional) optionalNotInstalled += 1;
    else warnings += 1;
  }
  return { passed, warnings, errors, optionalNotInstalled };
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
  if (major < 18) {
    return { name: 'Node.js version', status: 'error', message: `${process.version} — Node.js >= 18 is required` };
  }
  if (major < 22) {
    return {
      name: 'Node.js version',
      status: 'warn',
      message: `${process.version} — OK for the CLI (>= 18), but the Cowork desktop app needs >= 22`,
    };
  }
  return { name: 'Node.js version', status: 'ok', message: `${process.version} (CLI >= 18 and Cowork >= 22 OK)` };
}

// The SQLite layer (memory/sessions/cache/analytics) is a native module. On a
// platform without a matching prebuilt binary, `npm install` may have failed to
// build it — surface that here clearly instead of crashing a DB feature later.
async function checkNativeSqlite(): Promise<DoctorCheck> {
  try {
    const DatabaseConstructor = await loadBetterSqlite3();
    const probe = new DatabaseConstructor(':memory:');
    probe.close();
    return { name: 'SQLite (better-sqlite3)', status: 'ok', message: 'native module available' };
  } catch {
    return {
      name: 'SQLite (better-sqlite3)',
      status: 'warn',
      message:
        'native module unavailable — sessions remain persisted as JSON files, but DB-backed memory, cache, and indexed search are disabled. ' +
        SQLITE_INSTALL_GUIDANCE,
    };
  }
}

function checkDependencies(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // Optionality is INTRINSIC to the tool, never derived from whether it is
  // installed: deriving `optional: !installed` would silently reclassify ANY
  // absent tool added here as informational — reintroducing, through the side
  // door, the exact defect this flag fixes. A genuinely required tool added to
  // this list must carry `optional: false` so its absence still counts.
  const externalTools: Array<{
    cmd: string;
    label: string;
    level: 'error' | 'warn';
    optional: boolean;
    missingMessage: string;
  }> = [
    {
      cmd: 'rg',
      label: 'ripgrep (rg)',
      level: 'warn',
      optional: true,
      missingMessage: 'not found — optional; install ripgrep for faster file search',
    },
    {
      cmd: 'sox',
      label: 'sox (voice input)',
      level: 'warn',
      optional: true,
      missingMessage: 'not found — optional; install SoX only to use voice input',
    },
    {
      cmd: 'rtk',
      label: 'RTK (token compressor)',
      level: 'warn',
      optional: true,
      missingMessage: 'not found — optional; install RTK only to use token compression',
    },
    {
      cmd: 'icm',
      label: 'ICM (infinite context memory)',
      level: 'warn',
      optional: true,
      missingMessage: 'not found — optional; install ICM only to use infinite-context memory',
    },
  ];

  for (const dep of externalTools) {
    const installed = getCommandAvailability(dep.cmd) === 'installed';
    checks.push({
      name: dep.label,
      status: installed ? 'ok' : dep.level,
      message: installed ? 'installed' : dep.missingMessage,
      optional: dep.optional,
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
  const providers = [
    { label: 'GROK_API_KEY / XAI_API_KEY', variables: ['GROK_API_KEY', 'XAI_API_KEY'] },
    { label: 'OPENAI_API_KEY', variables: ['OPENAI_API_KEY'] },
    { label: 'ANTHROPIC_API_KEY', variables: ['ANTHROPIC_API_KEY'] },
    { label: 'GEMINI_API_KEY / GOOGLE_API_KEY', variables: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
  ];
  return providers.map(provider => {
    const configuredVariable = provider.variables.find(variable => process.env[variable]);
    return {
      name: `API key: ${provider.label}`,
      status: 'ok' as const,
      message: configuredVariable
        ? `set (${configuredVariable})`
        : 'not set (optional; use provider login, a local model, or set this provider key)',
    };
  });
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
        message: `not signed in (run \`buddy login\` to use your ChatGPT subscription) — file: ${getCodexAuthFilePath()}`,
      };
    }
    const auth = await getChatGptAuth();
    if (!auth) {
      return {
        name: 'ChatGPT OAuth',
        status: 'error',
        message: 'credential file present but unreadable — try `buddy logout chatgpt` then `buddy login`',
      };
    }
    const {
      CHATGPT_OAUTH_DEFAULT_MODEL,
      CHATGPT_OAUTH_SAFE_FALLBACK_MODEL,
      discoverChatGptModels,
      selectChatGptOAuthModel,
    } = await import('../providers/chatgpt-models.js');
    const catalog = await discoverChatGptModels(auth);
    const selectedModel = selectChatGptOAuthModel(CHATGPT_OAUTH_DEFAULT_MODEL, catalog);
    const parts: string[] = [];
    if (auth.email) parts.push(auth.email);
    if (auth.plan_type) parts.push(`Plan: ${auth.plan_type}`);
    if (auth.is_fedramp) parts.push('FedRAMP');
    parts.push(`Model: ${selectedModel}`);
    if (!catalog) parts.push(`discovery unavailable; safe fallback: ${CHATGPT_OAUTH_SAFE_FALLBACK_MODEL}`);
    return {
      name: 'ChatGPT OAuth',
      status: catalog ? 'ok' : 'warn',
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
    name: '.codebuddy/config.json (legacy)',
    status: 'ok',
    message: existsSync(configFile)
      ? 'exists'
      : 'not present (optional; current configuration uses settings.json or config.toml profiles)',
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

export function checkTtsProviders(): DoctorCheck[] {
  const pocketLauncher = ['pocket-tts', 'uvx'].find((command) => commandExists(command));
  const available: string[] = [];
  if (pocketLauncher) available.push(`Pocket TTS (via ${pocketLauncher})`);
  if (process.env.ELEVENLABS_API_KEY?.trim()) {
    available.push('ElevenLabs (ELEVENLABS_API_KEY)');
  }

  return [{
    name: 'TTS providers',
    status: available.length > 0 ? 'ok' : 'warn',
    message: available.length > 0
      ? `available: ${available.join(', ')}`
      : 'none found — use `buddy speak --engine pocket` with Pocket TTS (pip install pocket-tts), or configure ElevenLabs with ELEVENLABS_API_KEY',
  }];
}

function checkDiskSpace(cwd: string): DoctorCheck {
  // Single source of truth (disk-guard). Uses bavail — free space actually
  // available to a non-root process — rather than bfree.
  const info = getFreeSpaceInfo(cwd);
  if (info === null) {
    return { name: 'Disk space', status: 'warn', message: 'unable to check' };
  }
  const freeGB = info.freeBytes / (1024 ** 3);
  if (freeGB < 1) {
    return { name: 'Disk space', status: 'warn', message: `${freeGB.toFixed(2)} GB free (< 1 GB)` };
  }
  return { name: 'Disk space', status: 'ok', message: `${freeGB.toFixed(1)} GB free` };
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

/**
 * Check the server configuration derived from environment/defaults. Explicit
 * CLI flags are diagnosed again from the effective config when the server
 * starts, so Fleet/A2A launches remain supported and observable.
 */
export function checkServerExposureEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DoctorCheck {
  const host = env.HOST || SERVER_CONFIG.DEFAULT_HOST;
  const authEnabled = env.NODE_ENV === 'production' ? true : env.AUTH_ENABLED !== 'false';
  const diagnostic = diagnoseServerExposure({ host, authEnabled });

  return {
    name: 'Server network exposure',
    status: diagnostic.unsafe ? 'warn' : 'ok',
    message: diagnostic.message,
  };
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
// Provider readiness — the ONE thing a newcomer needs answered
// ============================================================================

export type OllamaSelectionSettings = Pick<UserSettings, 'model' | 'defaultModel'>;

function advertisedModel(models: readonly string[], requested: string | undefined): string | undefined {
  const normalized = requested?.trim().toLowerCase();
  if (!normalized) return undefined;
  return models.find((model) => model.trim().toLowerCase() === normalized);
}

/** Pick a model that Ollama actually advertised, preserving its tag spelling. */
export function resolveOllamaModel(
  models: readonly string[],
  settings: OllamaSelectionSettings = {},
): string | undefined {
  return (
    advertisedModel(models, settings.model) ??
    advertisedModel(models, settings.defaultModel) ??
    models.find((model) => model.trim())
  );
}

/** Both persisted model fields must point at a model currently served by Ollama. */
export function isOllamaSelectionCurrent(
  models: readonly string[],
  settings: OllamaSelectionSettings = {},
): boolean {
  return Boolean(
    advertisedModel(models, settings.model) && advertisedModel(models, settings.defaultModel),
  );
}

/**
 * Answer "can `buddy` actually talk to a model on the next run?" — the single
 * most important diagnostic for someone who just installed. It distinguishes
 * "a brain is reachable" (a live Ollama on localhost) from "buddy is pointed at
 * it" (env var / onboarded settings / OAuth / API key), because a running
 * Ollama that was never selected still dead-ends the first chat.
 */
async function checkProviderReadiness(): Promise<DoctorCheck> {
  const { detectEnvironment } = await import('../wizard/environment-detection.js');
  const snap = await detectEnvironment();

  const oauthOrKey = snap.capabilities.some(
    (c) => c.available && (c.kind === 'oauth' || c.kind === 'api-key'),
  );
  const ollama = snap.capabilities.find((c) => c.id === 'ollama');
  const ollamaModels = ollama?.models?.length ?? 0;

  let userSettings: (UserSettings & OllamaSelectionSettings) | undefined;
  try {
    const { getSettingsManager } = await import('../utils/settings-manager.js');
    userSettings = getSettingsManager().loadUserSettings();
  } catch {
    /* settings unreadable — treat as not onboarded */
  }
  const p = (userSettings?.provider || '').toLowerCase();
  const onboardedLocal = p === 'ollama' || p === 'lmstudio';
  const envLocal = Boolean(process.env.OLLAMA_HOST || process.env.LMSTUDIO_HOST);
  const ollamaExplicitlySelected = Boolean(process.env.OLLAMA_HOST) || p === 'ollama';
  const liveOllamaModel = ollama?.available && ollama.baseURL
    ? resolveOllamaModel(ollama.models ?? [], userSettings)
    : undefined;

  if (
    ollamaExplicitlySelected &&
    liveOllamaModel &&
    ollama?.baseURL &&
    !isOllamaSelectionCurrent(ollama.models ?? [], userSettings)
  ) {
    const savedModel = userSettings?.defaultModel ?? userSettings?.model ?? 'none';
    return {
      name: 'AI provider ready',
      status: 'warn',
      message: `Ollama is running (${ollamaModels} model${ollamaModels === 1 ? '' : 's'}) but saved model ${savedModel} is not currently advertised — --fix to select ${liveOllamaModel} ($0)`,
      fixable: true,
      fix: async () => fixSelectRunningOllama(ollama.baseURL!, liveOllamaModel),
    };
  }

  const configured = oauthOrKey || ((envLocal || onboardedLocal) && ollamaModels > 0);

  if (configured) {
    const rec = snap.recommended;
    return {
      name: 'AI provider ready',
      status: 'ok',
      message: rec ? `${rec.label} — ${rec.detail}` : 'a provider is configured',
    };
  }

  if (ollama?.available && ollamaModels > 0 && ollama.baseURL) {
    const model = ollama.models![0]!;
    const baseURL = ollama.baseURL;
    return {
      name: 'AI provider ready',
      status: 'warn',
      message: `Ollama is running (${ollamaModels} model${ollamaModels === 1 ? '' : 's'}) but not selected — run \`buddy onboard\`, or --fix to select ${model} ($0)`,
      fixable: true,
      fix: async () => fixSelectRunningOllama(baseURL, model),
    };
  }

  if (ollama?.available && ollama.baseURL) {
    const baseURL = ollama.baseURL;
    return {
      name: 'AI provider ready',
      status: 'warn',
      message: 'Ollama is running but has no model — run `buddy onboard`, or --fix to pull qwen2.5-coder:7b ($0)',
      fixable: true,
      fix: async () => fixPullAndSelectOllama(baseURL),
    };
  }

  return {
    name: 'AI provider ready',
    status: 'warn',
    message: 'no provider configured — run `buddy onboard` (guided) or `buddy login` (ChatGPT subscription, $0)',
  };
}

/** Point buddy at an already-running Ollama by writing user-settings (no download). */
async function fixSelectRunningOllama(baseURL: string, model: string): Promise<FixResult> {
  try {
    const { getSettingsManager } = await import('../utils/settings-manager.js');
    getSettingsManager().saveUserSettings({ provider: 'ollama', baseURL, model, defaultModel: model });
    return {
      success: true,
      message: `Selected local Ollama model ${model} (written to user-settings.json) — try: buddy try`,
      action: 'select-running-ollama',
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to write provider selection: ${err instanceof Error ? err.message : String(err)}`,
      action: 'select-running-ollama',
    };
  }
}

/** Pull a small coding model with Ollama, then select it. */
async function fixPullAndSelectOllama(baseURL: string): Promise<FixResult> {
  const model = 'qwen2.5-coder:7b';
  try {
    execSync(`ollama pull ${model}`, { stdio: 'inherit' });
  } catch (err) {
    return {
      success: false,
      message: `Failed to pull ${model}: ${err instanceof Error ? err.message : String(err)}. Install Ollama from https://ollama.ai`,
      action: 'pull-ollama-model',
    };
  }
  return fixSelectRunningOllama(baseURL, model);
}

// ============================================================================
// Public API
// ============================================================================

export async function runDoctorChecks(cwd?: string): Promise<DoctorCheck[]> {
  const dir = cwd ?? process.cwd();
  const { checkLlmKeysLive } = await import('./llm-key-check.js');
  return [
    await checkProviderReadiness(),
    checkNodeVersion(),
    await checkNativeSqlite(),
    ...checkDependencies(),
    ...checkApiKeys(),
    // Validation LIVE des clés configurées (endpoint /models, 0 token) :
    // distingue clé invalide (401/403 → error) de quota épuisé (429 → warn).
    ...(await checkLlmKeysLive()),
    await checkChatGptOAuth(),
    ...checkConfigFiles(dir),
    // Accidents de collage dans .env (commande shell, guillemets, doublons) —
    // détectés sans jamais afficher les valeurs. src/doctor/env-sanity.ts.
    ...(await import('./env-sanity.js')).checkEnvSanity(dir),
    ...checkStaleLockFiles(dir),
    ...checkTtsProviders(),
    checkServerExposureEnvironment(),
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
