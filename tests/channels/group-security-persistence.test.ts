import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GroupSecurityManager } from '../../src/channels/group-security.js';

describe('group blocklist across CLI processes', () => {
  it('keeps block and unblock decisions after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'buddy-groups-'));
    const persistPath = join(dir, 'groups.json');
    try {
      new GroupSecurityManager({ persistPath }).addToBlocklist('fixture-user');
      const second = new GroupSecurityManager({ persistPath });
      expect(second.getStats().blocklistSize).toBe(1);
      expect(second.removeFromBlocklist('fixture-user')).toBe(true);
      expect(new GroupSecurityManager({ persistPath }).getStats().blocklistSize).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
