/**
 * Tests for TodoTracker — Manus AI attention bias
 *
 * Uses real fs in a tmpDir to match the production code path.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { TodoTracker, getTodoTracker } from '../../src/agent/todo-tracker';

describe('TodoTracker', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('getTodoTracker (singleton)', () => {
    it('should return the same instance for the same directory', () => {
      const a = getTodoTracker(tmpDir);
      const b = getTodoTracker(tmpDir);
      expect(a).toBe(b);
    });

    it('should return different instances for different directories', async () => {
      const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-test2-'));
      try {
        const a = getTodoTracker(tmpDir);
        const b = getTodoTracker(tmpDir2);
        expect(a).not.toBe(b);
      } finally {
        await fs.remove(tmpDir2);
      }
    });
  });

  // --------------------------------------------------------------------------
  // add()
  // --------------------------------------------------------------------------

  describe('add()', () => {
    it('should return a TodoItem with generated id and pending status', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Write tests');
      expect(item.id).toBeTruthy();
      expect(item.status).toBe('pending');
      expect(item.text).toBe('Write tests');
    });

    it('should default priority to medium', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Task');
      expect(item.priority).toBe('medium');
    });

    it('should accept custom priority', () => {
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.add('Urgent', 'high').priority).toBe('high');
      expect(tracker.add('Later', 'low').priority).toBe('low');
    });

    it('should set createdAt and updatedAt', () => {
      const tracker = new TodoTracker(tmpDir);
      const before = Date.now();
      const item = tracker.add('Timed');
      const after = Date.now();
      expect(item.createdAt).toBeGreaterThanOrEqual(before);
      expect(item.createdAt).toBeLessThanOrEqual(after);
      expect(item.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('should initialize empty subtasks array', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('No subs');
      expect(item.subtasks).toEqual([]);
    });

    it('should persist to disk after add', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('Persisted');
      expect(fs.existsSync(path.join(tmpDir, 'todo.md'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // complete()
  // --------------------------------------------------------------------------

  describe('complete()', () => {
    it('should set status to done and return true', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('To complete');
      expect(tracker.complete(item.id)).toBe(true);
      expect(tracker.getAll().find(i => i.id === item.id)?.status).toBe('done');
    });

    it('should return false for non-existent id', () => {
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.complete('nonexistent')).toBe(false);
    });

    it('should update updatedAt timestamp', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Timestamped');
      const before = item.updatedAt;
      // Small delay to ensure timestamp changes
      const result = tracker.complete(item.id);
      expect(result).toBe(true);
      const updated = tracker.getAll().find(i => i.id === item.id);
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // --------------------------------------------------------------------------
  // update()
  // --------------------------------------------------------------------------

  describe('update()', () => {
    it('should update text when provided', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Original');
      tracker.update(item.id, { text: 'Modified' });
      expect(tracker.getAll()[0].text).toBe('Modified');
    });

    it('should update status when provided', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Status change');
      tracker.update(item.id, { status: 'in_progress' });
      expect(tracker.getAll()[0].status).toBe('in_progress');
    });

    it('should update priority when provided', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Prio change');
      tracker.update(item.id, { priority: 'high' });
      expect(tracker.getAll()[0].priority).toBe('high');
    });

    it('should handle partial updates (only one field)', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Partial');
      tracker.update(item.id, { text: 'New text' });
      const updated = tracker.getAll()[0];
      expect(updated.text).toBe('New text');
      expect(updated.status).toBe('pending');
      expect(updated.priority).toBe('medium');
    });

    it('should return false for non-existent id', () => {
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.update('nope', { text: 'x' })).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // remove()
  // --------------------------------------------------------------------------

  describe('remove()', () => {
    it('should remove item by id and return true', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('To remove');
      expect(tracker.remove(item.id)).toBe(true);
      expect(tracker.getAll()).toHaveLength(0);
    });

    it('should persist after removal', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Remove me');
      tracker.remove(item.id);

      const tracker2 = new TodoTracker(tmpDir);
      expect(tracker2.getAll()).toHaveLength(0);
    });

    it('should return false for non-existent id', () => {
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.remove('ghost')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // clearDone()
  // --------------------------------------------------------------------------

  describe('clearDone()', () => {
    it('should remove all done items and return count', () => {
      const tracker = new TodoTracker(tmpDir);
      const a = tracker.add('Done 1');
      tracker.add('Pending 1');
      const b = tracker.add('Done 2');
      tracker.complete(a.id);
      tracker.complete(b.id);
      expect(tracker.clearDone()).toBe(2);
      expect(tracker.getAll()).toHaveLength(1);
    });

    it('should preserve pending and in_progress items', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('Pending');
      const ip = tracker.add('In progress');
      tracker.update(ip.id, { status: 'in_progress' });
      const done = tracker.add('Done');
      tracker.complete(done.id);
      tracker.clearDone();
      expect(tracker.getAll()).toHaveLength(2);
    });

    it('should return 0 when no done items exist', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('Not done');
      expect(tracker.clearDone()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // getAll / getPending / hasPending
  // --------------------------------------------------------------------------

  describe('getAll / getPending / hasPending', () => {
    it('should return all items via getAll', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('A');
      tracker.add('B');
      const c = tracker.add('C');
      tracker.complete(c.id);
      expect(tracker.getAll()).toHaveLength(3);
    });

    it('should return only non-done items via getPending', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('Pending');
      const done = tracker.add('Done');
      tracker.complete(done.id);
      const pending = tracker.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].text).toBe('Pending');
    });

    it('should return true from hasPending when pending items exist', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('Something');
      expect(tracker.hasPending()).toBe(true);
    });

    it('should return false from hasPending when all done', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Will be done');
      tracker.complete(item.id);
      expect(tracker.hasPending()).toBe(false);
    });

    it('should return false from hasPending when empty', () => {
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.hasPending()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // buildContextSuffix()
  // --------------------------------------------------------------------------

  describe('buildContextSuffix()', () => {
    it('should return null when no items exist', () => {
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.buildContextSuffix()).toBeNull();
    });

    it('should return null when all items are done', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Done');
      tracker.complete(item.id);
      expect(tracker.buildContextSuffix()).toBeNull();
    });

    it('should wrap in <todo_context> tags', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('Task');
      const suffix = tracker.buildContextSuffix()!;
      expect(suffix).toContain('<todo_context>');
      expect(suffix).toContain('</todo_context>');
    });

    it('should show status icons', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('Pending task');
      const ip = tracker.add('In progress');
      tracker.update(ip.id, { status: 'in_progress' });
      const blocked = tracker.add('Blocked');
      tracker.update(blocked.id, { status: 'blocked' });

      const suffix = tracker.buildContextSuffix()!;
      expect(suffix).toContain('⬜');
      expect(suffix).toContain('🔄');
      expect(suffix).toContain('🚫');
    });

    it('should show [HIGH] and [low] priority tags', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('High prio', 'high');
      tracker.add('Low prio', 'low');
      tracker.add('Medium prio', 'medium');

      const suffix = tracker.buildContextSuffix()!;
      expect(suffix).toContain('[HIGH]');
      expect(suffix).toContain('[low]');
      // medium has no tag
      expect(suffix).not.toMatch(/\[medium\]/);
    });

    it('should include item ids', () => {
      const tracker = new TodoTracker(tmpDir);
      const item = tracker.add('Identified');
      const suffix = tracker.buildContextSuffix()!;
      expect(suffix).toContain(`[${item.id}]`);
    });

    it('should render subtasks indented under parent', () => {
      const tracker = new TodoTracker(tmpDir);
      // Create a todo.md with subtasks manually
      const md = `# Todo
<!-- test -->

- [ ] <!--parent1:in_progress:medium--> Parent task
  - [ ] Sub task A
  - [x] Sub task B done
`;
      fs.writeFileSync(path.join(tmpDir, 'todo.md'), md);
      const tracker2 = new TodoTracker(tmpDir);
      const suffix = tracker2.buildContextSuffix()!;
      expect(suffix).toContain('Parent task');
      expect(suffix).toContain('Sub task A');
    });
  });

  // --------------------------------------------------------------------------
  // Persistence (round-trip)
  // --------------------------------------------------------------------------

  describe('persistence', () => {
    it('should save and reload items across instances', () => {
      const t1 = new TodoTracker(tmpDir);
      t1.add('Alpha', 'high');
      const beta = t1.add('Beta');
      t1.update(beta.id, { status: 'in_progress' });

      const t2 = new TodoTracker(tmpDir);
      const items = t2.getAll();
      expect(items).toHaveLength(2);
      expect(items[0].text).toBe('Alpha');
      expect(items[0].priority).toBe('high');
      expect(items[0].status).toBe('pending');
      expect(items[1].text).toBe('Beta');
      expect(items[1].status).toBe('in_progress');
    });

    it('should preserve id through serialise/parse cycle', () => {
      const t1 = new TodoTracker(tmpDir);
      const item = t1.add('Persistent ID');
      const originalId = item.id;

      const t2 = new TodoTracker(tmpDir);
      expect(t2.getAll()[0].id).toBe(originalId);
    });
  });

  // --------------------------------------------------------------------------
  // parseMd edge cases
  // --------------------------------------------------------------------------

  describe('parseMd', () => {
    it('should parse metadata format correctly', () => {
      const md = `# Todo\n\n- [ ] <!--abc:pending:high--> Important task\n`;
      fs.writeFileSync(path.join(tmpDir, 'todo.md'), md);
      const tracker = new TodoTracker(tmpDir);
      const items = tracker.getAll();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('abc');
      expect(items[0].status).toBe('pending');
      expect(items[0].priority).toBe('high');
      expect(items[0].text).toBe('Important task');
    });

    it('should parse plain markdown checkboxes without metadata', () => {
      const md = `- [ ] Plain pending\n- [x] Plain done\n`;
      fs.writeFileSync(path.join(tmpDir, 'todo.md'), md);
      const tracker = new TodoTracker(tmpDir);
      const items = tracker.getAll();
      expect(items).toHaveLength(2);
      expect(items[0].status).toBe('pending');
      expect(items[1].status).toBe('done');
    });

    it('should parse subtasks (indented checkboxes)', () => {
      const md = `- [ ] <!--p1:pending:medium--> Parent\n  - [ ] Child A\n  - [x] Child B\n`;
      fs.writeFileSync(path.join(tmpDir, 'todo.md'), md);
      const tracker = new TodoTracker(tmpDir);
      const items = tracker.getAll();
      expect(items).toHaveLength(1);
      expect(items[0].subtasks).toHaveLength(2);
      expect(items[0].subtasks[0].text).toBe('Child A');
      expect(items[0].subtasks[0].status).toBe('pending');
      expect(items[0].subtasks[1].text).toBe('Child B');
      expect(items[0].subtasks[1].status).toBe('done');
    });

    it('should handle empty file gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, 'todo.md'), '');
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.getAll()).toHaveLength(0);
    });

    it('should handle file with only headers', () => {
      fs.writeFileSync(path.join(tmpDir, 'todo.md'), '# Todo\n<!-- comment -->\n');
      const tracker = new TodoTracker(tmpDir);
      expect(tracker.getAll()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should not crash when workDir does not exist', () => {
      const tracker = new TodoTracker(path.join(tmpDir, 'nonexistent'));
      expect(() => tracker.add('test')).not.toThrow();
    });

    it('should load only once (idempotent)', () => {
      const tracker = new TodoTracker(tmpDir);
      tracker.add('First');
      // Force internal load multiple times
      tracker.load();
      tracker.load();
      expect(tracker.getAll()).toHaveLength(1);
    });
  });
});
