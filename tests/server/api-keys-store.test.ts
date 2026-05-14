import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  createApiKey,
  getApiKeyStorePath,
  listAllApiKeys,
  reloadApiKeyStore,
  revokeApiKey,
  validateApiKey,
} from '../../src/server/auth/api-keys.js';

const previousApiKeysFile = process.env.CODEBUDDY_API_KEYS_FILE;
let tempDir: string;

describe('server API key store', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-api-keys-'));
    process.env.CODEBUDDY_API_KEYS_FILE = join(tempDir, 'server-api-keys.json');
    reloadApiKeyStore();
  });

  afterEach(() => {
    if (previousApiKeysFile === undefined) {
      delete process.env.CODEBUDDY_API_KEYS_FILE;
    } else {
      process.env.CODEBUDDY_API_KEYS_FILE = previousApiKeysFile;
    }
    reloadApiKeyStore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists generated keys without storing the raw secret', () => {
    const { key, apiKey } = createApiKey({
      name: 'Fleet listener',
      userId: 'peer-a',
      scopes: ['fleet:listen'],
    });

    expect(validateApiKey(key)?.id).toBe(apiKey.id);

    reloadApiKeyStore();

    const reloaded = validateApiKey(key);
    expect(reloaded?.id).toBe(apiKey.id);
    expect(reloaded?.scopes).toEqual(['fleet:listen']);

    const rawStore = readFileSync(getApiKeyStorePath(), 'utf8');
    expect(rawStore).not.toContain(key);
    expect(rawStore).toContain(apiKey.keyHash);
    expect(rawStore).toContain(apiKey.keyPreview);
  });

  it('lists public key metadata without hashes', () => {
    const { apiKey } = createApiKey({
      name: 'Peer invoke',
      userId: 'peer-b',
      scopes: ['fleet:listen', 'peer:invoke'],
    });

    const listed = listAllApiKeys();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: apiKey.id,
      name: 'Peer invoke',
      userId: 'peer-b',
      keyPreview: apiKey.keyPreview,
      scopes: ['fleet:listen', 'peer:invoke'],
    });
    expect(listed[0]).not.toHaveProperty('keyHash');
  });

  it('persists revocation across reloads', () => {
    const { key, apiKey } = createApiKey({
      name: 'Short-lived peer',
      userId: 'peer-c',
      scopes: ['fleet:listen'],
    });

    expect(revokeApiKey(apiKey.id)).toBe(true);
    reloadApiKeyStore();

    expect(validateApiKey(key)).toBeNull();
    expect(listAllApiKeys()[0].active).toBe(false);
  });
});
