/**
 * Application Factory
 *
 * Factory for creating and configuring the application.
 * Centralizes initialization logic extracted from index.ts.
 */

import * as dotenv from 'dotenv';
import { getSettingsManager } from '../utils/settings-manager.js';
import { getCredentialManager } from '../security/credential-manager.js';
import { getCrashHandler } from '../errors/crash-handler.js';
import { disposeAll } from '../utils/disposable.js';
import { logger } from '../utils/logger.js';
import type { ApplicationConfig, CommandLineOptions } from './types.js';

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load environment variables
 */
export function loadEnvironment(): void {
  dotenv.config();
}

/**
 * Load API key from various sources
 * Priority: environment > secure credential storage > legacy settings
 */
export function loadApiKey(): string | undefined {
  // Check environment first
  const envKey = process.env.GROK_API_KEY;
  if (envKey) return envKey;

  // Then secure credential manager
  const credManager = getCredentialManager();
  const credKey = credManager.getApiKey();
  if (credKey) return credKey;

  // Finally legacy settings
  const settingsManager = getSettingsManager();
  return settingsManager.getApiKey();
}

/**
 * Load base URL from settings or environment
 */
export function loadBaseURL(): string {
  const envURL = process.env.GROK_BASE_URL;
  if (envURL) return envURL;

  const manager = getSettingsManager();
  return manager.getBaseURL();
}

/**
 * Load model from settings or environment
 */
export function loadModel(): string | undefined {
  const envModel = process.env.GROK_MODEL;
  if (envModel) return envModel;

  try {
    const manager = getSettingsManager();
    return manager.getCurrentModel();
  } catch {
    return undefined;
  }
}

/**
 * Ensure user settings directory exists
 */
export function ensureUserSettings(): void {
  try {
    const manager = getSettingsManager();
    manager.loadUserSettings();
  } catch {
    // Silently ignore - directory may not exist yet
  }
}

// ============================================================================
// Process Signal Handlers
// ============================================================================

/**
 * Setup process signal handlers for graceful shutdown
 */
export function setupSignalHandlers(): void {
  const crashHandler = getCrashHandler();
  crashHandler.initialize();

  process.on('SIGTERM', async () => {
    crashHandler.restoreTerminal();
    console.log('\nGracefully shutting down...');
    await disposeAll();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    crashHandler.restoreTerminal();
    await disposeAll();
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    const crashFile = crashHandler.handleCrash(error, 'Uncaught exception');
    logger.error('\nUnexpected error occurred:', error);
    if (crashFile) {
      logger.error(`\nCrash context saved to: ${crashFile}`);
      logger.error('You can resume your session with: grok --resume');
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const crashFile = crashHandler.handleCrash(error, 'Unhandled rejection');
    logger.error('\nUnhandled promise rejection:', error);
    if (crashFile) {
      logger.error(`\nCrash context saved to: ${crashFile}`);
      logger.error('You can resume your session with: grok --resume');
    }
    process.exit(1);
  });
}

// ============================================================================
// Application Configuration
// ============================================================================

/**
 * Build application configuration from command line options
 */
export function buildConfig(options: CommandLineOptions): ApplicationConfig {
  const config: ApplicationConfig = {
    apiKey: options.apiKey ?? loadApiKey(),
    baseURL: options.baseURL ?? loadBaseURL(),
    model: options.model ?? loadModel(),
    maxToolRounds: options.maxToolRounds,
    securityMode: options.securityMode,
    dryRun: options.dryRun,
    cache: options.cache,
    selfHeal: options.selfHeal,
    verbose: options.verbose,
    context: options.context,
    systemPrompt: options.systemPrompt,
    agent: options.agent,
    probeTools: options.probeTools,
  };

  return config;
}

/**
 * Validate application configuration
 */
export function validateConfig(config: ApplicationConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push('API key is required. Set GROK_API_KEY environment variable or use --api-key option.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Application Factory
// ============================================================================

/**
 * Application bootstrap options
 */
export interface BootstrapOptions {
  /** Skip environment loading (for testing) */
  skipEnv?: boolean;
  /** Skip signal handlers (for testing) */
  skipSignals?: boolean;
  /** Custom configuration */
  config?: Partial<ApplicationConfig>;
}

/**
 * Bootstrap the application
 * Sets up environment, signal handlers, and returns configuration
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<ApplicationConfig> {
  // Load environment
  if (!options.skipEnv) {
    loadEnvironment();
  }

  // Setup signal handlers
  if (!options.skipSignals) {
    setupSignalHandlers();
  }

  // Ensure settings directory
  ensureUserSettings();

  // Build configuration
  const config: ApplicationConfig = {
    apiKey: loadApiKey(),
    baseURL: loadBaseURL(),
    model: loadModel(),
    ...options.config,
  };

  return config;
}

/**
 * Save command line settings to persistent storage
 */
export async function saveSettings(apiKey?: string, baseURL?: string): Promise<void> {
  try {
    if (apiKey) {
      const credManager = getCredentialManager();
      credManager.setApiKey(apiKey);
      const status = credManager.getSecurityStatus();
      if (status.encryptionEnabled) {
        console.log('✅ API key saved securely (encrypted) to ~/.codebuddy/credentials.enc');
      } else {
        console.log('✅ API key saved to ~/.codebuddy/credentials.enc');
        console.log('⚠️ Consider enabling encryption for better security');
      }
    }

    if (baseURL) {
      const settingsManager = getSettingsManager();
      settingsManager.updateUserSetting('baseURL', baseURL);
      console.log('✅ Base URL saved to ~/.codebuddy/user-settings.json');
    }
  } catch (error) {
    logger.warn('Could not save settings', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  type ApplicationConfig,
  type CommandLineOptions,
} from './types.js';
