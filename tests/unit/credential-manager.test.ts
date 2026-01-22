/**
 * Unit Tests for Credential Manager
 *
 * Tests covering:
 * - Credential storage and retrieval
 * - Encryption/decryption
 * - Environment variable priority
 * - Singleton pattern
 * - Security status
 */

// Mock fs module before imports
const mockFs = {
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  chmodSync: jest.fn(),
  statSync: jest.fn(),
};
jest.mock('fs', () => mockFs);

// Mock os module
jest.mock('os', () => ({
  hostname: jest.fn(() => 'test-hostname'),
  userInfo: jest.fn(() => ({ username: 'testuser' })),
  platform: jest.fn(() => 'linux'),
  homedir: jest.fn(() => '/home/testuser'),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  CredentialManager,
  getCredentialManager,
  getApiKey,
  setApiKey,
} from '../../src/security/credential-manager';

describe('CredentialManager', () => {
  const testCredentialsPath = '/home/testuser/.codebuddy/credentials.enc';
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    CredentialManager.resetInstance();
    originalEnv = { ...process.env };

    // Clear relevant env vars
    delete process.env.GROK_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    // Default mock setup
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.chmodSync.mockReturnValue(undefined);
    mockFs.statSync.mockReturnValue({ mode: 0o600 } as unknown);
  });

  afterEach(() => {
    process.env = originalEnv;
    CredentialManager.resetInstance();
  });

  // ============================================================
  // Singleton Pattern
  // ============================================================
  describe('Singleton Pattern', () => {
    it('should return same instance from getInstance', () => {
      const instance1 = CredentialManager.getInstance();
      const instance2 = CredentialManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = CredentialManager.getInstance();
      CredentialManager.resetInstance();
      const instance2 = CredentialManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });

    it('should accept config on first getInstance call', () => {
      const instance = CredentialManager.getInstance({
        encryptionEnabled: false,
        warnPlainText: false,
      });

      expect(instance.isEncryptionEnabled()).toBe(false);
    });
  });

  // ============================================================
  // Environment Variable Priority
  // ============================================================
  describe('Environment Variable Priority', () => {
    it('should prioritize GROK_API_KEY over stored credentials', () => {
      process.env.GROK_API_KEY = 'env-grok-key';
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance();
      const apiKey = manager.getCredential('apiKey');

      expect(apiKey).toBe('env-grok-key');
    });

    it('should prioritize XAI_API_KEY when GROK_API_KEY is not set', () => {
      process.env.XAI_API_KEY = 'env-xai-key';

      const manager = CredentialManager.getInstance();
      const apiKey = manager.getCredential('apiKey');

      expect(apiKey).toBe('env-xai-key');
    });

    it('should prioritize ANTHROPIC_API_KEY for claudeApiKey', () => {
      process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';

      const manager = CredentialManager.getInstance();
      const key = manager.getCredential('claudeApiKey');

      expect(key).toBe('env-anthropic-key');
    });

    it('should fall back to CLAUDE_API_KEY for claudeApiKey', () => {
      process.env.CLAUDE_API_KEY = 'env-claude-key';

      const manager = CredentialManager.getInstance();
      const key = manager.getCredential('claudeApiKey');

      expect(key).toBe('env-claude-key');
    });

    it('should prioritize OPENAI_API_KEY for openaiApiKey', () => {
      process.env.OPENAI_API_KEY = 'env-openai-key';

      const manager = CredentialManager.getInstance();
      const key = manager.getCredential('openaiApiKey');

      expect(key).toBe('env-openai-key');
    });

    it('should prioritize GOOGLE_API_KEY for geminiApiKey', () => {
      process.env.GOOGLE_API_KEY = 'env-google-key';

      const manager = CredentialManager.getInstance();
      const key = manager.getCredential('geminiApiKey');

      expect(key).toBe('env-google-key');
    });

    it('should fall back to GEMINI_API_KEY for geminiApiKey', () => {
      process.env.GEMINI_API_KEY = 'env-gemini-key';

      const manager = CredentialManager.getInstance();
      const key = manager.getCredential('geminiApiKey');

      expect(key).toBe('env-gemini-key');
    });
  });

  // ============================================================
  // Stored Credentials
  // ============================================================
  describe('Stored Credentials', () => {
    it('should load credentials from file when env vars not set', () => {
      const storedCredentials = { apiKey: 'stored-key' };
      mockFs.existsSync.mockReturnValue(true);
      // Mock encrypted content - for simplicity, we'll test with plain text
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      // Clear cache to force reload
      manager.clearCache();

      const apiKey = manager.getCredential('apiKey');

      // Since env var is not set, it should try to load from file
      expect(mockFs.readFileSync).toHaveBeenCalled();
    });

    it('should return undefined when no credentials exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance();
      const apiKey = manager.getCredential('apiKey');

      expect(apiKey).toBeUndefined();
    });

    it('should handle corrupted credentials file gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('corrupted json {');

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.clearCache();

      // Should not throw, should return empty
      const apiKey = manager.getCredential('apiKey');
      expect(apiKey).toBeUndefined();
    });
  });

  // ============================================================
  // Set and Delete Credentials
  // ============================================================
  describe('Set and Delete Credentials', () => {
    it('should save credential to file', () => {
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.setCredential('apiKey', 'new-api-key');

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should create directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.setCredential('apiKey', 'new-api-key');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
    });

    it('should emit credential:set event', () => {
      mockFs.existsSync.mockReturnValue(false);
      const listener = jest.fn();

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.on('credential:set', listener);
      manager.setCredential('apiKey', 'new-api-key');

      expect(listener).toHaveBeenCalledWith({ key: 'apiKey' });
    });

    it('should delete credential from file', () => {
      const storedCredentials = { apiKey: 'existing-key', claudeApiKey: 'claude-key' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.deleteCredential('apiKey');

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      // Verify the written content doesn't include apiKey
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1] as string);
      expect(writtenContent.apiKey).toBeUndefined();
    });

    it('should emit credential:deleted event', () => {
      const storedCredentials = { apiKey: 'existing-key' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));
      const listener = jest.fn();

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.on('credential:deleted', listener);
      manager.deleteCredential('apiKey');

      expect(listener).toHaveBeenCalledWith({ key: 'apiKey' });
    });
  });

  // ============================================================
  // hasCredential
  // ============================================================
  describe('hasCredential', () => {
    it('should return true when env var is set', () => {
      process.env.GROK_API_KEY = 'env-key';

      const manager = CredentialManager.getInstance();
      const hasKey = manager.hasCredential('apiKey');

      expect(hasKey).toBe(true);
    });

    it('should return true when stored credential exists', () => {
      const storedCredentials = { apiKey: 'stored-key' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      const hasKey = manager.hasCredential('apiKey');

      expect(hasKey).toBe(true);
    });

    it('should return false when no credential exists', () => {
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance();
      const hasKey = manager.hasCredential('apiKey');

      expect(hasKey).toBe(false);
    });
  });

  // ============================================================
  // listCredentialKeys
  // ============================================================
  describe('listCredentialKeys', () => {
    it('should list stored credential keys', () => {
      const storedCredentials = { apiKey: 'key1', claudeApiKey: 'key2' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      const keys = manager.listCredentialKeys();

      expect(keys).toContain('apiKey');
      expect(keys).toContain('claudeApiKey');
    });

    it('should include environment-based credentials', () => {
      process.env.GROK_API_KEY = 'env-key';
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance();
      const keys = manager.listCredentialKeys();

      expect(keys).toContain('apiKey');
    });

    it('should not duplicate keys from both sources', () => {
      process.env.GROK_API_KEY = 'env-key';
      const storedCredentials = { apiKey: 'stored-key' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      const keys = manager.listCredentialKeys();

      const apiKeyCount = keys.filter(k => k === 'apiKey').length;
      expect(apiKeyCount).toBe(1);
    });
  });

  // ============================================================
  // Convenience Methods
  // ============================================================
  describe('Convenience Methods', () => {
    it('getApiKey should return API key', () => {
      process.env.GROK_API_KEY = 'env-api-key';

      const manager = CredentialManager.getInstance();
      const apiKey = manager.getApiKey();

      expect(apiKey).toBe('env-api-key');
    });

    it('setApiKey should save API key', () => {
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.setApiKey('new-api-key');

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Security Status
  // ============================================================
  describe('Security Status', () => {
    it('should return security status with encryption info', () => {
      const manager = CredentialManager.getInstance({ encryptionEnabled: true });
      const status = manager.getSecurityStatus();

      expect(status.encryptionEnabled).toBe(true);
      expect(status.storagePath).toContain('credentials.enc');
    });

    it('should count stored credentials', () => {
      const storedCredentials = { apiKey: 'key1', claudeApiKey: 'key2' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      const status = manager.getSecurityStatus();

      expect(status.credentialCount).toBe(2);
    });

    it('should count environment credentials', () => {
      process.env.GROK_API_KEY = 'env-key';
      process.env.OPENAI_API_KEY = 'openai-key';
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance();
      const status = manager.getSecurityStatus();

      expect(status.envCredentialCount).toBe(2);
    });
  });

  // ============================================================
  // Encryption Configuration
  // ============================================================
  describe('Encryption Configuration', () => {
    it('should report encryption enabled status', () => {
      const manager = CredentialManager.getInstance({ encryptionEnabled: true });

      expect(manager.isEncryptionEnabled()).toBe(true);
    });

    it('should report encryption disabled status', () => {
      const manager = CredentialManager.getInstance({ encryptionEnabled: false });

      expect(manager.isEncryptionEnabled()).toBe(false);
    });
  });

  // ============================================================
  // Cache Management
  // ============================================================
  describe('Cache Management', () => {
    it('should clear cache', () => {
      const storedCredentials = { apiKey: 'cached-key' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });

      // Load credentials first
      manager.getCredential('apiKey');

      // Clear cache
      manager.clearCache();

      // Access again - should read from file again
      manager.getCredential('apiKey');

      // readFileSync should have been called twice (once for each getCredential after clear)
      expect(mockFs.readFileSync.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // Migration
  // ============================================================
  describe('Migration', () => {
    it('should migrate to encrypted storage', () => {
      const storedCredentials = { apiKey: 'plain-key' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: true });
      const result = manager.migrateToEncrypted();

      expect(result).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false when encryption is disabled', () => {
      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      const result = manager.migrateToEncrypted();

      expect(result).toBe(false);
    });

    it('should return true when no credentials to migrate', () => {
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance({ encryptionEnabled: true });
      const result = manager.migrateToEncrypted();

      expect(result).toBe(true);
    });
  });

  // ============================================================
  // File Permissions
  // ============================================================
  describe('File Permissions', () => {
    it('should set secure file permissions (600)', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.statSync.mockReturnValue({ mode: 0o100600 } as unknown);

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.setCredential('apiKey', 'new-key');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      );
    });

    it('should attempt to fix insecure permissions', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.statSync.mockReturnValue({ mode: 0o100644 } as unknown); // Insecure permissions

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.setCredential('apiKey', 'new-key');

      expect(mockFs.chmodSync).toHaveBeenCalledWith(expect.any(String), 0o600);
    });

    it('should set secure directory permissions (700)', () => {
      mockFs.existsSync.mockReturnValue(false);

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.setCredential('apiKey', 'new-key');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mode: 0o700 })
      );
    });
  });

  // ============================================================
  // Helper Functions
  // ============================================================
  describe('Helper Functions', () => {
    it('getCredentialManager should return singleton instance', () => {
      const manager1 = getCredentialManager();
      const manager2 = getCredentialManager();

      expect(manager1).toBe(manager2);
    });

    it('getApiKey helper should work', () => {
      process.env.GROK_API_KEY = 'helper-api-key';

      const apiKey = getApiKey();

      expect(apiKey).toBe('helper-api-key');
    });

    it('setApiKey helper should work', () => {
      mockFs.existsSync.mockReturnValue(false);

      // First get a manager instance (without encryption for testing)
      CredentialManager.getInstance({ encryptionEnabled: false });

      setApiKey('helper-new-key');

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================
  describe('Edge Cases', () => {
    it('should handle read errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      manager.clearCache();

      const apiKey = manager.getCredential('apiKey');

      // Should return undefined on error
      expect(apiKey).toBeUndefined();
    });

    it('should handle write errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });

      expect(() => manager.setCredential('apiKey', 'new-key')).toThrow('Write error');
    });

    it('should handle chmod errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.statSync.mockReturnValue({ mode: 0o100644 } as unknown);
      mockFs.chmodSync.mockImplementation(() => {
        throw new Error('chmod error');
      });

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });

      // Should not throw, just log error
      expect(() => manager.setCredential('apiKey', 'new-key')).not.toThrow();
    });

    it('should handle undefined credential values in stored file', () => {
      const storedCredentials = { apiKey: undefined, claudeApiKey: 'valid' };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(storedCredentials));

      const manager = CredentialManager.getInstance({ encryptionEnabled: false });
      const keys = manager.listCredentialKeys();

      // Should only list keys with actual values
      expect(keys).not.toContain('apiKey');
      expect(keys).toContain('claudeApiKey');
    });
  });
});
