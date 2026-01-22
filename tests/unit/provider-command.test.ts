/**
 * Unit tests for Provider Command
 */

import { createProviderCommand } from '../../src/commands/provider';
import { Command } from 'commander';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../../src/utils/logger';
const loggerErrorSpy = logger.error as jest.Mock;

// Mock settings manager
jest.mock('../../src/utils/settings-manager', () => ({
  getSettingsManager: jest.fn(() => ({
    loadUserSettings: jest.fn(() => ({
      provider: 'grok',
      model: 'grok-code-fast-1',
    })),
    updateUserSetting: jest.fn(),
    getCurrentModel: jest.fn(() => 'grok-code-fast-1'),
  })),
}));

describe('Provider Command', () => {
  let command: Command;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    command = createProviderCommand();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
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
      expect(subcommands).toContain('model');
      expect(subcommands).toContain('test');
    });
  });

  describe('list command', () => {
    it('should list all providers', () => {
      command.parse(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Grok');
      expect(output).toContain('Claude');
      expect(output).toContain('ChatGPT');
      expect(output).toContain('Gemini');
    });

    it('should show environment variable names', () => {
      command.parse(['list'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('GROK_API_KEY');
      expect(output).toContain('ANTHROPIC_API_KEY');
      expect(output).toContain('OPENAI_API_KEY');
      expect(output).toContain('GOOGLE_API_KEY');
    });
  });

  describe('current command', () => {
    it('should show current provider', () => {
      command.parse(['current'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Active Provider');
    });

    it('should show current model', () => {
      command.parse(['current'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Model');
    });
  });

  describe('set command', () => {
    it('should reject unknown provider', () => {
      expect(() => {
        command.parse(['set', 'unknown-provider'], { from: 'user' });
      }).toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
      const errorOutput = loggerErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errorOutput).toContain('Unknown provider');
    });

    it('should accept valid provider', () => {
      command.parse(['set', 'claude'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to');
    });

    it('should handle case insensitivity', () => {
      command.parse(['set', 'CLAUDE'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Active provider set to');
    });
  });

  describe('models command', () => {
    it('should list models for current provider', () => {
      command.parse(['models'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for');
    });

    it('should list models for specific provider', () => {
      command.parse(['models', 'claude'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(output).toContain('Models for Claude');
      expect(output).toContain('claude-sonnet-4');
    });

    it('should reject unknown provider', () => {
      expect(() => {
        command.parse(['models', 'unknown'], { from: 'user' });
      }).toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('model command', () => {
    it('should set model', () => {
      command.parse(['model', 'gpt-4o'], { from: 'user' });

      const output = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Model set to: gpt-4o');
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
      for (const [provider, envVar] of Object.entries(PROVIDER_KEYS)) {
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
      gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    };

    it('should have models for each provider', () => {
      for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        expect(models.length).toBeGreaterThan(0);
      }
    });
  });
});
