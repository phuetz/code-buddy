/**
 * Configuration loader for Code Buddy CLI
 *
 * Handles loading and saving configuration from:
 * - Environment variables
 * - User settings file
 * - Command line options
 */

import { getSettingsManager } from '../utils/settings-manager.js';
import { detectProviderFromEnv, selectModelForDetectedProvider } from '../utils/provider-detector.js';

export interface CLIConfig {
  apiKey?: string;
  baseURL: string;
  model?: string;
  maxToolRounds: number;
  maxPrice: number;
}

/**
 * Ensure user settings directory exists
 */
export function ensureUserSettingsDirectory(): void {
  try {
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch (_error) {
    // Silently ignore errors during setup
  }
}

/**
 * Load API key from environment or user settings
 */
export function loadApiKey(): string | undefined {
  const detected = detectProviderFromEnv();
  if (detected) return detected.apiKey;

  const manager = getSettingsManager();
  return manager.getApiKey();
}

/**
 * Load base URL from environment or user settings
 */
export function loadBaseURL(): string {
  const detected = detectProviderFromEnv();
  if (detected) return detected.baseURL;

  const manager = getSettingsManager();
  return manager.getBaseURL();
}

/**
 * Load model from environment or user settings
 */
export function loadModel(): string | undefined {
  // First check environment variables
  const detected = detectProviderFromEnv();
  let model = process.env.GROK_MODEL;

  if (!model) {
    // Use the unified model loading from settings manager
    try {
      const manager = getSettingsManager();
      model = manager.getCurrentModel();
    } catch (_error) {
      // Ignore errors, model will remain undefined
    }
  }

  return selectModelForDetectedProvider(detected, model);
}

/**
 * Load full configuration
 */
export function loadConfig(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxToolRounds?: string;
  maxPrice?: string;
}): CLIConfig {
  return {
    apiKey: options.apiKey || loadApiKey(),
    baseURL: options.baseUrl || loadBaseURL(),
    model: options.model || loadModel(),
    maxToolRounds: parseInt(options.maxToolRounds || '400') || 400,
    maxPrice: parseFloat(options.maxPrice || '10.0') || 10.0,
  };
}

/**
 * Save command line settings to user settings file
 */
export async function saveCommandLineSettings(
  apiKey?: string,
  baseURL?: string
): Promise<void> {
  try {
    const manager = getSettingsManager();

    // Update with command line values
    if (apiKey) {
      manager.updateUserSetting('apiKey', apiKey);
      console.log('API key saved to ~/.codebuddy/user-settings.json');
    }
    if (baseURL) {
      manager.updateUserSetting('baseURL', baseURL);
      console.log('Base URL saved to ~/.codebuddy/user-settings.json');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('Could not save settings to file', errorMessage);
  }
}

/**
 * Validate that required configuration is present
 */
export function validateConfig(config: CLIConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push(
      'Provider credentials required. Run `buddy login chatgpt`, set a provider API key, use --api-key, or save to ~/.codebuddy/user-settings.json'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
