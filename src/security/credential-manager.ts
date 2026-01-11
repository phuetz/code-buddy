/**
 * Secure Credential Manager
 *
 * Provides secure storage and retrieval of API keys and other sensitive credentials.
 * Uses encryption when storing to disk and prioritizes environment variables.
 *
 * Security hierarchy (in order of preference):
 * 1. Environment variables (most secure - no disk storage)
 * 2. Encrypted storage with machine-specific key
 * 3. Plain-text storage (with warning)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface CredentialConfig {
  /** Enable encryption for stored credentials (default: true) */
  encryptionEnabled: boolean;
  /** Path to credentials file (default: ~/.codebuddy/credentials.enc) */
  credentialsPath?: string;
  /** Warn about plain-text storage (default: true) */
  warnPlainText: boolean;
}

export interface StoredCredentials {
  apiKey?: string;
  claudeApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  [key: string]: string | undefined;
}

// Environment variable mappings
const ENV_VAR_MAPPINGS: Record<keyof StoredCredentials, string[]> = {
  apiKey: ['GROK_API_KEY', 'XAI_API_KEY'],
  claudeApiKey: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  openaiApiKey: ['OPENAI_API_KEY'],
  geminiApiKey: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
};

// ============================================================================
// Encryption Utilities
// ============================================================================

/**
 * Generate a machine-specific encryption key
 * Uses hostname, username, and a static salt to create a deterministic key
 */
function getMachineKey(): Buffer {
  const machineId = [
    os.hostname(),
    os.userInfo().username,
    os.platform(),
    'codebuddy-credential-salt-v1',
  ].join(':');

  return crypto.createHash('sha256').update(machineId).digest();
}

/**
 * Encrypt data using AES-256-GCM
 */
function encrypt(data: string): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt data using AES-256-GCM
 */
function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const key = getMachineKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ============================================================================
// Credential Manager
// ============================================================================

export class CredentialManager extends EventEmitter {
  private static instance: CredentialManager;
  private config: CredentialConfig;
  private credentialsPath: string;
  private cachedCredentials: StoredCredentials | null = null;

  private constructor(config: Partial<CredentialConfig> = {}) {
    super();
    this.config = {
      encryptionEnabled: true,
      warnPlainText: true,
      ...config,
    };

    this.credentialsPath = config.credentialsPath || path.join(
      os.homedir(),
      '.codebuddy',
      'credentials.enc'
    );
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<CredentialConfig>): CredentialManager {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager(config);
    }
    return CredentialManager.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static resetInstance(): void {
    CredentialManager.instance = undefined as unknown as CredentialManager;
  }

  /**
   * Get a credential by key
   * Priority: environment variable > encrypted storage > plain text storage
   */
  public getCredential(key: keyof StoredCredentials): string | undefined {
    // 1. Try environment variables first (most secure)
    const envVars = ENV_VAR_MAPPINGS[key];
    if (envVars) {
      for (const envVar of envVars) {
        const value = process.env[envVar];
        if (value) {
          logger.debug(`Credential ${key} loaded from environment variable ${envVar}`);
          return value;
        }
      }
    }

    // 2. Try stored credentials
    const stored = this.loadCredentials();
    return stored[key];
  }

  /**
   * Set a credential
   * Stores encrypted if encryption is enabled
   */
  public setCredential(key: keyof StoredCredentials, value: string): void {
    const credentials = this.loadCredentials();
    credentials[key] = value;
    this.saveCredentials(credentials);

    this.emit('credential:set', { key });
    logger.info(`Credential ${key} saved securely`);
  }

  /**
   * Delete a credential
   */
  public deleteCredential(key: keyof StoredCredentials): void {
    const credentials = this.loadCredentials();
    delete credentials[key];
    this.saveCredentials(credentials);

    this.emit('credential:deleted', { key });
    logger.info(`Credential ${key} deleted`);
  }

  /**
   * Check if a credential exists (in env or storage)
   */
  public hasCredential(key: keyof StoredCredentials): boolean {
    return this.getCredential(key) !== undefined;
  }

  /**
   * List all available credential keys
   */
  public listCredentialKeys(): string[] {
    const stored = this.loadCredentials();
    const storedKeys = Object.keys(stored).filter(k => stored[k as keyof StoredCredentials]);

    // Also include environment-based credentials
    const envKeys: string[] = [];
    for (const [key, envVars] of Object.entries(ENV_VAR_MAPPINGS)) {
      for (const envVar of envVars) {
        if (process.env[envVar]) {
          envKeys.push(key);
          break;
        }
      }
    }

    return [...new Set([...storedKeys, ...envKeys])];
  }

  /**
   * Get the API key (convenience method)
   * Checks GROK_API_KEY, XAI_API_KEY, then stored credentials
   */
  public getApiKey(): string | undefined {
    return this.getCredential('apiKey');
  }

  /**
   * Set the API key (convenience method)
   */
  public setApiKey(apiKey: string): void {
    this.setCredential('apiKey', apiKey);
  }

  /**
   * Check if credentials are stored encrypted
   */
  public isEncryptionEnabled(): boolean {
    return this.config.encryptionEnabled;
  }

  /**
   * Get security status for display
   */
  public getSecurityStatus(): {
    encryptionEnabled: boolean;
    storagePath: string;
    credentialCount: number;
    envCredentialCount: number;
  } {
    const stored = this.loadCredentials();
    const storedCount = Object.keys(stored).filter(k => stored[k as keyof StoredCredentials]).length;

    let envCount = 0;
    for (const envVars of Object.values(ENV_VAR_MAPPINGS)) {
      for (const envVar of envVars) {
        if (process.env[envVar]) {
          envCount++;
          break;
        }
      }
    }

    return {
      encryptionEnabled: this.config.encryptionEnabled,
      storagePath: this.credentialsPath,
      credentialCount: storedCount,
      envCredentialCount: envCount,
    };
  }

  /**
   * Load credentials from storage
   */
  private loadCredentials(): StoredCredentials {
    if (this.cachedCredentials) {
      return { ...this.cachedCredentials };
    }

    try {
      if (!fs.existsSync(this.credentialsPath)) {
        return {};
      }

      const content = fs.readFileSync(this.credentialsPath, 'utf-8');

      if (this.config.encryptionEnabled) {
        try {
          const decrypted = decrypt(content);
          this.cachedCredentials = JSON.parse(decrypted);
          return { ...this.cachedCredentials };
        } catch {
          // File might be in plain text format (legacy)
          logger.warn('Credentials file appears to be in legacy plain-text format');
          if (this.config.warnPlainText) {
            logger.warn('Consider re-saving credentials to enable encryption');
          }
          this.cachedCredentials = JSON.parse(content);
          return { ...this.cachedCredentials };
        }
      } else {
        if (this.config.warnPlainText) {
          logger.warn('Credentials are stored in plain text. Consider enabling encryption.');
        }
        this.cachedCredentials = JSON.parse(content);
        return { ...this.cachedCredentials };
      }
    } catch (error) {
      logger.error('Failed to load credentials', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }

  /**
   * Save credentials to storage
   */
  private saveCredentials(credentials: StoredCredentials): void {
    try {
      // Ensure directory exists with secure permissions
      const dir = path.dirname(this.credentialsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      const content = JSON.stringify(credentials, null, 2);

      let dataToWrite: string;
      if (this.config.encryptionEnabled) {
        dataToWrite = encrypt(content);
      } else {
        if (this.config.warnPlainText) {
          logger.warn('Saving credentials in plain text. Consider enabling encryption.');
        }
        dataToWrite = content;
      }

      // Write with secure permissions (owner read/write only)
      fs.writeFileSync(this.credentialsPath, dataToWrite, { mode: 0o600 });

      // Update cache
      this.cachedCredentials = credentials;

      // Verify file permissions
      const stats = fs.statSync(this.credentialsPath);
      const mode = stats.mode & 0o777;
      if (mode !== 0o600) {
        logger.warn(`Credentials file has insecure permissions: ${mode.toString(8)}. Should be 600.`);
        // Try to fix permissions
        try {
          fs.chmodSync(this.credentialsPath, 0o600);
          logger.info('Fixed credentials file permissions to 600');
        } catch {
          logger.error('Failed to fix credentials file permissions');
        }
      }
    } catch (error) {
      logger.error('Failed to save credentials', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Clear cached credentials (useful after modifications)
   */
  public clearCache(): void {
    this.cachedCredentials = null;
  }

  /**
   * Migrate from legacy plain-text storage to encrypted
   */
  public migrateToEncrypted(): boolean {
    if (!this.config.encryptionEnabled) {
      logger.warn('Encryption is disabled in config');
      return false;
    }

    try {
      // Force reload without cache
      this.cachedCredentials = null;

      // Load current credentials
      const credentials = this.loadCredentials();
      if (Object.keys(credentials).length === 0) {
        logger.info('No credentials to migrate');
        return true;
      }

      // Clear cache and re-save with encryption
      this.cachedCredentials = null;
      this.saveCredentials(credentials);

      logger.info('Successfully migrated credentials to encrypted storage');
      return true;
    } catch (error) {
      logger.error('Failed to migrate credentials to encrypted storage', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the singleton credential manager instance
 */
export function getCredentialManager(config?: Partial<CredentialConfig>): CredentialManager {
  return CredentialManager.getInstance(config);
}

/**
 * Get the API key from environment or secure storage
 */
export function getApiKey(): string | undefined {
  return getCredentialManager().getApiKey();
}

/**
 * Set the API key in secure storage
 */
export function setApiKey(apiKey: string): void {
  getCredentialManager().setApiKey(apiKey);
}
