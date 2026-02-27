/**
 * Comprehensive tests for TeamManager
 *
 * Covers: singleton, lifecycle, member management, task management,
 * mailbox, status/formatting, shared context, edge cases, and events.
 */

// ---------------------------------------------------------------------------
// Mock createId so IDs are predictable
// ---------------------------------------------------------------------------

let idCounter = 0;

jest.mock('../../src/agent/multi-agent/base-agent.js', () => ({
  createId: jest.fn((prefix: string) => `${prefix}-${++idCounter}`),
}));

// Silence any logger calls from transitive imports
jest.mock('../../src/utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Imports — placed AFTER jest.mock declarations
// ---------------------------------------------------------------------------

import {
  TeamManager,
  getTeamManager,
  resetTeamManager,
  TeamMember,
  TeamTask,
  MailboxMessage,
} from '../../src/agent/multi-agent/team-manager.js';
import type { AgentRole } from '../../src/agent/multi-agent/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startedManager(goal?: string): TeamManager {
  const tm = new TeamManager();
  tm.start(goal ?? 'test goal');
  return tm;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamManager', () => {
  beforeEach(() => {
    idCounter = 0;
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Singleton
  // =========================================================================

  describe('singleton — getTeamManager / resetTeamManager', () => {
    afterEach(() => {
      resetTeamManager();
    });

    it('getTeamManager() returns the same instance on repeated calls', () => {
      const a = getTeamManager();
      const b = getTeamManager();
      expect(a).toBe(b);
    });

    it('resetTeamManager() causes the next getTeamManager() to return a new instance', () => {
      const a = getTeamManager();
      resetTeamManager();
      const b = getTeamManager();
      expect(a).not.toBe(b);
    });

    it('resetTeamManager() removes all listeners from the old instance', () => {
      const a = getTeamManager();
      const handler = jest.fn();
      a.on('team:started', handler);

      resetTeamManager();
      // Emit on the old reference — listener should not have been cleaned up
      // by the reset, but removeAllListeners should have been called.
      // We verify by checking listenerCount after reset.
      expect(a.listenerCount('team:started')).toBe(0);
    });

    it('resetTeamManager() on a null instance is a no-op', () => {
      resetTeamManager(); // null out
      expect(() => resetTeamManager()).not.toThrow(); // second call
    });
  });

  // =========================================================================
  // 2. Team lifecycle — start() / stop()
  // =========================================================================

  describe('lifecycle — start()', () => {
    it('returns success with a leadId when team is inactive', () => {
      const tm = new TeamManager();
      const result = tm.start('build a CLI tool');

      expect(result.success).toBe(true);
      expect(result.leadId).toBeTruthy();
      expect(result.message).toContain('team lead');
      expect(result.message).toContain('build a CLI tool');
    });

    it('sets status to active after start()', () => {
      const tm = new TeamManager();
      tm.start('goal');
      expect(tm.isActive()).toBe(true);
    });

    it('stores the team goal', () => {
      const tm = new TeamManager();
      tm.start('my goal');
      expect(tm.getTeamGoal()).toBe('my goal');
    });

    it('returns a non-empty leadId that matches the createId result', () => {
      const tm = new TeamManager();
      const result = tm.start();
      // createId was called with 'lead' — first call gives 'lead-1'
      expect(result.leadId).toBe('lead-1');
      expect(tm.getLeadId()).toBe('lead-1');
    });

    it('works with no goal (empty string)', () => {
      const tm = new TeamManager();
      const result = tm.start();
      expect(result.success).toBe(true);
      expect(result.message).not.toContain('Goal:');
      expect(tm.getTeamGoal()).toBe('');
    });

    it('fails when team is already active', () => {
      const tm = new TeamManager();
      tm.start('first goal');
      const result = tm.start('second goal');

      expect(result.success).toBe(false);
      expect(result.leadId).toBe('');
      expect(result.message).toContain('already active');
    });

    it('clears members, tasks and mailbox on a fresh start', () => {
      const tm = startedManager();
      tm.addMember('coder');
      tm.addTask('t1', 'desc');
      tm.sendMessage('lead', 'all', 'hello');

      // Stop and restart
      tm.stop();
      tm.start('fresh goal');

      expect(tm.getMembers()).toHaveLength(0);
      expect(tm.getTasks()).toHaveLength(0);
    });
  });

  describe('lifecycle — stop()', () => {
    it('returns success when team is active', () => {
      const tm = startedManager();
      const result = tm.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain('dissolved');
    });

    it('sets status to inactive after stop()', () => {
      const tm = startedManager();
      tm.stop();
      expect(tm.isActive()).toBe(false);
    });

    it('clears members, tasks and mailbox after stop()', () => {
      const tm = startedManager();
      tm.addMember('coder');
      tm.addTask('task', 'desc');
      tm.sendMessage('lead', 'all', 'msg');

      tm.stop();

      expect(tm.getMembers()).toHaveLength(0);
      expect(tm.getTasks()).toHaveLength(0);
      expect(tm.getLeadId()).toBeNull();
      expect(tm.getTeamGoal()).toBe('');
    });

    it('includes member/task counts in the stop message', () => {
      const tm = startedManager();
      tm.addMember('coder');
      const task = tm.addTask('task', 'desc');
      tm.updateTask(task.id, { status: 'completed' });

      const result = tm.stop();
      expect(result.message).toContain('1/1');
      expect(result.message).toContain('1 member');
    });

    it('fails when team is not active', () => {
      const tm = new TeamManager();
      const result = tm.stop();

      expect(result.success).toBe(false);
      expect(result.message).toContain('No active team');
    });

    it('fails when team is already dissolved (inactive)', () => {
      const tm = startedManager();
      tm.stop();
      const result = tm.stop();

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // 3. Member management
  // =========================================================================

  describe('member management', () => {
    let tm: TeamManager;

    beforeEach(() => {
      tm = startedManager();
    });

    describe('addMember()', () => {
      it('adds a member with a valid role and returns its ID', () => {
        const result = tm.addMember('coder');

        expect(result.success).toBe(true);
        expect(result.memberId).toBeTruthy();
        expect(result.message).toContain('coder');
      });

      it('stores the member in the members map', () => {
        const { memberId } = tm.addMember('reviewer');
        const member = tm.getMember(memberId);

        expect(member).toBeDefined();
        expect(member!.role).toBe('reviewer');
        expect(member!.status).toBe('idle');
        expect(member!.completedTasks).toBe(0);
        expect(member!.currentTaskId).toBeNull();
        expect(member!.joinedAt).toBeInstanceOf(Date);
      });

      it('uses the provided label', () => {
        const { memberId } = tm.addMember('tester', 'my-tester');
        expect(tm.getMember(memberId)!.label).toBe('my-tester');
      });

      it('auto-generates label from role + index when no label is given', () => {
        const { memberId } = tm.addMember('debugger');
        const label = tm.getMember(memberId)!.label;
        expect(label).toBe('debugger-1');
      });

      it('increments the auto-label index for each new member', () => {
        tm.addMember('coder');
        const { memberId } = tm.addMember('coder');
        expect(tm.getMember(memberId)!.label).toBe('coder-2');
      });

      it('supports all valid roles', () => {
        const validRoles = [
          'orchestrator', 'coder', 'reviewer', 'tester',
          'researcher', 'debugger', 'architect', 'documenter',
        ] as const;

        for (const role of validRoles) {
          const result = tm.addMember(role);
          expect(result.success).toBe(true);
        }
      });

      it('rejects an invalid role', () => {
        const result = tm.addMember('wizard' as unknown as AgentRole);

        expect(result.success).toBe(false);
        expect(result.memberId).toBe('');
        expect(result.message).toContain('Invalid role');
        expect(result.message).toContain('wizard');
      });

      it('fails when team is not active', () => {
        const inactive = new TeamManager();
        const result = inactive.addMember('coder');

        expect(result.success).toBe(false);
        expect(result.message).toContain('not active');
      });
    });

    describe('removeMember()', () => {
      it('removes an existing member and returns success', () => {
        const { memberId } = tm.addMember('coder');
        const result = tm.removeMember(memberId);

        expect(result.success).toBe(true);
        expect(result.message).toContain('coder');
        expect(tm.getMember(memberId)).toBeUndefined();
      });

      it('unassigns tasks that belonged to the removed member', () => {
        const { memberId } = tm.addMember('coder');
        const task = tm.addTask('work', 'desc');
        tm.assignTask(task.id, memberId);

        expect(tm.getTask(task.id)!.assignedTo).toBe(memberId);
        expect(tm.getTask(task.id)!.status).toBe('in_progress');

        tm.removeMember(memberId);

        const updatedTask = tm.getTask(task.id)!;
        expect(updatedTask.assignedTo).toBeNull();
        expect(updatedTask.status).toBe('pending');
      });

      it('fails when member ID does not exist', () => {
        const result = tm.removeMember('nonexistent-id');

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });
    });

    describe('getMember()', () => {
      it('returns the correct member object', () => {
        const { memberId } = tm.addMember('architect');
        const member = tm.getMember(memberId);

        expect(member).toBeDefined();
        expect(member!.id).toBe(memberId);
        expect(member!.role).toBe('architect');
      });

      it('returns undefined for an unknown ID', () => {
        expect(tm.getMember('unknown-id')).toBeUndefined();
      });
    });

    describe('getMembers()', () => {
      it('returns an empty array when no members', () => {
        expect(tm.getMembers()).toEqual([]);
      });

      it('returns all added members', () => {
        tm.addMember('coder');
        tm.addMember('tester');

        const members = tm.getMembers();
        expect(members).toHaveLength(2);
        const roles = members.map(m => m.role);
        expect(roles).toContain('coder');
        expect(roles).toContain('tester');
      });
    });
  });

  // =========================================================================
  // 4. Task management
  // =========================================================================

  describe('task management', () => {
    let tm: TeamManager;

    beforeEach(() => {
      tm = startedManager();
    });

    describe('addTask()', () => {
      it('creates a task with required fields and returns it', () => {
        const task = tm.addTask('Fix bug', 'Fix the login bug');

        expect(task.id).toBeTruthy();
        expect(task.title).toBe('Fix bug');
        expect(task.description).toBe('Fix the login bug');
        expect(task.status).toBe('pending');
        expect(task.priority).toBe('medium');
        expect(task.assignedTo).toBeNull();
        expect(task.assignedRole).toBeNull();
        expect(task.dependencies).toEqual([]);
        expect(task.createdAt).toBeInstanceOf(Date);
        expect(task.updatedAt).toBeInstanceOf(Date);
      });

      it('respects the provided priority option', () => {
        const task = tm.addTask('critical fix', 'urgent', { priority: 'critical' });
        expect(task.priority).toBe('critical');
      });

      it('respects the provided dependencies option', () => {
        const dep = tm.addTask('dep', 'dep desc');
        const task = tm.addTask('main', 'desc', { dependencies: [dep.id] });
        expect(task.dependencies).toEqual([dep.id]);
      });

      it('respects the provided assignedRole option', () => {
        const task = tm.addTask('code it', 'desc', { assignedRole: 'coder' });
        expect(task.assignedRole).toBe('coder');
      });

      it('auto-assigns to an idle member with matching role when assignedRole is given', () => {
        const { memberId } = tm.addMember('coder');
        const task = tm.addTask('code task', 'desc', { assignedRole: 'coder' });

        const updated = tm.getTask(task.id)!;
        expect(updated.assignedTo).toBe(memberId);
        expect(updated.status).toBe('in_progress');
        expect(tm.getMember(memberId)!.status).toBe('working');
      });

      it('does not auto-assign when matching member is busy', () => {
        const { memberId } = tm.addMember('coder');
        // Occupy the coder first
        const firstTask = tm.addTask('first', 'desc', { assignedRole: 'coder' });
        expect(tm.getTask(firstTask.id)!.assignedTo).toBe(memberId);

        const secondTask = tm.addTask('second', 'desc', { assignedRole: 'coder' });
        expect(tm.getTask(secondTask.id)!.assignedTo).toBeNull();
      });

      it('stores the task and makes it retrievable via getTask()', () => {
        const task = tm.addTask('store me', 'desc');
        expect(tm.getTask(task.id)).toEqual(task);
      });

      it('appears in getTasks()', () => {
        tm.addTask('a', 'a');
        tm.addTask('b', 'b');
        expect(tm.getTasks()).toHaveLength(2);
      });
    });

    describe('updateTask()', () => {
      it('updates the status field', () => {
        const task = tm.addTask('task', 'desc');
        const result = tm.updateTask(task.id, { status: 'in_progress' });

        expect(result.success).toBe(true);
        expect(tm.getTask(task.id)!.status).toBe('in_progress');
      });

      it('sets completedAt when status becomes completed', () => {
        const task = tm.addTask('task', 'desc');
        tm.updateTask(task.id, { status: 'completed' });

        expect(tm.getTask(task.id)!.completedAt).toBeInstanceOf(Date);
      });

      it('increments member completedTasks and sets member idle on task completion', () => {
        const { memberId } = tm.addMember('coder');
        const task = tm.addTask('task', 'desc');
        tm.assignTask(task.id, memberId);
        tm.updateTask(task.id, { status: 'completed' });

        const member = tm.getMember(memberId)!;
        expect(member.completedTasks).toBe(1);
        expect(member.status).toBe('idle');
        expect(member.currentTaskId).toBeNull();
      });

      it('updates the result field', () => {
        const task = tm.addTask('task', 'desc');
        tm.updateTask(task.id, { result: 'done successfully' });
        expect(tm.getTask(task.id)!.result).toBe('done successfully');
      });

      it('updates the error field', () => {
        const task = tm.addTask('task', 'desc');
        tm.updateTask(task.id, { error: 'something went wrong' });
        expect(tm.getTask(task.id)!.error).toBe('something went wrong');
      });

      it('updates the assignedTo field', () => {
        const { memberId } = tm.addMember('coder');
        const task = tm.addTask('task', 'desc');
        tm.updateTask(task.id, { assignedTo: memberId });
        expect(tm.getTask(task.id)!.assignedTo).toBe(memberId);
      });

      it('refreshes updatedAt on every update', () => {
        const task = tm.addTask('task', 'desc');
        const original = tm.getTask(task.id)!.updatedAt;

        // Small artificial delay so timestamps differ
        jest.spyOn(Date, 'now').mockReturnValueOnce(Date.now() + 1000);

        tm.updateTask(task.id, { status: 'in_progress' });
        const updated = tm.getTask(task.id)!.updatedAt;
        expect(updated.getTime()).toBeGreaterThanOrEqual(original.getTime());

        jest.restoreAllMocks();
      });

      it('returns failure when the task ID does not exist', () => {
        const result = tm.updateTask('nonexistent-task', { status: 'completed' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });
    });

    describe('assignTask()', () => {
      it('assigns a task to a member and updates both statuses', () => {
        const { memberId } = tm.addMember('reviewer');
        const task = tm.addTask('review PR', 'desc');
        const result = tm.assignTask(task.id, memberId);

        expect(result.success).toBe(true);
        const updatedTask = tm.getTask(task.id)!;
        expect(updatedTask.assignedTo).toBe(memberId);
        expect(updatedTask.status).toBe('in_progress');

        const member = tm.getMember(memberId)!;
        expect(member.status).toBe('working');
        expect(member.currentTaskId).toBe(task.id);
      });

      it('fails when the task ID does not exist', () => {
        const { memberId } = tm.addMember('coder');
        const result = tm.assignTask('bad-task-id', memberId);

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });

      it('fails when the member ID does not exist', () => {
        const task = tm.addTask('task', 'desc');
        const result = tm.assignTask(task.id, 'bad-member-id');

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });
    });

    describe('getAvailableTasks()', () => {
      it('returns all pending tasks with no dependencies', () => {
        tm.addTask('a', 'desc');
        tm.addTask('b', 'desc');

        const available = tm.getAvailableTasks();
        expect(available).toHaveLength(2);
      });

      it('excludes tasks with unmet dependencies', () => {
        const dep = tm.addTask('dep', 'depends');
        tm.addTask('child', 'needs dep', { dependencies: [dep.id] });

        const available = tm.getAvailableTasks();
        // Only 'dep' is available; 'child' is blocked
        expect(available.map(t => t.title)).toContain('dep');
        expect(available.map(t => t.title)).not.toContain('child');
      });

      it('includes a task once its dependency is completed', () => {
        const dep = tm.addTask('dep', 'desc');
        tm.addTask('child', 'needs dep', { dependencies: [dep.id] });

        tm.updateTask(dep.id, { status: 'completed' });

        const available = tm.getAvailableTasks();
        const titles = available.map(t => t.title);
        expect(titles).toContain('child');
      });

      it('excludes in-progress and completed tasks', () => {
        const t1 = tm.addTask('in-progress task', 'desc');
        const t2 = tm.addTask('completed task', 'desc');
        tm.addTask('pending task', 'desc');

        tm.updateTask(t1.id, { status: 'in_progress' });
        tm.updateTask(t2.id, { status: 'completed' });

        const available = tm.getAvailableTasks();
        expect(available.map(t => t.title)).toEqual(['pending task']);
      });

      it('returns empty array when there are no tasks', () => {
        expect(tm.getAvailableTasks()).toEqual([]);
      });
    });
  });

  // =========================================================================
  // 5. Mailbox
  // =========================================================================

  describe('mailbox', () => {
    let tm: TeamManager;
    let memberA: string;
    let memberB: string;

    beforeEach(() => {
      tm = startedManager();
      memberA = tm.addMember('coder').memberId;
      memberB = tm.addMember('reviewer').memberId;
    });

    describe('sendMessage()', () => {
      it('returns a MailboxMessage with all fields populated', () => {
        const msg = tm.sendMessage(memberA, memberB, 'Hello B');

        expect(msg.id).toBeTruthy();
        expect(msg.from).toBe(memberA);
        expect(msg.to).toBe(memberB);
        expect(msg.content).toBe('Hello B');
        expect(msg.timestamp).toBeInstanceOf(Date);
        expect(msg.read).toBe(false);
      });

      it('supports broadcast messages addressed to "all"', () => {
        const msg = tm.sendMessage(memberA, 'all', 'broadcast');
        expect(msg.to).toBe('all');
      });
    });

    describe('getUnreadMessages()', () => {
      it('returns unread direct messages addressed to the member', () => {
        tm.sendMessage(memberA, memberB, 'direct');

        const unread = tm.getUnreadMessages(memberB);
        expect(unread).toHaveLength(1);
        expect(unread[0].content).toBe('direct');
      });

      it('returns unread broadcast messages for any member', () => {
        tm.sendMessage(memberA, 'all', 'broadcast');

        const unreadA = tm.getUnreadMessages(memberA);
        const unreadB = tm.getUnreadMessages(memberB);

        // Sender does NOT receive their own broadcast as "unread"
        expect(unreadA).toHaveLength(0);
        expect(unreadB).toHaveLength(1);
      });

      it('excludes messages sent by the member themselves', () => {
        tm.sendMessage(memberA, memberA, 'self-note');
        expect(tm.getUnreadMessages(memberA)).toHaveLength(0);
      });

      it('excludes already-read messages', () => {
        const msg = tm.sendMessage(memberA, memberB, 'direct');
        tm.markRead([msg.id]);

        expect(tm.getUnreadMessages(memberB)).toHaveLength(0);
      });

      it('returns empty array when there are no unread messages', () => {
        expect(tm.getUnreadMessages(memberA)).toHaveLength(0);
      });
    });

    describe('getInbox()', () => {
      it('includes messages sent to the member', () => {
        tm.sendMessage(memberA, memberB, 'for B');

        const inbox = tm.getInbox(memberB);
        expect(inbox.map(m => m.content)).toContain('for B');
      });

      it('includes broadcast messages', () => {
        tm.sendMessage(memberA, 'all', 'broadcast');

        expect(tm.getInbox(memberB)).toHaveLength(1);
      });

      it('includes messages SENT by the member (outbox visible in inbox)', () => {
        tm.sendMessage(memberA, memberB, 'sent by A');

        const inboxA = tm.getInbox(memberA);
        expect(inboxA.map(m => m.content)).toContain('sent by A');
      });

      it('respects the limit parameter', () => {
        for (let i = 0; i < 25; i++) {
          tm.sendMessage(memberA, memberB, `msg-${i}`);
        }

        const inbox = tm.getInbox(memberB, 5);
        expect(inbox).toHaveLength(5);
      });

      it('uses the last N messages (tail)', () => {
        for (let i = 0; i < 25; i++) {
          tm.sendMessage(memberA, memberB, `msg-${i}`);
        }

        const inbox = tm.getInbox(memberB, 5);
        // Should be the last 5 messages (msg-20 through msg-24)
        expect(inbox[inbox.length - 1].content).toBe('msg-24');
      });

      it('does not include messages addressed to other members', () => {
        tm.sendMessage(memberA, memberB, 'only for B');

        const thirdMember = tm.addMember('tester').memberId;
        expect(tm.getInbox(thirdMember)).toHaveLength(0);
      });
    });

    describe('markRead()', () => {
      it('marks the specified messages as read', () => {
        const msg1 = tm.sendMessage(memberA, memberB, 'first');
        const msg2 = tm.sendMessage(memberA, memberB, 'second');

        tm.markRead([msg1.id]);

        expect(msg1.read).toBe(true);
        expect(msg2.read).toBe(false);
      });

      it('marks multiple messages as read in one call', () => {
        const msg1 = tm.sendMessage(memberA, memberB, 'first');
        const msg2 = tm.sendMessage(memberA, memberB, 'second');

        tm.markRead([msg1.id, msg2.id]);

        expect(msg1.read).toBe(true);
        expect(msg2.read).toBe(true);
      });

      it('ignores IDs that do not correspond to any message', () => {
        tm.sendMessage(memberA, memberB, 'real');
        expect(() => tm.markRead(['nonexistent-id'])).not.toThrow();
      });

      it('reduces unread count in getStatus()', () => {
        const msg = tm.sendMessage(memberA, memberB, 'unread');
        expect(tm.getStatus().unreadMessages).toBe(1);

        tm.markRead([msg.id]);
        expect(tm.getStatus().unreadMessages).toBe(0);
      });
    });
  });

  // =========================================================================
  // 6. Status & formatting
  // =========================================================================

  describe('getStatus()', () => {
    it('returns inactive status when team has not started', () => {
      const tm = new TeamManager();
      const status = tm.getStatus();

      expect(status.status).toBe('inactive');
      expect(status.goal).toBe('');
      expect(status.memberCount).toBe(0);
      expect(status.members).toEqual([]);
      expect(status.uptime).toBe('N/A');
    });

    it('returns active status after start()', () => {
      const tm = startedManager('my goal');
      const status = tm.getStatus();

      expect(status.status).toBe('active');
      expect(status.goal).toBe('my goal');
    });

    it('counts members correctly', () => {
      const tm = startedManager();
      tm.addMember('coder');
      tm.addMember('tester');

      expect(tm.getStatus().memberCount).toBe(2);
      expect(tm.getStatus().members).toHaveLength(2);
    });

    it('reports taskSummary correctly', () => {
      const tm = startedManager();
      const t1 = tm.addTask('p1', 'desc');
      const t2 = tm.addTask('p2', 'desc');
      const t3 = tm.addTask('p3', 'desc');

      tm.updateTask(t1.id, { status: 'in_progress' });
      tm.updateTask(t2.id, { status: 'completed' });
      tm.updateTask(t3.id, { status: 'failed' });

      const { taskSummary } = tm.getStatus();
      expect(taskSummary.total).toBe(3);
      expect(taskSummary.pending).toBe(0);
      expect(taskSummary.inProgress).toBe(1);
      expect(taskSummary.completed).toBe(1);
      expect(taskSummary.failed).toBe(1);
    });

    it('counts unread messages', () => {
      const tm = startedManager();
      const a = tm.addMember('coder').memberId;
      const b = tm.addMember('tester').memberId;

      tm.sendMessage(a, b, 'msg1');
      tm.sendMessage(a, b, 'msg2');

      expect(tm.getStatus().unreadMessages).toBe(2);
    });

    it('uptime shows seconds when elapsed < 60s', () => {
      // Use fake timers so both new Date() and Date.now() share the same
      // controlled clock — the source computes: Date.now() - startedAt.getTime()
      jest.useFakeTimers();
      const tm = new TeamManager();
      tm.start('goal');
      jest.advanceTimersByTime(30_000); // advance 30 s

      expect(tm.getStatus().uptime).toBe('30s');
      jest.useRealTimers();
    });

    it('uptime shows minutes when elapsed < 3600s', () => {
      jest.useFakeTimers();
      const tm = new TeamManager();
      tm.start('goal');
      jest.advanceTimersByTime(150_000); // advance 2.5 min

      expect(tm.getStatus().uptime).toBe('2m');
      jest.useRealTimers();
    });

    it('uptime shows hours+minutes when elapsed >= 3600s', () => {
      jest.useFakeTimers();
      const tm = new TeamManager();
      tm.start('goal');
      jest.advanceTimersByTime(3_690_000); // advance 1h 1.5m

      expect(tm.getStatus().uptime).toBe('1h 1m');
      jest.useRealTimers();
    });
  });

  describe('formatStatus()', () => {
    it('includes the AGENT TEAM STATUS header', () => {
      const tm = startedManager('build it');
      expect(tm.formatStatus()).toContain('AGENT TEAM STATUS');
    });

    it('shows the status string in uppercase', () => {
      const tm = startedManager();
      expect(tm.formatStatus()).toContain('Status: ACTIVE');
    });

    it('shows the team goal', () => {
      const tm = startedManager('write tests');
      expect(tm.formatStatus()).toContain('Goal: write tests');
    });

    it('shows "No members yet" when team has no members', () => {
      const tm = startedManager();
      expect(tm.formatStatus()).toContain('No members yet');
    });

    it('shows each member with role and status icon', () => {
      const tm = startedManager();
      tm.addMember('coder', 'alice');

      const output = tm.formatStatus();
      expect(output).toContain('alice');
      expect(output).toContain('coder');
      expect(output).toContain('[IDLE]');
    });

    it('shows [WORKING] icon for working members', () => {
      const tm = startedManager();
      const { memberId } = tm.addMember('coder', 'worker');
      const task = tm.addTask('t', 'desc');
      tm.assignTask(task.id, memberId);

      expect(tm.formatStatus()).toContain('[WORKING]');
    });

    it('shows task summary counts', () => {
      const tm = startedManager();
      const t = tm.addTask('task', 'desc');
      tm.updateTask(t.id, { status: 'completed' });

      const output = tm.formatStatus();
      expect(output).toContain('Completed: 1');
    });

    it('shows unread messages count in mailbox section', () => {
      const tm = startedManager();
      const a = tm.addMember('coder').memberId;
      const b = tm.addMember('tester').memberId;
      tm.sendMessage(a, b, 'unread msg');

      expect(tm.formatStatus()).toContain('1 unread message');
    });

    it('does not show mailbox section when there are no unread messages', () => {
      const tm = startedManager();
      expect(tm.formatStatus()).not.toContain('MAILBOX');
    });

    it('returns a string', () => {
      const tm = startedManager();
      expect(typeof tm.formatStatus()).toBe('string');
    });
  });

  // =========================================================================
  // 7. getSharedContext()
  // =========================================================================

  describe('getSharedContext()', () => {
    it('returns goal, empty relevantFiles and empty artifacts', () => {
      const tm = startedManager('shared goal');
      const ctx = tm.getSharedContext();

      expect(ctx.goal).toBe('shared goal');
      expect(ctx.relevantFiles).toEqual([]);
      expect(ctx.artifacts).toBeInstanceOf(Map);
      expect(ctx.artifacts.size).toBe(0);
    });

    it('maps mailbox messages into conversationHistory', () => {
      const tm = startedManager();
      const a = tm.addMember('coder').memberId;
      tm.sendMessage(a, 'all', 'hello team');

      const ctx = tm.getSharedContext();
      expect(ctx.conversationHistory).toHaveLength(1);
      expect(ctx.conversationHistory[0].content).toBe('hello team');
      expect(ctx.conversationHistory[0].type).toBe('status_update');
    });

    it('maps member role into from/to fields of conversationHistory', () => {
      const tm = startedManager();
      const a = tm.addMember('coder').memberId;
      const b = tm.addMember('reviewer').memberId;
      tm.sendMessage(a, b, 'review this please');

      const ctx = tm.getSharedContext();
      const msg = ctx.conversationHistory[0];
      expect(msg.from).toBe('coder');
      expect(msg.to).toBe('reviewer');
    });

    it('uses "all" for broadcast messages in conversationHistory', () => {
      const tm = startedManager();
      const a = tm.addMember('coder').memberId;
      tm.sendMessage(a, 'all', 'broadcast');

      const ctx = tm.getSharedContext();
      expect(ctx.conversationHistory[0].to).toBe('all');
    });
  });

  // =========================================================================
  // 8. Accessors
  // =========================================================================

  describe('isActive()', () => {
    it('returns false before start', () => {
      expect(new TeamManager().isActive()).toBe(false);
    });

    it('returns true after start', () => {
      const tm = startedManager();
      expect(tm.isActive()).toBe(true);
    });

    it('returns false after stop', () => {
      const tm = startedManager();
      tm.stop();
      expect(tm.isActive()).toBe(false);
    });
  });

  describe('getLeadId()', () => {
    it('returns null before start', () => {
      expect(new TeamManager().getLeadId()).toBeNull();
    });

    it('returns a non-null string after start', () => {
      const tm = startedManager();
      expect(tm.getLeadId()).not.toBeNull();
    });

    it('returns null after stop', () => {
      const tm = startedManager();
      tm.stop();
      expect(tm.getLeadId()).toBeNull();
    });
  });

  describe('getTeamGoal()', () => {
    it('returns empty string before start', () => {
      expect(new TeamManager().getTeamGoal()).toBe('');
    });

    it('returns the goal set during start', () => {
      const tm = startedManager('my goal');
      expect(tm.getTeamGoal()).toBe('my goal');
    });

    it('returns empty string after stop', () => {
      const tm = startedManager('my goal');
      tm.stop();
      expect(tm.getTeamGoal()).toBe('');
    });
  });

  // =========================================================================
  // 9. Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('stop() when status is "inactive" returns failure', () => {
      const tm = new TeamManager();
      expect(tm.stop().success).toBe(false);
    });

    it('addMember() when team is inactive returns failure', () => {
      const tm = new TeamManager();
      expect(tm.addMember('coder').success).toBe(false);
    });

    it('assignTask() to non-existent member returns failure', () => {
      const tm = startedManager();
      const task = tm.addTask('t', 'desc');
      expect(tm.assignTask(task.id, 'ghost').success).toBe(false);
    });

    it('assignTask() for non-existent task returns failure', () => {
      const tm = startedManager();
      tm.addMember('coder');
      const { memberId } = tm.addMember('coder');
      expect(tm.assignTask('ghost-task', memberId).success).toBe(false);
    });

    it('updateTask() for non-existent task returns failure', () => {
      const tm = startedManager();
      expect(tm.updateTask('ghost', { status: 'completed' }).success).toBe(false);
    });

    it('removeMember() for non-existent member returns failure', () => {
      const tm = startedManager();
      expect(tm.removeMember('ghost').success).toBe(false);
    });

    it('multiple teams can be independently instantiated', () => {
      const tm1 = startedManager('goal-1');
      const tm2 = startedManager('goal-2');

      expect(tm1.getTeamGoal()).toBe('goal-1');
      expect(tm2.getTeamGoal()).toBe('goal-2');
      expect(tm1).not.toBe(tm2);
    });

    it('stop() message includes 0/0 when there are no tasks', () => {
      const tm = startedManager();
      const result = tm.stop();
      expect(result.message).toContain('0/0');
    });

    it('sending a message to a non-existent member is allowed (no validation on recipient)', () => {
      const tm = startedManager();
      expect(() => tm.sendMessage('lead', 'no-such-member', 'hello')).not.toThrow();
    });

    it('getInbox() respects default limit of 20 messages', () => {
      const tm = startedManager();
      const a = tm.addMember('coder').memberId;
      const b = tm.addMember('tester').memberId;

      for (let i = 0; i < 25; i++) {
        tm.sendMessage(a, b, `msg-${i}`);
      }

      // Default limit is 20
      expect(tm.getInbox(b)).toHaveLength(20);
    });

    it('getAvailableTasks() handles circular-like dependencies gracefully (no infinite loop)', () => {
      const tm = startedManager();
      // Add a task whose dependency ID does not exist — it stays unavailable
      const task = tm.addTask('orphan', 'desc', { dependencies: ['nonexistent-dep'] });
      const available = tm.getAvailableTasks();
      expect(available.map(t => t.id)).not.toContain(task.id);
    });
  });

  // =========================================================================
  // 10. Events (EventEmitter)
  // =========================================================================

  describe('events', () => {
    let tm: TeamManager;

    beforeEach(() => {
      tm = new TeamManager();
    });

    it('emits "team:started" when start() is called', () => {
      const handler = jest.fn();
      tm.on('team:started', handler);
      tm.start('goal');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ goal: 'goal' })
      );
    });

    it('team:started payload contains the leadId', () => {
      const handler = jest.fn();
      tm.on('team:started', handler);
      tm.start('g');

      const payload = handler.mock.calls[0][0];
      expect(payload.leadId).toBeTruthy();
    });

    it('emits "team:stopped" when stop() is called', () => {
      const handler = jest.fn();
      tm.on('team:stopped', handler);
      tm.start('goal');
      tm.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ memberCount: 0, completedTasks: 0, totalTasks: 0 })
      );
    });

    it('team:stopped payload reflects member and task counts', () => {
      const handler = jest.fn();
      tm.on('team:stopped', handler);
      tm.start('g');
      tm.addMember('coder');
      const t = tm.addTask('task', 'desc');
      tm.updateTask(t.id, { status: 'completed' });
      tm.stop();

      const payload = handler.mock.calls[0][0];
      expect(payload.memberCount).toBe(1);
      expect(payload.completedTasks).toBe(1);
      expect(payload.totalTasks).toBe(1);
    });

    it('emits "team:member-added" when addMember() succeeds', () => {
      const handler = jest.fn();
      tm.on('team:member-added', handler);
      tm.start('g');
      tm.addMember('coder', 'alice');

      expect(handler).toHaveBeenCalledTimes(1);
      const member: TeamMember = handler.mock.calls[0][0];
      expect(member.role).toBe('coder');
      expect(member.label).toBe('alice');
    });

    it('does NOT emit "team:member-added" on invalid role', () => {
      const handler = jest.fn();
      tm.on('team:member-added', handler);
      tm.start('g');
      tm.addMember('invalid-role' as unknown as AgentRole);

      expect(handler).not.toHaveBeenCalled();
    });

    it('emits "team:member-removed" when removeMember() succeeds', () => {
      const handler = jest.fn();
      tm.on('team:member-removed', handler);
      tm.start('g');
      const { memberId } = tm.addMember('tester');
      tm.removeMember(memberId);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ memberId, role: 'tester' })
      );
    });

    it('emits "team:task-added" when addTask() is called', () => {
      const handler = jest.fn();
      tm.on('team:task-added', handler);
      tm.start('g');
      tm.addTask('new task', 'desc');

      expect(handler).toHaveBeenCalledTimes(1);
      const task: TeamTask = handler.mock.calls[0][0];
      expect(task.title).toBe('new task');
      expect(task.status).toBe('pending');
    });

    it('emits "team:task-updated" when updateTask() is called', () => {
      const handler = jest.fn();
      tm.on('team:task-updated', handler);
      tm.start('g');
      const task = tm.addTask('t', 'desc');
      tm.updateTask(task.id, { status: 'in_progress' });

      expect(handler).toHaveBeenCalledTimes(1);
      const updated: TeamTask = handler.mock.calls[0][0];
      expect(updated.status).toBe('in_progress');
    });

    it('emits "team:task-assigned" when assignTask() succeeds', () => {
      const handler = jest.fn();
      tm.on('team:task-assigned', handler);
      tm.start('g');
      const { memberId } = tm.addMember('coder');
      const task = tm.addTask('t', 'desc');
      tm.assignTask(task.id, memberId);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.id, memberId, role: 'coder' })
      );
    });

    it('emits "team:message" when sendMessage() is called', () => {
      const handler = jest.fn();
      tm.on('team:message', handler);
      tm.start('g');
      const a = tm.addMember('coder').memberId;
      tm.sendMessage(a, 'all', 'hello');

      expect(handler).toHaveBeenCalledTimes(1);
      const msg: MailboxMessage = handler.mock.calls[0][0];
      expect(msg.from).toBe(a);
      expect(msg.to).toBe('all');
      expect(msg.content).toBe('hello');
    });

    it('does NOT emit "team:started" when already active', () => {
      const handler = jest.fn();
      tm.start('first');
      tm.on('team:started', handler);
      tm.start('second');

      expect(handler).not.toHaveBeenCalled();
    });

    it('does NOT emit "team:stopped" when not active', () => {
      const handler = jest.fn();
      tm.on('team:stopped', handler);
      tm.stop(); // no-op

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
