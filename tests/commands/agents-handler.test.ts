/**
 * /agents slash handler tests (MultiAgentSystem wake — top 4 audit OpenClaw).
 *
 * Covers: action validation, status output, provider guard,
 * fire-and-forget run lifecycle (single workflow at a time), strategy
 * setter validation, stop/disable propagation.
 *
 * Mocks the MultiAgentSystem module entirely — no real LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Hoist mock targets so the vi.mock factory can reference them.
const mocks = vi.hoisted(() => {
  const runWorkflowMock = vi.fn();
  const stopMock = vi.fn();
  const disposeMock = vi.fn();
  const onMock = vi.fn();
  const listenerCountMock = vi.fn(() => 0);
  const removeAllListenersMock = vi.fn();

  const fakeSystem = {
    runWorkflow: runWorkflowMock,
    stop: stopMock,
    dispose: disposeMock,
    on: onMock,
    listenerCount: listenerCountMock,
    removeAllListeners: removeAllListenersMock,
  };

  const getMultiAgentSystemMock = vi.fn(() => fakeSystem);
  const resetMultiAgentSystemMock = vi.fn();

  // Phase F mocks
  const markTaskStartedMock = vi.fn();
  const recordTaskCompletionMock = vi.fn();
  const getPerformanceReportMock = vi.fn(() => '== Performance Report ==\n(empty — no workflows yet)');
  const getConflictsMock = vi.fn(() => []);
  // Phase L (V0.4) — getAgentMetrics returns null by default (no cost recorded)
  const getAgentMetricsMock = vi.fn(() => null);
  // Phase N (V0.4.1) — persistence introspection mocks
  const isPersistenceEnabledMock = vi.fn(() => false);
  const getMetricsSavedAtMock = vi.fn(() => null);
  const fakeCoordinator = {
    markTaskStarted: markTaskStartedMock,
    recordTaskCompletion: recordTaskCompletionMock,
    getPerformanceReport: getPerformanceReportMock,
    getConflicts: getConflictsMock,
    getAgentMetrics: getAgentMetricsMock,
    isPersistenceEnabled: isPersistenceEnabledMock,
    getMetricsSavedAt: getMetricsSavedAtMock,
  };
  const getEnhancedCoordinatorMock = vi.fn(() => fakeCoordinator);

  const getStatsMock = vi.fn(() => ({
    totalSessions: 0,
    activeSessions: 0,
    totalMessages: 0,
    byKind: { main: 0, channel: 0, cron: 0, hook: 0, spawn: 0, node: 0 },
  }));
  const fakeRegistry = { getStats: getStatsMock };
  const getSessionRegistryMock = vi.fn(() => fakeRegistry);

  return {
    runWorkflowMock, stopMock, disposeMock, onMock, listenerCountMock, removeAllListenersMock,
    fakeSystem, getMultiAgentSystemMock, resetMultiAgentSystemMock,
    markTaskStartedMock, recordTaskCompletionMock, getPerformanceReportMock, getConflictsMock,
    getAgentMetricsMock,
    isPersistenceEnabledMock, getMetricsSavedAtMock,
    fakeCoordinator, getEnhancedCoordinatorMock,
    getStatsMock, fakeRegistry, getSessionRegistryMock,
  };
});

const testPaths = vi.hoisted(() => ({ tmpHome: '' }));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => testPaths.tmpHome || actual.homedir() };
});

vi.mock('../../src/agent/multi-agent/multi-agent-system.js', () => ({
  getMultiAgentSystem: mocks.getMultiAgentSystemMock,
  resetMultiAgentSystem: mocks.resetMultiAgentSystemMock,
}));

vi.mock('../../src/agent/multi-agent/enhanced-coordination.js', () => ({
  getEnhancedCoordinator: mocks.getEnhancedCoordinatorMock,
}));

vi.mock('../../src/agent/multi-agent/session-registry.js', () => ({
  getSessionRegistry: mocks.getSessionRegistryMock,
}));

// Phase G — workflow persistence mocks
const persistenceMocks = vi.hoisted(() => ({
  saveWorkflowMock: vi.fn().mockResolvedValue(undefined),
  loadWorkflowMock: vi.fn().mockResolvedValue(null),
  clearWorkflowMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/agent/multi-agent/workflow-persistence.js', () => ({
  saveWorkflow: persistenceMocks.saveWorkflowMock,
  loadWorkflow: persistenceMocks.loadWorkflowMock,
  clearWorkflow: persistenceMocks.clearWorkflowMock,
}));

import { handleAgents, _resetAgentsHandlerForTests } from '../../src/commands/handlers/agents-handler.js';

const envKeysToReset = [
  'CODEBUDDY_PROVIDER',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'CHATGPT_MODEL',
];

function configureDefaultGrokProvider(): void {
  process.env.CODEBUDDY_PROVIDER = 'grok';
  process.env.GROK_API_KEY = 'test-key';
  process.env.GROK_MODEL = 'grok-3-latest';
}

function clearProviderEnv(): void {
  process.env.CODEBUDDY_PROVIDER = 'none';
  for (const key of envKeysToReset) {
    if (key !== 'CODEBUDDY_PROVIDER') delete process.env[key];
  }
}

function configureChatGptProvider(): void {
  process.env.CODEBUDDY_PROVIDER = 'chatgpt';
  const dir = path.join(testPaths.tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-access-token' } }),
  );
}

describe('handleAgents (/agents)', () => {
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    _resetAgentsHandlerForTests();
    envBackup = { ...process.env };
    for (const key of envKeysToReset) delete process.env[key];
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-handler-'));
    configureDefaultGrokProvider();
    mocks.runWorkflowMock.mockReset();
    mocks.stopMock.mockReset();
    mocks.disposeMock.mockReset();
    mocks.onMock.mockReset();
    mocks.listenerCountMock.mockReset().mockReturnValue(0);
    mocks.removeAllListenersMock.mockReset();
    mocks.getMultiAgentSystemMock.mockClear();
    mocks.resetMultiAgentSystemMock.mockClear();
    mocks.markTaskStartedMock.mockReset();
    mocks.recordTaskCompletionMock.mockReset();
    mocks.getPerformanceReportMock.mockReset().mockReturnValue('== Performance Report ==\n(empty — no workflows yet)');
    mocks.getConflictsMock.mockReset().mockReturnValue([]);
    mocks.getAgentMetricsMock.mockReset().mockReturnValue(null);
    mocks.getEnhancedCoordinatorMock.mockClear();
    mocks.getStatsMock.mockReset().mockReturnValue({
      totalSessions: 0,
      activeSessions: 0,
      totalMessages: 0,
      byKind: { main: 0, channel: 0, cron: 0, hook: 0, spawn: 0, node: 0 },
    });
    mocks.getSessionRegistryMock.mockClear();
    persistenceMocks.saveWorkflowMock.mockReset().mockResolvedValue(undefined);
    persistenceMocks.loadWorkflowMock.mockReset().mockResolvedValue(null);
    persistenceMocks.clearWorkflowMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    _resetAgentsHandlerForTests();
    process.env = envBackup;
    fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
    testPaths.tmpHome = '';
  });

  it('rejects unknown action with help text', async () => {
    const r = await handleAgents(['lol']);
    expect(r.entry?.content).toContain('Unknown agents action');
    expect(r.entry?.content).toContain('Usage: /agents');
  });

  it('shows help when action is "help"', async () => {
    const r = await handleAgents(['help']);
    expect(r.entry?.content).toContain('Usage: /agents');
    expect(r.entry?.content).toContain('run <goal>');
    expect(r.entry?.content).toContain('plan <goal>');
    expect(r.entry?.content).toContain('strategy <name>');
  });

  it('defaults to status when no action provided', async () => {
    const r = await handleAgents([]);
    expect(r.entry?.content).toContain('Multi-Agent System Status');
    expect(r.entry?.content).toContain('Enabled:');
    expect(r.entry?.content).toContain('Default strategy:');
  });

  it('status shows hierarchical as default strategy initially', async () => {
    const r = await handleAgents(['status']);
    expect(r.entry?.content).toMatch(/Default strategy:\s+hierarchical/);
  });

  it('enable instantiates the singleton', async () => {
    const r = await handleAgents(['enable']);
    expect(r.entry?.content).toContain('Multi-agent system started');
    expect(mocks.getMultiAgentSystemMock.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'test-key',
      'https://api.x.ai/v1',
    ]);

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toMatch(/Enabled:\s+yes/);
  });

  it('enable is idempotent', async () => {
    await handleAgents(['enable']);
    const r = await handleAgents(['enable']);
    expect(r.entry?.content).toContain('already enabled');
  });

  it('enable without a detected provider returns clear error', async () => {
    clearProviderEnv();
    const r = await handleAgents(['enable']);
    expect(r.entry?.content).toContain('no LLM provider configured');
  });

  it('enable uses ChatGPT Codex OAuth when detected', async () => {
    configureChatGptProvider();

    await handleAgents(['enable']);

    expect(mocks.getMultiAgentSystemMock.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
    ]);
  });

  it('disable resets the system when enabled', async () => {
    await handleAgents(['enable']);
    const r = await handleAgents(['disable']);
    expect(r.entry?.content).toContain('Multi-agent system stopped');
    expect(mocks.resetMultiAgentSystemMock).toHaveBeenCalled();

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toMatch(/Enabled:\s+no/);
  });

  it('disable stops the active workflow before resetting the system', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    await handleAgents(['run', 'goal-x']);
    const r = await handleAgents(['disable']);

    expect(r.entry?.content).toContain('Multi-agent system stopped');
    expect(mocks.stopMock).toHaveBeenCalled();
    expect(mocks.resetMultiAgentSystemMock).toHaveBeenCalled();
  });

  it('disable is a no-op when not enabled', async () => {
    const r = await handleAgents(['disable']);
    expect(r.entry?.content).toContain('not enabled');
  });

  it('strategy without arg returns usage', async () => {
    const r = await handleAgents(['strategy']);
    expect(r.entry?.content).toContain('Usage: /agents strategy <name>');
    expect(r.entry?.content).toContain('hierarchical');
  });

  it('strategy with invalid name returns clear error', async () => {
    const r = await handleAgents(['strategy', 'nonsense']);
    expect(r.entry?.content).toContain('Unknown strategy: nonsense');
  });

  it('strategy with valid name updates default', async () => {
    const r = await handleAgents(['strategy', 'parallel']);
    expect(r.entry?.content).toContain('Default strategy set to: parallel');

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toMatch(/Default strategy:\s+parallel/);
  });

  it('run without goal returns usage', async () => {
    const r = await handleAgents(['run']);
    expect(r.entry?.content).toContain('Usage: /agents run <goal>');
  });

  it('run launches fire-and-forget workflow and returns immediately', async () => {
    // Promise that never resolves during this test — simulates long-running workflow
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    const r = await handleAgents(['run', 'Add', 'a', 'hello', 'endpoint']);
    expect(r.entry?.content).toContain('Workflow started for: Add a hello endpoint');
    expect(r.entry?.content).toContain('Monitor with: /agents status');
    expect(mocks.runWorkflowMock).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkflowMock).toHaveBeenCalledWith('Add a hello endpoint', { strategy: 'hierarchical' });

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toContain('ACTIVE WORKFLOW');
    expect(status.entry?.content).toContain('Add a hello endpoint');
  });

  it('second run while one is active is refused', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    await handleAgents(['run', 'goal-1']);
    const r = await handleAgents(['run', 'goal-2']);
    expect(r.entry?.content).toContain('already in progress');
    expect(r.entry?.content).toContain('goal-1');
    expect(mocks.runWorkflowMock).toHaveBeenCalledTimes(1);
  });

  it('stop after run cancels active workflow', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    await handleAgents(['run', 'goal-x']);
    const r = await handleAgents(['stop']);
    expect(r.entry?.content).toContain('Workflow stopped: goal-x');
    expect(mocks.stopMock).toHaveBeenCalled();

    const status = await handleAgents(['status']);
    expect(status.entry?.content).toContain('Active workflow:   (none)');
  });

  it('stop targets the launched workflow even if provider env disappears', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));

    await handleAgents(['run', 'goal-x']);
    const callsBeforeStop = mocks.getMultiAgentSystemMock.mock.calls.length;
    clearProviderEnv();

    const r = await handleAgents(['stop']);

    expect(r.entry?.content).toContain('Workflow stopped: goal-x');
    expect(mocks.stopMock).toHaveBeenCalled();
    expect(mocks.getMultiAgentSystemMock.mock.calls.length).toBe(callsBeforeStop);
  });

  it('stop without active workflow is a no-op', async () => {
    const r = await handleAgents(['stop']);
    expect(r.entry?.content).toContain('No active workflow to stop');
  });

  it('plan without goal returns usage', async () => {
    const r = await handleAgents(['plan']);
    expect(r.entry?.content).toContain('Usage: /agents plan <goal>');
  });

  it('plan with goal calls runWorkflow dryRun and returns plan text', async () => {
    mocks.runWorkflowMock.mockResolvedValue({
      success: true,
      plan: {
        phases: [
          { name: 'Phase 1', tasks: [{ description: 'Read existing code' }, { description: 'Write spec' }] },
          { name: 'Phase 2', tasks: [{ description: 'Implement endpoint' }] },
        ],
      },
      results: new Map(),
      artifacts: [],
      timeline: [],
      totalDuration: 1234,
      summary: 'Plan generated',
      errors: [],
    });

    const r = await handleAgents(['plan', 'Add', 'endpoint']);
    expect(mocks.runWorkflowMock).toHaveBeenCalledWith('Add endpoint', expect.objectContaining({ dryRun: true }));
    expect(r.entry?.content).toContain('Plan for: Add endpoint');
    expect(r.entry?.content).toContain('Phase 1: Phase 1');
    expect(r.entry?.content).toContain('Read existing code');
    expect(r.entry?.content).toContain('Phase 2');
  });

  it('action is case-insensitive', async () => {
    const r = await handleAgents(['ENABLE']);
    expect(r.entry?.content).toContain('Multi-agent system started');
  });

  // ────────────────────────────────────────────────────────────
  // Phase F — EnhancedCoordinator + SessionRegistry actions
  // ────────────────────────────────────────────────────────────

  it('metrics returns coordinator performance report (no apiKey needed)', async () => {
    clearProviderEnv();
    const r = await handleAgents(['metrics']);
    expect(r.entry?.content).toContain('Performance Report');
    expect(mocks.getEnhancedCoordinatorMock).toHaveBeenCalled();
    expect(mocks.getPerformanceReportMock).toHaveBeenCalled();
  });

  it('metrics shows cost breakdown when agents have totalCostUsd > 0 (Phase L)', async () => {
    mocks.getAgentMetricsMock.mockImplementation((role: string) => {
      if (role === 'coder') return { role, totalCostUsd: 0.42, avgCostPerTask: 0.21, totalTasks: 2 };
      if (role === 'reviewer') return { role, totalCostUsd: 0.15, avgCostPerTask: 0.15, totalTasks: 1 };
      return null;
    });
    const r = await handleAgents(['metrics']);
    expect(r.entry?.content).toContain('Cost Breakdown (V0.4 Phase L)');
    expect(r.entry?.content).toContain('coder');
    expect(r.entry?.content).toContain('$0.4200');
    expect(r.entry?.content).toContain('reviewer');
    expect(r.entry?.content).toContain('total $0.5700');
  });

  it('metrics shows "no cost recorded yet" hint when no cost data', async () => {
    mocks.getAgentMetricsMock.mockReturnValue({ totalCostUsd: 0, avgCostPerTask: 0, totalTasks: 0 });
    const r = await handleAgents(['metrics']);
    expect(r.entry?.content).toContain('no cost recorded yet');
    expect(r.entry?.content).toContain('max_workflow_cost_usd');
  });

  it('conflicts returns empty message + Phase H V0.3 hint when none detected', async () => {
    clearProviderEnv();
    const r = await handleAgents(['conflicts']);
    expect(r.entry?.content).toContain('No conflicts detected');
    // Phase H rewrote the empty-state message to point at the new V0.3 wiring
    expect(r.entry?.content).toContain('Phase H');
    expect(r.entry?.content).toContain('detectConflicts');
  });

  it('conflicts returns formatted list when coordinator has some', async () => {
    mocks.getConflictsMock.mockReturnValue([
      { id: 'c1', type: 'code_overlap', severity: 'high', agents: ['coder', 'reviewer'], description: 'Both editing auth.ts', resolution: undefined, detectedAt: new Date() },
    ] as never);
    const r = await handleAgents(['conflicts']);
    expect(r.entry?.content).toContain('Detected conflicts (1)');
    expect(r.entry?.content).toContain('code_overlap');
    expect(r.entry?.content).toContain('Both editing auth.ts');
  });

  it('sessions returns registry stats (no apiKey needed)', async () => {
    clearProviderEnv();
    const r = await handleAgents(['sessions']);
    expect(r.entry?.content).toContain('Session Registry Stats');
    expect(r.entry?.content).toContain('Total sessions:   0');
    expect(r.entry?.content).toContain('sessions_spawn');
    expect(mocks.getSessionRegistryMock).toHaveBeenCalled();
  });

  it('enable wires coordinator to MAS workflow events', async () => {
    await handleAgents(['enable']);
    expect(mocks.onMock).toHaveBeenCalledWith('workflow:event', expect.any(Function));
  });

  it('coordinator wiring is idempotent across multiple enable/run calls', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));
    await handleAgents(['enable']);
    await handleAgents(['run', 'goal-1']);
    await handleAgents(['stop']);
    await handleAgents(['run', 'goal-2']);
    // getEnhancedCoordinator is the actual gate for "did we wire?" — once
    // wired, the helper short-circuits via the coordinatorWired flag.
    // (system.on() is now also called by Phase G persistence per-run, so
    // counting `on` calls would be misleading.)
    expect(mocks.getEnhancedCoordinatorMock).toHaveBeenCalledTimes(1);
  });

  it('wired listener routes task_completed events into recordTaskCompletion', async () => {
    await handleAgents(['enable']);
    expect(mocks.onMock).toHaveBeenCalledTimes(1);
    const [, listener] = mocks.onMock.mock.calls[0] as [string, (e: unknown) => void];

    listener({
      type: 'task_completed',
      data: {
        task: { id: 't1', assignedTo: 'coder' },
        result: { success: true, role: 'coder', duration: 100, rounds: 2 },
      },
    });

    expect(mocks.recordTaskCompletionMock).toHaveBeenCalledOnce();
    expect(mocks.recordTaskCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      expect.objectContaining({ success: true, role: 'coder' })
    );
  });

  it('wired listener routes task_started events into markTaskStarted', async () => {
    await handleAgents(['enable']);
    const [, listener] = mocks.onMock.mock.calls[0] as [string, (e: unknown) => void];

    listener({
      type: 'task_started',
      data: { task: { id: 't2', assignedTo: 'orchestrator' } },
    });

    expect(mocks.markTaskStartedMock).toHaveBeenCalledOnce();
    expect(mocks.markTaskStartedMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2' }),
      'orchestrator'
    );
  });

  it('wired listener ignores irrelevant event types', async () => {
    await handleAgents(['enable']);
    const [, listener] = mocks.onMock.mock.calls[0] as [string, (e: unknown) => void];

    listener({ type: 'phase_started', data: { phase: 'planning' } });

    expect(mocks.recordTaskCompletionMock).not.toHaveBeenCalled();
    expect(mocks.markTaskStartedMock).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Phase G — Workflow persistence + /agents resume
  // ────────────────────────────────────────────────────────────

  it('run saves workflow state to disk on launch', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));
    await handleAgents(['run', 'persisted goal']);
    expect(persistenceMocks.saveWorkflowMock).toHaveBeenCalled();
    const firstCall = persistenceMocks.saveWorkflowMock.mock.calls[0][0];
    expect(firstCall).toMatchObject({
      goal: 'persisted goal',
      status: 'running',
      strategy: 'hierarchical',
    });
  });

  it('resume returns no-workflow message when nothing persisted', async () => {
    persistenceMocks.loadWorkflowMock.mockResolvedValueOnce(null);
    const r = await handleAgents(['resume']);
    expect(r.entry?.content).toContain('No interrupted workflow');
  });

  it('resume reports completed workflows as already-finished', async () => {
    persistenceMocks.loadWorkflowMock.mockResolvedValueOnce({
      goal: 'old goal',
      startedAt: '2026-05-02T10:00:00Z',
      strategy: 'hierarchical',
      status: 'completed',
      plan: null,
      results: [],
      artifacts: [],
      timeline: [],
      errors: [],
      summary: 'all done',
    });
    const r = await handleAgents(['resume']);
    expect(r.entry?.content).toContain('already finished');
    expect(r.entry?.content).toContain('completed');
    expect(r.entry?.content).toContain('all done');
  });

  it('resume refuses when an active workflow is in progress', async () => {
    persistenceMocks.loadWorkflowMock.mockResolvedValue({
      goal: 'old goal',
      startedAt: '2026-05-02T10:00:00Z',
      strategy: 'hierarchical',
      status: 'running',
      plan: null,
      results: [],
      artifacts: [],
      timeline: [],
      errors: [],
    });
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));
    await handleAgents(['run', 'active goal']);
    const r = await handleAgents(['resume']);
    expect(r.entry?.content).toContain('Cannot resume');
    expect(r.entry?.content).toContain('active goal');
  });

  it('resume actually re-launches workflow with resumeFrom (Phase J V0.3)', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));
    persistenceMocks.loadWorkflowMock.mockResolvedValue({
      goal: 'interrupted goal',
      startedAt: '2026-05-02T10:00:00Z',
      strategy: 'parallel',
      status: 'running',
      schemaVersion: 'v0.3',
      completedTaskIds: ['t1', 't2'],
      plan: null,
      results: [
        ['t1', { success: true, role: 'coder' }] as never,
        ['t2', { success: true, role: 'reviewer' }] as never,
      ],
      artifacts: [],
      timeline: [],
      errors: [],
    });
    const r = await handleAgents(['resume']);
    expect(r.entry?.content).toContain('Resuming interrupted workflow');
    expect(r.entry?.content).toContain('interrupted goal');
    expect(r.entry?.content).toContain('Tasks to skip:     2');
    expect(r.entry?.content).toContain('Schema version:    v0.3');

    // Critical: runWorkflow was called with resumeFrom
    expect(mocks.runWorkflowMock).toHaveBeenCalledOnce();
    const [goalArg, optsArg] = mocks.runWorkflowMock.mock.calls[0] as [string, { strategy: string; resumeFrom: { completedTaskIds: string[] } }];
    expect(goalArg).toBe('interrupted goal');
    expect(optsArg.strategy).toBe('parallel');
    expect(optsArg.resumeFrom.completedTaskIds).toEqual(['t1', 't2']);
  });

  it('resume on v0.1 (migrated) save still works — derives completedTaskIds from results', async () => {
    mocks.runWorkflowMock.mockImplementation(() => new Promise(() => { /* never */ }));
    persistenceMocks.loadWorkflowMock.mockResolvedValue({
      goal: 'old v0.1 workflow',
      startedAt: '2026-05-02T10:00:00Z',
      strategy: 'sequential',
      status: 'running',
      schemaVersion: 'v0.1',  // pre-Phase-J save
      // completedTaskIds derived by loadWorkflow migration → present here
      completedTaskIds: ['old-t1'],
      plan: null,
      results: [['old-t1', { success: true, role: 'coder' }] as never],
      artifacts: [],
      timeline: [],
      errors: [],
    });
    const r = await handleAgents(['resume']);
    expect(r.entry?.content).toContain('v0.1');
    expect(r.entry?.content).toContain('Tasks to skip:     1');
    expect(mocks.runWorkflowMock).toHaveBeenCalledOnce();
  });
});
