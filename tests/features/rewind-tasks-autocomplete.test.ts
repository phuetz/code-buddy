/**
 * Tests for Feature 1 (RewindManager), Feature 2 (BackgroundTaskManager),
 * and Feature 3 (FileAutocomplete).
 */

jest.mock('../../src/utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  RewindManager,
  getRewindManager,
  resetRewindManager,
  ConversationSnapshot,
  FileSnapshot,
} from '../../src/agent/rewind-manager.js';

import {
  BackgroundTaskManager,
  getBackgroundTaskManager,
  resetBackgroundTaskManager,
} from '../../src/agent/background-tasks.js';

import {
  FileAutocomplete,
  getFileAutocomplete,
  resetFileAutocomplete,
} from '../../src/input/file-autocomplete.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════════
// Feature 1: RewindManager
// ═══════════════════════════════════════════════════════════════
describe('RewindManager', () => {
  let manager: RewindManager;

  const makeConvo = (turnIndex: number): ConversationSnapshot => ({
    messages: [{ role: 'user', content: `turn-${turnIndex}` }],
    turnIndex,
  });

  const makeFiles = (files: Record<string, string>): FileSnapshot => ({
    checkpointId: `ckpt-${Date.now()}`,
    files: new Map(Object.entries(files)),
  });

  beforeEach(() => {
    resetRewindManager();
    manager = new RewindManager();
  });

  it('should create rewind points and return IDs', () => {
    const id1 = manager.createRewindPoint(makeConvo(1), makeFiles({ 'a.ts': 'content-a' }));
    const id2 = manager.createRewindPoint(makeConvo(2), makeFiles({ 'b.ts': 'content-b' }));
    expect(id1).toBe('rw-1');
    expect(id2).toBe('rw-2');
  });

  it('should list all rewind points', () => {
    manager.createRewindPoint(makeConvo(1), makeFiles({}));
    manager.createRewindPoint(makeConvo(2), makeFiles({}));
    manager.createRewindPoint(makeConvo(3), makeFiles({}));
    const points = manager.getRewindPoints();
    expect(points).toHaveLength(3);
    expect(points[0].id).toBe('rw-1');
    expect(points[2].id).toBe('rw-3');
  });

  it('should get latest point', () => {
    expect(manager.getLatestPoint()).toBeUndefined();
    manager.createRewindPoint(makeConvo(1), makeFiles({}));
    manager.createRewindPoint(makeConvo(5), makeFiles({}));
    const latest = manager.getLatestPoint();
    expect(latest).toBeDefined();
    expect(latest!.conversation.turnIndex).toBe(5);
  });

  it('should rewind conversation-only (keeps files)', () => {
    const id = manager.createRewindPoint(
      makeConvo(3),
      makeFiles({ 'x.ts': 'old' })
    );
    const result = manager.rewind(id, 'conversation');
    expect(result.success).toBe(true);
    expect(result.mode).toBe('conversation');
    expect(result.restoredTurn).toBe(3);
    expect(result.restoredFiles).toBeUndefined();
  });

  it('should rewind code-only (keeps conversation)', () => {
    const id = manager.createRewindPoint(
      makeConvo(3),
      makeFiles({ 'x.ts': 'old', 'y.ts': 'data' })
    );
    const result = manager.rewind(id, 'code');
    expect(result.success).toBe(true);
    expect(result.mode).toBe('code');
    expect(result.restoredTurn).toBeUndefined();
    expect(result.restoredFiles).toEqual(expect.arrayContaining(['x.ts', 'y.ts']));
  });

  it('should do full rewind (both conversation and files)', () => {
    const id = manager.createRewindPoint(
      makeConvo(2),
      makeFiles({ 'a.ts': 'v1' })
    );
    const result = manager.rewind(id, 'full');
    expect(result.success).toBe(true);
    expect(result.mode).toBe('full');
    expect(result.restoredTurn).toBe(2);
    expect(result.restoredFiles).toEqual(['a.ts']);
  });

  it('should fork and create a new branch', () => {
    const id = manager.createRewindPoint(
      makeConvo(4),
      makeFiles({ 'f.ts': 'data' })
    );
    const result = manager.rewind(id, 'fork');
    expect(result.success).toBe(true);
    expect(result.mode).toBe('fork');
    expect(result.branchId).toBeDefined();
    expect(result.branchId!.startsWith('fork-')).toBe(true);
    expect(result.restoredTurn).toBe(4);
  });

  it('should return failure for unknown point ID', () => {
    const result = manager.rewind('nonexistent', 'full');
    expect(result.success).toBe(false);
  });

  it('should clear history', () => {
    manager.createRewindPoint(makeConvo(1), makeFiles({}));
    manager.createRewindPoint(makeConvo(2), makeFiles({}));
    expect(manager.getRewindPoints()).toHaveLength(2);
    manager.clearHistory();
    expect(manager.getRewindPoints()).toHaveLength(0);
    expect(manager.getLatestPoint()).toBeUndefined();
  });

  it('should deep-copy conversation messages to avoid mutation', () => {
    const messages = [{ role: 'user', content: 'original' }];
    const convo: ConversationSnapshot = { messages, turnIndex: 1 };
    manager.createRewindPoint(convo, makeFiles({}));
    messages[0].content = 'mutated';
    const point = manager.getLatestPoint()!;
    expect((point.conversation.messages[0] as { content: string }).content).toBe('original');
  });

  it('singleton getRewindManager returns same instance', () => {
    const a = getRewindManager();
    const b = getRewindManager();
    expect(a).toBe(b);
  });

  it('resetRewindManager clears singleton', () => {
    const a = getRewindManager();
    resetRewindManager();
    const b = getRewindManager();
    expect(a).not.toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════
// Feature 2: BackgroundTaskManager
// ═══════════════════════════════════════════════════════════════
describe('BackgroundTaskManager', () => {
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    resetBackgroundTaskManager();
    manager = new BackgroundTaskManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  async function waitForTaskStatus(
    id: string,
    expectedStatus: 'completed' | 'failed',
    timeoutMs = 5_000,
  ): Promise<ReturnType<BackgroundTaskManager['getTask']>> {
    const deadline = Date.now() + timeoutMs;
    let task = manager.getTask(id);
    while (Date.now() < deadline) {
      task = manager.getTask(id);
      if (task?.status === expectedStatus) {
        return task;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return task;
  }

  it('should launch a task and return an auto-incrementing ID', () => {
    const id1 = manager.launchTask('echo hello');
    const id2 = manager.launchTask('echo world');
    expect(id1).toBe('bg-1');
    expect(id2).toBe('bg-2');
  });

  it('should track task status as running initially', () => {
    const id = manager.launchTask('sleep 10');
    const task = manager.getTask(id);
    expect(task).toBeDefined();
    expect(task!.status).toBe('running');
    expect(task!.command).toBe('sleep 10');
  });

  it('should capture task output', async () => {
    const id = manager.launchTask('echo "test output line"');
    await waitForTaskStatus(id, 'completed');
    const output = manager.getTaskOutput(id);
    expect(output).toContain('test output line');
  });

  it('should transition to completed on exit code 0', async () => {
    const id = manager.launchTask('echo done');
    const task = await waitForTaskStatus(id, 'completed');
    expect(task!.status).toBe('completed');
    expect(task!.exitCode).toBe(0);
  });

  it('should transition to failed on non-zero exit', async () => {
    const id = manager.launchTask('exit 1');
    const task = await waitForTaskStatus(id, 'failed');
    expect(task!.status).toBe('failed');
    expect(task!.exitCode).toBe(1);
  });

  it('should list all tasks', () => {
    manager.launchTask('echo a');
    manager.launchTask('echo b');
    manager.launchTask('echo c');
    const tasks = manager.listTasks();
    expect(tasks).toHaveLength(3);
  });

  it('should kill a running task', async () => {
    const id = manager.launchTask('sleep 60');
    // Give it a moment to spawn
    await new Promise((resolve) => setTimeout(resolve, 200));
    const killed = manager.killTask(id);
    expect(killed).toBe(true);
    const task = manager.getTask(id);
    expect(task!.status).toBe('failed');
  });

  it('should return false when killing nonexistent task', () => {
    expect(manager.killTask('bg-999')).toBe(false);
  });

  it('should filter output by regex', async () => {
    const id = manager.launchTask('printf "alpha\\nbeta\\ngamma\\nalpha2\\n"');
    await waitForTaskStatus(id, 'completed');
    const filtered = manager.getTaskOutput(id, /alpha/);
    expect(filtered).toContain('alpha');
    expect(filtered).not.toContain('beta');
    expect(filtered).not.toContain('gamma');
  });

  it('should cleanup all running tasks', async () => {
    manager.launchTask('sleep 60');
    manager.launchTask('sleep 60');
    await new Promise((resolve) => setTimeout(resolve, 200));
    manager.cleanup();
    const tasks = manager.listTasks();
    const running = tasks.filter((t) => t.status === 'running');
    expect(running).toHaveLength(0);
  });

  it('should cap output at 1MB', async () => {
    // Generate > 1MB of output
    const id = manager.launchTask('dd if=/dev/zero bs=1024 count=1200 2>/dev/null | tr "\\0" "A"');
    await waitForTaskStatus(id, 'completed', 10_000);
    const output = manager.getTaskOutput(id);
    expect(output.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('should return empty string for nonexistent task output', () => {
    expect(manager.getTaskOutput('bg-999')).toBe('');
  });

  it('should return undefined for nonexistent task', () => {
    expect(manager.getTask('bg-999')).toBeUndefined();
  });

  it('singleton getBackgroundTaskManager returns same instance', () => {
    const a = getBackgroundTaskManager();
    const b = getBackgroundTaskManager();
    expect(a).toBe(b);
  });

  it('resetBackgroundTaskManager clears singleton', () => {
    const a = getBackgroundTaskManager();
    resetBackgroundTaskManager();
    const b = getBackgroundTaskManager();
    expect(a).not.toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════
// Feature 3: FileAutocomplete
// ═══════════════════════════════════════════════════════════════
describe('FileAutocomplete', () => {
  let autocomplete: FileAutocomplete;
  let tmpDir: string;

  beforeEach(() => {
    resetFileAutocomplete();
    autocomplete = new FileAutocomplete();

    // Create a temporary directory structure
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autocomplete-test-'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.mkdirSync(path.join(tmpDir, 'src', 'utils'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'export {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'helper.ts'), 'export {}');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# readme');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'dep.js'), '');
    // Create .gitignore
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should complete partial paths', () => {
    const results = autocomplete.complete('src/in', tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.path === path.join('src', 'index.ts'))).toBe(true);
  });

  it('should list directory contents when partial is a directory', () => {
    const results = autocomplete.complete('src', tmpDir);
    // Should list contents of src/
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('should mark directories with isDirectory flag', () => {
    const results = autocomplete.complete('src/ut', tmpDir);
    const utilsEntry = results.find((r) => r.path === path.join('src', 'utils'));
    expect(utilsEntry).toBeDefined();
    expect(utilsEntry!.isDirectory).toBe(true);
  });

  it('should respect .gitignore', () => {
    const results = autocomplete.complete('node', tmpDir);
    const nodeModules = results.find((r) => r.path === 'node_modules');
    expect(nodeModules).toBeUndefined();
  });

  it('should limit results to 20', () => {
    // Create many files
    const manyDir = path.join(tmpDir, 'many');
    fs.mkdirSync(manyDir);
    for (let i = 0; i < 30; i++) {
      fs.writeFileSync(path.join(manyDir, `file-${i.toString().padStart(2, '0')}.ts`), '');
    }
    const results = autocomplete.complete('many/', tmpDir);
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('should handle non-existent paths gracefully', () => {
    const results = autocomplete.complete('nonexistent/path/foo', tmpDir);
    expect(results).toEqual([]);
  });

  it('should include lineRange in display when present', () => {
    const results = autocomplete.complete('src/index.ts:10-20', tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find((r) => r.path === path.join('src', 'index.ts'));
    expect(match).toBeDefined();
    expect(match!.lineRange).toBe('10-20');
    expect(match!.display).toContain(':10-20');
  });

  describe('parseAtReference', () => {
    it('should parse simple @file reference', () => {
      const ref = autocomplete.parseAtReference('@src/index.ts');
      expect(ref).toEqual({ path: 'src/index.ts' });
    });

    it('should parse @file:line reference', () => {
      const ref = autocomplete.parseAtReference('@src/index.ts:42');
      expect(ref).toEqual({ path: 'src/index.ts', lineStart: 42 });
    });

    it('should parse @file:start-end reference', () => {
      const ref = autocomplete.parseAtReference('@src/index.ts:10-20');
      expect(ref).toEqual({ path: 'src/index.ts', lineStart: 10, lineEnd: 20 });
    });

    it('should return null for empty input', () => {
      expect(autocomplete.parseAtReference('')).toBeNull();
    });

    it('should return null for input without @', () => {
      expect(autocomplete.parseAtReference('src/index.ts')).toBeNull();
    });

    it('should return null for bare @', () => {
      expect(autocomplete.parseAtReference('@')).toBeNull();
    });

    it('should handle colon with no valid range as path only', () => {
      const ref = autocomplete.parseAtReference('@src/index.ts:abc');
      expect(ref).toEqual({ path: 'src/index.ts' });
    });
  });

  it('singleton getFileAutocomplete returns same instance', () => {
    const a = getFileAutocomplete();
    const b = getFileAutocomplete();
    expect(a).toBe(b);
  });

  it('resetFileAutocomplete clears singleton', () => {
    const a = getFileAutocomplete();
    resetFileAutocomplete();
    const b = getFileAutocomplete();
    expect(a).not.toBe(b);
  });
});
