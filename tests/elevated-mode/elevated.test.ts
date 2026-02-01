/**
 * Elevated Mode Tests
 */

import {
  ElevatedModeManager,
  getElevatedMode,
  resetElevatedMode,
  compareLevels,
  meetsLevel,
  matchesPattern,
  permissionKey,
  type PermissionLevel,
  type Permission,
} from '../../src/elevated-mode/index.js';

describe('Permission Utilities', () => {
  describe('compareLevels', () => {
    it('should compare levels correctly', () => {
      expect(compareLevels('user', 'user')).toBe(0);
      expect(compareLevels('user', 'elevated')).toBeLessThan(0);
      expect(compareLevels('admin', 'user')).toBeGreaterThan(0);
      expect(compareLevels('system', 'admin')).toBeGreaterThan(0);
    });
  });

  describe('meetsLevel', () => {
    it('should check if level meets requirement', () => {
      expect(meetsLevel('user', 'user')).toBe(true);
      expect(meetsLevel('elevated', 'user')).toBe(true);
      expect(meetsLevel('user', 'elevated')).toBe(false);
      expect(meetsLevel('admin', 'elevated')).toBe(true);
    });
  });

  describe('matchesPattern', () => {
    it('should match exact strings', () => {
      expect(matchesPattern('/home/user/file.txt', '/home/user/file.txt')).toBe(true);
      expect(matchesPattern('/home/user/file.txt', '/home/user/other.txt')).toBe(false);
    });

    it('should match wildcards', () => {
      expect(matchesPattern('/home/user/file.txt', '/home/user/*')).toBe(true);
      expect(matchesPattern('/home/user/sub/file.txt', '/home/user/*')).toBe(true);
      expect(matchesPattern('/home/other/file.txt', '/home/user/*')).toBe(false);
    });

    it('should match single character', () => {
      expect(matchesPattern('/home/user/file1.txt', '/home/user/file?.txt')).toBe(true);
      expect(matchesPattern('/home/user/file10.txt', '/home/user/file?.txt')).toBe(false);
    });
  });

  describe('permissionKey', () => {
    it('should create permission key', () => {
      const permission: Permission = {
        category: 'file:read',
        resource: '/home/user',
        level: 'user',
      };

      expect(permissionKey(permission)).toBe('file:read:/home/user');
    });

    it('should handle missing resource', () => {
      const permission: Permission = {
        category: 'system:info',
        level: 'user',
      };

      expect(permissionKey(permission)).toBe('system:info:*');
    });
  });
});

describe('ElevatedModeManager', () => {
  let manager: ElevatedModeManager;

  beforeEach(() => {
    resetElevatedMode();
    manager = new ElevatedModeManager({
      defaultLevel: 'user',
      autoGrantSafe: true,
      requestTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    manager.resetSession();
    resetElevatedMode();
  });

  describe('Permission Checking', () => {
    it('should check level-based permissions', () => {
      const permission: Permission = {
        category: 'file:read',
        level: 'user',
      };

      expect(manager.hasPermission(permission)).toBe(true);
    });

    it('should deny insufficient level', () => {
      const permission: Permission = {
        category: 'system:modify',
        level: 'admin',
      };

      expect(manager.hasPermission(permission)).toBe(false);
    });

    it('should check granted permissions', async () => {
      const permission: Permission = {
        category: 'file:write',
        resource: '/test',
        level: 'elevated',
      };

      // Request and grant
      const requestPromise = manager.requestPermission('file:write', {
        resource: '/test',
        reason: 'Test',
        source: 'test',
      });

      // Get pending request
      await new Promise(resolve => setTimeout(resolve, 10));
      const session = manager.getSession();
      expect(session.pendingCount).toBe(1);

      // Grant the request
      const history = manager.getRequestHistory();
      const lastRequest = history[history.length - 1];
      manager.grantRequest(lastRequest.id);

      const grant = await requestPromise;
      expect(grant).not.toBeNull();
      expect(manager.hasPermission(permission)).toBe(true);
    });

    it('should identify safe permissions', () => {
      expect(manager.isSafePermission({ category: 'file:read', level: 'user' })).toBe(true);
      expect(manager.isSafePermission({ category: 'system:modify', level: 'admin' })).toBe(false);
    });

    it('should identify dangerous permissions', () => {
      expect(manager.isDangerousPermission({ category: 'system:modify', level: 'admin' })).toBe(true);
      expect(manager.isDangerousPermission({ category: 'file:read', level: 'user' })).toBe(false);
    });
  });

  describe('Permission Requests', () => {
    it('should auto-grant safe permissions', async () => {
      const grant = await manager.requestPermission('file:read', {
        resource: '/safe/file',
        source: 'test',
      });

      expect(grant).not.toBeNull();
      expect(grant?.type).toBe('allow-session');
    });

    it('should require manual grant for elevated permissions', async () => {
      const requestPromise = manager.requestPermission('file:write', {
        resource: '/test',
        source: 'test',
      });

      // Wait for request to be created
      await new Promise(resolve => setTimeout(resolve, 10));

      // Get and grant
      const history = manager.getRequestHistory();
      const lastRequest = history[history.length - 1];
      manager.grantRequest(lastRequest.id, 'allow-once');

      const grant = await requestPromise;
      expect(grant).not.toBeNull();
      expect(grant?.type).toBe('allow-once');
    });

    it('should timeout pending requests', async () => {
      manager = new ElevatedModeManager({
        requestTimeoutMs: 50,
        autoGrantSafe: false,
        safeCategories: [], // No safe categories to prevent auto-grant
      });

      const grant = await manager.requestPermission('file:write', {
        resource: '/protected',
        source: 'test',
      });

      expect(grant).toBeNull();
    });

    it('should deny requests', async () => {
      const events: string[] = [];
      manager.on('permission-deny', () => events.push('deny'));

      const requestPromise = manager.requestPermission('file:write', {
        resource: '/test',
        source: 'test',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const history = manager.getRequestHistory();
      const lastRequest = history[history.length - 1];
      manager.denyRequest(lastRequest.id, 'Test denial');

      const grant = await requestPromise;
      expect(grant).toBeNull();
      expect(events).toContain('deny');
    });

    it('should emit permission-request event', async () => {
      const events: string[] = [];
      manager.on('permission-request', () => events.push('request'));

      const requestPromise = manager.requestPermission('file:write', {
        source: 'test',
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(events).toContain('request');

      // Clean up
      const history = manager.getRequestHistory();
      manager.denyRequest(history[history.length - 1].id);
      await requestPromise;
    });
  });

  describe('Level Management', () => {
    it('should get current level', () => {
      expect(manager.getLevel()).toBe('user');
    });

    it('should elevate level', () => {
      const events: string[] = [];
      manager.on('level-change', (from, to) => events.push(`${from}->${to}`));

      const result = manager.elevate('elevated');

      expect(result).toBe(true);
      expect(manager.getLevel()).toBe('elevated');
      expect(events).toContain('user->elevated');
    });

    it('should not elevate to lower level', () => {
      manager.elevate('admin');

      const result = manager.elevate('elevated');

      expect(result).toBe(false);
      expect(manager.getLevel()).toBe('admin');
    });

    it('should track elevation time', () => {
      manager.elevate('elevated', 1000);

      expect(manager.isElevated()).toBe(true);
      expect(manager.getElevationTimeRemaining()).toBeGreaterThan(0);
      expect(manager.getElevationTimeRemaining()).toBeLessThanOrEqual(1000);
    });

    it('should drop elevation', () => {
      manager.elevate('elevated');
      manager.dropElevation();

      expect(manager.getLevel()).toBe('user');
      expect(manager.isElevated()).toBe(false);
    });

    it('should expire elevation', async () => {
      manager.elevate('elevated', 50);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(manager.getLevel()).toBe('user');
    });
  });

  describe('Grant Management', () => {
    it('should list grants', async () => {
      await manager.requestPermission('file:read', { source: 'test' });

      const grants = manager.getGrants();
      expect(grants.length).toBeGreaterThan(0);
    });

    it('should revoke grant', async () => {
      const grant = await manager.requestPermission('file:read', { source: 'test' });

      expect(manager.revokeGrant(grant!.id)).toBe(true);
      expect(manager.getGrants().length).toBe(0);
    });

    it('should revoke category', async () => {
      await manager.requestPermission('file:read', { resource: '/a', source: 'test' });
      await manager.requestPermission('file:read', { resource: '/b', source: 'test' });
      await manager.requestPermission('system:info', { source: 'test' });

      const count = manager.revokeCategory('file:read');

      expect(count).toBe(2);
      expect(manager.getGrants().length).toBe(1);
    });

    it('should clear all grants', async () => {
      await manager.requestPermission('file:read', { source: 'test' });
      await manager.requestPermission('system:info', { source: 'test' });

      manager.clearGrants();

      expect(manager.getGrants().length).toBe(0);
    });

    it('should emit grant-expire event', async () => {
      const events: string[] = [];
      manager.on('grant-expire', () => events.push('expire'));

      const grant = await manager.requestPermission('file:read', { source: 'test' });
      manager.revokeGrant(grant!.id);

      expect(events).toContain('expire');
    });
  });

  describe('Session Management', () => {
    it('should get session info', () => {
      const session = manager.getSession();

      expect(session.id).toBeDefined();
      expect(session.level).toBe('user');
      expect(session.grantCount).toBe(0);
    });

    it('should get request history', async () => {
      // Use a non-safe permission to ensure it goes through request flow
      const requestPromise = manager.requestPermission('file:write', {
        resource: '/test',
        source: 'test',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const history = manager.getRequestHistory();
      expect(history.length).toBe(1);

      // Clean up
      manager.denyRequest(history[0].id);
      await requestPromise;
    });

    it('should reset session', async () => {
      manager.elevate('elevated');
      await manager.requestPermission('file:read', { source: 'test' });

      const events: string[] = [];
      manager.on('session-expire', () => events.push('expire'));

      manager.resetSession();

      expect(manager.getLevel()).toBe('user');
      expect(manager.getGrants().length).toBe(0);
      expect(events).toContain('expire');
    });
  });

  describe('Configuration', () => {
    it('should get configuration', () => {
      const config = manager.getConfig();

      expect(config.defaultLevel).toBe('user');
      expect(config.autoGrantSafe).toBe(true);
    });

    it('should update configuration', () => {
      manager.updateConfig({ autoGrantSafe: false });

      expect(manager.getConfig().autoGrantSafe).toBe(false);
    });
  });

  describe('Grant Limits', () => {
    it('should enforce max grants per session', async () => {
      manager = new ElevatedModeManager({
        maxGrantsPerSession: 3,
        autoGrantSafe: true,
      });

      for (let i = 0; i < 5; i++) {
        await manager.requestPermission('file:read', {
          resource: `/file${i}`,
          source: 'test',
        });
      }

      expect(manager.getGrants().length).toBeLessThanOrEqual(3);
    });
  });
});

describe('Singleton', () => {
  beforeEach(() => {
    resetElevatedMode();
  });

  afterEach(() => {
    resetElevatedMode();
  });

  it('should return same instance', () => {
    const manager1 = getElevatedMode();
    const manager2 = getElevatedMode();

    expect(manager1).toBe(manager2);
  });

  it('should reset instance', () => {
    const manager1 = getElevatedMode();
    resetElevatedMode();
    const manager2 = getElevatedMode();

    expect(manager1).not.toBe(manager2);
  });
});
