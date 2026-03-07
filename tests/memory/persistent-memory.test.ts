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
});
