/**
 * API Key Management
 *
 * Handles API key generation, validation, and storage.
 */

import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { ApiKey, ApiScope } from '../types.js';
import { logger } from '../../utils/logger.js';

interface PersistedApiKeyStore {
  version: 1;
  updatedAt: string;
  keys: PersistedApiKey[];
}

type PersistedApiKey = Omit<ApiKey, 'createdAt' | 'lastUsedAt' | 'expiresAt'> & {
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
};

const apiKeys = new Map<string, ApiKey>();
let loadedStorePath: string | null = null;
let loadedStoreMtimeMs: number | null = null;

/**
 * Path to the local server API key store.
 */
export function getApiKeyStorePath(): string {
  return process.env.CODEBUDDY_API_KEYS_FILE
    || join(homedir(), '.codebuddy', 'server-api-keys.json');
}

function shouldPersistApiKeys(): boolean {
  if (process.env.CODEBUDDY_API_KEYS_PERSISTENCE === 'off') {
    return false;
  }

  // Avoid polluting the developer's real ~/.codebuddy during test runs unless
  // a test explicitly points the store at a temporary file.
  return process.env.NODE_ENV !== 'test' || Boolean(process.env.CODEBUDDY_API_KEYS_FILE);
}

function previewApiKey(key: string): string {
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

function serializeApiKey(apiKey: ApiKey): PersistedApiKey {
  return {
    ...apiKey,
    createdAt: apiKey.createdAt.toISOString(),
    lastUsedAt: apiKey.lastUsedAt?.toISOString(),
    expiresAt: apiKey.expiresAt?.toISOString(),
  };
}

function parseApiKey(raw: PersistedApiKey): ApiKey | null {
  if (!raw.id || !raw.keyHash || !raw.name || !raw.userId || !Array.isArray(raw.scopes)) {
    return null;
  }

  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    lastUsedAt: raw.lastUsedAt ? new Date(raw.lastUsedAt) : undefined,
    expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : undefined,
  };
}

function getStoreMtimeMs(storePath: string): number | null {
  try {
    return statSync(storePath).mtimeMs;
  } catch {
    return null;
  }
}

function ensureApiKeyStoreLoaded(): void {
  const storePath = shouldPersistApiKeys() ? getApiKeyStorePath() : null;
  const storeMtimeMs = storePath && existsSync(storePath) ? getStoreMtimeMs(storePath) : null;
  if (loadedStorePath === storePath && loadedStoreMtimeMs === storeMtimeMs) {
    return;
  }

  apiKeys.clear();
  loadedStorePath = storePath;
  loadedStoreMtimeMs = storeMtimeMs;

  if (!storePath || storeMtimeMs === null) {
    return;
  }

  try {
    const raw = readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedApiKeyStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.keys)) {
      logger.warn(`Ignoring malformed API key store: ${storePath}`);
      return;
    }

    for (const persisted of parsed.keys) {
      const apiKey = parseApiKey(persisted);
      if (apiKey) {
        apiKeys.set(apiKey.keyHash, apiKey);
      }
    }
  } catch (error) {
    logger.warn(`Could not load API key store: ${storePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function persistApiKeyStore(): void {
  if (!shouldPersistApiKeys()) {
    return;
  }

  const storePath = getApiKeyStorePath();
  const payload: PersistedApiKeyStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    keys: Array.from(apiKeys.values()).map(serializeApiKey),
  };
  const tempPath = `${storePath}.${process.pid}.tmp`;

  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  renameSync(tempPath, storePath);
  loadedStorePath = storePath;
  loadedStoreMtimeMs = getStoreMtimeMs(storePath);
}

/**
 * Reload persisted API keys from disk.
 */
export function reloadApiKeyStore(): void {
  loadedStorePath = null;
  ensureApiKeyStoreLoaded();
}

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
  persist?: boolean;
}): { key: string; apiKey: ApiKey } {
  ensureApiKeyStoreLoaded();

  const { key, keyHash } = generateApiKey();

  const apiKey: ApiKey = {
    id: randomBytes(8).toString('hex'),
    keyHash,
    keyPreview: previewApiKey(key),
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
  if (options.persist !== false) {
    persistApiKeyStore();
  }

  return { key, apiKey };
}

/**
 * Validate an API key
 */
export function validateApiKey(key: string): ApiKey | null {
  ensureApiKeyStoreLoaded();

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
  persistApiKeyStore();

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
  ensureApiKeyStoreLoaded();

  for (const [_hash, apiKey] of apiKeys.entries()) {
    if (apiKey.id === keyId) {
      apiKey.active = false;
      persistApiKeyStore();
      return true;
    }
  }
  return false;
}

/**
 * List API keys for a user
 */
export function listApiKeys(userId: string): Omit<ApiKey, 'keyHash'>[] {
  ensureApiKeyStoreLoaded();

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
 * List all API keys without exposing key hashes.
 */
export function listAllApiKeys(): Omit<ApiKey, 'keyHash'>[] {
  ensureApiKeyStoreLoaded();

  return Array.from(apiKeys.values()).map((apiKey) => {
    const { keyHash: _keyHash, ...rest } = apiKey;
    return rest;
  });
}

/**
 * Delete an API key
 */
export function deleteApiKey(keyId: string, userId: string): boolean {
  ensureApiKeyStoreLoaded();

  for (const [hash, apiKey] of apiKeys.entries()) {
    if (apiKey.id === keyId && apiKey.userId === userId) {
      apiKeys.delete(hash);
      persistApiKeyStore();
      return true;
    }
  }
  return false;
}

/**
 * Get API key by ID
 */
export function getApiKeyById(keyId: string): ApiKey | null {
  ensureApiKeyStoreLoaded();

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
  ensureApiKeyStoreLoaded();

  for (const apiKey of apiKeys.values()) {
    if (apiKey.id === keyId) {
      apiKey.scopes = scopes;
      persistApiKeyStore();
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
  ensureApiKeyStoreLoaded();

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
    persist: false,
  });
  logger.debug(`[DEV] Admin API Key: ${key}`);
}
