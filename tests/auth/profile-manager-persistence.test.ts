import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthProfileManager } from '../../src/auth/profile-manager.js';

describe('auth profiles across CLI processes', () => {
  it('restores added profiles and persists their removal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'buddy-auth-profile-'));
    const persistPath = join(dir, 'profiles.json');
    try {
      const first = new AuthProfileManager({ persistPath });
      first.addProfile({ id: 'local', provider: 'ollama', type: 'api-key', credentials: {}, priority: 0, metadata: {} });
      const second = new AuthProfileManager({ persistPath });
      expect(second.getProfile('local')?.provider).toBe('ollama');
      expect(second.removeProfile('local')).toBe(true);
      const third = new AuthProfileManager({ persistPath });
      expect(third.getProfile('local')).toBeUndefined();
      expect(JSON.parse(readFileSync(persistPath, 'utf8')).profiles).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
