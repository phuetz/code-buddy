/**
 * Application Factory Tests
 */

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

// Mock dependencies
jest.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: jest.fn(() => ({
    loadUserSettings: jest.fn().mockReturnValue({}),
    getApiKey: jest.fn().mockReturnValue('settings-api-key'),
    getBaseURL: jest.fn().mockReturnValue('https://settings.api.com'),
    getCurrentModel: jest.fn().mockReturnValue('settings-model'),
  })),
}));

jest.mock('../../src/security/credential-manager.js', () => ({
  getCredentialManager: jest.fn(() => ({
    getApiKey: jest.fn().mockReturnValue(null),
    setApiKey: jest.fn(),
    getSecurityStatus: jest.fn().mockReturnValue({ encryptionEnabled: false }),
  })),
}));

jest.mock('../../src/errors/crash-handler.js', () => ({
  getCrashHandler: jest.fn(() => ({
    initialize: jest.fn(),
    restoreTerminal: jest.fn(),
    handleCrash: jest.fn(),
  })),
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

describe('Application Factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadApiKey', () => {
    it('should prioritize environment variable', () => {
      process.env.GROK_API_KEY = 'env-api-key';

      const key = loadApiKey();

      expect(key).toBe('env-api-key');
    });

    it('should fall back to settings when no env var', () => {
      delete process.env.GROK_API_KEY;

      const key = loadApiKey();

      expect(key).toBe('settings-api-key');
    });
  });

  describe('loadBaseURL', () => {
    it('should prioritize environment variable', () => {
      process.env.GROK_BASE_URL = 'https://env.api.com';

      const url = loadBaseURL();

      expect(url).toBe('https://env.api.com');
    });

    it('should fall back to settings when no env var', () => {
      delete process.env.GROK_BASE_URL;

      const url = loadBaseURL();

      expect(url).toBe('https://settings.api.com');
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
        'API key is required. Set GROK_API_KEY environment variable or use --api-key option.'
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
