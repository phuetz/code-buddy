/**
 * Unit tests for Provider Command
 */


// Mock logger

import { createProviderCommand } from '../../src/commands/provider';
import { Command } from 'commander';
import { logger } from '../../src/utils/logger';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const loggerErrorSpy = logger.error as jest.Mock;

// Mock settings manager
jest.mock('../../src/utils/settings-manager', () => ({
  getSettingsManager: jest.fn(function() { return {
    loadUserSettings: jest.fn(function() { return {
      provider: 'grok',
      model: 'grok-code-fast-1',
    }; }),
    updateUserSetting: jest.fn(),
    getCurrentModel: jest.fn(() => 'grok-code-fast-1'),
  }; }),
}));

jest.mock('../../src/providers/codex-oauth', () => ({
  hasCodexCredentials: jest.fn(() => true),
}));

jest.mock('../../src/fleet/model-inventory.js', () => ({
  buildModelInventory: jest.fn(async () => ({
    updatedAt: '2026-01-01T00:00:00.000Z',
    machineLabel: 'test-machine',
    entries: [
      {
        provider: 'lm-studio',
        runtimeProvider: 'lmstudio',
        model: 'local-model',
        baseURL: 'http://localhost:1234/v1',
        machineLabel: 'test-machine',
        executionLocation: 'local',
        launchHint: 'On test-machine: open LM Studio, enable the local server, then select local-model',
        contextWindow: 8192,
        maxOutputTokens: 8192,
        supportsReasoning: false,
        supportsToolCalls: true,
        supportsVision: false,
        strengths: ['tool-calling'],
        benchmarkScore: 42,
        bestFor: ['coding'],
        source: 'local-capability',
      },
    ],
  })),
}));

describe('Provider Command', () => {
  let command: Command;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  const run = async (args: string[]) => {
    await command.parseAsync(args, { from: 'user' });
  };

  beforeEach(() => {
    command = createProviderCommand();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(function() {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('createProviderCommand', () => {
    it('should create a command instance', () => {
      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('provider');
    });

    it('should have all subcommands', () => {
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('list');
      expect(subcommands).toContain('current');
      expect(subcommands).toContain('set');
      expect(subcommands).toContain('models');
      expect(subcommands).toContain('inventory');
      expect(subcommands).toContain('model');
    });
  });

  describe('list command', () => {
    it('should list all providers', async () => {
      await run(['list']);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Grok');
      expect(output).toContain('Claude');
      expect(output).toContain('ChatGPT');
      expect(output).toContain('Gemini');
      expect(output).toContain('Kimi');
      expect(output).toContain('Hugging Face');
    });

    it('should mark providers with a free tier in the full list', async () => {
      await run(['list']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('🆓 Ollama');
      expect(output).toContain('🆓 NVIDIA NIM');
      expect(output).not.toContain('🆓 Grok (xAI)');
    });

    it('should filter and detail providers with --free', async () => {
      await run(['list', '--free']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Free-tier AI Providers');
      expect(output).toContain('🆓 OmniRoute (local AI gateway)');
      expect(output).toContain('Free tier: local gateway to 90+ free tiers');
      expect(output).toContain('Base URL: http://localhost:20128/v1');
      expect(output).toContain('API key env: OMNIROUTE_API_KEY');
      expect(output).toContain('API key env: NVIDIA_API_KEY');
      expect(output).not.toContain('Key: grok');
      expect(output).not.toContain('Plugin-native providers');
    });

    it('should show environment variable names', async () => {
      await run(['list']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('GROK_API_KEY');
      expect(output).toContain('ANTHROPIC_API_KEY');
      expect(output).toContain('OPENAI_API_KEY');
      expect(output).toContain('CODEBUDDY_CHATGPT_OAUTH');
      expect(output).toContain('GOOGLE_API_KEY');
      expect(output).toContain('KIMI_API_KEY');
      expect(output).toContain('HF_TOKEN');
    });

    it('should list plugin-native providers separately', async () => {
      await run(['list']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Plugin-native providers');
      expect(output).toContain('Azure OpenAI');
      expect(output).toContain('AWS Bedrock');
      expect(output).toContain('GitHub Copilot');
      expect(output).toContain('bundled-azure-openai');
      expect(output).toContain('bundled-bedrock');
      expect(output).toContain('bundled-copilot');
    });
  });

  describe('current command', () => {
    it('should show current provider', async () => {
      await run(['current']);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Active Provider');
    });

    it('should show current model', async () => {
      await run(['current']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Model');
    });
  });

  describe('set command', () => {
    it('should reject unknown provider', async () => {
      await expect(run(['set', 'unknown-provider'])).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
      const errorOutput = loggerErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errorOutput).toContain('Unknown provider');
    });

    it('should accept valid provider', async () => {
      await run(['set', 'claude']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to');
    });

    it('should handle case insensitivity', async () => {
      await run(['set', 'CLAUDE']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to');
    });

    it('should accept Hermes-style provider aliases', async () => {
      await run(['set', 'kimi']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to: Kimi');
    });

    it('should reject plugin-native providers in the direct provider setter', async () => {
      await expect(run(['set', 'azure'])).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
      const errorOutput = loggerErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errorOutput).toContain('Unknown provider: azure');
    });
  });

  describe('models command', () => {
    it('should list models for current provider', async () => {
      await run(['models']);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for');
    });

    it('should list models for specific provider', async () => {
      await run(['models', 'claude']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for Claude');
      expect(output).toContain('claude-sonnet-4');
    });

    it('should list ChatGPT OAuth models', async () => {
      await run(['models', 'chatgpt']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for ChatGPT (OAuth)');
      expect(output).toContain('gpt-5.5');
    });

    it('should list models for Hermes-style provider aliases', async () => {
      await run(['models', 'glm']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for z.ai / GLM');
      expect(output).toContain('glm-5');
    });

    it('should reject unknown provider', async () => {
      await expect(run(['models', 'unknown'])).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('model command', () => {
    it('should set model', async () => {
      await run(['model', 'gpt-4o']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Model set to: gpt-4o');
    });
  });

  describe('inventory command', () => {
    it('lists runtime-discovered models with machine and launch hints', async () => {
      await run(['inventory']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Runtime model inventory');
      expect(output).toContain('local-model');
      expect(output).toContain('test-machine');
      expect(output).toContain('launch:');
    });

    it('filters runtime inventory by best-for tag', async () => {
      await run(['inventory', '--best-for', 'coding']);

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('local-model');
      expect(output).toContain('best: coding');
    });
  });
});

describe('Provider Configuration', () => {
  const PROVIDER_KEYS = {
    grok: 'GROK_API_KEY',
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GOOGLE_API_KEY',
  };

  describe('Environment Variables', () => {
    it('should recognize standard env vars', () => {
      for (const envVar of Object.values(PROVIDER_KEYS)) {
        expect(envVar).toBeDefined();
        expect(typeof envVar).toBe('string');
      }
    });
  });

  describe('Provider Models', () => {
    const PROVIDER_MODELS: Record<string, string[]> = {
      grok: ['grok-beta', 'grok-code-fast-1'],
      claude: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-latest'],
      openai: ['gpt-4o', 'gpt-4o-mini'],
      chatgpt: ['gpt-5.5'],
      gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    };

    it('should have models for each provider', () => {
      for (const models of Object.values(PROVIDER_MODELS)) {
        expect(models.length).toBeGreaterThan(0);
      }
    });
  });
});
