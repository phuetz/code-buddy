/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuditLogViewer } from '../src/renderer/components/AuditLogViewer';
import { useAppStore } from '../src/renderer/store';

vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: string) => fallback ?? key;
  return {
    useTranslation: () => ({ t }),
  };
});

vi.mock('../src/renderer/utils/i18n-format', () => ({
  formatAppDateTime: (value: number) => new Date(value).toISOString(),
  formatAppNumber: (value: number) => String(value),
  formatAppTime: (value: number) => new Date(value).toISOString(),
  joinAppList: (values: string[]) => values.join(', '),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AuditLogViewer run recall', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    Reflect.deleteProperty(navigator, 'clipboard');
    useAppStore.setState({
      workingDir: null,
      fleetGoalDraft: null,
      showFleetCommandCenter: false,
    });
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('searches run summaries/events/artifacts through the Cowork audit bridge', async () => {
    const listRuns = vi.fn().mockResolvedValue([
      {
        runId: 'run_hermes',
        objective: 'Hermes candidate queue',
        status: 'completed',
        startedAt: 1_779_129_600_000,
        endedAt: 1_779_129_601_000,
        durationMs: 1_000,
        eventCount: 3,
        artifactCount: 1,
        channel: 'cowork',
        tags: ['fleet'],
        toolCallCount: 2,
        totalCost: 0,
        totalTokens: 120,
      },
    ]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T18:42:00.000Z',
      query: 'candidate queue',
      filters: { limit: 50, sources: [] },
      count: 1,
      results: [
        {
          runId: 'run_hermes',
          objective: 'Hermes candidate queue',
          status: 'completed',
          startedAt: 1_779_129_600_000,
          matched: 'artifact',
          score: 91,
          snippet: 'candidate queue artifact for Cowork review',
          artifact: 'summary.md',
          source: 'cowork',
        },
      ],
    });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'cowork' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(listRuns).toHaveBeenLastCalledWith({
      limit: 50,
      sources: ['cowork'],
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'candidate queue' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(searchRuns).toHaveBeenCalledWith({
      query: 'candidate queue',
      limit: 50,
      sources: ['cowork'],
    });
    expect(target.textContent).toContain('Hermes candidate queue');
    expect(target.textContent).toContain('summary.md: candidate queue artifact for Cowork review');
  });

  it('copies a redacted trajectory export from an expanded run', async () => {
    const listRuns = vi.fn().mockResolvedValue([
      {
        runId: 'run_trajectory',
        objective: 'Hermes trajectory export',
        status: 'completed',
        startedAt: 1_779_132_000_000,
        endedAt: 1_779_132_001_000,
        durationMs: 1_000,
        eventCount: 3,
        artifactCount: 1,
        channel: 'cowork',
        tags: ['fleet'],
        toolCallCount: 1,
        totalCost: 0,
        totalTokens: 120,
      },
    ]);
    const getRunDetail = vi.fn().mockResolvedValue({
      runId: 'run_trajectory',
      objective: 'Hermes trajectory export',
      status: 'completed',
      startedAt: 1_779_132_000_000,
      endedAt: 1_779_132_001_000,
      durationMs: 1_000,
      eventCount: 3,
      artifactCount: 1,
      channel: 'cowork',
      tags: ['fleet'],
      toolCallCount: 1,
      totalCost: 0,
      totalTokens: 120,
      events: [
        {
          ts: 1_779_132_000_010,
          type: 'tool_call',
          runId: 'run_trajectory',
          data: { toolName: 'web_search' },
        },
      ],
      metrics: {},
      artifacts: ['summary.md'],
      proofLedger: {
        schemaVersion: 1,
        generatedAt: '2026-05-19T01:22:00.000Z',
        kind: 'proof_ledger_entry',
        status: 'proven',
        summary: 'Completed with 1 recorded verification command and 1 supporting artifact.',
        privacy: {
          artifactContentIncluded: false,
          redaction: 'secrets-redacted',
          redactionCount: 0,
        },
        tests: {
          failed: 0,
          passed: 1,
          total: 1,
        },
        artifacts: [{ kind: 'summary', name: 'summary.md' }],
        filesChanged: ['src/observability/proof-ledger.ts'],
        risks: [],
      },
    });
    const buildTrajectoryExport = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-19T01:20:00.000Z',
      kind: 'run_trajectory_export',
      mode: 'redacted_review_export',
      run: {
        artifactCount: 1,
        eventCount: 3,
        objective: 'Hermes trajectory export',
        runId: 'run_trajectory',
        startedAt: 1_779_132_000_000,
        status: 'completed',
        tags: ['fleet'],
      },
      privacy: {
        artifactContentIncluded: false,
        redaction: 'secrets-redacted',
        redactionCount: 1,
      },
      prompt: {
        sources: ['summary.objective'],
        text: 'Hermes trajectory export',
      },
      selectedContext: [],
      toolCalls: [{ sequence: 1, toolName: 'web_search' }],
      toolResults: [],
      artifacts: [{ name: 'summary.md' }],
      events: [{ sequence: 1, type: 'tool_call' }],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          buildTrajectoryExport: typeof buildTrajectoryExport;
          getRunDetail: typeof getRunDetail;
          listRuns: typeof listRuns;
        };
      };
    }).electronAPI = {
      audit: {
        buildTrajectoryExport,
        getRunDetail,
        listRuns,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const rowButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Hermes trajectory export')
    ) as HTMLButtonElement | undefined;
    expect(rowButton).toBeDefined();

    await act(async () => {
      rowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(target.textContent).toContain('Proof ledger');
    expect(target.textContent).toContain('proven');
    expect(target.textContent).toContain('Tests: 1 / 1');
    expect(target.textContent).toContain('src/observability/proof-ledger.ts');

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy trajectory')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getRunDetail).toHaveBeenCalledWith('run_trajectory');
    expect(buildTrajectoryExport).toHaveBeenCalledWith({
      includeArtifactContent: false,
      maxArtifactBytes: 4000,
      maxEventValueBytes: 2000,
      runId: 'run_trajectory',
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"kind": "run_trajectory_export"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"redaction": "secrets-redacted"'));
    expect(target.textContent).toContain('Trajectory copied');
  });

  it('copies a policy eval report from an expanded run', async () => {
    const listRuns = vi.fn().mockResolvedValue([
      {
        runId: 'run_policy',
        objective: 'Hermes policy eval',
        status: 'completed',
        startedAt: 1_779_134_000_000,
        endedAt: 1_779_134_001_000,
        durationMs: 1_000,
        eventCount: 3,
        artifactCount: 1,
        channel: 'cowork',
        tags: ['profile:safe'],
        toolCallCount: 1,
        totalCost: 0,
        totalTokens: 120,
      },
    ]);
    const getRunDetail = vi.fn().mockResolvedValue({
      runId: 'run_policy',
      objective: 'Hermes policy eval',
      status: 'completed',
      startedAt: 1_779_134_000_000,
      endedAt: 1_779_134_001_000,
      durationMs: 1_000,
      eventCount: 3,
      artifactCount: 1,
      channel: 'cowork',
      tags: ['profile:safe'],
      toolCallCount: 1,
      totalCost: 0,
      totalTokens: 120,
      events: [],
      metrics: {},
      artifacts: ['source-evidence.md'],
    });
    const buildPolicyEvalReport = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-19T01:55:00.000Z',
      kind: 'policy_eval_report',
      mode: 'redacted_trajectory_policy_eval',
      runId: 'run_policy',
      summary: {
        failed: 0,
        passed: 1,
        total: 1,
      },
      safety: {
        mutationDisabled: true,
        readOnly: true,
        toolReplay: false,
      },
      trajectory: {
        artifactContentIncluded: true,
        kind: 'run_trajectory_export',
        redaction: 'secrets-redacted',
        toolFilterBlocks: [
          {
            reason: 'Tool "create_file" is disabled by the active tool filter and was not executed.',
            sequence: 2,
            source: 'active_tool_filter',
            toolCallId: 'call_filtered',
            toolName: 'create_file',
          },
        ],
      },
      results: [
        {
          schemaVersion: 1,
          generatedAt: '2026-05-19T01:55:00.000Z',
          kind: 'policy_eval_result',
          passed: true,
          policy: {
            id: 'safe-profile-no-mutation',
            title: 'Safe profile cannot mutate files',
          },
          results: [
            {
              assertionId: 'no-mutation-tools',
              passed: true,
              reason: 'No forbidden tool was used.',
            },
          ],
          runId: 'run_policy',
        },
      ],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          buildPolicyEvalReport: typeof buildPolicyEvalReport;
          getRunDetail: typeof getRunDetail;
          listRuns: typeof listRuns;
        };
      };
    }).electronAPI = {
      audit: {
        buildPolicyEvalReport,
        getRunDetail,
        listRuns,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const rowButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Hermes policy eval')
    ) as HTMLButtonElement | undefined;
    expect(rowButton).toBeDefined();

    await act(async () => {
      rowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy policy eval')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getRunDetail).toHaveBeenCalledWith('run_policy');
    expect(buildPolicyEvalReport).toHaveBeenCalledWith({
      maxArtifactBytes: 8000,
      runId: 'run_policy',
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"kind": "policy_eval_report"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"toolReplay": false'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"toolFilterBlocks"'));
    expect(target.textContent).toContain('Policy eval copied');
    expect(target.textContent).toContain('Evaluation report summary');
    expect(target.textContent).toContain('Policy guardrails');
    expect(target.textContent).toContain('Passed: 1 / 1');
    expect(target.textContent).toContain('Filtered tool blocks: 1');
    expect(target.textContent).toContain('create_file');
    expect(target.textContent).toContain('read-only');
  });

  it('copies a golden workflow eval report from an expanded run', async () => {
    const listRuns = vi.fn().mockResolvedValue([
      {
        runId: 'run_golden',
        objective: 'Hermes golden eval',
        status: 'completed',
        startedAt: 1_779_134_000_000,
        endedAt: 1_779_134_001_000,
        durationMs: 1_000,
        eventCount: 3,
        artifactCount: 1,
        channel: 'cowork',
        tags: ['fleet'],
        toolCallCount: 1,
        totalCost: 0,
        totalTokens: 120,
      },
    ]);
    const getRunDetail = vi.fn().mockResolvedValue({
      runId: 'run_golden',
      objective: 'Hermes golden eval',
      status: 'completed',
      startedAt: 1_779_134_000_000,
      endedAt: 1_779_134_001_000,
      durationMs: 1_000,
      eventCount: 3,
      artifactCount: 1,
      channel: 'cowork',
      tags: ['fleet'],
      toolCallCount: 1,
      totalCost: 0,
      totalTokens: 120,
      events: [],
      metrics: {},
      artifacts: ['document-workshop.docx'],
    });
    const buildGoldenWorkflowEvalReport = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-19T02:30:00.000Z',
      kind: 'golden_workflow_eval_report',
      mode: 'redacted_trajectory_golden_eval',
      runId: 'run_golden',
      summary: {
        failed: 0,
        passed: 1,
        total: 1,
      },
      safety: {
        mutationDisabled: true,
        readOnly: true,
        toolReplay: false,
      },
      trajectory: {
        artifactContentIncluded: true,
        kind: 'run_trajectory_export',
        redaction: 'secrets-redacted',
      },
      results: [
        {
          schemaVersion: 1,
          generatedAt: '2026-05-19T02:30:00.000Z',
          kind: 'golden_workflow_eval_result',
          passed: true,
          fixture: {
            id: 'doc-workshop',
            title: 'Document workshop',
          },
          results: [
            {
              assertionId: 'document-artifact',
              passed: true,
              reason: 'Found artifact: document-workshop.docx',
            },
          ],
          runId: 'run_golden',
        },
      ],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          buildGoldenWorkflowEvalReport: typeof buildGoldenWorkflowEvalReport;
          getRunDetail: typeof getRunDetail;
          listRuns: typeof listRuns;
        };
      };
    }).electronAPI = {
      audit: {
        buildGoldenWorkflowEvalReport,
        getRunDetail,
        listRuns,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const rowButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Hermes golden eval')
    ) as HTMLButtonElement | undefined;
    expect(rowButton).toBeDefined();

    await act(async () => {
      rowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy golden eval')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getRunDetail).toHaveBeenCalledWith('run_golden');
    expect(buildGoldenWorkflowEvalReport).toHaveBeenCalledWith({
      maxArtifactBytes: 8000,
      runId: 'run_golden',
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"kind": "golden_workflow_eval_report"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"toolReplay": false'));
    expect(target.textContent).toContain('Golden eval copied');
    expect(target.textContent).toContain('Evaluation report summary');
    expect(target.textContent).toContain('Golden workflow');
    expect(target.textContent).toContain('Passed: 1 / 1');
    expect(target.textContent).toContain('Document workshop');
  });

  it('reviews eval report summaries from an expanded run without clipboard', async () => {
    const listRuns = vi.fn().mockResolvedValue([
      {
        runId: 'run_eval_review',
        objective: 'Hermes eval cockpit',
        status: 'completed',
        startedAt: 1_779_134_000_000,
        endedAt: 1_779_134_001_000,
        durationMs: 1_000,
        eventCount: 3,
        artifactCount: 1,
        channel: 'cowork',
        tags: ['fleet', 'profile:safe'],
        toolCallCount: 1,
        totalCost: 0,
        totalTokens: 120,
      },
    ]);
    const getRunDetail = vi.fn().mockResolvedValue({
      runId: 'run_eval_review',
      objective: 'Hermes eval cockpit',
      status: 'completed',
      startedAt: 1_779_134_000_000,
      endedAt: 1_779_134_001_000,
      durationMs: 1_000,
      eventCount: 3,
      artifactCount: 1,
      channel: 'cowork',
      tags: ['fleet', 'profile:safe'],
      toolCallCount: 1,
      totalCost: 0,
      totalTokens: 120,
      events: [],
      metrics: {},
      artifacts: ['source-evidence.md'],
    });
    const buildGoldenWorkflowEvalReport = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-19T03:05:00.000Z',
      kind: 'golden_workflow_eval_report',
      mode: 'redacted_trajectory_golden_eval',
      runId: 'run_eval_review',
      summary: {
        failed: 0,
        passed: 1,
        total: 1,
      },
      safety: {
        mutationDisabled: true,
        readOnly: true,
        toolReplay: false,
      },
      trajectory: {
        artifactContentIncluded: true,
        kind: 'run_trajectory_export',
        redaction: 'secrets-redacted',
      },
      results: [
        {
          schemaVersion: 1,
          generatedAt: '2026-05-19T03:05:00.000Z',
          kind: 'golden_workflow_eval_result',
          passed: true,
          fixture: {
            id: 'lead-discovery',
            title: 'Lead discovery with public sources',
          },
          results: [
            {
              assertionId: 'source-url',
              passed: true,
              reason: 'Public source URLs preserved.',
            },
          ],
          runId: 'run_eval_review',
        },
      ],
    });
    const buildPolicyEvalReport = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-19T03:05:00.000Z',
      kind: 'policy_eval_report',
      mode: 'redacted_trajectory_policy_eval',
      runId: 'run_eval_review',
      summary: {
        failed: 0,
        passed: 1,
        total: 1,
      },
      safety: {
        mutationDisabled: true,
        readOnly: true,
        toolReplay: false,
      },
      trajectory: {
        artifactContentIncluded: true,
        kind: 'run_trajectory_export',
        redaction: 'secrets-redacted',
        toolFilterBlocks: [
          {
            reason: 'Tool "bash" is disabled by the active tool filter and was not executed.',
            sequence: 3,
            source: 'active_tool_filter',
            toolCallId: 'call_filtered_bash_policy',
            toolName: 'bash',
          },
        ],
      },
      results: [
        {
          schemaVersion: 1,
          generatedAt: '2026-05-19T03:05:00.000Z',
          kind: 'policy_eval_result',
          passed: true,
          policy: {
            id: 'safe-profile-no-mutation',
            title: 'Safe profile cannot mutate files',
          },
          results: [
            {
              assertionId: 'no-mutation-tools',
              passed: true,
              reason: 'No forbidden tool was used.',
            },
          ],
          runId: 'run_eval_review',
        },
      ],
    });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          buildGoldenWorkflowEvalReport: typeof buildGoldenWorkflowEvalReport;
          buildPolicyEvalReport: typeof buildPolicyEvalReport;
          getRunDetail: typeof getRunDetail;
          listRuns: typeof listRuns;
        };
      };
    }).electronAPI = {
      audit: {
        buildGoldenWorkflowEvalReport,
        buildPolicyEvalReport,
        getRunDetail,
        listRuns,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const rowButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Hermes eval cockpit')
    ) as HTMLButtonElement | undefined;
    expect(rowButton).toBeDefined();

    await act(async () => {
      rowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const reviewButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Review evals')
    ) as HTMLButtonElement | undefined;
    expect(reviewButton).toBeDefined();

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getRunDetail).toHaveBeenCalledWith('run_eval_review');
    expect(buildGoldenWorkflowEvalReport).toHaveBeenCalledWith({
      maxArtifactBytes: 8000,
      runId: 'run_eval_review',
    });
    expect(buildPolicyEvalReport).toHaveBeenCalledWith({
      maxArtifactBytes: 8000,
      runId: 'run_eval_review',
    });
    expect(target.textContent).toContain('Evals reviewed');
    expect(target.textContent).toContain('Evaluation report summary');
    expect(target.textContent).toContain('Golden workflow');
    expect(target.textContent).toContain('Policy guardrails');
    expect(target.textContent).toContain('Lead discovery with public sources');
    expect(target.textContent).toContain('Safe profile cannot mutate files');
    expect(target.textContent).toContain('Filtered tool blocks: 1');
    expect(target.textContent).toContain('bash');
    expect(target.textContent).toContain('no tool replay');
  });

  it('copies an agent-ready recall pack from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T19:15:00.000Z',
      query: 'architect lead discovery',
      filters: { limit: 50, sources: ['cowork'] },
      count: 0,
      results: [],
    });
    const buildRecallPack = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T19:15:00.000Z',
      query: 'architect lead discovery',
      filters: {
        limit: 50,
        maxMemories: 5,
        maxMatchesPerRun: 3,
        maxLessons: 5,
        maxSessions: 3,
        sources: ['cowork'],
      },
      count: 1,
      lessonCount: 0,
      lessons: [],
      memories: [],
      memoryCount: 0,
      runCount: 1,
      results: [],
      runs: [],
      sessionCount: 0,
      sessions: [],
      promptContext: '# Run recall pack\n\n- Query: architect lead discovery',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildRecallPack: typeof buildRecallPack;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildRecallPack,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'cowork' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'architect lead discovery' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy recall pack')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildRecallPack).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      query: 'architect lead discovery',
      limit: 50,
      maxMemories: 5,
      maxMatchesPerRun: 3,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['cowork'],
    });
    expect(writeText).toHaveBeenCalledWith('# Run recall pack\n\n- Query: architect lead discovery');
    expect(target.textContent).toContain('Recall pack copied');
  });

  it('sends the current recall pack to Fleet as an inspectable draft goal', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T20:20:00.000Z',
      query: 'mobile supervision gateway',
      filters: { limit: 50, sources: ['fleet'] },
      count: 0,
      results: [],
    });
    const buildRecallPack = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T20:20:00.000Z',
      query: 'mobile supervision gateway',
      filters: {
        limit: 50,
        maxMemories: 5,
        maxMatchesPerRun: 3,
        maxLessons: 5,
        maxSessions: 3,
        sources: ['fleet'],
      },
      count: 1,
      lessonCount: 0,
      lessons: [],
      memories: [],
      memoryCount: 0,
      runCount: 1,
      results: [],
      runs: [],
      sessionCount: 0,
      sessions: [],
      promptContext: '# Run recall pack\n\n- Query: mobile supervision gateway',
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildRecallPack: typeof buildRecallPack;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildRecallPack,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'fleet' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile supervision gateway' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sendButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Send to Fleet')
    ) as HTMLButtonElement | undefined;
    expect(sendButton).toBeDefined();

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildRecallPack).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      query: 'mobile supervision gateway',
      limit: 50,
      maxMemories: 5,
      maxMatchesPerRun: 3,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['fleet'],
    });
    expect(useAppStore.getState().showFleetCommandCenter).toBe(true);
    expect(useAppStore.getState().fleetGoalDraft).toMatchObject({
      dispatchProfile: 'research',
      privacyTag: 'public',
    });
    expect(useAppStore.getState().fleetGoalDraft?.goal).toContain('mobile supervision gateway');
    expect(useAppStore.getState().fleetGoalDraft?.goal).toContain('# Run recall pack');
    expect(useAppStore.getState().fleetGoalDraft?.goal).toContain('external outreach disabled');
    expect(target.textContent).toContain('Sent to Fleet');
  });

  it('copies a redacted mobile supervision snapshot from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T21:45:00.000Z',
      query: 'mobile supervision gateway',
      filters: { limit: 50, sources: ['mobile'] },
      count: 0,
      results: [],
    });
    const buildMobileSnapshot = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T21:45:00.000Z',
      mode: 'review_only',
      query: 'mobile supervision gateway',
      safety: {
        autoDispatch: false,
        localApprovalRequired: true,
        outreachDisabled: true,
        remoteExecutionDisabled: true,
        redaction: 'secrets-redacted',
      },
      allowedActions: ['view_run_summary'],
      blockedActions: ['execute_tool'],
      redactionCount: 1,
      recallPack: {
        promptContext: '# Run recall pack\n\n- Query: mobile supervision gateway',
        runCount: 0,
      },
      runs: [],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildMobileSnapshot: typeof buildMobileSnapshot;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildMobileSnapshot,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'mobile' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile supervision gateway' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy mobile snapshot')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildMobileSnapshot).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      query: 'mobile supervision gateway',
      limit: 50,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['mobile'],
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"mode": "review_only"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"remoteExecutionDisabled": true'));
    expect(target.textContent).toContain('Mobile snapshot copied');
  });

  it('copies the mobile gateway contract from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T21:55:00.000Z',
      query: 'mobile supervision gateway',
      filters: { limit: 50, sources: ['mobile'] },
      count: 0,
      results: [],
    });
    const buildMobileGatewayContract = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T21:55:00.000Z',
      mode: 'contract_only',
      basePath: '/api/mobile',
      query: 'mobile supervision gateway',
      transport: {
        remoteExecution: 'disabled',
      },
      endpoints: [
        {
          action: 'view_run_summary',
          path: '/api/mobile/snapshot',
          sideEffects: 'none',
        },
      ],
      blockedOperations: [
        {
          action: 'execute_tool',
          policy: {
            allowed: false,
            requiresLocalOperator: true,
          },
        },
      ],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildMobileGatewayContract: typeof buildMobileGatewayContract;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildMobileGatewayContract,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'mobile' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile supervision gateway' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy mobile contract')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildMobileGatewayContract).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      includeSnapshot: false,
      query: 'mobile supervision gateway',
      limit: 50,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['mobile'],
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"mode": "contract_only"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"remoteExecution": "disabled"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"action": "execute_tool"'));
    expect(target.textContent).toContain('Mobile contract copied');
  });

  it('copies a local-only mobile gateway review draft from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T22:30:00.000Z',
      query: 'mobile supervision gateway',
      filters: { limit: 50, sources: ['mobile'] },
      count: 0,
      results: [],
    });
    const buildMobileGatewayReviewDraft = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T22:30:00.000Z',
      query: 'mobile supervision gateway',
      draftId: 'mobile-review-post-draft-followup-prompt-api-mobile-followup-draft',
      request: {
        action: 'draft_followup_prompt',
        method: 'POST',
        path: '/api/mobile/followup-draft',
      },
      decision: {
        allowed: false,
        requiresLocalOperator: true,
        sideEffects: 'draft_only',
      },
      status: 'needs_local_operator',
      operatorActions: ['approve_draft', 'cancel_draft'],
      safety: {
        autoDispatch: false,
        localOnly: true,
        outreachDisabled: true,
        remoteExecutionDisabled: true,
      },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildMobileGatewayReviewDraft: typeof buildMobileGatewayReviewDraft;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildMobileGatewayReviewDraft,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'mobile' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile supervision gateway' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy review draft')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildMobileGatewayReviewDraft).toHaveBeenCalledWith({
      action: 'draft_followup_prompt',
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      includeSnapshot: true,
      localOperator: false,
      method: 'POST',
      path: '/api/mobile/followup-draft',
      query: 'mobile supervision gateway',
      limit: 50,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['mobile'],
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"status": "needs_local_operator"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"approve_draft"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"remoteExecutionDisabled": true'));
    expect(target.textContent).toContain('Review draft copied');
  });

  it('copies a disabled mobile gateway listener shell from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T23:30:00.000Z',
      query: 'mobile supervision gateway',
      filters: { limit: 50, sources: ['mobile'] },
      count: 0,
      results: [],
    });
    const buildMobileGatewayListenerShell = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T23:30:00.000Z',
      kind: 'mobile_gateway_listener_shell',
      query: 'mobile supervision gateway',
      mode: 'disabled_shell',
      basePath: '/api/mobile',
      bind: {
        host: '127.0.0.1',
        networkExposure: 'loopback_only',
        port: 0,
        status: 'not_started',
      },
      transport: {
        listener: 'not_started',
        remoteExecution: 'disabled',
      },
      safety: {
        mutationRoutesDisabled: true,
        outreachDisabled: true,
        remoteExecutionDisabled: true,
        serverStarted: false,
      },
      routes: [
        {
          action: 'draft_followup_prompt',
          handler: 'local_operator_review_stub',
          sideEffects: 'draft_only',
        },
      ],
      blockedRoutes: [
        {
          action: 'execute_tool',
          handler: 'blocked_stub',
        },
      ],
      acceptanceChecks: ['No HTTP server is started by this shell.'],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildMobileGatewayListenerShell: typeof buildMobileGatewayListenerShell;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildMobileGatewayListenerShell,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'mobile' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile supervision gateway' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy listener shell')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildMobileGatewayListenerShell).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      query: 'mobile supervision gateway',
      limit: 50,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['mobile'],
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"mode": "disabled_shell"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"serverStarted": false'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"listener": "not_started"'));
    expect(target.textContent).toContain('Listener shell copied');
  });

  it('copies preview-only mobile pairing state from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T23:40:00.000Z',
      query: 'mobile supervision gateway',
      filters: { limit: 50, sources: ['mobile'] },
      count: 0,
      results: [],
    });
    const buildMobilePairingState = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T23:40:00.000Z',
      kind: 'mobile_supervision_pairing_state',
      mode: 'local_pairing_plan',
      query: 'mobile supervision gateway',
      basePath: '/api/mobile',
      pairing: {
        acceptedByListener: false,
        codeFingerprint: 'abc123abc123abcd',
        deviceLabel: 'Cowork mobile supervisor',
        expiresAt: '2026-05-18T23:45:00.000Z',
        persisted: false,
        previewCode: '123456',
        scopes: ['mobile:read', 'mobile:draft'],
        status: 'preview_only',
        tokenIssued: false,
        ttlSeconds: 300,
      },
      listener: {
        bindStatus: 'not_started',
        listenerStatus: 'not_started',
        networkExposure: 'loopback_only',
        serverStarted: false,
      },
      safety: {
        approvalMutationsDisabled: true,
        notAcceptedByAnyServer: true,
        pairingRequiresLocalOperator: true,
        remoteExecutionDisabled: true,
        secretMaterialPersisted: false,
      },
      operatorChecklist: ['No listener accepts this preview code.'],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildMobilePairingState: typeof buildMobilePairingState;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildMobilePairingState,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'mobile' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile supervision gateway' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy pairing state')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildMobilePairingState).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      deviceLabel: 'Cowork mobile supervisor',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      query: 'mobile supervision gateway',
      limit: 50,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['mobile'],
      ttlSeconds: 300,
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"mode": "local_pairing_plan"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"tokenIssued": false'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"notAcceptedByAnyServer": true'));
    expect(target.textContent).toContain('Pairing state copied');
  });

  it('copies no-network mobile pairing acceptance plan from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T23:55:00.000Z',
      query: 'mobile supervision gateway',
      filters: { limit: 50, sources: ['mobile'] },
      count: 0,
      results: [],
    });
    const buildMobilePairingAcceptancePlan = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-18T23:55:00.000Z',
      kind: 'mobile_supervision_pairing_acceptance_plan',
      mode: 'acceptance_plan_only',
      query: 'mobile supervision gateway',
      basePath: '/api/mobile',
      pairing: {
        acceptedByListener: false,
        codeFingerprint: 'abc123abc123abcd',
        deviceLabel: 'Cowork mobile supervisor',
        expiresAt: '2026-05-19T00:00:00.000Z',
        scopes: ['mobile:read', 'mobile:draft'],
        status: 'preview_only',
        tokenIssued: false,
      },
      acceptance: {
        canAcceptNow: false,
        localOperatorLabel: 'Cowork local operator',
        requestId: 'mobile-pairing-acceptance-abc123abc123abcd',
        status: 'blocked_until_listener_exists',
        endpoint: {
          action: 'accept_pairing_code',
          enabled: false,
          method: 'POST',
          path: '/api/mobile/pairing/accept',
        },
        requiredEvidence: ['local_operator_confirmed_code'],
      },
      preconditions: [
        {
          id: 'loopback_listener_running',
          label: 'Loopback listener is running',
          passed: false,
          evidence: 'listenerStatus=not_started; serverStarted=false',
        },
      ],
      plannedMutations: [
        {
          id: 'mint_short_lived_mobile_token',
          enabled: false,
          description: 'Mint token',
        },
      ],
      safety: {
        approvalMutationEndpointEnabled: false,
        autoAccept: false,
        localOnly: true,
        remoteExecutionDisabled: true,
        secretMaterialPersisted: false,
        serverStarted: false,
        tokenIssued: false,
      },
      operatorChecklist: ['No endpoint enabled.'],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildMobilePairingAcceptancePlan: typeof buildMobilePairingAcceptancePlan;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildMobilePairingAcceptancePlan,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'mobile' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile supervision gateway' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const reviewButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Review acceptance')
    ) as HTMLButtonElement | undefined;
    expect(reviewButton).toBeDefined();

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(target.textContent).toContain('Local pairing acceptance plan');
    expect(target.textContent).toContain('Accept now: false');
    expect(target.textContent).toContain('Endpoint disabled');
    expect(target.textContent).toContain('Required evidence');
    expect(target.textContent).toContain('local_operator_confirmed_code');
    expect(target.textContent).toContain('mint_short_lived_mobile_token: enabled=false');

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy acceptance plan')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildMobilePairingAcceptancePlan).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      deviceLabel: 'Cowork mobile supervisor',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      localOperatorLabel: 'Cowork local operator',
      query: 'mobile supervision gateway',
      limit: 50,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['mobile'],
      ttlSeconds: 300,
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"kind": "mobile_supervision_pairing_acceptance_plan"')
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"enabled": false'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"canAcceptNow": false'));
    expect(target.textContent).toContain('Acceptance plan copied');
  });

  it('copies a local-only mobile approval queue from the current search', async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const searchRuns = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-19T00:10:00.000Z',
      query: 'mobile approval queue',
      filters: { limit: 50, sources: ['mobile'] },
      count: 0,
      results: [],
    });
    const buildMobileApprovalQueue = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-05-19T00:10:00.000Z',
      kind: 'mobile_supervision_approval_queue',
      mode: 'local_review_queue',
      query: 'mobile approval queue',
      basePath: '/api/mobile',
      pairing: {
        acceptedByListener: false,
        deviceLabel: 'Cowork mobile supervisor',
        status: 'preview_only',
        tokenIssued: false,
      },
      listener: {
        listenerStatus: 'not_started',
        serverStarted: false,
      },
      counts: {
        blocked: 6,
        pending: 1,
        ready: 3,
        total: 10,
      },
      items: [
        {
          action: 'draft_followup_prompt',
          canDispatch: false,
          id: 'endpoint.followup_draft',
          method: 'POST',
          operatorActions: ['approve_draft', 'cancel_draft'],
          path: '/api/mobile/followup-draft',
          reason: 'Draft-only mobile follow-up requires a local operator.',
          reviewDraft: {
            schemaVersion: 1,
            generatedAt: '2026-05-19T00:10:00.000Z',
            query: 'mobile approval queue',
            draftId: 'mobile-review-draft',
            request: {
              action: 'draft_followup_prompt',
              method: 'POST',
              path: '/api/mobile/followup-draft',
            },
            decision: {
              allowed: false,
              requiresLocalOperator: true,
              sideEffects: 'draft_only',
            },
            status: 'needs_local_operator',
            operatorActions: ['approve_draft', 'cancel_draft'],
            safety: {
              autoDispatch: false,
              localOnly: true,
              outreachDisabled: true,
              remoteExecutionDisabled: true,
            },
          },
          status: 'pending_local_operator',
        },
      ],
      safety: {
        approvalMutationEndpointEnabled: false,
        autoDispatch: false,
        localOnly: true,
        outreachDisabled: true,
        remoteExecutionDisabled: true,
      },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useAppStore.setState({ workingDir: 'D:\\CascadeProjects\\grok-cli-weekend' });
    (window as unknown as {
      electronAPI?: {
        audit?: {
          listRuns: typeof listRuns;
          searchRuns: typeof searchRuns;
          buildMobileApprovalQueue: typeof buildMobileApprovalQueue;
        };
      };
    }).electronAPI = {
      audit: {
        listRuns,
        searchRuns,
        buildMobileApprovalQueue,
      },
    };

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(AuditLogViewer));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sourceSelect = target.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      Simulate.change(sourceSelect, { target: { value: 'mobile' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const searchInput = target.querySelector('input[placeholder="Search runs, events, artifacts"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(searchInput, { target: { value: 'mobile approval queue' } } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const reviewButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Review queue')
    ) as HTMLButtonElement | undefined;
    expect(reviewButton).toBeDefined();

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(target.textContent).toContain('Local mobile approval queue');
    expect(target.textContent).toContain('Ready read-only: 3');
    expect(target.textContent).toContain('Pending approval: 1');
    expect(target.textContent).toContain('Blocked: 6');
    expect(target.textContent).toContain('approval mutations off');
    expect(target.textContent).toContain('auto-dispatch off');
    expect(target.textContent).toContain('POST /api/mobile/followup-draft -> draft_followup_prompt');

    const copyDraftButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy draft')
    ) as HTMLButtonElement | undefined;
    expect(copyDraftButton).toBeDefined();

    await act(async () => {
      copyDraftButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"draftId": "mobile-review-draft"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"status": "needs_local_operator"'));
    expect(target.textContent).toContain('Draft copied');

    const copyButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Copy approval queue')
    ) as HTMLButtonElement | undefined;
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(buildMobileApprovalQueue).toHaveBeenCalledWith({
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      deviceLabel: 'Cowork mobile supervisor',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      query: 'mobile approval queue',
      limit: 50,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources: ['mobile'],
      ttlSeconds: 300,
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"mode": "local_review_queue"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"approvalMutationEndpointEnabled": false'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"pending": 1'));
    expect(target.textContent).toContain('Approval queue copied');
  });
});
