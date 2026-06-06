import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('PersistentMemoryManager', () => {
  let tmpDir: string;
  let manager: PersistentMemoryManager;
  const projectMemoryPath = () => path.join(tmpDir, 'project_memory.md');
  const userMemoryPath = () => path.join(tmpDir, 'user_memory.md');

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `cb-memory-test-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    
    manager = new PersistentMemoryManager({
      projectMemoryPath: projectMemoryPath(),
      userMemoryPath: userMemoryPath(),
      autoCapture: false,
    });
    
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('should initialize with template files', async () => {
    expect(await fs.pathExists(projectMemoryPath())).toBe(true);
    expect(await fs.pathExists(userMemoryPath())).toBe(true);
    
    const content = await fs.readFile(projectMemoryPath(), 'utf-8');
    expect(content).toContain('# Code Buddy Memory');
    expect(content).toContain('## Project Context');
  });

  it('should remember and recall a value in project scope', async () => {
    await manager.remember('test-key', 'test-value', { scope: 'project' });
    
    const value = manager.recall('test-key');
    expect(value).toBe('test-value');
    
    // Verify persistence
    const content = await fs.readFile(projectMemoryPath(), 'utf-8');
    expect(content).toContain('- **test-key**: test-value');
  });

  it('creates the project memory parent directory on explicit writes in a headless virgin workspace', async () => {
    const previousHeadless = process.env.CODEBUDDY_HEADLESS;
    const previousReadonly = process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY;
    process.env.CODEBUDDY_HEADLESS = 'true';
    delete process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY;

    const virginProjectPath = path.join(tmpDir, 'virgin-workspace', '.codebuddy', 'CODEBUDDY_MEMORY.md');
    const virginUserPath = path.join(tmpDir, 'virgin-user-memory.md');
    const virginManager = new PersistentMemoryManager({
      projectMemoryPath: virginProjectPath,
      userMemoryPath: virginUserPath,
      autoCapture: false,
    });

    try {
      await virginManager.initialize();
      expect(await fs.pathExists(virginProjectPath)).toBe(false);

      await virginManager.remember('first-note', 'created on demand', { scope: 'project' });

      expect(await fs.pathExists(virginProjectPath)).toBe(true);
      const content = await fs.readFile(virginProjectPath, 'utf-8');
      expect(content).toContain('- **first-note**: created on demand');
    } finally {
      if (previousHeadless === undefined) delete process.env.CODEBUDDY_HEADLESS;
      else process.env.CODEBUDDY_HEADLESS = previousHeadless;
      if (previousReadonly === undefined) delete process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY;
      else process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY = previousReadonly;
    }
  });

  it('should remember and recall a value in user scope', async () => {
    await manager.remember('user-pref', 'dark-mode', { scope: 'user', category: 'preferences' });
    
    const value = manager.recall('user-pref');
    expect(value).toBe('dark-mode');
    
    const content = await fs.readFile(userMemoryPath(), 'utf-8');
    expect(content).toContain('## User Preferences');
    expect(content).toContain('- **user-pref**: dark-mode');
  });

  it('should forget a memory', async () => {
    await manager.remember('to-forget', 'gone', { scope: 'project' });
    expect(manager.recall('to-forget')).toBe('gone');
    
    const deleted = await manager.forget('to-forget', 'project');
    expect(deleted).toBe(true);
    expect(manager.recall('to-forget')).toBe(null);
    
    const content = await fs.readFile(projectMemoryPath(), 'utf-8');
    expect(content).not.toContain('to-forget');
  });

  it('should get relevant memories by keyword', async () => {
    await manager.remember('build-cmd', 'npm run build', { category: 'project' });
    await manager.remember('test-cmd', 'npm test', { category: 'project' });
    
    const relevant = manager.getRelevantMemories('build');
    expect(relevant).toHaveLength(1);
    expect(relevant[0].key).toBe('build-cmd');
  });

  it('should build context string for prompt', async () => {
    await manager.remember('framework', 'React', { category: 'project' });
    await manager.remember('indent', '2 spaces', { category: 'preferences', scope: 'user' });

    const context = manager.getContextForPrompt();
    expect(context).toContain('--- PERSISTENT MEMORY ---');
    expect(context).toContain('framework: React');
    expect(context).toContain('indent: 2 spaces');
  });

  describe('getRecentMemories', () => {
    it('returns an empty array when no memories are stored', () => {
      expect(manager.getRecentMemories()).toEqual([]);
      expect(manager.getRecentMemories(5, 'project')).toEqual([]);
      expect(manager.getRecentMemories(5, 'user')).toEqual([]);
    });

    it('returns up to N entries sorted by updatedAt descending across both scopes', async () => {
      // Insert 3 memories with controlled timestamps. Insertion order != recency.
      await manager.remember('alpha', 'A', { scope: 'project', category: 'project' });
      await manager.remember('beta', 'B', { scope: 'user', category: 'preferences' });
      await manager.remember('gamma', 'C', { scope: 'project', category: 'patterns' });

      // Manually backdate alpha so beta is the oldest, gamma the newest, alpha middle.
      const now = Date.now();
      // Direct map access via private cast for the test setup only.
      const projectMap = (manager as unknown as { projectMemories: Map<string, { updatedAt: Date }> }).projectMemories;
      const userMap = (manager as unknown as { userMemories: Map<string, { updatedAt: Date }> }).userMemories;
      projectMap.get('alpha')!.updatedAt = new Date(now - 60_000); // 1 min ago
      userMap.get('beta')!.updatedAt = new Date(now - 120_000); // 2 min ago
      projectMap.get('gamma')!.updatedAt = new Date(now - 5_000); // 5s ago

      const recent = manager.getRecentMemories(10);
      expect(recent.map(m => m.key)).toEqual(['gamma', 'alpha', 'beta']);
      // Each entry decorated with its scope.
      expect(recent[0].scope).toBe('project');
      expect(recent[2].scope).toBe('user');

      // Limit honored — get top 2 only.
      expect(manager.getRecentMemories(2).map(m => m.key)).toEqual(['gamma', 'alpha']);
    });

    it('respects the scope filter (project vs user)', async () => {
      await manager.remember('p-only', 'P', { scope: 'project' });
      await manager.remember('u-only', 'U', { scope: 'user' });

      const projectOnly = manager.getRecentMemories(10, 'project');
      expect(projectOnly).toHaveLength(1);
      expect(projectOnly[0].key).toBe('p-only');
      expect(projectOnly[0].scope).toBe('project');

      const userOnly = manager.getRecentMemories(10, 'user');
      expect(userOnly).toHaveLength(1);
      expect(userOnly[0].key).toBe('u-only');
      expect(userOnly[0].scope).toBe('user');
    });

    it('treats limit=0 or negative as empty result', async () => {
      await manager.remember('any', 'value', { scope: 'project' });
      expect(manager.getRecentMemories(0)).toEqual([]);
      expect(manager.getRecentMemories(-5)).toEqual([]);
    });
  });
});
