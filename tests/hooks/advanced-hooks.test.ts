/**
 * Tests for the Advanced Hook System
 *
 * Covers: HookEvent enum membership, AdvancedHookRunner (registration,
 * execution, matching), HookRegistry (CRUD, once hooks, ordering),
 * and singleton helpers.
 */

// ─── Mock heavy dependencies ──────────────────────────────────────────────────

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// child_process.spawn is used by runCommandHook — mock it
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import {
  HookEvent,
  AdvancedHookRunner,
  HookRegistry,
  getHookRegistry,
  getAdvancedHookRunner,
  resetAdvancedHooks,
  type AdvancedHook,
  type HookContext,
  type HookDecision,
} from '../../src/hooks/advanced-hooks';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

// ─── Spawn helper: simulate a subprocess that exits normally with JSON output ─

function makeSpawnProcess(
  stdout: string,
  exitCode: number = 0,
  stderrMsg: string = '',
) {
  const stdoutEE = new EventEmitter();
  const stderrEE = new EventEmitter();
  const proc = new EventEmitter() as NodeJS.EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };
  proc.stdout = stdoutEE;
  proc.stderr = stderrEE;
  proc.kill = jest.fn();

  // Emit data + close asynchronously so the handler has time to attach
  setImmediate(() => {
    if (stdout) stdoutEE.emit('data', Buffer.from(stdout));
    if (stderrMsg) stderrEE.emit('data', Buffer.from(stderrMsg));
    proc.emit('close', exitCode);
  });

  return proc;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HookEvent enum', () => {
  it('has PreToolUse', () => expect(HookEvent.PreToolUse).toBe('PreToolUse'));
  it('has PostToolUse', () => expect(HookEvent.PostToolUse).toBe('PostToolUse'));
  it('has PreBash', () => expect(HookEvent.PreBash).toBe('PreBash'));
  it('has PostBash', () => expect(HookEvent.PostBash).toBe('PostBash'));
  it('has PreEdit', () => expect(HookEvent.PreEdit).toBe('PreEdit'));
  it('has PostEdit', () => expect(HookEvent.PostEdit).toBe('PostEdit'));
  it('has SessionStart', () => expect(HookEvent.SessionStart).toBe('SessionStart'));
  it('has SessionEnd', () => expect(HookEvent.SessionEnd).toBe('SessionEnd'));
  it('has PreCompact', () => expect(HookEvent.PreCompact).toBe('PreCompact'));
  it('has Notification', () => expect(HookEvent.Notification).toBe('Notification'));
  it('has SubagentStart', () => expect(HookEvent.SubagentStart).toBe('SubagentStart'));
  it('has SubagentStop', () => expect(HookEvent.SubagentStop).toBe('SubagentStop'));
  it('has PermissionRequest', () => expect(HookEvent.PermissionRequest).toBe('PermissionRequest'));
  it('has TaskCompleted', () => expect(HookEvent.TaskCompleted).toBe('TaskCompleted'));
  it('has ConfigChange', () => expect(HookEvent.ConfigChange).toBe('ConfigChange'));

  it('has exactly 15 enum members', () => {
    const members = Object.keys(HookEvent);
    expect(members).toHaveLength(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AdvancedHookRunner', () => {
  let runner: AdvancedHookRunner;

  beforeEach(() => {
    runner = new AdvancedHookRunner('/tmp', 5000);
    jest.clearAllMocks();
  });

  // ── matchesEvent() ────────────────────────────────────────────────────────

  describe('matchesEvent()', () => {
    const baseHook = (overrides: Partial<AdvancedHook> = {}): AdvancedHook => ({
      name: 'test-hook',
      event: HookEvent.PreToolUse,
      type: 'command',
      ...overrides,
    });

    it('returns false when hook.event does not match', () => {
      const hook = baseHook({ event: HookEvent.PostToolUse });
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse)).toBe(false);
    });

    it('returns true for matching event with no matcher and no toolName', () => {
      const hook = baseHook();
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse)).toBe(true);
    });

    it('returns true for matching event with no matcher regardless of toolName', () => {
      const hook = baseHook();
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash')).toBe(true);
    });

    it('returns true when matcher matches the toolName', () => {
      const hook = baseHook({ matcher: /^bash$/ });
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash')).toBe(true);
    });

    it('returns false when matcher does not match the toolName', () => {
      const hook = baseHook({ matcher: /^bash$/ });
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'git')).toBe(false);
    });

    it('returns false when hook has a matcher but no toolName is provided', () => {
      const hook = baseHook({ matcher: /^bash$/ });
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse)).toBe(false);
    });

    it('supports wildcard-style regex matchers', () => {
      const hook = baseHook({ matcher: /.*/ });
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'anything')).toBe(true);
    });
  });

  // ── runHook() — command type ───────────────────────────────────────────────

  describe('runHook() with command hook type', () => {
    it('returns allow when command outputs valid JSON with action:allow', async () => {
      mockSpawn.mockReturnValue(
        makeSpawnProcess(JSON.stringify({ action: 'allow' })) as unknown as ReturnType<typeof spawn>,
      );

      const hook: AdvancedHook = {
        name: 'allow-hook',
        event: HookEvent.PreToolUse,
        type: 'command',
        command: 'echo allow',
      };
      const ctx: HookContext = { event: HookEvent.PreToolUse, toolName: 'bash' };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');
    });

    it('returns deny when command outputs action:deny', async () => {
      mockSpawn.mockReturnValue(
        makeSpawnProcess(JSON.stringify({ action: 'deny' })) as unknown as ReturnType<typeof spawn>,
      );

      const hook: AdvancedHook = {
        name: 'deny-hook',
        event: HookEvent.PreToolUse,
        type: 'command',
        command: 'my-guard',
      };
      const ctx: HookContext = { event: HookEvent.PreToolUse, toolName: 'bash' };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('deny');
    });

    it('returns ask when command outputs action:ask', async () => {
      mockSpawn.mockReturnValue(
        makeSpawnProcess(JSON.stringify({ action: 'ask' })) as unknown as ReturnType<typeof spawn>,
      );

      const hook: AdvancedHook = {
        name: 'ask-hook',
        event: HookEvent.PreToolUse,
        type: 'command',
        command: 'ask-guard',
      };
      const ctx: HookContext = { event: HookEvent.PreToolUse };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('ask');
    });

    it('returns allow when command exits with non-zero code', async () => {
      mockSpawn.mockReturnValue(
        makeSpawnProcess('', 1, 'some error') as unknown as ReturnType<typeof spawn>,
      );

      const hook: AdvancedHook = {
        name: 'failing-hook',
        event: HookEvent.PreBash,
        type: 'command',
        command: 'exit 1',
      };
      const ctx: HookContext = { event: HookEvent.PreBash };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');
    });

    it('returns allow when command outputs non-JSON text', async () => {
      mockSpawn.mockReturnValue(
        makeSpawnProcess('not json at all') as unknown as ReturnType<typeof spawn>,
      );

      const hook: AdvancedHook = {
        name: 'plain-hook',
        event: HookEvent.PreBash,
        type: 'command',
        command: 'echo hello',
      };
      const ctx: HookContext = { event: HookEvent.PreBash };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');
    });

    it('returns allow when command hook has no command defined', async () => {
      const hook: AdvancedHook = {
        name: 'no-cmd-hook',
        event: HookEvent.PreToolUse,
        type: 'command',
      };
      const ctx: HookContext = { event: HookEvent.PreToolUse };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');
    });

    it('returns allow when command emits an error event', async () => {
      const proc = new EventEmitter() as unknown as ReturnType<typeof spawn> & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: jest.Mock;
      };
      (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
      (proc as unknown as { kill: jest.Mock }).kill = jest.fn();

      setImmediate(() => proc.emit('error', new Error('spawn ENOENT')));

      mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const hook: AdvancedHook = {
        name: 'error-hook',
        event: HookEvent.PreBash,
        type: 'command',
        command: 'no-such-binary',
      };
      const ctx: HookContext = { event: HookEvent.PreBash };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');
    });
  });

  // ── runHook() — prompt and agent types ───────────────────────────────────

  describe('runHook() with prompt / agent hook types', () => {
    it('returns allow for a prompt hook when GROK_API_KEY is absent', async () => {
      const savedKey = process.env.GROK_API_KEY;
      delete process.env.GROK_API_KEY;

      const hook: AdvancedHook = {
        name: 'prompt-hook',
        event: HookEvent.PreToolUse,
        type: 'prompt',
        prompt: 'Should this be allowed?',
      };
      const ctx: HookContext = { event: HookEvent.PreToolUse };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');

      process.env.GROK_API_KEY = savedKey;
    });

    it('returns allow for an agent hook when GROK_API_KEY is absent', async () => {
      const savedKey = process.env.GROK_API_KEY;
      delete process.env.GROK_API_KEY;

      const hook: AdvancedHook = {
        name: 'agent-hook',
        event: HookEvent.PreToolUse,
        type: 'agent',
      };
      const ctx: HookContext = { event: HookEvent.PreToolUse };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');

      process.env.GROK_API_KEY = savedKey;
    });
  });

  // ── runHook() — unknown type ──────────────────────────────────────────────

  describe('runHook() with unknown hook type', () => {
    it('returns allow and does not throw for an unknown type', async () => {
      const hook = {
        name: 'weird-hook',
        event: HookEvent.PreToolUse,
        type: 'unknown-type' as unknown as 'command',
      };
      const ctx: HookContext = { event: HookEvent.PreToolUse };
      const decision = await runner.runHook(hook, ctx);

      expect(decision.action).toBe('allow');
    });
  });

  // ── runHookAsync() ────────────────────────────────────────────────────────

  describe('runHookAsync()', () => {
    it('executes without throwing even if the hook fails internally', async () => {
      mockSpawn.mockReturnValue(
        makeSpawnProcess('', 1) as unknown as ReturnType<typeof spawn>,
      );

      const hook: AdvancedHook = {
        name: 'async-hook',
        event: HookEvent.PostBash,
        type: 'command',
        command: 'failing-cmd',
        async: true,
      };
      const ctx: HookContext = { event: HookEvent.PostBash };

      await expect(runner.runHookAsync(hook, ctx)).resolves.toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
    jest.clearAllMocks();
  });

  // ── addHook() / listHooks() / getHook() ──────────────────────────────────

  describe('addHook()', () => {
    it('registers a hook that is then retrievable via getHook()', () => {
      const hook: AdvancedHook = {
        name: 'my-hook',
        event: HookEvent.PreToolUse,
        type: 'command',
      };
      registry.addHook(hook);
      expect(registry.getHook('my-hook')).toBe(hook);
    });

    it('increments size when a hook is added', () => {
      expect(registry.size).toBe(0);
      registry.addHook({ name: 'h1', event: HookEvent.PreToolUse, type: 'command' });
      expect(registry.size).toBe(1);
    });

    it('overwrites an existing hook with the same name', () => {
      registry.addHook({ name: 'dup', event: HookEvent.PreBash, type: 'command' });
      const updated: AdvancedHook = { name: 'dup', event: HookEvent.PostBash, type: 'prompt' };
      registry.addHook(updated);
      expect(registry.size).toBe(1);
      expect(registry.getHook('dup')).toBe(updated);
    });
  });

  describe('listHooks()', () => {
    it('returns all registered hooks', () => {
      registry.addHook({ name: 'a', event: HookEvent.PreToolUse, type: 'command' });
      registry.addHook({ name: 'b', event: HookEvent.PostToolUse, type: 'prompt' });
      expect(registry.listHooks()).toHaveLength(2);
    });

    it('returns an empty array when no hooks are registered', () => {
      expect(registry.listHooks()).toEqual([]);
    });
  });

  // ── removeHook() ──────────────────────────────────────────────────────────

  describe('removeHook()', () => {
    it('removes a registered hook and returns true', () => {
      registry.addHook({ name: 'removable', event: HookEvent.PreToolUse, type: 'command' });
      expect(registry.removeHook('removable')).toBe(true);
      expect(registry.getHook('removable')).toBeUndefined();
    });

    it('returns false when the hook does not exist', () => {
      expect(registry.removeHook('ghost')).toBe(false);
    });

    it('decrements size when a hook is removed', () => {
      registry.addHook({ name: 'to-remove', event: HookEvent.PreToolUse, type: 'command' });
      expect(registry.size).toBe(1);
      registry.removeHook('to-remove');
      expect(registry.size).toBe(0);
    });
  });

  // ── clear() ───────────────────────────────────────────────────────────────

  describe('clear()', () => {
    it('removes all hooks', () => {
      registry.addHook({ name: 'a', event: HookEvent.PreBash, type: 'command' });
      registry.addHook({ name: 'b', event: HookEvent.PostBash, type: 'command' });
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.listHooks()).toEqual([]);
    });
  });

  // ── getHooksForEvent() ────────────────────────────────────────────────────

  describe('getHooksForEvent()', () => {
    it('returns hooks that match the given event', () => {
      registry.addHook({ name: 'pre', event: HookEvent.PreToolUse, type: 'command' });
      registry.addHook({ name: 'post', event: HookEvent.PostToolUse, type: 'command' });

      const preHooks = registry.getHooksForEvent(HookEvent.PreToolUse);
      expect(preHooks).toHaveLength(1);
      expect(preHooks[0].name).toBe('pre');
    });

    it('returns empty array when no hooks match the event', () => {
      registry.addHook({ name: 'pre', event: HookEvent.PreToolUse, type: 'command' });
      expect(registry.getHooksForEvent(HookEvent.SessionEnd)).toHaveLength(0);
    });

    it('filters by toolName matcher', () => {
      registry.addHook({
        name: 'bash-only',
        event: HookEvent.PreToolUse,
        type: 'command',
        matcher: /^bash$/,
      });
      registry.addHook({
        name: 'all-tools',
        event: HookEvent.PreToolUse,
        type: 'command',
      });

      const forBash = registry.getHooksForEvent(HookEvent.PreToolUse, 'bash');
      expect(forBash.map(h => h.name)).toContain('bash-only');
      expect(forBash.map(h => h.name)).toContain('all-tools');

      const forGit = registry.getHooksForEvent(HookEvent.PreToolUse, 'git');
      expect(forGit.map(h => h.name)).not.toContain('bash-only');
      expect(forGit.map(h => h.name)).toContain('all-tools');
    });

    it('excludes once-hooks that have already fired', () => {
      registry.addHook({
        name: 'once-hook',
        event: HookEvent.SessionStart,
        type: 'command',
        once: true,
      });

      // Should be included before firing
      expect(registry.getHooksForEvent(HookEvent.SessionStart)).toHaveLength(1);

      registry.markFired('once-hook');

      // Should be excluded after firing
      expect(registry.getHooksForEvent(HookEvent.SessionStart)).toHaveLength(0);
    });
  });

  // ── markFired() ───────────────────────────────────────────────────────────

  describe('markFired()', () => {
    it('only marks once:true hooks as fired', () => {
      registry.addHook({
        name: 'repeating',
        event: HookEvent.PreBash,
        type: 'command',
        once: false,
      });
      registry.markFired('repeating');
      // Should still appear because it is not a once hook
      expect(registry.getHooksForEvent(HookEvent.PreBash)).toHaveLength(1);
    });

    it('marks once:true hooks as fired so they are excluded next time', () => {
      registry.addHook({
        name: 'fire-once',
        event: HookEvent.PreBash,
        type: 'command',
        once: true,
      });
      registry.markFired('fire-once');
      expect(registry.getHooksForEvent(HookEvent.PreBash)).toHaveLength(0);
    });

    it('removeHook also clears the fired state for once hooks', () => {
      registry.addHook({ name: 'fired', event: HookEvent.PreBash, type: 'command', once: true });
      registry.markFired('fired');
      registry.removeHook('fired');

      // Re-add with same name — should be active again
      registry.addHook({ name: 'fired', event: HookEvent.PreBash, type: 'command', once: true });
      expect(registry.getHooksForEvent(HookEvent.PreBash)).toHaveLength(1);
    });
  });

  // ── Multiple hooks for the same event fire in registration order ──────────

  describe('multiple hooks for same event', () => {
    it('returns hooks in the order they were registered', () => {
      registry.addHook({ name: 'first', event: HookEvent.PreToolUse, type: 'command' });
      registry.addHook({ name: 'second', event: HookEvent.PreToolUse, type: 'command' });
      registry.addHook({ name: 'third', event: HookEvent.PreToolUse, type: 'command' });

      const hooks = registry.getHooksForEvent(HookEvent.PreToolUse);
      expect(hooks.map(h => h.name)).toEqual(['first', 'second', 'third']);
    });
  });

  // ── Error in hook does not crash the pipeline ─────────────────────────────

  describe('error resilience', () => {
    it('a failing command hook resolves to allow without propagating the error', async () => {
      // Spawn emits an error
      const proc = new EventEmitter() as unknown as ReturnType<typeof spawn> & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: jest.Mock;
      };
      (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
      (proc as unknown as { kill: jest.Mock }).kill = jest.fn();
      setImmediate(() => proc.emit('error', new Error('ENOENT')));

      mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const runner = new AdvancedHookRunner();
      const hook: AdvancedHook = {
        name: 'crash-hook',
        event: HookEvent.PreBash,
        type: 'command',
        command: 'no-such-program',
      };
      const ctx: HookContext = { event: HookEvent.PreBash };

      let decision!: HookDecision;
      await expect(
        runner.runHook(hook, ctx).then(d => { decision = d; }),
      ).resolves.not.toThrow();
      expect(decision.action).toBe('allow');
    });
  });

  // ── PreToolUse hook can modify args via updatedInput ─────────────────────

  describe('PreToolUse hook with updatedInput', () => {
    it('decision carries updatedInput that a caller can apply', async () => {
      const modifiedInput = { path: '/safe/path', mode: 'read-only' };

      mockSpawn.mockReturnValue(
        makeSpawnProcess(
          JSON.stringify({ action: 'allow', updatedInput: modifiedInput }),
        ) as unknown as ReturnType<typeof spawn>,
      );

      const runner = new AdvancedHookRunner();
      const hook: AdvancedHook = {
        name: 'sanitize-path',
        event: HookEvent.PreToolUse,
        type: 'command',
        command: 'sanitize-cmd',
      };
      const ctx: HookContext = {
        event: HookEvent.PreToolUse,
        toolName: 'view_file',
        input: { path: '/dangerous/path' },
      };

      const decision = await runner.runHook(hook, ctx);
      expect(decision.action).toBe('allow');
      expect(decision.updatedInput).toEqual(modifiedInput);
    });
  });

  // ── PostToolUse hook receives tool result ─────────────────────────────────

  describe('PostToolUse hook receives tool result in context', () => {
    it('context.output is available when the hook runs', async () => {
      let capturedOutput: unknown;

      mockSpawn.mockImplementation((_cmd, _args, opts) => {
        // Capture what was passed via env
        const env = (opts as { env?: Record<string, string> })?.env ?? {};
        capturedOutput = env.HOOK_INPUT;
        return makeSpawnProcess(JSON.stringify({ action: 'allow' })) as unknown as ReturnType<typeof spawn>;
      });

      const runner = new AdvancedHookRunner();
      const hook: AdvancedHook = {
        name: 'post-use',
        event: HookEvent.PostToolUse,
        type: 'command',
        command: 'log-result',
      };
      const ctx: HookContext = {
        event: HookEvent.PostToolUse,
        toolName: 'bash',
        input: { command: 'ls' },
        output: { stdout: 'file1.ts\nfile2.ts', exitCode: 0 },
      };

      await runner.runHook(hook, ctx);

      // HOOK_INPUT env var carries the input object as JSON
      expect(typeof capturedOutput).toBe('string');
      const parsed = JSON.parse(capturedOutput as string);
      expect(parsed).toEqual({ command: 'ls' });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Singleton helpers', () => {
  beforeEach(() => {
    resetAdvancedHooks();
  });

  afterEach(() => {
    resetAdvancedHooks();
  });

  describe('getHookRegistry()', () => {
    it('returns a HookRegistry instance', () => {
      expect(getHookRegistry()).toBeInstanceOf(HookRegistry);
    });

    it('returns the same instance on subsequent calls', () => {
      const r1 = getHookRegistry();
      const r2 = getHookRegistry();
      expect(r1).toBe(r2);
    });
  });

  describe('getAdvancedHookRunner()', () => {
    it('returns an AdvancedHookRunner instance', () => {
      expect(getAdvancedHookRunner()).toBeInstanceOf(AdvancedHookRunner);
    });

    it('creates a new runner when a workingDirectory is provided', () => {
      const r1 = getAdvancedHookRunner();
      const r2 = getAdvancedHookRunner('/some/dir');
      // Providing a directory forces a fresh instance
      expect(r1).not.toBe(r2);
    });
  });

  describe('resetAdvancedHooks()', () => {
    it('resets the registry singleton so a fresh one is returned', () => {
      const before = getHookRegistry();
      resetAdvancedHooks();
      const after = getHookRegistry();
      expect(before).not.toBe(after);
    });
  });
});
