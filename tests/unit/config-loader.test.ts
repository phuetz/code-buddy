/**
 * Tests for CLI Configuration Loader
 */

import {
  ensureUserSettingsDirectory,
  loadApiKey,
  loadBaseURL,
  loadModel,
  loadConfig,
  saveCommandLineSettings,
  validateConfig,
  CLIConfig,
} from '../../src/cli/config-loader';

// Mock the settings manager module
jest.mock('../../src/utils/settings-manager', () => {
  const mockManager = {
    loadUserSettings: jest.fn(),
    getApiKey: jest.fn(),
    getBaseURL: jest.fn(),
    getCurrentModel: jest.fn(),
    updateUserSetting: jest.fn(),
  };

  return {
    getSettingsManager: jest.fn(() => mockManager),
    __mockManager: mockManager,
  };
});

// Get mock manager for assertions
const { getSettingsManager, __mockManager: mockManager } = jest.requireMock(
  '../../src/utils/settings-manager'
);

describe('config-loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.GROK_API_KEY;
    delete process.env.GROK_MODEL;
    delete process.env.GROK_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('ensureUserSettingsDirectory', () => {
    it('should call settings manager to load user settings', () => {
      mockManager.loadUserSettings.mockReturnValue({});

      ensureUserSettingsDirectory();

      expect(getSettingsManager).toHaveBeenCalled();
      expect(mockManager.loadUserSettings).toHaveBeenCalled();
    });

    it('should silently ignore errors', () => {
      mockManager.loadUserSettings.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw
      expect(() => ensureUserSettingsDirectory()).not.toThrow();
    });
  });

  describe('loadApiKey', () => {
    it('should return API key from settings manager', () => {
      const expectedKey = 'test-api-key-123';
      mockManager.getApiKey.mockReturnValue(expectedKey);

      const result = loadApiKey();

      expect(result).toBe(expectedKey);
      expect(mockManager.getApiKey).toHaveBeenCalled();
    });

    it('should return undefined when no API key is set', () => {
      mockManager.getApiKey.mockReturnValue(undefined);

      const result = loadApiKey();

      expect(result).toBeUndefined();
    });
  });

  describe('loadBaseURL', () => {
    it('should return base URL from settings manager', () => {
      const expectedURL = 'https://custom.api.com/v1';
      mockManager.getBaseURL.mockReturnValue(expectedURL);

      const result = loadBaseURL();

      expect(result).toBe(expectedURL);
      expect(mockManager.getBaseURL).toHaveBeenCalled();
    });

    it('should return default URL when not configured', () => {
      const defaultURL = 'https://api.x.ai/v1';
      mockManager.getBaseURL.mockReturnValue(defaultURL);

      const result = loadBaseURL();

      expect(result).toBe(defaultURL);
    });
  });

  describe('loadModel', () => {
    it('should return model from environment variable first', () => {
      process.env.GROK_MODEL = 'grok-env-model';
      mockManager.getCurrentModel.mockReturnValue('grok-settings-model');

      const result = loadModel();

      expect(result).toBe('grok-env-model');
      // Settings manager should not be called when env var is set
      expect(mockManager.getCurrentModel).not.toHaveBeenCalled();
    });

    it('should return model from settings manager when env var not set', () => {
      delete process.env.GROK_MODEL;
      const expectedModel = 'grok-settings-model';
      mockManager.getCurrentModel.mockReturnValue(expectedModel);

      const result = loadModel();

      expect(result).toBe(expectedModel);
      expect(mockManager.getCurrentModel).toHaveBeenCalled();
    });

    it('should return undefined when model not available anywhere', () => {
      delete process.env.GROK_MODEL;
      mockManager.getCurrentModel.mockReturnValue(undefined);

      const result = loadModel();

      expect(result).toBeUndefined();
    });

    it('should handle settings manager errors gracefully', () => {
      delete process.env.GROK_MODEL;
      mockManager.getCurrentModel.mockImplementation(() => {
        throw new Error('Settings error');
      });

      const result = loadModel();

      expect(result).toBeUndefined();
    });
  });

  describe('loadConfig', () => {
    beforeEach(() => {
      mockManager.getApiKey.mockReturnValue('default-api-key');
      mockManager.getBaseURL.mockReturnValue('https://api.x.ai/v1');
      mockManager.getCurrentModel.mockReturnValue('grok-code-fast-1');
    });

    it('should load config with default values', () => {
      const config = loadConfig({});

      expect(config.apiKey).toBe('default-api-key');
      expect(config.baseURL).toBe('https://api.x.ai/v1');
      expect(config.model).toBe('grok-code-fast-1');
      expect(config.maxToolRounds).toBe(400);
      expect(config.maxPrice).toBe(10.0);
    });

    it('should use command line options over defaults', () => {
      const config = loadConfig({
        apiKey: 'cli-api-key',
        baseUrl: 'https://custom.api.com',
        model: 'grok-custom',
        maxToolRounds: '100',
        maxPrice: '5.0',
      });

      expect(config.apiKey).toBe('cli-api-key');
      expect(config.baseURL).toBe('https://custom.api.com');
      expect(config.model).toBe('grok-custom');
      expect(config.maxToolRounds).toBe(100);
      expect(config.maxPrice).toBe(5.0);
    });

    it('should parse maxToolRounds as integer', () => {
      const config = loadConfig({ maxToolRounds: '50' });

      expect(config.maxToolRounds).toBe(50);
      expect(typeof config.maxToolRounds).toBe('number');
    });

    it('should parse maxPrice as float', () => {
      const config = loadConfig({ maxPrice: '7.5' });

      expect(config.maxPrice).toBe(7.5);
      expect(typeof config.maxPrice).toBe('number');
    });

    it('should use default values for invalid number strings', () => {
      const config = loadConfig({
        maxToolRounds: 'invalid',
        maxPrice: 'not-a-number',
      });

      expect(config.maxToolRounds).toBe(400);
      expect(config.maxPrice).toBe(10.0);
    });

    it('should handle empty string values', () => {
      const config = loadConfig({
        maxToolRounds: '',
        maxPrice: '',
      });

      expect(config.maxToolRounds).toBe(400);
      expect(config.maxPrice).toBe(10.0);
    });

    it('should return correct CLIConfig structure', () => {
      const config = loadConfig({});

      expect(config).toHaveProperty('apiKey');
      expect(config).toHaveProperty('baseURL');
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('maxToolRounds');
      expect(config).toHaveProperty('maxPrice');
    });
  });

  describe('saveCommandLineSettings', () => {
    // Spy on console methods
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should save API key to user settings', async () => {
      await saveCommandLineSettings('new-api-key');

      expect(mockManager.updateUserSetting).toHaveBeenCalledWith('apiKey', 'new-api-key');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('API key saved')
      );
    });

    it('should save base URL to user settings', async () => {
      await saveCommandLineSettings(undefined, 'https://custom.api.com');

      expect(mockManager.updateUserSetting).toHaveBeenCalledWith(
        'baseURL',
        'https://custom.api.com'
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Base URL saved')
      );
    });

    it('should save both API key and base URL', async () => {
      await saveCommandLineSettings('api-key', 'https://custom.api.com');

      expect(mockManager.updateUserSetting).toHaveBeenCalledWith('apiKey', 'api-key');
      expect(mockManager.updateUserSetting).toHaveBeenCalledWith(
        'baseURL',
        'https://custom.api.com'
      );
      expect(mockManager.updateUserSetting).toHaveBeenCalledTimes(2);
    });

    it('should not save when values are undefined', async () => {
      await saveCommandLineSettings(undefined, undefined);

      expect(mockManager.updateUserSetting).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should handle save errors gracefully', async () => {
      mockManager.updateUserSetting.mockImplementation(() => {
        throw new Error('Write permission denied');
      });

      // Should not throw
      await expect(
        saveCommandLineSettings('api-key')
      ).resolves.not.toThrow();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not save settings'),
        expect.stringContaining('Write permission denied')
      );
    });

    it('should handle non-Error exceptions', async () => {
      mockManager.updateUserSetting.mockImplementation(() => {
        throw 'String error';
      });

      await saveCommandLineSettings('api-key');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not save settings'),
        'Unknown error'
      );
    });
  });

  describe('validateConfig', () => {
    it('should return valid when API key is present', () => {
      const config: CLIConfig = {
        apiKey: 'valid-api-key',
        baseURL: 'https://api.x.ai/v1',
        model: 'grok-code-fast-1',
        maxToolRounds: 400,
        maxPrice: 10.0,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid when API key is missing', () => {
      const config: CLIConfig = {
        apiKey: undefined,
        baseURL: 'https://api.x.ai/v1',
        model: 'grok-code-fast-1',
        maxToolRounds: 400,
        maxPrice: 10.0,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('API key required');
    });

    it('should return invalid when API key is empty string', () => {
      const config: CLIConfig = {
        apiKey: '',
        baseURL: 'https://api.x.ai/v1',
        model: 'grok-code-fast-1',
        maxToolRounds: 400,
        maxPrice: 10.0,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should include helpful error message with configuration options', () => {
      const config: CLIConfig = {
        apiKey: undefined,
        baseURL: 'https://api.x.ai/v1',
        maxToolRounds: 400,
        maxPrice: 10.0,
      };

      const result = validateConfig(config);

      expect(result.errors[0]).toContain('GROK_API_KEY');
      expect(result.errors[0]).toContain('--api-key');
      expect(result.errors[0]).toContain('~/.codebuddy/user-settings.json');
    });

    it('should return correct validation result structure', () => {
      const config: CLIConfig = {
        apiKey: 'key',
        baseURL: 'url',
        maxToolRounds: 400,
        maxPrice: 10.0,
      };

      const result = validateConfig(config);

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });
});
