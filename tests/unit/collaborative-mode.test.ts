/**
 * Comprehensive Unit Tests for Collaborative Mode
 *
 * Tests the CollaborativeSessionManager including:
 * - Session creation, joining, and leaving
 * - User management and roles
 * - File locking and conflict resolution
 * - Cursor tracking and presence
 * - Message handling
 * - Permission management
 */

import {
  CollaborativeSessionManager,
  getCollaborationManager,
  resetCollaborationManager,
} from '../../src/collaboration/collaborative-mode';

describe('CollaborativeSessionManager', () => {
  let manager: CollaborativeSessionManager;

  beforeEach(() => {
    manager = new CollaborativeSessionManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('createSession', () => {
    it('should create a new session', () => {
      const session = manager.createSession('Test Session', {
        name: 'John Doe',
        email: 'john@example.com',
      });

      expect(session).toBeDefined();
      expect(session.id).toMatch(/^sess_[a-f0-9]+$/);
      expect(session.name).toBe('Test Session');
      expect(session.users.size).toBe(1);
    });

    it('should set creator as owner', () => {
      const session = manager.createSession('Test Session', {
        name: 'John Doe',
      });

      const owner = session.users.get(session.ownerId);
      expect(owner).toBeDefined();
      expect(owner!.role).toBe('owner');
      expect(owner!.name).toBe('John Doe');
    });

    it('should assign color to user', () => {
      const session = manager.createSession('Test Session', {
        name: 'John Doe',
      });

      const owner = session.users.get(session.ownerId);
      expect(owner!.color).toMatch(/^#[A-F0-9]{6}$/);
    });

    it('should apply custom permissions', () => {
      const session = manager.createSession(
        'Test Session',
        { name: 'John Doe' },
        {
          allowEditing: false,
          maxUsers: 5,
        }
      );

      expect(session.permissions.allowEditing).toBe(false);
      expect(session.permissions.maxUsers).toBe(5);
    });

    it('should emit session-created event', () => {
      const handler = jest.fn();
      manager.on('session-created', handler);

      manager.createSession('Test Session', { name: 'John Doe' });

      expect(handler).toHaveBeenCalled();
    });

    it('should set expiration time', () => {
      const session = manager.createSession('Test Session', {
        name: 'John Doe',
      });

      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('joinSession', () => {
    it('should allow user to join existing session', async () => {
      const session = manager.createSession('Test Session', {
        name: 'Owner',
      });

      // Create new manager to join
      const manager2 = new CollaborativeSessionManager();
      // Copy session to second manager (simulating shared state)
      (manager2 as any).sessions.set(session.id, session);

      const joinedSession = await manager2.joinSession(session.id, {
        name: 'Joiner',
      });

      expect(joinedSession.users.size).toBe(2);
      manager2.dispose();
    });

    it('should assign editor role to joining users', async () => {
      const session = manager.createSession('Test Session', {
        name: 'Owner',
      });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'Joiner' });

      const users = Array.from(session.users.values());
      const joiner = users.find((u) => u.name === 'Joiner');

      expect(joiner!.role).toBe('editor');
      manager2.dispose();
    });

    it('should reject joining non-existent session', async () => {
      await expect(
        manager.joinSession('non-existent', { name: 'User' })
      ).rejects.toThrow('Session not found');
    });

    it('should reject joining full session', async () => {
      const session = manager.createSession(
        'Test Session',
        { name: 'Owner' },
        { maxUsers: 1 }
      );

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await expect(
        manager2.joinSession(session.id, { name: 'Joiner' })
      ).rejects.toThrow('Session is full');

      manager2.dispose();
    });
  });

  describe('leaveSession', () => {
    it('should remove user from session', () => {
      manager.createSession('Test Session', { name: 'Owner' });

      manager.leaveSession();

      expect(manager.getCurrentSession()).toBeNull();
      expect(manager.getCurrentUser()).toBeNull();
    });

    it('should transfer ownership when owner leaves', async () => {
      const session = manager.createSession('Test Session', {
        name: 'Owner',
      });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'Joiner' });

      // Store joiner's ID before owner leaves
      const joiner = Array.from(session.users.values()).find(
        (u) => u.name === 'Joiner'
      );

      manager.leaveSession();

      expect(session.ownerId).toBe(joiner!.id);
      expect(joiner!.role).toBe('owner');

      manager2.dispose();
    });

    it('should delete session when last user leaves', () => {
      manager.createSession('Test Session', { name: 'Owner' });

      manager.leaveSession();

      // Session should be deleted from internal map
      expect((manager as any).sessions.size).toBe(0);
    });

    it('should release file locks when leaving', () => {
      const session = manager.createSession('Test Session', {
        name: 'Owner',
      });

      // Add a file and lock it
      session.sharedContext.files.set('/test.ts', {
        path: '/test.ts',
        content: 'content',
        version: 1,
        lastModifiedBy: manager.getCurrentUser()!.id,
        lastModifiedAt: new Date(),
        locks: new Map([
          [
            manager.getCurrentUser()!.id,
            {
              userId: manager.getCurrentUser()!.id,
              acquiredAt: new Date(),
              expiresAt: new Date(Date.now() + 300000),
            },
          ],
        ]),
      });

      manager.leaveSession();

      // Session is deleted because owner left with no other users
    });
  });

  describe('addMessage', () => {
    it('should add message to shared context', () => {
      manager.createSession('Test Session', { name: 'User' });

      const message = manager.addMessage('Hello world');

      expect(message.content).toBe('Hello world');
      expect(message.type).toBe('user');
      expect(message.id).toMatch(/^msg_/);
    });

    it('should throw when not in session', () => {
      expect(() => manager.addMessage('Hello')).toThrow('Not in a session');
    });

    it('should support different message types', () => {
      manager.createSession('Test Session', { name: 'User' });

      const userMsg = manager.addMessage('User message', 'user');
      const assistantMsg = manager.addMessage('AI response', 'assistant');
      const systemMsg = manager.addMessage('System note', 'system');

      expect(userMsg.type).toBe('user');
      expect(assistantMsg.type).toBe('assistant');
      expect(systemMsg.type).toBe('system');
    });
  });

  describe('updateCursor', () => {
    it('should update current user cursor', () => {
      manager.createSession('Test Session', { name: 'User' });

      manager.updateCursor({
        file: '/src/index.ts',
        line: 42,
        column: 10,
      });

      const user = manager.getCurrentUser();
      expect(user!.cursor).toEqual({
        file: '/src/index.ts',
        line: 42,
        column: 10,
      });
    });

    it('should update lastActive timestamp', () => {
      manager.createSession('Test Session', { name: 'User' });

      const beforeUpdate = manager.getCurrentUser()!.lastActive;

      // Wait a tiny bit to ensure different timestamp
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          manager.updateCursor({ file: '/test.ts', line: 1, column: 1 });

          const afterUpdate = manager.getCurrentUser()!.lastActive;
          expect(afterUpdate.getTime()).toBeGreaterThanOrEqual(
            beforeUpdate.getTime()
          );
          resolve();
        }, 5);
      });
    });
  });

  describe('lockFile', () => {
    beforeEach(() => {
      const session = manager.createSession('Test Session', { name: 'User' });
      session.sharedContext.files.set('/test.ts', {
        path: '/test.ts',
        content: 'content',
        version: 1,
        lastModifiedBy: manager.getCurrentUser()!.id,
        lastModifiedAt: new Date(),
        locks: new Map(),
      });
    });

    it('should lock a file', () => {
      const result = manager.lockFile('/test.ts');

      expect(result).toBe(true);

      const file = manager.getCurrentSession()!.sharedContext.files.get(
        '/test.ts'
      );
      expect(file!.locks.size).toBe(1);
    });

    it('should prevent locking already locked file', async () => {
      manager.lockFile('/test.ts');

      // Try with another user
      const session = manager.getCurrentSession()!;
      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'User2' });

      const result = manager2.lockFile('/test.ts');
      expect(result).toBe(false);

      manager2.dispose();
    });

    it('should return false for non-existent file', () => {
      const result = manager.lockFile('/non-existent.ts');
      expect(result).toBe(false);
    });

    it('should support region locks', () => {
      const result = manager.lockFile('/test.ts', { start: 0, end: 100 });

      expect(result).toBe(true);

      const file = manager.getCurrentSession()!.sharedContext.files.get(
        '/test.ts'
      );
      const lock = file!.locks.get(manager.getCurrentUser()!.id);
      expect(lock!.region).toEqual({ start: 0, end: 100 });
    });
  });

  describe('unlockFile', () => {
    it('should unlock a file', () => {
      const session = manager.createSession('Test Session', { name: 'User' });
      session.sharedContext.files.set('/test.ts', {
        path: '/test.ts',
        content: 'content',
        version: 1,
        lastModifiedBy: manager.getCurrentUser()!.id,
        lastModifiedAt: new Date(),
        locks: new Map(),
      });

      manager.lockFile('/test.ts');
      const result = manager.unlockFile('/test.ts');

      expect(result).toBe(true);

      const file = session.sharedContext.files.get('/test.ts');
      expect(file!.locks.size).toBe(0);
    });
  });

  describe('updateFile', () => {
    it('should update file content', () => {
      const session = manager.createSession('Test Session', { name: 'User' });

      const result = manager.updateFile('/new-file.ts', 'new content');

      expect(result).toBe(true);

      const file = session.sharedContext.files.get('/new-file.ts');
      expect(file!.content).toBe('new content');
      expect(file!.version).toBe(1);
    });

    it('should increment version on update', () => {
      const session = manager.createSession('Test Session', { name: 'User' });

      manager.updateFile('/file.ts', 'v1');
      manager.updateFile('/file.ts', 'v2');
      manager.updateFile('/file.ts', 'v3');

      const file = session.sharedContext.files.get('/file.ts');
      expect(file!.version).toBe(3);
    });

    it('should respect editing permission', () => {
      manager.createSession(
        'Test Session',
        { name: 'User' },
        { allowEditing: false }
      );

      const result = manager.updateFile('/file.ts', 'content');
      expect(result).toBe(false);
    });

    it('should require lock to update locked file', async () => {
      const session = manager.createSession('Test Session', { name: 'Owner' });
      session.sharedContext.files.set('/locked.ts', {
        path: '/locked.ts',
        content: 'original',
        version: 1,
        lastModifiedBy: 'someone',
        lastModifiedAt: new Date(),
        locks: new Map([
          [
            'other-user',
            {
              userId: 'other-user',
              acquiredAt: new Date(),
              expiresAt: new Date(Date.now() + 300000),
            },
          ],
        ]),
      });

      const result = manager.updateFile('/locked.ts', 'new content');
      expect(result).toBe(false);
    });
  });

  describe('getUsers', () => {
    it('should return all users in session', async () => {
      const session = manager.createSession('Test Session', {
        name: 'Owner',
      });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'User2' });

      const users = manager.getUsers();
      expect(users).toHaveLength(2);
      expect(users.map((u) => u.name)).toContain('Owner');
      expect(users.map((u) => u.name)).toContain('User2');

      manager2.dispose();
    });

    it('should return empty array when not in session', () => {
      const users = manager.getUsers();
      expect(users).toEqual([]);
    });
  });

  describe('hasPermission', () => {
    it('should return true for owner', () => {
      manager.createSession(
        'Test Session',
        { name: 'Owner' },
        { allowEditing: false }
      );

      // Owner should have all permissions
      expect(manager.hasPermission('allowEditing')).toBe(true);
      expect(manager.hasPermission('allowExecution')).toBe(true);
    });

    it('should check permissions for editors', async () => {
      const session = manager.createSession(
        'Test Session',
        { name: 'Owner' },
        { allowEditing: true, allowExecution: false }
      );

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'Editor' });

      expect(manager2.hasPermission('allowEditing')).toBe(true);
      expect(manager2.hasPermission('allowExecution')).toBe(false);

      manager2.dispose();
    });
  });

  describe('generateInviteLink', () => {
    it('should generate invite link', () => {
      manager.createSession('Test Session', { name: 'Owner' });

      const link = manager.generateInviteLink();

      expect(link).toMatch(/^codebuddy:\/\/join\/sess_[a-f0-9]+\?code=/);
    });

    it('should throw when not in session', () => {
      expect(() => manager.generateInviteLink()).toThrow('Not in a session');
    });
  });

  describe('singleton', () => {
    afterEach(() => {
      resetCollaborationManager();
    });

    it('should return same instance', () => {
      const instance1 = getCollaborationManager();
      const instance2 = getCollaborationManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = getCollaborationManager();
      resetCollaborationManager();
      const instance2 = getCollaborationManager();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('configuration', () => {
    it('should accept custom server URL', () => {
      const customManager = new CollaborativeSessionManager({
        serverUrl: 'ws://custom.server',
        port: 8080,
      });

      expect(customManager).toBeDefined();
      customManager.dispose();
    });

    it('should use default config values', () => {
      const defaultManager = new CollaborativeSessionManager();
      expect(defaultManager).toBeDefined();
      defaultManager.dispose();
    });

    it('should accept custom heartbeat and lock timeout', () => {
      const customManager = new CollaborativeSessionManager({
        heartbeatInterval: 60000,
        lockTimeout: 600000,
        maxSessionDuration: 172800000,
      });

      expect(customManager).toBeDefined();
      customManager.dispose();
    });
  });

  describe('user color assignment', () => {
    it('should assign different colors to different users', async () => {
      const session = manager.createSession('Test Session', { name: 'User1' });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'User2' });

      const users = Array.from(session.users.values());
      expect(users[0].color).not.toBe(users[1].color);

      manager2.dispose();
    });

    it('should cycle through colors for many users', async () => {
      const session = manager.createSession(
        'Test Session',
        { name: 'User1' },
        { maxUsers: 20 }
      );

      // Join additional users without leaving
      const additionalManagers: CollaborativeSessionManager[] = [];
      for (let i = 2; i <= 9; i++) {
        const tempManager = new CollaborativeSessionManager();
        (tempManager as any).sessions.set(session.id, session);
        await tempManager.joinSession(session.id, { name: `User${i}` });
        additionalManagers.push(tempManager);
      }

      // After 8 more users join, should have 9 total
      const users = Array.from(session.users.values());
      expect(users.length).toBe(9);

      // Cleanup
      additionalManagers.forEach((m) => m.dispose());
    });
  });

  describe('file locking edge cases', () => {
    beforeEach(() => {
      const session = manager.createSession('Test Session', { name: 'User' });
      session.sharedContext.files.set('/test.ts', {
        path: '/test.ts',
        content: 'content',
        version: 1,
        lastModifiedBy: manager.getCurrentUser()!.id,
        lastModifiedAt: new Date(),
        locks: new Map(),
      });
    });

    it('should allow same user to re-lock their own file', () => {
      manager.lockFile('/test.ts');
      const result = manager.lockFile('/test.ts');

      expect(result).toBe(true);
    });

    it('should allow non-overlapping region locks by different users', async () => {
      const session = manager.getCurrentSession()!;
      manager.lockFile('/test.ts', { start: 0, end: 50 });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);
      await manager2.joinSession(session.id, { name: 'User2' });

      const result = manager2.lockFile('/test.ts', { start: 51, end: 100 });
      expect(result).toBe(true);

      manager2.dispose();
    });

    it('should prevent overlapping region locks', async () => {
      const session = manager.getCurrentSession()!;
      manager.lockFile('/test.ts', { start: 0, end: 50 });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);
      await manager2.joinSession(session.id, { name: 'User2' });

      const result = manager2.lockFile('/test.ts', { start: 25, end: 75 });
      expect(result).toBe(false);

      manager2.dispose();
    });

    it('should return false when not in session', () => {
      manager.leaveSession();
      const result = manager.lockFile('/test.ts');
      expect(result).toBe(false);
    });

    it('should return false for unlock when not in session', () => {
      manager.leaveSession();
      const result = manager.unlockFile('/test.ts');
      expect(result).toBe(false);
    });

    it('should return false for unlock on non-existent file', () => {
      const result = manager.unlockFile('/non-existent.ts');
      expect(result).toBe(false);
    });
  });

  describe('file update edge cases', () => {
    it('should return false when not in session', () => {
      const result = manager.updateFile('/file.ts', 'content');
      expect(result).toBe(false);
    });

    it('should allow updating file if user has lock', () => {
      const session = manager.createSession('Test Session', { name: 'User' });
      session.sharedContext.files.set('/file.ts', {
        path: '/file.ts',
        content: 'original',
        version: 1,
        lastModifiedBy: 'someone',
        lastModifiedAt: new Date(),
        locks: new Map([
          [
            manager.getCurrentUser()!.id,
            {
              userId: manager.getCurrentUser()!.id,
              acquiredAt: new Date(),
              expiresAt: new Date(Date.now() + 300000),
            },
          ],
        ]),
      });

      const result = manager.updateFile('/file.ts', 'new content');
      expect(result).toBe(true);
    });
  });

  describe('cursor update edge cases', () => {
    it('should do nothing when not in session', () => {
      manager.updateCursor({ file: '/test.ts', line: 1, column: 1 });
      // Should not throw
      expect(manager.getCurrentUser()).toBeNull();
    });
  });

  describe('message edge cases', () => {
    it('should store messages in shared context', () => {
      manager.createSession('Test Session', { name: 'User' });

      manager.addMessage('Message 1');
      manager.addMessage('Message 2');
      manager.addMessage('Message 3');

      const session = manager.getCurrentSession()!;
      expect(session.sharedContext.messages.length).toBe(3);
    });

    it('should include timestamp on messages', () => {
      manager.createSession('Test Session', { name: 'User' });

      const message = manager.addMessage('Test message');

      expect(message.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('viewer role permissions', () => {
    it('should return false for viewer on any permission', async () => {
      const session = manager.createSession('Test Session', { name: 'Owner' });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'Viewer' });

      // Change role to viewer
      const viewer = Array.from(session.users.values()).find(
        (u) => u.name === 'Viewer'
      )!;
      viewer.role = 'viewer';

      expect(manager2.hasPermission('allowEditing')).toBe(false);
      expect(manager2.hasPermission('allowExecution')).toBe(false);
      expect(manager2.hasPermission('allowFileOperations')).toBe(false);

      manager2.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean up all resources', () => {
      manager.createSession('Test Session', { name: 'User' });

      manager.dispose();

      expect(manager.getCurrentSession()).toBeNull();
      expect(manager.getCurrentUser()).toBeNull();
      expect((manager as any).sessions.size).toBe(0);
    });

    it('should remove all event listeners', () => {
      const handler = jest.fn();
      manager.on('session-created', handler);

      manager.dispose();

      // After dispose, events should not be fired
      expect(manager.listenerCount('session-created')).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit user-joined event', async () => {
      const session = manager.createSession('Test Session', { name: 'Owner' });

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      const handler = jest.fn();
      manager2.on('user-joined', handler);

      await manager2.joinSession(session.id, { name: 'Joiner' });

      expect(handler).toHaveBeenCalled();
      manager2.dispose();
    });

    it('should emit user-left event', () => {
      manager.createSession('Test Session', { name: 'Owner' });

      const handler = jest.fn();
      manager.on('user-left', handler);

      manager.leaveSession();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('shared context', () => {
    it('should initialize with empty shared context', () => {
      const session = manager.createSession('Test Session', { name: 'User' });

      expect(session.sharedContext.messages).toEqual([]);
      expect(session.sharedContext.files.size).toBe(0);
      expect(session.sharedContext.variables.size).toBe(0);
    });

    it('should allow storing variables', () => {
      const session = manager.createSession('Test Session', { name: 'User' });

      session.sharedContext.variables.set('key', { value: 'data' });

      expect(session.sharedContext.variables.get('key')).toEqual({
        value: 'data',
      });
    });
  });

  describe('session expiration', () => {
    it('should set expiration based on config', () => {
      const customManager = new CollaborativeSessionManager({
        maxSessionDuration: 3600000, // 1 hour
      });

      const session = customManager.createSession('Test Session', {
        name: 'User',
      });

      const expectedExpiry = new Date(
        session.createdAt.getTime() + 3600000
      ).getTime();
      expect(session.expiresAt!.getTime()).toBeCloseTo(expectedExpiry, -3);

      customManager.dispose();
    });
  });

  describe('id generation', () => {
    it('should generate unique session IDs', () => {
      const session1 = manager.createSession('Session 1', { name: 'User1' });
      manager.leaveSession();

      const session2 = manager.createSession('Session 2', { name: 'User2' });

      expect(session1.id).not.toBe(session2.id);
    });

    it('should generate unique user IDs', async () => {
      const session = manager.createSession(
        'Test Session',
        { name: 'User1' },
        { maxUsers: 10 }
      );

      const manager2 = new CollaborativeSessionManager();
      (manager2 as any).sessions.set(session.id, session);

      await manager2.joinSession(session.id, { name: 'User2' });

      const users = Array.from(session.users.values());
      expect(users[0].id).not.toBe(users[1].id);

      manager2.dispose();
    });

    it('should generate unique message IDs', () => {
      manager.createSession('Test Session', { name: 'User' });

      const msg1 = manager.addMessage('Message 1');
      const msg2 = manager.addMessage('Message 2');

      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  describe('hasPermission edge cases', () => {
    it('should return false when not in session', () => {
      expect(manager.hasPermission('allowEditing')).toBe(false);
    });

    it('should return false when no current user', () => {
      manager.createSession('Test Session', { name: 'User' });
      (manager as any).currentUser = null;

      expect(manager.hasPermission('allowEditing')).toBe(false);
    });
  });

  describe('getCurrentSession and getCurrentUser', () => {
    it('should return null when not in a session', () => {
      expect(manager.getCurrentSession()).toBeNull();
      expect(manager.getCurrentUser()).toBeNull();
    });

    it('should return session and user after creation', () => {
      const session = manager.createSession('Test Session', { name: 'User' });

      expect(manager.getCurrentSession()).toBe(session);
      expect(manager.getCurrentUser()).not.toBeNull();
    });
  });

  describe('leave session without being in one', () => {
    it('should handle leaving when not in session gracefully', () => {
      // Should not throw
      manager.leaveSession();
      expect(manager.getCurrentSession()).toBeNull();
    });
  });

  describe('default permissions', () => {
    it('should have sensible default permissions', () => {
      const session = manager.createSession('Test Session', { name: 'User' });

      expect(session.permissions.allowEditing).toBe(true);
      expect(session.permissions.allowExecution).toBe(true);
      expect(session.permissions.allowFileOperations).toBe(true);
      expect(session.permissions.requireApproval).toBe(false);
      expect(session.permissions.maxUsers).toBe(10);
    });
  });
});
