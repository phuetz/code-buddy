/**
 * Tests for Plugins, Teams, Memory, Output, Permissions, and Status Line
 *
 * Covers:
 * - Feature 1: Plugin Manifest System
 * - Feature 2: Agent Teams v2
 * - Feature 3: Subagent Persistent Memory
 * - Feature 4: JSON Schema Output
 * - Feature 5: Permission Modes
 * - Feature 6: Custom Status Line
 */

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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Feature 1: Plugin Manifest System
// ============================================================================

describe('PluginManifestManager', () => {
  let PluginManifestManager: typeof import('../../src/plugins/plugin-manifest').PluginManifestManager;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/plugins/plugin-manifest');
    PluginManifestManager = mod.PluginManifestManager;
  });

  it('should initialize with empty plugins', () => {
    const mgr = new PluginManifestManager();
    expect(mgr.getPluginCount()).toBe(0);
    expect(mgr.getEnabledCount()).toBe(0);
    expect(mgr.listPlugins()).toEqual([]);
  });

  it('should load a plugin directly from manifest', () => {
    const mgr = new PluginManifestManager();
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      components: { skills: ['skill1.md'] },
    };
    const installed = mgr.loadPluginDirect(manifest, '/path/to/plugin');
    expect(installed.manifest.name).toBe('test-plugin');
    expect(installed.enabled).toBe(true);
    expect(installed.namespace).toBe('test-plugin');
    expect(installed.path).toBe('/path/to/plugin');
    expect(installed.installedAt).toBeGreaterThan(0);
  });

  it('should reject manifest with missing name', () => {
    const mgr = new PluginManifestManager();
    const result = mgr.validateManifest({ version: '1.0.0', components: {} } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('name'),
    ]));
  });

  it('should reject manifest with missing version', () => {
    const mgr = new PluginManifestManager();
    const result = mgr.validateManifest({ name: 'x', components: {} } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('version'),
    ]));
  });

  it('should reject manifest with invalid semver', () => {
    const mgr = new PluginManifestManager();
    const result = mgr.validateManifest({ name: 'x', version: 'abc', components: {} } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('semver'),
    ]));
  });

  it('should reject manifest with missing components', () => {
    const mgr = new PluginManifestManager();
    const result = mgr.validateManifest({ name: 'x', version: '1.0.0' } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('components'),
    ]));
  });

  it('should validate valid manifest', () => {
    const mgr = new PluginManifestManager();
    const result = mgr.validateManifest({
      name: 'my-plugin',
      version: '2.1.0',
      author: 'author',
      components: { skills: ['a.md'], agents: [] },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate marketplace source types', () => {
    const mgr = new PluginManifestManager();
    const result = mgr.validateManifest({
      name: 'x',
      version: '1.0.0',
      components: {},
      marketplace: { source: 'invalid-source' as any },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('marketplace.source'),
    ]));
  });

  it('should enable and disable a plugin', () => {
    const mgr = new PluginManifestManager();
    mgr.loadPluginDirect({ name: 'p1', version: '1.0.0', components: {} }, '/p');
    expect(mgr.getEnabledCount()).toBe(1);

    expect(mgr.disablePlugin('p1')).toBe(true);
    expect(mgr.getEnabledCount()).toBe(0);

    expect(mgr.enablePlugin('p1')).toBe(true);
    expect(mgr.getEnabledCount()).toBe(1);
  });

  it('should return false for enable/disable of non-existent plugin', () => {
    const mgr = new PluginManifestManager();
    expect(mgr.enablePlugin('nope')).toBe(false);
    expect(mgr.disablePlugin('nope')).toBe(false);
  });

  it('should uninstall a plugin', () => {
    const mgr = new PluginManifestManager();
    mgr.loadPluginDirect({ name: 'p1', version: '1.0.0', components: {} }, '/p');
    expect(mgr.uninstallPlugin('p1')).toBe(true);
    expect(mgr.getPluginCount()).toBe(0);
    expect(mgr.uninstallPlugin('p1')).toBe(false);
  });

  it('should get a plugin by name', () => {
    const mgr = new PluginManifestManager();
    mgr.loadPluginDirect({ name: 'p1', version: '1.0.0', components: {} }, '/p');
    expect(mgr.getPlugin('p1')).not.toBeNull();
    expect(mgr.getPlugin('missing')).toBeNull();
  });

  it('should resolve namespaced skills', () => {
    const mgr = new PluginManifestManager();
    mgr.loadPluginDirect({ name: 'my-plugin', version: '1.0.0', components: { skills: ['test.md'] } }, '/p');

    const resolved = mgr.resolveSkill('my-plugin:test');
    expect(resolved).toEqual({ pluginName: 'my-plugin', skillName: 'test' });
  });

  it('should return null for invalid skill format', () => {
    const mgr = new PluginManifestManager();
    expect(mgr.resolveSkill('no-colon')).toBeNull();
    expect(mgr.resolveSkill(':empty-plugin')).toBeNull();
    expect(mgr.resolveSkill('empty-skill:')).toBeNull();
    expect(mgr.resolveSkill('a:b:c')).toBeNull();
  });

  it('should return null for disabled plugin skill resolution', () => {
    const mgr = new PluginManifestManager();
    mgr.loadPluginDirect({ name: 'p1', version: '1.0.0', components: {} }, '/p');
    mgr.disablePlugin('p1');
    expect(mgr.resolveSkill('p1:skill')).toBeNull();
  });

  it('should manage marketplace restrictions', () => {
    const mgr = new PluginManifestManager();
    expect(mgr.isMarketplaceAllowed('https://github.com/org/repo')).toBe(true);
    expect(mgr.isMarketplaceAllowed('https://evil.com/malware')).toBe(false);

    mgr.addKnownMarketplace('https://custom.registry.io');
    expect(mgr.isMarketplaceAllowed('https://custom.registry.io/pkg')).toBe(true);
  });

  it('should install from source', async () => {
    const mgr = new PluginManifestManager();
    const installed = await mgr.installFromSource('npm', '@scope/my-package');
    expect(installed.manifest.name).toBe('scope-my-package');
    expect(installed.enabled).toBe(true);
    expect(mgr.getPluginCount()).toBe(1);
  });

  it('should block install from restricted marketplace when strict', async () => {
    const mgr = new PluginManifestManager();
    mgr.setStrictMarketplaces(true);
    await expect(mgr.installFromSource('url', 'https://evil.com/plugin.zip'))
      .rejects.toThrow('not allowed');
  });

  it('should allow install from known marketplace when strict', async () => {
    const mgr = new PluginManifestManager();
    mgr.setStrictMarketplaces(true);
    const installed = await mgr.installFromSource('github', 'https://github.com/org/repo');
    expect(installed).toBeDefined();
  });

  it('should throw on invalid manifest in loadPluginDirect', () => {
    const mgr = new PluginManifestManager();
    expect(() => mgr.loadPluginDirect({ name: '', version: '1.0.0', components: {} }, '/p'))
      .toThrow('Invalid manifest');
  });
});

// ============================================================================
// Feature 2: Agent Teams v2
// ============================================================================

describe('TeamTaskList', () => {
  let TeamTaskList: typeof import('../../src/agent/teams/team-v2').TeamTaskList;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/agent/teams/team-v2');
    TeamTaskList = mod.TeamTaskList;
  });

  it('should add tasks', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('Build UI', 'Create the interface');
    expect(task.id).toBeDefined();
    expect(task.title).toBe('Build UI');
    expect(task.status).toBe('pending');
    expect(task.dependencies).toEqual([]);
    expect(tl.getAllTasks()).toHaveLength(1);
  });

  it('should claim a pending task', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('Task A', 'desc');
    expect(tl.claimTask(task.id, 'agent-1')).toBe(true);
    expect(tl.getAllTasks()[0].status).toBe('claimed');
    expect(tl.getAllTasks()[0].assignee).toBe('agent-1');
  });

  it('should not claim non-pending task', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('Task A', 'desc');
    tl.claimTask(task.id, 'agent-1');
    expect(tl.claimTask(task.id, 'agent-2')).toBe(false);
  });

  it('should not claim task with unsatisfied dependencies', () => {
    const tl = new TeamTaskList();
    const t1 = tl.addTask('Dep', 'dependency');
    const t2 = tl.addTask('Main', 'main task', [t1.id]);
    expect(tl.claimTask(t2.id, 'agent-1')).toBe(false);
  });

  it('should claim task once dependencies are completed', () => {
    const tl = new TeamTaskList();
    const t1 = tl.addTask('Dep', 'dependency');
    const t2 = tl.addTask('Main', 'main task', [t1.id]);
    tl.claimTask(t1.id, 'agent-1');
    tl.completeTask(t1.id);
    expect(tl.claimTask(t2.id, 'agent-2')).toBe(true);
  });

  it('should complete a claimed task', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('Task', 'desc');
    tl.claimTask(task.id, 'agent-1');
    expect(tl.completeTask(task.id)).toBe(true);
    expect(tl.getCompletedCount()).toBe(1);
  });

  it('should not complete a pending task', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('Task', 'desc');
    expect(tl.completeTask(task.id)).toBe(false);
  });

  it('should fail a task', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('Task', 'desc');
    tl.claimTask(task.id, 'agent-1');
    expect(tl.failTask(task.id, 'timeout')).toBe(true);
    expect(tl.getAllTasks()[0].status).toBe('failed');
  });

  it('should not fail a pending task', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('Task', 'desc');
    expect(tl.failTask(task.id, 'reason')).toBe(false);
  });

  it('should get available tasks', () => {
    const tl = new TeamTaskList();
    const t1 = tl.addTask('Available', 'desc');
    const t2 = tl.addTask('Blocked', 'desc', [t1.id]);
    const available = tl.getAvailableTasks('agent-1');
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(t1.id);
  });

  it('should get tasks by agent', () => {
    const tl = new TeamTaskList();
    const t1 = tl.addTask('T1', 'd');
    const t2 = tl.addTask('T2', 'd');
    tl.claimTask(t1.id, 'agent-1');
    tl.claimTask(t2.id, 'agent-2');
    expect(tl.getTasksByAgent('agent-1')).toHaveLength(1);
    expect(tl.getTasksByAgent('agent-1')[0].id).toBe(t1.id);
  });

  it('should lock and unlock files', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('T', 'd');
    expect(tl.lockFile(task.id, 'src/main.ts')).toBe(true);
    expect(tl.isFileLocked('src/main.ts')).toEqual({ locked: true, byTask: task.id });
    expect(tl.unlockFile(task.id, 'src/main.ts')).toBe(true);
    expect(tl.isFileLocked('src/main.ts')).toEqual({ locked: false });
  });

  it('should prevent double locking a file by different tasks', () => {
    const tl = new TeamTaskList();
    const t1 = tl.addTask('T1', 'd');
    const t2 = tl.addTask('T2', 'd');
    expect(tl.lockFile(t1.id, 'src/main.ts')).toBe(true);
    expect(tl.lockFile(t2.id, 'src/main.ts')).toBe(false);
  });

  it('should return false for unlock of non-locked file', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('T', 'd');
    expect(tl.unlockFile(task.id, 'nope.ts')).toBe(false);
  });

  it('should track pending and completed counts', () => {
    const tl = new TeamTaskList();
    tl.addTask('T1', 'd');
    tl.addTask('T2', 'd');
    expect(tl.getPendingCount()).toBe(2);
    expect(tl.getCompletedCount()).toBe(0);
  });

  it('should release locked files on task completion', () => {
    const tl = new TeamTaskList();
    const task = tl.addTask('T', 'd');
    tl.claimTask(task.id, 'a');
    tl.lockFile(task.id, 'file.ts');
    tl.completeTask(task.id);
    expect(tl.isFileLocked('file.ts')).toEqual({ locked: false });
  });
});

describe('TeamMailbox', () => {
  let TeamMailbox: typeof import('../../src/agent/teams/team-v2').TeamMailbox;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/agent/teams/team-v2');
    TeamMailbox = mod.TeamMailbox;
  });

  it('should send a message', () => {
    const mb = new TeamMailbox();
    const msg = mb.send('agent-1', 'agent-2', 'Hello');
    expect(msg.from).toBe('agent-1');
    expect(msg.to).toBe('agent-2');
    expect(msg.content).toBe('Hello');
    expect(msg.read).toBe(false);
    expect(mb.getMessageCount()).toBe(1);
  });

  it('should broadcast a message', () => {
    const mb = new TeamMailbox();
    const msg = mb.broadcast('agent-1', 'Attention everyone');
    expect(msg.to).toBe('broadcast');
    expect(mb.getMessageCount()).toBe(1);
  });

  it('should get messages for an agent', () => {
    const mb = new TeamMailbox();
    mb.send('agent-1', 'agent-2', 'Direct');
    mb.broadcast('agent-1', 'Broadcast');
    mb.send('agent-1', 'agent-3', 'Other');

    const messages = mb.getMessages('agent-2');
    expect(messages).toHaveLength(2); // direct + broadcast
  });

  it('should exclude own messages', () => {
    const mb = new TeamMailbox();
    mb.broadcast('agent-1', 'My broadcast');
    expect(mb.getMessages('agent-1')).toHaveLength(0);
  });

  it('should get unread messages', () => {
    const mb = new TeamMailbox();
    const msg = mb.send('agent-1', 'agent-2', 'Hello');
    expect(mb.getUnread('agent-2')).toHaveLength(1);

    mb.markRead(msg.id);
    expect(mb.getUnread('agent-2')).toHaveLength(0);
  });

  it('should mark all read', () => {
    const mb = new TeamMailbox();
    mb.send('a', 'b', 'msg1');
    mb.send('a', 'b', 'msg2');
    mb.broadcast('a', 'broadcast');

    const count = mb.markAllRead('b');
    expect(count).toBe(3);
    expect(mb.getUnread('b')).toHaveLength(0);
  });

  it('should return false for marking non-existent message', () => {
    const mb = new TeamMailbox();
    expect(mb.markRead('fake-id')).toBe(false);
  });
});

describe('TeamManagerV2', () => {
  let TeamManagerV2: typeof import('../../src/agent/teams/team-v2').TeamManagerV2;

  const defaultConfig = {
    name: 'test-team',
    leadAgent: 'lead',
    teammates: ['agent-1', 'agent-2'],
    mode: 'auto' as const,
    delegateMode: false,
    planApproval: false,
    configPath: path.join(os.tmpdir(), 'test-team', 'config.json'),
  };

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/agent/teams/team-v2');
    TeamManagerV2 = mod.TeamManagerV2;
  });

  it('should create a team', () => {
    const tm = new TeamManagerV2(defaultConfig);
    expect(tm.getConfig().name).toBe('test-team');
    expect(tm.getTeammates()).toEqual(['agent-1', 'agent-2']);
  });

  it('should provide task list and mailbox', () => {
    const tm = new TeamManagerV2(defaultConfig);
    expect(tm.getTaskList()).toBeDefined();
    expect(tm.getMailbox()).toBeDefined();
  });

  it('should set and get mode', () => {
    const tm = new TeamManagerV2(defaultConfig);
    tm.setMode('tmux');
    expect(tm.getMode()).toBe('tmux');
  });

  it('should manage delegate mode', () => {
    const tm = new TeamManagerV2(defaultConfig);
    expect(tm.isDelegateMode()).toBe(false);
    tm.setDelegateMode(true);
    expect(tm.isDelegateMode()).toBe(true);
  });

  it('should add and remove teammates', () => {
    const tm = new TeamManagerV2(defaultConfig);
    expect(tm.addTeammate('agent-3')).toBe(true);
    expect(tm.getTeammates()).toContain('agent-3');
    expect(tm.addTeammate('agent-3')).toBe(false); // duplicate
    expect(tm.removeTeammate('agent-3')).toBe(true);
    expect(tm.getTeammates()).not.toContain('agent-3');
    expect(tm.removeTeammate('agent-3')).toBe(false); // not found
  });

  it('should generate tmux layout', () => {
    const tm = new TeamManagerV2(defaultConfig);
    const layout = tm.generateTmuxLayout();
    expect(layout).toContain('test-team');
    expect(layout).toContain('lead');
    expect(layout).toContain('agent-1');
  });

  it('should serialize and deserialize config', () => {
    const tm = new TeamManagerV2(defaultConfig);
    const json = tm.serializeConfig();
    const restored = TeamManagerV2.deserializeConfig(json);
    expect(restored.name).toBe('test-team');
    expect(restored.leadAgent).toBe('lead');
    expect(restored.teammates).toEqual(['agent-1', 'agent-2']);
  });

  it('should throw on invalid deserialization', () => {
    expect(() => TeamManagerV2.deserializeConfig('{}')).toThrow('missing name or leadAgent');
  });
});

// ============================================================================
// Feature 3: Subagent Persistent Memory
// ============================================================================

describe('SubagentMemory', () => {
  let SubagentMemory: typeof import('../../src/memory/subagent-memory').SubagentMemory;
  let tmpDir: string;

  beforeEach(async () => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-mem-'));
    const mod = await import('../../src/memory/subagent-memory');
    SubagentMemory = mod.SubagentMemory;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create memory with custom dir', () => {
    const mem = new SubagentMemory({
      agentName: 'test-agent',
      scope: 'local',
      maxLines: 100,
      memoryDir: tmpDir,
    });
    expect(mem.getAgentName()).toBe('test-agent');
    expect(mem.getScope()).toBe('local');
    expect(mem.getMemoryPath()).toBe(tmpDir);
  });

  it('should compute default memory dir for user scope', () => {
    const dir = SubagentMemory.getMemoryDir('my-agent', 'user');
    expect(dir).toContain('.codebuddy');
    expect(dir).toContain('my-agent');
  });

  it('should compute default memory dir for project scope', () => {
    const dir = SubagentMemory.getMemoryDir('my-agent', 'project');
    expect(dir).toContain('.codebuddy');
    expect(dir).toContain('my-agent');
  });

  it('should compute default memory dir for local scope', () => {
    const dir = SubagentMemory.getMemoryDir('my-agent', 'local');
    expect(dir).toContain('codebuddy-agents');
  });

  it('should sanitize agent name in dir', () => {
    const dir = SubagentMemory.getMemoryDir('agent/with spaces', 'local');
    expect(dir).not.toContain('/with spaces');
    expect(dir).toContain('agent_with_spaces');
  });

  it('should write and read memory', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    mem.writeMemory('# Memory\nLine 1\nLine 2');
    expect(mem.readMemory()).toBe('# Memory\nLine 1\nLine 2');
  });

  it('should return empty string when no memory exists', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    expect(mem.readMemory()).toBe('');
  });

  it('should limit read to maxLines', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 2, memoryDir: tmpDir });
    mem.writeMemory('Line 1\nLine 2\nLine 3\nLine 4');
    expect(mem.readMemory()).toBe('Line 1\nLine 2');
  });

  it('should append to memory', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    mem.writeMemory('Line 1');
    mem.appendMemory('Line 2');
    expect(mem.readMemory()).toContain('Line 1');
    expect(mem.readMemory()).toContain('Line 2');
  });

  it('should write and read topic files', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    mem.writeTopic('architecture', '# Architecture\nMicroservices');
    const content = mem.readTopic('architecture');
    expect(content).toContain('Microservices');
  });

  it('should return null for non-existent topic', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    expect(mem.readTopic('missing')).toBeNull();
  });

  it('should list memory files', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    mem.writeMemory('content');
    mem.writeTopic('topic1', 'content');
    const files = mem.listMemoryFiles();
    expect(files).toContain('MEMORY.md');
    expect(files).toContain('topic1.md');
  });

  it('should return empty list when no dir', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: path.join(os.tmpdir(), 'nonexistent-dir-abc123') });
    expect(mem.listMemoryFiles()).toEqual([]);
  });

  it('should check hasMemory', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    expect(mem.hasMemory()).toBe(false);
    mem.writeMemory('data');
    expect(mem.hasMemory()).toBe(true);
  });

  it('should get memory size', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    expect(mem.getMemorySize()).toBe(0);
    mem.writeMemory('hello world');
    expect(mem.getMemorySize()).toBeGreaterThan(0);
  });

  it('should clear memory', () => {
    const mem = new SubagentMemory({ agentName: 'a', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    mem.writeMemory('data');
    mem.writeTopic('t1', 'data');
    mem.clearMemory();
    expect(mem.hasMemory()).toBe(false);
    expect(mem.listMemoryFiles()).toEqual([]);
  });

  it('should generate context injection', () => {
    const mem = new SubagentMemory({ agentName: 'test-agent', scope: 'local', maxLines: 200, memoryDir: tmpDir });
    expect(mem.getContextInjection()).toBe('');
    mem.writeMemory('Important fact');
    const ctx = mem.getContextInjection();
    expect(ctx).toContain('SUBAGENT MEMORY');
    expect(ctx).toContain('test-agent');
    expect(ctx).toContain('Important fact');
  });
});

// ============================================================================
// Feature 4: JSON Schema Output
// ============================================================================

describe('JsonSchemaOutput', () => {
  let JsonSchemaOutput: typeof import('../../src/output/json-schema-output').JsonSchemaOutput;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/output/json-schema-output');
    JsonSchemaOutput = mod.JsonSchemaOutput;
  });

  const basicSchema = {
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
    },
  };

  it('should validate valid JSON output', () => {
    const jso = new JsonSchemaOutput({ schema: basicSchema, strict: true, extractFromMarkdown: false });
    const result = jso.validate('{"name": "Alice", "age": 30}');
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ name: 'Alice', age: 30 });
  });

  it('should reject invalid JSON', () => {
    const jso = new JsonSchemaOutput({ schema: basicSchema, strict: true, extractFromMarkdown: false });
    const result = jso.validate('not json at all {}{}');
    expect(result.valid).toBe(false);
  });

  it('should detect missing required fields', () => {
    const jso = new JsonSchemaOutput({ schema: basicSchema, strict: true, extractFromMarkdown: false });
    const result = jso.validate('{"name": "Alice"}');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('age'))).toBe(true);
  });

  it('should detect type mismatch', () => {
    const jso = new JsonSchemaOutput({ schema: basicSchema, strict: true, extractFromMarkdown: false });
    const result = jso.validate('{"name": 123, "age": 30}');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'name')).toBe(true);
  });

  it('should extract JSON from markdown code block', () => {
    const jso = new JsonSchemaOutput({ schema: basicSchema, strict: false, extractFromMarkdown: true });
    const text = 'Here is the result:\n```json\n{"name": "Bob", "age": 25}\n```\nDone.';
    const result = jso.validate(text);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ name: 'Bob', age: 25 });
  });

  it('should extract JSON embedded in text', () => {
    const jso = new JsonSchemaOutput({ schema: basicSchema, strict: false, extractFromMarkdown: false });
    const text = 'Result: {"name": "Carol", "age": 40} end';
    const result = jso.validate(text);
    expect(result.valid).toBe(true);
  });

  it('should validate string constraints', () => {
    const schema = {
      type: 'object',
      properties: {
        code: { type: 'string', minLength: 3, maxLength: 5, pattern: '^[A-Z]+$' },
      },
    };
    const jso = new JsonSchemaOutput({ schema, strict: true, extractFromMarkdown: false });

    expect(jso.validate('{"code": "AB"}').valid).toBe(false); // too short
    expect(jso.validate('{"code": "ABCDEF"}').valid).toBe(false); // too long
    expect(jso.validate('{"code": "abc"}').valid).toBe(false); // pattern
    expect(jso.validate('{"code": "ABC"}').valid).toBe(true);
  });

  it('should validate number constraints', () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
    };
    const jso = new JsonSchemaOutput({ schema, strict: true, extractFromMarkdown: false });

    expect(jso.validate('{"score": -1}').valid).toBe(false);
    expect(jso.validate('{"score": 101}').valid).toBe(false);
    expect(jso.validate('{"score": 50}').valid).toBe(true);
  });

  it('should validate enum values', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
    };
    const jso = new JsonSchemaOutput({ schema, strict: true, extractFromMarkdown: false });

    expect(jso.validate('{"status": "active"}').valid).toBe(true);
    expect(jso.validate('{"status": "deleted"}').valid).toBe(false);
  });

  it('should validate array items', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const jso = new JsonSchemaOutput({ schema, strict: true, extractFromMarkdown: false });

    expect(jso.validate('{"tags": ["a", "b"]}').valid).toBe(true);
    expect(jso.validate('{"tags": ["a", 1]}').valid).toBe(false);
  });

  it('should validate array min/max items', () => {
    const schema = {
      type: 'object',
      properties: {
        items: { type: 'array', minItems: 1, maxItems: 3 },
      },
    };
    const jso = new JsonSchemaOutput({ schema, strict: true, extractFromMarkdown: false });

    expect(jso.validate('{"items": []}').valid).toBe(false);
    expect(jso.validate('{"items": [1,2,3,4]}').valid).toBe(false);
    expect(jso.validate('{"items": [1,2]}').valid).toBe(true);
  });

  it('should handle top-level type mismatch', () => {
    const schema = { type: 'object' };
    const jso = new JsonSchemaOutput({ schema, strict: true, extractFromMarkdown: false });
    const result = jso.validate('[1,2,3]');
    expect(result.valid).toBe(false);
    expect(result.errors[0].expected).toBe('object');
  });

  it('should extract JSON from text', () => {
    const jso = new JsonSchemaOutput({ schema: { type: 'object' }, strict: false, extractFromMarkdown: true });
    expect(jso.extractJson('{"a":1}')).toBe('{"a":1}');
    expect(jso.extractJson('blah')).toBeNull();
  });

  it('should format valid output', () => {
    const jso = new JsonSchemaOutput({ schema: {}, strict: false, extractFromMarkdown: false });
    const formatted = jso.formatValidOutput({ a: 1 });
    expect(formatted).toContain('"a": 1');
  });

  it('should return schema', () => {
    const schema = { type: 'object' };
    const jso = new JsonSchemaOutput({ schema, strict: false, extractFromMarkdown: false });
    expect(jso.getSchema()).toEqual({ type: 'object' });
  });
});

// ============================================================================
// Feature 5: Permission Modes
// ============================================================================

describe('PermissionModeManager', () => {
  let PermissionModeManager: typeof import('../../src/security/permission-modes').PermissionModeManager;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/security/permission-modes');
    PermissionModeManager = mod.PermissionModeManager;
  });

  it('should default to default mode', () => {
    const pm = new PermissionModeManager();
    expect(pm.getMode()).toBe('default');
  });

  it('should set mode', () => {
    const pm = new PermissionModeManager();
    expect(pm.setMode('plan')).toBe(true);
    expect(pm.getMode()).toBe('plan');
  });

  it('should prevent bypass when disabled', () => {
    const pm = new PermissionModeManager({ disableBypass: true });
    expect(pm.setMode('bypassPermissions')).toBe(false);
    expect(pm.getMode()).toBe('default');
  });

  it('should allow non-bypass modes even when bypass disabled', () => {
    const pm = new PermissionModeManager({ disableBypass: true });
    expect(pm.setMode('dontAsk')).toBe(true);
    expect(pm.getMode()).toBe('dontAsk');
  });

  // Default mode tests
  it('default mode: auto-approve read-only tools', () => {
    const pm = new PermissionModeManager({ mode: 'default' });
    const result = pm.checkPermission('read', 'view_file');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(false);
  });

  it('default mode: prompt for edit tools', () => {
    const pm = new PermissionModeManager({ mode: 'default' });
    const result = pm.checkPermission('edit', 'write_file');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(true);
  });

  // Plan mode tests
  it('plan mode: allow read-only', () => {
    const pm = new PermissionModeManager({ mode: 'plan' });
    const result = pm.checkPermission('read', 'search');
    expect(result.allowed).toBe(true);
  });

  it('plan mode: block edit tools', () => {
    const pm = new PermissionModeManager({ mode: 'plan' });
    const result = pm.checkPermission('edit', 'write_file');
    expect(result.allowed).toBe(false);
  });

  it('plan mode: block destructive tools', () => {
    const pm = new PermissionModeManager({ mode: 'plan' });
    const result = pm.checkPermission('exec', 'bash');
    expect(result.allowed).toBe(false);
  });

  // Accept edits mode tests
  it('acceptEdits mode: auto-approve edits', () => {
    const pm = new PermissionModeManager({ mode: 'acceptEdits' });
    const result = pm.checkPermission('edit', 'edit_file');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(false);
  });

  it('acceptEdits mode: prompt for destructive', () => {
    const pm = new PermissionModeManager({ mode: 'acceptEdits' });
    const result = pm.checkPermission('exec', 'bash');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(true);
  });

  // Don't ask mode tests
  it('dontAsk mode: auto-approve non-destructive', () => {
    const pm = new PermissionModeManager({ mode: 'dontAsk' });
    const result = pm.checkPermission('edit', 'write_file');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(false);
  });

  it('dontAsk mode: prompt for destructive', () => {
    const pm = new PermissionModeManager({ mode: 'dontAsk' });
    const result = pm.checkPermission('exec', 'bash');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(true);
  });

  // Bypass mode tests
  it('bypass mode: auto-approve everything', () => {
    const pm = new PermissionModeManager({ mode: 'bypassPermissions' });
    const result = pm.checkPermission('exec', 'bash');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(false);
  });

  // Tool classification
  it('should classify read-only tools', () => {
    const pm = new PermissionModeManager();
    expect(pm.isReadOnlyTool('view_file')).toBe(true);
    expect(pm.isReadOnlyTool('search')).toBe(true);
    expect(pm.isReadOnlyTool('bash')).toBe(false);
  });

  it('should classify edit tools', () => {
    const pm = new PermissionModeManager();
    expect(pm.isEditTool('write_file')).toBe(true);
    expect(pm.isEditTool('apply_patch')).toBe(true);
    expect(pm.isEditTool('view_file')).toBe(false);
  });

  it('should classify destructive tools', () => {
    const pm = new PermissionModeManager();
    expect(pm.isDestructiveTool('bash')).toBe(true);
    expect(pm.isDestructiveTool('delete_file')).toBe(true);
    expect(pm.isDestructiveTool('view_file')).toBe(false);
  });

  // Pattern allowlist
  it('should add and match allowed patterns', () => {
    const pm = new PermissionModeManager({ mode: 'plan' });
    pm.addAllowedPattern('git *');

    const result = pm.checkPermission('git status', 'bash');
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('pattern');
  });

  it('should not match non-matching patterns', () => {
    const pm = new PermissionModeManager({ mode: 'plan' });
    pm.addAllowedPattern('git *');
    const result = pm.checkPermission('rm -rf /', 'bash');
    expect(result.allowed).toBe(false); // plan mode blocks non-read
  });

  // Subagent mode
  it('should set and get subagent mode', () => {
    const pm = new PermissionModeManager();
    pm.setSubagentMode('plan');
    expect(pm.getSubagentMode()).toBe('plan');
  });

  it('should default subagent mode to main mode', () => {
    const pm = new PermissionModeManager({ mode: 'acceptEdits' });
    expect(pm.getSubagentMode()).toBe('acceptEdits');
  });

  // Bypass disable management
  it('should disable bypass and revert active bypass', () => {
    const pm = new PermissionModeManager({ mode: 'bypassPermissions' });
    pm.setBypassDisabled(true);
    expect(pm.getMode()).toBe('default');
    expect(pm.isBypassDisabled()).toBe(true);
  });

  it('should report bypass disabled state', () => {
    const pm = new PermissionModeManager({ disableBypass: true });
    expect(pm.isBypassDisabled()).toBe(true);
  });
});

// ============================================================================
// Feature 6: Custom Status Line
// ============================================================================

describe('StatusLineManager', () => {
  let StatusLineManager: typeof import('../../src/ui/status-line').StatusLineManager;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/ui/status-line');
    StatusLineManager = mod.StatusLineManager;
  });

  afterEach(() => {
    // Clean up any timers
    jest.clearAllTimers();
  });

  it('should initialize disabled by default', () => {
    const slm = new StatusLineManager();
    expect(slm.isEnabled()).toBe(false);
    expect(slm.render()).toBe('');
  });

  it('should enable and disable', () => {
    const slm = new StatusLineManager();
    slm.enable();
    expect(slm.isEnabled()).toBe(true);
    slm.disable();
    expect(slm.isEnabled()).toBe(false);
  });

  it('should update data', () => {
    const slm = new StatusLineManager({ enabled: true });
    slm.updateData({ model: 'gpt-4', gitBranch: 'main' });
    const data = slm.getData();
    expect(data.model).toBe('gpt-4');
    expect(data.gitBranch).toBe('main');
  });

  it('should merge data on update', () => {
    const slm = new StatusLineManager({ enabled: true });
    slm.updateData({ model: 'gpt-4' });
    slm.updateData({ gitBranch: 'dev' });
    const data = slm.getData();
    expect(data.model).toBe('gpt-4');
    expect(data.gitBranch).toBe('dev');
  });

  it('should render with default template', () => {
    const slm = new StatusLineManager({ enabled: true });
    slm.updateData({ model: 'claude-3', gitBranch: 'feature/x', tokenUsage: { used: 500, max: 4000 } });
    const rendered = slm.render();
    expect(rendered).toContain('claude-3');
    expect(rendered).toContain('feature/x');
    expect(rendered).toContain('500/4000');
  });

  it('should render with custom template', () => {
    const slm = new StatusLineManager({
      enabled: true,
      template: 'Model: {{model}} Branch: {{gitBranch}}',
    });
    slm.updateData({ model: 'gpt-4o', gitBranch: 'main' });
    const rendered = slm.render();
    expect(rendered).toBe('Model: gpt-4o Branch: main');
  });

  it('should render custom content when set', () => {
    const slm = new StatusLineManager({ enabled: true });
    slm.updateData({ customContent: 'Custom status bar content' });
    expect(slm.render()).toBe('Custom status bar content');
  });

  it('should format token usage with percentage', () => {
    const slm = new StatusLineManager({ enabled: true, template: '{{tokenUsage}}' });
    slm.updateData({ tokenUsage: { used: 1000, max: 4000 } });
    const rendered = slm.render();
    expect(rendered).toContain('25%');
    expect(rendered).toContain('1000/4000');
  });

  it('should handle zero max tokens', () => {
    const slm = new StatusLineManager({ enabled: true, template: '{{tokenUsage}}' });
    slm.updateData({ tokenUsage: { used: 0, max: 0 } });
    const rendered = slm.render();
    expect(rendered).toContain('0%');
  });

  it('should handle missing data gracefully', () => {
    const slm = new StatusLineManager({ enabled: true });
    const rendered = slm.render();
    expect(rendered).toContain('unknown'); // default model
    expect(rendered).toContain('no branch'); // default branch
  });

  it('should start and stop refresh', () => {
    jest.useFakeTimers();
    const slm = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
    expect(slm.isRefreshing()).toBe(false);

    slm.startRefresh();
    expect(slm.isRefreshing()).toBe(true);

    slm.stopRefresh();
    expect(slm.isRefreshing()).toBe(false);
    jest.useRealTimers();
  });

  it('should not double-start refresh', () => {
    jest.useFakeTimers();
    const slm = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
    slm.startRefresh();
    slm.startRefresh(); // should be a no-op
    expect(slm.isRefreshing()).toBe(true);
    slm.stopRefresh();
    jest.useRealTimers();
  });

  it('should stop refresh on disable', () => {
    jest.useFakeTimers();
    const slm = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
    slm.startRefresh();
    slm.disable();
    expect(slm.isRefreshing()).toBe(false);
    jest.useRealTimers();
  });

  it('should get config', () => {
    const slm = new StatusLineManager({ enabled: true, position: 'top', refreshInterval: 3000 });
    const config = slm.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.position).toBe('top');
    expect(config.refreshInterval).toBe(3000);
  });

  it('should dispose cleanly', () => {
    jest.useFakeTimers();
    const slm = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
    slm.startRefresh();
    slm.updateData({ model: 'x' });
    slm.dispose();
    expect(slm.isRefreshing()).toBe(false);
    expect(slm.getData()).toEqual({});
    jest.useRealTimers();
  });

  // Shell scripts use Unix-only commands
  (process.platform === 'win32' ? it.skip : it)('should execute script for dynamic content', async () => {
    const slm = new StatusLineManager({ enabled: true, script: 'echo "dynamic content"' });
    const output = await slm.executeScript();
    expect(output).toBe('dynamic content');
  });

  // Shell scripts use Unix-only commands
  (process.platform === 'win32' ? it.skip : it)('should return empty on script error', async () => {
    const slm = new StatusLineManager({ enabled: true, script: 'exit 1' });
    const output = await slm.executeScript();
    expect(output).toBe('');
  });

  it('should return empty when no script configured', async () => {
    const slm = new StatusLineManager({ enabled: true });
    const output = await slm.executeScript();
    expect(output).toBe('');
  });
});
