/**
 * Configuration Validator
 * Validates extension settings and API keys
 */

import * as vscode from 'vscode';
import { logger } from './logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AIProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
}

/**
 * Validate AI provider configuration
 */
export function validateAIConfig(config: AIProviderConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate provider
  const validProviders = ['grok', 'claude', 'openai', 'ollama'];
  if (!validProviders.includes(config.provider)) {
    errors.push(`Invalid provider: ${config.provider}. Valid options: ${validProviders.join(', ')}`);
  }

  // Validate API key (except for Ollama)
  if (config.provider !== 'ollama' && !config.apiKey) {
    errors.push(`API key is required for ${config.provider} provider`);
  }

  // Validate API key format
  if (config.apiKey && config.provider !== 'ollama') {
    if (config.provider === 'grok' && !config.apiKey.startsWith('xai-')) {
      warnings.push('Grok API keys typically start with "xai-"');
    }
    if (config.provider === 'openai' && !config.apiKey.startsWith('sk-')) {
      warnings.push('OpenAI API keys typically start with "sk-"');
    }
  }

  // Validate model
  if (!config.model) {
    warnings.push('No model specified, using default');
  }

  // Validate base URL if provided
  if (config.baseUrl) {
    try {
      new URL(config.baseUrl);
    } catch {
      errors.push(`Invalid base URL: ${config.baseUrl}`);
    }
  }

  // Validate maxTokens
  if (config.maxTokens !== undefined) {
    if (config.maxTokens < 1 || config.maxTokens > 128000) {
      warnings.push(`maxTokens should be between 1 and 128000, got ${config.maxTokens}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get API key from environment or settings
 */
export function getApiKey(provider: string): string {
  const config = vscode.workspace.getConfiguration('codebuddy');
  const settingsKey = config.get<string>('apiKey');

  if (settingsKey) {
    return settingsKey;
  }

  // Try environment variables
  const envVars: Record<string, string> = {
    grok: 'GROK_API_KEY',
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  };

  const envVar = envVars[provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar]!;
  }

  return '';
}

/**
 * Claude models offered by the extension — the only place that names them.
 * Fallback list: `GET https://api.anthropic.com/v1/models` is the source of truth
 * (checked 2026-10-08: these three are served, `claude-sonnet-4-20250514` and
 * every `claude-3-*` id answer 404).
 */
export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

/** Default Claude model; `ANTHROPIC_MODEL` or the `codebuddy.model` setting override it. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';

/**
 * Get default model for provider
 */
export function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    grok: 'grok-3-latest',
    claude: ANTHROPIC_DEFAULT_MODEL,
    openai: 'gpt-4o',
    ollama: 'llama3.2',
  };
  return defaults[provider] || 'grok-3-latest';
}

/**
 * Get default base URL for provider
 */
export function getDefaultBaseUrl(provider: string): string {
  const defaults: Record<string, string> = {
    grok: 'https://api.x.ai/v1',
    claude: 'https://api.anthropic.com/v1',
    openai: 'https://api.openai.com/v1',
    ollama: 'http://localhost:11434/v1',
  };
  return defaults[provider] || 'https://api.x.ai/v1';
}

/**
 * Show configuration wizard if not properly configured
 */
export async function showConfigurationWizard(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('codebuddy');

  // Check if API key is set
  const provider = config.get<string>('provider') || 'grok';
  const apiKey = getApiKey(provider);

  if (!apiKey && provider !== 'ollama') {
    const action = await vscode.window.showWarningMessage(
      `Code Buddy needs an API key for ${provider}. Would you like to configure it now?`,
      'Configure',
      'Use Environment Variable',
      'Switch Provider',
      'Later'
    );

    if (action === 'Configure') {
      const key = await vscode.window.showInputBox({
        prompt: `Enter your ${provider} API key`,
        password: true,
        placeHolder: provider === 'grok' ? 'xai-...' : 'sk-...',
      });

      if (key) {
        await config.update('apiKey', key, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('API key saved successfully!');
        return true;
      }
    } else if (action === 'Use Environment Variable') {
      const envVars: Record<string, string> = {
        grok: 'GROK_API_KEY',
        claude: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
      };
      vscode.window.showInformationMessage(
        `Set the ${envVars[provider]} environment variable and restart VS Code`
      );
    } else if (action === 'Switch Provider') {
      const newProvider = await vscode.window.showQuickPick(
        ['grok', 'claude', 'openai', 'ollama'],
        { placeHolder: 'Select AI provider' }
      );

      if (newProvider) {
        await config.update('provider', newProvider, vscode.ConfigurationTarget.Global);
        return showConfigurationWizard();
      }
    }

    return false;
  }

  return true;
}

/**
 * Validate and log configuration on startup
 */
export function validateStartupConfig(): ValidationResult {
  const config = vscode.workspace.getConfiguration('codebuddy');

  const aiConfig: AIProviderConfig = {
    provider: config.get<string>('provider') || 'grok',
    apiKey: getApiKey(config.get<string>('provider') || 'grok'),
    model: config.get<string>('model') || getDefaultModel(config.get<string>('provider') || 'grok'),
    baseUrl: config.get<string>('baseUrl'),
    maxTokens: config.get<number>('maxTokens'),
  };

  const result = validateAIConfig(aiConfig);

  // Log results
  if (result.errors.length > 0) {
    logger.error(`Configuration errors: ${result.errors.join(', ')}`, undefined, 'ConfigValidator');
  }

  if (result.warnings.length > 0) {
    logger.warn(`Configuration warnings: ${result.warnings.join(', ')}`, 'ConfigValidator');
  }

  if (result.valid) {
    logger.info(`Configuration valid for provider: ${aiConfig.provider}`, 'ConfigValidator');
  }

  return result;
}
