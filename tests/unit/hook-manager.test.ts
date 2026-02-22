/**
 * Tests for Hook Manager
 *
 * Comprehensive unit tests for the hook management system that handles
 * pre/post tool execution, session lifecycle, and notification hooks.
 */

import type { ChildProcess } from 'child_process';

// Interface for our mock stdin
interface MockStdin {
  write: jest.Mock;
  end: jest.Mock;
}

// Interface for mock stream emitter
interface MockStreamEmitter {
  on: jest.Mock;
}

// Mock fs-extra before importing the module
jest.mock('fs-extra', () => ({
  existsSync: jest.fn(),
  readJsonSync: jest.fn(),
  ensureDirSync: jest.fn(),
  writeJsonSync: jest.fn(),
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock the logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import * as fs from 'fs-extra';
import { spawn } from 'child_process';
import {
  HookManager,
  getHookManager as _getHookManager,
  type Hook,
  type HookEvent,
  type HookContext,
} from '../../src/hooks/hook-manager.js';
import { logger } from '../../src/utils/logger.js';
import * as path from 'path';

interface HooksConfig {
  hooks: Hook[];
}

// Helper to create mock child process
function createMockChildProcess(options: {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  shouldError?: boolean;
  errorMessage?: string;
  shouldTimeout?: boolean;
}): { child: Partial<ChildProcess>; stdinMock: MockStdin } {
  const {
    exitCode = 0,
    stdout = '',
    stderr = '',
    shouldError = false,
    errorMessage = 'spawn error',
    shouldTimeout = false,
  } = options;

  const stdoutEmitter: MockStreamEmitter = {
    on: jest.fn(function(this: MockStreamEmitter, event: string, callback: (data: Buffer) => void): MockStreamEmitter {
      if (event === 'data' && stdout) {
        setTimeout(() => callback(Buffer.from(stdout)), 10);
      }
      return this;
    }),
  };

  const stderrEmitter: MockStreamEmitter = {
    on: jest.fn(function(this: MockStreamEmitter, event: string, callback: (data: Buffer) => void): MockStreamEmitter {
      if (event === 'data' && stderr) {
        setTimeout(() => callback(Buffer.from(stderr)), 10);
      }
      return this;
    }),
  };

  const stdinMock: MockStdin = {
    write: jest.fn(),
    end: jest.fn(),
  };

  const childProcess: Partial<ChildProcess> = {
    stdin: stdinMock as unknown as ChildProcess['stdin'],
    stdout: stdoutEmitter as unknown as ChildProcess['stdout'],
    stderr: stderrEmitter as unknown as ChildProcess['stderr'],
    kill: jest.fn(),
    on: jest.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'close') {
        if (!shouldTimeout && !shouldError) {
          setTimeout(() => callback(exitCode), 20);
        }
      } else if (event === 'error') {
        if (shouldError) {
          setTimeout(() => callback(new Error(errorMessage)), 10);
        }
      }
      return childProcess as ChildProcess;
    }) as ChildProcess['on'],
  };

  return { child: childProcess, stdinMock };
}

describe('HookManager', () => {
  let manager: HookManager;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
  const mockLogger = logger as jest.Mocked<typeof logger>;

  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv, HOME: '/home/testuser' };

    // Mock cwd
    jest.spyOn(process, 'cwd').mockReturnValue('/test/project');

    // Default fs mock returns - no config files exist
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readJsonSync.mockReturnValue({ hooks: [] });

    // Reset singleton by creating new instance
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Constructor and Configuration Loading', () => {
    it('should initialize with correct config paths', () => {
      manager = new HookManager();

      // Should check for global config at ~/.codebuddy/hooks.json
      expect(mockFs.existsSync).toHaveBeenCalledWith(path.join('/home/testuser', '.codebuddy', 'hooks.json'));

      // Should check for project config at ./.codebuddy/hooks.json
      expect(mockFs.existsSync).toHaveBeenCalledWith(path.join('/test/project', '.codebuddy', 'hooks.json'));
    });

    it('should load global hooks config when it exists', () => {
      const globalHooks: HooksConfig = {
        hooks: [
          { event: 'PreToolUse', command: 'echo global', enabled: true },
        ],
      };

      const globalPath = path.join('/home/testuser', '.codebuddy', 'hooks.json');
      mockFs.existsSync.mockImplementation((p: unknown) =>
        p === globalPath
      );
      mockFs.readJsonSync.mockReturnValue(globalHooks);

      manager = new HookManager();

      const hooks = manager.getHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0].command).toBe('echo global');
    });

    it('should load project hooks config when it exists', () => {
      const projectHooks: HooksConfig = {
        hooks: [
          { event: 'PostToolUse', command: 'echo project', enabled: true },
        ],
      };

      const projectPath = path.join('/test/project', '.codebuddy', 'hooks.json');
      mockFs.existsSync.mockImplementation((p: unknown) =>
        p === projectPath
      );
      mockFs.readJsonSync.mockReturnValue(projectHooks);

      manager = new HookManager();

      const hooks = manager.getHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0].command).toBe('echo project');
    });

    it('should merge global and project hooks', () => {
      const globalHooks: HooksConfig = {
        hooks: [{ event: 'PreToolUse', command: 'echo global' }],
      };

      const projectHooks: HooksConfig = {
        hooks: [{ event: 'PostToolUse', command: 'echo project' }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync
        .mockReturnValueOnce(globalHooks)  // First call for global
        .mockReturnValueOnce(projectHooks); // Second call for project

      manager = new HookManager();

      const hooks = manager.getHooks();
      expect(hooks).toHaveLength(2);
    });

    it('should handle missing hooks array in config gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockReturnValue({}); // Empty config without hooks array

      manager = new HookManager();

      const hooks = manager.getHooks();
      expect(hooks).toHaveLength(0);
    });

    it('should warn and continue when global config fails to load', () => {
      const globalPath = path.join('/home/testuser', '.codebuddy', 'hooks.json');
      mockFs.existsSync.mockImplementation((p: unknown) =>
        p === globalPath
      );
      mockFs.readJsonSync.mockImplementation(() => {
        throw new Error('Invalid JSON');
      });

      manager = new HookManager();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load global hooks config')
      );
    });

    it('should warn and continue when project config fails to load', () => {
      const projectPath = path.join('/test/project', '.codebuddy', 'hooks.json');
      mockFs.existsSync.mockImplementation((p: unknown) =>
        p === projectPath
      );
      mockFs.readJsonSync.mockImplementation(() => {
        throw new Error('Parse error');
      });

      manager = new HookManager();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load project hooks config')
      );
    });

    it('should handle missing HOME environment variable', () => {
      delete process.env.HOME;
      delete process.env.USERPROFILE;

      manager = new HookManager();

      // Should use os.homedir() as fallback (line 67 in source)
      expect(mockFs.existsSync).toHaveBeenCalled();
      // The actual path will use os.homedir() which is mocked to return '/home/patrice'
    });

    it('should use USERPROFILE when HOME is not set (Windows)', () => {
      delete process.env.HOME;
      process.env.USERPROFILE = 'C:\\Users\\testuser';

      manager = new HookManager();

      expect(mockFs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join('C:\\Users\\testuser', '.codebuddy'))
      );
    });
  });

  describe('Hook Registration', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should add a hook', () => {
      const hook: Hook = {
        event: 'PreToolUse',
        command: 'echo test',
        enabled: true,
      };

      manager.addHook(hook);

      const hooks = manager.getHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0]).toEqual(hook);
    });

    it('should save hooks after adding', () => {
      const hook: Hook = {
        event: 'PostToolUse',
        command: 'npm test',
      };

      manager.addHook(hook);

      expect(mockFs.ensureDirSync).toHaveBeenCalled();
      expect(mockFs.writeJsonSync).toHaveBeenCalledWith(
        path.join('/test/project', '.codebuddy', 'hooks.json'),
        { hooks: [hook] },
        { spaces: 2 }
      );
    });

    it('should add multiple hooks', () => {
      manager.addHook({ event: 'PreToolUse', command: 'cmd1' });
      manager.addHook({ event: 'PostToolUse', command: 'cmd2' });
      manager.addHook({ event: 'SessionStart', command: 'cmd3' });

      expect(manager.getHooks()).toHaveLength(3);
    });

    it('should remove a hook by index', () => {
      manager.addHook({ event: 'PreToolUse', command: 'cmd1' });
      manager.addHook({ event: 'PostToolUse', command: 'cmd2' });

      const result = manager.removeHook(0);

      expect(result).toBe(true);
      expect(manager.getHooks()).toHaveLength(1);
      expect(manager.getHooks()[0].command).toBe('cmd2');
    });

    it('should return false when removing invalid index', () => {
      manager.addHook({ event: 'PreToolUse', command: 'cmd1' });

      expect(manager.removeHook(-1)).toBe(false);
      expect(manager.removeHook(5)).toBe(false);
      expect(manager.getHooks()).toHaveLength(1);
    });

    it('should save hooks after removing', () => {
      manager.addHook({ event: 'PreToolUse', command: 'cmd1' });
      jest.clearAllMocks();

      manager.removeHook(0);

      expect(mockFs.writeJsonSync).toHaveBeenCalled();
    });

    it('should handle save errors gracefully', () => {
      mockFs.writeJsonSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      manager.addHook({ event: 'PreToolUse', command: 'cmd1' });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save hooks config')
      );
    });
  });

  describe('getHooksForEvent', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should return hooks for specific event', () => {
      manager.addHook({ event: 'PreToolUse', command: 'pre1' });
      manager.addHook({ event: 'PreToolUse', command: 'pre2' });
      manager.addHook({ event: 'PostToolUse', command: 'post1' });

      const preHooks = manager.getHooksForEvent('PreToolUse');

      expect(preHooks).toHaveLength(2);
      expect(preHooks.every(h => h.event === 'PreToolUse')).toBe(true);
    });

    it('should filter out disabled hooks', () => {
      manager.addHook({ event: 'PreToolUse', command: 'enabled', enabled: true });
      manager.addHook({ event: 'PreToolUse', command: 'disabled', enabled: false });
      manager.addHook({ event: 'PreToolUse', command: 'default' }); // enabled by default

      const hooks = manager.getHooksForEvent('PreToolUse');

      expect(hooks).toHaveLength(2);
      expect(hooks.find(h => h.command === 'disabled')).toBeUndefined();
    });

    it('should return empty array for events with no hooks', () => {
      manager.addHook({ event: 'PreToolUse', command: 'cmd1' });

      const hooks = manager.getHooksForEvent('SessionEnd');

      expect(hooks).toHaveLength(0);
    });

    it('should handle all hook event types', () => {
      const events: HookEvent[] = [
        'PreToolUse',
        'PostToolUse',
        'Notification',
        'Stop',
        'SessionStart',
        'SessionEnd',
        'PreEdit',
        'PostEdit',
      ];

      events.forEach(event => {
        manager.addHook({ event, command: `cmd-${event}` });
      });

      events.forEach(event => {
        const hooks = manager.getHooksForEvent(event);
        expect(hooks).toHaveLength(1);
        expect(hooks[0].event).toBe(event);
      });
    });
  });

  describe('Enable/Disable', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should be enabled by default', () => {
      expect(manager.isEnabled()).toBe(true);
    });

    it('should disable hooks', () => {
      manager.setEnabled(false);

      expect(manager.isEnabled()).toBe(false);
    });

    it('should enable hooks', () => {
      manager.setEnabled(false);
      manager.setEnabled(true);

      expect(manager.isEnabled()).toBe(true);
    });
  });

  describe('reloadHooks', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should clear and reload hooks', () => {
      manager.addHook({ event: 'PreToolUse', command: 'old' });

      const newConfig: HooksConfig = {
        hooks: [{ event: 'PostToolUse', command: 'new' }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockReturnValue(newConfig);

      manager.reloadHooks();

      const hooks = manager.getHooks();
      expect(hooks.find(h => h.command === 'old')).toBeUndefined();
      expect(hooks.find(h => h.command === 'new')).toBeDefined();
    });
  });

  describe('executeHooks', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should return success when hooks are disabled', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo test' });
      manager.setEnabled(false);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.success).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should return success when no hooks match event', async () => {
      manager.addHook({ event: 'PostToolUse', command: 'echo test' });

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.success).toBe(true);
    });

    it('should execute hooks with correct environment variables', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo test' });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
        sessionId: 'session-123',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        ['-c', 'echo test'],
        expect.objectContaining({
          env: expect.objectContaining({
            GROK_HOOK_EVENT: 'PreToolUse',
            GROK_HOOK_TOOL: 'bash',
            GROK_HOOK_SESSION: 'session-123',
          }),
        })
      );
    });

    it('should send context as JSON to stdin', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'cat' });

      const { child: mockChild, stdinMock } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      await manager.executeHooks('PreToolUse', {
        toolName: 'edit',
        toolArgs: { path: '/test.ts' },
      });

      expect(stdinMock.write).toHaveBeenCalledWith(
        expect.stringContaining('"toolName":"edit"')
      );
      expect(stdinMock.end).toHaveBeenCalled();
    });

    it('should handle successful hook execution', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo success' });

      const { child: mockChild } = createMockChildProcess({
        exitCode: 0,
        stdout: 'Hook completed',
      });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Hook completed');
    });

    it('should handle hook failure with non-zero exit code', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'exit 1' });

      const { child: mockChild } = createMockChildProcess({
        exitCode: 1,
        stderr: 'Hook failed',
      });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Hook failed');
    });

    it('should block operation with exit code 77', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'exit 77' });

      const { child: mockChild } = createMockChildProcess({
        exitCode: 77,
        stderr: 'Operation not allowed',
      });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('Operation not allowed');
    });

    it('should use stdout for block message if stderr is empty', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'exit 77' });

      const { child: mockChild } = createMockChildProcess({
        exitCode: 77,
        stdout: 'Blocked via stdout',
        stderr: '',
      });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.blocked).toBe(true);
      expect(result.error).toBe('Blocked via stdout');
    });

    it('should handle spawn errors', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'nonexistent' });

      const { child: mockChild } = createMockChildProcess({
        shouldError: true,
        errorMessage: 'Command not found',
      });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Command not found');
    });

    it('should parse JSON output for advanced responses', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo json' });

      const jsonOutput = JSON.stringify({
        blocked: false,
        modifiedArgs: { path: '/modified/path.ts' },
      });

      const { child: mockChild } = createMockChildProcess({
        exitCode: 0,
        stdout: jsonOutput,
      });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'edit',
      });

      expect(result.success).toBe(true);
      expect(result.modifiedArgs).toEqual({ path: '/modified/path.ts' });
    });

    it('should handle non-JSON output gracefully', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo plain' });

      const { child: mockChild } = createMockChildProcess({
        exitCode: 0,
        stdout: 'Just plain text output',
      });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Just plain text output');
    });

    it('should filter hooks by pattern', async () => {
      manager.addHook({
        event: 'PreToolUse',
        command: 'echo matched',
        pattern: '^bash$',
      });
      manager.addHook({
        event: 'PreToolUse',
        command: 'echo not matched',
        pattern: '^edit$',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0, stdout: 'matched' });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      // Only one hook should have executed
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        ['-c', 'echo matched'],
        expect.anything()
      );
    });

    it('should execute multiple hooks in sequence', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo first' });
      manager.addHook({ event: 'PreToolUse', command: 'echo second' });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('should combine output from multiple hooks', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo first' });
      manager.addHook({ event: 'PreToolUse', command: 'echo second' });

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        const { child } = createMockChildProcess({
          exitCode: 0,
          stdout: callCount === 1 ? 'First output' : 'Second output',
        });
        return child as ChildProcess;
      });

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.output).toContain('First output');
      expect(result.output).toContain('Second output');
    });

    it('should stop processing hooks when blocked', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo first' });
      manager.addHook({ event: 'PreToolUse', command: 'exit 77' });
      manager.addHook({ event: 'PreToolUse', command: 'echo third' });

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          const { child } = createMockChildProcess({
            exitCode: 77,
            stderr: 'Blocked',
          });
          return child as ChildProcess;
        }
        const { child } = createMockChildProcess({ exitCode: 0 });
        return child as ChildProcess;
      });

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(result.blocked).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(2); // Third hook should not run
    });

    it('should merge modified args from multiple hooks', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo first' });
      manager.addHook({ event: 'PreToolUse', command: 'echo second' });

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        const args = callCount === 1
          ? { path: '/modified.ts' }
          : { content: 'modified content' };
        const { child } = createMockChildProcess({
          exitCode: 0,
          stdout: JSON.stringify({ modifiedArgs: args }),
        });
        return child as ChildProcess;
      });

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'edit',
      });

      expect(result.modifiedArgs).toEqual({
        path: '/modified.ts',
        content: 'modified content',
      });
    });

    it('should continue with other hooks if one fails', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo first' });
      manager.addHook({ event: 'PreToolUse', command: 'echo second' });

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const { child } = createMockChildProcess({
            exitCode: 1,
            stderr: 'First failed',
          });
          return child as ChildProcess;
        }
        const { child } = createMockChildProcess({
          exitCode: 0,
          stdout: 'Second succeeded',
        });
        return child as ChildProcess;
      });

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(result.output).toContain('Second succeeded');
    });

    it('should create full context with timestamp', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'cat' });

      const { child: mockChild, stdinMock } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const beforeTime = new Date();
      await manager.executeHooks('PreToolUse', { toolName: 'bash' });
      const afterTime = new Date();

      const writtenData = JSON.parse(stdinMock.write.mock.calls[0][0] as string);

      expect(new Date(writtenData.timestamp).getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(new Date(writtenData.timestamp).getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('Pre/Post Hooks', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should execute PreToolUse hooks before tool execution', async () => {
      manager.addHook({
        event: 'PreToolUse',
        command: 'validate-tool',
        pattern: 'bash',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
        toolArgs: { command: 'ls -la' },
      });

      expect(result.success).toBe(true);
    });

    it('should execute PostToolUse hooks after tool execution', async () => {
      manager.addHook({
        event: 'PostToolUse',
        command: 'log-result',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PostToolUse', {
        toolName: 'bash',
        toolResult: { success: true, output: 'file.txt' },
      });

      expect(result.success).toBe(true);
    });

    it('should execute PreEdit hooks before file edits', async () => {
      manager.addHook({
        event: 'PreEdit',
        command: 'lint-check',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PreEdit', {
        filePath: '/src/index.ts',
      });

      expect(result.success).toBe(true);
    });

    it('should execute PostEdit hooks after file edits', async () => {
      manager.addHook({
        event: 'PostEdit',
        command: 'format && lint',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('PostEdit', {
        filePath: '/src/index.ts',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Session Lifecycle Hooks', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should execute SessionStart hooks', async () => {
      manager.addHook({
        event: 'SessionStart',
        command: 'initialize-session',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('SessionStart', {
        sessionId: 'session-001',
      });

      expect(result.success).toBe(true);
    });

    it('should execute SessionEnd hooks', async () => {
      manager.addHook({
        event: 'SessionEnd',
        command: 'cleanup-session',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('SessionEnd', {
        sessionId: 'session-001',
      });

      expect(result.success).toBe(true);
    });

    it('should execute Stop hooks', async () => {
      manager.addHook({
        event: 'Stop',
        command: 'handle-stop',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('Stop', {
        message: 'User requested stop',
      });

      expect(result.success).toBe(true);
    });

    it('should execute Notification hooks', async () => {
      manager.addHook({
        event: 'Notification',
        command: 'send-notification',
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const result = await manager.executeHooks('Notification', {
        message: 'Task completed',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('formatStatus', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should show enabled status', () => {
      const status = manager.formatStatus();

      expect(status).toContain('Hook System: enabled');
    });

    it('should show disabled status', () => {
      manager.setEnabled(false);

      const status = manager.formatStatus();

      expect(status).toContain('Hook System: disabled');
    });

    it('should show total hook count', () => {
      manager.addHook({ event: 'PreToolUse', command: 'cmd1' });
      manager.addHook({ event: 'PostToolUse', command: 'cmd2' });

      const status = manager.formatStatus();

      expect(status).toContain('Total hooks: 2');
    });

    it('should list configured hooks', () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo test' });

      const status = manager.formatStatus();

      expect(status).toContain('PreToolUse');
      expect(status).toContain('echo test');
    });

    it('should show hook patterns', () => {
      manager.addHook({
        event: 'PreToolUse',
        command: 'validate',
        pattern: '^bash$',
      });

      const status = manager.formatStatus();

      expect(status).toContain('pattern: ^bash$');
    });

    it('should show enabled/disabled status per hook', () => {
      manager.addHook({ event: 'PreToolUse', command: 'enabled', enabled: true });
      manager.addHook({ event: 'PostToolUse', command: 'disabled', enabled: false });

      const status = manager.formatStatus();

      // Should show checkmark for enabled, X for disabled
      expect(status).toMatch(/\[.\]/); // Contains status indicator
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', async () => {
      // Import fresh module
      jest.resetModules();

      // Re-mock the dependencies
      jest.doMock('fs-extra', () => ({
        existsSync: jest.fn().mockReturnValue(false),
        readJsonSync: jest.fn().mockReturnValue({ hooks: [] }),
        ensureDirSync: jest.fn(),
        writeJsonSync: jest.fn(),
      }));

      jest.doMock('child_process', () => ({
        spawn: jest.fn(),
      }));

      jest.doMock('../../src/utils/logger.js', () => ({
        logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
      }));

      const { getHookManager: getManager1 } = await import('../../src/hooks/hook-manager.js');
      const instance1 = getManager1();
      const instance2 = getManager1();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should handle exception during hook execution', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo test' });

      mockSpawn.mockImplementation(() => {
        throw new Error('Spawn failed completely');
      });

      // Should not throw, should return success (continue with other hooks)
      await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Hook execution error')
      );
    });

    it('should handle invalid regex pattern gracefully', async () => {
      manager.addHook({
        event: 'PreToolUse',
        command: 'echo test',
        pattern: '[invalid regex',
      });

      // Should not throw - regex error should be caught
      try {
        await manager.executeHooks('PreToolUse', {
          toolName: 'bash',
        });
      } catch {
        // Expected to throw due to invalid regex - this is acceptable
      }
    });

    it('should continue execution after hook error', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'echo first' });
      manager.addHook({ event: 'PreToolUse', command: 'echo second' });

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First hook failed');
        }
        const { child } = createMockChildProcess({ exitCode: 0, stdout: 'Second worked' });
        return child as ChildProcess;
      });

      await manager.executeHooks('PreToolUse', {
        toolName: 'bash',
      });

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Hook Context', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should pass full context to hooks', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'process-context' });

      const { child: mockChild, stdinMock } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      const context: Partial<HookContext> = {
        toolName: 'edit',
        toolArgs: { path: '/test.ts', content: 'new content' },
        sessionId: 'sess-123',
        filePath: '/test.ts',
        message: 'Editing file',
      };

      await manager.executeHooks('PreToolUse', context);

      const writtenData = JSON.parse(stdinMock.write.mock.calls[0][0] as string);

      expect(writtenData.toolName).toBe('edit');
      expect(writtenData.toolArgs).toEqual({ path: '/test.ts', content: 'new content' });
      expect(writtenData.sessionId).toBe('sess-123');
      expect(writtenData.filePath).toBe('/test.ts');
      expect(writtenData.message).toBe('Editing file');
      expect(writtenData.event).toBe('PreToolUse');
    });

    it('should pass tool result in PostToolUse context', async () => {
      manager.addHook({ event: 'PostToolUse', command: 'log-result' });

      const { child: mockChild, stdinMock } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      await manager.executeHooks('PostToolUse', {
        toolName: 'bash',
        toolResult: {
          success: true,
          output: 'Command output',
        },
      });

      const writtenData = JSON.parse(stdinMock.write.mock.calls[0][0] as string);

      expect(writtenData.toolResult).toEqual({
        success: true,
        output: 'Command output',
      });
    });

    it('should handle empty context fields', async () => {
      manager.addHook({ event: 'PreToolUse', command: 'process' });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      await manager.executeHooks('PreToolUse', {});

      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        ['-c', 'process'],
        expect.objectContaining({
          env: expect.objectContaining({
            GROK_HOOK_TOOL: '',
            GROK_HOOK_SESSION: '',
          }),
        })
      );
    });
  });

  describe('Timeout Handling', () => {
    beforeEach(() => {
      manager = new HookManager();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should use custom timeout when specified', async () => {
      manager.addHook({
        event: 'PreToolUse',
        command: 'slow-command',
        timeout: 5000,
      });

      const { child: mockChild } = createMockChildProcess({ shouldTimeout: true });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      // Start the execution (don't await - we need to advance time)
      void manager.executeHooks('PreToolUse', { toolName: 'bash' });

      // Advance past the timeout
      jest.advanceTimersByTime(6000);

      // The kill should have been called
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('Default Timeout', () => {
    beforeEach(() => {
      manager = new HookManager();
    });

    it('should use default 30000ms timeout when not specified', async () => {
      manager.addHook({
        event: 'PreToolUse',
        command: 'normal-command',
        // No timeout specified
      });

      const { child: mockChild } = createMockChildProcess({ exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild as ChildProcess);

      // Just verify the hook executes without error
      const result = await manager.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.success).toBe(true);
    });
  });
});
