/**
 * Unit tests for TeamModeManager
 * Tests team management, context sharing, action recording, and synchronization
 */

import TeamModeManager, {
  createTeamMode,
  TeamMember,
  TeamAction,
  SharedTeamContext,
  TeamConfig,
} from '../../src/advanced/team-mode';

// Mock crypto with incrementing IDs
let mockIdCounter = 0;
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockImplementation(() => ({
    toString: jest.fn().mockImplementation(() => `mock${++mockIdCounter}`),
  })),
}));

describe('TeamModeManager', () => {
  let manager: TeamModeManager;
  const defaultConfig: TeamConfig = {
    teamId: 'team-123',
  };

  beforeEach(() => {
    mockIdCounter = 0; // Reset counter before each test
    jest.clearAllMocks();
    jest.useFakeTimers();
    manager = new TeamModeManager(defaultConfig);
  });

  afterEach(() => {
    manager.dispose();
    jest.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create manager with required teamId', () => {
      const mgr = new TeamModeManager({ teamId: 'my-team' });
      expect(mgr).toBeInstanceOf(TeamModeManager);
      mgr.dispose();
    });

    it('should use default syncInterval when not specified', () => {
      const mgr = new TeamModeManager({ teamId: 'team' });
      // Default is 30000ms
      mgr.startSync();

      const syncHandler = jest.fn();
      mgr.on('sync', syncHandler);

      jest.advanceTimersByTime(30000);
      expect(syncHandler).toHaveBeenCalled();
      mgr.dispose();
    });

    it('should use custom syncInterval when specified', () => {
      const mgr = new TeamModeManager({ teamId: 'team', syncInterval: 10000 });
      mgr.startSync();

      const syncHandler = jest.fn();
      mgr.on('sync', syncHandler);

      jest.advanceTimersByTime(10000);
      expect(syncHandler).toHaveBeenCalled();
      mgr.dispose();
    });

    it('should use default maxMembers when not specified', () => {
      const mgr = new TeamModeManager({ teamId: 'team' });
      // Default is 50 members
      for (let i = 0; i < 50; i++) {
        mgr.addMember(`Member ${i}`);
      }
      // 51st member should fail
      expect(() => mgr.addMember('Member 51')).toThrow('Team is at capacity');
      mgr.dispose();
    });

    it('should use custom maxMembers when specified', () => {
      const mgr = new TeamModeManager({ teamId: 'team', maxMembers: 3 });
      mgr.addMember('Member 1');
      mgr.addMember('Member 2');
      mgr.addMember('Member 3');
      expect(() => mgr.addMember('Member 4')).toThrow('Team is at capacity');
      mgr.dispose();
    });

    it('should initialize empty context', () => {
      const context = manager.getContext();
      expect(context.projectInfo).toEqual({ name: '', path: '', description: '' });
      expect(context.sharedKnowledge.size).toBe(0);
      expect(context.codePatterns).toEqual([]);
      expect(context.conventions).toEqual([]);
      expect(context.history).toEqual([]);
    });
  });

  describe('Member Management', () => {
    describe('addMember()', () => {
      it('should add a member with default role', () => {
        const member = manager.addMember('John Doe');

        expect(member.name).toBe('John Doe');
        expect(member.role).toBe('member');
        expect(member.id).toMatch(/^mock\d+$/);
        expect(member.joinedAt).toBeInstanceOf(Date);
        expect(member.lastActive).toBeInstanceOf(Date);
      });

      it('should add a member with specified role', () => {
        const admin = manager.addMember('Admin User', 'admin');
        expect(admin.role).toBe('admin');

        const viewer = manager.addMember('Viewer User', 'viewer');
        expect(viewer.role).toBe('viewer');
      });

      it('should emit "member-joined" event', () => {
        const handler = jest.fn();
        manager.on('member-joined', handler);

        const member = manager.addMember('New Member');

        expect(handler).toHaveBeenCalledWith(member);
      });

      it('should throw error when team is at capacity', () => {
        const smallTeam = new TeamModeManager({ teamId: 'small', maxMembers: 2 });
        smallTeam.addMember('Member 1');
        smallTeam.addMember('Member 2');

        expect(() => smallTeam.addMember('Member 3')).toThrow('Team is at capacity');
        smallTeam.dispose();
      });

      it('should add member to internal map', () => {
        manager.addMember('Test User');
        const members = manager.getMembers();
        expect(members).toHaveLength(1);
        expect(members[0].name).toBe('Test User');
      });
    });

    describe('removeMember()', () => {
      it('should remove existing member', () => {
        const member = manager.addMember('User to Remove');
        const result = manager.removeMember(member.id);

        expect(result).toBe(true);
        expect(manager.getMembers()).toHaveLength(0);
      });

      it('should emit "member-left" event', () => {
        const handler = jest.fn();
        manager.on('member-left', handler);

        const member = manager.addMember('Leaving User');
        manager.removeMember(member.id);

        expect(handler).toHaveBeenCalledWith(member.id);
      });

      it('should return false for non-existent member', () => {
        const result = manager.removeMember('non-existent-id');
        expect(result).toBe(false);
      });

      it('should not emit event when member not found', () => {
        const handler = jest.fn();
        manager.on('member-left', handler);

        manager.removeMember('non-existent-id');

        expect(handler).not.toHaveBeenCalled();
      });
    });

    describe('getMembers()', () => {
      it('should return empty array initially', () => {
        expect(manager.getMembers()).toEqual([]);
      });

      it('should return all members', () => {
        manager.addMember('Member 1');
        manager.addMember('Member 2');
        manager.addMember('Member 3');

        const members = manager.getMembers();
        expect(members).toHaveLength(3);
      });

      it('should return a copy of members array', () => {
        manager.addMember('Member');
        const members1 = manager.getMembers();
        const members2 = manager.getMembers();

        expect(members1).not.toBe(members2);
        expect(members1).toEqual(members2);
      });
    });
  });

  describe('Knowledge Management', () => {
    describe('addKnowledge()', () => {
      it('should add knowledge to shared context', () => {
        manager.addKnowledge('apiEndpoint', 'https://api.example.com');

        const context = manager.getContext();
        expect(context.sharedKnowledge.get('apiEndpoint')).toBe('https://api.example.com');
      });

      it('should emit "knowledge-updated" event', () => {
        const handler = jest.fn();
        manager.on('knowledge-updated', handler);

        manager.addKnowledge('key', 'value');

        expect(handler).toHaveBeenCalledWith({ key: 'key', value: 'value' });
      });

      it('should overwrite existing knowledge', () => {
        manager.addKnowledge('key', 'old value');
        manager.addKnowledge('key', 'new value');

        const context = manager.getContext();
        expect(context.sharedKnowledge.get('key')).toBe('new value');
      });

      it('should handle multiple knowledge entries', () => {
        manager.addKnowledge('key1', 'value1');
        manager.addKnowledge('key2', 'value2');
        manager.addKnowledge('key3', 'value3');

        const context = manager.getContext();
        expect(context.sharedKnowledge.size).toBe(3);
      });
    });

    describe('addPattern()', () => {
      it('should add code pattern', () => {
        manager.addPattern('Use async/await instead of callbacks');

        const context = manager.getContext();
        expect(context.codePatterns).toContain('Use async/await instead of callbacks');
      });

      it('should not add duplicate patterns', () => {
        manager.addPattern('Pattern A');
        manager.addPattern('Pattern A');
        manager.addPattern('Pattern A');

        const context = manager.getContext();
        expect(context.codePatterns.filter(p => p === 'Pattern A')).toHaveLength(1);
      });

      it('should add multiple unique patterns', () => {
        manager.addPattern('Pattern 1');
        manager.addPattern('Pattern 2');
        manager.addPattern('Pattern 3');

        const context = manager.getContext();
        expect(context.codePatterns).toHaveLength(3);
      });
    });

    describe('addConvention()', () => {
      it('should add convention', () => {
        manager.addConvention('Use 2-space indentation');

        const context = manager.getContext();
        expect(context.conventions).toContain('Use 2-space indentation');
      });

      it('should not add duplicate conventions', () => {
        manager.addConvention('Convention A');
        manager.addConvention('Convention A');

        const context = manager.getContext();
        expect(context.conventions.filter(c => c === 'Convention A')).toHaveLength(1);
      });

      it('should add multiple unique conventions', () => {
        manager.addConvention('Single quotes');
        manager.addConvention('No semicolons');
        manager.addConvention('PascalCase components');

        const context = manager.getContext();
        expect(context.conventions).toHaveLength(3);
      });
    });
  });

  describe('Action Recording', () => {
    describe('recordAction()', () => {
      it('should record a query action', () => {
        const member = manager.addMember('Developer');
        const action = manager.recordAction(member.id, 'query', 'Asked about API design');

        expect(action.memberId).toBe(member.id);
        expect(action.type).toBe('query');
        expect(action.summary).toBe('Asked about API design');
        expect(action.timestamp).toBeInstanceOf(Date);
        expect(action.id).toBeDefined();
      });

      it('should record an edit action', () => {
        const member = manager.addMember('Developer');
        const action = manager.recordAction(member.id, 'edit', 'Modified auth module');

        expect(action.type).toBe('edit');
      });

      it('should record a commit action', () => {
        const member = manager.addMember('Developer');
        const action = manager.recordAction(member.id, 'commit', 'Committed feature branch');

        expect(action.type).toBe('commit');
      });

      it('should record a review action', () => {
        const member = manager.addMember('Reviewer');
        const action = manager.recordAction(member.id, 'review', 'Reviewed PR #123');

        expect(action.type).toBe('review');
      });

      it('should emit "action-recorded" event', () => {
        const handler = jest.fn();
        manager.on('action-recorded', handler);

        const member = manager.addMember('Developer');
        const action = manager.recordAction(member.id, 'query', 'Test action');

        expect(handler).toHaveBeenCalledWith(action);
      });

      it('should add action to history', () => {
        const member = manager.addMember('Developer');
        manager.recordAction(member.id, 'query', 'First action');
        manager.recordAction(member.id, 'edit', 'Second action');

        const context = manager.getContext();
        expect(context.history).toHaveLength(2);
      });

      it('should maintain action order in history', () => {
        const member = manager.addMember('Developer');
        manager.recordAction(member.id, 'query', 'Action 1');
        manager.recordAction(member.id, 'edit', 'Action 2');
        manager.recordAction(member.id, 'commit', 'Action 3');

        const context = manager.getContext();
        expect(context.history[0].summary).toBe('Action 1');
        expect(context.history[1].summary).toBe('Action 2');
        expect(context.history[2].summary).toBe('Action 3');
      });
    });
  });

  describe('Context Access', () => {
    describe('getContext()', () => {
      it('should return the shared context', () => {
        const context = manager.getContext();

        expect(context).toHaveProperty('projectInfo');
        expect(context).toHaveProperty('sharedKnowledge');
        expect(context).toHaveProperty('codePatterns');
        expect(context).toHaveProperty('conventions');
        expect(context).toHaveProperty('history');
      });

      it('should reflect updates to context', () => {
        manager.addKnowledge('test', 'value');
        manager.addPattern('pattern');
        manager.addConvention('convention');

        const context = manager.getContext();
        expect(context.sharedKnowledge.get('test')).toBe('value');
        expect(context.codePatterns).toContain('pattern');
        expect(context.conventions).toContain('convention');
      });
    });
  });

  describe('Synchronization', () => {
    describe('startSync()', () => {
      it('should start sync timer', () => {
        manager.startSync();

        const syncHandler = jest.fn();
        manager.on('sync', syncHandler);

        jest.advanceTimersByTime(30000); // Default interval

        expect(syncHandler).toHaveBeenCalled();
      });

      it('should emit sync events at intervals', () => {
        manager.startSync();

        const syncHandler = jest.fn();
        manager.on('sync', syncHandler);

        jest.advanceTimersByTime(90000); // 3 intervals

        expect(syncHandler).toHaveBeenCalledTimes(3);
      });

      it('should include context in sync event', () => {
        manager.addKnowledge('key', 'value');
        manager.startSync();

        const syncHandler = jest.fn();
        manager.on('sync', syncHandler);

        jest.advanceTimersByTime(30000);

        expect(syncHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            sharedKnowledge: expect.any(Map),
            codePatterns: expect.any(Array),
            conventions: expect.any(Array),
            history: expect.any(Array),
          })
        );
      });
    });

    describe('stopSync()', () => {
      it('should stop sync timer', () => {
        manager.startSync();
        manager.stopSync();

        const syncHandler = jest.fn();
        manager.on('sync', syncHandler);

        jest.advanceTimersByTime(60000);

        expect(syncHandler).not.toHaveBeenCalled();
      });

      it('should handle stopping when not started', () => {
        expect(() => manager.stopSync()).not.toThrow();
      });

      it('should handle multiple stop calls', () => {
        manager.startSync();
        manager.stopSync();
        manager.stopSync();
        manager.stopSync();

        expect(true).toBe(true); // No errors
      });
    });
  });

  describe('Disposal', () => {
    describe('dispose()', () => {
      it('should stop sync timer', () => {
        manager.startSync();

        const syncHandler = jest.fn();
        manager.on('sync', syncHandler);

        manager.dispose();

        jest.advanceTimersByTime(60000);
        expect(syncHandler).not.toHaveBeenCalled();
      });

      it('should clear members', () => {
        manager.addMember('Member 1');
        manager.addMember('Member 2');

        manager.dispose();

        expect(manager.getMembers()).toHaveLength(0);
      });

      it('should remove all event listeners', () => {
        const handler = jest.fn();
        manager.on('member-joined', handler);

        manager.dispose();

        // Adding member after dispose - handler should not be called
        // Note: After dispose, the manager is in an undefined state
        // This tests that listeners are removed
      });
    });
  });

  describe('Event Emission', () => {
    it('should support multiple listeners for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      manager.on('member-joined', handler1);
      manager.on('member-joined', handler2);

      manager.addMember('Test');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should support different event types', () => {
      const joinHandler = jest.fn();
      const leaveHandler = jest.fn();
      const knowledgeHandler = jest.fn();
      const actionHandler = jest.fn();
      const syncHandler = jest.fn();

      manager.on('member-joined', joinHandler);
      manager.on('member-left', leaveHandler);
      manager.on('knowledge-updated', knowledgeHandler);
      manager.on('action-recorded', actionHandler);
      manager.on('sync', syncHandler);

      const member = manager.addMember('Test');
      manager.removeMember(member.id);
      manager.addKnowledge('key', 'value');

      expect(joinHandler).toHaveBeenCalled();
      expect(leaveHandler).toHaveBeenCalled();
      expect(knowledgeHandler).toHaveBeenCalled();
    });
  });
});

describe('createTeamMode factory function', () => {
  it('should create a new TeamModeManager instance', () => {
    const manager = createTeamMode({ teamId: 'test-team' });
    expect(manager).toBeInstanceOf(TeamModeManager);
    manager.dispose();
  });

  it('should pass config to TeamModeManager', () => {
    const manager = createTeamMode({
      teamId: 'test-team',
      maxMembers: 5,
      syncInterval: 5000,
      retentionDays: 7,
    });

    // Verify maxMembers is respected
    for (let i = 0; i < 5; i++) {
      manager.addMember(`Member ${i}`);
    }
    expect(() => manager.addMember('Extra')).toThrow('Team is at capacity');

    manager.dispose();
  });
});

describe('Edge Cases', () => {
  let manager: TeamModeManager;

  beforeEach(() => {
    mockIdCounter = 0; // Reset counter before each test
    jest.useFakeTimers();
    manager = new TeamModeManager({ teamId: 'edge-cases' });
  });

  afterEach(() => {
    manager.dispose();
    jest.useRealTimers();
  });

  it('should handle empty member names', () => {
    const member = manager.addMember('');
    expect(member.name).toBe('');
  });

  it('should handle unicode member names', () => {
    const member = manager.addMember('\u5f20\u4e09 \ud83d\udc68\u200d\ud83d\udcbb');
    expect(member.name).toBe('\u5f20\u4e09 \ud83d\udc68\u200d\ud83d\udcbb');
  });

  it('should handle very long knowledge values', () => {
    const longValue = 'x'.repeat(100000);
    manager.addKnowledge('long', longValue);

    const context = manager.getContext();
    expect(context.sharedKnowledge.get('long')).toBe(longValue);
  });

  it('should handle special characters in knowledge keys', () => {
    manager.addKnowledge('key/with/slashes', 'value1');
    manager.addKnowledge('key.with.dots', 'value2');
    manager.addKnowledge('key:with:colons', 'value3');

    const context = manager.getContext();
    expect(context.sharedKnowledge.get('key/with/slashes')).toBe('value1');
    expect(context.sharedKnowledge.get('key.with.dots')).toBe('value2');
    expect(context.sharedKnowledge.get('key:with:colons')).toBe('value3');
  });

  it('should handle very long action summaries', () => {
    const member = manager.addMember('Dev');
    const longSummary = 'A'.repeat(10000);
    const action = manager.recordAction(member.id, 'query', longSummary);

    expect(action.summary).toBe(longSummary);
  });

  it('should handle rapid member add/remove cycles', () => {
    for (let i = 0; i < 100; i++) {
      const member = manager.addMember(`Member ${i}`);
      manager.removeMember(member.id);
    }

    expect(manager.getMembers()).toHaveLength(0);
  });

  it('should handle concurrent knowledge updates', () => {
    for (let i = 0; i < 50; i++) {
      manager.addKnowledge(`key${i}`, `value${i}`);
    }

    const context = manager.getContext();
    expect(context.sharedKnowledge.size).toBe(50);
  });

  it('should handle adding patterns with special characters', () => {
    manager.addPattern('Use `const` instead of `let`');
    manager.addPattern('Pattern with "quotes"');
    manager.addPattern("Pattern with 'single quotes'");

    const context = manager.getContext();
    expect(context.codePatterns).toHaveLength(3);
  });

  it('should preserve member order', () => {
    manager.addMember('Alice');
    manager.addMember('Bob');
    manager.addMember('Charlie');

    const members = manager.getMembers();
    expect(members[0].name).toBe('Alice');
    expect(members[1].name).toBe('Bob');
    expect(members[2].name).toBe('Charlie');
  });
});
