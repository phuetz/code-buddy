/**
 * Comprehensive Unit Tests for Team Session Manager
 *
 * Tests all functionality of the TeamSessionManager including:
 * - Session creation, joining, and leaving
 * - Member management and permissions
 * - File sharing and annotations
 * - Change approval workflow
 * - WebSocket communication
 * - Encryption/Decryption
 * - Cursor tracking
 * - Audit logging
 */

import {
  TeamSessionManager,
  getTeamSessionManager,
  resetTeamSessionManager,
  TeamMember,
} from '../../src/collaboration/team-session';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  ensureDirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  pathExists: jest.fn().mockResolvedValue(false),
  readJSON: jest.fn().mockResolvedValue({}),
  readJSONSync: jest.fn().mockReturnValue({}),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(''),
  remove: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
}));

// Mock WebSocket
const mockWsInstance = {
  on: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  ping: jest.fn(),
  readyState: 1,
};

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => mockWsInstance);
});

describe('TeamSessionManager', () => {
  let manager: TeamSessionManager;

  beforeEach(() => {
    jest.clearAllMocks();
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
        heartbeatInterval: 60000,
        maxReconnectAttempts: 5,
      });
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should accept encryption config', () => {
      const m = new TeamSessionManager({
        enableEncryption: true,
        encryptionKey: 'test-secret-key',
      });
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should accept server URL config', () => {
      const m = new TeamSessionManager({
        serverUrl: 'ws://localhost:9876',
      });
      expect(m).toBeDefined();
      m.dispose();
    });
  });

  describe('getCurrentSession', () => {
    it('should return null when no session', () => {
      expect(manager.getCurrentSession()).toBeNull();
    });

    it('should return session after creation', async () => {
      await manager.createSession('Test Session');
      expect(manager.getCurrentSession()).not.toBeNull();
    });
  });

  describe('getCurrentMember', () => {
    it('should return current member', () => {
      const member = manager.getCurrentMember();
      expect(member).toBeDefined();
      expect(member?.role).toBe('owner');
      expect(member?.status).toBe('online');
    });

    it('should have an ID', () => {
      const member = manager.getCurrentMember();
      expect(member?.id).toBeDefined();
      expect(member?.id.length).toBeGreaterThan(0);
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
        allowFileEdits: false,
      });

      expect(session.settings.maxMembers).toBe(5);
      expect(session.settings.allowAnonymous).toBe(true);
      expect(session.settings.allowFileEdits).toBe(false);
    });

    it('should apply default settings', async () => {
      const session = await manager.createSession('Test Session');

      expect(session.settings.requireApproval).toBe(true);
      expect(session.settings.maxMembers).toBe(10);
      expect(session.settings.allowTerminalAccess).toBe(false);
    });

    it('should emit session:created event', async () => {
      const handler = jest.fn();
      manager.on('session:created', handler);

      await manager.createSession('Test Session');

      expect(handler).toHaveBeenCalled();
    });

    it('should initialize with empty shared context', async () => {
      const session = await manager.createSession('Test Session');

      expect(session.state.sharedContext.conversationHistory).toEqual([]);
      expect(session.state.sharedContext.sharedFiles).toEqual([]);
      expect(session.state.sharedContext.pinnedMessages).toEqual([]);
      expect(session.state.sharedContext.annotations).toEqual([]);
    });

    it('should initialize cursor positions map', async () => {
      const session = await manager.createSession('Test Session');

      expect(session.state.cursorPositions).toBeInstanceOf(Map);
      expect(session.state.cursorPositions.size).toBe(0);
    });
  });

  describe('leaveSession', () => {
    it('should leave current session', async () => {
      await manager.createSession('Test Session');
      await manager.leaveSession();

      expect(manager.getCurrentSession()).toBeNull();
    });

    it('should do nothing if not in session', async () => {
      await manager.leaveSession();
      expect(manager.getCurrentSession()).toBeNull();
    });

    it('should emit session:left event', async () => {
      const handler = jest.fn();
      manager.on('session:left', handler);

      await manager.createSession('Test Session');
      await manager.leaveSession();

      expect(handler).toHaveBeenCalled();
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
      expect(manager.hasPermission('execute')).toBe(true);
      expect(manager.hasPermission('delete')).toBe(true);
      expect(manager.hasPermission('share')).toBe(true);
    });

    it('should check role-based permissions for editor', async () => {
      await manager.createSession('Test Session');
      const member = manager.getCurrentMember()!;
      member.role = 'editor';

      expect(manager.hasPermission('read')).toBe(true);
      expect(manager.hasPermission('write')).toBe(true);
      expect(manager.hasPermission('execute')).toBe(true);
      expect(manager.hasPermission('delete')).toBe(false);
      expect(manager.hasPermission('share')).toBe(false);
    });

    it('should limit viewer permissions', async () => {
      await manager.createSession('Test Session');
      const member = manager.getCurrentMember()!;
      member.role = 'viewer';

      expect(manager.hasPermission('read')).toBe(true);
      expect(manager.hasPermission('write')).toBe(false);
      expect(manager.hasPermission('execute')).toBe(false);
      expect(manager.hasPermission('delete')).toBe(false);
      expect(manager.hasPermission('share')).toBe(false);
    });

    it('should return true for admin', async () => {
      await manager.createSession('Test Session');
      const member = manager.getCurrentMember()!;
      member.role = 'admin';

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

    it('should include timestamps', async () => {
      await manager.createSession('Test Session');

      const log = manager.getAuditLog();
      expect(log[0].timestamp).toBeDefined();
    });

    it('should include member info', async () => {
      await manager.createSession('Test Session');

      const log = manager.getAuditLog();
      expect(log[0].memberId).toBeDefined();
      expect(log[0].memberName).toBeDefined();
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

    it('should show member count info', async () => {
      await manager.createSession('Test Session');

      const status = manager.formatStatus();
      expect(status).toContain('MEMBERS');
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
      expect(exported).toContain('## Conversation');
      expect(exported).toContain('## Shared Files');
    });

    it('should throw when no session', async () => {
      await expect(manager.exportSession()).rejects.toThrow('No active session');
    });

    it('should default to JSON format', async () => {
      await manager.createSession('Test Session');
      const exported = await manager.exportSession();

      expect(() => JSON.parse(exported)).not.toThrow();
    });
  });

  describe('shareMessage', () => {
    it('should add message to shared context', async () => {
      const session = await manager.createSession('Test Session');

      await manager.shareMessage('Hello world');

      expect(session.state.sharedContext.conversationHistory.length).toBe(1);
      expect(session.state.sharedContext.conversationHistory[0].content).toBe(
        'Hello world'
      );
    });

    it('should throw when not in session', async () => {
      await expect(manager.shareMessage('Hello')).rejects.toThrow(
        'No active session'
      );
    });

    it('should support different message types', async () => {
      const session = await manager.createSession('Test Session');

      await manager.shareMessage('User message', 'user');
      await manager.shareMessage('AI response', 'assistant');

      const messages = session.state.sharedContext.conversationHistory;
      expect(messages[0].type).toBe('user');
      expect(messages[1].type).toBe('assistant');
    });

    it('should emit message:shared event', async () => {
      await manager.createSession('Test Session');

      const handler = jest.fn();
      manager.on('message:shared', handler);

      await manager.shareMessage('Test');

      expect(handler).toHaveBeenCalled();
    });

    it('should include member info in message', async () => {
      const session = await manager.createSession('Test Session');

      await manager.shareMessage('Hello');

      const message = session.state.sharedContext.conversationHistory[0];
      expect(message.memberId).toBe(manager.getCurrentMember()?.id);
      expect(message.memberName).toBeDefined();
    });
  });

  describe('shareFile', () => {
    it('should add file to shared files', async () => {
      const session = await manager.createSession('Test Session');

      await manager.shareFile('/path/to/file.ts');

      expect(session.state.sharedContext.sharedFiles).toContain(
        '/path/to/file.ts'
      );
    });

    it('should not duplicate shared files', async () => {
      const session = await manager.createSession('Test Session');

      await manager.shareFile('/path/to/file.ts');
      await manager.shareFile('/path/to/file.ts');

      expect(
        session.state.sharedContext.sharedFiles.filter(
          (f) => f === '/path/to/file.ts'
        ).length
      ).toBe(1);
    });

    it('should emit file:shared event', async () => {
      await manager.createSession('Test Session');

      const handler = jest.fn();
      manager.on('file:shared', handler);

      await manager.shareFile('/path/to/file.ts');

      expect(handler).toHaveBeenCalled();
    });

    it('should throw when not in session', async () => {
      await expect(manager.shareFile('/path/to/file.ts')).rejects.toThrow(
        'No active session'
      );
    });

    it('should add to audit log', async () => {
      const session = await manager.createSession('Test Session');
      const initialLogLength = session.auditLog.length;

      await manager.shareFile('/path/to/file.ts');

      expect(session.auditLog.length).toBeGreaterThan(initialLogLength);
      expect(session.auditLog[session.auditLog.length - 1].action).toBe(
        'file_shared'
      );
    });
  });

  describe('addAnnotation', () => {
    it('should add annotation to shared context', async () => {
      await manager.createSession('Test Session');

      const annotation = await manager.addAnnotation(
        '/path/to/file.ts',
        42,
        'This needs refactoring'
      );

      expect(annotation.file).toBe('/path/to/file.ts');
      expect(annotation.line).toBe(42);
      expect(annotation.content).toBe('This needs refactoring');
      expect(annotation.resolved).toBe(false);
    });

    it('should throw when not in session', async () => {
      await expect(
        manager.addAnnotation('/file.ts', 1, 'Comment')
      ).rejects.toThrow('No active session');
    });

    it('should emit annotation:added event', async () => {
      await manager.createSession('Test Session');

      const handler = jest.fn();
      manager.on('annotation:added', handler);

      await manager.addAnnotation('/file.ts', 1, 'Comment');

      expect(handler).toHaveBeenCalled();
    });

    it('should include member ID', async () => {
      await manager.createSession('Test Session');

      const annotation = await manager.addAnnotation('/file.ts', 1, 'Comment');

      expect(annotation.memberId).toBe(manager.getCurrentMember()?.id);
    });
  });

  describe('updateCursorPosition', () => {
    it('should update cursor position', async () => {
      const session = await manager.createSession('Test Session');

      manager.updateCursorPosition('/file.ts', 42, 10);

      const cursor = session.state.cursorPositions.get(
        manager.getCurrentMember()!.id
      );
      expect(cursor).toBeDefined();
      expect(cursor?.file).toBe('/file.ts');
      expect(cursor?.line).toBe(42);
      expect(cursor?.column).toBe(10);
    });

    it('should do nothing when not in session', () => {
      manager.updateCursorPosition('/file.ts', 1, 1);
      // Should not throw
      expect(manager.getCurrentSession()).toBeNull();
    });
  });

  describe('submitChange', () => {
    it('should submit change for approval', async () => {
      await manager.createSession('Test Session');
      const member = manager.getCurrentMember()!;
      member.role = 'viewer'; // Viewer needs approval

      const change = await manager.submitChange(
        'file_edit',
        '/file.ts',
        'new content'
      );

      expect(change.type).toBe('file_edit');
      expect(change.target).toBe('/file.ts');
      expect(change.content).toBe('new content');
      expect(change.status).toBe('pending');
    });

    it('should auto-approve for users with write permission', async () => {
      await manager.createSession('Test Session');

      const change = await manager.submitChange(
        'file_edit',
        '/file.ts',
        'new content'
      );

      expect(change.status).toBe('approved');
      expect(change.approvedBy).toBe(manager.getCurrentMember()?.id);
    });

    it('should throw when not in session', async () => {
      await expect(
        manager.submitChange('file_edit', '/file.ts', 'content')
      ).rejects.toThrow('No active session');
    });

    it('should emit change:submitted event', async () => {
      await manager.createSession('Test Session');

      const handler = jest.fn();
      manager.on('change:submitted', handler);

      await manager.submitChange('file_edit', '/file.ts', 'content');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('approveChange', () => {
    it('should approve pending change', async () => {
      await manager.createSession('Test Session');

      // First create a pending change
      const member = manager.getCurrentMember()!;
      const originalRole = member.role;
      member.role = 'viewer';

      const change = await manager.submitChange('file_edit', '/file.ts');
      member.role = originalRole; // Restore role to approve

      await manager.approveChange(change.id);

      expect(change.status).toBe('approved');
    });

    it('should throw when not in session', async () => {
      await expect(manager.approveChange('change-id')).rejects.toThrow(
        'No active session'
      );
    });

    it('should throw for viewers', async () => {
      await manager.createSession('Test Session');

      // Create change first
      const change = await manager.submitChange('file_edit', '/file.ts');

      // Change role to viewer
      const member = manager.getCurrentMember()!;
      member.role = 'viewer';

      await expect(manager.approveChange(change.id)).rejects.toThrow(
        'Viewers cannot approve changes'
      );
    });

    it('should throw for non-existent change', async () => {
      await manager.createSession('Test Session');

      await expect(manager.approveChange('non-existent')).rejects.toThrow(
        'Change not found'
      );
    });

    it('should add to audit log', async () => {
      const session = await manager.createSession('Test Session');

      // Create a pending change
      const member = manager.getCurrentMember()!;
      member.role = 'viewer';
      const change = await manager.submitChange('file_edit', '/file.ts');
      member.role = 'owner';

      const logLengthBefore = session.auditLog.length;
      await manager.approveChange(change.id);

      expect(session.auditLog.length).toBeGreaterThan(logLengthBefore);
    });

    it('should emit change:approved event', async () => {
      await manager.createSession('Test Session');

      const member = manager.getCurrentMember()!;
      member.role = 'viewer';
      const change = await manager.submitChange('file_edit', '/file.ts');
      member.role = 'owner';

      const handler = jest.fn();
      manager.on('change:approved', handler);

      await manager.approveChange(change.id);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('rejectChange', () => {
    it('should reject pending change', async () => {
      await manager.createSession('Test Session');

      const member = manager.getCurrentMember()!;
      member.role = 'viewer';
      const change = await manager.submitChange('file_edit', '/file.ts');
      member.role = 'owner';

      await manager.rejectChange(change.id, 'Not needed');

      expect(change.status).toBe('rejected');
    });

    it('should throw when not in session', async () => {
      await expect(manager.rejectChange('change-id')).rejects.toThrow(
        'No active session'
      );
    });

    it('should throw for viewers', async () => {
      await manager.createSession('Test Session');
      const change = await manager.submitChange('file_edit', '/file.ts');

      const member = manager.getCurrentMember()!;
      member.role = 'viewer';

      await expect(manager.rejectChange(change.id)).rejects.toThrow(
        'Viewers cannot reject changes'
      );
    });

    it('should emit change:rejected event', async () => {
      await manager.createSession('Test Session');

      const member = manager.getCurrentMember()!;
      member.role = 'viewer';
      const change = await manager.submitChange('file_edit', '/file.ts');
      member.role = 'owner';

      const handler = jest.fn();
      manager.on('change:rejected', handler);

      await manager.rejectChange(change.id, 'Reason');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('inviteMember', () => {
    it('should generate invite code', async () => {
      await manager.createSession('Test Session');

      const inviteCode = await manager.inviteMember('test@example.com');

      expect(inviteCode).toBeDefined();
      expect(inviteCode.length).toBeGreaterThan(0);
    });

    it('should throw when not in session', async () => {
      await expect(manager.inviteMember('test@example.com')).rejects.toThrow(
        'No active session'
      );
    });

    it('should throw without share permission', async () => {
      await manager.createSession('Test Session');
      const member = manager.getCurrentMember()!;
      member.role = 'viewer';

      await expect(manager.inviteMember('test@example.com')).rejects.toThrow(
        'No permission to invite members'
      );
    });

    it('should emit member:invited event', async () => {
      await manager.createSession('Test Session');

      const handler = jest.fn();
      manager.on('member:invited', handler);

      await manager.inviteMember('test@example.com');

      expect(handler).toHaveBeenCalled();
    });

    it('should accept role parameter', async () => {
      await manager.createSession('Test Session');

      const inviteCode = await manager.inviteMember('test@example.com', 'admin');

      expect(inviteCode).toBeDefined();
    });
  });

  describe('updateMemberRole', () => {
    it('should update member role', async () => {
      const session = await manager.createSession('Test Session');

      // Add another member
      const otherMember: TeamMember = {
        id: 'member-2',
        name: 'Other User',
        email: 'other@example.com',
        role: 'viewer',
        status: 'online',
        lastSeen: new Date(),
        permissions: [],
      };
      session.members.push(otherMember);

      await manager.updateMemberRole('member-2', 'editor');

      expect(otherMember.role).toBe('editor');
    });

    it('should throw when not in session', async () => {
      await expect(manager.updateMemberRole('member-id', 'editor')).rejects.toThrow(
        'No active session'
      );
    });

    it('should throw for insufficient permissions', async () => {
      await manager.createSession('Test Session');
      const member = manager.getCurrentMember()!;
      member.role = 'viewer';

      await expect(manager.updateMemberRole('member-id', 'editor')).rejects.toThrow(
        'Insufficient permissions'
      );
    });

    it("should not allow changing owner's role", async () => {
      const session = await manager.createSession('Test Session');

      await expect(
        manager.updateMemberRole(session.owner, 'viewer')
      ).rejects.toThrow("Cannot change owner's role");
    });

    it('should throw for non-existent member', async () => {
      await manager.createSession('Test Session');

      await expect(
        manager.updateMemberRole('non-existent', 'editor')
      ).rejects.toThrow('Member not found');
    });

    it('should emit member:roleChanged event', async () => {
      const session = await manager.createSession('Test Session');

      const otherMember: TeamMember = {
        id: 'member-2',
        name: 'Other User',
        email: 'other@example.com',
        role: 'viewer',
        status: 'online',
        lastSeen: new Date(),
        permissions: [],
      };
      session.members.push(otherMember);

      const handler = jest.fn();
      manager.on('member:roleChanged', handler);

      await manager.updateMemberRole('member-2', 'editor');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('should remove member from session', async () => {
      const session = await manager.createSession('Test Session');

      const otherMember: TeamMember = {
        id: 'member-2',
        name: 'Other User',
        email: 'other@example.com',
        role: 'viewer',
        status: 'online',
        lastSeen: new Date(),
        permissions: [],
      };
      session.members.push(otherMember);

      await manager.removeMember('member-2');

      expect(session.members.find((m) => m.id === 'member-2')).toBeUndefined();
    });

    it('should throw when not in session', async () => {
      await expect(manager.removeMember('member-id')).rejects.toThrow(
        'No active session'
      );
    });

    it('should throw for insufficient permissions', async () => {
      await manager.createSession('Test Session');
      const member = manager.getCurrentMember()!;
      member.role = 'viewer';

      await expect(manager.removeMember('member-id')).rejects.toThrow(
        'Insufficient permissions'
      );
    });

    it('should not allow removing owner', async () => {
      const session = await manager.createSession('Test Session');

      await expect(manager.removeMember(session.owner)).rejects.toThrow(
        'Cannot remove session owner'
      );
    });

    it('should throw for non-existent member', async () => {
      await manager.createSession('Test Session');

      await expect(manager.removeMember('non-existent')).rejects.toThrow(
        'Member not found'
      );
    });

    it('should emit member:removed event', async () => {
      const session = await manager.createSession('Test Session');

      const otherMember: TeamMember = {
        id: 'member-2',
        name: 'Other User',
        email: 'other@example.com',
        role: 'viewer',
        status: 'online',
        lastSeen: new Date(),
        permissions: [],
      };
      session.members.push(otherMember);

      const handler = jest.fn();
      manager.on('member:removed', handler);

      await manager.removeMember('member-2');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions', async () => {
      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('singleton', () => {
    beforeEach(() => {
      resetTeamSessionManager();
    });

    afterEach(() => {
      resetTeamSessionManager();
    });

    it('should return same instance', () => {
      const instance1 = getTeamSessionManager();
      const instance2 = getTeamSessionManager();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getTeamSessionManager();
      resetTeamSessionManager();
      const instance2 = getTeamSessionManager();
      expect(instance1).not.toBe(instance2);
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

  describe('audit log limits', () => {
    it('should keep only last 1000 entries', async () => {
      const session = await manager.createSession('Test Session');

      // Manually add many audit entries
      for (let i = 0; i < 1100; i++) {
        session.auditLog.push({
          id: `entry-${i}`,
          timestamp: new Date(),
          memberId: 'test',
          memberName: 'Test',
          action: 'test_action',
          details: { index: i },
        });
      }

      // Trigger audit entry cleanup by adding one more through the API
      await manager.shareFile(`/file-${Date.now()}.ts`);

      // The trimming happens in addAuditEntry
      expect(session.auditLog.length).toBeLessThanOrEqual(1001);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      await manager.createSession('Test Session');

      manager.dispose();

      // After dispose, operations should not work
      expect(manager.listenerCount('session:created')).toBe(0);
    });

    it('should remove all event listeners', () => {
      const handler = jest.fn();
      manager.on('session:created', handler);
      manager.on('session:left', handler);

      manager.dispose();

      expect(manager.listenerCount('session:created')).toBe(0);
      expect(manager.listenerCount('session:left')).toBe(0);
    });
  });

  describe('WebSocket handling', () => {
    it('should handle WebSocket disconnect gracefully', () => {
      const managerWithWs = new TeamSessionManager({
        enableEncryption: false,
        serverUrl: 'ws://localhost:9876',
        autoReconnect: false,
      });

      managerWithWs.dispose();
      // Should not throw
    });
  });

  describe('change types', () => {
    it('should handle file_edit type', async () => {
      await manager.createSession('Test Session');

      const change = await manager.submitChange(
        'file_edit',
        '/file.ts',
        'content'
      );

      expect(change.type).toBe('file_edit');
    });

    it('should handle file_create type', async () => {
      await manager.createSession('Test Session');

      const change = await manager.submitChange(
        'file_create',
        '/new-file.ts',
        'content'
      );

      expect(change.type).toBe('file_create');
    });

    it('should handle file_delete type', async () => {
      await manager.createSession('Test Session');

      const change = await manager.submitChange('file_delete', '/file.ts');

      expect(change.type).toBe('file_delete');
    });

    it('should handle terminal_command type', async () => {
      await manager.createSession('Test Session');

      const change = await manager.submitChange(
        'terminal_command',
        'npm install',
        undefined
      );

      expect(change.type).toBe('terminal_command');
    });
  });

  describe('session settings', () => {
    it('should respect allowFileEdits setting', async () => {
      const session = await manager.createSession('Test Session', {
        allowFileEdits: false,
      });

      expect(session.settings.allowFileEdits).toBe(false);
    });

    it('should respect allowTerminalAccess setting', async () => {
      const session = await manager.createSession('Test Session', {
        allowTerminalAccess: true,
      });

      expect(session.settings.allowTerminalAccess).toBe(true);
    });

    it('should respect allowCodeExecution setting', async () => {
      const session = await manager.createSession('Test Session', {
        allowCodeExecution: true,
      });

      expect(session.settings.allowCodeExecution).toBe(true);
    });

    it('should respect notifyOnJoin setting', async () => {
      const session = await manager.createSession('Test Session', {
        notifyOnJoin: false,
      });

      expect(session.settings.notifyOnJoin).toBe(false);
    });

    it('should respect recordSession setting', async () => {
      const session = await manager.createSession('Test Session', {
        recordSession: false,
      });

      expect(session.settings.recordSession).toBe(false);
    });

    it('should respect autoExpire setting', async () => {
      const session = await manager.createSession('Test Session', {
        autoExpire: false,
      });

      expect(session.settings.autoExpire).toBe(false);
    });

    it('should respect expireAfterHours setting', async () => {
      const session = await manager.createSession('Test Session', {
        expireAfterHours: 48,
      });

      expect(session.settings.expireAfterHours).toBe(48);
    });
  });
});
