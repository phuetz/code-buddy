/**
 * Tests for OpenClaw parity features:
 * Lobster Engine, Session Enhancements, Terminal Enhancements,
 * Sender Policies, Memory Flush, Niche Channels.
 */

jest.mock('../../src/utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { LobsterEngine, LobsterWorkflow, StepResult } from '../../src/workflows/lobster-engine';
import {
  SessionPersistentSettings,
  UpdateChannelManager,
  ElevatedModeManager,
} from '../../src/utils/session-enhancements';
import { OSC8Hyperlink, LobsterPalette, VerboseMode } from '../../src/ui/terminal-enhancements';
import { SenderPolicyManager, AgentListTool } from '../../src/security/sender-policies';
import { PreThresholdFlusher, MemoryBackendManager, MemoryBackend } from '../../src/memory/memory-flush';
import {
  TwitchAdapter,
  TlonAdapter,
  GmailWebhookAdapter,
  DocsSearchTool,
} from '../../src/channels/niche-channels';

// ─── Lobster Engine ──────────────────────────────────────────────

describe('LobsterEngine', () => {
  let engine: LobsterEngine;

  const simpleWorkflow: LobsterWorkflow = {
    name: 'test-flow',
    version: '1.0.0',
    steps: [
      { id: 'a', name: 'Step A', command: 'echo a' },
      { id: 'b', name: 'Step B', command: 'echo b', dependsOn: ['a'] },
      { id: 'c', name: 'Step C', command: 'echo c', dependsOn: ['a'] },
    ],
  };

  beforeEach(() => {
    LobsterEngine.resetInstance();
    engine = LobsterEngine.getInstance();
  });

  it('should be a singleton', () => {
    expect(LobsterEngine.getInstance()).toBe(engine);
  });

  it('should parse valid JSON workflow', () => {
    const wf = engine.parseWorkflow(JSON.stringify(simpleWorkflow));
    expect(wf.name).toBe('test-flow');
    expect(wf.steps).toHaveLength(3);
  });

  it('should throw on invalid JSON', () => {
    expect(() => engine.parseWorkflow('not json at all')).toThrow();
  });

  it('should throw on missing workflow fields', () => {
    expect(() => engine.parseWorkflow(JSON.stringify({ name: 'x' }))).toThrow('Invalid workflow');
  });

  it('should throw on missing step fields', () => {
    const bad = { name: 'x', version: '1', steps: [{ id: 'a' }] };
    expect(() => engine.parseWorkflow(JSON.stringify(bad))).toThrow('Invalid step');
  });

  it('should validate a correct workflow', () => {
    const result = engine.validateWorkflow(simpleWorkflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect unknown dependencies', () => {
    const wf: LobsterWorkflow = {
      name: 'bad', version: '1', steps: [
        { id: 'a', name: 'A', command: 'echo', dependsOn: ['nonexistent'] },
      ],
    };
    const result = engine.validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
  });

  it('should detect dependency cycles', () => {
    const wf: LobsterWorkflow = {
      name: 'cyclic', version: '1', steps: [
        { id: 'a', name: 'A', command: 'echo', dependsOn: ['b'] },
        { id: 'b', name: 'B', command: 'echo', dependsOn: ['a'] },
      ],
    };
    const result = engine.validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cycle'))).toBe(true);
  });

  it('should detect duplicate step IDs', () => {
    const wf: LobsterWorkflow = {
      name: 'dup', version: '1', steps: [
        { id: 'a', name: 'A1', command: 'echo' },
        { id: 'a', name: 'A2', command: 'echo' },
      ],
    };
    const result = engine.validateWorkflow(wf);
    expect(result.valid).toBe(false);
  });

  it('should resolve ${var} references', () => {
    const result = engine.resolveVariables('Hello ${name}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('should resolve $step.stdout references', () => {
    const result = engine.resolveVariables('Got: $build.stdout', { 'build.stdout': 'ok' });
    expect(result).toBe('Got: ok');
  });

  it('should resolve $step.json references', () => {
    const result = engine.resolveVariables('Data: $api.json', { 'api.json': '{"a":1}' });
    expect(result).toBe('Data: {"a":1}');
  });

  it('should return empty string for unresolved variables', () => {
    const result = engine.resolveVariables('${missing}', {});
    expect(result).toBe('');
  });

  it('should return topological execution order', () => {
    const order = engine.getExecutionOrder(simpleWorkflow);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
  });

  it('should generate and parse resume tokens', () => {
    const steps = ['a', 'b'];
    const token = engine.generateResumeToken(steps);
    expect(typeof token).toBe('string');
    const parsed = engine.parseResumeToken(token);
    expect(parsed).toEqual(steps);
  });

  it('should throw on invalid resume token', () => {
    expect(() => engine.parseResumeToken('!!invalid!!')).toThrow('Invalid resume token');
  });

  it('should return success for all-success results', () => {
    const results: StepResult[] = [
      { stepId: 'a', status: 'success', stdout: '', exitCode: 0, duration: 100 },
    ];
    expect(engine.getWorkflowStatus(results)).toBe('success');
  });

  it('should return failed for all-failed results', () => {
    const results: StepResult[] = [
      { stepId: 'a', status: 'failed', stdout: '', exitCode: 1, duration: 50 },
    ];
    expect(engine.getWorkflowStatus(results)).toBe('failed');
  });

  it('should return partial for mixed results', () => {
    const results: StepResult[] = [
      { stepId: 'a', status: 'success', stdout: '', exitCode: 0, duration: 100 },
      { stepId: 'b', status: 'failed', stdout: '', exitCode: 1, duration: 50 },
    ];
    expect(engine.getWorkflowStatus(results)).toBe('partial');
  });

  it('should return success for empty results', () => {
    expect(engine.getWorkflowStatus([])).toBe('success');
  });

  // ─── OpenClaw Compatibility ──────────────────────────────────────

  describe('OpenClaw Compatibility', () => {
    it('should merge env into variables', () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'a', name: 'A', command: 'echo ${MY_VAR}' },
        ],
        env: { MY_VAR: 'hello' },
      };
      engine.normalizeOpenClawFormat(wf);
      expect(wf.variables).toEqual({ MY_VAR: 'hello' });
    });

    it('should resolve args defaults into variables', () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'a', name: 'A', command: 'echo ${branch}' },
        ],
        args: { branch: { default: 'main' } },
      };
      engine.normalizeOpenClawFormat(wf);
      expect(wf.variables!.branch).toBe('main');
    });

    it('should infer implicit deps from stdin references', () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'build', name: 'Build', command: 'npm run build' },
          { id: 'test', name: 'Test', command: 'npm test', stdin: '$build.stdout' },
        ],
      };
      engine.normalizeOpenClawFormat(wf);
      expect(wf.steps[1].dependsOn).toEqual(['build']);
    });

    it('should infer deps from command $step.stdout references', () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'fetch', name: 'Fetch', command: 'curl api' },
          { id: 'process', name: 'Process', command: 'echo $fetch.stdout | jq .' },
        ],
      };
      engine.normalizeOpenClawFormat(wf);
      expect(wf.steps[1].dependsOn).toContain('fetch');
    });

    it('should not duplicate dependsOn if already declared', () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'a', name: 'A', command: 'echo' },
          { id: 'b', name: 'B', command: 'echo $a.stdout', dependsOn: ['a'] },
        ],
      };
      engine.normalizeOpenClawFormat(wf);
      expect(wf.steps[1].dependsOn).toEqual(['a']); // no duplicate
    });

    it('should detect approval gate via approval field', async () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'build', name: 'Build', command: 'npm run build' },
          { id: 'gate', name: 'Deploy Gate', command: 'check', approval: 'required' },
          { id: 'deploy', name: 'Deploy', command: 'deploy', dependsOn: ['gate'] },
        ],
      };
      const result = await engine.executeWithApproval(wf);
      expect(result.status).toBe('needs_approval');
      expect(result.requiresApproval?.gate.stepId).toBe('gate');
    });

    it('should skip step when condition evaluates to false', async () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'a', name: 'A', command: 'echo a' },
          { id: 'b', name: 'B', command: 'echo b', condition: '$nonexistent.approved' },
        ],
      };
      const result = await engine.executeWithApproval(wf);
      expect(result.status).toBe('ok');
      const stepB = result.output.find(r => r.stepId === 'b');
      expect(stepB?.status).toBe('skipped');
    });

    it('should execute step when condition is truthy', async () => {
      const wf: LobsterWorkflow = {
        name: 'oc', version: '1', steps: [
          { id: 'a', name: 'A', command: 'approve', approval: 'required' },
          { id: 'b', name: 'B', command: 'echo b', condition: '$a.approved', dependsOn: ['a'] },
        ],
      };
      const handler = async () => true;
      const result = await engine.executeWithApproval(wf, {}, handler);
      expect(result.status).toBe('ok');
      const stepB = result.output.find(r => r.stepId === 'b');
      expect(stepB?.status).toBe('success');
    });

    it('should resolve $step.approved and $step.exitCode', () => {
      expect(engine.resolveVariables('$gate.approved', { 'gate.approved': 'true' })).toBe('true');
      expect(engine.resolveVariables('$build.exitCode', { 'build.exitCode': '0' })).toBe('0');
    });

    it('should evaluate equality conditions', () => {
      expect(engine.evaluateCondition('0 == 0', {})).toBe(true);
      expect(engine.evaluateCondition('1 == 0', {})).toBe(false);
      expect(engine.evaluateCondition('a != b', {})).toBe(true);
      expect(engine.evaluateCondition('a != a', {})).toBe(false);
    });

    it('should evaluate truthy/falsy conditions', () => {
      expect(engine.evaluateCondition(undefined, {})).toBe(true);
      expect(engine.evaluateCondition('', {})).toBe(true); // empty string condition = no condition
      expect(engine.evaluateCondition('false', {})).toBe(false);
      expect(engine.evaluateCondition('0', {})).toBe(false);
      expect(engine.evaluateCondition('true', {})).toBe(true);
    });

    it('should parse full OpenClaw-style workflow JSON', () => {
      const openclawWorkflow = JSON.stringify({
        name: 'deploy-pipeline',
        version: '2.0.0',
        args: { target: { default: 'staging' } },
        env: { NODE_ENV: 'production' },
        steps: [
          { id: 'build', name: 'Build', command: 'npm run build' },
          { id: 'test', name: 'Test', command: 'npm test', stdin: '$build.stdout' },
          { id: 'review', name: 'Review', command: 'review', approval: 'required' },
          { id: 'deploy', name: 'Deploy', command: 'deploy $test.stdout', condition: '$review.approved', dependsOn: ['review'] },
        ],
      });
      const wf = engine.parseWorkflow(openclawWorkflow);
      expect(wf.name).toBe('deploy-pipeline');
      expect(wf.variables?.NODE_ENV).toBe('production');
      expect(wf.variables?.target).toBe('staging');
      // test step should now depend on build (inferred from stdin)
      expect(wf.steps[1].dependsOn).toContain('build');
      // deploy step should have both review (explicit) and test (inferred from command)
      expect(wf.steps[3].dependsOn).toContain('review');
      expect(wf.steps[3].dependsOn).toContain('test');
    });

    it('should extractStepReferences from text', () => {
      const ids = new Set(['build', 'test', 'deploy']);
      expect(engine.extractStepReferences('$build.stdout', ids)).toEqual(['build']);
      expect(engine.extractStepReferences('echo $test.json | $deploy.exitCode', ids)).toEqual(['test', 'deploy']);
      expect(engine.extractStepReferences('no refs here', ids)).toEqual([]);
      expect(engine.extractStepReferences('$unknown.stdout', ids)).toEqual([]);
    });
  });
});

// ─── Session Persistent Settings ─────────────────────────────────

describe('SessionPersistentSettings', () => {
  let settings: SessionPersistentSettings;

  beforeEach(() => {
    SessionPersistentSettings.resetInstance();
    settings = SessionPersistentSettings.getInstance();
  });

  it('should be a singleton', () => {
    expect(SessionPersistentSettings.getInstance()).toBe(settings);
  });

  it('should set and get per-session values', () => {
    settings.set('s1', 'theme', 'dark');
    expect(settings.get('s1', 'theme')).toBe('dark');
  });

  it('should return undefined for missing keys', () => {
    expect(settings.get('s1', 'nonexistent')).toBeUndefined();
  });

  it('should return all settings for a session', () => {
    settings.set('s1', 'a', 1);
    settings.set('s1', 'b', 2);
    expect(settings.getAll('s1')).toEqual({ a: 1, b: 2 });
  });

  it('should return empty object for unknown session', () => {
    expect(settings.getAll('nope')).toEqual({});
  });

  it('should clear session settings', () => {
    settings.set('s1', 'a', 1);
    settings.clear('s1');
    expect(settings.get('s1', 'a')).toBeUndefined();
  });
});

// ─── Update Channel Manager ──────────────────────────────────────

describe('UpdateChannelManager', () => {
  let mgr: UpdateChannelManager;

  beforeEach(() => {
    UpdateChannelManager.resetInstance();
    mgr = UpdateChannelManager.getInstance();
  });

  it('should default to stable channel', () => {
    expect(mgr.getCurrentChannel()).toBe('stable');
  });

  it('should set valid channel', () => {
    mgr.setChannel('beta');
    expect(mgr.getCurrentChannel()).toBe('beta');
  });

  it('should throw on invalid channel', () => {
    expect(() => mgr.setChannel('nightly')).toThrow('Invalid channel');
  });

  it('should validate channels', () => {
    expect(mgr.isValidChannel('stable')).toBe(true);
    expect(mgr.isValidChannel('nope')).toBe(false);
  });

  it('should return latest version info', () => {
    const info = mgr.getLatestVersion('beta');
    expect(info.channel).toBe('beta');
    expect(info.version).toContain('beta');
  });
});

// ─── Elevated Mode Manager ───────────────────────────────────────

describe('ElevatedModeManager', () => {
  let emm: ElevatedModeManager;

  beforeEach(() => {
    ElevatedModeManager.resetInstance();
    emm = ElevatedModeManager.getInstance();
  });

  it('should default to not elevated', () => {
    expect(emm.isElevated()).toBe(false);
  });

  it('should enable and disable', () => {
    emm.enable();
    expect(emm.isElevated()).toBe(true);
    emm.disable();
    expect(emm.isElevated()).toBe(false);
  });

  it('should toggle and return new state', () => {
    const result = emm.toggle();
    expect(result).toBe(true);
    expect(emm.isElevated()).toBe(true);
  });

  it('should return warning message', () => {
    expect(emm.getWarning()).toContain('WARNING');
  });
});

// ─── OSC8 Hyperlink ──────────────────────────────────────────────

describe('OSC8Hyperlink', () => {
  it('should create OSC-8 hyperlink', () => {
    const link = OSC8Hyperlink.create('https://example.com', 'Click');
    expect(link).toContain('https://example.com');
    expect(link).toContain('Click');
    expect(link).toContain('\x1b]8;;');
  });

  it('should strip OSC-8 sequences', () => {
    const link = OSC8Hyperlink.create('https://example.com', 'Click');
    const stripped = OSC8Hyperlink.stripLinks(link);
    expect(stripped).toBe('Click');
  });

  it('should detect supported terminals', () => {
    const origTerm = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = 'iTerm.app';
    expect(OSC8Hyperlink.isSupported()).toBe(true);
    process.env.TERM_PROGRAM = origTerm;
  });
});

// ─── Lobster Palette ─────────────────────────────────────────────

describe('LobsterPalette', () => {
  let palette: LobsterPalette;

  beforeEach(() => {
    LobsterPalette.resetInstance();
    palette = LobsterPalette.getInstance();
  });

  it('should have correct accent color', () => {
    expect(palette.accent).toBe('#FF5A2D');
  });

  it('should get color by name', () => {
    expect(palette.getColor('success')).toBe('#2FBF71');
  });

  it('should return undefined for unknown color', () => {
    expect(palette.getColor('rainbow')).toBeUndefined();
  });

  it('should apply ANSI color', () => {
    const colored = palette.applyAnsi('hello', 'error');
    expect(colored).toContain('\x1b[38;2;');
    expect(colored).toContain('hello');
    expect(colored).toContain('\x1b[0m');
  });

  it('should return plain text for unknown color name', () => {
    expect(palette.applyAnsi('text', 'unknown')).toBe('text');
  });

  it('should return all colors', () => {
    const colors = palette.getAllColors();
    expect(Object.keys(colors)).toEqual(['accent', 'success', 'warning', 'error', 'info', 'dim']);
  });
});

// ─── Verbose Mode ────────────────────────────────────────────────

describe('VerboseMode', () => {
  let verbose: VerboseMode;

  beforeEach(() => {
    VerboseMode.resetInstance();
    verbose = VerboseMode.getInstance();
  });

  it('should default to disabled', () => {
    expect(verbose.isEnabled()).toBe(false);
  });

  it('should enable and disable', () => {
    verbose.enable();
    expect(verbose.isEnabled()).toBe(true);
    verbose.disable();
    expect(verbose.isEnabled()).toBe(false);
  });

  it('should toggle', () => {
    expect(verbose.toggle()).toBe(true);
    expect(verbose.toggle()).toBe(false);
  });
});

// ─── Sender Policy Manager ──────────────────────────────────────

describe('SenderPolicyManager', () => {
  let mgr: SenderPolicyManager;

  beforeEach(() => {
    SenderPolicyManager.resetInstance();
    mgr = SenderPolicyManager.getInstance();
  });

  it('should add and retrieve policy', () => {
    mgr.addPolicy({
      identity: { username: 'alice' },
      allowedTools: ['read_file'],
      deniedTools: [],
    });
    const policy = mgr.getPolicy({ username: 'alice' });
    expect(policy).toBeDefined();
    expect(policy!.allowedTools).toEqual(['read_file']);
  });

  it('should return undefined for unknown identity', () => {
    expect(mgr.getPolicy({ username: 'nobody' })).toBeUndefined();
  });

  it('should check tool allowed with allowlist', () => {
    mgr.addPolicy({
      identity: { userId: 'u1' },
      allowedTools: ['read_file'],
      deniedTools: [],
    });
    expect(mgr.isToolAllowed({ userId: 'u1' }, 'read_file')).toBe(true);
    expect(mgr.isToolAllowed({ userId: 'u1' }, 'bash')).toBe(false);
  });

  it('should check tool denied with denylist', () => {
    mgr.addPolicy({
      identity: { phone: '+1234' },
      allowedTools: [],
      deniedTools: ['bash'],
    });
    expect(mgr.isToolAllowed({ phone: '+1234' }, 'bash')).toBe(false);
    expect(mgr.isToolAllowed({ phone: '+1234' }, 'read_file')).toBe(true);
  });

  it('should allow all tools when no policy exists', () => {
    expect(mgr.isToolAllowed({ username: 'unknown' }, 'anything')).toBe(true);
  });

  it('should remove policy', () => {
    mgr.addPolicy({ identity: { username: 'bob' }, allowedTools: [], deniedTools: [] });
    expect(mgr.removePolicy({ username: 'bob' })).toBe(true);
    expect(mgr.getPolicy({ username: 'bob' })).toBeUndefined();
  });

  it('should list and clear policies', () => {
    mgr.addPolicy({ identity: { username: 'a' }, allowedTools: [], deniedTools: [] });
    mgr.addPolicy({ identity: { username: 'b' }, allowedTools: [], deniedTools: [] });
    expect(mgr.listPolicies()).toHaveLength(2);
    mgr.clearPolicies();
    expect(mgr.listPolicies()).toHaveLength(0);
  });
});

// ─── Agent List Tool ─────────────────────────────────────────────

describe('AgentListTool', () => {
  let tool: AgentListTool;

  beforeEach(() => {
    AgentListTool.resetInstance();
    tool = AgentListTool.getInstance();
  });

  it('should add and list agents', () => {
    tool.addAgent('coder', 'Writes code');
    expect(tool.listAgents()).toHaveLength(1);
    expect(tool.listAgents()[0].name).toBe('coder');
  });

  it('should get agent by name', () => {
    tool.addAgent('reviewer', 'Reviews PRs');
    expect(tool.getAgent('reviewer')?.description).toBe('Reviews PRs');
  });

  it('should remove agent', () => {
    tool.addAgent('temp', 'Temporary');
    expect(tool.removeAgent('temp')).toBe(true);
    expect(tool.getAgentCount()).toBe(0);
  });

  it('should return count', () => {
    tool.addAgent('a', 'Agent A');
    tool.addAgent('b', 'Agent B');
    expect(tool.getAgentCount()).toBe(2);
  });
});

// ─── Pre-Threshold Flusher ───────────────────────────────────────

describe('PreThresholdFlusher', () => {
  let flusher: PreThresholdFlusher;

  beforeEach(() => {
    PreThresholdFlusher.resetInstance();
    flusher = PreThresholdFlusher.getInstance();
  });

  it('should detect when flush is needed', () => {
    expect(flusher.shouldFlush(9000, 10000)).toBe(true);
    expect(flusher.shouldFlush(5000, 10000)).toBe(false);
  });

  it('should use custom threshold', () => {
    expect(flusher.shouldFlush(6000, 10000, 0.5)).toBe(true);
  });

  it('should flush and track count', () => {
    const result = flusher.flush({ messages: [], keyFacts: ['fact1'] });
    expect(result.flushed).toBe(true);
    expect(flusher.getFlushCount()).toBe(1);
  });

  it('should track last flush time', () => {
    expect(flusher.getLastFlushTime()).toBe(0);
    flusher.flush({ messages: [], keyFacts: [] });
    expect(flusher.getLastFlushTime()).toBeGreaterThan(0);
  });

  it('should return flush path', () => {
    expect(flusher.getFlushPath()).toContain('memory-flush');
  });
});

// ─── Memory Backend Manager ──────────────────────────────────────

describe('MemoryBackendManager', () => {
  let mgr: MemoryBackendManager;

  beforeEach(() => {
    MemoryBackendManager.resetInstance();
    mgr = MemoryBackendManager.getInstance();
  });

  it('should have default backend', () => {
    expect(mgr.listBackends()).toContain('default');
  });

  it('should register and retrieve custom backend', () => {
    const custom: MemoryBackend = {
      name: 'custom',
      search: () => [],
      index: () => {},
      clear: () => {},
    };
    mgr.registerBackend(custom);
    expect(mgr.getBackend('custom')).toBe(custom);
  });

  it('should set and get active backend', () => {
    mgr.setActiveBackend('default');
    expect(mgr.getActiveBackend().name).toBe('default');
  });

  it('should throw when setting unknown backend', () => {
    expect(() => mgr.setActiveBackend('nonexistent')).toThrow('not found');
  });

  it('should search with default backend', () => {
    const backend = mgr.getActiveBackend();
    backend.index([{ key: 'greeting', value: 'hello world' }]);
    const results = backend.search('hello');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].key).toBe('greeting');
  });

  it('should clear default backend', () => {
    const backend = mgr.getActiveBackend();
    backend.index([{ key: 'a', value: 'b' }]);
    backend.clear();
    expect(backend.search('b')).toHaveLength(0);
  });
});

// ─── Twitch Adapter ─────────────────────────────────────────────

describe('TwitchAdapter', () => {
  let adapter: TwitchAdapter;

  beforeEach(() => {
    adapter = new TwitchAdapter({ token: 'test' });
  });

  it('should start and stop', () => {
    adapter.start();
    expect(adapter.isRunning()).toBe(true);
    adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should send message when running', () => {
    adapter.start();
    const result = adapter.sendMessage('#general', 'hello');
    expect(result.sent).toBe(true);
  });

  it('should throw when sending while stopped', () => {
    expect(() => adapter.sendMessage('#general', 'hi')).toThrow('not running');
  });

  it('should join and leave channels', () => {
    adapter.joinChannel('#test');
    adapter.leaveChannel('#test');
  });

  it('should return config', () => {
    expect(adapter.getConfig()).toEqual({ token: 'test' });
  });
});

// ─── Tlon Adapter ────────────────────────────────────────────────

describe('TlonAdapter', () => {
  let adapter: TlonAdapter;

  beforeEach(() => {
    adapter = new TlonAdapter();
  });

  it('should start and stop', () => {
    adapter.start();
    expect(adapter.isRunning()).toBe(true);
    adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should send message', () => {
    adapter.start();
    const result = adapter.sendMessage('~zod', 'hello');
    expect(result.sent).toBe(true);
    expect(result.ship).toBe('~zod');
  });

  it('should throw when not running', () => {
    expect(() => adapter.sendMessage('~zod', 'hi')).toThrow('not running');
  });
});

// ─── Gmail Webhook Adapter ───────────────────────────────────────

describe('GmailWebhookAdapter', () => {
  let adapter: GmailWebhookAdapter;

  beforeEach(() => {
    adapter = new GmailWebhookAdapter();
  });

  it('should start and stop', () => {
    adapter.start();
    expect(adapter.isRunning()).toBe(true);
    adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('should get messages with limit', () => {
    adapter._addMessage('1', 'Hello');
    adapter._addMessage('2', 'World');
    expect(adapter.getMessages(1)).toHaveLength(1);
    expect(adapter.getMessages()).toHaveLength(2);
  });

  it('should mark message as read', () => {
    adapter._addMessage('1', 'Test');
    expect(adapter.markRead('1')).toBe(true);
    expect(adapter.markRead('nonexistent')).toBe(false);
  });
});

// ─── Docs Search Tool ────────────────────────────────────────────

describe('DocsSearchTool', () => {
  let docs: DocsSearchTool;

  beforeEach(() => {
    docs = new DocsSearchTool();
  });

  it('should search docs', () => {
    const results = docs.search('tools');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return empty for no match', () => {
    expect(docs.search('zyxwvut')).toHaveLength(0);
  });

  it('should list topics', () => {
    expect(docs.getTopics()).toContain('getting-started');
  });

  it('should get doc URL', () => {
    expect(docs.getDocUrl('tools')).toBe('/docs/tools');
    expect(docs.getDocUrl('nonexistent')).toBeUndefined();
  });
});
