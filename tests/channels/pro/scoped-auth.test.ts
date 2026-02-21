import { ScopedAuthManager } from '../../../src/channels/pro/scoped-auth.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import os from 'os';

describe('ScopedAuthManager', () => {
  let manager: ScopedAuthManager;
  let tmpDir: string;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-01-15T12:00:00Z') });
    tmpDir = mkdtempSync(join(os.tmpdir(), 'scoped-auth-test-'));
    manager = new ScopedAuthManager(['admin1', 'admin2'], tmpDir);
  });

  afterEach(() => {
    jest.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isAdmin', () => {
    it('should return true for admin users', () => {
      expect(manager.isAdmin('admin1')).toBe(true);
      expect(manager.isAdmin('admin2')).toBe(true);
    });

    it('should return false for non-admin users', () => {
      expect(manager.isAdmin('user1')).toBe(false);
    });
  });

  describe('checkScope', () => {
    it('should always allow admin users', () => {
      const result = manager.checkScope('admin1', 'deploy');
      expect(result.allowed).toBe(true);
    });

    it('should deny users without permissions', () => {
      const result = manager.checkScope('unknown', 'read-only');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/No permissions/);
      expect(result.requiredScope).toBe('read-only');
    });

    it('should allow scope at the exact granted level', () => {
      manager.grantScope('user1', ['write-patch']);
      const result = manager.checkScope('user1', 'write-patch');
      expect(result.allowed).toBe(true);
    });

    it('should allow lower scopes via hierarchy (write-patch includes read-only)', () => {
      manager.grantScope('user1', ['write-patch']);
      const result = manager.checkScope('user1', 'read-only');
      expect(result.allowed).toBe(true);
    });

    it('should deny higher scopes than granted', () => {
      manager.grantScope('user1', ['read-only']);
      const result = manager.checkScope('user1', 'deploy');
      expect(result.allowed).toBe(false);
      expect(result.userScopes).toEqual(['read-only']);
    });

    it('should deny expired permissions', () => {
      manager.grantScope('user1', ['deploy'], { ttlMs: 5000 });
      jest.advanceTimersByTime(6000);
      const result = manager.checkScope('user1', 'read-only');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/expired/i);
    });

    it('should allow non-expired permissions', () => {
      manager.grantScope('user1', ['deploy'], { ttlMs: 10000 });
      jest.advanceTimersByTime(5000);
      const result = manager.checkScope('user1', 'read-only');
      expect(result.allowed).toBe(true);
    });
  });

  describe('denyCommands', () => {
    it('should deny exact command match', () => {
      manager.grantScope('user1', ['deploy'], { denyCommands: ['rm -rf /'] });
      const result = manager.checkScope('user1', 'deploy', { command: 'rm -rf /' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/denied/);
    });

    it('should deny commands matching glob pattern', () => {
      manager.grantScope('user1', ['deploy'], { denyCommands: ['sudo *'] });
      const result = manager.checkScope('user1', 'deploy', { command: 'sudo reboot' });
      expect(result.allowed).toBe(false);
    });

    it('should allow commands not in deny list', () => {
      manager.grantScope('user1', ['deploy'], { denyCommands: ['rm -rf /'] });
      const result = manager.checkScope('user1', 'deploy', { command: 'ls' });
      expect(result.allowed).toBe(true);
    });
  });

  describe('repos/folders glob matching', () => {
    it('should restrict to allowed repos', () => {
      manager.grantScope('user1', ['write-patch'], { repos: ['my-org/my-repo'] });
      expect(manager.checkScope('user1', 'read-only', { repo: 'my-org/my-repo' }).allowed).toBe(true);
      expect(manager.checkScope('user1', 'read-only', { repo: 'other/repo' }).allowed).toBe(false);
    });

    it('should support repo glob patterns', () => {
      manager.grantScope('user1', ['write-patch'], { repos: ['my-org/*'] });
      expect(manager.checkScope('user1', 'read-only', { repo: 'my-org/anything' }).allowed).toBe(true);
      expect(manager.checkScope('user1', 'read-only', { repo: 'other/repo' }).allowed).toBe(false);
    });

    it('should restrict to allowed folders', () => {
      manager.grantScope('user1', ['write-patch'], { folders: ['src/*'] });
      expect(manager.checkScope('user1', 'read-only', { folder: 'src/index.ts' }).allowed).toBe(true);
      expect(manager.checkScope('user1', 'read-only', { folder: 'dist/out.js' }).allowed).toBe(false);
    });
  });

  describe('grantScope / revokeScope', () => {
    it('should store and retrieve permissions', () => {
      manager.grantScope('user1', ['read-only', 'write-patch'], { grantedBy: 'admin1' });
      const perm = manager.getPermission('user1');
      expect(perm).toBeDefined();
      expect(perm!.scopes).toEqual(['read-only', 'write-patch']);
      expect(perm!.grantedBy).toBe('admin1');
    });

    it('should revoke permissions', () => {
      manager.grantScope('user1', ['read-only']);
      expect(manager.revokeScope('user1')).toBe(true);
      expect(manager.getPermission('user1')).toBeUndefined();
    });

    it('should return false when revoking non-existent user', () => {
      expect(manager.revokeScope('nobody')).toBe(false);
    });

    it('should list all permissions', () => {
      manager.grantScope('user1', ['read-only']);
      manager.grantScope('user2', ['deploy']);
      const perms = manager.listPermissions();
      expect(perms).toHaveLength(2);
    });
  });

  describe('temporaryFullAccess', () => {
    it('should grant temporary full access', () => {
      manager.grantTemporaryFullAccess('user1', 60000, 'admin1');
      const result = manager.checkScope('user1', 'deploy');
      expect(result.allowed).toBe(true);
    });

    it('should deny after temporary access expires', () => {
      manager.grantTemporaryFullAccess('user1', 5000);
      jest.advanceTimersByTime(6000);
      const result = manager.checkScope('user1', 'deploy');
      expect(result.allowed).toBe(false);
    });

    it('should revoke temporary access', () => {
      manager.grantTemporaryFullAccess('user1', 60000);
      expect(manager.revokeTemporaryAccess('user1')).toBe(true);
      const result = manager.checkScope('user1', 'deploy');
      expect(result.allowed).toBe(false);
    });
  });

  describe('secret handles', () => {
    it('should register and resolve a secret', () => {
      const originalEnv = process.env.TEST_SECRET_KEY;
      process.env.TEST_SECRET_KEY = 'super-secret-value';
      try {
        manager.registerSecret('my-api-key', 'TEST_SECRET_KEY', 'Test API key');
        expect(manager.resolveSecret('my-api-key')).toBe('super-secret-value');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TEST_SECRET_KEY;
        } else {
          process.env.TEST_SECRET_KEY = originalEnv;
        }
      }
    });

    it('should return undefined for unregistered handle', () => {
      expect(manager.resolveSecret('nonexistent')).toBeUndefined();
    });

    it('should never expose secret values in listHandles', () => {
      process.env.TEST_HANDLE_VAR = 'hidden';
      try {
        manager.registerSecret('handle1', 'TEST_HANDLE_VAR', 'A secret');
        const handles = manager.listHandles();
        expect(handles).toHaveLength(1);
        expect(handles[0].handle).toBe('handle1');
        expect(handles[0].hasValue).toBe(true);
        expect(handles[0].description).toBe('A secret');
        expect((handles[0] as any).envVar).toBeUndefined();
        expect((handles[0] as any).value).toBeUndefined();
      } finally {
        delete process.env.TEST_HANDLE_VAR;
      }
    });

    it('should report hasValue false when env var is unset', () => {
      delete process.env.NONEXISTENT_VAR_12345;
      manager.registerSecret('missing', 'NONEXISTENT_VAR_12345');
      const handles = manager.listHandles();
      expect(handles[0].hasValue).toBe(false);
    });

    it('should remove a secret handle', () => {
      manager.registerSecret('temp', 'SOME_VAR');
      expect(manager.removeSecret('temp')).toBe(true);
      expect(manager.resolveSecret('temp')).toBeUndefined();
      expect(manager.removeSecret('temp')).toBe(false);
    });
  });

  describe('doubleConfirm', () => {
    it('should create and verify a confirmation', () => {
      const confirm = manager.requireDoubleConfirm('user1', 'delete-repo', 'Deleting main repo');
      expect(confirm.id).toBeDefined();
      expect(confirm.userId).toBe('user1');
      expect(confirm.operation).toBe('delete-repo');

      const result = manager.verifyDoubleConfirm(confirm.id, 'user1');
      expect(result.valid).toBe(true);
    });

    it('should reject confirmation from wrong user', () => {
      const confirm = manager.requireDoubleConfirm('user1', 'deploy');
      const result = manager.verifyDoubleConfirm(confirm.id, 'user2');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/different user/);
    });

    it('should reject expired confirmation', () => {
      const confirm = manager.requireDoubleConfirm('user1', 'deploy');
      jest.advanceTimersByTime(130_000);
      const result = manager.verifyDoubleConfirm(confirm.id, 'user1');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/);
    });

    it('should reject unknown confirmation id', () => {
      const result = manager.verifyDoubleConfirm('bogus-id', 'user1');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not found/);
    });

    it('should consume confirmation after use', () => {
      const confirm = manager.requireDoubleConfirm('user1', 'deploy');
      manager.verifyDoubleConfirm(confirm.id, 'user1');
      const result = manager.verifyDoubleConfirm(confirm.id, 'user1');
      expect(result.valid).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired permissions', () => {
      manager.grantScope('user1', ['read-only'], { ttlMs: 5000 });
      manager.grantScope('user2', ['deploy']);
      jest.advanceTimersByTime(6000);
      manager.cleanup();
      expect(manager.getPermission('user1')).toBeUndefined();
      expect(manager.getPermission('user2')).toBeDefined();
    });

    it('should remove expired temporary access', () => {
      manager.grantTemporaryFullAccess('user1', 5000);
      jest.advanceTimersByTime(6000);
      manager.cleanup();
      expect(manager.revokeTemporaryAccess('user1')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should persist and reload permissions across instances', () => {
      manager.grantScope('user1', ['deploy'], { grantedBy: 'admin1' });
      manager.registerSecret('key1', 'SOME_VAR', 'A key');

      const manager2 = new ScopedAuthManager(['admin1'], tmpDir);
      expect(manager2.getPermission('user1')).toBeDefined();
      expect(manager2.getPermission('user1')!.scopes).toEqual(['deploy']);
      expect(manager2.listHandles()).toHaveLength(1);
    });
  });
});
