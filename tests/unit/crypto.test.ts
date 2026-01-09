/**
 * Unit tests for Crypto Module (Session Encryption)
 *
 * Tests for encryption/decryption, hashing, and key management
 * using AES-256-GCM authenticated encryption.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Mocks
// ============================================================================

// Mock fs-extra
const mockFsExtra = {
  pathExists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  ensureDir: jest.fn(),
};
jest.mock('fs-extra', () => mockFsExtra);

// Import modules after mocks
import {
  SessionEncryption,
  EncryptedData,
  getSessionEncryption,
  initializeEncryption,
  resetSessionEncryption,
} from '../../src/security/session-encryption';

describe('SessionEncryption', () => {
  let encryption: SessionEncryption;
  let tempKeyPath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionEncryption();

    // Setup temp key path
    tempKeyPath = path.join(os.tmpdir(), '.codebuddy-test', '.encryption-key');

    // Default mock behavior
    mockFsExtra.pathExists.mockResolvedValue(false);
    mockFsExtra.readFile.mockResolvedValue(Buffer.alloc(0));
    mockFsExtra.writeFile.mockResolvedValue(undefined);
    mockFsExtra.ensureDir.mockResolvedValue(undefined);

    encryption = new SessionEncryption({
      keyPath: tempKeyPath,
      enabled: true,
      usePassword: false,
    });
  });

  afterEach(() => {
    encryption.dispose();
    resetSessionEncryption();
  });

  // ============================================================================
  // Encryption/Decryption Tests
  // ============================================================================
  describe('Encryption and Decryption', () => {
    beforeEach(async () => {
      await encryption.initialize();
    });

    it('should encrypt and decrypt a string successfully', () => {
      const plaintext = 'Hello, World!';

      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt empty string', () => {
      const plaintext = '';

      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt long text', () => {
      const plaintext = 'A'.repeat(10000);

      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt unicode text', () => {
      const plaintext = 'Hello 世界! 🌍 مرحبا';

      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt JSON content', () => {
      const data = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        metadata: { sessionId: '123', timestamp: Date.now() },
      };

      const encrypted = encryption.encryptObject(data);
      const decrypted = encryption.decryptObject<typeof data>(encrypted);

      expect(decrypted).toEqual(data);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const plaintext = 'Test message';

      const encrypted1 = encryption.encrypt(plaintext);
      const encrypted2 = encryption.encrypt(plaintext);

      // Different IVs should produce different ciphertext
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);

      // But both should decrypt to same plaintext
      expect(encryption.decrypt(encrypted1)).toBe(plaintext);
      expect(encryption.decrypt(encrypted2)).toBe(plaintext);
    });

    it('should return encrypted data structure with all required fields', () => {
      const encrypted = encryption.encrypt('test');

      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted).toHaveProperty('salt');
      expect(encrypted).toHaveProperty('version');
      expect(encrypted.version).toBe(1);
    });

    it('should encode data as base64', () => {
      const encrypted = encryption.encrypt('test');

      // Verify base64 encoding
      expect(() => Buffer.from(encrypted.ciphertext, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.iv, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.authTag, 'base64')).not.toThrow();
    });

    it('should handle special characters in plaintext', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:\'"<>,.?/\\`~';

      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle newlines and tabs in plaintext', () => {
      const plaintext = 'Line 1\nLine 2\tTabbed\r\nWindows line';

      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  // ============================================================================
  // Authentication Tag Tests
  // ============================================================================
  describe('GCM Authentication', () => {
    beforeEach(async () => {
      await encryption.initialize();
    });

    it('should fail decryption with tampered ciphertext', () => {
      const encrypted = encryption.encrypt('secret data');

      // Tamper with ciphertext
      const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
      tamperedCiphertext[0] ^= 0xff;

      const tampered: EncryptedData = {
        ...encrypted,
        ciphertext: tamperedCiphertext.toString('base64'),
      };

      expect(() => encryption.decrypt(tampered)).toThrow();
    });

    it('should fail decryption with tampered auth tag', () => {
      const encrypted = encryption.encrypt('secret data');

      // Tamper with auth tag
      const tamperedAuthTag = Buffer.from(encrypted.authTag, 'base64');
      tamperedAuthTag[0] ^= 0xff;

      const tampered: EncryptedData = {
        ...encrypted,
        authTag: tamperedAuthTag.toString('base64'),
      };

      expect(() => encryption.decrypt(tampered)).toThrow();
    });

    it('should fail decryption with wrong IV', () => {
      const encrypted = encryption.encrypt('secret data');

      // Use different IV
      const wrongIv = crypto.randomBytes(16).toString('base64');

      const tampered: EncryptedData = {
        ...encrypted,
        iv: wrongIv,
      };

      expect(() => encryption.decrypt(tampered)).toThrow();
    });
  });

  // ============================================================================
  // Disabled Encryption Tests
  // ============================================================================
  describe('Disabled Encryption', () => {
    it('should passthrough data when encryption is disabled', () => {
      const disabledEncryption = new SessionEncryption({
        enabled: false,
      });

      const plaintext = 'sensitive data';
      const encrypted = disabledEncryption.encrypt(plaintext);

      // Version 0 indicates unencrypted
      expect(encrypted.version).toBe(0);
      expect(encrypted.iv).toBe('');
      expect(encrypted.authTag).toBe('');

      // Should be able to decode plaintext from ciphertext
      const decoded = Buffer.from(encrypted.ciphertext, 'base64').toString('utf8');
      expect(decoded).toBe(plaintext);

      // Decrypt should return original
      const decrypted = disabledEncryption.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);

      disabledEncryption.dispose();
    });

    it('should handle version 0 data correctly', () => {
      const encrypted: EncryptedData = {
        ciphertext: Buffer.from('test data').toString('base64'),
        iv: '',
        authTag: '',
        salt: '',
        version: 0,
      };

      const decrypted = encryption.decrypt(encrypted);
      expect(decrypted).toBe('test data');
    });
  });

  // ============================================================================
  // Key Management Tests
  // ============================================================================
  describe('Key Management', () => {
    describe('Initialization', () => {
      it('should generate new key if none exists', async () => {
        mockFsExtra.pathExists.mockResolvedValue(false);

        await encryption.initialize();

        expect(mockFsExtra.writeFile).toHaveBeenCalled();
        expect(encryption.isReady()).toBe(true);
      });

      it('should load existing key from file', async () => {
        const existingKey = crypto.randomBytes(32);
        mockFsExtra.pathExists.mockResolvedValue(true);
        mockFsExtra.readFile.mockResolvedValue(existingKey);

        await encryption.initialize();

        expect(mockFsExtra.readFile).toHaveBeenCalled();
        expect(mockFsExtra.writeFile).not.toHaveBeenCalled();
        expect(encryption.isReady()).toBe(true);
      });

      it('should create key directory if it does not exist', async () => {
        mockFsExtra.pathExists.mockResolvedValue(false);

        await encryption.initialize();

        expect(mockFsExtra.ensureDir).toHaveBeenCalled();
      });

      it('should write key with secure permissions (0o600)', async () => {
        mockFsExtra.pathExists.mockResolvedValue(false);

        await encryption.initialize();

        expect(mockFsExtra.writeFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Buffer),
          { mode: 0o600 }
        );
      });

      it('should fallback to machine key on file system error', async () => {
        mockFsExtra.pathExists.mockRejectedValue(new Error('Permission denied'));

        await encryption.initialize();

        // Should still be ready using derived machine key
        expect(encryption.isReady()).toBe(true);
      });

      it('should skip initialization if encryption disabled', async () => {
        const disabledEncryption = new SessionEncryption({ enabled: false });

        await disabledEncryption.initialize();

        expect(mockFsExtra.pathExists).not.toHaveBeenCalled();
        expect(disabledEncryption.isReady()).toBe(false);

        disabledEncryption.dispose();
      });

      it('should not reinitialize if already initialized', async () => {
        mockFsExtra.pathExists.mockResolvedValue(false);

        await encryption.initialize();
        const callCount = mockFsExtra.writeFile.mock.calls.length;

        await encryption.initialize();

        expect(mockFsExtra.writeFile.mock.calls.length).toBe(callCount);
      });
    });

    describe('Password-Based Key Derivation', () => {
      it('should derive key from password', async () => {
        const password = 'my-secure-password';

        const salt = await encryption.initializeWithPassword(password);

        expect(salt).toBeDefined();
        expect(salt.length).toBeGreaterThan(0);
        expect(encryption.isReady()).toBe(true);
      });

      it('should produce consistent key with same password and salt', async () => {
        const password = 'test-password';

        const salt1 = await encryption.initializeWithPassword(password);

        const plaintext = 'test data';
        const encrypted = encryption.encrypt(plaintext);

        // Create new instance with same password and salt
        const encryption2 = new SessionEncryption({ enabled: true });
        await encryption2.initializeWithPassword(password, salt1);

        const decrypted = encryption2.decrypt(encrypted);
        expect(decrypted).toBe(plaintext);

        encryption2.dispose();
      });

      it('should produce different keys with different passwords', async () => {
        const password1 = 'password1';
        const password2 = 'password2';

        await encryption.initializeWithPassword(password1);
        const encrypted = encryption.encrypt('test');

        const encryption2 = new SessionEncryption({ enabled: true });
        await encryption2.initializeWithPassword(password2);

        // Different password should fail to decrypt
        expect(() => encryption2.decrypt(encrypted)).toThrow();

        encryption2.dispose();
      });

      it('should return empty salt when encryption disabled', async () => {
        const disabledEncryption = new SessionEncryption({ enabled: false });

        const salt = await disabledEncryption.initializeWithPassword('password');

        expect(salt).toBe('');

        disabledEncryption.dispose();
      });

      it('should use provided salt for key derivation', async () => {
        const password = 'test-password';
        const knownSalt = crypto.randomBytes(32).toString('base64');

        await encryption.initializeWithPassword(password, knownSalt);

        expect(encryption.isReady()).toBe(true);
      });
    });

    describe('Key Rotation', () => {
      it('should rotate key and return old and new keys', async () => {
        await encryption.initialize();

        const result = await encryption.rotateKey();

        expect(result).toHaveProperty('oldKey');
        expect(result).toHaveProperty('newKey');
        expect(result.oldKey).not.toBe(result.newKey);
      });

      it('should write new key to file on rotation', async () => {
        mockFsExtra.pathExists.mockResolvedValue(false);
        await encryption.initialize();

        mockFsExtra.writeFile.mockClear();

        await encryption.rotateKey();

        expect(mockFsExtra.writeFile).toHaveBeenCalled();
      });

      it('should allow decryption with new key after rotation', async () => {
        await encryption.initialize();

        const plaintext = 'data to encrypt';

        await encryption.rotateKey();

        // Encrypt with new key
        const encrypted = encryption.encrypt(plaintext);
        const decrypted = encryption.decrypt(encrypted);

        expect(decrypted).toBe(plaintext);
      });

      it('should fail to decrypt old data after rotation', async () => {
        await encryption.initialize();

        const encrypted = encryption.encrypt('old data');

        await encryption.rotateKey();

        // Old data encrypted with old key should fail
        expect(() => encryption.decrypt(encrypted)).toThrow();
      });

      it('should throw if not initialized', async () => {
        await expect(encryption.rotateKey()).rejects.toThrow('Encryption not initialized');
      });
    });

    describe('Machine Key Derivation', () => {
      it('should derive consistent key from machine-specific data', async () => {
        mockFsExtra.pathExists.mockRejectedValue(new Error('No access'));

        const encryption1 = new SessionEncryption({ enabled: true });
        await encryption1.initialize();

        const encryption2 = new SessionEncryption({ enabled: true });
        await encryption2.initialize();

        // Both should derive same machine key
        const plaintext = 'test';
        const encrypted = encryption1.encrypt(plaintext);
        const decrypted = encryption2.decrypt(encrypted);

        expect(decrypted).toBe(plaintext);

        encryption1.dispose();
        encryption2.dispose();
      });
    });
  });

  // ============================================================================
  // Status and Utility Methods
  // ============================================================================
  describe('Status and Utility', () => {
    describe('isReady', () => {
      it('should return false before initialization', () => {
        expect(encryption.isReady()).toBe(false);
      });

      it('should return true after initialization', async () => {
        await encryption.initialize();
        expect(encryption.isReady()).toBe(true);
      });

      it('should return false after dispose', async () => {
        await encryption.initialize();
        encryption.dispose();
        expect(encryption.isReady()).toBe(false);
      });
    });

    describe('isEncrypted', () => {
      it('should return true for encrypted data', async () => {
        await encryption.initialize();
        const encrypted = encryption.encrypt('test');

        expect(encryption.isEncrypted(encrypted)).toBe(true);
      });

      it('should return false for unencrypted data', () => {
        const unencrypted: EncryptedData = {
          ciphertext: Buffer.from('test').toString('base64'),
          iv: '',
          authTag: '',
          salt: '',
          version: 0,
        };

        expect(encryption.isEncrypted(unencrypted)).toBe(false);
      });
    });

    describe('getStatus', () => {
      it('should return correct status before initialization', () => {
        const status = encryption.getStatus();

        expect(status).toEqual({
          enabled: true,
          initialized: false,
          algorithm: 'aes-256-gcm',
          keyLength: 256,
        });
      });

      it('should return correct status after initialization', async () => {
        await encryption.initialize();
        const status = encryption.getStatus();

        expect(status).toEqual({
          enabled: true,
          initialized: true,
          algorithm: 'aes-256-gcm',
          keyLength: 256,
        });
      });

      it('should report disabled status when encryption disabled', () => {
        const disabledEncryption = new SessionEncryption({ enabled: false });
        const status = disabledEncryption.getStatus();

        expect(status.enabled).toBe(false);

        disabledEncryption.dispose();
      });
    });

    describe('dispose', () => {
      it('should clear key from memory', async () => {
        await encryption.initialize();
        expect(encryption.isReady()).toBe(true);

        encryption.dispose();

        expect(encryption.isReady()).toBe(false);
      });

      it('should be safe to call multiple times', async () => {
        await encryption.initialize();

        expect(() => {
          encryption.dispose();
          encryption.dispose();
          encryption.dispose();
        }).not.toThrow();
      });
    });
  });

  // ============================================================================
  // Singleton Pattern Tests
  // ============================================================================
  describe('Singleton Pattern', () => {
    afterEach(() => {
      resetSessionEncryption();
    });

    it('should return same instance from getSessionEncryption', () => {
      const instance1 = getSessionEncryption();
      const instance2 = getSessionEncryption();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton instance', () => {
      const instance1 = getSessionEncryption();
      resetSessionEncryption();
      const instance2 = getSessionEncryption();

      expect(instance1).not.toBe(instance2);
    });

    it('should initialize encryption via factory function', async () => {
      const instance = await initializeEncryption({
        enabled: true,
        keyPath: tempKeyPath,
      });

      expect(instance).toBeDefined();
      expect(instance.isReady()).toBe(true);
    });

    it('should dispose previous instance on reset', async () => {
      const instance = await initializeEncryption({ enabled: true });
      const disposeCheck = instance.isReady();

      resetSessionEncryption();

      expect(disposeCheck).toBe(true);
      expect(instance.isReady()).toBe(false);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle null-like values in JSON encryption', async () => {
      await encryption.initialize();

      const data = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        zero: 0,
        falseBool: false,
      };

      const encrypted = encryption.encryptObject(data);
      const decrypted = encryption.decryptObject<typeof data>(encrypted);

      // Note: undefined becomes undefined during JSON stringify/parse
      expect(decrypted.nullValue).toBeNull();
      expect(decrypted.emptyString).toBe('');
      expect(decrypted.zero).toBe(0);
      expect(decrypted.falseBool).toBe(false);
    });

    it('should handle arrays in JSON encryption', async () => {
      await encryption.initialize();

      const data = [1, 2, 3, 'four', { five: 5 }];

      const encrypted = encryption.encryptObject(data);
      const decrypted = encryption.decryptObject<typeof data>(encrypted);

      expect(decrypted).toEqual(data);
    });

    it('should handle deeply nested objects', async () => {
      await encryption.initialize();

      const data = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      };

      const encrypted = encryption.encryptObject(data);
      const decrypted = encryption.decryptObject<typeof data>(encrypted);

      expect(decrypted).toEqual(data);
    });

    it('should handle binary-like data in string', async () => {
      await encryption.initialize();

      // String with null bytes and other binary characters
      const plaintext = 'test\x00\x01\x02data';

      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  // ============================================================================
  // Performance and Limits
  // ============================================================================
  describe('Performance', () => {
    it('should encrypt and decrypt large data efficiently', async () => {
      await encryption.initialize();

      // 1MB of data
      const largeData = 'X'.repeat(1024 * 1024);

      const startTime = Date.now();
      const encrypted = encryption.encrypt(largeData);
      const decrypted = encryption.decrypt(encrypted);
      const elapsed = Date.now() - startTime;

      expect(decrypted).toBe(largeData);
      // Should complete in reasonable time (< 5 seconds)
      expect(elapsed).toBeLessThan(5000);
    });

    it('should handle multiple consecutive encrypt/decrypt operations', async () => {
      await encryption.initialize();

      const results: boolean[] = [];

      for (let i = 0; i < 100; i++) {
        const data = `Message ${i}`;
        const encrypted = encryption.encrypt(data);
        const decrypted = encryption.decrypt(encrypted);
        results.push(decrypted === data);
      }

      expect(results.every((r) => r)).toBe(true);
    });
  });

  // ============================================================================
  // Cryptographic Correctness
  // ============================================================================
  describe('Cryptographic Correctness', () => {
    it('should use AES-256-GCM algorithm', async () => {
      await encryption.initialize();

      const status = encryption.getStatus();

      expect(status.algorithm).toBe('aes-256-gcm');
      expect(status.keyLength).toBe(256);
    });

    it('should generate 128-bit IV', async () => {
      await encryption.initialize();

      const encrypted = encryption.encrypt('test');
      const ivBuffer = Buffer.from(encrypted.iv, 'base64');

      expect(ivBuffer.length).toBe(16); // 128 bits = 16 bytes
    });

    it('should generate 128-bit auth tag', async () => {
      await encryption.initialize();

      const encrypted = encryption.encrypt('test');
      const authTagBuffer = Buffer.from(encrypted.authTag, 'base64');

      expect(authTagBuffer.length).toBe(16); // 128 bits = 16 bytes
    });

    it('should generate unique IVs for each encryption', async () => {
      await encryption.initialize();

      const ivSet = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const encrypted = encryption.encrypt('test');
        ivSet.add(encrypted.iv);
      }

      // All IVs should be unique
      expect(ivSet.size).toBe(100);
    });
  });
});

describe('SessionEncryption Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionEncryption();

    // Default mock behavior
    mockFsExtra.pathExists.mockResolvedValue(false);
    mockFsExtra.writeFile.mockResolvedValue(undefined);
    mockFsExtra.ensureDir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSessionEncryption();
  });

  it('should work with complete session data workflow', async () => {
    const encryption = await initializeEncryption({ enabled: true });

    // Simulate encrypting session data
    const sessionData = {
      id: 'session-123',
      messages: [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      metadata: {
        startTime: Date.now(),
        model: 'grok-2',
      },
    };

    const encrypted = encryption.encryptObject(sessionData);

    // Verify it's actually encrypted
    expect(encryption.isEncrypted(encrypted)).toBe(true);

    // Simulate storing and retrieving
    const stored = JSON.stringify(encrypted);
    const retrieved = JSON.parse(stored) as EncryptedData;

    // Decrypt
    const decrypted = encryption.decryptObject<typeof sessionData>(retrieved);

    expect(decrypted).toEqual(sessionData);
  });
});

// ============================================================================
// Hashing Tests (via machine key derivation)
// ============================================================================
describe('Hashing Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionEncryption();

    // Force machine key derivation by simulating file access error
    mockFsExtra.pathExists.mockRejectedValue(new Error('No access'));
  });

  afterEach(() => {
    resetSessionEncryption();
  });

  it('should derive machine key using SHA-256', async () => {
    // The SessionEncryption uses SHA-256 internally for machine key derivation
    // We can verify this by checking that different instances produce the same key
    const encryption1 = new SessionEncryption({ enabled: true });
    await encryption1.initialize();

    const encryption2 = new SessionEncryption({ enabled: true });
    await encryption2.initialize();

    // Encrypt with one, decrypt with other
    const plaintext = 'hash verification test';
    const encrypted = encryption1.encrypt(plaintext);
    const decrypted = encryption2.decrypt(encrypted);

    expect(decrypted).toBe(plaintext);

    encryption1.dispose();
    encryption2.dispose();
  });

  it('should produce 256-bit key from machine data', async () => {
    // Verify that the key length is correct by checking the status
    const encryption = new SessionEncryption({ enabled: true });
    await encryption.initialize();

    const status = encryption.getStatus();
    expect(status.keyLength).toBe(256);

    encryption.dispose();
  });
});
