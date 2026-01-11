/**
 * Cloud Storage Abstraction
 *
 * Provides a unified interface for different cloud storage providers.
 */

import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readdir, stat, unlink, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import type {
  CloudConfig,
  CloudProvider,
  VersionInfo,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Storage Interface
// ============================================================================

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface ListOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListResult {
  objects: StorageObject[];
  truncated: boolean;
  continuationToken?: string;
}

// ============================================================================
// Base Cloud Storage Class
// ============================================================================

export abstract class CloudStorage {
  protected config: CloudConfig;
  protected encryptionKey?: Buffer;

  constructor(config: CloudConfig) {
    this.config = config;
    if (config.encryptionKey) {
      this.encryptionKey = this.deriveKey(config.encryptionKey);
    }
  }

  /**
   * Derive encryption key from passphrase
   */
  protected deriveKey(passphrase: string): Buffer {
    return createHash('sha256').update(passphrase).digest();
  }

  /**
   * Encrypt data
   */
  protected encrypt(data: Buffer): Buffer {
    if (!this.encryptionKey) return data;

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypt data
   */
  protected decrypt(data: Buffer): Buffer {
    if (!this.encryptionKey) return data;

    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /**
   * Generate checksum
   */
  protected checksum(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get full object key with prefix
   */
  protected getFullKey(key: string): string {
    if (this.config.prefix) {
      return `${this.config.prefix}/${key}`.replace(/\/+/g, '/');
    }
    return key;
  }

  // Abstract methods for cloud operations
  abstract upload(key: string, data: Buffer, metadata?: Record<string, string>): Promise<void>;
  abstract download(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
  abstract list(options?: ListOptions): Promise<ListResult>;
  abstract exists(key: string): Promise<boolean>;
  abstract getMetadata(key: string): Promise<StorageObject | null>;
}

// ============================================================================
// Local Storage Implementation (for testing/development)
// ============================================================================

export class LocalStorage extends CloudStorage {
  private basePath: string;

  constructor(config: CloudConfig) {
    super(config);
    this.basePath = config.endpoint || join(process.env.HOME || '', '.codebuddy', 'cloud');
  }

  private getLocalPath(key: string): string {
    return join(this.basePath, this.getFullKey(key));
  }

  async upload(key: string, data: Buffer, metadata?: Record<string, string>): Promise<void> {
    const path = this.getLocalPath(key);
    await mkdir(dirname(path), { recursive: true });

    let processedData = data;
    if (this.encryptionKey) {
      processedData = this.encrypt(data);
    }

    await writeFile(path, processedData);

    // Store metadata
    if (metadata) {
      await writeFile(`${path}.meta`, JSON.stringify(metadata));
    }
  }

  async download(key: string): Promise<Buffer> {
    const path = this.getLocalPath(key);
    const rawData = await readFile(path);
    let data: Buffer = Buffer.from(rawData);

    if (this.encryptionKey) {
      data = this.decrypt(data);
    }

    return data;
  }

  async delete(key: string): Promise<void> {
    const path = this.getLocalPath(key);
    try {
      await unlink(path);
      await unlink(`${path}.meta`).catch((err) => {
        // Meta file may not exist, log at trace level only
        logger.debug('Meta file cleanup failed (may not exist)', { path: `${path}.meta`, error: err instanceof Error ? err.message : String(err) });
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
      if (code !== 'ENOENT') throw error;
    }
  }

  async list(options: ListOptions = {}): Promise<ListResult> {
    const prefix = options.prefix ? this.getFullKey(options.prefix) : this.config.prefix || '';
    const basePath = join(this.basePath, prefix);

    const objects: StorageObject[] = [];

    try {
      await this.listRecursive(basePath, prefix, objects, options.maxKeys || 1000);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
      if (code !== 'ENOENT') throw error;
    }

    return {
      objects: objects.slice(0, options.maxKeys || 1000),
      truncated: objects.length > (options.maxKeys || 1000),
    };
  }

  private async listRecursive(
    dir: string,
    prefix: string,
    objects: StorageObject[],
    maxKeys: number
  ): Promise<void> {
    if (objects.length >= maxKeys) return;

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (objects.length >= maxKeys) break;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.listRecursive(fullPath, join(prefix, entry.name), objects, maxKeys);
      } else if (!entry.name.endsWith('.meta')) {
        const stats = await stat(fullPath);
        const key = join(prefix, entry.name).replace(new RegExp(`^${this.config.prefix || ''}/?`), '');
        objects.push({
          key,
          size: stats.size,
          lastModified: stats.mtime,
        });
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.getLocalPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<StorageObject | null> {
    const path = this.getLocalPath(key);
    try {
      const stats = await stat(path);
      let metadata: Record<string, string> = {};
      try {
        const metaContent = await readFile(`${path}.meta`, 'utf-8');
        metadata = JSON.parse(metaContent);
      } catch {
        // Metadata file doesn't exist or is invalid, use empty metadata
      }

      return {
        key,
        size: stats.size,
        lastModified: stats.mtime,
        metadata,
      };
    } catch {
      return null;
    }
  }
}

// ============================================================================
// S3-Compatible Storage Implementation
// ============================================================================

export class S3Storage extends CloudStorage {
  // Note: In production, this would use @aws-sdk/client-s3
  // For now, we provide a mock implementation

  async upload(key: string, data: Buffer, metadata?: Record<string, string>): Promise<void> {
    const fullKey = this.getFullKey(key);
    let processedData = data;

    if (this.encryptionKey) {
      processedData = this.encrypt(data);
    }

    // Mock S3 upload - in production, use S3 SDK
    console.log(`[S3] Uploading ${fullKey} (${processedData.length} bytes)`);

    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async download(key: string): Promise<Buffer> {
    const fullKey = this.getFullKey(key);

    // Mock S3 download - in production, use S3 SDK
    console.log(`[S3] Downloading ${fullKey}`);

    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Return empty buffer for mock
    return Buffer.alloc(0);
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    console.log(`[S3] Deleting ${fullKey}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  async list(options: ListOptions = {}): Promise<ListResult> {
    console.log(`[S3] Listing objects with prefix: ${options.prefix}`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      objects: [],
      truncated: false,
    };
  }

  async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    console.log(`[S3] Checking existence: ${fullKey}`);
    return false;
  }

  async getMetadata(key: string): Promise<StorageObject | null> {
    const fullKey = this.getFullKey(key);
    console.log(`[S3] Getting metadata: ${fullKey}`);
    return null;
  }
}

// ============================================================================
// Storage Factory
// ============================================================================

export function createCloudStorage(config: CloudConfig): CloudStorage {
  switch (config.provider) {
    case 'local':
      return new LocalStorage(config);
    case 's3':
      return new S3Storage(config);
    case 'gcs':
      // Would implement GCS storage
      throw new Error('GCS storage not yet implemented');
    case 'azure':
      // Would implement Azure Blob storage
      throw new Error('Azure Blob storage not yet implemented');
    default:
      throw new Error(`Unknown cloud provider: ${config.provider}`);
  }
}
