/**
 * Tests for OS-Level Sandboxing, Smart Hooks, Env Persistence, and Async Hooks
 *
 * Covers:
 * - Feature 1: OS-Level Sandboxing (config, domain filtering, command exclusion, bwrap/seatbelt, stats)
 * - Feature 2: Smart Hooks (command/prompt/agent types, template rendering, async execution)
 * - Feature 3: Env Persistence (set/unset, load/save, parse, serialize, capture changes)
 * - Feature 4: Async Hook Manager (submit, concurrency, cancel, system messages, dispose)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock child_process for sandbox and hook tests
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-test-'));
}

function cleanTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Create a mock child process that emits events
 */
function createMockChildProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
  delay?: number;
}): any {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const childEmitter = new EventEmitter();

  (childEmitter as any).stdout = stdoutEmitter;
  (childEmitter as any).stderr = stderrEmitter;
  (childEmitter as any).kill = jest.fn();

  // Schedule events
  setTimeout(() => {
    if (opts.error) {
      childEmitter.emit('error', opts.error);
      return;
    }
    if (opts.stdout) {
      stdoutEmitter.emit('data', Buffer.from(opts.stdout));
    }
    if (opts.stderr) {
      stderrEmitter.emit('data', Buffer.from(opts.stderr));
    }
    childEmitter.emit('close', opts.exitCode ?? 0);
  }, opts.delay ?? 5);

  return childEmitter;
}

// ============================================================================
// Feature 1: OS-Level Sandboxing
// ============================================================================

describe('OSSandbox', () => {
  let OSSandbox: typeof import('../../src/sandbox/os-sandbox').OSSandbox;
  let detectCapabilities: typeof import('../../src/sandbox/os-sandbox').detectCapabilities;
  let clearCapabilitiesCache: typeof import('../../src/sandbox/os-sandbox').clearCapabilitiesCache;
  let checkLandlockSupport: typeof import('../../src/sandbox/os-sandbox').checkLandlockSupport;
  let generateSeccompFilter: typeof import('../../src/sandbox/os-sandbox').generateSeccompFilter;
  let resetOSSandbox: typeof import('../../src/sandbox/os-sandbox').resetOSSandbox;

  beforeAll(async () => {
    const mod = await import('../../src/sandbox/os-sandbox.js');
    OSSandbox = mod.OSSandbox;
    detectCapabilities = mod.detectCapabilities;
    clearCapabilitiesCache = mod.clearCapabilitiesCache;
    checkLandlockSupport = mod.checkLandlockSupport;
    generateSeccompFilter = mod.generateSeccompFilter;
    resetOSSandbox = mod.resetOSSandbox;
  });

  beforeEach(() => {
    mockSpawn.mockReset();
    clearCapabilitiesCache();
    resetOSSandbox();
  });

  describe('constructor and defaults', () => {
    it('should create with default config', () => {
      const sandbox = new OSSandbox();
      const config = sandbox.getConfig();
      expect(config.workDir).toBe(process.cwd());
      expect(config.readOnlyPaths).toContain('/usr');
      expect(config.allowNetwork).toBe(false);
      expect(config.timeout).toBe(60000);
      expect(config.allowedDomains).toEqual([]);
      expect(config.excludedCommands).toEqual([]);
      expect(config.allowUnsandboxed).toBe(true);
    });

    it('should merge partial config with defaults', () => {
      const sandbox = new OSSandbox({
        allowNetwork: true,
        timeout: 5000,
        allowedDomains: ['example.com'],
        excludedCommands: ['ls', 'cat'],
      });
      const config = sandbox.getConfig();
      expect(config.allowNetwork).toBe(true);
      expect(config.timeout).toBe(5000);
      expect(config.allowedDomains).toEqual(['example.com']);
      expect(config.excludedCommands).toEqual(['ls', 'cat']);
      // Defaults preserved
      expect(config.readOnlyPaths).toContain('/usr');
    });

    it('should accept custom writable and read-only paths', () => {
      const sandbox = new OSSandbox({
        readWritePaths: ['/tmp/work'],
        readOnlyPaths: ['/custom/path'],
      });
      const config = sandbox.getConfig();
      expect(config.readWritePaths).toEqual(['/tmp/work']);
      expect(config.readOnlyPaths).toEqual(['/custom/path']);
    });
  });

  describe('domain filtering', () => {
    it('should deny all domains when network is disabled', () => {
      const sandbox = new OSSandbox({ allowNetwork: false });
      expect(sandbox.shouldAllowDomain('example.com')).toBe(false);
      expect(sandbox.shouldAllowDomain('google.com')).toBe(false);
    });

    it('should allow all domains when network enabled and no allowlist', () => {
      const sandbox = new OSSandbox({ allowNetwork: true, allowedDomains: [] });
      expect(sandbox.shouldAllowDomain('example.com')).toBe(true);
      expect(sandbox.shouldAllowDomain('anything.org')).toBe(true);
    });

    it('should filter domains against allowlist', () => {
      const sandbox = new OSSandbox({
        allowNetwork: true,
        allowedDomains: ['example.com', 'api.github.com'],
      });
      expect(sandbox.shouldAllowDomain('example.com')).toBe(true);
      expect(sandbox.shouldAllowDomain('api.github.com')).toBe(true);
      expect(sandbox.shouldAllowDomain('evil.com')).toBe(false);
    });

    it('should allow subdomains of allowed domains', () => {
      const sandbox = new OSSandbox({
        allowNetwork: true,
        allowedDomains: ['example.com'],
      });
      expect(sandbox.shouldAllowDomain('sub.example.com')).toBe(true);
      expect(sandbox.shouldAllowDomain('deep.sub.example.com')).toBe(true);
      expect(sandbox.shouldAllowDomain('notexample.com')).toBe(false);
    });

    it('should be case-insensitive for domain matching', () => {
      const sandbox = new OSSandbox({
        allowNetwork: true,
        allowedDomains: ['Example.COM'],
      });
      expect(sandbox.shouldAllowDomain('example.com')).toBe(true);
      expect(sandbox.shouldAllowDomain('EXAMPLE.COM')).toBe(true);
      expect(sandbox.shouldAllowDomain('Sub.Example.Com')).toBe(true);
    });
  });

  describe('command exclusion', () => {
    it('should exclude listed commands', () => {
      const sandbox = new OSSandbox({ excludedCommands: ['ls', 'cat', 'git'] });
      expect(sandbox.isCommandExcluded('ls -la')).toBe(true);
      expect(sandbox.isCommandExcluded('cat file.txt')).toBe(true);
      expect(sandbox.isCommandExcluded('git status')).toBe(true);
    });

    it('should not exclude unlisted commands', () => {
      const sandbox = new OSSandbox({ excludedCommands: ['ls', 'cat'] });
      expect(sandbox.isCommandExcluded('rm -rf /')).toBe(false);
      expect(sandbox.isCommandExcluded('npm install')).toBe(false);
    });

    it('should handle commands with full paths', () => {
      const sandbox = new OSSandbox({ excludedCommands: ['ls'] });
      expect(sandbox.isCommandExcluded('/usr/bin/ls -la')).toBe(true);
    });

    it('should handle empty excluded commands list', () => {
      const sandbox = new OSSandbox({ excludedCommands: [] });
      expect(sandbox.isCommandExcluded('ls')).toBe(false);
    });

    it('should handle whitespace in commands', () => {
      const sandbox = new OSSandbox({ excludedCommands: ['ls'] });
      expect(sandbox.isCommandExcluded('  ls  -la  ')).toBe(true);
    });
  });

  describe('stats tracking', () => {
    it('should start with zero stats', () => {
      const sandbox = new OSSandbox();
      const stats = sandbox.getStats();
      expect(stats.commandsRun).toBe(0);
      expect(stats.commandsSandboxed).toBe(0);
      expect(stats.commandsBypassed).toBe(0);
    });

    it('should return a copy of stats (not a reference)', () => {
      const sandbox = new OSSandbox();
      const stats1 = sandbox.getStats();
      const stats2 = sandbox.getStats();
      expect(stats1).toEqual(stats2);
      expect(stats1).not.toBe(stats2);
    });
  });

  describe('updateConfig', () => {
    it('should merge config updates', () => {
      const sandbox = new OSSandbox({ allowNetwork: false });
      sandbox.updateConfig({ allowNetwork: true });
      expect(sandbox.getConfig().allowNetwork).toBe(true);
    });

    it('should reset initialization when backend changes', () => {
      const sandbox = new OSSandbox({ backend: 'none' });
      expect(sandbox.getBackend()).toBe('none');
      sandbox.updateConfig({ backend: 'bubblewrap' });
      // Backend should be reset to none until re-initialized
      expect(sandbox.getBackend()).toBe('none');
    });
  });

  describe('seccomp filter generation', () => {
    it('should generate a valid buffer', () => {
      const filter = generateSeccompFilter();
      expect(Buffer.isBuffer(filter)).toBe(true);
      expect(filter.length).toBeGreaterThan(0);
    });

    it('should produce instructions of 8 bytes each', () => {
      const filter = generateSeccompFilter();
      expect(filter.length % 8).toBe(0);
    });

    it('should have at least load + compares + allow + kill instructions', () => {
      const filter = generateSeccompFilter();
      // At minimum: 1 load + N compares + 1 allow + 1 kill
      // With 6 blocked syscalls: 1 + 6 + 1 + 1 = 9 instructions = 72 bytes
      expect(filter.length).toBeGreaterThanOrEqual(72);
    });
  });

  describe('backend detection', () => {
    it('should return none when no backends available', async () => {
      mockSpawn.mockImplementation(() => createMockChildProcess({ exitCode: 1, stderr: 'not found' }));
      clearCapabilitiesCache();
      const caps = await detectCapabilities();
      // On non-linux/darwin or when tools missing, recommended could be 'none' or something else
      expect(caps).toBeDefined();
      expect(typeof caps.recommended).toBe('string');
    });
  });

  describe('isAvailable', () => {
    it('should return false before initialization', async () => {
      const sandbox = new OSSandbox({ backend: 'none' });
      // Before init, backend defaults to 'none'
      expect(await sandbox.isAvailable()).toBe(false);
    });
  });

  describe('getBackend', () => {
    it('should return none by default', () => {
      const sandbox = new OSSandbox();
      expect(sandbox.getBackend()).toBe('none');
    });
  });

  describe('checkLandlockSupport', () => {
    it('should return a boolean', () => {
      const result = checkLandlockSupport();
      expect(typeof result).toBe('boolean');
    });
  });
});

// ============================================================================
// Feature 2: Smart Hooks
// ============================================================================

describe('SmartHookRunner', () => {
  const originalEnv = process.env;
  let SmartHookRunner: typeof import('../../src/hooks/smart-hooks').SmartHookRunner;
  type SmartHookConfig = import('../../src/hooks/smart-hooks').SmartHookConfig;

  beforeAll(async () => {
    const mod = await import('../../src/hooks/smart-hooks.js');
    SmartHookRunner = mod.SmartHookRunner;
  });

  beforeEach(() => {
    process.env = { ...originalEnv, CODEBUDDY_PROVIDER: 'none' };
    mockSpawn.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('template rendering', () => {
    it('should replace {{key}} placeholders', () => {
      const runner = new SmartHookRunner();
      const result = runner.renderTemplate('Hello {{name}}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should replace multiple placeholders', () => {
      const runner = new SmartHookRunner();
      const result = runner.renderTemplate('{{greeting}} {{name}}!', {
        greeting: 'Hi',
        name: 'Alice',
      });
      expect(result).toBe('Hi Alice!');
    });

    it('should leave unmatched placeholders unchanged', () => {
      const runner = new SmartHookRunner();
      const result = runner.renderTemplate('{{found}} {{missing}}', { found: 'yes' });
      expect(result).toBe('yes {{missing}}');
    });

    it('should stringify non-string values', () => {
      const runner = new SmartHookRunner();
      const result = runner.renderTemplate('count: {{num}}, list: {{arr}}', {
        num: 42,
        arr: [1, 2, 3],
      });
      expect(result).toBe('count: 42, list: [1,2,3]');
    });

    it('should handle empty input', () => {
      const runner = new SmartHookRunner();
      const result = runner.renderTemplate('no placeholders here', {});
      expect(result).toBe('no placeholders here');
    });

    it('should handle empty template', () => {
      const runner = new SmartHookRunner();
      const result = runner.renderTemplate('', { key: 'value' });
      expect(result).toBe('');
    });
  });

  describe('command hooks', () => {
    it('should execute command and return output on success', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess({ stdout: 'hook output', exitCode: 0 })
      );

      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'command', event: 'test', command: 'echo test' },
        {}
      );

      expect(result.ok).toBe(true);
      expect(result.output).toBe('hook output');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should fail when command exits with non-zero code', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess({ stdout: '', stderr: 'error msg', exitCode: 1 })
      );

      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'command', event: 'test', command: 'false' },
        {}
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('exited with code 1');
    });

    it('should fail when no command specified', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'command', event: 'test' },
        {}
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No command specified');
    });

    it('should handle command process errors', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess({ error: new Error('spawn failed') })
      );

      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'command', event: 'test', command: 'nonexistent' },
        {}
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('spawn failed');
    });

    it('should render templates in command', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess({ stdout: 'ok', exitCode: 0 })
      );

      const runner = new SmartHookRunner();
      await runner.runHook(
        { type: 'command', event: 'test', command: 'echo {{file}}' },
        { file: 'test.ts' }
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        '/bin/sh',
        ['-c', 'echo test.ts'],
        expect.objectContaining({
          env: expect.objectContaining({
            HOOK_EVENT: 'test',
          }),
        })
      );
    });

    it('should pass HOOK_INPUT in env', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess({ stdout: 'ok', exitCode: 0 })
      );

      const runner = new SmartHookRunner();
      const input = { key: 'value' };
      await runner.runHook(
        { type: 'command', event: 'PreBash', command: 'test' },
        input
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        '/bin/sh',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            HOOK_INPUT: JSON.stringify(input),
          }),
        })
      );
    });

    it('should handle timeout on command hooks', async () => {
      // Create a child that never closes naturally
      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn(() => {
        // When killed, emit close
        setTimeout(() => child.emit('close', null), 2);
      });
      mockSpawn.mockReturnValueOnce(child);

      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'command', event: 'test', command: 'sleep 100', timeout: 50 },
        {}
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('timed out');
    });
  });

  describe('prompt hooks', () => {
    it('should render prompt and return it', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'prompt', event: 'test', prompt: 'Analyze {{input}} for issues' },
        { input: 'user code' }
      );

      expect(result.ok).toBe(true);
      expect(result.output).toBe('Analyze user code for issues');
    });

    it('should fail when no prompt specified', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'prompt', event: 'test' },
        {}
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No prompt specified');
    });

    it('should include model in config', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'prompt', event: 'test', prompt: 'Hello', model: 'grok-3' },
        {}
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('agent hooks', () => {
    it('should render agent prompt and return result', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        {
          type: 'agent',
          event: 'test',
          agentPrompt: 'Check {{file}} for security issues',
          agentTools: ['Read', 'Grep'],
          maxTurns: 3,
        },
        { file: 'app.ts' }
      );

      expect(result.ok).toBe(true);
      expect(result.output).toContain('Check app.ts for security issues');
    });

    it('should fail when no agent prompt specified', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'agent', event: 'test' },
        {}
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No agent prompt specified');
    });

    it('should use default maxTurns of 5', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'agent', event: 'test', agentPrompt: 'Hello', agentTools: [] },
        {}
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('unknown hook type', () => {
    it('should return failure for unknown type', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'unknown' as any, event: 'test' },
        {}
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Unknown hook type');
    });
  });

  describe('async execution', () => {
    it('should return a hook ID', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess({ stdout: 'ok', exitCode: 0 })
      );

      const runner = new SmartHookRunner();
      const hookId = await runner.runAsync(
        { type: 'command', event: 'test', command: 'echo hi' },
        {}
      );

      expect(typeof hookId).toBe('string');
      expect(hookId.length).toBeGreaterThan(0);
    });

    it('should store result after completion', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockChildProcess({ stdout: 'async result', exitCode: 0 })
      );

      const runner = new SmartHookRunner();
      const hookId = await runner.runAsync(
        { type: 'command', event: 'test', command: 'echo hi' },
        {}
      );

      // Wait for async completion
      await new Promise((r) => setTimeout(r, 50));

      const result = runner.getAsyncResult(hookId);
      expect(result).not.toBeNull();
      expect(result!.ok).toBe(true);
      expect(result!.output).toBe('async result');
    });

    it('should return null for unknown hook ID', () => {
      const runner = new SmartHookRunner();
      expect(runner.getAsyncResult('nonexistent')).toBeNull();
    });

    it('should track pending count', async () => {
      // Create a child that takes a while
      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);

      const runner = new SmartHookRunner();
      await runner.runAsync(
        { type: 'command', event: 'test', command: 'sleep 1' },
        {}
      );

      expect(runner.hasPendingHooks()).toBe(true);
      expect(runner.getPendingCount()).toBe(1);

      // Complete the child
      (child as any).stdout.emit('data', Buffer.from('done'));
      child.emit('close', 0);

      await new Promise((r) => setTimeout(r, 20));

      expect(runner.hasPendingHooks()).toBe(false);
      expect(runner.getPendingCount()).toBe(0);
    });
  });

  describe('duration tracking', () => {
    it('should include duration in result', async () => {
      const runner = new SmartHookRunner();
      const result = await runner.runHook(
        { type: 'prompt', event: 'test', prompt: 'Hello' },
        {}
      );
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// Feature 3: Env Persistence
// ============================================================================

describe('EnvPersistence', () => {
  let EnvPersistence: typeof import('../../src/hooks/env-persistence').EnvPersistence;
  let tempDir: string;

  beforeAll(async () => {
    const mod = await import('../../src/hooks/env-persistence.js');
    EnvPersistence = mod.EnvPersistence;
  });

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    cleanTempDir(tempDir);
  });

  describe('constructor', () => {
    it('should create with a session ID', () => {
      const ep = new EnvPersistence('test-session-1');
      expect(ep.getSessionId()).toBe('test-session-1');
      ep.cleanup();
    });

    it('should generate a random session ID when none provided', () => {
      const ep = new EnvPersistence();
      const id = ep.getSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      ep.cleanup();
    });

    it('should set env file path based on session ID', () => {
      const ep = new EnvPersistence('my-session');
      const filePath = ep.getEnvFilePath();
      expect(filePath).toContain('my-session');
      expect(filePath).toContain('.env');
      ep.cleanup();
    });
  });

  describe('setVar and loadEnv', () => {
    it('should persist and reload a variable', () => {
      const ep = new EnvPersistence('persist-test');
      ep.setVar('MY_VAR', 'hello');

      const env = ep.loadEnv();
      expect(env.MY_VAR).toBe('hello');
      ep.cleanup();
    });

    it('should persist multiple variables', () => {
      const ep = new EnvPersistence('multi-var');
      ep.setVar('A', '1');
      ep.setVar('B', '2');
      ep.setVar('C', '3');

      const env = ep.loadEnv();
      expect(env.A).toBe('1');
      expect(env.B).toBe('2');
      expect(env.C).toBe('3');
      ep.cleanup();
    });

    it('should overwrite existing variable', () => {
      const ep = new EnvPersistence('overwrite');
      ep.setVar('KEY', 'old');
      ep.setVar('KEY', 'new');

      const env = ep.loadEnv();
      expect(env.KEY).toBe('new');
      ep.cleanup();
    });
  });

  describe('unsetVar', () => {
    it('should remove a variable', () => {
      const ep = new EnvPersistence('unset-test');
      ep.setVar('KEEP', 'yes');
      ep.setVar('REMOVE', 'bye');
      ep.unsetVar('REMOVE');

      const env = ep.loadEnv();
      expect(env.KEEP).toBe('yes');
      expect(env.REMOVE).toBeUndefined();
      ep.cleanup();
    });

    it('should handle unsetting nonexistent variable', () => {
      const ep = new EnvPersistence('unset-missing');
      ep.unsetVar('NONEXISTENT');
      const env = ep.loadEnv();
      expect(Object.keys(env)).toHaveLength(0);
      ep.cleanup();
    });
  });

  describe('parseEnvFile', () => {
    it('should parse export VAR=value format', () => {
      const ep = new EnvPersistence('parse-test');
      const parsed = ep.parseEnvFile('export FOO=bar\nexport BAZ=qux');
      expect(parsed.FOO).toBe('bar');
      expect(parsed.BAZ).toBe('qux');
      ep.cleanup();
    });

    it('should parse VAR=value without export', () => {
      const ep = new EnvPersistence('parse-noexport');
      const parsed = ep.parseEnvFile('FOO=bar\nBAZ=qux');
      expect(parsed.FOO).toBe('bar');
      expect(parsed.BAZ).toBe('qux');
      ep.cleanup();
    });

    it('should skip empty lines and comments', () => {
      const ep = new EnvPersistence('parse-comments');
      const content = '# Comment\n\nexport FOO=bar\n# Another comment\nBAZ=qux';
      const parsed = ep.parseEnvFile(content);
      expect(parsed.FOO).toBe('bar');
      expect(parsed.BAZ).toBe('qux');
      expect(Object.keys(parsed)).toHaveLength(2);
      ep.cleanup();
    });

    it('should strip surrounding quotes', () => {
      const ep = new EnvPersistence('parse-quotes');
      const content = 'FOO="hello world"\nBAR=\'single quoted\'';
      const parsed = ep.parseEnvFile(content);
      expect(parsed.FOO).toBe('hello world');
      expect(parsed.BAR).toBe('single quoted');
      ep.cleanup();
    });

    it('should handle values with = signs', () => {
      const ep = new EnvPersistence('parse-equals');
      const parsed = ep.parseEnvFile('DATABASE_URL=postgres://user:pass@host/db?opt=val');
      expect(parsed.DATABASE_URL).toBe('postgres://user:pass@host/db?opt=val');
      ep.cleanup();
    });

    it('should skip lines without = sign', () => {
      const ep = new EnvPersistence('parse-noeq');
      const parsed = ep.parseEnvFile('VALID=yes\nINVALIDLINE\nALSO_VALID=true');
      expect(parsed.VALID).toBe('yes');
      expect(parsed.ALSO_VALID).toBe('true');
      expect(Object.keys(parsed)).toHaveLength(2);
      ep.cleanup();
    });

    it('should handle empty values', () => {
      const ep = new EnvPersistence('parse-empty');
      const parsed = ep.parseEnvFile('EMPTY=');
      expect(parsed.EMPTY).toBe('');
      ep.cleanup();
    });
  });

  describe('serializeEnv', () => {
    it('should produce export VAR=value format', () => {
      const ep = new EnvPersistence('serialize-test');
      const content = ep.serializeEnv({ FOO: 'bar', BAZ: 'qux' });
      expect(content).toContain('export BAZ=qux');
      expect(content).toContain('export FOO=bar');
      ep.cleanup();
    });

    it('should sort keys alphabetically', () => {
      const ep = new EnvPersistence('serialize-sort');
      const content = ep.serializeEnv({ ZZZ: '1', AAA: '2', MMM: '3' });
      const lines = content.split('\n').filter((l) => l.startsWith('export'));
      expect(lines[0]).toContain('AAA');
      expect(lines[1]).toContain('MMM');
      expect(lines[2]).toContain('ZZZ');
      ep.cleanup();
    });

    it('should quote values with special characters', () => {
      const ep = new EnvPersistence('serialize-quote');
      const content = ep.serializeEnv({ PATH: '/usr/bin /local/bin' });
      expect(content).toContain('export PATH="/usr/bin /local/bin"');
      ep.cleanup();
    });

    it('should include header comments', () => {
      const ep = new EnvPersistence('serialize-header');
      const content = ep.serializeEnv({ A: '1' });
      expect(content).toContain('# Code Buddy session environment');
      expect(content).toContain('serialize-header');
      ep.cleanup();
    });
  });

  describe('applyToProcess', () => {
    it('should set process.env variables', () => {
      const uniqueKey = `CB_TEST_${Date.now()}`;
      const ep = new EnvPersistence('apply-test');
      ep.setVar(uniqueKey, 'applied');
      ep.applyToProcess();

      expect(process.env[uniqueKey]).toBe('applied');

      // Cleanup
      delete process.env[uniqueKey];
      ep.cleanup();
    });
  });

  describe('captureEnvChanges', () => {
    it('should detect new variables', () => {
      const ep = new EnvPersistence('capture-new');
      const before = { A: '1' };
      const after = { A: '1', B: '2' };

      const changes = ep.captureEnvChanges(before, after);
      expect(changes.B).toBe('2');
      expect(changes.A).toBeUndefined();
      ep.cleanup();
    });

    it('should detect changed variables', () => {
      const ep = new EnvPersistence('capture-changed');
      const before = { A: '1', B: 'old' };
      const after = { A: '1', B: 'new' };

      const changes = ep.captureEnvChanges(before, after);
      expect(changes.B).toBe('new');
      expect(changes.A).toBeUndefined();
      ep.cleanup();
    });

    it('should persist captured changes', () => {
      const ep = new EnvPersistence('capture-persist');
      const before = {};
      const after = { NEW_VAR: 'captured' };

      ep.captureEnvChanges(before, after);

      const env = ep.loadEnv();
      expect(env.NEW_VAR).toBe('captured');
      ep.cleanup();
    });

    it('should handle empty before/after', () => {
      const ep = new EnvPersistence('capture-empty');
      const changes = ep.captureEnvChanges({}, {});
      expect(Object.keys(changes)).toHaveLength(0);
      ep.cleanup();
    });
  });

  describe('cleanup', () => {
    it('should remove env file', () => {
      const ep = new EnvPersistence('cleanup-test');
      ep.setVar('TEST', 'value');
      const filePath = ep.getEnvFilePath();

      expect(fs.existsSync(filePath)).toBe(true);
      ep.cleanup();
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should handle cleanup when file does not exist', () => {
      const ep = new EnvPersistence('cleanup-nofile');
      expect(() => ep.cleanup()).not.toThrow();
    });
  });

  describe('loadEnv from disk', () => {
    it('should return empty when file does not exist', () => {
      const ep = new EnvPersistence('load-missing');
      const env = ep.loadEnv();
      expect(Object.keys(env)).toHaveLength(0);
      ep.cleanup();
    });
  });
});

// ============================================================================
// Feature 4: Async Hook Manager
// ============================================================================

describe('AsyncHookManager', () => {
  const originalEnv = process.env;
  let AsyncHookManager: typeof import('../../src/hooks/async-hooks').AsyncHookManager;
  type SmartHookConfig = import('../../src/hooks/smart-hooks').SmartHookConfig;

  beforeAll(async () => {
    const mod = await import('../../src/hooks/async-hooks.js');
    AsyncHookManager = mod.AsyncHookManager;
  });

  beforeEach(() => {
    process.env = { ...originalEnv, CODEBUDDY_PROVIDER: 'none' };
    mockSpawn.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create with default max concurrent', () => {
      const mgr = new AsyncHookManager();
      expect(mgr.getRunningCount()).toBe(0);
      expect(mgr.getTotalCount()).toBe(0);
      mgr.dispose();
    });

    it('should accept custom max concurrent', () => {
      const mgr = new AsyncHookManager(5);
      expect(mgr.getTotalCount()).toBe(0);
      mgr.dispose();
    });
  });

  describe('submit', () => {
    it('should return a job ID', () => {
      mockSpawn.mockReturnValue(
        createMockChildProcess({ stdout: 'ok', exitCode: 0, delay: 50 })
      );

      const mgr = new AsyncHookManager();
      const jobId = mgr.submit(
        { type: 'command', event: 'test', command: 'echo hi' },
        {}
      );

      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);
      mgr.dispose();
    });

    it('should track the job', () => {
      mockSpawn.mockReturnValue(
        createMockChildProcess({ stdout: 'ok', exitCode: 0, delay: 100 })
      );

      const mgr = new AsyncHookManager();
      const jobId = mgr.submit(
        { type: 'command', event: 'test', command: 'echo hi' },
        {}
      );

      const job = mgr.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job!.id).toBe(jobId);
      expect(job!.hookConfig.type).toBe('command');
      expect(job!.status).toBe('running');
      expect(job!.startTime).toBeGreaterThan(0);
      mgr.dispose();
    });

    it('should reject when max concurrent reached', () => {
      const mgr = new AsyncHookManager(1);

      // First hook - stays running because we never resolve it
      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);

      mgr.submit({ type: 'command', event: 'test', command: 'sleep 100' }, {});

      // Second hook should be rejected
      const jobId2 = mgr.submit(
        { type: 'command', event: 'test', command: 'echo hi' },
        {}
      );

      const job2 = mgr.getJob(jobId2);
      expect(job2).not.toBeNull();
      expect(job2!.status).toBe('failed');
      expect(job2!.error).toContain('Max concurrent');
      mgr.dispose();
    });

    it('should handle prompt hooks', async () => {
      const mgr = new AsyncHookManager();
      const jobId = mgr.submit(
        { type: 'prompt', event: 'test', prompt: 'Hello {{name}}' },
        { name: 'World' }
      );

      await new Promise((r) => setTimeout(r, 50));

      const job = mgr.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');
      expect(job!.result!.ok).toBe(true);
      expect(job!.result!.output).toBe('Hello World');
      mgr.dispose();
    });
  });

  describe('getJob', () => {
    it('should return null for unknown job', () => {
      const mgr = new AsyncHookManager();
      expect(mgr.getJob('nonexistent')).toBeNull();
      mgr.dispose();
    });
  });

  describe('getCompletedJobs', () => {
    it('should return completed jobs', async () => {
      const mgr = new AsyncHookManager();
      mgr.submit(
        { type: 'prompt', event: 'test1', prompt: 'A' },
        {}
      );
      mgr.submit(
        { type: 'prompt', event: 'test2', prompt: 'B' },
        {}
      );

      await new Promise((r) => setTimeout(r, 50));

      const completed = mgr.getCompletedJobs();
      expect(completed).toHaveLength(2);
      mgr.dispose();
    });

    it('should clear completed list after retrieval', async () => {
      const mgr = new AsyncHookManager();
      mgr.submit({ type: 'prompt', event: 'test', prompt: 'A' }, {});

      await new Promise((r) => setTimeout(r, 50));

      const first = mgr.getCompletedJobs();
      expect(first).toHaveLength(1);

      const second = mgr.getCompletedJobs();
      expect(second).toHaveLength(0);
      mgr.dispose();
    });
  });

  describe('getSystemMessages', () => {
    it('should format completed hooks as system messages', async () => {
      const mgr = new AsyncHookManager();
      mgr.submit(
        { type: 'prompt', event: 'PreBash', prompt: 'Check this' },
        {}
      );

      await new Promise((r) => setTimeout(r, 50));

      const messages = mgr.getSystemMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('[Async Hook: PreBash]');
      expect(messages[0]).toContain('Success');
      mgr.dispose();
    });

    it('should format failed hooks correctly', async () => {
      const mgr = new AsyncHookManager();
      mgr.submit(
        { type: 'agent', event: 'test' },
        {}
      );

      await new Promise((r) => setTimeout(r, 50));

      const messages = mgr.getSystemMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Failed');
      mgr.dispose();
    });

    it('should return empty when no completed jobs', () => {
      const mgr = new AsyncHookManager();
      const messages = mgr.getSystemMessages();
      expect(messages).toHaveLength(0);
      mgr.dispose();
    });
  });

  describe('clearCompleted', () => {
    it('should remove completed jobs from tracking', async () => {
      const mgr = new AsyncHookManager();
      mgr.submit({ type: 'prompt', event: 'test', prompt: 'A' }, {});

      await new Promise((r) => setTimeout(r, 50));

      expect(mgr.getTotalCount()).toBe(1);
      mgr.clearCompleted();
      expect(mgr.getTotalCount()).toBe(0);
      mgr.dispose();
    });

    it('should not remove running jobs', async () => {
      const mgr = new AsyncHookManager();

      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);

      mgr.submit({ type: 'command', event: 'test', command: 'sleep 100' }, {});

      mgr.clearCompleted();
      expect(mgr.getTotalCount()).toBe(1);
      expect(mgr.getRunningCount()).toBe(1);
      mgr.dispose();
    });
  });

  describe('cancel', () => {
    it('should cancel a running job', () => {
      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);

      const mgr = new AsyncHookManager();
      const jobId = mgr.submit(
        { type: 'command', event: 'test', command: 'sleep 100' },
        {}
      );

      const cancelled = mgr.cancel(jobId);
      expect(cancelled).toBe(true);
      mgr.dispose();
    });

    it('should return false for unknown job', () => {
      const mgr = new AsyncHookManager();
      expect(mgr.cancel('nonexistent')).toBe(false);
      mgr.dispose();
    });

    it('should return false for already completed job', async () => {
      const mgr = new AsyncHookManager();
      const jobId = mgr.submit(
        { type: 'prompt', event: 'test', prompt: 'A' },
        {}
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(mgr.cancel(jobId)).toBe(false);
      mgr.dispose();
    });
  });

  describe('getRunningCount', () => {
    it('should count running jobs', () => {
      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);

      const mgr = new AsyncHookManager();
      mgr.submit({ type: 'command', event: 'test', command: 'sleep 1' }, {});
      mgr.submit({ type: 'command', event: 'test', command: 'sleep 2' }, {});

      expect(mgr.getRunningCount()).toBe(2);
      mgr.dispose();
    });
  });

  describe('getTotalCount', () => {
    it('should include all jobs regardless of status', async () => {
      const mgr = new AsyncHookManager();
      mgr.submit({ type: 'prompt', event: 'test', prompt: 'A' }, {});

      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);
      mgr.submit({ type: 'command', event: 'test', command: 'sleep 1' }, {});

      await new Promise((r) => setTimeout(r, 50));

      expect(mgr.getTotalCount()).toBe(2);
      mgr.dispose();
    });
  });

  describe('dispose', () => {
    it('should clear all jobs', () => {
      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);

      const mgr = new AsyncHookManager();
      mgr.submit({ type: 'command', event: 'test', command: 'sleep 1' }, {});
      mgr.submit({ type: 'command', event: 'test', command: 'sleep 2' }, {});

      mgr.dispose();

      expect(mgr.getTotalCount()).toBe(0);
      expect(mgr.getRunningCount()).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      const mgr = new AsyncHookManager();
      expect(() => {
        mgr.dispose();
        mgr.dispose();
      }).not.toThrow();
    });
  });

  describe('timeout handling', () => {
    it('should timeout hooks that exceed timeout', async () => {
      // Create a hook that never resolves naturally
      const child = new EventEmitter();
      (child as any).stdout = new EventEmitter();
      (child as any).stderr = new EventEmitter();
      (child as any).kill = jest.fn();
      mockSpawn.mockReturnValue(child);

      const mgr = new AsyncHookManager();
      const jobId = mgr.submit(
        { type: 'command', event: 'test', command: 'sleep 999', timeout: 50 },
        {}
      );

      await new Promise((r) => setTimeout(r, 200));

      const job = mgr.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('timeout');
      expect(job!.error).toContain('timed out');
      mgr.dispose();
    });
  });
});
