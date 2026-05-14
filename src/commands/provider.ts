/**
 * Provider Command
 *
 * CLI commands for managing AI providers (Claude, ChatGPT, Grok, Gemini)
 */

import { Command } from 'commander';
import { logger } from "../utils/logger.js";
import { getSettingsManager } from '../utils/settings-manager.js';
import { detectProviderFromEnv, selectModelForDetectedProvider } from '../utils/provider-detector.js';

interface ProviderInfo {
  name: string;
  envVar: string;
  authLabel?: string;
  models: string[];
  defaultModel: string;
  baseURL?: string;
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  chatgpt: {
    name: 'ChatGPT Pro (subscription)',
    envVar: 'CHATGPT_OAUTH',
    authLabel: 'buddy login chatgpt',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
    defaultModel: 'gpt-5.5',
  },
  grok: {
    name: 'Grok (xAI)',
    envVar: 'GROK_API_KEY',
    models: ['grok-4-1-fast', 'grok-4-latest', 'grok-4-fast', 'grok-code-fast-1', 'grok-3-latest', 'grok-3-fast', 'grok-3-mini'],
    defaultModel: 'grok-3-fast',
    baseURL: 'https://api.x.ai/v1',
  },
  claude: {
    name: 'Claude (Anthropic)',
    envVar: 'ANTHROPIC_API_KEY',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
    ],
    defaultModel: 'claude-sonnet-4-20250514',
  },
  openai: {
    name: 'ChatGPT (OpenAI)',
    envVar: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
    defaultModel: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
  },
  gemini: {
    name: 'Gemini (Google)',
    envVar: 'GOOGLE_API_KEY',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.5-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  },
};

function getConfiguredProviders(): string[] {
  const configured: string[] = [];
  const detected = detectProviderFromEnv();

  for (const [key, info] of Object.entries(PROVIDERS)) {
    if (detected?.provider === key) {
      configured.push(key);
      continue;
    }

    const hasKey = process.env[info.envVar] ||
                   (key === 'grok' && process.env.XAI_API_KEY) ||
                   (key === 'gemini' && process.env.GEMINI_API_KEY);
    if (hasKey) {
      configured.push(key);
    }
  }

  return configured;
}

function getCurrentProvider(): string {
  const detected = detectProviderFromEnv();
  if (detected?.provider && PROVIDERS[detected.provider]) {
    return detected.provider;
  }

  const manager = getSettingsManager();
  const settings = manager.loadUserSettings();
  return settings.provider || 'grok';
}

function setCurrentProvider(provider: string): void {
  const manager = getSettingsManager();
  manager.updateUserSetting('provider', provider);

  const providerInfo = PROVIDERS[provider];
  if (providerInfo?.baseURL) {
    manager.updateUserSetting('baseURL', providerInfo.baseURL);
  }
}

function getCurrentModel(): string | undefined {
  const manager = getSettingsManager();
  return selectModelForDetectedProvider(detectProviderFromEnv(), manager.getCurrentModel());
}

function setCurrentModel(model: string): void {
  const manager = getSettingsManager() as {
    setCurrentModel?: (m: string) => void;
    updateUserSetting: <K extends 'model' | 'defaultModel'>(key: K, value: string) => void;
  };

  // Keep project runtime model aligned with provider/model CLI commands.
  if (typeof manager.setCurrentModel === 'function') {
    manager.setCurrentModel(model);
  }

  // Keep user-level model fields in sync for commands that rely on user settings.
  manager.updateUserSetting('model', model);
}

export function createProviderCommand(): Command {
  const provider = new Command('provider')
    .description('Manage AI providers (Claude, ChatGPT, Grok, Gemini)');

  // List providers
  provider
    .command('list')
    .alias('ls')
    .description('List available AI providers')
    .action(() => {
      const configured = getConfiguredProviders();
      const current = getCurrentProvider();

      console.log('\nAvailable AI Providers:\n');

      for (const [key, info] of Object.entries(PROVIDERS)) {
        const isConfigured = configured.includes(key);
        const isCurrent = key === current;
        const status = isConfigured ? '✅' : '❌';
        const marker = isCurrent ? ' (active)' : '';

        console.log(`  ${status} ${info.name}${marker}`);
        console.log(`     Key: ${key}`);
        console.log(`     Auth: ${info.authLabel || info.envVar}`);
        console.log(`     Models: ${info.models.slice(0, 3).join(', ')}${info.models.length > 3 ? '...' : ''}`);
        console.log('');
      }

      if (configured.length === 0) {
        console.log('⚠️  No providers configured. Run `buddy login chatgpt` or set a provider API key.');
        console.log('   Example: export ANTHROPIC_API_KEY="your-key"');
      }
    });

  // Show current provider
  provider
    .command('current')
    .alias('show')
    .description('Show current active provider')
    .action(() => {
      const current = getCurrentProvider();
      const model = getCurrentModel();
      const info = PROVIDERS[current];

      console.log(`\nActive Provider: ${info?.name || current}`);
      console.log(`Model: ${model || info?.defaultModel || 'default'}`);

      const configured = getConfiguredProviders();
      if (!configured.includes(current)) {
        console.log(`\n⚠️  Warning: ${info?.authLabel || info?.envVar || 'provider credentials'} not configured`);
      }
    });

  // Set provider
  provider
    .command('set <provider>')
    .alias('use')
    .description('Set the active AI provider')
    .option('-m, --model <model>', 'Also set the model')
    .action((providerKey: string, options: { model?: string }) => {
      const key = providerKey.toLowerCase();

      if (!PROVIDERS[key]) {
        logger.error(`❌ Unknown provider: ${providerKey}`);
        logger.error(`   Available: ${Object.keys(PROVIDERS).join(', ')}`);
        process.exit(1);
      }

      const configured = getConfiguredProviders();
      if (!configured.includes(key)) {
        console.warn(`⚠️  Warning: ${PROVIDERS[key].authLabel || PROVIDERS[key].envVar} not configured`);
        console.warn('   Provider will fail without credentials');
      }

      setCurrentProvider(key);
      console.log(`✅ Active provider set to: ${PROVIDERS[key].name}`);

      if (options.model) {
        setCurrentModel(options.model);
        console.log(`✅ Model set to: ${options.model}`);
      } else {
        // Set default model for provider
        setCurrentModel(PROVIDERS[key].defaultModel);
        console.log(`   Using default model: ${PROVIDERS[key].defaultModel}`);
      }
    });

  // List models for a provider
  provider
    .command('models [provider]')
    .description('List available models for a provider')
    .action((providerKey?: string) => {
      const key = (providerKey || getCurrentProvider()).toLowerCase();

      if (!PROVIDERS[key]) {
        logger.error(`❌ Unknown provider: ${providerKey}`);
        process.exit(1);
      }

      const info = PROVIDERS[key];
      const currentModel = getCurrentModel();

      console.log(`\nModels for ${info.name}:\n`);

      for (const model of info.models) {
        const isDefault = model === info.defaultModel;
        const isCurrent = model === currentModel;
        const markers: string[] = [];
        if (isDefault) markers.push('default');
        if (isCurrent) markers.push('active');

        const suffix = markers.length > 0 ? ` (${markers.join(', ')})` : '';
        console.log(`  • ${model}${suffix}`);
      }
    });

  // Set model
  provider
    .command('model <model>')
    .description('Set the AI model to use')
    .action((model: string) => {
      setCurrentModel(model);
      console.log(`✅ Model set to: ${model}`);
    });

  return provider;
}

export default createProviderCommand;
