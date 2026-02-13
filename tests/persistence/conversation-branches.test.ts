/**
 * Tests for ConversationBranchManager
 *
 * Comprehensive tests covering:
 * - Branch creation
 * - Branch switching (checkout)
 * - Branch listing and tree structure
 * - Branch merging (append and replace strategies)
 * - Fork from current position
 * - Fork from specific message index
 * - Branch deletion
 * - Branch renaming
 * - Message management (add, set, get)
 * - Branch history traversal
 * - Event emission
 * - Formatting
 * - Singleton management
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  ConversationBranchManager,
  ConversationBranch,
  getBranchManager,
  resetBranchManager,
} from '../../src/persistence/conversation-branches';

describe('ConversationBranchManager', () => {
  let manager: ConversationBranchManager;
  let tmpDir: string;
  let sessionId: string;

  beforeEach(async () => {
    // Use unique session ID to isolate tests
    sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Create the branch manager with our unique session
    manager = new ConversationBranchManager(sessionId);

    // Find the storage path for cleanup
    tmpDir = path.join(os.homedir(), '.codebuddy', 'branches', sessionId);
  });

  afterEach(async () => {
    // Clean up the branches directory
    try {
      await fs.remove(tmpDir);
    } catch { /* ignore */ }

    // Reset singleton
    resetBranchManager();
  });

  describe('Initialization', () => {
    it('should create main branch on initialization', () => {
      const branches = manager.getAllBranches();
      expect(branches.length).toBeGreaterThanOrEqual(1);

      const main = branches.find(b => b.id === 'main');
      expect(main).toBeDefined();
      expect(main!.name).toBe('Main conversation');
    });

    it('should start on main branch', () => {
      expect(manager.getCurrentBranchId()).toBe('main');
    });

    it('should have empty messages on main branch initially', () => {
      const messages = manager.getMessages();
      expect(messages).toEqual([]);
    });
  });

  describe('Branch Creation', () => {
    it('should create a new branch', () => {
      const branch = manager.createBranch('test-branch', 'Test Branch');

      expect(branch.id).toBe('test-branch');
      expect(branch.name).toBe('Test Branch');
      expect(branch.messages).toEqual([]);
      expect(branch.createdAt).toBeInstanceOf(Date);
      expect(branch.updatedAt).toBeInstanceOf(Date);
    });

    it('should create branch with parent', () => {
      // Add messages to main
      manager.addMessage({ role: 'user', content: 'msg1' });
      manager.addMessage({ role: 'assistant', content: 'msg2' });
      manager.addMessage({ role: 'user', content: 'msg3' });

      const branch = manager.createBranch('child', 'Child Branch', 'main', 2);

      expect(branch.parentId).toBe('main');
      expect(branch.parentMessageIndex).toBe(2);
      // Should copy first 2 messages from parent
      expect(branch.messages.length).toBe(2);
      expect(branch.messages[0].content).toBe('msg1');
      expect(branch.messages[1].content).toBe('msg2');
    });

    it('should deep copy messages from parent (no shared references)', () => {
      manager.addMessage({ role: 'user', content: 'original' });

      const branch = manager.createBranch('child', 'Child', 'main', 1);

      // Modify the child's message
      branch.messages[0].content = 'modified';

      // Parent should be unaffected
      const mainMessages = manager.getMessages();
      expect(mainMessages[0].content).toBe('original');
    });

    it('should emit branch:created event', () => {
      const listener = jest.fn();
      manager.on('branch:created', listener);

      manager.createBranch('event-test', 'Event Test');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'event-test',
          name: 'Event Test',
        })
      );
    });

    it('should persist branch to disk', () => {
      manager.createBranch('persisted', 'Persisted Branch');

      const filePath = path.join(tmpDir, 'persisted.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const data = fs.readJsonSync(filePath);
      expect(data.id).toBe('persisted');
      expect(data.name).toBe('Persisted Branch');
    });

    it('should copy all messages when no parentMessageIndex provided', () => {
      manager.addMessage({ role: 'user', content: 'msg1' });
      manager.addMessage({ role: 'assistant', content: 'msg2' });

      const branch = manager.createBranch('child', 'Child', 'main');

      expect(branch.messages.length).toBe(2);
    });
  });

  describe('Fork', () => {
    it('should fork from current branch at current position', () => {
      manager.addMessage({ role: 'user', content: 'msg1' });
      manager.addMessage({ role: 'assistant', content: 'msg2' });

      const forked = manager.fork('Forked Branch');

      expect(forked.parentId).toBe('main');
      expect(forked.parentMessageIndex).toBe(2);
      expect(forked.messages.length).toBe(2);
      expect(forked.name).toBe('Forked Branch');
    });

    it('should switch to forked branch automatically', () => {
      manager.addMessage({ role: 'user', content: 'msg1' });

      const forked = manager.fork('Auto-switch');

      expect(manager.getCurrentBranchId()).toBe(forked.id);
    });

    it('should emit branch:forked event', () => {
      const listener = jest.fn();
      manager.on('branch:forked', listener);

      manager.fork('Forked');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'main',
          name: 'Forked',
        })
      );
    });

    it('should generate unique IDs for forked branches', () => {
      const fork1 = manager.fork('Fork 1');
      // Switch back to main to fork again
      manager.checkout('main');
      const fork2 = manager.fork('Fork 2');

      expect(fork1.id).not.toBe(fork2.id);
    });
  });

  describe('Fork From Message', () => {
    it('should fork from specific message index', () => {
      manager.addMessage({ role: 'user', content: 'msg1' });
      manager.addMessage({ role: 'assistant', content: 'msg2' });
      manager.addMessage({ role: 'user', content: 'msg3' });

      const forked = manager.forkFromMessage('Partial Fork', 1);

      expect(forked.parentMessageIndex).toBe(1);
      expect(forked.messages.length).toBe(1);
      expect(forked.messages[0].content).toBe('msg1');
    });

    it('should switch to the forked branch', () => {
      manager.addMessage({ role: 'user', content: 'msg1' });

      const forked = manager.forkFromMessage('Switch Fork', 1);

      expect(manager.getCurrentBranchId()).toBe(forked.id);
    });
  });

  describe('Checkout (Switch Branch)', () => {
    it('should switch to existing branch', () => {
      manager.createBranch('target', 'Target Branch');

      const result = manager.checkout('target');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('target');
      expect(manager.getCurrentBranchId()).toBe('target');
    });

    it('should return null for non-existent branch', () => {
      const result = manager.checkout('nonexistent');
      expect(result).toBeNull();
    });

    it('should emit branch:checkout event', () => {
      const listener = jest.fn();
      manager.on('branch:checkout', listener);

      manager.createBranch('target', 'Target');
      manager.checkout('target');

      expect(listener).toHaveBeenCalledWith({
        from: 'main',
        to: 'target',
      });
    });

    it('should switch message context when checking out', () => {
      manager.addMessage({ role: 'user', content: 'main msg' });

      const branch = manager.createBranch('other', 'Other');
      manager.checkout('other');

      // Other branch has no messages
      expect(manager.getMessages().length).toBe(0);

      // Switch back to main
      manager.checkout('main');
      expect(manager.getMessages().length).toBe(1);
      expect(manager.getMessages()[0].content).toBe('main msg');
    });
  });

  describe('Merge', () => {
    it('should merge with append strategy', () => {
      // Add messages to main
      manager.addMessage({ role: 'user', content: 'main msg 1' });
      manager.addMessage({ role: 'assistant', content: 'main msg 2' });

      // Create a branch and add messages to it
      manager.createBranch('source', 'Source', 'main', 2);
      manager.checkout('source');
      manager.addMessage({ role: 'user', content: 'source msg 1' });
      manager.addMessage({ role: 'assistant', content: 'source msg 2' });

      // Switch back to main and merge
      manager.checkout('main');
      const result = manager.merge('source', 'append');

      expect(result).toBe(true);

      // Main should have original + new messages from source
      const messages = manager.getMessages();
      expect(messages.length).toBeGreaterThan(2);
    });

    it('should merge with replace strategy', () => {
      manager.addMessage({ role: 'user', content: 'original' });

      manager.createBranch('source', 'Source');
      manager.checkout('source');
      manager.addMessage({ role: 'user', content: 'replaced' });

      manager.checkout('main');
      const result = manager.merge('source', 'replace');

      expect(result).toBe(true);

      const messages = manager.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('replaced');
    });

    it('should not merge branch into itself', () => {
      const result = manager.merge('main');
      expect(result).toBe(false);
    });

    it('should not merge non-existent branch', () => {
      const result = manager.merge('nonexistent');
      expect(result).toBe(false);
    });

    it('should emit branch:merged event', () => {
      const listener = jest.fn();
      manager.on('branch:merged', listener);

      manager.createBranch('source', 'Source');
      manager.checkout('source');
      manager.addMessage({ role: 'user', content: 'msg' });
      manager.checkout('main');

      manager.merge('source', 'append');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'source',
          target: 'main',
          strategy: 'append',
        })
      );
    });

    it('should use append strategy by default', () => {
      manager.createBranch('source', 'Source');
      manager.checkout('source');
      manager.addMessage({ role: 'user', content: 'msg' });
      manager.checkout('main');

      const listener = jest.fn();
      manager.on('branch:merged', listener);

      manager.merge('source');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'append' })
      );
    });
  });

  describe('Delete Branch', () => {
    it('should delete existing branch', () => {
      manager.createBranch('to-delete', 'Delete Me');

      const result = manager.deleteBranch('to-delete');
      expect(result).toBe(true);

      const branches = manager.getAllBranches();
      expect(branches.find(b => b.id === 'to-delete')).toBeUndefined();
    });

    it('should not delete main branch', () => {
      const result = manager.deleteBranch('main');
      expect(result).toBe(false);

      const branches = manager.getAllBranches();
      expect(branches.find(b => b.id === 'main')).toBeDefined();
    });

    it('should switch to main when deleting current branch', () => {
      manager.createBranch('current', 'Current');
      manager.checkout('current');

      expect(manager.getCurrentBranchId()).toBe('current');

      manager.deleteBranch('current');

      expect(manager.getCurrentBranchId()).toBe('main');
    });

    it('should return false for non-existent branch', () => {
      const result = manager.deleteBranch('nonexistent');
      expect(result).toBe(false);
    });

    it('should emit branch:deleted event', () => {
      const listener = jest.fn();
      manager.on('branch:deleted', listener);

      manager.createBranch('to-delete', 'Delete Me');
      manager.deleteBranch('to-delete');

      expect(listener).toHaveBeenCalledWith({ id: 'to-delete' });
    });

    it('should remove branch file from disk', () => {
      manager.createBranch('disk-delete', 'Disk Delete');

      const filePath = path.join(tmpDir, 'disk-delete.json');
      expect(fs.existsSync(filePath)).toBe(true);

      manager.deleteBranch('disk-delete');

      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('Rename Branch', () => {
    it('should rename existing branch', () => {
      manager.createBranch('rename-me', 'Old Name');

      const result = manager.renameBranch('rename-me', 'New Name');
      expect(result).toBe(true);

      const branches = manager.getAllBranches();
      const renamed = branches.find(b => b.id === 'rename-me');
      expect(renamed!.name).toBe('New Name');
    });

    it('should return false for non-existent branch', () => {
      const result = manager.renameBranch('nonexistent', 'New Name');
      expect(result).toBe(false);
    });

    it('should emit branch:renamed event', () => {
      const listener = jest.fn();
      manager.on('branch:renamed', listener);

      manager.createBranch('rename-event', 'Old');
      manager.renameBranch('rename-event', 'New');

      expect(listener).toHaveBeenCalledWith({
        id: 'rename-event',
        name: 'New',
      });
    });

    it('should update the updatedAt timestamp', async () => {
      manager.createBranch('rename-time', 'Original');

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.renameBranch('rename-time', 'Renamed');

      const branches = manager.getAllBranches();
      const branch = branches.find(b => b.id === 'rename-time');
      expect(branch!.updatedAt.getTime()).toBeGreaterThanOrEqual(branch!.createdAt.getTime());
    });
  });

  describe('Message Management', () => {
    it('should add message to current branch', () => {
      manager.addMessage({ role: 'user', content: 'Hello' });

      const messages = manager.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('should add multiple messages in order', () => {
      manager.addMessage({ role: 'user', content: 'msg1' });
      manager.addMessage({ role: 'assistant', content: 'msg2' });
      manager.addMessage({ role: 'user', content: 'msg3' });

      const messages = manager.getMessages();
      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe('msg1');
      expect(messages[1].content).toBe('msg2');
      expect(messages[2].content).toBe('msg3');
    });

    it('should set messages for current branch', () => {
      manager.addMessage({ role: 'user', content: 'old' });

      manager.setMessages([
        { role: 'user', content: 'new1' },
        { role: 'assistant', content: 'new2' },
      ]);

      const messages = manager.getMessages();
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe('new1');
    });

    it('should add messages to the active branch only', () => {
      manager.addMessage({ role: 'user', content: 'main msg' });

      manager.createBranch('other', 'Other');
      manager.checkout('other');
      manager.addMessage({ role: 'user', content: 'other msg' });

      // Check other branch has its message
      expect(manager.getMessages().length).toBe(1);
      expect(manager.getMessages()[0].content).toBe('other msg');

      // Check main still has only its message
      manager.checkout('main');
      expect(manager.getMessages().length).toBe(1);
      expect(manager.getMessages()[0].content).toBe('main msg');
    });
  });

  describe('Branch Listing', () => {
    it('should return all branches sorted by updatedAt', () => {
      manager.createBranch('branch-a', 'Branch A');
      manager.createBranch('branch-b', 'Branch B');

      const branches = manager.getAllBranches();
      expect(branches.length).toBe(3); // main + 2

      // Most recently updated should be first
      for (let i = 0; i < branches.length - 1; i++) {
        expect(branches[i].updatedAt.getTime())
          .toBeGreaterThanOrEqual(branches[i + 1].updatedAt.getTime());
      }
    });
  });

  describe('Branch Tree', () => {
    it('should build tree structure', () => {
      manager.createBranch('child1', 'Child 1', 'main');
      manager.createBranch('child2', 'Child 2', 'main');

      const tree = manager.getBranchTree();
      expect(tree.length).toBeGreaterThanOrEqual(1);

      // Find the main branch root
      const mainRoot = tree.find(t => t.branch.id === 'main');
      expect(mainRoot).toBeDefined();
      expect(mainRoot!.children.length).toBe(2);
    });

    it('should handle nested branches', () => {
      manager.createBranch('child', 'Child', 'main');
      manager.createBranch('grandchild', 'Grandchild', 'child');

      const tree = manager.getBranchTree();
      const mainRoot = tree.find(t => t.branch.id === 'main');
      expect(mainRoot).toBeDefined();

      const childNode = mainRoot!.children.find(c => c.branch.id === 'child');
      expect(childNode).toBeDefined();
      expect(childNode!.children.length).toBe(1);
      expect(childNode!.children[0].branch.id).toBe('grandchild');
    });
  });

  describe('Branch History', () => {
    it('should return ancestry chain', () => {
      manager.createBranch('child', 'Child', 'main');
      manager.createBranch('grandchild', 'Grandchild', 'child');

      const history = manager.getBranchHistory('grandchild');
      expect(history.length).toBe(3);
      expect(history[0].id).toBe('main');
      expect(history[1].id).toBe('child');
      expect(history[2].id).toBe('grandchild');
    });

    it('should return single branch for root', () => {
      const history = manager.getBranchHistory('main');
      expect(history.length).toBe(1);
      expect(history[0].id).toBe('main');
    });

    it('should return empty for non-existent branch', () => {
      const history = manager.getBranchHistory('nonexistent');
      expect(history.length).toBe(0);
    });
  });

  describe('Formatting', () => {
    it('should format branches list', () => {
      manager.createBranch('format-test', 'Format Test');

      const output = manager.formatBranches();
      expect(output).toContain('Conversation Branches');
      expect(output).toContain('Main conversation');
      expect(output).toContain('Format Test');
      expect(output).toContain('(current)');
    });

    it('should format branch tree', () => {
      manager.createBranch('tree-child', 'Tree Child', 'main');

      const output = manager.formatBranchTree();
      expect(output).toContain('Branch Tree');
      expect(output).toContain('Main conversation');
      expect(output).toContain('Tree Child');
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch', () => {
      const branch = manager.getCurrentBranch();
      expect(branch.id).toBe('main');
    });

    it('should return main if current branch is deleted externally', () => {
      // Fallback behavior: if currentBranchId not found, return main
      (manager as unknown as { currentBranchId: string }).currentBranchId = 'deleted-branch';

      const branch = manager.getCurrentBranch();
      expect(branch.id).toBe('main');
    });
  });

  describe('Singleton getBranchManager', () => {
    it('should return same instance', () => {
      resetBranchManager();
      const instance1 = getBranchManager('singleton-test');
      const instance2 = getBranchManager('singleton-test');
      expect(instance1).toBe(instance2);

      // Clean up
      resetBranchManager();
      try {
        fs.removeSync(path.join(os.homedir(), '.codebuddy', 'branches', 'singleton-test'));
      } catch { /* ignore */ }
    });

    it('should create new instance after reset', () => {
      resetBranchManager();
      const instance1 = getBranchManager('reset-test-1');
      resetBranchManager();
      const instance2 = getBranchManager('reset-test-2');
      expect(instance1).not.toBe(instance2);

      // Clean up
      resetBranchManager();
      try {
        fs.removeSync(path.join(os.homedir(), '.codebuddy', 'branches', 'reset-test-1'));
        fs.removeSync(path.join(os.homedir(), '.codebuddy', 'branches', 'reset-test-2'));
      } catch { /* ignore */ }
    });
  });
});
