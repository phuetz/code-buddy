/**
 * Tests for Team Session Manager
 */

import { TeamSessionManager, getTeamSessionManager, resetTeamSessionManager } from '../src/collaboration/team-session';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  ensureDirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  pathExists: jest.fn().mockResolvedValue(false),
  readJSON: jest.fn(),
  readJSONSync: jest.fn(),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  remove: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
}));

// Mock ws
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    readyState: 1,
  }));
});

describe('TeamSessionManager', () => {
  let manager: TeamSessionManager;

  beforeEach(() => {
    resetTeamSessionManager();
    manager = new TeamSessionManager({
      enableEncryption: false,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const m = new TeamSessionManager();
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should accept custom config', () => {
      const m = new TeamSessionManager({
        autoReconnect: false,
        reconnectInterval: 10000,
      });
      expect(m).toBeDefined();
      m.dispose();
    });
  });

  describe('getCurrentSession', () => {
    it('should return null when no session', () => {
      expect(manager.getCurrentSession()).toBeNull();
    });
  });

  describe('getCurrentMember', () => {
    it('should return current member', () => {
      const member = manager.getCurrentMember();
      expect(member).toBeDefined();
      expect(member?.role).toBe('owner');
      expect(member?.status).toBe('online');
    });
  });

  describe('createSession', () => {
    it('should create a new session', async () => {
      const session = await manager.createSession('Test Session');

      expect(session).toBeDefined();
      expect(session.name).toBe('Test Session');
      expect(session.members).toHaveLength(1);
      expect(session.state.isActive).toBe(true);
    });

    it('should set current member as owner', async () => {
      const session = await manager.createSession('Test Session');

      expect(session.owner).toBe(manager.getCurrentMember()?.id);
    });

    it('should add to audit log', async () => {
      const session = await manager.createSession('Test Session');

      expect(session.auditLog.length).toBeGreaterThan(0);
      expect(session.auditLog[0].action).toBe('session_created');
    });

    it('should apply custom settings', async () => {
      const session = await manager.createSession('Test Session', {
        maxMembers: 5,
        allowAnonymous: true,
      });

      expect(session.settings.maxMembers).toBe(5);
      expect(session.settings.allowAnonymous).toBe(true);
    });
  });

  describe('leaveSession', () => {
    it('should leave current session', async () => {
      await manager.createSession('Test Session');
      await manager.leaveSession();

      expect(manager.getCurrentSession()).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('should return false when no session', () => {
      expect(manager.hasPermission('read')).toBe(false);
    });

    it('should return true for owner', async () => {
      await manager.createSession('Test Session');

      expect(manager.hasPermission('read')).toBe(true);
      expect(manager.hasPermission('write')).toBe(true);
      expect(manager.hasPermission('share')).toBe(true);
    });
  });

  describe('getAuditLog', () => {
    it('should return empty array when no session', () => {
      expect(manager.getAuditLog()).toEqual([]);
    });

    it('should return audit entries', async () => {
      await manager.createSession('Test Session');

      const log = manager.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
    });
  });

  describe('formatStatus', () => {
    it('should show no session message', () => {
      const status = manager.formatStatus();
      expect(status).toContain('No active session');
    });

    it('should show session info', async () => {
      await manager.createSession('My Session');

      const status = manager.formatStatus();
      expect(status).toContain('TEAM SESSION');
      expect(status).toContain('My Session');
      expect(status).toContain('Active');
    });
  });

  describe('exportSession', () => {
    it('should export as JSON', async () => {
      await manager.createSession('Test Session');
      const exported = await manager.exportSession('json');

      const data = JSON.parse(exported);
      expect(data.name).toBe('Test Session');
    });

    it('should export as markdown', async () => {
      await manager.createSession('Test Session');
      const exported = await manager.exportSession('markdown');

      expect(exported).toContain('# Session: Test Session');
    });

    it('should throw when no session', async () => {
      await expect(manager.exportSession()).rejects.toThrow('No active session');
    });
  });

  describe('events', () => {
    it('should emit session:created event', async () => {
      const handler = jest.fn();
      manager.on('session:created', handler);

      await manager.createSession('Test Session');

      expect(handler).toHaveBeenCalled();
    });

    it('should emit session:left event', async () => {
      const handler = jest.fn();
      manager.on('session:left', handler);

      await manager.createSession('Test Session');
      await manager.leaveSession();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetTeamSessionManager();
      const instance1 = getTeamSessionManager();
      const instance2 = getTeamSessionManager();
      expect(instance1).toBe(instance2);
    });
  });
});
