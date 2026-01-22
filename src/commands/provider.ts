/**
 * Provider Command
 *
 * CLI commands for managing AI providers (Claude, ChatGPT, Grok, Gemini)
 */

import { Command } from 'commander';
import { logger } from "../utils/logger.js";
import { getSettingsManager } from '../utils/settings-manager.js';

interface ProviderInfo {
  name: string;
  envVar: string;
  models: string[];
  defaultModel: string;
}

const PROVIDERS: Record<string, ProviderInfo> = {
  grok: {
    name: 'Grok (xAI)',
    envVar: 'GROK_API_KEY',
    models: ['grok-beta', 'grok-vision-beta', 'grok-code-fast-1'],
    defaultModel: 'grok-code-fast-1',
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
  },
  gemini: {
    name: 'Gemini (Google)',
    envVar: 'GOOGLE_API_KEY',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash',
  },
};

function getConfiguredProviders(): string[] {
  const configured: string[] = [];

  for (const [key, info] of Object.entries(PROVIDERS)) {
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
  const manager = getSettingsManager();
  const settings = manager.loadUserSettings();
  return settings.provider || 'grok';
}

function setCurrentProvider(provider: string): void {
  const manager = getSettingsManager();
  manager.updateUserSetting('provider', provider);
}

function getCurrentModel(): string | undefined {
  const manager = getSettingsManager();
  return manager.getCurrentModel();
}

function setCurrentModel(model: string): void {
  const manager = getSettingsManager();
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
        console.log(`     Env: ${info.envVar}`);
        console.log(`     Models: ${info.models.slice(0, 3).join(', ')}${info.models.length > 3 ? '...' : ''}`);
        console.log('');
      }

      if (configured.length === 0) {
        console.log('⚠️  No providers configured. Set an API key environment variable.');
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
        console.log(`\n⚠️  Warning: ${info?.envVar || 'API key'} not set`);
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
        console.warn(`⚠️  Warning: ${PROVIDERS[key].envVar} not set`);
        console.warn(`   Provider will fail without API key`);
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

  // Test connection
  provider
    .command('test [provider]')
    .description('Test connection to a provider')
    .action(async (providerKey?: string) => {
      const key = (providerKey || getCurrentProvider()).toLowerCase();

      if (!PROVIDERS[key]) {
        logger.error(`❌ Unknown provider: ${providerKey}`);
        process.exit(1);
      }

      const info = PROVIDERS[key];
      console.log(`\nTesting connection to ${info.name}...`);

      const configured = getConfiguredProviders();
      if (!configured.includes(key)) {
        logger.error(`❌ ${info.envVar} not set`);
        process.exit(1);
      }

      try {
        // Dynamic import of provider manager
        const { getProviderManager } = await import('../providers/provider-manager.js');
        const manager = getProviderManager();

        // Get API key
        let apiKey = process.env[info.envVar] || '';
        if (key === 'grok' && !apiKey) {
          apiKey = process.env.XAI_API_KEY || '';
        }
        if (key === 'gemini' && !apiKey) {
          apiKey = process.env.GEMINI_API_KEY || '';
        }

        // Register and test provider
        await manager.registerProvider(key as 'grok' | 'claude' | 'openai' | 'gemini', {
          apiKey,
        });

        const provider = manager.getProvider(key as 'grok' | 'claude' | 'openai' | 'gemini');
        if (!provider) {
          throw new Error('Failed to initialize provider');
        }

        const response = await provider.complete({
          messages: [{ role: 'user', content: 'Say "Connection successful" in exactly those words.' }],
          maxTokens: 20,
        });

        if (response.content) {
          console.log(`✅ Connection successful!`);
          console.log(`   Model: ${response.model}`);
          console.log(`   Response: "${response.content.trim()}"`);
        } else {
          throw new Error('Empty response');
        }
      } catch (error) {
        logger.error(`❌ Connection failed: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  return provider;
}

export default createProviderCommand;
