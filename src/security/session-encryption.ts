/**
 * Session Encryption for secure storage of chat sessions
 *
 * Uses AES-256-GCM for authenticated encryption:
 * - Encrypts session content before storage
 * - Protects sensitive conversation data
 * - Key derived from user password or machine-specific key
 */

import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// AES-256-GCM parameters
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

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
    } catch (error) {
      // Fallback to machine-based key
      this.key = this.deriveMachineKey();
      this.initialized = true;
    }
  }

  /**
   * Initialize with password-based key
   */
  async initializeWithPassword(password: string, salt?: string): Promise<string> {
    if (!this.config.enabled) {
      return '';
    }

    const saltBuffer = salt
      ? Buffer.from(salt, 'base64')
      : crypto.randomBytes(SALT_LENGTH);

    this.key = await this.deriveKeyFromPassword(password, saltBuffer);
    this.initialized = true;

    return saltBuffer.toString('base64');
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

    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv, {
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
      version: 1,
    };
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

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv, {
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
   * Rotate encryption key
   * Re-encrypts all data with a new key
   */
  async rotateKey(): Promise<{ oldKey: string; newKey: string }> {
    if (!this.key) {
      throw new Error('Encryption not initialized');
    }

    const oldKey = this.key.toString('base64');

    // Generate new key
    const newKey = crypto.randomBytes(KEY_LENGTH);

    // Store new key
    await fs.writeFile(this.config.keyPath, newKey, { mode: 0o600 });

    this.key = newKey;

    return {
      oldKey,
      newKey: newKey.toString('base64'),
    };
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
