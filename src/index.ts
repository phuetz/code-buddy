#!/usr/bin/env node
// Record startup time as early as possible
const STARTUP_TIME = Date.now();

import { Option, program } from "commander";
import { readFileSync } from "fs";
import * as nodeFs from "fs";
import * as nodeOs from "os";
import * as nodePath from "path";
import { join, dirname } from "path";
import { globalAgent as httpGlobalAgent } from 'node:http';
import { globalAgent as httpsGlobalAgent } from 'node:https';

// Types for dynamically imported modules
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import type { SecurityMode } from "./security/security-modes.js";
import type { CustomAgentConfig } from "./agent/custom/custom-agent-loader.js";

import { fileURLToPath } from 'url';
import { resolveHeadlessOutputFormat, resolveHeadlessResultExitCode } from './cli/headless-options.js';
import { resolveCliModelList } from './cli/model-listing.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const launchCwd = process.cwd();

// Mark this process as running inside the Code Buddy CLI
process.env.CODEBUDDY_CLI = '1';
process.env.CODEBUDDY_CLI_VERSION = packageJson.version;

// Import logger statically since it's used throughout the file synchronously
import { logger } from "./utils/logger.js";
// Import graceful shutdown for clean application termination
import {
  initializeGracefulShutdown,
  getShutdownManager,
} from "./utils/graceful-shutdown.js";
import { sweepStaleCodebuddyTemp } from "./utils/disk-guard.js";

/**
 * CLI output helper.
 *
 * Prior to the F4 cleanup this file used `console.*` ~97 times, which
 * violated the CLAUDE.md rule that production code must go through the
 * `logger` (tests spy on `logger.warn` for assertions). Wrapping behind
 * `cli.*` gives us:
 *   - `cli.info` / `cli.warn` / `cli.error` → delegated to `logger` so log
 *     level, LOG_FILE, and test spies all work uniformly.
 *   - `cli.stdout` → raw `process.stdout.write` for pipeable output
 *     (`buddy list-models`, `--output json`, tool results). These MUST
 *     stay on stdout because users pipe them into other tools; routing
 *     them through the logger would send them to stderr.
 */
const cli = {
  info: (msg: string) => logger.info(msg),
  warn: (msg: string) => logger.warn(msg),
  error: (msg: string, err?: unknown) => {
    if (err !== undefined) {
      logger.error(msg, { error: err instanceof Error ? err.message : String(err) });
    } else {
      logger.error(msg);
    }
  },
  stdout: (msg: string) => process.stdout.write(msg + '\n'),
};

// CLI command modules are loaded lazily below (see registerLazyCommands)
// to avoid importing heavy transitive dependencies at startup.

// Startup timing (enabled via PERF_TIMING=true or DEBUG=true)
const PERF_TIMING = process.env.PERF_TIMING === 'true' || process.env.DEBUG === 'true';
const startupPhases: { name: string; time: number }[] = [];

function recordStartupPhase(name: string): void {
  if (!PERF_TIMING) return;
  startupPhases.push({ name, time: Date.now() - STARTUP_TIME });
}

function logStartupMetrics(): void {
  if (!PERF_TIMING || startupPhases.length === 0) return;
  cli.info('\n=== Startup Performance ===');
  cli.info(`Total time: ${Date.now() - STARTUP_TIME}ms`);
  cli.info('Phase breakdown:');
  for (const phase of startupPhases) {
    cli.info(`  ${phase.name}: ${phase.time}ms`);
  }
  cli.info('===========================\n');
}

recordStartupPhase('imports-start');

recordStartupPhase('imports-done');

// ============================================================================
// Lazy Import System - Defer heavy modules until needed
// ============================================================================

// Cached lazy imports - only loaded once when first accessed
const lazyModuleCache: Map<string, unknown> = new Map();

async function lazyLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (lazyModuleCache.has(key)) {
    return lazyModuleCache.get(key) as T;
  }
  const startTime = PERF_TIMING ? Date.now() : 0;
  const module = await loader();
  if (PERF_TIMING) {
    const loadTime = Date.now() - startTime;
    if (loadTime > 50) { // Only log slow loads
      recordStartupPhase(`lazy:${key} (${loadTime}ms)`);
    }
  }
  lazyModuleCache.set(key, module);
  return module;
}

// Lazy imports for heavy modules - only loaded when needed
const lazyImport = {
  // UI modules - heavy, only needed for interactive mode
  React: () => lazyLoad('react', () => import("react")),
  ink: () => lazyLoad('ink', () => import("ink")),
  ChatInterface: () => lazyLoad('ChatInterface', () => import("./ui/components/ChatInterface.js").then(m => m.default)),

  // Core agent - heavy, needed for all operations
  CodeBuddyAgent: () => lazyLoad('CodeBuddyAgent', () => import("./agent/codebuddy-agent.js").then(m => m.CodeBuddyAgent)),

  // Utilities - medium weight
  ConfirmationService: () => lazyLoad('ConfirmationService', () => import("./utils/confirmation-service.js").then(m => m.ConfirmationService)),
  settingsManager: () => lazyLoad('settingsManager', () => import("./utils/settings-manager.js").then(m => m.getSettingsManager)),
  credentialManager: () => lazyLoad('credentialManager', () => import("./security/credential-manager.js").then(m => m.getCredentialManager)),

  // Commands - only loaded when their command is run
  initProject: () => lazyLoad('initProject', () => import("./utils/init-project.js")),
  securityModes: () => lazyLoad('securityModes', () => import("./security/security-modes.js")),
  contextLoader: () => lazyLoad('contextLoader', () => import("./context/context-loader.js")),
  renderers: () => lazyLoad('renderers', () => import("./renderers/index.js")),
  performance: () => lazyLoad('performance', () => import("./performance/index.js")),
  pluginManager: () => lazyLoad('pluginManager', () => import("./plugins/plugin-manager.js")),
  lazyLoader: () => lazyLoad('lazyLoader', () => import("./performance/lazy-loader.js")),

  // Settings hierarchy - loaded early for configuration
  settingsHierarchy: () => lazyLoad('settingsHierarchy', () => import('./config/settings-hierarchy.js').then(m => m.getSettingsHierarchy)),

  // Error handling - deferred until needed
  crashHandler: () => lazyLoad('crashHandler', () => import('./errors/crash-handler.js').then(m => m.getCrashHandler())),
  disposable: () => lazyLoad('disposable', () => import('./utils/disposable.js')),

  // Environment - load early but still lazy
  dotenv: () => lazyLoad('dotenv', () => import('dotenv')),
};

// ============================================================================
// Minimal startup - defer everything possible
// ============================================================================

// Load environment variables lazily (but early)
let envLoaded = false;
async function ensureEnvLoaded(): Promise<void> {
  if (!envLoaded) {
    const dotenv = await lazyImport.dotenv();
    // Always load .env from the launch directory first so `--directory`
    // does not accidentally drop API keys from the caller workspace.
    dotenv.config({ path: join(launchCwd, '.env') });

    // If cwd changed after launch and has its own .env, load it too
    // (without overriding already-populated environment variables).
    if (process.cwd() !== launchCwd) {
      dotenv.config();
    }
    envLoaded = true;

    // Configure HTTP proxy from env vars (HTTP_PROXY, HTTPS_PROXY, NO_PROXY)
    try {
      const { configureProxy } = await import('./utils/proxy-support.js');
      configureProxy();
    } catch (_proxyErr) {
      // Proxy setup is optional — if the module fails to load, proceed without proxy
    }
  }
}

// Minimal logger for startup errors (no chalk dependency)
const startupLogger = {
  error: (msg: string, err?: unknown) => {
    cli.error(msg, err instanceof Error ? err.message : err);
  },
  warn: (msg: string) => cli.warn(msg),
};

// ============================================================================
// Process Signal Handlers - Using Graceful Shutdown Manager
// ============================================================================

// Initialize graceful shutdown system with 30s timeout
const _shutdownManager = initializeGracefulShutdown({
  timeoutMs: 30000, // 30 seconds max before force exit
  forceExitOnTimeout: true,
  showProgress: true,
});

// Startup janitor: remove our own stale /tmp scratch dirs left by crashed or
// SIGKILL'd runs (the durable backstop for the disk-leak class that caused the
// 2026-06-17 ENOSPC — see src/utils/disk-guard.ts). Age-gated; never throws.
sweepStaleCodebuddyTemp();

// Note: SIGINT, SIGTERM, SIGHUP are now handled by GracefulShutdownManager
// The manager will:
// 1. Wait for pending operations to complete
// 2. Save session state
// 3. Restore terminal
// 4. Close MCP connections
// 5. Close database connections
// 6. Flush logs
// 7. Exit cleanly (or force exit after timeout)

// Handle uncaught exceptions with crash recovery
process.on("uncaughtException", async (error) => {
  let crashFile: string | null = null;
  try {
    const crashHandler = await lazyImport.crashHandler();
    crashFile = crashHandler.handleCrash(error, "Uncaught exception");
  } catch (_err) {
    // Intentionally ignored: crash handler itself may fail during fatal error recovery
  }

  startupLogger.error("\nUnexpected error occurred:", error);
  if (crashFile) {
    startupLogger.error(`\nCrash context saved to: ${crashFile}`);
    startupLogger.error("You can resume your session with: buddy --resume");
  }

  // Use graceful shutdown with error exit code
  try {
    await getShutdownManager().shutdown({ exitCode: 1, showProgress: false });
  } catch (_err) {
    // Intentionally ignored: shutdown itself failed, force exit as last resort
    process.exit(1);
  }
});

process.on("unhandledRejection", async (reason, _promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  let crashFile: string | null = null;
  try {
    const crashHandler = await lazyImport.crashHandler();
    crashFile = crashHandler.handleCrash(error, "Unhandled rejection");
  } catch (_err) {
    // Intentionally ignored: crash handler itself may fail during fatal error recovery
  }

  startupLogger.error("\nUnhandled promise rejection:", error);
  if (crashFile) {
    startupLogger.error(`\nCrash context saved to: ${crashFile}`);
    startupLogger.error("You can resume your session with: buddy --resume");
  }

  // Use graceful shutdown with error exit code
  try {
    await getShutdownManager().shutdown({ exitCode: 1, showProgress: false });
  } catch (_err) {
    // Intentionally ignored: shutdown itself failed, force exit as last resort
    process.exit(1);
  }
});

// ============================================================================
// Settings and Credential Loading - Now async with lazy imports
// ============================================================================

// Ensure user settings are initialized and hierarchy is loaded
async function ensureUserSettingsDirectory(): Promise<void> {
  try {
    const getSettingsManager = await lazyImport.settingsManager();
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch (_err) {
    logger.debug('Failed to initialize user settings directory', { error: _err });
  }

  // Load the 3-level settings hierarchy:
  //   ~/.codebuddy/settings.json  <  .codebuddy/settings.json  <  .codebuddy/settings.local.json
  try {
    const getSettingsHierarchy = await lazyImport.settingsHierarchy();
    const hierarchy = getSettingsHierarchy();
    hierarchy.loadAllLevels();
    logger.debug('Settings hierarchy loaded successfully');
  } catch (_err) {
    logger.debug('Failed to load settings hierarchy', { error: _err });
  }
}

// Detected provider configuration — moved to `src/utils/provider-detector.ts`
// (Phase d.25) so it can be unit-tested in isolation. Re-exported here
// for the rest of this file's call sites.
import { detectProviderFromEnv, type DetectedProvider } from './utils/provider-detector.js';

// Legacy inline implementation kept commented for git-archaeology only.
function _detectProviderFromEnvLegacy(): DetectedProvider | null {
  // Priority order (mirror of src/fleet/peer-chat-client-factory.ts —
  // explicit user intent first, then local, then cloud env keys):
  //   0. CODEBUDDY_PROVIDER override (always wins when set + valid)
  //   1. ChatGPT OAuth credentials present (~/.codebuddy/codex-auth.json) —
  //      explicit "I logged in" act, beats ambient OLLAMA_HOST
  //   2. OLLAMA_HOST    → ollama (local, free, unlimited)
  //   3. GROK_API_KEY   → grok / OpenAI-compat
  //   4. GEMINI/GOOGLE  → gemini
  //   5. OPENAI         → openai
  //   6. ANTHROPIC      → anthropic

  const override = process.env.CODEBUDDY_PROVIDER?.toLowerCase();

  // ChatGPT subscription auth — explicit login wins over ambient
  // env-detected providers. User who ran `buddy login chatgpt` recently
  // expects subsequent calls to route through their ChatGPT plan, not
  // get hijacked by an OLLAMA_HOST set in their shell rc weeks ago.
  // Inline the file-existence check rather than importing codex-oauth
  // (this function is sync; the module is async-safe).
  if (override === 'chatgpt' || !override) {
    try {
      const fs = nodeFs;
      const path = nodePath;
      const os = nodeOs;
      const authPath = path.join(os.homedir(), '.codebuddy', 'codex-auth.json');
      if (fs.existsSync(authPath)) {
        const raw = fs.readFileSync(authPath, 'utf-8').trim();
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.tokens?.access_token) {
          return {
            provider: 'chatgpt',
            apiKey: 'oauth-chatgpt', // sentinel consumed by CodeBuddyClient
            baseURL: 'https://chatgpt.com/backend-api/codex',
            defaultModel: process.env.CHATGPT_MODEL || 'gpt-5.5',
          };
        }
      }
    } catch (err) {
      logger.debug('Ignoring unreadable ChatGPT OAuth credentials during provider detection', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if ((override === 'ollama' || (!override && process.env.OLLAMA_HOST))) {
    let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
    if (!host.endsWith('/v1')) host = host.replace(/\/+$/, '') + '/v1';
    return {
      provider: 'ollama',
      apiKey: 'ollama', // placeholder — Ollama OpenAI-compat ignores it
      baseURL: host,
      defaultModel: process.env.GROK_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    };
  }

  if (
    (override === 'grok' || override === 'xai') ||
    (!override && (process.env.GROK_API_KEY || process.env.XAI_API_KEY))
  ) {
    return {
      provider: 'grok',
      apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
      baseURL: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
      defaultModel: process.env.GROK_MODEL || 'grok-3-fast',
    };
  }

  if (
    (override === 'gemini' || override === 'google') ||
    (!override && (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY))
  ) {
    return {
      provider: 'gemini',
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com/v1',
      defaultModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    };
  }

  return null;
}

// Cache detected provider
let cachedProvider: DetectedProvider | null | undefined = undefined;

async function getDetectedProvider(): Promise<DetectedProvider | null> {
  if (cachedProvider !== undefined) return cachedProvider;

  await ensureEnvLoaded();
  cachedProvider = detectProviderFromEnv();

  // xAI subscription login (`buddy login xai`). Token load + refresh is async,
  // so it can't live in the sync env detector. A valid login takes precedence
  // over an ambient local/env provider (mirrors ChatGPT-login precedence) — but
  // ONLY when the token actually resolves, so a stale login never strands a
  // working provider. Without this, `buddy login xai` stored tokens the runtime
  // never consumed.
  {
    const xaiOverride = process.env.CODEBUDDY_PROVIDER?.toLowerCase();
    const xaiWanted =
      xaiOverride === 'xai' ||
      (!xaiOverride &&
        cachedProvider?.provider !== 'chatgpt' &&
        !process.env.GROK_API_KEY &&
        !process.env.XAI_API_KEY);
    if (xaiWanted) {
      try {
        const { hasXaiCredentials, getValidXaiAccessToken } = await import(
          './providers/xai-oauth.js'
        );
        if (hasXaiCredentials()) {
          const token = await getValidXaiAccessToken();
          if (token) {
            cachedProvider = {
              provider: 'grok',
              apiKey: token,
              baseURL: 'https://api.x.ai/v1',
              // grok-4-latest is an alias of the current flagship grok-4.3
              // (verified accessible on the SuperGrok plan; Hermes defaults here too).
              defaultModel: process.env.GROK_MODEL || 'grok-4-latest',
            };
          } else {
            logger.warn('xAI login found but no valid access token — run `buddy login xai` again.');
          }
        }
      } catch (err) {
        logger.debug('xAI login resolution skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Honor an onboarded LOCAL provider (Ollama / LM Studio) persisted to
  // user-settings.json by `buddy onboard`. Env detection only inspects
  // OLLAMA_HOST/oauth files, so a user who completed the wizard and picked
  // Ollama would otherwise dead-end on "No provider configured" on the next
  // run — local providers legitimately carry no API key, so the guard that
  // keys off apiKey presence misfires. Cloud/env providers are matched first
  // above, so this only triggers when nothing else resolved.
  if (!cachedProvider) {
    cachedProvider = await detectOnboardedLocalProvider();
  }

  if (cachedProvider) {
    logger.info(`Auto-detected provider: ${cachedProvider.provider} (model: ${cachedProvider.defaultModel})`);
  }

  return cachedProvider;
}

/**
 * Resolve an onboarded local provider (Ollama / LM Studio) from
 * user-settings.json. Returns a detection with a placeholder API key (local
 * OpenAI-compatible servers ignore it) so the downstream "no provider" guard
 * passes and the persisted baseURL/model are used.
 */
async function detectOnboardedLocalProvider(): Promise<DetectedProvider | null> {
  try {
    const getSettingsManager = await lazyImport.settingsManager();
    const settings = getSettingsManager().loadUserSettings();
    const provider = (settings.provider || '').toLowerCase();
    if (provider !== 'ollama' && provider !== 'lmstudio') return null;
    const fallbackBase = provider === 'ollama'
      ? 'http://localhost:11434/v1'
      : 'http://localhost:1234/v1';
    const baseURL = settings.baseURL || fallbackBase;
    // Mirror the env path so anything else reading OLLAMA_HOST stays consistent.
    if (provider === 'ollama' && !process.env.OLLAMA_HOST) {
      process.env.OLLAMA_HOST = baseURL.replace(/\/v1\/?$/, '');
    }
    return {
      provider: provider as DetectedProvider['provider'],
      apiKey: provider, // placeholder — ignored by local OpenAI-compat servers
      baseURL,
      defaultModel: settings.model || (provider === 'ollama' ? 'llama3' : 'default'),
      source: 'environment',
    };
  } catch {
    return null;
  }
}

// Load API key from environment, secure storage, or legacy settings
async function loadApiKey(): Promise<string | undefined> {
  await ensureEnvLoaded();

  // Check environment-detected provider first
  const detected = await getDetectedProvider();
  if (detected) return detected.apiKey;

  // Priority: secure credential storage > legacy settings file
  const getCredentialManager = await lazyImport.credentialManager();
  const credManager = getCredentialManager();
  const apiKey = credManager.getApiKey();

  if (apiKey) {
    return apiKey;
  }

  // Fall back to legacy settings manager
  const getSettingsManager = await lazyImport.settingsManager();
  const settingsManager = getSettingsManager();
  return settingsManager.getApiKey();
}

// Load base URL from detected provider or user settings
async function loadBaseURL(): Promise<string> {
  await ensureEnvLoaded();

  // Check environment-detected provider first
  const detected = await getDetectedProvider();
  if (detected) return detected.baseURL;

  // Check explicit environment override
  const envBaseURL = process.env.GROK_BASE_URL;
  if (envBaseURL) return envBaseURL;

  const getSettingsManager = await lazyImport.settingsManager();
  const manager = getSettingsManager();
  return manager.getBaseURL();
}

// Save command line settings to user settings file
async function saveCommandLineSettings(
  apiKey?: string,
  baseURL?: string
): Promise<void> {
  try {
    const getSettingsManager = await lazyImport.settingsManager();
    const settingsManager = getSettingsManager();
    const getCredentialManager = await lazyImport.credentialManager();
    const credManager = getCredentialManager();

    // Save API key to secure encrypted storage
    if (apiKey) {
      credManager.setApiKey(apiKey);
      const status = credManager.getSecurityStatus();
      if (status.encryptionEnabled) {
        cli.info("✅ API key saved securely (encrypted) to ~/.codebuddy/credentials.enc");
      } else {
        cli.info("✅ API key saved to ~/.codebuddy/credentials.enc");
        cli.error("⚠️ Consider enabling encryption for better security");
      }
    }

    // Save base URL to settings (not sensitive)
    if (baseURL) {
      settingsManager.updateUserSetting("baseURL", baseURL);
      cli.info("✅ Base URL saved to ~/.codebuddy/user-settings.json");
    }
  } catch (error) {
    cli.warn(
      `⚠️ Could not save settings to file: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * A saved/default model is only usable if it matches the detected provider's
 * backend: a `grok-*` slug 404s on the ChatGPT/Codex backend, and a `gpt-5.*`
 * slug 404s on xAI. We only enforce this for the two providers with a known
 * hard incompatibility (grok ↔ chatgpt); other providers are left untouched so
 * local/OpenAI/Anthropic model names pass through as before.
 */
function isModelCompatibleWithProvider(model: string, provider?: string): boolean {
  if (!provider) return true;
  const looksGrok = /grok/i.test(model);
  if (provider === 'grok') return looksGrok;
  if (provider === 'chatgpt') return /^(gpt-|o[1-9]|codex)/i.test(model) && !looksGrok;
  return true;
}

// Load model from detected provider or user settings
async function loadModel(): Promise<string | undefined> {
  await ensureEnvLoaded();

  // 1. Explicit env var takes highest priority
  if (process.env.GROK_MODEL) return process.env.GROK_MODEL;

  const detected = await getDetectedProvider();

  // 2. Project/user settings override auto-detection — UNLESS the saved model is
  //    incompatible with the detected provider. A `gpt-5.5` left in settings.json
  //    would 404 against xAI after `buddy login xai`; symmetrically, a stale
  //    `grok-code-fast-1` default 404s against the ChatGPT/Codex backend (which
  //    then falls back to another unsupported slug and crashes). In either
  //    mismatch, prefer the detected provider's own default model.
  try {
    const getSettingsManager = await lazyImport.settingsManager();
    const settingsModel = getSettingsManager().getCurrentModel();
    if (settingsModel && isModelCompatibleWithProvider(settingsModel, detected?.provider)) {
      return settingsModel;
    }
  } catch (_err) {
    logger.debug('Failed to load model from settings manager', { error: _err });
  }

  // 3. Fallback to auto-detected provider's default model
  if (detected) return detected.defaultModel;

  return undefined;
}

/**
 * Active-LLM auto-failover. When `[llm] enabled` (or CODEBUDDY_LLM_FAILOVER=1),
 * build the registry of the user's live logins and inject it into the agent's
 * client fallback list — so a failing primary transparently fails over to the
 * next active LLM (resilience order by default: capable/subscription first,
 * local last). OFF by default → single-provider behavior is unchanged.
 */
async function applyActiveLlmFailover(
  agent: import('./agent/codebuddy-agent.js').CodeBuddyAgent,
): Promise<void> {
  try {
    const { getConfigManager } = await import('./config/toml-config.js');
    const llmCfg = getConfigManager().getConfig().llm;
    const enabled = Boolean(llmCfg?.enabled) || process.env.CODEBUDDY_LLM_FAILOVER === '1';
    if (!enabled) return;

    const primary = await getDetectedProvider();
    const { buildActiveLlmRegistry } = await import('./providers/active-llm-registry.js');
    const orderEnv = process.env.CODEBUDDY_LLM_ORDER as
      | 'resilience'
      | 'free-first'
      | 'manual'
      | undefined;
    const registry = await buildActiveLlmRegistry({
      primary: primary
        ? {
            provider: primary.provider,
            apiKey: primary.apiKey,
            baseURL: primary.baseURL,
            model: primary.defaultModel,
          }
        : undefined,
      policy: orderEnv || llmCfg?.order || 'resilience',
      manualOrder: llmCfg?.manualOrder,
      localOnly: llmCfg?.local_only,
    });
    if (registry.fallbacks.length > 0) {
      agent.getClient().setRuntimeFallbackProviders(registry.fallbacks);
      logger.info(
        `Active-LLM failover: ${primary?.provider ?? '?'} → ${registry.fallbacks
          .map((f) => f.provider)
          .join(' → ')}`,
      );
    }
  } catch (err) {
    logger.debug('Active-LLM failover setup skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Handle commit-and-push command in headless mode
async function handleCommitAndPushHeadless(
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number
): Promise<void> {
  try {
    const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
    const agent = new CodeBuddyAgent(apiKey, baseURL, model, maxToolRounds);
    await applyActiveLlmFailover(agent);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const { ConfirmationService } = await import("./utils/confirmation-service.js");
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    cli.info("🤖 Processing commit and push...\n");
    cli.info("> /commit-and-push\n");

    // First check if there are any changes at all
    const initialStatusResult = await agent.executeBashCommand(
      "git status --porcelain"
    );

    if (!initialStatusResult.success || !initialStatusResult.output?.trim()) {
      cli.info("❌ No changes to commit. Working directory is clean.");
      process.exit(1);
    }

    cli.info("✅ git status: Changes detected");

    // Add all changes
    const addResult = await agent.executeBashCommand("git add .");

    if (!addResult.success) {
      cli.info(
        `❌ git add: ${addResult.error || "Failed to stage changes"}`
      );
      process.exit(1);
    }

    cli.info("✅ git add: Changes staged");

    // Get staged changes for commit message generation
    const diffResult = await agent.executeBashCommand("git diff --cached");

    // Generate commit message using AI
    const commitPrompt = `Generate a concise, professional git commit message for these changes:

Git Status:
${initialStatusResult.output}

Git Diff (staged changes):
${diffResult.output || "No staged changes shown"}

Follow conventional commit format (feat:, fix:, docs:, etc.) and keep it under 72 characters.
Respond with ONLY the commit message, no additional text.`;

    cli.info("🤖 Generating commit message...");

    const commitMessageEntries = await agent.processUserMessage(commitPrompt);
    let commitMessage = "";

    // Extract the commit message from the AI response
    for (const entry of commitMessageEntries) {
      if (entry.type === "assistant" && entry.content.trim()) {
        commitMessage = entry.content.trim();
        break;
      }
    }

    if (!commitMessage) {
      cli.info("❌ Failed to generate commit message");
      process.exit(1);
    }

    // Clean the commit message
    const cleanCommitMessage = commitMessage.replace(/^["']|["']$/g, "");
    cli.info(`✅ Generated commit message: "${cleanCommitMessage}"`);

    // Execute the commit
    const commitCommand = `git commit -m "${cleanCommitMessage}"`;
    const commitResult = await agent.executeBashCommand(commitCommand);

    if (commitResult.success) {
      cli.info(
        `✅ git commit: ${
          commitResult.output?.split("\n")[0] || "Commit successful"
        }`
      );

      // If commit was successful, push to remote
      // First try regular push, if it fails try with upstream setup
      let pushResult = await agent.executeBashCommand("git push");

      if (
        !pushResult.success &&
        pushResult.error?.includes("no upstream branch")
      ) {
        cli.info("🔄 Setting upstream and pushing...");
        pushResult = await agent.executeBashCommand("git push -u origin HEAD");
      }

      if (pushResult.success) {
        cli.info(
          `✅ git push: ${
            pushResult.output?.split("\n")[0] || "Push successful"
          }`
        );
      } else {
        cli.info(`❌ git push: ${pushResult.error || "Push failed"}`);
        process.exit(1);
      }
    } else {
      cli.info(`❌ git commit: ${commitResult.error || "Commit failed"}`);
      process.exit(1);
    }
  } catch (error: unknown) {
    logger.error("Error during commit and push:", error as Error);
    process.exit(1);
  }
}

async function finalizeHeadlessRun(code: number): Promise<void> {
  const flushStreamWithTimeout = async (
    stream: NodeJS.WriteStream,
    timeoutMs: number = 250
  ): Promise<void> => {
    await Promise.race([
      new Promise<void>((resolve) => {
        try {
          stream.write('', () => resolve());
        } catch (_error) {
          resolve();
        }
      }),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
  };

  try {
    const { disposeAll } = await import('./utils/disposable.js');
    await disposeAll();
  } catch (error) {
    logger.debug('Headless cleanup skipped', { error: String(error) });
  }

  try {
    const { getLogger } = await import('./utils/logger.js');
    getLogger().close();
  } catch (_error) {
    // Ignore logger shutdown errors during process exit.
  }

  // Explicitly stop singleton file watchers that keep headless runs alive.
  try {
    const { resetSkillRegistry } = await import('./skills/registry.js');
    resetSkillRegistry();
  } catch (_error) {
    // Ignore skill registry shutdown errors.
  }
  try {
    const { resetIdentityManager } = await import('./identity/identity-manager.js');
    resetIdentityManager();
  } catch (_error) {
    // Ignore identity manager shutdown errors.
  }
  try {
    const { resetHotReloadManager } = await import('./config/hot-reload/index.js');
    resetHotReloadManager();
  } catch (_error) {
    // Ignore hot reload shutdown errors.
  }
  try {
    const { resetConfigWatcher } = await import('./config/hot-reload/watcher.js');
    resetConfigWatcher();
  } catch (_error) {
    // Ignore config watcher shutdown errors.
  }
  try {
    const { resetSettingsHierarchy } = await import('./config/settings-hierarchy.js');
    resetSettingsHierarchy();
  } catch (_error) {
    // Ignore settings hierarchy shutdown errors.
  }

  // Best-effort close of global HTTP agents to reduce socket-close races on Windows.
  try {
    httpGlobalAgent.destroy();
    httpsGlobalAgent.destroy();
  } catch (_error) {
    // Ignore HTTP agent shutdown errors.
  }

  // Flush stdout/stderr before forcing exit.
  // In some piped/embedded contexts, write callbacks can stall indefinitely.
  await flushStreamWithTimeout(process.stdout);
  await flushStreamWithTimeout(process.stderr);

  if (!process.stdin.destroyed) {
    process.stdin.pause();
  }

  const handles = ((process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() || []);
  for (const handle of handles) {
    if (handle === process.stdout || handle === process.stderr || handle === process.stdin) {
      continue;
    }
    try {
      const h = handle as {
        constructor?: { name?: string };
        unref?: () => void;
        close?: () => void;
      };
      h.unref?.();
      if (h.constructor?.name === 'FSWatcher') {
        h.close?.();
      }
    } catch (_error) {
      // Ignore per-handle unref failures.
    }
  }

  if (process.env.CODEBUDDY_DEBUG_HANDLES === '1') {
    const activeHandles = ((process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() || [])
      .map((h) => {
        const handle = h as {
          constructor?: { name?: string };
          unref?: () => void;
          close?: () => void;
          _path?: string;
          path?: string;
          _filename?: string;
          filename?: string;
        };
        return {
          type: handle.constructor?.name || 'Unknown',
          hasUnref: typeof handle.unref === 'function',
          hasClose: typeof handle.close === 'function',
          path: handle._path || handle.path || handle._filename || handle.filename,
        };
      });
    const activeRequests = ((process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.() || [])
      .map((r) => (r as { constructor?: { name?: string } })?.constructor?.name || 'Unknown');
    logger.debug('Active handles before headless return', {
      count: activeHandles.length,
      handles: activeHandles,
      activeRequestsCount: activeRequests.length,
      activeRequests,
    });
  }

  process.exitCode = code;
  const fallbackExitTimer = setTimeout(() => {
    process.exit(code);
  }, 1500);
  fallbackExitTimer.unref();
  return;
}

async function loadCustomAgentForCli(
  agentName: string | undefined,
  announce: boolean,
): Promise<CustomAgentConfig | null> {
  if (!agentName) return null;

  const { getCustomAgentLoader } = await import("./agent/custom/custom-agent-loader.js");
  const loader = getCustomAgentLoader();
  const agentConfig = loader.getAgent(agentName);

  if (!agentConfig) {
    logger.error(`Agent not found: ${agentName}`);
    const agents = loader.listAgents();
    if (agents.length > 0) {
      cli.error('\nAvailable agents:');
      agents.forEach(a => cli.error(`   - ${a.id}`));
    }
    process.exit(1);
  }

  if (announce) {
    cli.info(`Using agent: ${agentConfig.name}`);
  }
  const { setActiveCustomAgentRuntime } = await import('./agent/custom/custom-agent-runtime.js');
  setActiveCustomAgentRuntime(agentConfig);
  return agentConfig;
}

async function applyCustomAgentToolFilter(agentConfig: CustomAgentConfig): Promise<void> {
  const { hasCustomAgentToolFilter, buildCustomAgentToolFilter } = await import('./agent/custom/custom-agent-tool-filter.js');
  if (!hasCustomAgentToolFilter(agentConfig)) return;

  const { getToolFilter, setToolFilter } = await import('./utils/tool-filter.js');
  const { getBuiltinToolNames } = await import('./codebuddy/tools.js');
  setToolFilter(buildCustomAgentToolFilter(agentConfig, getToolFilter(), getBuiltinToolNames()));
}

// Headless mode processing function
async function processPromptHeadless(
  prompt: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number,
  selfHealEnabled: boolean = true,
  outputFormat: string = 'json',
  outputSchemaPath?: string,
  agentName?: string,
): Promise<number> {
  const previousDisableMCP = process.env.CODEBUDDY_DISABLE_MCP;
  const previousHeadless = process.env.CODEBUDDY_HEADLESS;
  // Headless defaults MCP OFF (startup cost / determinism), but respect an
  // explicit opt-in so `CODEBUDDY_DISABLE_MCP=false buddy -p …` can use MCP
  // servers (e.g. the Code Explorer / code-explorer bridge, or the benchmark's
  // "with graph" condition). Mirrors the opt-in pattern in goal-cli.ts.
  process.env.CODEBUDDY_DISABLE_MCP = process.env.CODEBUDDY_DISABLE_MCP ?? 'true';
  process.env.CODEBUDDY_HEADLESS = 'true';

  try {
    const customAgentConfig = await loadCustomAgentForCli(agentName, false);
    const modelToUse = customAgentConfig?.model ?? model;
    const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
    const agent = new CodeBuddyAgent(apiKey, baseURL, modelToUse, maxToolRounds);
    await applyActiveLlmFailover(agent);

    await agent.systemPromptReady;
    // When MCP is opted in for this headless run, wait for the servers to finish
    // connecting so their tools (e.g. the Code Explorer / code-explorer bridge) are
    // registered before the first turn — otherwise the one-shot turn races init
    // and the agent never sees the MCP tools.
    if (process.env.CODEBUDDY_DISABLE_MCP !== 'true') {
      try {
        await agent.getMCPReady();
      } catch (e) {
        logger.debug('MCP readiness wait failed (continuing without MCP tools)', { error: String(e) });
      }
    }
    if (customAgentConfig?.systemPrompt) {
      agent.setSystemPrompt(customAgentConfig.systemPrompt);
    }
    if (customAgentConfig) {
      await applyCustomAgentToolFilter(customAgentConfig);
    }

    // Configure self-healing
    if (!selfHealEnabled) {
      agent.setSelfHealing(false);
    }

    // Configure confirmation service for headless mode (auto-approve all operations)
    const { ConfirmationService } = await import("./utils/confirmation-service.js");
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    // Initialize interaction logger for headless session tracking
    let interactionLogger: import('./logging/interaction-logger.js').InteractionLogger | null = null;
    try {
      const { getInteractionLogger } = await import('./logging/interaction-logger.js');
      const il = getInteractionLogger();
      il.startSession({
        model: modelToUse || 'unknown',
        provider: baseURL?.includes('localhost') ? 'local' : 'xai',
        cwd: process.cwd(),
        tags: ['headless'],
      });
      interactionLogger = il;
    } catch (e) { logger.debug('Failed to initialize headless interaction logger', { error: String(e) }); }

    // Process the user message
    const chatEntries = await agent.processUserMessage(prompt);

    // WS3-T1 — session-end flush (handoff + lesson candidates). Awaited with
    // a hard cap so headless runs keep their continuity write without ever
    // hanging the exit; trivial sessions no-op inside the module.
    try {
      const { runSessionEndFlush } = await import('./agent/session-end-flush.js');
      const flushTimeoutMs = parseInt(process.env.CODEBUDDY_SESSION_END_FLUSH_TIMEOUT_MS || '15000', 10);
      await Promise.race([
        runSessionEndFlush({ chatHistory: chatEntries }),
        new Promise<void>((resolve) => setTimeout(resolve, flushTimeoutMs).unref()),
      ]);
    } catch (e) {
      logger.debug('Headless session-end flush skipped', { error: String(e) });
    }

    // Log entries to interaction logger
    if (interactionLogger) {
      for (const entry of chatEntries) {
        if (entry.type === 'user' || entry.type === 'assistant') {
          interactionLogger.logMessage({ role: entry.type, content: entry.content });
        } else if (entry.type === 'tool_result' && entry.toolCall) {
          interactionLogger.logMessage({ role: 'tool', content: entry.content });
        }
      }
      interactionLogger.endSession();
    }

    // Convert chat entries to OpenAI compatible message objects
    const messages: ChatCompletionMessageParam[] = [];

    for (const entry of chatEntries) {
      switch (entry.type) {
        case "user":
          messages.push({
            role: "user",
            content: entry.content,
          });
          break;

        case "assistant":
          const assistantMessage: ChatCompletionMessageParam = {
            role: "assistant",
            content: entry.content,
          };

          // Add tool calls if present
          if (entry.toolCalls && entry.toolCalls.length > 0) {
            assistantMessage.tool_calls = entry.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            }));
          }

          messages.push(assistantMessage);
          break;

        case "tool_result":
          if (entry.toolCall) {
            messages.push({
              role: "tool",
              tool_call_id: entry.toolCall.id,
              content: entry.content,
            });
          }
          break;
      }
    }

    // Validate output against JSON Schema if --output-schema was provided
    if (outputSchemaPath) {
      const { validateOutputSchema } = await import("./utils/output-schema-validator.js");
      const validation = validateOutputSchema(messages, outputSchemaPath);
      if (!validation.valid) {
        cli.error('Output schema validation failed:');
        for (const error of validation.errors) {
          cli.error(`  - ${error}`);
        }
        return 2;
      }
    }

    // Extract final assistant response text
    const assistantMessages = messages.filter(
      m => m.role === 'assistant' && m.content && !('tool_calls' in m && (m as unknown as Record<string, unknown>).tool_calls)
    );
    const lastResponse = assistantMessages[assistantMessages.length - 1];
    const resultText = (lastResponse?.content as string) || '';
    const exitCode = resolveHeadlessResultExitCode(resultText);

    // Gather cost and model info from the agent
    const sessionCost = agent.getSessionCost();
    const usedModel = modelToUse || process.env.GROK_MODEL || 'unknown';

    // Output in the requested format
    const format = outputFormat.toLowerCase();
    if (format === 'text' || format === 'markdown') {
      // Text/markdown: only output the final assistant response.
      // MUST go to stdout so users can pipe it: `buddy "question" | jq`.
      if (resultText) {
        cli.stdout(resultText);
      }
    } else if (format === 'stream-json' || format === 'streaming') {
      // Stream JSON: each message on its own line (NDJSON)
      for (const message of messages) {
        process.stdout.write(JSON.stringify(message) + '\n');
      }
      // Emit a final summary event
      process.stdout.write(JSON.stringify({
        type: 'summary',
        result: resultText,
        cost: { total: sessionCost },
        model: usedModel,
      }) + '\n');
    } else {
      // Default: json — structured output goes to stdout (pipeable).
      cli.stdout(JSON.stringify({
        result: resultText,
        cost: {
          total: sessionCost,
        },
        model: usedModel,
        messages,
      }));
    }
    return exitCode;
  } catch (error: unknown) {
    // Output error in appropriate format
    const errorMessage = error instanceof Error ? error.message : String(error);
    const format = outputFormat.toLowerCase();
    if (format === 'text' || format === 'markdown') {
      cli.error(`Error: ${errorMessage}`);
    } else {
      // JSON error envelope also goes to stdout so piping stays consistent.
      cli.stdout(
        JSON.stringify({
          error: errorMessage,
          result: null,
          cost: { total: 0 },
          model: model || process.env.GROK_MODEL || 'unknown',
        })
      );
    }
    return 1;
  } finally {
    if (previousDisableMCP === undefined) {
      delete process.env.CODEBUDDY_DISABLE_MCP;
    } else {
      process.env.CODEBUDDY_DISABLE_MCP = previousDisableMCP;
    }
    if (previousHeadless === undefined) {
      delete process.env.CODEBUDDY_HEADLESS;
    } else {
      process.env.CODEBUDDY_HEADLESS = previousHeadless;
    }
  }
}

program
  .name("buddy")
  // Git-style option scoping: ROOT options must come before the subcommand.
  // Without this, root flags are consumed from anywhere in argv and shadow
  // same-named subcommand options — e.g. `buddy lessons add -c RULE
  // --context ci` silently lost both to the root `-c, --context <patterns>`.
  .enablePositionalOptions()
  .description(
    "A conversational AI CLI tool powered by AI with text editor capabilities"
  )
  .version(packageJson.version)
  .argument("[message...]", "Initial message to send to Code Buddy")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "CodeBuddy API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "CodeBuddy API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option(
    "-p, --prompt <prompt>",
    "process a single prompt and exit (headless mode, alias: --print)"
  )
  .option(
    "--print <prompt>",
    "alias for --prompt: process a single prompt and exit (headless mode)"
  )
  .option(
    "-b, --browser",
    "launch browser UI instead of terminal interface"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .option(
    "-s, --security-mode <mode>",
    "security mode: suggest (default), auto-edit, or full-auto"
  )
  .option(
    "-o, --output-format <format>",
    "output format for headless mode: json, stream-json, text, markdown"
  )
  .addOption(
    new Option(
      "--output <format>",
      "legacy alias for --output-format"
    ).hideHelp()
  )
  .option(
    "--init",
    "initialize .codebuddy directory with templates and exit"
  )
  .option(
    "--dry-run",
    "preview changes without applying them (simulation mode)"
  )
  .option(
    "-c, --context <patterns>",
    "load specific files into context using glob patterns (e.g., 'src/**/*.ts,!**/*.test.ts')"
  )
  .option(
    "--no-cache",
    "disable response caching"
  )
  .option(
    "--no-self-heal",
    "disable self-healing auto-correction"
  )
  .option(
    "--force-tools",
    "enable tools/function calling for local models (LM Studio)"
  )
  .option(
    "--probe-tools",
    "auto-detect tool support by testing the model at startup"
  )
  .option(
    "--plain",
    "use plain text output (minimal formatting)"
  )
  .option(
    "--no-color",
    "disable colored output"
  )
  .option(
    "--no-emoji",
    "disable emoji in output"
  )
  .option(
    "--list-models",
    "list available models from the API endpoint and exit"
  )
  .option(
    "--continue",
    "continue from the most recent saved session (like mistral-vibe)"
  )
  .option(
    "--resume <sessionId>",
    "resume a specific session by ID (supports partial matching)"
  )
  .option(
    "--search-sessions <query>",
    "search saved sessions by content"
  )
  .option(
    "--max-price <dollars>",
    "maximum cost in dollars before stopping (like mistral-vibe)",
    "10.0"
  )
  .option(
    "--auto-approve",
    "automatically approve all tool executions (like mistral-vibe)"
  )
  .option(
    "--system-prompt <id>",
    "system prompt to use: default, minimal, secure, code-reviewer, architect (or custom from ~/.codebuddy/prompts/)"
  )
  .option(
    "--list-prompts",
    "list available system prompts and exit"
  )
  .option(
    "--agent <name>",
    "use a custom agent configuration from ~/.codebuddy/agents/ (like mistral-vibe)"
  )
  .option(
    "--list-agents",
    "list available custom agents and exit"
  )
  .option(
    "--enabled-tools <patterns>",
    "only enable tools matching patterns (comma-separated, supports glob: bash,*file*,search)"
  )
  .option(
    "--disabled-tools <patterns>",
    "disable tools matching patterns (comma-separated, supports glob: bash,web_*)"
  )
  .option(
    "--setup",
    "run interactive setup wizard for API key and configuration"
  )
  .option(
    "--vim",
    "enable Vim keybindings for input"
  )
  .option(
    "--permission-mode <mode>",
    "permission mode: default, plan, acceptEdits, dontAsk, bypassPermissions"
  )
  .option(
    "--dangerously-skip-permissions",
    "bypass all permission checks (use in trusted containers without network access)"
  )
  .option(
    "--allowed-tools <patterns>",
    "only enable tools matching patterns (natively --allowedTools)"
  )
  .option(
    "--disallowed-tools <patterns>",
    "block tools matching patterns (natively --disallowedTools)"
  )
  .option(
    "--mcp-debug",
    "enable MCP debugging output"
  )
  .option(
    "--allow-outside",
    "allow file operations outside the workspace directory (disables workspace isolation)"
  )
  .option(
    "--output-schema <path>",
    "validate headless mode JSON output against a JSON Schema file"
  )
  .option(
    "--add-dir <paths...>",
    "grant additional writable directories (repeatable)"
  )
  .option(
    "--no-alt-screen",
    "disable alternate screen buffer for Ink UI"
  )
  .option(
    "--ephemeral",
    "skip session persistence (do not save session to disk)"
  )
  .option(
    "--system-prompt-override <text>",
    "replace the entire system prompt with this text"
  )
  .option(
    "--system-prompt-file <path>",
    "replace the entire system prompt with contents of a file"
  )
  .option(
    "--append-system-prompt <text>",
    "append text to the default system prompt"
  )
  .option(
    "--append-system-prompt-file <path>",
    "append file contents to the default system prompt"
  )
  .option(
    "--fallback-model <model>",
    "auto-fallback model when default is overloaded"
  )
  .option(
    "--profile <name>",
    "apply a named configuration profile from .codebuddy/config.toml [profiles.<name>]"
  )
  .option(
    "--from-pr <pr>",
    "link session to a GitHub pull request (number or URL)"
  )
  .option(
    "--yolo",
    "enable YOLO mode (full autonomy with guardrails, $100 cost cap)"
  )
  .option(
    "--quiet",
    "suppress informational logs (only show errors and responses)"
  )
  .option(
    "--verbose",
    "enable verbose/debug output"
  )
  .option(
    "--speak",
    "enable automatic speech synthesis of agent responses using Text-to-Speech"
  )
  .option(
    "--tts-provider <provider>",
    "TTS provider (edge-tts, espeak, say, piper, audioreader)"
  )
  .action(async (message, options) => {
    // Apply --quiet / --verbose flags
    if (options.quiet) {
      process.env.LOG_LEVEL = 'error';
      logger.setLevel('error');
    }
    if (options.verbose) {
      process.env.VERBOSE = 'true';
      process.env.DEBUG = 'true';
      logger.setLevel('debug');
    }
    // Apply --speak / --tts-provider flags
    if (options.speak || options.ttsProvider) {
      const { getTTSManager } = await import('./input/text-to-speech.js');
      const ttsManager = getTTSManager();
      if (options.speak) {
        ttsManager.enable();
        ttsManager.setAutoSpeak(true);
      }
      if (options.ttsProvider) {
        const validProviders = ['edge-tts', 'espeak', 'say', 'piper', 'audioreader'];
        if (validProviders.includes(options.ttsProvider)) {
          ttsManager.updateConfig({ provider: options.ttsProvider as any });
        } else {
          startupLogger.warn(`⚠️ Invalid tts-provider: ${options.ttsProvider}. Valid: ${validProviders.join(', ')}`);
        }
      }
    }
    // Apply named configuration profile (--profile <name>) before anything else
    if (options.profile) {
      try {
        const { getConfigManager } = await import('./config/toml-config.js');
        getConfigManager().load();
        getConfigManager().applyProfile(options.profile);
      } catch (err) {
        startupLogger.error(`Profile error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    }

    // Handle --setup flag (interactive setup wizard)
    if (options.setup) {
      const { runSetup } = await import("./utils/interactive-setup.js");
      await runSetup();
      process.exit(0);
    }

    // Handle --init flag
    if (options.init) {
      const { initCodeBuddyProject, formatInitResult } = await lazyImport.initProject();
      const result = await initCodeBuddyProject();
      cli.info(formatInitResult(result));
      process.exit(result.success ? 0 : 1);
    }

    // Handle --list-models flag
    if (options.listModels) {
      const detected = options.baseUrl ? null : await getDetectedProvider();
      const baseURL = options.baseUrl || detected?.baseURL || await loadBaseURL();
      try {
        const { models } = await resolveCliModelList({
          baseURL,
          provider: detected?.provider,
          defaultModel: detected?.defaultModel || process.env.CHATGPT_MODEL,
        });

        // Pipeable listing: stdout so `buddy --list-models | grep ...` works.
        cli.stdout("📋 Available models:\n");
        if (models.length > 0) {
          models.forEach((model: { id: string; owned_by?: string }) => {
            cli.stdout(`  • ${model.id}`);
          });
          cli.stdout(`\n  Total: ${models.length} model(s)`);
        } else {
          cli.stdout("  (no models found)");
        }
        process.exit(0);
      } catch (error) {
        logger.error(`❌ Error fetching models from ${baseURL}/models:`);
        logger.error(`   ${error instanceof Error ? error.message : String(error)}`);
        logger.error("\n💡 Make sure the API server is running (LM Studio, Ollama, etc.)");
        process.exit(1);
      }
    }

    // Handle --list-prompts flag
    if (options.listPrompts) {
      const { getPromptManager } = await import("./prompts/prompt-manager.js");
      const promptManager = getPromptManager();
      const prompts = await promptManager.listPrompts();

      // Pipeable listing (see --list-models).
      cli.stdout("📋 Available system prompts:\n");
      cli.stdout("  Built-in:");
      prompts.filter(p => p.source === 'builtin').forEach(p => {
        cli.stdout(`    • ${p.id}`);
      });

      const userPrompts = prompts.filter(p => p.source === 'user');
      if (userPrompts.length > 0) {
        cli.stdout("\n  User (~/.codebuddy/prompts/):");
        userPrompts.forEach(p => {
          cli.stdout(`    • ${p.id}`);
        });
      }

      cli.stdout("\n💡 Usage: codebuddy --system-prompt <id>");
      cli.stdout("   Create custom prompts in ~/.codebuddy/prompts/<name>.md");
      process.exit(0);
    }

    // Handle --list-agents flag
    if (options.listAgents) {
      const { getCustomAgentLoader } = await import("./agent/custom/custom-agent-loader.js");
      const loader = getCustomAgentLoader();
      const agents = loader.listAgents();

      // Pipeable listing (see --list-models).
      cli.stdout("📋 Available agents:\n");

      if (agents.length === 0) {
        cli.stdout("  (no custom agents found)");
        cli.stdout("\n💡 Create agents in ~/.codebuddy/agents/");
        cli.stdout("   Example: ~/.codebuddy/agents/_example.toml");
      } else {
        agents.forEach(agent => {
          const tags = agent.tags?.length ? ` [${agent.tags.join(', ')}]` : '';
          cli.stdout(`  • ${agent.id}: ${agent.name}${tags}`);
          if (agent.description) {
            cli.stdout(`      ${agent.description}`);
          }
        });
        cli.stdout(`\n  Total: ${agents.length} agent(s)`);
      }

      cli.info("\n💡 Usage: codebuddy --agent <id>");
      process.exit(0);
    }

    // Handle --search-sessions flag
    if (options.searchSessions) {
      const { searchSessions } = await import("./cli/session-commands.js");
      await searchSessions(options.searchSessions);
      process.exit(0);
    }

    // Handle --continue flag (resume last session, like mistral-vibe)
    if (options.continue) {
      const { getSessionStore } = await import("./persistence/session-store.js");
      const sessionStore = getSessionStore();
      const lastSession = await sessionStore.getLastSession();

      if (!lastSession) {
        logger.error("❌ No sessions found. Start a new session first.");
        process.exit(1);
      }

      await sessionStore.resumeSession(lastSession.id);
      cli.info(`📂 Resuming session: ${lastSession.name} (${lastSession.id.slice(0, 8)})`);
      cli.info(`   ${lastSession.messages.length} messages, last accessed: ${lastSession.lastAccessedAt.toLocaleString()}\n`);
    }

    // Handle --resume flag (resume specific session by ID, like mistral-vibe)
    if (options.resume) {
      const { getSessionStore } = await import("./persistence/session-store.js");
      const sessionStore = getSessionStore();
      const session = await sessionStore.getSessionByPartialId(options.resume);

      if (!session) {
        logger.error(`❌ Session not found: ${options.resume}`);
        cli.info("\n📋 Recent sessions:");
        const recent = await sessionStore.getRecentSessions(5);
        recent.forEach(s => {
          cli.info(`   ${s.id.slice(0, 8)} - ${s.name} (${s.messages.length} messages)`);
        });
        process.exit(1);
      }

      await sessionStore.resumeSession(session.id);
      cli.info(`📂 Resuming session: ${session.name} (${session.id.slice(0, 8)})`);
      cli.info(`   ${session.messages.length} messages, last accessed: ${session.lastAccessedAt.toLocaleString()}\n`);
    }

    // Load environment before changing cwd so root .env values (API keys) remain available
    // even when --directory points to a workspace without its own .env file.
    await ensureEnvLoaded();

    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: unknown) {
        logger.error(
          `Error changing directory to ${options.directory}:`,
          error as Error
        );
        process.exit(1);
      }
    }

    // Initialize workspace isolation
    const { initializeWorkspaceIsolation } = await import("./workspace/workspace-isolation.js");
    const _workspaceIsolation = initializeWorkspaceIsolation({
      allowOutside: options.allowOutside,
      directory: process.cwd(),
      additionalPaths: options.addDir,
    });

    if (options.allowOutside) {
      cli.error("Warning: Workspace isolation DISABLED - file access is unrestricted");
    }

    // Initialize observability (Sentry/OpenTelemetry)
    try {
      const { initObservability } = await import("./observability/index.js");
      initObservability();
    } catch (err) {
      logger.debug('Observability init skipped', { error: String(err) });
    }

    try {
      // Get API key from options, environment, or user settings
      const explicitProvider = options.model && !options.apiKey && !options.baseUrl
        ? (await import('./commands/llm-provider-resolution.js')).resolveCommandProvider({
            explicitModel: options.model,
          })
        : null;
      let apiKey = options.apiKey || explicitProvider?.apiKey || await loadApiKey();
      let baseURL = options.baseUrl || explicitProvider?.baseURL || await loadBaseURL();
      let model = options.model || explicitProvider?.model || await loadModel();  // let: can be overridden by --agent
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        // In an interactive terminal, offer the guided setup wizard right here
        // (like Hermes) instead of dead-ending on an error — then continue the
        // session with the credentials it captured.
        const interactive =
          Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) &&
          !options.prompt && !options.print &&
          process.env.CI !== 'true' && process.env.GITHUB_ACTIONS !== 'true';

        let recovered = false;
        if (interactive) {
          const readline = await import('readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer: string = await new Promise((resolve) =>
            rl.question('\n❔ No AI provider configured. Run guided setup now? [Y/n] ', resolve)
          );
          rl.close();
          const yes = answer.trim() === '' || /^y(es)?$/i.test(answer.trim());
          if (yes) {
            try {
              const { runOnboarding } = await import('./wizard/onboarding.js');
              const result = await runOnboarding();
              // Bust the cached provider detection so the just-saved creds resolve.
              cachedProvider = undefined;
              apiKey = options.apiKey || await loadApiKey();
              baseURL = options.baseUrl || await loadBaseURL();
              model = options.model || result.model || await loadModel();
              recovered = Boolean(apiKey);
            } catch (err) {
              logger.error('Guided setup did not complete', err instanceof Error ? err : { error: String(err) });
            }
          }
        }

        if (!recovered) {
          logger.error(
            [
              "❌ No AI provider configured. Pick one to get started:",
              "   • Guided setup (recommended) — interactive wizard:     buddy onboard",
              "   • Free, no API key — sign in with your ChatGPT plan:    buddy login",
              "   • Local & free — run a model with Ollama, then:         export OLLAMA_HOST=http://localhost:11434",
              "   • API key — set GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY (or pass --api-key)",
              "   Run  buddy doctor  to check your setup.",
            ].join("\n")
          );
          process.exit(1);
        }
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      // Enable force-tools mode for local models
      if (options.forceTools) {
        process.env.GROK_FORCE_TOOLS = 'true';
        cli.error("🔧 Force tools: ENABLED (function calling for local models)");
      }

      // Handle auto-approve mode (like mistral-vibe)
      if (options.autoApprove) {
        const { ConfirmationService } = await import("./utils/confirmation-service.js");
        const confirmationService = ConfirmationService.getInstance();
        confirmationService.setSessionFlag("allOperations", true);
        cli.error("✅ Auto-approve: ENABLED (all tool executions will be approved)");
      }

      // CC18: Handle --permission-mode
      if (options.permissionMode) {
        const { getPermissionModeManager } = await import("./security/permission-modes.js");
        const mgr = getPermissionModeManager();
        const validModes = ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const;
        if (validModes.includes(options.permissionMode as typeof validModes[number])) {
          const success = mgr.setMode(options.permissionMode as typeof validModes[number]);
          if (success) {
            cli.error(`Permission mode: ${options.permissionMode}`);
          }
        } else {
          cli.error(`Invalid permission mode: ${options.permissionMode}. Valid: ${validModes.join(', ')}`);
        }
      }

      // Handle --dangerously-skip-permissions (natively)
      if (options.dangerouslySkipPermissions) {
        const { ConfirmationService } = await import("./utils/confirmation-service.js");
        const confirmationService = ConfirmationService.getInstance();
        confirmationService.setSessionFlag("allOperations", true);
        confirmationService.setSessionFlag("fileOperations", true);
        confirmationService.setSessionFlag("bashCommands", true);
        process.env.GROK_SKIP_PERMISSIONS = 'true';
        cli.error("⚠️  DANGEROUS: All permission checks BYPASSED");
        cli.error("   Only use this in trusted containers without network access!");
      }

      // Handle --add-dir: grant additional writable directories to sandbox
      if (options.addDir && options.addDir.length > 0) {
        try {
          const { getSandboxManager } = await import("./security/sandbox.js");
          const sandboxManager = getSandboxManager();
          for (const dir of options.addDir) {
            sandboxManager.allowPath(dir);
          }
        } catch (_err) {
          // Sandbox manager may not be initialized; dirs already passed to workspace isolation
        }
        cli.error(`Writable directories added: ${options.addDir.join(', ')}`);
      }

      // Handle --ephemeral: skip session persistence
      if (options.ephemeral) {
        const { getSessionStore } = await import("./persistence/session-store.js");
        const sessionStore = getSessionStore();
        sessionStore.setEphemeral(true);
        cli.info("Ephemeral mode: ENABLED (session will not be saved)");
      }

      // Handle --allowed-tools / --disallowed-tools (natively --allowedTools / --disallowedTools)
      if (options.allowedTools || options.disallowedTools) {
        const { setToolFilter, createToolFilter, getToolFilter } = await import("./utils/tool-filter.js");
        const existing = getToolFilter();
        const newFilter = createToolFilter({
          enabledTools: options.allowedTools || (existing.enabledPatterns.length > 0 ? existing.enabledPatterns.join(',') : undefined),
          disabledTools: options.disallowedTools || (existing.disabledPatterns.length > 0 ? existing.disabledPatterns.join(',') : undefined),
        });
        setToolFilter(newFilter);
        if (options.allowedTools) {
          cli.info(`Allowed tools: ${options.allowedTools}`);
        }
        if (options.disallowedTools) {
          cli.info(`Disallowed tools: ${options.disallowedTools}`);
        }
      }

      // Handle --mcp-debug
      if (options.mcpDebug) {
        process.env.MCP_DEBUG = 'true';
        cli.error("🔍 MCP debug: ENABLED");
      }

      // Set max-price for cost limit (like mistral-vibe)
      const maxPrice = parseFloat(options.maxPrice) || 10.0;
      process.env.MAX_COST = maxPrice.toString();

      // Handle tool filtering (like mistral-vibe --enabled-tools)
      if (options.enabledTools || options.disabledTools) {
        const { setToolFilter, createToolFilter, formatFilterResult, filterTools } = await import("./utils/tool-filter.js");
        const { getAllCodeBuddyTools } = await import("./codebuddy/tools.js");

        const filter = createToolFilter({
          enabledTools: options.enabledTools,
          disabledTools: options.disabledTools,
        });
        setToolFilter(filter);

        const allTools = await getAllCodeBuddyTools();
        const result = filterTools(allTools, filter);
        cli.info(formatFilterResult(result));
      }

      // Handle --yolo flag (equivalent to /yolo on, skip confirmation in non-interactive)
      if (options.yolo) {
        const { getAutonomyManager } = await import("./utils/autonomy-manager.js");
        const autonomyManager = getAutonomyManager();
        autonomyManager.enableYOLO(false);
        autonomyManager.updateYOLOConfig({
          maxAutoEdits: 50,
          maxAutoCommands: 100,
        });
        process.env.YOLO_MODE = 'true';
        cli.error("YOLO mode: ENABLED (full autonomy, $100 cost cap)");
      }

      // Handle vim mode
      if (options.vim) {
        process.env.GROK_VIM_MODE = 'true';
        cli.error("Vim mode: ENABLED");
      }

      // Merge --print alias into --prompt
      const promptArg = options.prompt || options.print;
      const hasExplicitPrompt = Boolean(promptArg || (Array.isArray(message) && message.length > 0));

      // Check for piped input (like mistral-vibe: cat file.txt | grok)
      // Avoid blocking on stdin when an explicit prompt is already provided
      // (common in programmatic exec/spawn usage where stdin stays open).
      let pipedInput = '';
      if (!process.stdin.isTTY && !hasExplicitPrompt) {
        // Reading from stdin (pipe or redirect)
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        pipedInput = Buffer.concat(chunks).toString('utf-8').trim();
      }

      // Combine piped input with any CLI prompt or message args
      const combinedPrompt = [
        promptArg,
        message?.join(' '),
        pipedInput
      ].filter(Boolean).join('\n\n');

      // Headless mode: process prompt and exit (if prompt, message, or piped input provided)
      if (combinedPrompt && (promptArg || pipedInput)) {
        const headlessExitCode = await processPromptHeadless(
          combinedPrompt,
          apiKey,
          baseURL,
          model,
          maxToolRounds,
          options.selfHeal !== false,
          resolveHeadlessOutputFormat(options),
          options.outputSchema,
          options.agent
        );
        await finalizeHeadlessRun(headlessExitCode);
        return;
      }

      // Initialize rendering system (lazy load)
      const { initializeRenderers, configureRenderContext } = await lazyImport.renderers();
      initializeRenderers();
      configureRenderContext({
        plain: options.plain,
        noColor: options.color === false,
        noEmoji: options.emoji === false,
      });

      // Interactive mode: launch UI (lazy load heavy modules)
      const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
      let systemPromptId = options.systemPrompt;  // New: external prompt support
      let customAgentConfig = null;

      // Handle --agent flag: load custom agent configuration
      if (options.agent) {
        const { getCustomAgentLoader } = await import("./agent/custom/custom-agent-loader.js");
        const loader = getCustomAgentLoader();
        const agentConfig = loader.getAgent(options.agent);

        if (!agentConfig) {
          logger.error(`❌ Agent not found: ${options.agent}`);
          const agents = loader.listAgents();
          if (agents.length > 0) {
            cli.info("\n📋 Available agents:");
            agents.forEach(a => cli.info(`   • ${a.id}`));
          }
          process.exit(1);
        }

        customAgentConfig = agentConfig;
        cli.info(`🤖 Using agent: ${agentConfig.name}`);
        const { setActiveCustomAgentRuntime } = await import('./agent/custom/custom-agent-runtime.js');
        setActiveCustomAgentRuntime(agentConfig);

        // Override model if specified in agent config
        if (agentConfig.model) {
          model = agentConfig.model;
        }
      }

      recordStartupPhase('agent-create-start');
      const agent = new CodeBuddyAgent(apiKey, baseURL, model, maxToolRounds, true, systemPromptId);
      recordStartupPhase('agent-create-done');
      await applyActiveLlmFailover(agent);

      // Apply custom agent system prompt if configured
      if (customAgentConfig?.systemPrompt) {
        await agent.systemPromptReady;
        agent.setSystemPrompt(customAgentConfig.systemPrompt);
      }

      // Apply custom-agent tool filters after CLI-level filters have
      // been parsed. Explicit CLI allowlists win; agent disabledTools
      // are added as a defensive blacklist.
      if (customAgentConfig) {
        const { hasCustomAgentToolFilter, buildCustomAgentToolFilter } = await import('./agent/custom/custom-agent-tool-filter.js');
        if (hasCustomAgentToolFilter(customAgentConfig)) {
          const { getToolFilter, setToolFilter } = await import('./utils/tool-filter.js');
          const { getBuiltinToolNames } = await import('./codebuddy/tools.js');
          const filter = buildCustomAgentToolFilter(
            customAgentConfig,
            getToolFilter(),
            getBuiltinToolNames(),
          );
          setToolFilter(filter);
          const disabled = filter.disabledPatterns.length
            ? filter.disabledPatterns.join(',')
            : 'none';
          const enabled = filter.enabledPatterns.length
            ? filter.enabledPatterns.join(',')
            : 'all';
          cli.info(`Agent tool filter: allowed=${enabled}; disabled=${disabled}`);
        }
      }

      // Enable auto-observation for computer-use agents
      if (customAgentConfig?.tags?.includes('computer-use')) {
        agent.enableAutoObservation();
      }

      // Probe for tool support if requested
      if (options.probeTools) {
        cli.info("🔍 Probing model for tool support...");
        const hasToolSupport = await agent.probeToolSupport();
        if (!hasToolSupport) {
          cli.info("ℹ️ Tool support: NOT DETECTED (switching to chat-only mode)");
          agent.switchToChatOnlyMode();
        }
      }

      // Configure security mode if specified
      if (options.securityMode) {
        const validModes: SecurityMode[] = ["suggest", "auto-edit", "full-auto"];
        if (validModes.includes(options.securityMode)) {
          const { getSecurityModeManager } = await lazyImport.securityModes();
          const securityManager = getSecurityModeManager();
          securityManager.setMode(options.securityMode);
          cli.info(`🛡️ Security mode: ${options.securityMode.toUpperCase()}`);
        } else {
          cli.warn(`⚠️ Invalid security mode: ${options.securityMode}. Using default (suggest).`);
        }
      }

      // Configure dry-run mode
      if (options.dryRun) {
        const { ConfirmationService } = await import("./utils/confirmation-service.js");
        const confirmationService = ConfirmationService.getInstance();
        confirmationService.setDryRunMode(true);
        cli.info("🔍 Dry-run mode: ENABLED (changes will be previewed, not applied)");
      }

      // Load context files if specified and inject into agent
      if (options.context) {
        const { ContextLoader, getContextLoader } = await lazyImport.contextLoader();
        const { include, exclude } = ContextLoader.parsePatternString(options.context);
        const contextLoader = getContextLoader(process.cwd(), {
          patterns: include,
          excludePatterns: exclude,
          respectGitignore: true,
        });
        const files = await contextLoader.loadFiles();
        if (files.length > 0) {
          cli.info(contextLoader.getSummary(files));
          // Inject context into agent's message history as a system message
          const contextContent = contextLoader.formatForPrompt(files);
          agent.addSystemContext(contextContent);
        }
      }

      // Configure caching and performance
      recordStartupPhase('perf-init-start');
      if (options.cache === false) {
        cli.info("📦 Response cache: DISABLED");
        // Disable performance caching when cache is disabled
        const { getPerformanceManager } = await lazyImport.performance();
        getPerformanceManager({ enabled: false });
      } else {
        // Initialize performance optimizations (lazy loading, tool caching, request optimization)
        const { initializePerformanceManager } = await lazyImport.performance();
        await initializePerformanceManager();
      }
      recordStartupPhase('perf-init-done');

      // Configure self-healing
      if (options.selfHeal === false) {
        agent.setSelfHealing(false);
        cli.info("🔧 Self-healing: DISABLED");
      }

      cli.info("🤖 Starting Code Buddy Conversational Assistant...\n");

      recordStartupPhase('user-settings-start');
      await ensureUserSettingsDirectory();
      recordStartupPhase('user-settings-done');

      // ── Crash recovery: detect unclean shutdown and offer session resume ──
      if (!options.resume && !options.continue) {
        try {
          const { checkCrashRecovery, clearRecoveryFiles } = await import('./errors/crash-recovery.js');
          const recovery = await checkCrashRecovery(process.cwd());
          if (recovery) {
            const age = Date.now() - new Date(recovery.timestamp).getTime();
            const mins = Math.round(age / 60000);
            cli.info('== Previous Session Crash Detected ==');
            cli.info(`   Time: ${new Date(recovery.timestamp).toLocaleString()} (${mins} min ago)`);
            if (recovery.crashReason) {
              cli.info(`   Reason: ${recovery.crashReason}`);
            }
            if (recovery.sessionId && recovery.sessionId !== 'unknown') {
              cli.info(`   Session: ${recovery.sessionId}`);
              // Attempt to auto-resume the crashed session
              try {
                const { getSessionStore } = await import('./persistence/session-store.js');
                const sessionStore = getSessionStore();
                const session = await sessionStore.getSessionByPartialId(recovery.sessionId);
                if (session) {
                  await sessionStore.resumeSession(session.id);
                  cli.info(`   Resuming session: ${session.name} (${session.messages.length} messages)`);
                } else {
                  cli.info('   Session no longer available — starting fresh.');
                }
              } catch (err) {
                logger.debug('Failed to resume crashed session', { error: String(err) });
                cli.info('   Could not resume session — starting fresh.');
              }
            }
            if (recovery.lastUserMessage) {
              const preview = recovery.lastUserMessage.length > 80
                ? recovery.lastUserMessage.substring(0, 80) + '...'
                : recovery.lastUserMessage;
              cli.info(`   Last message: "${preview}"`);
            }
            cli.info('');
            // Clear the recovery marker so we don't show this again
            await clearRecoveryFiles();
          }
        } catch (err) {
          // Non-fatal — don't block startup if recovery check fails
          logger.debug('Crash recovery check failed', { error: String(err) });
        }
      }

      // Support variadic positional arguments for multi-word initial message
      const initialMessage = Array.isArray(message)
        ? message.join(" ")
        : message;

      // Lazy load React and Ink for UI
      recordStartupPhase('ui-load-start');
      const React = await lazyImport.React();
      const { render } = await lazyImport.ink();
      const ChatInterface = await lazyImport.ChatInterface();

      // Log startup metrics before UI render
      recordStartupPhase('ui-render');
      logStartupMetrics();

      const totalStartupMs = Date.now() - STARTUP_TIME;
      if (totalStartupMs > 5000) {
        logger.warn(`Slow startup detected: ${totalStartupMs}ms. Run with PERF_TIMING=true for phase breakdown.`);
      } else {
        logger.debug(`Startup completed in ${totalStartupMs}ms`);
      }

      // Configure Ink render options
      const inkOptions: Record<string, unknown> = { exitOnCtrlC: true };
      if (options.altScreen === false) {
        // --no-alt-screen disables Ink's alternate screen buffer
        inkOptions.patchConsole = false;
      }

      // Opt the interactive session into the Hermes-style post-session background
      // self-learning review (still gated by CODEBUDDY_LEARNING_BACKGROUND_REVIEW).
      // Only the interactive TUI enables it, so cron/headless/sub-agent runs cannot
      // trigger a review (recursion + cost safety).
      agent.enableBackgroundReview();

      render(React.createElement(ChatInterface, { agent, initialMessage }), inkOptions);

      // Initialize plugin system in background (non-blocking)
      setImmediate(async () => {
        try {
          const { getPluginManager } = await lazyImport.pluginManager();
          const pluginManager = getPluginManager();
          await pluginManager.discover();
        } catch (error) {
          logger.warn('Failed to initialize plugin system:', { error: String(error) });
        }
      });

      // Initialize interaction logger + RunStore in background (non-blocking)
      setImmediate(async () => {
        try {
          const { getInteractionLogger } = await import('./logging/interaction-logger.js');
          const interactionLogger = getInteractionLogger();
          const currentModel = agent.getCurrentModel?.() || model || 'unknown';
          interactionLogger.startSession({
            model: currentModel,
            provider: baseURL?.includes('localhost') ? 'local' : 'xai',
            cwd: process.cwd(),
            tags: ['interactive'],
          });
          (agent as unknown as Record<string, unknown>).__interactionLogger = interactionLogger;
          // WS3-T1 — pre-load the flush module so the sync `exit` handler
          // can call it (ESM has no require; dynamic import is async).
          const sessionEndFlush = await import('./agent/session-end-flush.js');
          const cleanup = () => {
            try { interactionLogger.endSession(); } catch (e) { logger.debug('Failed to end interaction logger session', { error: String(e) }); }
            // `exit` handlers are sync-only: write at least the handoff
            // (no LLM) so an interrupted session still leaves a resume
            // point. The full async flush runs on SIGINT/SIGTERM below.
            try {
              sessionEndFlush.writeHandoffSync(agent.getChatHistory());
            } catch (_err) { /* handoff is best-effort on hard exit */ }
          };
          const flushThenExit = () => {
            cleanup();
            void (async () => {
              try {
                await Promise.race([
                  sessionEndFlush.runSessionEndFlush({ chatHistory: agent.getChatHistory() }),
                  new Promise<void>((resolve) => setTimeout(resolve, 8000).unref()),
                ]);
              } catch (_err) { /* never block exit on the flush */ }
              process.exit(0);
            })();
          };
          process.on('exit', cleanup);
          process.on('SIGINT', flushThenExit);
          process.on('SIGTERM', flushThenExit);
        } catch (err) {
          logger.warn('Failed to initialize interaction logger', { error: String(err) });
        }

        try {
          const { RunStore } = await import('./observability/run-store.js');
          const runStore = RunStore.getInstance();
          const runId = runStore.startRun('interactive session', {
            channel: 'terminal',
            tags: ['interactive', model || 'unknown'],
          });
          agent.setRunId(runId);
          const cleanupRun = () => {
            try { runStore.endRun(runId, 'completed'); } catch (_err) { /* ignore */ }
          };
          process.on('exit', cleanupRun);
        } catch (err) {
          logger.debug('RunStore init skipped', { error: String(err) });
        }
      });

      // Check for updates in background after UI renders
      setImmediate(async () => {
        try {
          const { getUpdateNotifier } = await import('./utils/update-notifier.js');
          await getUpdateNotifier().checkAndNotify();
        } catch (_err) {
          // Update check should never break the CLI
        }
      });

      // Generate .codebuddy/TOOLS.md in the background (non-blocking)
      setImmediate(async () => {
        try {
          const { generateToolsMd } = await import('./tools/tools-md-generator.js');
          await generateToolsMd();
        } catch (_err) {
          logger.debug('TOOLS.md background generation failed', { error: _err });
        }
      });

      // Start background preloading of common modules after UI renders
      setImmediate(async () => {
        try {
          const { initializeCLILazyLoader } = await lazyImport.lazyLoader();
          initializeCLILazyLoader();
        } catch (_err) {
          logger.debug('Failed to preload CLI lazy loader', { error: _err });
        }
      });
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Error initializing Code Buddy:", errorObj);
      process.exit(1);
    }
  });

// Git subcommand
const gitCommand = program
  .command("git")
  .description("Git operations with AI assistance");

gitCommand
  .command("commit-and-push")
  .description("Generate AI commit message and push to remote")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "CodeBuddy API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "CodeBuddy API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .action(async (options) => {
    // Load environment before changing cwd so root .env values (API keys) remain available
    // even when --directory points to a workspace without its own .env file.
    await ensureEnvLoaded();

    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: unknown) {
        logger.error(
          `Error changing directory to ${options.directory}:`,
          error as Error
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || await loadApiKey();
      const baseURL = options.baseUrl || await loadBaseURL();
      const model = options.model || await loadModel();
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        logger.error(
          [
            "❌ No AI provider configured. Pick one to get started:",
            "   • Guided setup (recommended) — interactive wizard:     buddy onboard",
            "   • Free, no API key — sign in with your ChatGPT plan:    buddy login",
            "   • Local & free — run a model with Ollama, then:         export OLLAMA_HOST=http://localhost:11434",
            "   • API key — set GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY (or pass --api-key)",
            "   Run  buddy doctor  to check your setup.",
          ].join("\n")
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      await handleCommitAndPushHeadless(apiKey, baseURL, model, maxToolRounds);
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Error during git commit-and-push:", errorObj);
      process.exit(1);
    }
  });

// Lazy command registration: create lightweight Commander stubs that defer
// importing heavy modules until the command is actually invoked.
// This avoids loading MCP, provider, pipeline, etc. at startup.

/**
 * Remove commands from a Commander program by name(s).
 * Uses splice to mutate the readonly commands array in-place.
 */
function removeCommands(parent: typeof program, names: string | string[]): void {
  const nameSet = new Set(Array.isArray(names) ? names : [names]);
  const cmds = parent.commands as import('commander').Command[];
  for (let i = cmds.length - 1; i >= 0; i--) {
    const cmd = cmds[i];
    if (cmd !== undefined && nameSet.has(cmd.name())) {
      cmds.splice(i, 1);
    }
  }
}

/**
 * Register a lazy subcommand tree. When any subcommand action fires, the
 * real module is imported and re-parsed to handle the invocation.
 *
 * For createXxxCommand()-style modules that return a Command with nested
 * subcommands, we register a thin wrapper that delegates to the real
 * command tree on first use.
 */
function addLazyCommand(
  parent: typeof program,
  name: string,
  description: string,
  loader: () => Promise<import('commander').Command>,
  prevalidateArgv?: (argv: readonly string[]) => void | Promise<void>,
): void {
  // Create a pass-through command that accepts arbitrary args
  const stub = parent
    .command(name)
    .description(description)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false);

  // Override the parse to delegate to the real command
  stub.action(async () => {
    try {
      await prevalidateArgv?.(process.argv);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`error: ${message}\n`);
      process.exit(1);
    }
    const realCommand = await loader();
    // Replace the stub with the real command and re-parse
    removeCommands(parent, name);
    parent.addCommand(realCommand);
    // Re-parse argv so the real command handles subcommands & options
    await parent.parseAsync(process.argv);
  });
}

addLazyCommand(
  program,
  'provider',
  'Manage AI providers (Claude, ChatGPT, Grok, Gemini)',
  async () => {
    const { createProviderCommand } = await import('./commands/provider.js');
    return createProviderCommand();
  },
);

addLazyCommand(
  program,
  'mcp',
  'Manage MCP (Model Context Protocol) servers',
  async () => {
    const { createMCPCommand } = await import('./commands/mcp.js');
    return createMCPCommand();
  },
);

addLazyCommand(
  program,
  'pipeline',
  'Manage and run pipeline workflows',
  async () => {
    const { createPipelineCommand } = await import('./commands/pipeline.js');
    return createPipelineCommand();
  },
);

// Channels command - manage channel connections (Telegram, Discord, Slack, etc.)
program
  .command("channels")
  .description("Manage channel connections (Telegram, Discord, Slack, etc.)")
  .argument("[action]", "start|stop|status|list", "list")
  .option("--type <type>", "Channel type (telegram|discord|slack|whatsapp|signal|google-chat|teams|matrix|webchat)")
  .option("--config <path>", "Channel config file path")
  .option("--json", "Output JSON for status")
  .action(async (action, options) => {
    const { handleChannels } = await import("./commands/handlers/channel-handlers.js");
    await handleChannels(action, options);
  });

// Server command - start the HTTP/WebSocket API server
program
  .command("server")
  .description("Start the Code Buddy HTTP/WebSocket API server")
  .option("--port <port>", "server port", "3000")
  .option("--host <host>", "server host", "0.0.0.0")
  .option("--no-auth", "disable JWT authentication")
  .action(async (options) => {
    const { startServer } = await import("./server/index.js");
    try {
      await startServer({
        port: parseInt(options.port),
        host: options.host,
        authEnabled: options.auth !== false,
      });
    } catch (error) {
      logger.error("Failed to start server", error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  });

program
  .command("voice")
  .description("Push-to-talk voice commands — speak an instruction, the agent acts, the reply is spoken")
  .option(
    "--mode <mode>",
    "voice ACT posture: plan (read-only, default) | dontAsk | bypassPermissions (can edit/run)",
    "plan",
  )
  .action(async (options) => {
    const allowed = ["plan", "dontAsk", "bypassPermissions"] as const;
    const mode = (allowed as readonly string[]).includes(options.mode) ? options.mode : "plan";
    if (mode !== options.mode) {
      cli.stdout(`⚠️  Unknown --mode '${options.mode}', falling back to 'plan' (read-only).`);
    }
    if (mode !== "plan") {
      cli.stdout(
        `⚠️  Posture '${mode}': voice can EDIT FILES / RUN COMMANDS from a possibly-misheard transcript. Ctrl-C to abort.`,
      );
    }
    try {
      const { runVoiceCommand } = await import("./cli/voice-command.js");
      await runVoiceCommand({ permissionMode: mode as "plan" | "dontAsk" | "bypassPermissions" });
    } catch (error) {
      logger.error("Voice command session failed", error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  });

program
  .command("remind [action] [args...]")
  .description("Reminders — the robot reminds you (meds…) and you flag them done (add|list|agenda|done|rm)")
  .option("--at <time>", "time of day HH:MM (for `add`)")
  .option("--date <date>", "one-shot date YYYY-MM-DD — fires once then retires (not recurring)")
  .option("--days <csv>", "days of week 0=Sun..6=Sat, e.g. 1,3,5 (default: every day)")
  .option("--ahead <n>", "agenda: how many days ahead to list (default 7)")
  .option("--daily", "every day (default when --days omitted)")
  .option("--message <text>", "custom spoken/sent text")
  .action(async (action: string | undefined, args: string[] = [], options) => {
    const r = await import("./companion/reminders.js");
    const act = (action || "list").toLowerCase();
    try {
      if (act === "add") {
        const label = args.join(" ").trim();
        if (!label || !options.at) {
          cli.stdout('Usage: buddy remind add "<label>" --at HH:MM [--days 1,3,5]');
          return;
        }
        const days = options.days
          ? String(options.days)
              .split(",")
              .map((s: string) => parseInt(s.trim(), 10))
              .filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6)
          : undefined;
        const rem = await r.addReminder({
          label,
          time: options.at,
          ...(options.date ? { date: String(options.date) } : days && days.length ? { days } : {}),
          ...(options.message ? { message: options.message } : {}),
        });
        cli.stdout(
          `✅ Added ${rem.id}: "${rem.label}" at ${rem.time} ${rem.date ? `on ${rem.date} (one-shot)` : rem.days?.length ? `on ${rem.days.join(",")}` : "daily"}`,
        );
      } else if (act === "list") {
        const list = await r.listReminders();
        if (!list.length) {
          cli.stdout('No reminders yet. Add one: buddy remind add "médicaments" --at 09:00');
          return;
        }
        for (const x of list) {
          const cadence = x.date ? `${x.date} (once)` : x.days?.length ? `[${x.days.join(",")}]` : "daily";
          cli.stdout(
            `${x.enabled ? "•" : "◦"} ${x.id}  ${x.time}  ${cadence}  ${x.label}` +
              `${x.lastDoneAt ? `  (last done ${x.lastDoneAt.slice(0, 16).replace("T", " ")})` : ""}`,
          );
        }
      } else if (act === "agenda") {
        const ahead = Number(options.ahead ?? 7);
        const agenda = r.agendaFor(await r.listReminders(), Date.now(), Number.isFinite(ahead) ? ahead : 7);
        if (!agenda.length) {
          cli.stdout("Rien de prévu dans cette période.");
          return;
        }
        for (const e of agenda) {
          const when = new Date(e.at).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
          cli.stdout(`${when}  ${e.time}  ${e.label}  ${e.recurring ? "[récurrent]" : "[ponctuel]"}`);
        }
      } else if (act === "done") {
        const id = args[0];
        if (!id) {
          cli.stdout("Usage: buddy remind done <id>");
          return;
        }
        const done = await r.markDone(id, "cli");
        cli.stdout(done ? `✅ Marked done: ${done.label}` : `Reminder not found: ${id}`);
      } else if (act === "rm" || act === "remove") {
        const id = args[0];
        if (!id) {
          cli.stdout("Usage: buddy remind rm <id>");
          return;
        }
        cli.stdout((await r.removeReminder(id)) ? `🗑️  Removed ${id}` : `Reminder not found: ${id}`);
      } else {
        cli.stdout("Usage: buddy remind add|list|done|rm");
      }
    } catch (e) {
      cli.stdout(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  });

program
  .command("rules [action] [args...]")
  .description("Administer sensory rules (event→action) — list|enable|disable|rm|runs|validate|add")
  .option("--json <rule>", "rule JSON (for `add`)")
  .option("--from-file <path>", "read rule JSON from a file (for `add`)")
  .option("--limit <n>", "max rows (for `runs`)", "20")
  .action(async (action: string | undefined, args: string[] = [], options) => {
    const r = await import("./sensory/sensory-rules-engine.js");
    const act = (action || "list").toLowerCase();
    try {
      if (act === "list") {
        const rules = await r.listSensoryRules();
        if (!rules.length) {
          cli.stdout("No sensory rules. Edit ~/.codebuddy/sensory-rules.json or: buddy rules add --json '…'");
          return;
        }
        for (const x of rules) {
          cli.stdout(
            `${x.enabled === false ? "◦" : "•"} ${x.id}  on:${x.match.kind}  → ${x.action.type}` +
              `${x.cooldownMs ? `  cd:${Math.round(x.cooldownMs / 1000)}s` : ""}${x.name ? `  (${x.name})` : ""}`,
          );
        }
      } else if (act === "enable" || act === "disable") {
        const id = args[0];
        if (!id) {
          cli.stdout(`Usage: buddy rules ${act} <id>`);
          return;
        }
        const ok = await r.toggleSensoryRule(id, act === "enable");
        cli.stdout(
          ok
            ? `${act === "enable" ? "✅ enabled" : "⏸️  disabled"} ${id} (live within ~2s on a running server — no restart)`
            : `Rule not found: ${id}`,
        );
      } else if (act === "rm" || act === "remove") {
        const id = args[0];
        if (!id) {
          cli.stdout("Usage: buddy rules rm <id>");
          return;
        }
        cli.stdout((await r.removeSensoryRule(id)) ? `🗑️  Removed ${id}` : `Rule not found: ${id}`);
      } else if (act === "runs") {
        const runs = await r.readRuleRuns(parseInt(options.limit, 10) || 20);
        if (!runs.length) {
          cli.stdout("No rule fires logged yet.");
          return;
        }
        for (const run of runs) {
          cli.stdout(
            `${new Date(run.ts).toISOString().slice(0, 19).replace("T", " ")}  ${run.ok ? "ok  " : "FAIL"}  ` +
              `${run.rule}  ${run.action}${run.detail ? `  ${String(run.detail).slice(0, 60)}` : ""}`,
          );
        }
      } else if (act === "validate") {
        const rules = await r.listSensoryRules();
        let bad = 0;
        for (const x of rules) {
          const v = r.validateRule(x);
          if (!v.ok) {
            bad++;
            cli.stdout(`❌ ${x.id}: ${v.errors.join("; ")}`);
          }
        }
        cli.stdout(bad ? `${bad} invalid rule(s).` : `✅ ${rules.length} rule(s) valid.`);
      } else if (act === "add") {
        let raw = options.json as string | undefined;
        if (!raw && options.fromFile) {
          raw = await (await import("node:fs/promises")).readFile(options.fromFile, "utf8");
        }
        if (!raw) {
          cli.stdout(
            'Usage: buddy rules add --json \'{"id":"x","match":{"kind":"person_entered"},"action":{"type":"alert","message":"hi"}}\'',
          );
          return;
        }
        let rule;
        try {
          rule = JSON.parse(raw);
        } catch (e) {
          cli.stdout(`❌ invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        const res = await r.upsertSensoryRule(rule);
        cli.stdout(res.ok ? `✅ Saved rule ${rule.id}` : `❌ rejected:\n  - ${res.errors.join("\n  - ")}`);
      } else {
        cli.stdout("Usage: buddy rules list|enable|disable|rm|runs|validate|add");
      }
    } catch (e) {
      cli.stdout(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  });

// Cowork (the Electron desktop GUI) needs Node >= 22; the terminal CLI runs on
// Node >= 18. Without this guard a Node 18/20 user gets a cryptic Electron/Vite
// crash mid-launch instead of a clear message — a classic first-run star-killer.
const COWORK_MIN_NODE_MAJOR = 22;
function assertNodeForCowork(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(major) && major < COWORK_MIN_NODE_MAJOR) {
    cli.stdout(
      `❌ Cowork (the desktop GUI) requires Node.js >= ${COWORK_MIN_NODE_MAJOR} — you're on v${process.versions.node}.`,
    );
    cli.stdout(
      `   The terminal CLI works on Node >= 18; only the Electron app needs >= ${COWORK_MIN_NODE_MAJOR}.`,
    );
    cli.stdout(
      `   Upgrade Node (e.g. \`nvm install 22 && nvm use 22\`) and retry. Linux build notes: cowork/DEV-LINUX.md`,
    );
    process.exit(1);
  }
}

// Desktop GUI commands
program
  .command("gui")
  .description("Launch the Code Buddy desktop GUI (Electron)")
  .option("--dev", "start with Vite dev server (hot reload)")
  .option("--detach", "run in background")
  .action(async (options) => {
    assertNodeForCowork();
    const { launchDesktop } = await import("./desktop/launcher.js");
    const code = await launchDesktop({
      dev: options.dev,
      detach: options.detach,
    });
    process.exit(code);
  });

program
  .command("desktop")
  .description("Alias for 'buddy gui'")
  .option("--dev", "start with Vite dev server")
  .option("--detach", "run in background")
  .action(async (options) => {
    assertNodeForCowork();
    const { launchDesktop } = await import("./desktop/launcher.js");
    const code = await launchDesktop({
      dev: options.dev,
      detach: options.detach,
    });
    process.exit(code);
  });

program
  .command("install-gui")
  .description("Install Electron and build the desktop GUI")
  .action(async () => {
    assertNodeForCowork();
    const { installGUI } = await import("./desktop/installer.js");
    await installGUI();
  });

/**
 * After a successful xAI login, probe api.x.ai with one tiny real call so the
 * user learns immediately whether their subscription includes API inference
 * (a SuperGrok plan does not always — the OAuth `api:access` scope is
 * requested, not guaranteed granted).
 */
async function probeXaiInference(): Promise<void> {
  const { getValidXaiAccessToken, XAI_OAUTH_BASE_URL } = await import(
    "./providers/xai-oauth.js"
  );
  cli.stdout("\nVerifying inference access (api.x.ai) ...");
  const token = await getValidXaiAccessToken();
  if (!token) {
    cli.error("❌ Could not load a valid token after login.");
    return;
  }
  const probeModel = process.env.GROK_MODEL || "grok-3";
  try {
    const res = await fetch(`${XAI_OAUTH_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: probeModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      cli.stdout("✅ Inference access confirmed — your subscription works in Code Buddy.");
      cli.stdout(`   Try: buddy --model ${probeModel} -p "hello"   (or just \`buddy\`)`);
    } else if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      cli.error(
        `⚠️ Login succeeded, but api.x.ai returned ${res.status} — your subscription may not include API inference.`
      );
      if (body) cli.error(`   Detail: ${body.slice(0, 200)}`);
      cli.error("   You can still use Grok with a metered API key: set XAI_API_KEY.");
    } else {
      const body = await res.text().catch(() => "");
      cli.error(`⚠️ Probe returned ${res.status} (model "${probeModel}"?): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    cli.error(`⚠️ Probe call failed (network?): ${err instanceof Error ? err.message : String(err)}`);
    cli.stdout('   Tokens are stored; try `buddy -p "hello"`.');
  }
}

/**
 * xAI / Grok subscription login (`buddy login xai`). Two-step so it works in
 * backgrounded / non-interactive / remote shells where stdin can't be pasted
 * into: step 1 opens the browser + persists the PKCE material, step 2
 * (`--code <code>`) exchanges the code xAI shows in-page. In an interactive
 * TTY, step 1 also accepts the code inline for a one-shot experience.
 */
async function loginXaiCli(codeArg?: string): Promise<void> {
  const xai = await import("./providers/xai-oauth.js");

  // Step 2 — complete a pending login with the copied code.
  if (codeArg) {
    try {
      const auth = await xai.completeLogin(codeArg);
      cli.stdout("✅ Authenticated with xAI");
      if (auth.email) cli.stdout(`   Account:   ${auth.email}`);
      if (typeof auth.expires_in_seconds === "number") {
        cli.stdout(`   Token TTL: ~${Math.round(auth.expires_in_seconds / 60)} min`);
      }
      cli.stdout(`   Tokens stored at: ${xai.getXaiAuthFilePath()}`);
      await probeXaiInference();
    } catch (err) {
      cli.error(`❌ Login failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  // Step 1 — open the browser and persist the pending PKCE material.
  cli.stdout("🔐 xAI / Grok login");
  let authorizeUrl: string;
  try {
    ({ authorizeUrl } = await xai.beginLogin());
  } catch (err) {
    cli.error(`❌ Could not start login: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }
  try {
    const openModule = await import("open");
    await openModule.default(authorizeUrl);
    cli.stdout("Opening your browser to authorize Code Buddy with your xAI / SuperGrok plan ...");
  } catch (_err) {
    /* browser open is best-effort — fall back to the printed URL below */
  }
  cli.stdout(`\nIf your browser didn't open, visit this URL:\n${authorizeUrl}\n`);
  cli.stdout("xAI shows an authorization CODE in the page. Copy it, then run:");
  cli.stdout("   buddy login xai --code <PASTE_THE_CODE>\n");

  // Interactive convenience: if we have a real TTY, accept the code inline.
  if (process.stdin.isTTY) {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise((resolve) =>
      rl.question("Paste the code here (or Ctrl-C to finish later): ", resolve)
    );
    rl.close();
    if (answer.trim()) {
      try {
        const auth = await xai.completeLogin(answer);
        cli.stdout("✅ Authenticated with xAI");
        if (auth.email) cli.stdout(`   Account:   ${auth.email}`);
        cli.stdout(`   Tokens stored at: ${xai.getXaiAuthFilePath()}`);
        await probeXaiInference();
      } catch (err) {
        cli.error(`❌ Login failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
  }
}

// Phase d.23+ — Authentication commands.
// Run the OAuth flow directly from the CLI so users don't have to enter
// the interactive TUI just to log in. Mirrors the `/login` slash command
// that's available inside a session.
program
  .command("login [provider]")
  .description("Authenticate with a provider (chatgpt | xai — uses your subscription, no API key)")
  .option("--code <code>", "Complete an xAI login with the code shown in the browser")
  .action(async (provider: string | undefined, options: { code?: string }) => {
    const target = (provider ?? "chatgpt").toLowerCase();
    if (target === "xai" || target === "grok" || target === "xai-oauth") {
      await loginXaiCli(options.code);
      return;
    }
    if (target !== "chatgpt" && target !== "codex" && target !== "openai") {
      cli.stdout(`Unknown provider: "${provider}". Supported: \`chatgpt\`, \`xai\`.`);
      cli.stdout("Other providers (Gemini, Anthropic) authenticate via API key env vars.");
      process.exit(1);
    }
    const { loginInteractive, getCodexAuthFilePath } = await import(
      "./providers/codex-oauth.js"
    );
    cli.stdout("🔐 ChatGPT login");
    cli.stdout("Opening your browser to https://auth.openai.com/oauth/authorize ...");
    cli.stdout("Sign in with your ChatGPT account, then return to this terminal.\n");
    try {
      const auth = await loginInteractive();
      cli.stdout("✅ Authenticated successfully");
      if (auth.email) cli.stdout(`   Account:    ${auth.email}`);
      if (auth.plan_type) cli.stdout(`   Plan:       ${auth.plan_type}`);
      if (auth.is_fedramp) cli.stdout(`   FedRAMP:    yes`);
      if (auth.account_id) cli.stdout(`   Account ID: ${auth.account_id}`);
      cli.stdout(`\nTokens stored at: ${getCodexAuthFilePath()}`);
      cli.stdout("Run `buddy --print \"hello\"` to test, or just `buddy` for a chat session.");
    } catch (err) {
      cli.error(`❌ Login failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command("logout [provider]")
  .description("Clear stored credentials for a provider (chatgpt | xai)")
  .action(async (provider?: string) => {
    const target = (provider ?? "chatgpt").toLowerCase();
    if (target === "xai" || target === "grok" || target === "xai-oauth") {
      const { hasXaiCredentials, clearXaiCredentials, getXaiAuthFilePath } =
        await import("./providers/xai-oauth.js");
      if (!hasXaiCredentials()) {
        cli.stdout("No xAI credentials on disk — already logged out.");
        return;
      }
      clearXaiCredentials();
      cli.stdout(`✅ xAI credentials cleared (${getXaiAuthFilePath()})`);
      return;
    }
    if (target !== "chatgpt" && target !== "codex" && target !== "openai") {
      cli.stdout(`Unknown provider: "${provider}". Supported: \`chatgpt\`, \`xai\`.`);
      process.exit(1);
    }
    const { hasCodexCredentials, clearCodexCredentials, getCodexAuthFilePath } =
      await import("./providers/codex-oauth.js");
    if (!hasCodexCredentials()) {
      cli.stdout("No ChatGPT credentials on disk — already logged out.");
      return;
    }
    clearCodexCredentials();
    cli.stdout(`✅ ChatGPT credentials cleared (${getCodexAuthFilePath()})`);
  });

program
  .command("whoami")
  .description("Show current authentication status (email, plan, account)")
  .action(async () => {
    const { hasCodexCredentials, getChatGptAuth } = await import(
      "./providers/codex-oauth.js"
    );
    if (!hasCodexCredentials()) {
      cli.stdout("ChatGPT: not connected (run `buddy login` to authenticate)");
      return;
    }
    try {
      const auth = await getChatGptAuth();
      if (!auth) {
        cli.stdout("ChatGPT: token unreadable. Run `buddy logout` then `buddy login`.");
        return;
      }
      cli.stdout("ChatGPT: ✅ connected");
      if (auth.email) cli.stdout(`  Account:    ${auth.email}`);
      if (auth.plan_type) cli.stdout(`  Plan:       ${auth.plan_type}`);
      if (auth.account_id) cli.stdout(`  Account ID: ${auth.account_id}`);
      if (auth.is_fedramp) cli.stdout(`  FedRAMP:    yes`);
    } catch (err) {
      cli.error(`Error reading credentials: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Active-LLM registry — list the LLMs you're logged into + the failover order.
program
  .command("llm [action] [prompt...]")
  .description("List active LLMs, or run several together: llm ensemble|consensus|race <prompt>")
  .option("--order <policy>", "Ordering: resilience | free-first | manual")
  .action(async (action: string | undefined, promptParts: string[] = [], opts: { order?: string }) => {
    const primary = await getDetectedProvider();
    const { buildActiveLlmRegistry } = await import("./providers/active-llm-registry.js");
    const registry = await buildActiveLlmRegistry({
      primary: primary
        ? {
            provider: primary.provider,
            apiKey: primary.apiKey,
            baseURL: primary.baseURL,
            model: primary.defaultModel,
          }
        : undefined,
      policy: opts.order as "resilience" | "free-first" | "manual" | undefined,
    });

    if (registry.all.length === 0) {
      cli.stdout("No active LLMs detected. Run `buddy login`, set an API key, or start Ollama.");
      return;
    }

    // "Together" — run several active LLMs at once and aggregate the result.
    const strategyByAction: Record<string, "ensemble" | "consensus" | "fastest" | "all"> = {
      ensemble: "ensemble",
      consensus: "consensus",
      race: "fastest",
      together: "all",
    };
    const strategy = action ? strategyByAction[action.toLowerCase()] : undefined;
    if (strategy) {
      const promptText = promptParts.join(" ").trim();
      if (!promptText) {
        cli.error(`Usage: buddy llm ${action} "<prompt>"`);
        process.exit(1);
      }
      const models = registry.all.map((p) => ({
        id: p.provider,
        name: p.provider,
        provider: "codebuddy" as const,
        model: p.model,
        apiKey: p.apiKey,
        baseURL: p.baseURL,
        enabled: true,
        costPerToken: p.costInputUsdPerMtok / 1_000_000,
      }));
      cli.stdout(`Running ${action} across ${models.map((m) => m.id).join(", ")} …`);
      const { createParallelExecutor } = await import("./agent/parallel/parallel-executor.js");
      const executor = createParallelExecutor({ models, strategy });
      const result = await executor.execute(promptText);
      // Show each LLM's own answer — the point of running them together.
      for (const r of result.responses) {
        if (r.error) {
          cli.stdout(`\n── ${r.modelName} ❌ ${r.error.slice(0, 140)}`);
        } else {
          cli.stdout(`\n── ${r.modelName}  (${r.latency}ms, ${r.tokensUsed} tok)\n${r.content.trim()}`);
        }
      }
      cli.stdout(`\n${executor.formatResult(result)}`);
      return;
    }

    cli.stdout("Active LLMs (logged in + reachable):");
    for (const p of registry.all) {
      const isPrimary = registry.primaryProvider === p.provider ? "  ← primary" : "";
      const tag = p.isLocal ? "local" : "cloud";
      const cost = p.costInputUsdPerMtok === 0 ? "$0" : `$${p.costInputUsdPerMtok}/Mtok`;
      cli.stdout(`  • ${p.provider.padEnd(10)} [${tag}] ${p.model}  (${cost})${isPrimary}`);
    }
    if (registry.fallbacks.length > 0) {
      cli.stdout(
        `\nFailover order: ${primary?.provider ?? "?"} → ${registry.fallbacks
          .map((f) => f.provider)
          .join(" → ")}`,
      );
    } else {
      cli.stdout("\nNo additional active LLMs available for failover.");
    }
    const { getConfigManager } = await import("./config/toml-config.js");
    const on =
      Boolean(getConfigManager().getConfig().llm?.enabled) ||
      process.env.CODEBUDDY_LLM_FAILOVER === "1";
    cli.stdout(
      `Auto-failover: ${on ? "ON" : "OFF  (enable with [llm].enabled = true, or CODEBUDDY_LLM_FAILOVER=1)"}`,
    );
  });

// Council — capability-aware multi-LLM router + ensemble (judge + consensus) + learning.
program
  .command("council [task...]")
  .description("Ask a capability-routed AI council with conductor roles, judge + reconcile the answers, and learn winners per task type")
  .option("-n, --count <n>", "How many models to consult (default 3)")
  .option("--models <list>", "Restrict to these providers/models (comma list)")
  .option("--judge <model>", "Provider/model to use as the impartial judge")
  .option("--task-type <tag>", "Override inferred task type (code|reasoning|french|vision|general)")
  .option("--no-consensus", "Skip the consensus/agreement summary")
  .option("--scoreboard", "Print the learned model ranking and exit")
  .option("--fleet", "Also consult connected fleet peers (other machines' Code Buddy) over the network")
  .option("--no-conductor", "Disable adaptive council roles and ask every model the exact same prompt")
  .option("--no-synthesis", "Disable the final collective synthesis pass")
  .action(
    async (
      taskParts: string[] = [],
      options: { count?: string; models?: string; judge?: string; taskType?: string; consensus?: boolean; scoreboard?: boolean; fleet?: boolean; conductor?: boolean; synthesis?: boolean },
    ) => {
      const { runCouncil } = await import("./commands/council.js");
      await runCouncil(
        (taskParts || []).join(" ").trim(),
        {
          count: options.count ? Number(options.count) : undefined,
          models: options.models,
          judge: options.judge,
          taskType: options.taskType,
          consensus: options.consensus,
          scoreboard: options.scoreboard,
          fleet: options.fleet,
          conductor: options.conductor,
          synthesis: options.synthesis,
        },
        cli.stdout,
      );
    },
  );

// MCP Server command - run Code Buddy as an MCP tool provider over stdio
program
  .command("mcp-server")
  .description("Start Code Buddy as an MCP server over stdio (for VS Code, Cursor, etc.)")
  .option("--list", "List available MCP tools and exit")
  .action(async (options) => {
    if (options.list) {
      const { CodeBuddyMCPServer } = await import("./mcp/mcp-server.js");
      const tools = CodeBuddyMCPServer.getToolDefinitions();
      // Pipeable listing.
      for (const tool of tools) {
        cli.stdout(`${tool.name}: ${tool.description}`);
      }
      return;
    }

    try {
      const { CodeBuddyMCPServer } = await import("./mcp/mcp-server.js");
      const server = new CodeBuddyMCPServer();
      await server.start();
    } catch (error) {
      logger.error("Failed to start MCP server", error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  });

// Register extracted CLI command modules lazily.
// Each registerXxxCommands function only imports `type { Command }` from commander
// and its action handlers already use dynamic imports, but loading the module
// file itself pulls in transitive dependencies (logger, etc.) at startup.
// By deferring the import until the command is matched, we avoid that cost.

/**
 * Register a lazy command group. Creates a stub command whose action
 * loads the real registration module and re-parses argv.
 */
function addLazyCommandGroup(
  parent: typeof program,
  name: string,
  description: string,
  loader: () => Promise<void>,
): void {
  const stub = parent
    .command(name)
    .description(description)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false);

  stub.action(async () => {
    // Remove stub and register the real commands
    removeCommands(parent, name);
    await loader();
    // Re-parse so the real command tree handles the invocation
    await parent.parseAsync(process.argv);
  });
}

addLazyCommandGroup(program, 'daemon', 'Manage the Code Buddy daemon (background process)', async () => {
  const { registerDaemonCommands } = await import('./commands/cli/daemon-commands.js');
  registerDaemonCommands(program);
});

addLazyCommandGroup(program, 'trigger', 'Manage event triggers for automated agent responses', async () => {
  const { registerTriggerCommands } = await import('./commands/cli/daemon-commands.js');
  registerTriggerCommands(program);
});

addLazyCommandGroup(program, 'speak', 'Synthesize speech using AudioReader TTS', async () => {
  const { registerSpeakCommand } = await import('./commands/cli/speak-command.js');
  registerSpeakCommand(program);
});

addLazyCommandGroup(program, 'assistant', 'Manage the voice assistant (Lisa): improvement loop, voice', async () => {
  const { registerAssistantCommand } = await import('./commands/assistant.js');
  registerAssistantCommand(program);
});

addLazyCommandGroup(program, 'widgets', 'Inline conversation widgets: list, preview, generate (authored)', async () => {
  const { registerWidgetsCommand } = await import('./commands/widgets.js');
  registerWidgetsCommand(program);
});

// Utility commands (doctor, security-audit, onboard, webhook) are all registered
// by a single registerUtilityCommands() call, so we must remove all stubs before
// re-registering to avoid Commander duplicate command errors.
const utilityCommandNames = ['doctor', 'security-audit', 'onboard', 'webhook', 'ollama'];
const loadUtilityCommands = async () => {
  // Remove all utility stubs at once
  removeCommands(program, utilityCommandNames);
  const { registerUtilityCommands } = await import('./commands/cli/utility-commands.js');
  registerUtilityCommands(program);
  await program.parseAsync(process.argv);
};

for (const cmdName of utilityCommandNames) {
  const desc = cmdName === 'doctor' ? 'Diagnose Code Buddy environment, dependencies, and configuration'
    : cmdName === 'security-audit' ? 'Run a security audit of your Code Buddy environment'
    : cmdName === 'onboard' ? 'Interactive setup wizard for Code Buddy'
    : cmdName === 'ollama' ? 'Inspect or update the local Ollama runtime'
    : 'Manage webhook triggers';

  const stub = program
    .command(cmdName)
    .description(desc)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false);

  stub.action(async () => {
    await loadUtilityCommands();
  });
}

// Enterprise-grade commands
addLazyCommandGroup(program, 'heartbeat', 'Manage the heartbeat engine (periodic agent wake)', async () => {
  const { registerHeartbeatCommands } = await import('./commands/cli/native-engine-commands.js');
  registerHeartbeatCommands(program);
});

addLazyCommandGroup(program, 'hub', 'Skills marketplace (search, install, publish)', async () => {
  const { registerHubCommands } = await import('./commands/cli/native-engine-commands.js');
  registerHubCommands(program);
});

addLazyCommandGroup(program, 'curator', 'Propose-only maintenance report (memory, skills, CKG, lessons, costs)', async () => {
  const { registerCuratorCommand } = await import('./commands/curator-cli.js');
  registerCuratorCommand(program);
});

addLazyCommandGroup(program, 'gateway-pairing', 'Operator approval for gateway device pairing', async () => {
  const { registerGatewayPairingCommands } = await import('./commands/cli/native-engine-commands.js');
  registerGatewayPairingCommands(program);
});

addLazyCommandGroup(program, 'screen', 'Capture, record, or watch the screen / a window (real-time machine context)', async () => {
  const { registerScreenCommands } = await import('./commands/cli/screen-commands.js');
  registerScreenCommands(program);
});

addLazyCommandGroup(program, 'autonomy', 'Autonomous fleet loop (claim + run colab tasks on local-first models)', async () => {
  const { registerFleetAutonomyCommands } = await import('./commands/cli/native-engine-commands.js');
  registerFleetAutonomyCommands(program);
});

addLazyCommandGroup(program, 'device', 'Manage paired device nodes (SSH, ADB, local)', async () => {
  const { registerDeviceCommands } = await import('./commands/cli/device-commands.js');
  registerDeviceCommands(program);
});

addLazyCommandGroup(program, 'identity', 'Manage agent identity files (SOUL.md, USER.md, etc.)', async () => {
  const { registerIdentityCommands } = await import('./commands/cli/native-engine-commands.js');
  registerIdentityCommands(program);
});

addLazyCommandGroup(program, 'companion', 'Configure Buddy as a ChatGPT-backed voice companion', async () => {
  const { registerCompanionCommands } = await import('./commands/cli/native-engine-commands.js');
  registerCompanionCommands(program);
});

addLazyCommandGroup(program, 'groups', 'Manage group chat security', async () => {
  const { registerGroupCommands } = await import('./commands/cli/native-engine-commands.js');
  registerGroupCommands(program);
});

addLazyCommandGroup(program, 'auth-profile', 'Manage authentication profiles (API key rotation)', async () => {
  const { registerAuthProfileCommands } = await import('./commands/cli/native-engine-commands.js');
  registerAuthProfileCommands(program);
});

addLazyCommandGroup(program, 'fleet', 'Inspect Fleet routing and dispatch policy decisions', async () => {
  const { registerFleetCommands } = await import('./commands/cli/fleet-commands.js');
  registerFleetCommands(program);
});

addLazyCommandGroup(program, 'code-explorer', 'Interact with CodeExplorer for code understanding and session syncing', async () => {
  const { registerCodeExplorerCommands } = await import('./commands/cli/code-explorer-commands.js');
  registerCodeExplorerCommands(program);
});

addLazyCommandGroup(program, 'hermes', 'Inspect the native Hermes-inspired Code Buddy agent profile', async () => {
  const { registerHermesCommands } = await import('./commands/cli/hermes-commands.js');
  registerHermesCommands(program);
});

addLazyCommandGroup(program, 'acp', 'Run Code Buddy as an ACP (Agent Client Protocol) agent over stdio for editor integration', async () => {
  const { registerAcpCommand } = await import('./commands/cli/acp-command.js');
  registerAcpCommand(program);
});

addLazyCommandGroup(program, 'tools', 'Inspect tool profiles and effective tool availability', async () => {
  const { registerToolsCommands } = await import('./commands/cli/tools-commands.js');
  registerToolsCommands(program);
});

addLazyCommandGroup(program, 'autonomous-code', 'Run a guarded Agentic Coding Cell task contract', async () => {
  const { registerAutonomousCodeCommand } = await import('./commands/cli/autonomous-code-command.js');
  registerAutonomousCodeCommand(program);
});

addLazyCommandGroup(program, 'session', 'Manage saved sessions', async () => {
  const { registerSessionCommands } = await import('./cli/session-commands.js');
  registerSessionCommands(program);
});

addLazyCommandGroup(program, 'config', 'Show environment variable configuration and validation', async () => {
  const { registerConfigCommand } = await import('./commands/cli/config-command.js');
  registerConfigCommand(program);
});

// Dev workflows — plan, run, pr, fix-ci, explain
addLazyCommandGroup(program, 'dev', 'Golden-path developer workflows (plan, run, pr, fix-ci, explain)', async () => {
  const { registerDevCommands } = await import('./commands/dev/index.js');
  registerDevCommands(program);
});

// Run observability — list, show, tail, replay
addLazyCommandGroup(program, 'run', 'Inspect and replay agent runs (observability)', async () => {
  const { registerRunCommands } = await import('./commands/run-cli/index.js');
  registerRunCommands(program);
});

// Cron — author and manage scheduled jobs (incl. watchdog + pre-check)
addLazyCommandGroup(program, 'cron', 'Author and manage scheduled cron jobs', async () => {
  const { registerCronCommands } = await import('./commands/cron-cli/index.js');
  registerCronCommands(program);
});

// Skills — browse, inspect telemetry, enable/disable installed SKILL.md packages
addLazyCommandGroup(program, 'skills', 'Browse and manage installed skill packages', async () => {
  const { registerSkillsCommands } = await import('./commands/skills-cli/index.js');
  registerSkillsCommands(program);
});

// DM pairing — approve, revoke, list, pending
addLazyCommand(
  program,
  'pairing',
  'Manage DM pairing security (allowlist for messaging channel senders)',
  async () => {
    const { createPairingCommand } = await import('./commands/pairing.js');
    return createPairingCommand();
  },
);

// Knowledge base management — add, list, show, search, remove, context
addLazyCommand(
  program,
  'knowledge',
  'Manage agent knowledge bases (Knowledge.md files injected as context)',
  async () => {
    const { createKnowledgeCommand } = await import('./commands/knowledge.js');
    return createKnowledgeCommand();
  },
);

// Wide Research — parallel agent workers for comprehensive research
addLazyCommand(
  program,
  'research',
  'Wide Research: spawn parallel agent workers to research a topic (Manus AI-inspired)',
  async () => {
    const { createResearchCommand } = await import('./commands/research/index.js');
    return createResearchCommand();
  },
);

// Paper QA — grounded, cited answers over a local corpus of scientific PDFs
addLazyCommand(
  program,
  'papers',
  'Paper QA: ask a question over a corpus of scientific PDFs and get a grounded, cited answer',
  async () => {
    const { createPapersCommand } = await import('./commands/papers/index.js');
    return createPapersCommand();
  },
);

// AI-Scientist-lite (Phases 0-3) — human-gated, sandboxed experiment: single pass or bounded discovery loop (opt-in)
addLazyCommand(
  program,
  'science',
  'AI-Scientist-lite (EXPERIMENTAL, opt-in CODEBUDDY_AI_SCIENTIST=true): human-gated, sandboxed experiment — single pass or bounded best-first discovery loop (--loop)',
  async () => {
    const { createScienceCommand } = await import('./commands/science/index.js');
    return createScienceCommand();
  },
);

// Vision-training — synthetic perception curriculum: score robot vision vs
// self-labeled scenes to find where it's weak (opt-in CODEBUDDY_VISION_TRAIN=true)
addLazyCommand(
  program,
  'vision-train',
  'Synthetic perception-training loop (EXPERIMENTAL, opt-in CODEBUDDY_VISION_TRAIN=true): score the robot vision (YOLO) on labeled generated/real scenes → a weakness benchmark',
  async () => {
    const { createVisionTrainCommand } = await import('./commands/vision-train.js');
    return createVisionTrainCommand();
  },
);

// Planning Flow — OpenManus-compatible multi-agent orchestration
addLazyCommand(
  program,
  'flow',
  'Execute a multi-agent planning flow (OpenManus-compatible): plan → execute → synthesize',
  async () => {
    const { createFlowCommand } = await import('./commands/flow.js');
    return createFlowCommand();
  },
);

// Film producer — chain generated clips into a long-form film with transitions
addLazyCommand(
  program,
  'film',
  'Produce a long-form film from a scene plan: generate a clip per scene → montage with transitions + music → quality gate (resumable). Subcommands: generate|assemble|status',
  async () => {
    const { createFilmCommand } = await import('./commands/film.js');
    return createFilmCommand();
  },
);

// Goal Ralph loop — headless judge-gated auto-continue (Hermes Agent parity)
addLazyCommand(
  program,
  'goal',
  'Run the agent toward a standing goal until a judge model confirms it is done (Ralph loop)',
  async () => {
    const { createGoalCommand } = await import('./commands/goal-cli.js');
    return createGoalCommand();
  },
  async argv => {
    const { validateGoalCommandNumericOptions } = await import('./commands/goal-cli.js');
    validateGoalCommandNumericOptions(argv);
  },
);

// Dev-loop — boucle unifiée plan→exécute→vérifie(Verifier)→juge→décide (façon /loop)
addLazyCommand(
  program,
  'loop',
  'Boucle de dev autonome (plan→exécute→vérifie→juge→décide) jusqu\'à fait prouvé ou budget',
  async () => {
    const { createLoopCommand } = await import('./commands/loop-cli.js');
    return createLoopCommand();
  },
  async argv => {
    const { validateLoopCommandNumericOptions } = await import('./commands/loop-cli.js');
    validateLoopCommandNumericOptions(argv);
  },
);

// Todo attention bias — Manus AI-inspired persistent task list
addLazyCommand(
  program,
  'todo',
  'Manage persistent task list (todo.md) — injected at end of every agent turn for focus',
  async () => {
    const { createTodosCommand } = await import('./commands/todos.js');
    return createTodosCommand();
  },
);

// Exec Policy — Codex-inspired command authorization (allow/deny/ask/sandbox + prefix rules)
addLazyCommand(
  program,
  'execpolicy',
  'Manage execution policy rules (allow/deny/ask/sandbox) for shell commands',
  async () => {
    const { createExecPolicyCommand } = await import('./commands/execpolicy.js');
    return createExecPolicyCommand();
  },
);

// Lessons — self-improvement loop (lessons learned injected per agent turn)
addLazyCommand(
  program,
  'lessons',
  'Manage lessons learned — self-improvement loop for recurring patterns (injected every turn)',
  async () => {
    const { createLessonsCommand } = await import('./commands/lessons.js');
    return createLessonsCommand();
  },
);

// Spec — BMAD-inspired spec-driven, review-gated work pipeline
addLazyCommandGroup(
  program,
  'spec',
  'Spec-driven, review-gated work pipeline (durable stories; approve before implementing)',
  async () => {
    const { createSpecCommand } = await import('./commands/spec.js');
    program.addCommand(createSpecCommand());
  },
);

// User model — structured model of the user's working preferences (propose/review)
addLazyCommand(
  program,
  'user-model',
  'Manage the local user model — working preferences, propose/review (no silent write)',
  async () => {
    const { createUserModelCommand } = await import('./commands/user-model.js');
    return createUserModelCommand();
  },
);

// Update — channel-based update management (stable/beta/dev)
addLazyCommand(
  program,
  'update',
  'Update Code Buddy (switch channels: stable, beta, dev)',
  async () => {
    const { createUpdateCommand } = await import('./commands/update.js');
    return createUpdateCommand();
  },
);

// Tunnel — manage ngrok tunnels
addLazyCommand(
  program,
  'tunnel',
  'Manage ngrok tunnels for the Code Buddy remote gateway',
  async () => {
    const { createTunnelCommand } = await import('./commands/tunnel.js');
    return createTunnelCommand();
  },
);

// Nodes — companion app node management (macOS, iOS, Android)
addLazyCommandGroup(program, 'nodes', 'Manage companion app nodes (macOS, iOS, Android)', async () => {
  const { registerNodeCommands } = await import('./commands/cli/node-commands.js');
  registerNodeCommands(program);
});

// Secrets — encrypted vault for API keys and credentials
addLazyCommandGroup(program, 'secrets', 'Manage API keys and credentials (encrypted vault)', async () => {
  const { registerSecretsCommands } = await import('./commands/cli/secrets-command.js');
  registerSecretsCommands(program);
});

// Approvals — manage tool/action approval requests
addLazyCommandGroup(program, 'approvals', 'Manage tool/action approval requests', async () => {
  const { registerApprovalsCommands } = await import('./commands/cli/approvals-command.js');
  registerApprovalsCommands(program);
});

// Insights — token/cost/activity analytics (Hermes parity: `hermes insights`)
addLazyCommandGroup(program, 'insights', 'Token, cost, and activity analytics (read-only)', async () => {
  const { registerInsightsCommands } = await import('./commands/cli/insights-command.js');
  registerInsightsCommands(program);
});

// Bundles — group skills under one named slash-command (Hermes parity: `hermes bundles`)
addLazyCommandGroup(program, 'bundles', 'Group skills under a single named slash-command bundle', async () => {
  const { registerBundlesCommands } = await import('./commands/cli/bundles-command.js');
  registerBundlesCommands(program);
});

// Improve — recursive self-improvement engine (empirically-gated, reversible)
addLazyCommandGroup(program, 'improve', 'Recursive self-improvement: empirically validate and apply reversible learning improvements', async () => {
  const { registerImproveCommands } = await import('./commands/cli/improve-command.js');
  registerImproveCommands(program);
});

// Evolve — git-versioned evolutionary self-improvement (evaluate code variants, keep the best, human-gated)
addLazyCommandGroup(program, 'evolve', 'Git-versioned evolutionary self-improvement: evaluate code variants, keep the best (human-gated)', async () => {
  const { registerEvolveCommands } = await import('./commands/cli/evolve-command.js');
  registerEvolveCommands(program);
});

// LSP — Language Server Protocol diagnostics (Hermes parity: `hermes lsp`)
addLazyCommandGroup(program, 'lsp', 'Language Server Protocol diagnostics', async () => {
  const { registerLspCommands } = await import('./commands/cli/lsp-command.js');
  registerLspCommands(program);
});

// Proxy — OpenAI-compatible HTTP proxy for third-party clients (Hermes parity: `hermes proxy`)
addLazyCommandGroup(program, 'proxy', 'Start an OpenAI-compatible HTTP proxy in front of Code Buddy (for third-party clients)', async () => {
  const { registerProxyCommands } = await import('./commands/cli/proxy-command.js');
  registerProxyCommands(program);
});

// Deploy — generate cloud deployment configurations
addLazyCommandGroup(program, 'deploy', 'Generate cloud deployment configurations (Fly, Railway, Render, Nix)', async () => {
  const { registerDeployCommands } = await import('./commands/cli/deploy-command.js');
  registerDeployCommands(program);
});

// Backup — local backup management (Native Engine v2026.3.8 alignment)
program
  .command('backup [subcommand] [args...]')
  .description('Manage .codebuddy/ backups (create, verify, list, restore)')
  .option('--only-config', 'Only backup configuration files')
  .option('--no-include-workspace', 'Exclude workspace data')
  .option('--output <path>', 'Custom output directory')
  .action(async (subcommand: string | undefined, args: string[], opts: Record<string, unknown>) => {
    const { handleBackup } = await import('./commands/handlers/backup-handlers.js');
    const flags: string[] = [];
    if (opts.onlyConfig) flags.push('--only-config');
    if (opts.includeWorkspace === false) flags.push('--no-include-workspace');
    if (opts.output) flags.push('--output', opts.output as string);
    const fullArgs = [subcommand || 'list', ...(args || []), ...flags].join(' ');
    const result = await handleBackup(fullArgs);
    // Backup command output is pipeable (scripts often capture it).
    if (result.response) cli.stdout(result.response);
  });

// Cloud — background agent tasks (Cursor/Codex parity)
program
  .command('cloud [subcommand] [args...]')
  .description('Manage cloud background agent tasks (submit, status, list, cancel, logs)')
  .action(async (subcommand: string | undefined, args: string[]) => {
    const { handleCloud } = await import('./commands/handlers/cloud-handlers.js');
    const fullArgs = [subcommand || 'list', ...(args || [])];
    const result = await handleCloud(fullArgs);
    // Cloud command output is pipeable (scripts often capture task IDs).
    if (result.entry?.content) cli.stdout(result.entry.content);
  });

// Hidden child entry for per-task subprocess isolation (CODEBUDDY_CLOUD_SUBPROCESS).
// Runs a single previously-submitted cloud task to completion in its own process.
program
  .command('cloud-run-task <taskId>', { hidden: true })
  .option('--tasks-dir <dir>', 'task store directory')
  .action(async (taskId: string, options: { tasksDir?: string }) => {
    try {
      const { CloudAgentRunner } = await import('./cloud/cloud-agent-runner.js');
      const runner = new CloudAgentRunner(options.tasksDir);
      const config = runner.loadTaskConfig(taskId);
      if (!config) {
        cli.error(`No persisted config for cloud task '${taskId}'`);
        process.exit(1);
      }
      await runner.runTaskInProcess(taskId, config);
      process.exit(0);
    } catch (err) {
      cli.error(`cloud-run-task failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Completions — generate or install shell completion scripts
addLazyCommand(
  program,
  'completions',
  'Generate or install shell completion scripts (bash, zsh, fish, powershell)',
  async () => {
    const { createCompletionsCommand } = await import('./commands/cli/completions-command.js');
    return createCompletionsCommand();
  },
);

program.parse();
