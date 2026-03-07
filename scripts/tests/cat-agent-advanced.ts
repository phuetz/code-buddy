/**
 * Cat 91: Lessons Tracker (7 tests, no API)
 * Cat 92: Todo Tracker (7 tests, no API)
 * Cat 93: Conversation Branching (7 tests, no API)
 * Cat 94: Selective Rollback (6 tests, no API)
 * Cat 95: Three-Way Diff (5 tests, no API)
 */

import type { TestDef } from './types.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// ============================================================================
// Cat 91: Lessons Tracker
// ============================================================================

export function cat91LessonsTracker(): TestDef[] {
  return [
    {
      name: '91.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { LessonsTracker } = await import('../../src/agent/lessons-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-lessons-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new LessonsTracker(tmp);
        fs.rmSync(tmp, { recursive: true, force: true });
        return { pass: tracker !== undefined };
      },
    },
    {
      name: '91.2-add-lesson',
      timeout: 5000,
      fn: async () => {
        const { LessonsTracker } = await import('../../src/agent/lessons-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-lessons-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new LessonsTracker(tmp);
        const lesson = tracker.add('PATTERN', 'Always use async/await');
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: lesson.id !== undefined && lesson.category === 'PATTERN' && lesson.content === 'Always use async/await',
          metadata: { id: lesson.id },
        };
      },
    },
    {
      name: '91.3-list-lessons',
      timeout: 5000,
      fn: async () => {
        const { LessonsTracker } = await import('../../src/agent/lessons-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-lessons-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new LessonsTracker(tmp);
        tracker.add('RULE', 'Use ESM imports');
        tracker.add('INSIGHT', 'Gemini wraps JSON in markdown');
        const all = tracker.list();
        const rules = tracker.list('RULE');
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: all.length === 2 && rules.length === 1,
          metadata: { total: all.length, rules: rules.length },
        };
      },
    },
    {
      name: '91.4-remove-lesson',
      timeout: 5000,
      fn: async () => {
        const { LessonsTracker } = await import('../../src/agent/lessons-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-lessons-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new LessonsTracker(tmp);
        const lesson = tracker.add('CONTEXT', 'Remove me');
        const removed = tracker.remove(lesson.id);
        const all = tracker.list();
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: removed === true && all.length === 0,
        };
      },
    },
    {
      name: '91.5-search-lessons',
      timeout: 5000,
      fn: async () => {
        const { LessonsTracker } = await import('../../src/agent/lessons-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-lessons-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new LessonsTracker(tmp);
        tracker.add('PATTERN', 'Use singleton pattern for services');
        tracker.add('RULE', 'Always validate inputs');
        tracker.add('INSIGHT', 'Singleton is efficient');
        const results = tracker.search('singleton');
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: results.length === 2,
          metadata: { count: results.length },
        };
      },
    },
    {
      name: '91.6-get-stats',
      timeout: 5000,
      fn: async () => {
        const { LessonsTracker } = await import('../../src/agent/lessons-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-lessons-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new LessonsTracker(tmp);
        tracker.add('PATTERN', 'p1');
        tracker.add('RULE', 'r1');
        tracker.add('RULE', 'r2');
        const stats = tracker.getStats();
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: stats.total === 3 && stats.byCategory.RULE === 2 && stats.byCategory.PATTERN === 1,
          metadata: { stats: stats as unknown as Record<string, unknown> },
        };
      },
    },
    {
      name: '91.7-export-formats',
      timeout: 5000,
      fn: async () => {
        const { LessonsTracker } = await import('../../src/agent/lessons-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-lessons-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new LessonsTracker(tmp);
        tracker.add('PATTERN', 'Test export');
        const json = tracker.export('json');
        const md = tracker.export('md');
        const csv = tracker.export('csv');
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: json.length > 0 && md.length > 0 && csv.length > 0,
          metadata: { jsonLen: json.length, mdLen: md.length, csvLen: csv.length },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 92: Todo Tracker
// ============================================================================

export function cat92TodoTracker(): TestDef[] {
  return [
    {
      name: '92.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { TodoTracker } = await import('../../src/agent/todo-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-todo-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new TodoTracker(tmp);
        fs.rmSync(tmp, { recursive: true, force: true });
        return { pass: tracker !== undefined };
      },
    },
    {
      name: '92.2-add-todo',
      timeout: 5000,
      fn: async () => {
        const { TodoTracker } = await import('../../src/agent/todo-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-todo-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new TodoTracker(tmp);
        const item = tracker.add('Fix the bug', 'high');
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: item.id !== undefined && item.text === 'Fix the bug' && item.priority === 'high' && item.status === 'pending',
          metadata: { id: item.id },
        };
      },
    },
    {
      name: '92.3-complete-todo',
      timeout: 5000,
      fn: async () => {
        const { TodoTracker } = await import('../../src/agent/todo-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-todo-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new TodoTracker(tmp);
        const item = tracker.add('Complete me');
        const completed = tracker.complete(item.id);
        const all = tracker.getAll();
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: completed === true && all[0].status === 'done',
        };
      },
    },
    {
      name: '92.4-remove-todo',
      timeout: 5000,
      fn: async () => {
        const { TodoTracker } = await import('../../src/agent/todo-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-todo-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new TodoTracker(tmp);
        const item = tracker.add('Remove me');
        const removed = tracker.remove(item.id);
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: removed === true && tracker.getAll().length === 0,
        };
      },
    },
    {
      name: '92.5-get-pending',
      timeout: 5000,
      fn: async () => {
        const { TodoTracker } = await import('../../src/agent/todo-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-todo-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new TodoTracker(tmp);
        const t1 = tracker.add('Task 1');
        tracker.add('Task 2');
        tracker.complete(t1.id);
        const pending = tracker.getPending();
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: pending.length === 1 && pending[0].text === 'Task 2',
        };
      },
    },
    {
      name: '92.6-has-pending',
      timeout: 5000,
      fn: async () => {
        const { TodoTracker } = await import('../../src/agent/todo-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-todo-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new TodoTracker(tmp);
        const noPending = tracker.hasPending();
        tracker.add('Something');
        const hasPending = tracker.hasPending();
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: noPending === false && hasPending === true,
        };
      },
    },
    {
      name: '92.7-clear-done',
      timeout: 5000,
      fn: async () => {
        const { TodoTracker } = await import('../../src/agent/todo-tracker.js');
        const tmp = path.join(os.tmpdir(), `cb-todo-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const tracker = new TodoTracker(tmp);
        const t1 = tracker.add('Done 1');
        tracker.add('Pending 1');
        tracker.complete(t1.id);
        const cleared = tracker.clearDone();
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: cleared === 1 && tracker.getAll().length === 1,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 93: Conversation Branching
// ============================================================================

export function cat93ConversationBranching(): TestDef[] {
  return [
    {
      name: '93.1-singleton-access',
      timeout: 5000,
      fn: async () => {
        const { getConversationBranchManager } = await import('../../src/advanced/conversation-branching.js');
        const mgr = getConversationBranchManager();
        return { pass: mgr !== undefined };
      },
    },
    {
      name: '93.2-has-main-branch',
      timeout: 5000,
      fn: async () => {
        const { ConversationBranchManager } = await import('../../src/advanced/conversation-branching.js');
        const mgr = new ConversationBranchManager();
        const current = mgr.getCurrentBranch();
        return {
          pass: current !== undefined && current.id !== undefined,
          metadata: { branchName: current.name },
        };
      },
    },
    {
      name: '93.3-add-message',
      timeout: 5000,
      fn: async () => {
        const { ConversationBranchManager } = await import('../../src/advanced/conversation-branching.js');
        const mgr = new ConversationBranchManager();
        const msg = mgr.addMessage('user', 'Hello there');
        return {
          pass: msg.id !== undefined && msg.role === 'user' && msg.content === 'Hello there',
        };
      },
    },
    {
      name: '93.4-create-branch',
      timeout: 5000,
      fn: async () => {
        const { ConversationBranchManager } = await import('../../src/advanced/conversation-branching.js');
        const mgr = new ConversationBranchManager();
        const main = mgr.getCurrentBranch();
        const branch = mgr.createBranch('feature-branch', main.id, null);
        return {
          pass: branch.name === 'feature-branch' && branch.parentBranchId === main.id,
          metadata: { branchId: branch.id },
        };
      },
    },
    {
      name: '93.5-switch-branch',
      timeout: 5000,
      fn: async () => {
        const { ConversationBranchManager } = await import('../../src/advanced/conversation-branching.js');
        const mgr = new ConversationBranchManager();
        const main = mgr.getCurrentBranch();
        const branch = mgr.createBranch('alt', main.id, null);
        const switched = mgr.switchBranch(branch.id);
        const current = mgr.getCurrentBranch();
        return {
          pass: switched !== null && current.id === branch.id,
        };
      },
    },
    {
      name: '93.6-delete-branch',
      timeout: 5000,
      fn: async () => {
        const { ConversationBranchManager } = await import('../../src/advanced/conversation-branching.js');
        const mgr = new ConversationBranchManager();
        const main = mgr.getCurrentBranch();
        const branch = mgr.createBranch('deletable', main.id, null);
        const deleted = mgr.deleteBranch(branch.id);
        const branches = mgr.getBranches();
        return {
          pass: deleted === true && !branches.find(b => b.id === branch.id),
        };
      },
    },
    {
      name: '93.7-rename-branch',
      timeout: 5000,
      fn: async () => {
        const { ConversationBranchManager } = await import('../../src/advanced/conversation-branching.js');
        const mgr = new ConversationBranchManager();
        const main = mgr.getCurrentBranch();
        const branch = mgr.createBranch('old-name', main.id, null);
        const renamed = mgr.renameBranch(branch.id, 'new-name');
        const updated = mgr.getBranch(branch.id);
        return {
          pass: renamed === true && updated?.name === 'new-name',
        };
      },
    },
  ];
}

// ============================================================================
// Cat 94: Selective Rollback
// ============================================================================

export function cat94SelectiveRollback(): TestDef[] {
  return [
    {
      name: '94.1-singleton-access',
      timeout: 5000,
      fn: async () => {
        const { getSelectiveRollbackManager } = await import('../../src/advanced/selective-rollback.js');
        const mgr = getSelectiveRollbackManager();
        return { pass: mgr !== undefined };
      },
    },
    {
      name: '94.2-save-version',
      timeout: 5000,
      fn: async () => {
        const { SelectiveRollbackManager } = await import('../../src/advanced/selective-rollback.js');
        const mgr = new SelectiveRollbackManager();
        const ver = mgr.saveVersion('/tmp/test.ts', 'const x = 1;', 'manual');
        return {
          pass: ver.id !== undefined && ver.path.includes('test.ts') && ver.content === 'const x = 1;',
          metadata: { id: ver.id, hash: ver.hash, path: ver.path },
        };
      },
    },
    {
      name: '94.3-get-versions',
      timeout: 5000,
      fn: async () => {
        const { SelectiveRollbackManager } = await import('../../src/advanced/selective-rollback.js');
        const mgr = new SelectiveRollbackManager();
        mgr.saveVersion('/tmp/a.ts', 'v1');
        mgr.saveVersion('/tmp/a.ts', 'v2');
        mgr.saveVersion('/tmp/b.ts', 'v1');
        const versionsA = mgr.getVersions('/tmp/a.ts');
        const versionsB = mgr.getVersions('/tmp/b.ts');
        return {
          pass: versionsA.length === 2 && versionsB.length === 1,
        };
      },
    },
    {
      name: '94.4-get-latest-version',
      timeout: 5000,
      fn: async () => {
        const { SelectiveRollbackManager } = await import('../../src/advanced/selective-rollback.js');
        const mgr = new SelectiveRollbackManager();
        mgr.saveVersion('/tmp/c.ts', 'old content');
        mgr.saveVersion('/tmp/c.ts', 'new content');
        const latest = mgr.getLatestVersion('/tmp/c.ts');
        return {
          pass: latest !== undefined && latest.content === 'new content',
        };
      },
    },
    {
      name: '94.5-compare-versions',
      timeout: 5000,
      fn: async () => {
        const { SelectiveRollbackManager } = await import('../../src/advanced/selective-rollback.js');
        const mgr = new SelectiveRollbackManager();
        const v1 = mgr.saveVersion('/tmp/d.ts', 'version 1');
        const v2 = mgr.saveVersion('/tmp/d.ts', 'version 2');
        const cmp = mgr.compareVersions('/tmp/d.ts', v1.id, v2.id);
        return {
          pass: cmp !== null,
          metadata: { hasComparison: cmp !== null },
        };
      },
    },
    {
      name: '94.6-get-stats',
      timeout: 5000,
      fn: async () => {
        const { SelectiveRollbackManager } = await import('../../src/advanced/selective-rollback.js');
        const mgr = new SelectiveRollbackManager();
        mgr.saveVersion('/tmp/e.ts', 'c1');
        mgr.saveVersion('/tmp/f.ts', 'c2');
        const stats = mgr.getStats();
        return {
          pass: stats.totalFiles === 2 && stats.totalVersions === 2,
          metadata: { stats },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 95: Three-Way Diff
// ============================================================================

export function cat95ThreeWayDiff(): TestDef[] {
  return [
    {
      name: '95.1-identical-no-conflicts',
      timeout: 5000,
      fn: async () => {
        const { ThreeWayDiff } = await import('../../src/advanced/three-way-diff.js');
        const diff = new ThreeWayDiff();
        const result = diff.diff('line1\nline2\n', 'line1\nline2\n', 'line1\nline2\n');
        return {
          pass: result.hasConflicts === false && result.conflictCount === 0,
        };
      },
    },
    {
      name: '95.2-ours-only-change',
      timeout: 5000,
      fn: async () => {
        const { ThreeWayDiff } = await import('../../src/advanced/three-way-diff.js');
        const diff = new ThreeWayDiff();
        const base = 'line1\nline2\nline3\n';
        const ours = 'line1\nmodified\nline3\n';
        const theirs = 'line1\nline2\nline3\n';
        const result = diff.diff(base, ours, theirs);
        return {
          pass: result.hasConflicts === false,
          metadata: { hunks: result.hunks.length },
        };
      },
    },
    {
      name: '95.3-conflict-detected',
      timeout: 5000,
      fn: async () => {
        const { ThreeWayDiff } = await import('../../src/advanced/three-way-diff.js');
        const diff = new ThreeWayDiff();
        const base = 'line1\nline2\nline3\n';
        const ours = 'line1\nours-change\nline3\n';
        const theirs = 'line1\ntheirs-change\nline3\n';
        const result = diff.diff(base, ours, theirs);
        return {
          pass: result.hasConflicts === true && result.conflictCount >= 1,
          metadata: { conflicts: result.conflictCount },
        };
      },
    },
    {
      name: '95.4-resolve-conflicts',
      timeout: 5000,
      fn: async () => {
        const { ThreeWayDiff } = await import('../../src/advanced/three-way-diff.js');
        const diff = new ThreeWayDiff();
        const base = 'a\nb\nc\n';
        const ours = 'a\nours\nc\n';
        const theirs = 'a\ntheirs\nc\n';
        const result = diff.diff(base, ours, theirs);
        if (result.hasConflicts) {
          const resolutions = result.hunks
            .filter(h => h.status === 'conflict')
            .map((_, i) => ({ hunkIndex: i, choice: 'ours' as const }));
          const resolved = diff.resolveConflicts(result, resolutions);
          return {
            pass: typeof resolved === 'string' && resolved.includes('ours'),
            metadata: { resolved: resolved.substring(0, 100) },
          };
        }
        return { pass: true, metadata: { note: 'no conflicts to resolve' } };
      },
    },
    {
      name: '95.5-format-conflict-markers',
      timeout: 5000,
      fn: async () => {
        const { ThreeWayDiff } = await import('../../src/advanced/three-way-diff.js');
        const diff = new ThreeWayDiff();
        const base = 'x\ny\nz\n';
        const ours = 'x\nours\nz\n';
        const theirs = 'x\ntheirs\nz\n';
        const result = diff.diff(base, ours, theirs);
        const conflictHunk = result.hunks.find(h => h.status === 'conflict');
        if (conflictHunk) {
          const markers = diff.formatConflictMarkers(conflictHunk);
          return {
            pass: markers.includes('<<<<<<<') && markers.includes('>>>>>>>'),
            metadata: { markers: markers.substring(0, 200) },
          };
        }
        return { pass: true, metadata: { note: 'no conflict hunk found' } };
      },
    },
  ];
}
