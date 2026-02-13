/**
 * IdentityManager Tests
 *
 * Tests for loading, validating, and hot-reloading identity files
 * (SOUL.md, USER.md, AGENTS.md, TOOLS.md, IDENTITY.md).
 * Verifies project-over-global priority, singleton pattern,
 * prompt injection formatting, and file change events.
 */

import {
  IdentityManager,
  getIdentityManager,
  resetIdentityManager,
} from '../../src/identity/identity-manager.js';
import type { IdentityFile } from '../../src/identity/identity-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { watch } from 'fs';

jest.mock('fs/promises');
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    watch: jest.fn(),
  };
});
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
const mockStat = fs.stat as jest.MockedFunction<typeof fs.stat>;
const mockMkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>;
const mockWriteFile = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>;
const mockWatch = watch as jest.MockedFunction<typeof watch>;

const MOCK_MTIME = new Date('2025-01-15T10:00:00Z');

function makeMockStat(mtime: Date = MOCK_MTIME) {
  return {
    mtime,
    isFile: () => true,
    isDirectory: () => false,
  } as unknown as Awaited<ReturnType<typeof fs.stat>>;
}

describe('IdentityManager', () => {
  const CWD = '/home/user/project';
  const GLOBAL_DIR = '/mock/global/.codebuddy';

  let manager: IdentityManager;

  beforeEach(() => {
    jest.clearAllMocks();
    resetIdentityManager();

    // Default: all file reads fail (file not found)
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockStat.mockRejectedValue(new Error('ENOENT'));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    manager = new IdentityManager({
      globalDir: GLOBAL_DIR,
      watchForChanges: false,
    });
  });

  afterEach(() => {
    manager.unwatch();
  });

  // ==========================================================================
  // File Loading
  // ==========================================================================

  describe('load()', () => {
    it('should return empty array when no identity files exist', async () => {
      const result = await manager.load(CWD);

      expect(result).toEqual([]);
      expect(manager.getAll()).toEqual([]);
    });

    it('should load a single project-level file', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return '# Soul\nI am Code Buddy';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('SOUL.md');
      expect(result[0].content).toBe('# Soul\nI am Code Buddy');
      expect(result[0].source).toBe('project');
      expect(result[0].path).toBe(projectPath);
      expect(result[0].lastModified).toEqual(MOCK_MTIME);
    });

    it('should load a single global-level file', async () => {
      const globalPath = path.join(GLOBAL_DIR, 'USER.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === globalPath) return '# User Prefs';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === globalPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('USER.md');
      expect(result[0].source).toBe('global');
      expect(result[0].path).toBe(globalPath);
    });

    it('should load multiple files from both project and global directories', async () => {
      const projectSoul = path.join(CWD, '.codebuddy', 'SOUL.md');
      const globalUser = path.join(GLOBAL_DIR, 'USER.md');

      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul) return 'Project soul';
        if (filePath === globalUser) return 'Global user';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul || filePath === globalUser) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toHaveLength(2);
      expect(result.map(f => f.name)).toContain('SOUL.md');
      expect(result.map(f => f.name)).toContain('USER.md');
    });

    it('should check all default file names', async () => {
      await manager.load(CWD);

      const expectedFiles = ['SOUL.md', 'USER.md', 'AGENTS.md', 'TOOLS.md', 'IDENTITY.md'];

      for (const fileName of expectedFiles) {
        const projectPath = path.join(CWD, '.codebuddy', fileName);
        expect(mockReadFile).toHaveBeenCalledWith(projectPath, 'utf-8');
      }
    });

    it('should skip files with empty or whitespace-only content', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return '   \n  \t  ';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toEqual([]);
    });

    it('should emit identity:loaded event after loading', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return 'Soul content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const loadedHandler = jest.fn();
      manager.on('identity:loaded', loadedHandler);

      await manager.load(CWD);

      expect(loadedHandler).toHaveBeenCalledTimes(1);
      expect(loadedHandler).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'SOUL.md' }),
        ])
      );
    });

    it('should clear previously loaded files on re-load', async () => {
      const projectSoul = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul) return 'Soul content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul) return makeMockStat();
        throw new Error('ENOENT');
      });

      await manager.load(CWD);
      expect(manager.getAll()).toHaveLength(1);

      // Now all files fail
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockStat.mockRejectedValue(new Error('ENOENT'));

      await manager.load(CWD);
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Project Overrides Global
  // ==========================================================================

  describe('project overrides global', () => {
    it('should prefer project file over global file for the same name', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      const globalPath = path.join(GLOBAL_DIR, 'SOUL.md');

      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return 'Project soul';
        if (filePath === globalPath) return 'Global soul';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath || filePath === globalPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('project');
      expect(result[0].content).toBe('Project soul');
    });

    it('should fall back to global when project file does not exist', async () => {
      const globalPath = path.join(GLOBAL_DIR, 'SOUL.md');

      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === globalPath) return 'Global fallback';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === globalPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('global');
      expect(result[0].content).toBe('Global fallback');
    });

    it('should fall back to global when project file is empty', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      const globalPath = path.join(GLOBAL_DIR, 'SOUL.md');

      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return '';
        if (filePath === globalPath) return 'Global content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath || filePath === globalPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('global');
    });
  });

  // ==========================================================================
  // get() / getAll()
  // ==========================================================================

  describe('get() and getAll()', () => {
    it('should return undefined for non-existent file name', () => {
      expect(manager.get('NONEXISTENT.md')).toBeUndefined();
    });

    it('should return specific identity file by name', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return 'Soul content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      await manager.load(CWD);

      const file = manager.get('SOUL.md');
      expect(file).toBeDefined();
      expect(file!.name).toBe('SOUL.md');
      expect(file!.content).toBe('Soul content');
    });

    it('should return all loaded files', async () => {
      const projectSoul = path.join(CWD, '.codebuddy', 'SOUL.md');
      const globalUser = path.join(GLOBAL_DIR, 'USER.md');

      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul) return 'Soul';
        if (filePath === globalUser) return 'User';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul || filePath === globalUser) return makeMockStat();
        throw new Error('ENOENT');
      });

      await manager.load(CWD);

      const all = manager.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(f => f.name)).toEqual(['SOUL.md', 'USER.md']);
    });
  });

  // ==========================================================================
  // set()
  // ==========================================================================

  describe('set()', () => {
    it('should throw if load() has not been called first', async () => {
      await expect(manager.set('SOUL.md', 'content')).rejects.toThrow(
        'call load() before set()'
      );
    });

    it('should write file to project directory', async () => {
      // Load first to set cwd
      await manager.load(CWD);

      const expectedPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockStat.mockResolvedValue(makeMockStat());

      await manager.set('SOUL.md', '# New Soul');

      expect(mockMkdir).toHaveBeenCalledWith(
        path.join(CWD, '.codebuddy'),
        { recursive: true }
      );
      expect(mockWriteFile).toHaveBeenCalledWith(expectedPath, '# New Soul', 'utf-8');
    });

    it('should update the in-memory file map', async () => {
      await manager.load(CWD);
      mockStat.mockResolvedValue(makeMockStat());

      await manager.set('SOUL.md', '# Updated Soul');

      const file = manager.get('SOUL.md');
      expect(file).toBeDefined();
      expect(file!.content).toBe('# Updated Soul');
      expect(file!.source).toBe('project');
    });

    it('should emit identity:changed event', async () => {
      await manager.load(CWD);
      mockStat.mockResolvedValue(makeMockStat());

      const changedHandler = jest.fn();
      manager.on('identity:changed', changedHandler);

      await manager.set('SOUL.md', 'New content');

      expect(changedHandler).toHaveBeenCalledTimes(1);
      expect(changedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'SOUL.md',
          content: 'New content',
          source: 'project',
        })
      );
    });

    it('should emit identity:error and throw on write failure', async () => {
      await manager.load(CWD);
      mockMkdir.mockRejectedValue(new Error('EACCES: permission denied'));

      const errorHandler = jest.fn();
      manager.on('identity:error', errorHandler);

      await expect(manager.set('SOUL.md', 'content')).rejects.toThrow('EACCES');
      expect(errorHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // getPromptInjection()
  // ==========================================================================

  describe('getPromptInjection()', () => {
    it('should return empty string when no files are loaded', () => {
      expect(manager.getPromptInjection()).toBe('');
    });

    it('should format single file with section header', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return 'I am Code Buddy';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      await manager.load(CWD);

      const injection = manager.getPromptInjection();
      expect(injection).toBe('## SOUL.md\n\nI am Code Buddy');
    });

    it('should separate multiple files with horizontal rules', async () => {
      const projectSoul = path.join(CWD, '.codebuddy', 'SOUL.md');
      const projectUser = path.join(CWD, '.codebuddy', 'USER.md');

      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul) return 'Soul content';
        if (filePath === projectUser) return 'User content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectSoul || filePath === projectUser) return makeMockStat();
        throw new Error('ENOENT');
      });

      await manager.load(CWD);

      const injection = manager.getPromptInjection();
      const parts = injection.split('\n\n---\n\n');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toContain('## SOUL.md');
      expect(parts[0]).toContain('Soul content');
      expect(parts[1]).toContain('## USER.md');
      expect(parts[1]).toContain('User content');
    });
  });

  // ==========================================================================
  // watch() / unwatch()
  // ==========================================================================

  describe('watch() and unwatch()', () => {
    let mockWatcherClose: jest.Mock;
    let capturedCallbacks: Map<string, (eventType: string, filename: string | null) => void>;

    beforeEach(() => {
      mockWatcherClose = jest.fn();
      capturedCallbacks = new Map();

      mockWatch.mockImplementation((dirPath: unknown, callback: unknown) => {
        capturedCallbacks.set(dirPath as string, callback as (eventType: string, filename: string | null) => void);
        return { close: mockWatcherClose } as unknown as ReturnType<typeof watch>;
      });
    });

    it('should set up watchers for project and global directories', () => {
      manager.watch(CWD);

      const projectDir = path.join(CWD, '.codebuddy');
      const globalDir = GLOBAL_DIR;

      expect(mockWatch).toHaveBeenCalledWith(projectDir, expect.any(Function));
      expect(mockWatch).toHaveBeenCalledWith(globalDir, expect.any(Function));
    });

    it('should close watchers on unwatch()', () => {
      manager.watch(CWD);
      manager.unwatch();

      expect(mockWatcherClose).toHaveBeenCalledTimes(2);
    });

    it('should close old watchers when watch() is called again', () => {
      manager.watch(CWD);
      manager.watch(CWD);

      // First pair closed, second pair still active
      expect(mockWatcherClose).toHaveBeenCalledTimes(2);
    });

    it('should emit identity:changed when a watched file changes', async () => {
      const projectDir = path.join(CWD, '.codebuddy');
      const filePath = path.join(projectDir, 'SOUL.md');

      mockReadFile.mockImplementation(async (fp: unknown) => {
        if (fp === filePath) return 'Updated soul content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (fp: unknown) => {
        if (fp === filePath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const changedHandler = jest.fn();
      manager.on('identity:changed', changedHandler);

      manager.watch(CWD);

      // Simulate file change
      const callback = capturedCallbacks.get(projectDir);
      expect(callback).toBeDefined();
      await callback!('change', 'SOUL.md');

      // Allow async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(changedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'SOUL.md',
          source: 'project',
          content: 'Updated soul content',
        })
      );
    });

    it('should ignore changes to non-identity files', async () => {
      const projectDir = path.join(CWD, '.codebuddy');

      const changedHandler = jest.fn();
      manager.on('identity:changed', changedHandler);

      manager.watch(CWD);

      const callback = capturedCallbacks.get(projectDir);
      await callback!('change', 'random-file.json');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(changedHandler).not.toHaveBeenCalled();
    });

    it('should ignore events with null filename', async () => {
      const projectDir = path.join(CWD, '.codebuddy');

      const changedHandler = jest.fn();
      manager.on('identity:changed', changedHandler);

      manager.watch(CWD);

      const callback = capturedCallbacks.get(projectDir);
      await callback!('change', null);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(changedHandler).not.toHaveBeenCalled();
    });

    it('should handle watch errors gracefully when directory does not exist', () => {
      mockWatch.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      // Should not throw
      expect(() => manager.watch(CWD)).not.toThrow();
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('singleton', () => {
    it('should return the same instance from getIdentityManager()', () => {
      const instance1 = getIdentityManager();
      const instance2 = getIdentityManager();
      expect(instance1).toBe(instance2);
    });

    it('should return a new instance after resetIdentityManager()', () => {
      const instance1 = getIdentityManager();
      resetIdentityManager();
      const instance2 = getIdentityManager();
      expect(instance1).not.toBe(instance2);
    });

    it('should call unwatch on reset', () => {
      const instance = getIdentityManager();
      const unwatchSpy = jest.spyOn(instance, 'unwatch');
      resetIdentityManager();
      expect(unwatchSpy).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Custom Configuration
  // ==========================================================================

  describe('custom configuration', () => {
    it('should accept custom file names', async () => {
      const customManager = new IdentityManager({
        globalDir: GLOBAL_DIR,
        fileNames: ['CUSTOM.md'],
        watchForChanges: false,
      });

      const customPath = path.join(CWD, '.codebuddy', 'CUSTOM.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === customPath) return 'Custom content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === customPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await customManager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('CUSTOM.md');
    });

    it('should accept custom project directory name', async () => {
      const customManager = new IdentityManager({
        globalDir: GLOBAL_DIR,
        projectDir: '.myconfig',
        watchForChanges: false,
      });

      const customPath = path.join(CWD, '.myconfig', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === customPath) return 'Custom dir content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === customPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await customManager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(customPath);
    });

    it('should accept custom global directory', async () => {
      const customGlobal = '/opt/shared/.codebuddy';
      const customManager = new IdentityManager({
        globalDir: customGlobal,
        watchForChanges: false,
      });

      const globalPath = path.join(customGlobal, 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === globalPath) return 'Shared soul';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === globalPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await customManager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(globalPath);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle file read errors gracefully', async () => {
      mockReadFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await manager.load(CWD);

      expect(result).toEqual([]);
    });

    it('should handle empty fileNames config', async () => {
      const emptyManager = new IdentityManager({
        globalDir: GLOBAL_DIR,
        fileNames: [],
        watchForChanges: false,
      });

      const result = await emptyManager.load(CWD);

      expect(result).toEqual([]);
    });

    it('should use different cwd values correctly', async () => {
      const cwd1 = '/project/one';
      const cwd2 = '/project/two';

      const path1 = path.join(cwd1, '.codebuddy', 'SOUL.md');
      const path2 = path.join(cwd2, '.codebuddy', 'SOUL.md');

      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === path1) return 'Project one soul';
        if (filePath === path2) return 'Project two soul';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === path1 || filePath === path2) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result1 = await manager.load(cwd1);
      expect(result1[0].content).toBe('Project one soul');

      const result2 = await manager.load(cwd2);
      expect(result2[0].content).toBe('Project two soul');
    });

    it('should trim content whitespace', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return '  \n  Hello World  \n  ';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello World');
    });

    it('should return IdentityFile with all required properties', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return 'Test content';
        throw new Error('ENOENT');
      });
      mockStat.mockImplementation(async (filePath: unknown) => {
        if (filePath === projectPath) return makeMockStat();
        throw new Error('ENOENT');
      });

      const result = await manager.load(CWD);
      const file = result[0];

      expect(file).toHaveProperty('name');
      expect(file).toHaveProperty('content');
      expect(file).toHaveProperty('source');
      expect(file).toHaveProperty('path');
      expect(file).toHaveProperty('lastModified');
      expect(typeof file.name).toBe('string');
      expect(typeof file.content).toBe('string');
      expect(['project', 'global']).toContain(file.source);
      expect(path.isAbsolute(file.path)).toBe(true);
      expect(file.lastModified).toBeInstanceOf(Date);
    });
  });
});
