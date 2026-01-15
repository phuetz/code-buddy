/**
 * API Key Management
 *
 * Handles API key generation, validation, and storage.
 */

import { createHash, randomBytes } from 'crypto';
import type { ApiKey, ApiScope } from '../types.js';
import { logger } from '../../utils/logger.js';

// In-memory store (should be replaced with database in production)
const apiKeys = new Map<string, ApiKey>();

/**
 * Generate a new API key
 */
export function generateApiKey(): { key: string; keyHash: string } {
  // Generate a random key: cb_sk_<32 random hex chars>
  const randomPart = randomBytes(16).toString('hex');
  const key = `cb_sk_${randomPart}`;

  // Hash the key for storage
  const keyHash = hashApiKey(key);

  return { key, keyHash };
}

/**
 * Hash an API key for secure storage
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Create and store a new API key
 */
export function createApiKey(options: {
  name: string;
  userId: string;
  scopes?: ApiScope[];
  rateLimit?: number;
  expiresIn?: number; // ms
}): { key: string; apiKey: ApiKey } {
  const { key, keyHash } = generateApiKey();

  const apiKey: ApiKey = {
    id: randomBytes(8).toString('hex'),
    keyHash,
    name: options.name,
    userId: options.userId,
    scopes: options.scopes || ['chat', 'chat:stream', 'tools', 'sessions'],
    rateLimit: options.rateLimit,
    createdAt: new Date(),
    expiresAt: options.expiresIn
      ? new Date(Date.now() + options.expiresIn)
      : undefined,
    active: true,
  };

  apiKeys.set(keyHash, apiKey);

  return { key, apiKey };
}

/**
 * Validate an API key
 */
export function validateApiKey(key: string): ApiKey | null {
  const keyHash = hashApiKey(key);
  const apiKey = apiKeys.get(keyHash);

  if (!apiKey) {
    return null;
  }

  // Check if key is active
  if (!apiKey.active) {
    return null;
  }

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  // Update last used
  apiKey.lastUsedAt = new Date();

  return apiKey;
}

/**
 * Check if API key has required scope
 */
export function hasScope(apiKey: ApiKey, scope: ApiScope): boolean {
  // Admin scope has access to everything
  if (apiKey.scopes.includes('admin')) {
    return true;
  }

  return apiKey.scopes.includes(scope);
}

/**
 * Check if API key has any of the required scopes
 */
export function hasAnyScope(apiKey: ApiKey, scopes: ApiScope[]): boolean {
  return scopes.some((scope) => hasScope(apiKey, scope));
}

/**
 * Revoke an API key
 */
export function revokeApiKey(keyId: string): boolean {
  for (const [_hash, apiKey] of apiKeys.entries()) {
    if (apiKey.id === keyId) {
      apiKey.active = false;
      return true;
    }
  }
  return false;
}

/**
 * List API keys for a user
 */
export function listApiKeys(userId: string): Omit<ApiKey, 'keyHash'>[] {
  const keys: Omit<ApiKey, 'keyHash'>[] = [];

  for (const apiKey of apiKeys.values()) {
    if (apiKey.userId === userId) {
      const { keyHash: _keyHash, ...rest } = apiKey;
      keys.push(rest);
    }
  }

  return keys;
}

/**
 * Delete an API key
 */
export function deleteApiKey(keyId: string, userId: string): boolean {
  for (const [hash, apiKey] of apiKeys.entries()) {
    if (apiKey.id === keyId && apiKey.userId === userId) {
      apiKeys.delete(hash);
      return true;
    }
  }
  return false;
}

/**
 * Get API key by ID
 */
export function getApiKeyById(keyId: string): ApiKey | null {
  for (const apiKey of apiKeys.values()) {
    if (apiKey.id === keyId) {
      return apiKey;
    }
  }
  return null;
}

/**
 * Update API key scopes
 */
export function updateApiKeyScopes(keyId: string, scopes: ApiScope[]): boolean {
  for (const apiKey of apiKeys.values()) {
    if (apiKey.id === keyId) {
      apiKey.scopes = scopes;
      return true;
    }
  }
  return false;
}

/**
 * Get stats about API keys
 */
export function getApiKeyStats(): {
  total: number;
  active: number;
  expired: number;
} {
  let total = 0;
  let active = 0;
  let expired = 0;

  const now = new Date();

  for (const apiKey of apiKeys.values()) {
    total++;
    if (apiKey.active && (!apiKey.expiresAt || apiKey.expiresAt > now)) {
      active++;
    }
    if (apiKey.expiresAt && apiKey.expiresAt <= now) {
      expired++;
    }
  }

  return { total, active, expired };
}

// Initialize with a default admin key for development
if (process.env.NODE_ENV === 'development') {
  const { key } = createApiKey({
    name: 'Development Admin Key',
    userId: 'dev-admin',
    scopes: ['admin'],
  });
  logger.debug(`[DEV] Admin API Key: ${key}`);
}
