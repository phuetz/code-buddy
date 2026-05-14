/**
 * Application Factory Tests
 */

import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testPaths = vi.hoisted(() => ({ tmpHome: '' }));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => testPaths.tmpHome || actual.homedir() };
});

import {
  loadApiKey,
  loadBaseURL,
  loadModel,
  buildConfig,
  validateConfig,
  bootstrap,
  type ApplicationConfig,
  type CommandLineOptions,
} from '../../src/app/index.js';

const settingsMocks = vi.hoisted(() => {
  const manager = {
    loadUserSettings: vi.fn().mockReturnValue({}),
    getApiKey: vi.fn().mockReturnValue('settings-api-key'),
    getBaseURL: vi.fn().mockReturnValue('https://settings.api.com'),
    getCurrentModel: vi.fn().mockReturnValue('settings-model'),
    updateUserSetting: vi.fn(),
  };

  return {
    manager,
    getSettingsManager: vi.fn(() => manager),
  };
});

// Mock dependencies
jest.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: settingsMocks.getSettingsManager,
}));

jest.mock('../../src/security/credential-manager.js', () => ({
  getCredentialManager: jest.fn(function() { return {
    getApiKey: jest.fn().mockReturnValue(null),
    setApiKey: jest.fn(),
    getSecurityStatus: jest.fn().mockReturnValue({ encryptionEnabled: false }),
  }; }),
}));

jest.mock('../../src/errors/crash-handler.js', () => ({
  getCrashHandler: jest.fn(function() { return {
    initialize: jest.fn(),
    restoreTerminal: jest.fn(),
    handleCrash: jest.fn(),
  }; }),
}));

jest.mock('../../src/utils/disposable.js', () => ({
  disposeAll: jest.fn(),
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const envKeysToReset = [
  'CODEBUDDY_PROVIDER',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'CHATGPT_MODEL',
];

function writeChatGptAuth(): void {
  const dir = path.join(testPaths.tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-access-token' } }),
  );
}

function configureChatGptProvider(): void {
  process.env.CODEBUDDY_PROVIDER = 'chatgpt';
  writeChatGptAuth();
}

describe('Application Factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    for (const key of envKeysToReset) delete process.env[key];
    process.env.CODEBUDDY_PROVIDER = 'none';
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'application-factory-'));
    settingsMocks.manager.loadUserSettings.mockReturnValue({});
    settingsMocks.manager.getApiKey.mockReturnValue('settings-api-key');
    settingsMocks.manager.getBaseURL.mockReturnValue('https://settings.api.com');
    settingsMocks.manager.getCurrentModel.mockReturnValue('settings-model');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
    testPaths.tmpHome = '';
  });

  describe('loadApiKey', () => {
    it('should prioritize environment variable', () => {
      process.env.GROK_API_KEY = 'env-api-key';
      process.env.CODEBUDDY_PROVIDER = 'grok';

      const key = loadApiKey();

      expect(key).toBe('env-api-key');
    });

    it('should fall back to settings when no env var', () => {
      delete process.env.GROK_API_KEY;

      const key = loadApiKey();

      expect(key).toBe('settings-api-key');
    });

    it('should use detected ChatGPT OAuth credentials', () => {
      configureChatGptProvider();

      expect(loadApiKey()).toBe('oauth-chatgpt');
    });
  });

  describe('loadBaseURL', () => {
    it('should prioritize environment variable', () => {
      process.env.GROK_BASE_URL = 'https://env.api.com';
      process.env.CODEBUDDY_PROVIDER = 'grok';

      const url = loadBaseURL();

      expect(url).toBe('https://env.api.com');
    });

    it('should fall back to settings when no env var', () => {
      delete process.env.GROK_BASE_URL;

      const url = loadBaseURL();

      expect(url).toBe('https://settings.api.com');
    });

    it('should use detected ChatGPT base URL', () => {
      configureChatGptProvider();

      expect(loadBaseURL()).toBe('https://chatgpt.com/backend-api/codex');
    });
  });

  describe('loadModel', () => {
    it('should prioritize environment variable', () => {
      process.env.GROK_MODEL = 'env-model';

      const model = loadModel();

      expect(model).toBe('env-model');
    });

    it('should fall back to settings when no env var', () => {
      delete process.env.GROK_MODEL;

      const model = loadModel();

      expect(model).toBe('settings-model');
    });

    it('should use detected provider default when no env or settings model exists', () => {
      configureChatGptProvider();
      settingsMocks.manager.getCurrentModel.mockReturnValueOnce(undefined);

      expect(loadModel()).toBe('gpt-5.5');
    });

    it('should ignore legacy Grok defaults when ChatGPT is detected', () => {
      process.env.GROK_MODEL = 'grok-code-fast-1';
      settingsMocks.manager.getCurrentModel.mockReturnValueOnce(undefined);
      configureChatGptProvider();

      expect(loadModel()).toBe('gpt-5.5');
    });

    it('should not treat GROK_MODEL as a ChatGPT model override', () => {
      process.env.GROK_MODEL = 'gpt-5.1-codex';
      settingsMocks.manager.getCurrentModel.mockReturnValueOnce(undefined);
      configureChatGptProvider();

      expect(loadModel()).toBe('gpt-5.5');
    });

    it('should preserve settings model overrides when ChatGPT is detected', () => {
      settingsMocks.manager.getCurrentModel.mockReturnValueOnce('gpt-5.1-codex');
      configureChatGptProvider();

      expect(loadModel()).toBe('gpt-5.1-codex');
    });
  });

  describe('buildConfig', () => {
    it('should build config from options', () => {
      const options: CommandLineOptions = {
        apiKey: 'test-key',
        baseURL: 'https://test.api.com',
        model: 'test-model',
        maxToolRounds: 50,
        dryRun: true,
      };

      const config = buildConfig(options);

      expect(config.apiKey).toBe('test-key');
      expect(config.baseURL).toBe('https://test.api.com');
      expect(config.model).toBe('test-model');
      expect(config.maxToolRounds).toBe(50);
      expect(config.dryRun).toBe(true);
    });

    it('should use loaded values for missing options', () => {
      process.env.GROK_API_KEY = 'env-key';
      process.env.GROK_BASE_URL = 'https://env.api.com';

      const options: CommandLineOptions = {};

      const config = buildConfig(options);

      expect(config.apiKey).toBe('env-key');
      expect(config.baseURL).toBe('https://env.api.com');
    });
  });

  describe('validateConfig', () => {
    it('should pass validation with API key', () => {
      const config: ApplicationConfig = {
        apiKey: 'test-key',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation without API key', () => {
      const config: ApplicationConfig = {};

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Provider credentials are required. Run `buddy login chatgpt`, set a provider API key, or use --api-key.'
      );
    });
  });

  describe('bootstrap', () => {
    it('should return configuration', async () => {
      process.env.GROK_API_KEY = 'bootstrap-key';

      const config = await bootstrap({
        skipSignals: true, // Don't setup signal handlers in tests
      });

      expect(config).toBeDefined();
      expect(config.apiKey).toBe('bootstrap-key');
    });

    it('should merge custom config', async () => {
      const config = await bootstrap({
        skipSignals: true,
        config: {
          apiKey: 'custom-key',
          model: 'custom-model',
        },
      });

      expect(config.apiKey).toBe('custom-key');
      expect(config.model).toBe('custom-model');
    });
  });
});
