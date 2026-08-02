/**
 * Session Encryption for secure storage of chat sessions
 *
 * Uses AES-256-GCM for authenticated encryption:
 * - Encrypts session content before storage
 * - Protects sensitive conversation data
 * - Key derived from user password or machine-specific key
 */

import * as crypto from 'crypto';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

// AES-256-GCM parameters
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const HKDF_DIGEST = 'sha256';
const HKDF_INFO = 'codebuddy-session-encryption/v2';
const ENCRYPTION_VERSION = 2;

export interface EncryptedData {
  /** Encrypted ciphertext (base64) */
  ciphertext: string;
  /** Initialization vector (base64) */
  iv: string;
  /** GCM authentication tag (base64) */
  authTag: string;
  /** Salt for key derivation (base64) */
  salt: string;
  /** Version for forward compatibility */
  version: number;
}

export interface EncryptionConfig {
  /** Path to store the encryption key */
  keyPath?: string;
  /** Use password-based key derivation */
  usePassword?: boolean;
  /** Enable encryption (can be disabled for performance) */
  enabled?: boolean;
}

const DEFAULT_CONFIG: EncryptionConfig = {
  keyPath: path.join(os.homedir(), '.codebuddy', '.encryption-key'),
  usePassword: false,
  enabled: true,
};

/**
 * Session encryption manager
 */
export class SessionEncryption {
  private config: Required<EncryptionConfig>;
  private key: Buffer | null = null;
  private initialized: boolean = false;
  private keyRotationInProgress = false;
  private keyInitializationInProgress = false;

  private get rotationLockPath(): string {
    return `${this.config.keyPath}.rotation.lock`;
  }

  private async acquireKeyRotationLock(): Promise<() => Promise<void>> {
    await fs.ensureDir(path.dirname(this.config.keyPath));
    try {
      await fs.writeFile(
        this.rotationLockPath,
        `${process.pid}:${Date.now()}\n`,
        { mode: 0o600, flag: 'wx' },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `A session encryption key rotation operation is already in progress at ` +
            this.rotationLockPath,
        );
      }
      throw error;
    }
    return async () => {
      try {
        await fs.remove(this.rotationLockPath);
      } catch (error) {
        logger.warn('Failed to release session encryption rotation lock', {
          lockPath: this.rotationLockPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
  }

  /** Refuse rotation from a long-lived instance that no longer owns the active key. */
  private async assertActiveKeyIsCurrent(): Promise<void> {
    if (!this.key || !(await fs.pathExists(this.config.keyPath))) return;
    const activeKey = await fs.readFile(this.config.keyPath);
    if (
      activeKey.length !== this.key.length ||
      !crypto.timingSafeEqual(activeKey, this.key)
    ) {
      throw new Error(
        'Session encryption key instance is stale; reinitialize it from the active key before rotating',
      );
    }
  }

  constructor(config: EncryptionConfig = {}) {
    this.config = {
      keyPath: config.keyPath ?? DEFAULT_CONFIG.keyPath!,
      usePassword: config.usePassword ?? DEFAULT_CONFIG.usePassword!,
      enabled: config.enabled ?? DEFAULT_CONFIG.enabled!,
    };
  }

  /**
   * Initialize encryption with machine-generated key
   */
  async initialize(): Promise<void> {
    if (this.initialized || !this.config.enabled) {
      return;
    }
    if (this.keyRotationInProgress || this.keyInitializationInProgress) {
      throw new Error('Another encryption key lifecycle operation is already in progress');
    }
    this.keyInitializationInProgress = true;

    try {
      // Try to load existing key
      if (await fs.pathExists(this.config.keyPath)) {
        const keyData = await fs.readFile(this.config.keyPath);
        this.key = keyData;
      } else {
        // Generate new key
        this.key = crypto.randomBytes(KEY_LENGTH);
        // Store key securely
        await fs.ensureDir(path.dirname(this.config.keyPath));
        await fs.writeFile(this.config.keyPath, this.key, { mode: 0o600 });
      }

      this.initialized = true;
    } catch {
      // Fallback to machine-based key
      this.key = this.deriveMachineKey();
      this.initialized = true;
    } finally {
      this.keyInitializationInProgress = false;
    }
  }

  /**
   * Initialize with password-based key
   */
  async initializeWithPassword(password: string, salt?: string): Promise<string> {
    if (this.keyRotationInProgress) {
      throw new Error('Cannot reinitialize encryption while key rotation is in progress');
    }
    if (this.keyInitializationInProgress) {
      throw new Error('Encryption key initialization is already in progress');
    }
    this.keyInitializationInProgress = true;

    try {
      if (!this.config.enabled) {
        return '';
      }

      const saltBuffer = salt
        ? Buffer.from(salt, 'base64')
        : crypto.randomBytes(SALT_LENGTH);

      this.key = await this.deriveKeyFromPassword(password, saltBuffer);
      this.initialized = true;

      return saltBuffer.toString('base64');
    } finally {
      this.keyInitializationInProgress = false;
    }
  }

  /** Initialize from an explicit 32-byte master key for controlled migrations. */
  initializeWithKey(key: Buffer | string): void {
    if (this.keyRotationInProgress) {
      throw new Error('Cannot reinitialize encryption while key rotation is in progress');
    }
    if (this.keyInitializationInProgress) {
      throw new Error('Encryption key initialization is already in progress');
    }
    if (!this.config.enabled) return;
    const keyBuffer = typeof key === 'string' ? Buffer.from(key, 'base64') : Buffer.from(key);
    if (keyBuffer.length !== KEY_LENGTH) {
      throw new Error(`Encryption key must be exactly ${KEY_LENGTH} bytes`);
    }
    this.key = Buffer.from(keyBuffer);
    this.initialized = true;
  }

  /**
   * Encrypt data
   */
  encrypt(data: string): EncryptedData {
    if (!this.config.enabled || !this.key) {
      // Return passthrough if encryption disabled
      return {
        ciphertext: Buffer.from(data).toString('base64'),
        iv: '',
        authTag: '',
        salt: '',
        version: 0, // version 0 = unencrypted
      };
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    const subkey = this.deriveSubkey(salt);

    const cipher = crypto.createCipheriv(ALGORITHM, subkey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      salt: salt.toString('base64'),
      version: ENCRYPTION_VERSION,
    };
  }

  private deriveSubkey(salt: Buffer): Buffer {
    if (!this.key) throw new Error('Encryption not initialized');
    if (salt.length !== SALT_LENGTH) throw new Error('Invalid encryption salt length');
    return Buffer.from(
      crypto.hkdfSync(HKDF_DIGEST, this.key, salt, HKDF_INFO, KEY_LENGTH),
    );
  }

  /**
   * Decrypt data
   */
  decrypt(encrypted: EncryptedData): string {
    // Handle unencrypted data (version 0)
    if (encrypted.version === 0 || !this.config.enabled || !this.key) {
      return Buffer.from(encrypted.ciphertext, 'base64').toString('utf8');
    }

    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

    let decryptionKey: Buffer;
    if (encrypted.version === 1) {
      decryptionKey = this.key;
    } else if (encrypted.version === ENCRYPTION_VERSION) {
      if (!encrypted.salt) throw new Error('Encrypted v2 data is missing its salt');
      decryptionKey = this.deriveSubkey(Buffer.from(encrypted.salt, 'base64'));
    } else {
      throw new Error(`Unsupported encrypted data version: ${encrypted.version}`);
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, decryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Encrypt JSON object
   */
  encryptObject<T>(obj: T): EncryptedData {
    return this.encrypt(JSON.stringify(obj));
  }

  /**
   * Decrypt to JSON object
   */
  decryptObject<T>(encrypted: EncryptedData): T {
    const decrypted = this.decrypt(encrypted);
    return JSON.parse(decrypted) as T;
  }

  /**
   * Check if data is encrypted
   */
  isEncrypted(data: EncryptedData): boolean {
    return data.version > 0 && !!data.iv && !!data.authTag;
  }

  /**
   * Derive key from password using PBKDF2
   */
  private deriveKeyFromPassword(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        'sha512',
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        }
      );
    });
  }

  /**
   * Derive a key from machine-specific data
   * (Used as fallback when key file can't be created)
   */
  private deriveMachineKey(): Buffer {
    const machineId = [
      os.hostname(),
      os.userInfo().username,
      os.homedir(),
      os.platform(),
    ].join('|');

    return crypto.createHash('sha256').update(machineId).digest();
  }

  /**
   * Rotate the master key while persisting a recovery copy first.
   *
   * Existing blobs are not re-encrypted automatically because this class does
   * not own the session store. The caller must migrate them with instances
   * initialized through initializeWithKey(), then securely remove recoveryKeyPath.
   * Rotation is a single-writer maintenance operation: other long-lived
   * encryptors must be stopped or reinitialized before writes resume.
   */
  async rotateKey(): Promise<{ oldKey: string; newKey: string; recoveryKeyPath: string }> {
    if (this.keyInitializationInProgress) {
      throw new Error('Encryption key initialization is already in progress');
    }
    if (!this.key) {
      throw new Error('Encryption not initialized');
    }
    if (this.keyRotationInProgress) {
      throw new Error('A session encryption key rotation is already in progress');
    }
    this.keyRotationInProgress = true;
    let releaseLock: (() => Promise<void>) | undefined;

    try {
      releaseLock = await this.acquireKeyRotationLock();
      await this.assertActiveKeyIsCurrent();
      // Snapshot before the asynchronous write so lifecycle changes cannot
      // mutate the recovery material while the filesystem still consumes it.
      const oldKeyBuffer = Buffer.from(this.key);
      const oldKey = oldKeyBuffer.toString('base64');
      const recoveryKeyPath = `${this.config.keyPath}.previous`;

      // Atomic exclusive creation closes the cross-instance/process TOCTOU:
      // only one contender can claim the recovery slot.
      try {
        await fs.writeFile(recoveryKeyPath, oldKeyBuffer, { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            `A previous key rotation is still pending at ${recoveryKeyPath}; ` +
              'migrate existing sessions and complete it before rotating again',
          );
        }
        throw error;
      }

      const newKey = crypto.randomBytes(KEY_LENGTH);
      await fs.writeFile(this.config.keyPath, newKey, { mode: 0o600 });
      this.key = newKey;

      logger.warn(
        `Session encryption key rotated; existing sessions require migration. ` +
          `Recovery key retained at ${recoveryKeyPath}`,
      );

      return {
        oldKey,
        newKey: newKey.toString('base64'),
        recoveryKeyPath,
      };
    } finally {
      await releaseLock?.();
      this.keyRotationInProgress = false;
    }
  }

  /** Remove the retained old key only after the caller has migrated every blob. */
  async completeKeyRotation(): Promise<void> {
    if (this.keyInitializationInProgress) {
      throw new Error('Encryption key initialization is already in progress');
    }
    if (!this.key) {
      throw new Error('Encryption not initialized');
    }
    if (this.keyRotationInProgress) {
      throw new Error('A session encryption key rotation is already in progress');
    }
    this.keyRotationInProgress = true;
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await this.acquireKeyRotationLock();
      await this.assertActiveKeyIsCurrent();
      await fs.remove(`${this.config.keyPath}.previous`);
    } finally {
      await releaseLock?.();
      this.keyRotationInProgress = false;
    }
  }

  /**
   * Check if encryption is enabled and initialized
   */
  isReady(): boolean {
    return this.initialized && this.key !== null;
  }

  /**
   * Get encryption status
   */
  getStatus(): {
    enabled: boolean;
    initialized: boolean;
    algorithm: string;
    keyLength: number;
  } {
    return {
      enabled: this.config.enabled,
      initialized: this.initialized,
      algorithm: ALGORITHM,
      keyLength: KEY_LENGTH * 8, // bits
    };
  }

  /**
   * Clear encryption key from memory
   */
  dispose(): void {
    if (this.keyRotationInProgress) {
      throw new Error('Cannot dispose encryption while key rotation is in progress');
    }
    if (this.keyInitializationInProgress) {
      throw new Error('Cannot dispose encryption while a key lifecycle operation is in progress');
    }
    if (this.key) {
      // Overwrite key in memory
      crypto.randomFillSync(this.key);
      this.key = null;
    }
    this.initialized = false;
  }
}

// Singleton instance
let sessionEncryption: SessionEncryption | null = null;

/**
 * Get or create the session encryption instance
 */
export function getSessionEncryption(): SessionEncryption {
  if (!sessionEncryption) {
    sessionEncryption = new SessionEncryption();
  }
  return sessionEncryption;
}

/**
 * Initialize session encryption
 */
export async function initializeEncryption(
  config?: EncryptionConfig
): Promise<SessionEncryption> {
  sessionEncryption = new SessionEncryption(config);
  await sessionEncryption.initialize();
  return sessionEncryption;
}

/**
 * Reset session encryption
 */
export function resetSessionEncryption(): void {
  if (sessionEncryption) {
    sessionEncryption.dispose();
    sessionEncryption = null;
  }
}

export default SessionEncryption;
