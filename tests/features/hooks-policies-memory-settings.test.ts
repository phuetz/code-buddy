/**
 * Tests for Advanced Hooks, Managed Policies, Auto-Memory, and Settings Hierarchy
 *
 * Covers:
 * - Feature 1: Advanced Hook System (types, events, runner, registry, decisions)
 * - Feature 2: Enterprise Managed Policies (load, tool/command checks, isManaged)
 * - Feature 3: Auto-Memory System (analyze, write, recall, scopes, CRUD)
 * - Feature 4: Settings Hierarchy (levels, get, getWithSource, overrides, merge)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

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

// ============================================================================
// Feature 1: Advanced Hook System
// ============================================================================

describe('AdvancedHookSystem', () => {
  let AdvancedHookRunner: typeof import('../../src/hooks/advanced-hooks').AdvancedHookRunner;
  let HookRegistry: typeof import('../../src/hooks/advanced-hooks').HookRegistry;
  let HookEvent: typeof import('../../src/hooks/advanced-hooks').HookEvent;
  let resetAdvancedHooks: typeof import('../../src/hooks/advanced-hooks').resetAdvancedHooks;
  let getHookRegistry: typeof import('../../src/hooks/advanced-hooks').getHookRegistry;
  let getAdvancedHookRunner: typeof import('../../src/hooks/advanced-hooks').getAdvancedHookRunner;

  beforeAll(async () => {
    const mod = await import('../../src/hooks/advanced-hooks.js');
    AdvancedHookRunner = mod.AdvancedHookRunner;
    HookRegistry = mod.HookRegistry;
    HookEvent = mod.HookEvent;
    resetAdvancedHooks = mod.resetAdvancedHooks;
    getHookRegistry = mod.getHookRegistry;
    getAdvancedHookRunner = mod.getAdvancedHookRunner;
  });

  afterEach(() => {
    resetAdvancedHooks();
  });

  describe('HookEvent enum', () => {
    it('should have all 15 events', () => {
      const events = Object.keys(HookEvent).filter((k) => isNaN(Number(k)));
      expect(events.length).toBe(15);
    });

    it('should include PreToolUse and PostToolUse', () => {
      expect(HookEvent.PreToolUse).toBe('PreToolUse');
      expect(HookEvent.PostToolUse).toBe('PostToolUse');
    });

    it('should include session events', () => {
      expect(HookEvent.SessionStart).toBe('SessionStart');
      expect(HookEvent.SessionEnd).toBe('SessionEnd');
    });

    it('should include subagent events', () => {
      expect(HookEvent.SubagentStart).toBe('SubagentStart');
      expect(HookEvent.SubagentStop).toBe('SubagentStop');
    });
  });

  describe('AdvancedHookRunner', () => {
    let runner: InstanceType<typeof AdvancedHookRunner>;

    beforeEach(() => {
      runner = new AdvancedHookRunner(os.tmpdir());
    });

    (process.platform === 'win32' ? it.skip : it)('should run a command hook that returns JSON decision', async () => {
      const hook = {
        name: 'test-cmd',
        event: HookEvent.PreToolUse,
        type: 'command' as const,
        command: 'echo \'{"action":"deny","additionalContext":"blocked"}\'',
      };

      const decision = await runner.runHook(hook, { event: HookEvent.PreToolUse });
      expect(decision.action).toBe('deny');
      expect(decision.additionalContext).toBe('blocked');
    });

    (process.platform === 'win32' ? it.skip : it)('should return allow for command hook with non-JSON output', async () => {
      const hook = {
        name: 'test-nonjson',
        event: HookEvent.PreBash,
        type: 'command' as const,
        command: 'echo "just text"',
      };

      const decision = await runner.runHook(hook, { event: HookEvent.PreBash });
      expect(decision.action).toBe('allow');
    });

    (process.platform === 'win32' ? it.skip : it)('should return allow for command hook with non-zero exit', async () => {
      const hook = {
        name: 'test-fail',
        event: HookEvent.PreBash,
        type: 'command' as const,
        command: 'exit 1',
      };

      const decision = await runner.runHook(hook, { event: HookEvent.PreBash });
      expect(decision.action).toBe('allow');
    });

    it('should return allow for command hook with no command', async () => {
      const hook = {
        name: 'test-nocmd',
        event: HookEvent.PreBash,
        type: 'command' as const,
      };

      const decision = await runner.runHook(hook, { event: HookEvent.PreBash });
      expect(decision.action).toBe('allow');
    });

    it('should run prompt hook and return allow with stored prompt', async () => {
      const hook = {
        name: 'test-prompt',
        event: HookEvent.PreEdit,
        type: 'prompt' as const,
        prompt: 'Should this edit be allowed?',
      };

      const decision = await runner.runHook(hook, { event: HookEvent.PreEdit });
      expect(decision.action).toBe('allow');
      expect(decision.additionalContext).toBe('Should this edit be allowed?');
    });

    it('should run agent hook and return allow (stub)', async () => {
      const hook = {
        name: 'test-agent',
        event: HookEvent.PreToolUse,
        type: 'agent' as const,
      };

      const decision = await runner.runHook(hook, { event: HookEvent.PreToolUse });
      expect(decision.action).toBe('allow');
    });

    it('should handle unknown hook type gracefully', async () => {
      const hook = {
        name: 'test-unknown',
        event: HookEvent.PreToolUse,
        type: 'unknown' as any,
      };

      const decision = await runner.runHook(hook, { event: HookEvent.PreToolUse });
      expect(decision.action).toBe('allow');
    });

    it('should match event without matcher', () => {
      const hook = {
        name: 'test',
        event: HookEvent.PreToolUse,
        type: 'command' as const,
      };

      expect(runner.matchesEvent(hook, HookEvent.PreToolUse)).toBe(true);
      expect(runner.matchesEvent(hook, HookEvent.PostToolUse)).toBe(false);
    });

    it('should match event with regex matcher and tool name', () => {
      const hook = {
        name: 'test',
        event: HookEvent.PreToolUse,
        type: 'command' as const,
        matcher: /^bash$/,
      };

      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash')).toBe(true);
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'read_file')).toBe(false);
    });

    it('should not match when matcher present but no toolName given', () => {
      const hook = {
        name: 'test',
        event: HookEvent.PreToolUse,
        type: 'command' as const,
        matcher: /^bash$/,
      };

      expect(runner.matchesEvent(hook, HookEvent.PreToolUse)).toBe(false);
    });

    it('should fire async hook without blocking', async () => {
      const hook = {
        name: 'test-async',
        event: HookEvent.Notification,
        type: 'prompt' as const,
        async: true,
        prompt: 'async notification',
      };

      // Should not throw and not block
      await runner.runHookAsync(hook, { event: HookEvent.Notification });
    });
  });

  describe('HookRegistry', () => {
    let registry: InstanceType<typeof HookRegistry>;

    beforeEach(() => {
      registry = new HookRegistry();
    });

    it('should add and retrieve hooks', () => {
      registry.addHook({
        name: 'hook1',
        event: HookEvent.PreBash,
        type: 'command',
        command: 'echo test',
      });

      expect(registry.size).toBe(1);
      expect(registry.getHook('hook1')).toBeDefined();
    });

    it('should remove hooks', () => {
      registry.addHook({
        name: 'hook1',
        event: HookEvent.PreBash,
        type: 'command',
      });

      expect(registry.removeHook('hook1')).toBe(true);
      expect(registry.size).toBe(0);
      expect(registry.removeHook('nonexistent')).toBe(false);
    });

    it('should list all hooks', () => {
      registry.addHook({ name: 'h1', event: HookEvent.PreBash, type: 'command' });
      registry.addHook({ name: 'h2', event: HookEvent.PostBash, type: 'prompt' });

      const all = registry.listHooks();
      expect(all).toHaveLength(2);
    });

    it('should get hooks for a specific event', () => {
      registry.addHook({ name: 'h1', event: HookEvent.PreBash, type: 'command' });
      registry.addHook({ name: 'h2', event: HookEvent.PostBash, type: 'command' });
      registry.addHook({ name: 'h3', event: HookEvent.PreBash, type: 'prompt' });

      const preBash = registry.getHooksForEvent(HookEvent.PreBash);
      expect(preBash).toHaveLength(2);
    });

    it('should filter by tool name with matcher', () => {
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

      const bashHooks = registry.getHooksForEvent(HookEvent.PreToolUse, 'bash');
      expect(bashHooks).toHaveLength(2);

      const readHooks = registry.getHooksForEvent(HookEvent.PreToolUse, 'read_file');
      expect(readHooks).toHaveLength(1);
      expect(readHooks[0].name).toBe('all-tools');
    });

    it('should handle once hooks correctly', () => {
      registry.addHook({
        name: 'once-hook',
        event: HookEvent.SessionStart,
        type: 'command',
        once: true,
      });

      // Before firing
      expect(registry.getHooksForEvent(HookEvent.SessionStart)).toHaveLength(1);

      // Mark as fired
      registry.markFired('once-hook');

      // After firing
      expect(registry.getHooksForEvent(HookEvent.SessionStart)).toHaveLength(0);
    });

    it('should not affect non-once hooks when markFired is called', () => {
      registry.addHook({
        name: 'normal-hook',
        event: HookEvent.SessionStart,
        type: 'command',
        once: false,
      });

      registry.markFired('normal-hook');
      expect(registry.getHooksForEvent(HookEvent.SessionStart)).toHaveLength(1);
    });

    it('should clear all hooks', () => {
      registry.addHook({ name: 'h1', event: HookEvent.PreBash, type: 'command' });
      registry.addHook({ name: 'h2', event: HookEvent.PostBash, type: 'command' });

      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.listHooks()).toHaveLength(0);
    });
  });

  describe('Singletons', () => {
    it('should return same registry instance', () => {
      const r1 = getHookRegistry();
      const r2 = getHookRegistry();
      expect(r1).toBe(r2);
    });

    it('should return same runner instance', () => {
      const r1 = getAdvancedHookRunner();
      const r2 = getAdvancedHookRunner();
      expect(r1).toBe(r2);
    });

    it('should create new runner when directory changes', () => {
      const r1 = getAdvancedHookRunner(path.join(os.tmpdir(), 'a'));
      const r2 = getAdvancedHookRunner(path.join(os.tmpdir(), 'b'));
      expect(r1).not.toBe(r2);
    });
  });
});

// ============================================================================
// Feature 2: Enterprise Managed Policies
// ============================================================================

describe('ManagedPoliciesManager', () => {
  let ManagedPoliciesManager: typeof import('../../src/config/managed-policies').ManagedPoliciesManager;
  let resetManagedPolicies: typeof import('../../src/config/managed-policies').resetManagedPolicies;
  let getManagedPoliciesManager: typeof import('../../src/config/managed-policies').getManagedPoliciesManager;

  let tempDir: string;

  beforeAll(async () => {
    const mod = await import('../../src/config/managed-policies.js');
    ManagedPoliciesManager = mod.ManagedPoliciesManager;
    resetManagedPolicies = mod.resetManagedPolicies;
    getManagedPoliciesManager = mod.getManagedPoliciesManager;
  });

  beforeEach(() => {
    tempDir = makeTempDir();
    resetManagedPolicies();
  });

  afterEach(() => {
    cleanTempDir(tempDir);
    resetManagedPolicies();
  });

  it('should load policies from user path', () => {
    const policiesFile = path.join(tempDir, 'managed-settings.json');
    fs.writeFileSync(policiesFile, JSON.stringify({
      allowManagedPermissionRulesOnly: true,
      disallowedTools: ['bash', 'write_file'],
      disallowedCommands: ['rm -rf', 'sudo'],
      maxSessionCost: 5,
      allowedModels: ['gpt-4o', 'claude-sonnet'],
    }));

    const manager = new ManagedPoliciesManager('/nonexistent', policiesFile);
    expect(manager.isManaged()).toBe(true);

    const policies = manager.getPolicies();
    expect(policies.allowManagedPermissionRulesOnly).toBe(true);
    expect(policies.disallowedTools).toEqual(['bash', 'write_file']);
    expect(policies.maxSessionCost).toBe(5);
    expect(policies.allowedModels).toEqual(['gpt-4o', 'claude-sonnet']);
  });

  it('should not be managed when no files exist', () => {
    const manager = new ManagedPoliciesManager('/nonexistent/system', '/nonexistent/user');
    expect(manager.isManaged()).toBe(false);
  });

  it('should return default policies when no files exist', () => {
    const manager = new ManagedPoliciesManager('/nonexistent', '/nonexistent');
    const policies = manager.getPolicies();
    expect(policies.disallowedTools).toEqual([]);
    expect(policies.disallowedCommands).toEqual([]);
    expect(policies.allowManagedPermissionRulesOnly).toBe(false);
    expect(policies.allowManagedHooksOnly).toBe(false);
  });

  it('should check tool allowance', () => {
    const policiesFile = path.join(tempDir, 'managed-settings.json');
    fs.writeFileSync(policiesFile, JSON.stringify({
      disallowedTools: ['bash', 'write_file'],
    }));

    const manager = new ManagedPoliciesManager('/nonexistent', policiesFile);
    expect(manager.isToolAllowed('read_file')).toBe(true);
    expect(manager.isToolAllowed('bash')).toBe(false);
    expect(manager.isToolAllowed('write_file')).toBe(false);
  });

  it('should check command allowance', () => {
    const policiesFile = path.join(tempDir, 'managed-settings.json');
    fs.writeFileSync(policiesFile, JSON.stringify({
      disallowedCommands: ['rm -rf', 'sudo'],
    }));

    const manager = new ManagedPoliciesManager('/nonexistent', policiesFile);
    expect(manager.isCommandAllowed('ls -la')).toBe(true);
    expect(manager.isCommandAllowed('rm -rf /')).toBe(false);
    expect(manager.isCommandAllowed('sudo apt install')).toBe(false);
  });

  it('should handle malformed JSON gracefully', () => {
    const policiesFile = path.join(tempDir, 'managed-settings.json');
    fs.writeFileSync(policiesFile, 'not valid json{{{');

    const manager = new ManagedPoliciesManager('/nonexistent', policiesFile);
    expect(manager.isManaged()).toBe(false);
  });

  it('should prefer system path over user path', () => {
    const systemFile = path.join(tempDir, 'system.json');
    const userFile = path.join(tempDir, 'user.json');

    fs.writeFileSync(systemFile, JSON.stringify({
      disallowedTools: ['system-tool'],
    }));
    fs.writeFileSync(userFile, JSON.stringify({
      disallowedTools: ['user-tool'],
    }));

    const manager = new ManagedPoliciesManager(systemFile, userFile);
    expect(manager.isToolAllowed('system-tool')).toBe(false);
    expect(manager.isToolAllowed('user-tool')).toBe(true);
  });

  it('should support singleton pattern', () => {
    const policiesFile = path.join(tempDir, 'managed-settings.json');
    fs.writeFileSync(policiesFile, JSON.stringify({ disallowedTools: ['test'] }));

    const m1 = getManagedPoliciesManager('/nonexistent', policiesFile);
    const m2 = getManagedPoliciesManager();
    expect(m1).toBe(m2);
  });
});

// ============================================================================
// Feature 3: Auto-Memory System
// ============================================================================

describe('AutoMemoryManager', () => {
  let AutoMemoryManager: typeof import('../../src/memory/auto-memory').AutoMemoryManager;
  let resetAutoMemory: typeof import('../../src/memory/auto-memory').resetAutoMemory;
  let getAutoMemoryManager: typeof import('../../src/memory/auto-memory').getAutoMemoryManager;

  let tempDir: string;

  beforeAll(async () => {
    const mod = await import('../../src/memory/auto-memory.js');
    AutoMemoryManager = mod.AutoMemoryManager;
    resetAutoMemory = mod.resetAutoMemory;
    getAutoMemoryManager = mod.getAutoMemoryManager;
  });

  beforeEach(() => {
    tempDir = makeTempDir();
    resetAutoMemory();
  });

  afterEach(() => {
    cleanTempDir(tempDir);
    resetAutoMemory();
  });

  describe('Memory Paths', () => {
    it('should return correct user memory path', () => {
      const manager = new AutoMemoryManager(tempDir);
      const userPath = manager.getMemoryPath('user');
      expect(userPath).toBe(path.join(os.homedir(), '.codebuddy', 'memory', 'MEMORY.md'));
    });

    it('should return correct project memory path', () => {
      const manager = new AutoMemoryManager(tempDir);
      const projectPath = manager.getMemoryPath('project');
      expect(projectPath).toBe(path.join(tempDir, '.codebuddy', 'memory', 'MEMORY.md'));
    });

    it('should return correct local memory path', () => {
      const manager = new AutoMemoryManager(tempDir);
      const localPath = manager.getMemoryPath('local');
      expect(localPath).toBe(path.join(tempDir, '.codebuddy', 'memory', 'local', 'MEMORY.md'));
    });
  });

  describe('Write and Read', () => {
    it('should write a memory entry and read it back', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('test-key', 'test-value', 'project');

      const memories = manager.listMemories('project');
      expect(memories).toHaveLength(1);
      expect(memories[0].key).toBe('test-key');
      expect(memories[0].value).toBe('test-value');
      expect(memories[0].scope).toBe('project');
    });

    it('should write to local scope', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('local-key', 'local-value', 'local');

      const memories = manager.listMemories('local');
      expect(memories).toHaveLength(1);
      expect(memories[0].scope).toBe('local');
    });

    it('should create directory structure when writing', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('key', 'value', 'project');

      const memoryPath = manager.getMemoryPath('project');
      expect(fs.existsSync(memoryPath)).toBe(true);
    });

    it('should persist memories to file', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('persist-key', 'persist-value', 'project');

      // Create a new manager loading from the same dir
      const manager2 = new AutoMemoryManager(tempDir);
      const memories = manager2.listMemories('project');
      expect(memories).toHaveLength(1);
      expect(memories[0].key).toBe('persist-key');
    });
  });

  describe('Recall', () => {
    it('should recall relevant memories based on context', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('typescript-config', 'Uses strict mode TypeScript', 'project');
      manager.writeMemory('database', 'PostgreSQL with Prisma ORM', 'project');

      const results = manager.recallMemories('typescript strict mode settings');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((m) => m.key === 'typescript-config')).toBe(true);
    });

    it('should return empty array when no memories match', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('key1', 'value1', 'project');

      const results = manager.recallMemories('xyz completely unrelated');
      // words shorter than 4 chars are filtered, so "xyz" won't match
      expect(results).toHaveLength(0);
    });
  });

  describe('Delete', () => {
    it('should delete a memory by key and scope', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('del-key', 'del-value', 'project');

      expect(manager.deleteMemory('del-key', 'project')).toBe(true);
      expect(manager.listMemories('project')).toHaveLength(0);
    });

    it('should return false when deleting nonexistent key', () => {
      const manager = new AutoMemoryManager(tempDir);
      expect(manager.deleteMemory('nonexistent', 'project')).toBe(false);
    });

    it('should delete from all scopes when no scope specified', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('shared-key', 'val1', 'project');
      manager.writeMemory('shared-key', 'val2', 'local');

      expect(manager.deleteMemory('shared-key')).toBe(true);
      expect(manager.listMemories('project')).toHaveLength(0);
      expect(manager.listMemories('local')).toHaveLength(0);
    });
  });

  describe('Analyze', () => {
    it('should extract project structure memories', () => {
      const manager = new AutoMemoryManager(tempDir);
      const results = manager.analyzeForMemories(
        'The project uses React with TypeScript.',
        'I see this is a React project.'
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe('agent');
      expect(results[0].scope).toBe('project');
    });

    it('should extract user preference memories', () => {
      const manager = new AutoMemoryManager(tempDir);
      const results = manager.analyzeForMemories(
        'I prefer single quotes over double quotes.',
        'Noted, I will use single quotes.'
      );

      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty array when no patterns match', () => {
      const manager = new AutoMemoryManager(tempDir);
      const results = manager.analyzeForMemories('hello', 'hi there');
      expect(results).toHaveLength(0);
    });
  });

  describe('Summary and Listing', () => {
    it('should return recall summary', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('k1', 'v1', 'project');
      manager.writeMemory('k2', 'v2', 'project');

      const summary = manager.getRecallSummary();
      expect(summary).toBe('Recalled 2 memories');
    });

    it('should list all memories without scope filter', () => {
      const manager = new AutoMemoryManager(tempDir);
      manager.writeMemory('k1', 'v1', 'project');
      manager.writeMemory('k2', 'v2', 'local');

      const all = manager.listMemories();
      expect(all).toHaveLength(2);
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const m1 = getAutoMemoryManager(tempDir);
      const m2 = getAutoMemoryManager();
      expect(m1).toBe(m2);
    });
  });
});

// ============================================================================
// Feature 4: Settings Hierarchy
// ============================================================================

describe('SettingsHierarchy', () => {
  let SettingsHierarchy: typeof import('../../src/config/settings-hierarchy').SettingsHierarchy;
  let SettingsLevel: typeof import('../../src/config/settings-hierarchy').SettingsLevel;
  let resetSettingsHierarchy: typeof import('../../src/config/settings-hierarchy').resetSettingsHierarchy;
  let getSettingsHierarchy: typeof import('../../src/config/settings-hierarchy').getSettingsHierarchy;

  let tempDir: string;

  beforeAll(async () => {
    const mod = await import('../../src/config/settings-hierarchy.js');
    SettingsHierarchy = mod.SettingsHierarchy;
    SettingsLevel = mod.SettingsLevel;
    resetSettingsHierarchy = mod.resetSettingsHierarchy;
    getSettingsHierarchy = mod.getSettingsHierarchy;
  });

  beforeEach(() => {
    tempDir = makeTempDir();
    resetSettingsHierarchy();
  });

  afterEach(() => {
    cleanTempDir(tempDir);
    resetSettingsHierarchy();
  });

  it('should return default values when no files exist', () => {
    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    expect(hierarchy.get('securityMode')).toBe('suggest');
    expect(hierarchy.get('maxToolRounds')).toBe(50);
    expect(hierarchy.get('theme')).toBe('dark');
  });

  it('should return undefined for unknown keys', () => {
    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    expect(hierarchy.get('nonexistentKey')).toBeUndefined();
  });

  it('should load project settings', () => {
    const settingsDir = path.join(tempDir, '.codebuddy');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ theme: 'light', customKey: 'projectValue' })
    );

    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    expect(hierarchy.get('theme')).toBe('light');
    expect(hierarchy.get('customKey')).toBe('projectValue');
  });

  it('should load project-local settings with higher priority than project', () => {
    const settingsDir = path.join(tempDir, '.codebuddy');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ theme: 'light' })
    );
    fs.writeFileSync(
      path.join(settingsDir, 'settings.local.json'),
      JSON.stringify({ theme: 'solarized' })
    );

    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    expect(hierarchy.get('theme')).toBe('solarized');
  });

  it('should prioritize CLI flags over project settings', () => {
    const settingsDir = path.join(tempDir, '.codebuddy');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ model: 'gpt-4o' })
    );

    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels({ model: 'claude-sonnet' });

    expect(hierarchy.get('model')).toBe('claude-sonnet');
  });

  it('should return value with source via getWithSource', () => {
    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels({ model: 'gpt-4o' });

    const result = hierarchy.getWithSource('model');
    expect(result).toBeDefined();
    expect(result!.value).toBe('gpt-4o');
    expect(result!.source).toBe(SettingsLevel.CliFlags);
  });

  it('should return default source for default values', () => {
    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    const result = hierarchy.getWithSource('securityMode');
    expect(result).toBeDefined();
    expect(result!.source).toBe(SettingsLevel.Default);
  });

  it('should return undefined from getWithSource for unknown keys', () => {
    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    expect(hierarchy.getWithSource('unknown')).toBeUndefined();
  });

  it('should detect overrides correctly', () => {
    const settingsDir = path.join(tempDir, '.codebuddy');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ theme: 'light' })
    );

    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels({ theme: 'cli-theme' });

    // Project level should be overridden by CLI flags
    expect(hierarchy.isOverridden('theme', SettingsLevel.Project)).toBe(true);
    // CLI flags level is not overridden (only ManagedPolicy is higher)
    expect(hierarchy.isOverridden('theme', SettingsLevel.CliFlags)).toBe(false);
  });

  it('should return false for isOverridden when key not present at higher levels', () => {
    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    expect(hierarchy.isOverridden('securityMode', SettingsLevel.Default)).toBe(false);
  });

  it('should merge all settings', () => {
    const settingsDir = path.join(tempDir, '.codebuddy');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ projectKey: 'projectVal', theme: 'light' })
    );

    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels({ cliKey: 'cliVal' });

    const all = hierarchy.getAllSettings();
    expect(all['cliKey']).toBe('cliVal');
    expect(all['projectKey']).toBe('projectVal');
    expect(all['securityMode']).toBe('suggest');
    // CLI theme overrides project theme
    expect(all['theme']).toBe('light');  // project theme wins since CLI didn't set it
  });

  it('should handle malformed JSON files gracefully', () => {
    const settingsDir = path.join(tempDir, '.codebuddy');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), 'not json{{{');

    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels();

    // Should fall back to defaults
    expect(hierarchy.get('securityMode')).toBe('suggest');
  });

  it('should get level name', () => {
    const hierarchy = new SettingsHierarchy(tempDir);
    expect(hierarchy.getLevelName(SettingsLevel.ManagedPolicy)).toBe('ManagedPolicy');
    expect(hierarchy.getLevelName(SettingsLevel.Default)).toBe('Default');
  });

  it('should support loading with a different project dir', () => {
    const otherDir = makeTempDir();
    const settingsDir = path.join(otherDir, '.codebuddy');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ fromOther: true })
    );

    const hierarchy = new SettingsHierarchy(tempDir);
    hierarchy.loadAllLevels(undefined, otherDir);

    expect(hierarchy.get('fromOther')).toBe(true);

    cleanTempDir(otherDir);
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const s1 = getSettingsHierarchy(tempDir);
      const s2 = getSettingsHierarchy();
      expect(s1).toBe(s2);
    });

    it('should create new instance when dir changes', () => {
      const s1 = getSettingsHierarchy(tempDir);
      const otherDir = makeTempDir();
      const s2 = getSettingsHierarchy(otherDir);
      expect(s1).not.toBe(s2);
      cleanTempDir(otherDir);
    });
  });
});
