import { describe, expect, it } from 'vitest';
import { PermissionManager, type PermissionType } from '../../src/desktop-automation/permission-manager.js';

describe('PermissionManager', () => {
  it('emits permission-checked on both the initial check and a cache hit', async () => {
    const manager = new PermissionManager({ cacheDuration: 10000 });
    const permission = 'some-fake-perm' as PermissionType;
    let eventCount = 0;
    manager.on('permission-checked', () => { eventCount += 1; });

    await manager.check(permission);
    expect(eventCount).toBe(1);
    await manager.check(permission);
    expect(eventCount).toBe(2);
  });
});
