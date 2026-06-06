import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  buildMobileGatewayContract,
  buildMobileGatewayListenerShell,
  buildMobileApprovalQueue,
  buildMobilePairingAcceptancePlan,
  buildMobilePairingState,
  buildMobileGatewayReviewDraft,
  buildMobileSnapshot,
  buildGoldenWorkflowEvalReport,
  buildPolicyEvalReport,
  buildTrajectoryExport,
  getRunDetail,
  buildRecallPack,
  listRuns,
  searchRuns,
} from '../src/main/observability/audit-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('audit bridge run search', () => {
  it('returns a stable Cowork run recall envelope from the core RunStore', async () => {
    const coreSearchRuns = vi.fn(() => [
      {
        runId: 'run_hermes',
        objective: 'Hermes candidate queue',
        status: 'completed' as const,
        startedAt: 1_779_129_600_000,
        matched: 'artifact' as const,
        score: 91,
        snippet: 'candidate queue artifact',
        artifact: 'summary.md',
        source: 'cowork',
      },
    ]);
    const coreListRuns = vi.fn(() => [
      {
        runId: 'run_hermes',
        objective: 'Hermes candidate queue',
        status: 'completed' as const,
        startedAt: 1_779_129_600_000,
        eventCount: 3,
        artifactCount: 1,
        metadata: {
          channel: 'cowork',
          tags: ['fleet'],
        },
      },
      {
        runId: 'run_cli',
        objective: 'CLI maintenance',
        status: 'completed' as const,
        startedAt: 1_779_129_500_000,
        eventCount: 1,
        artifactCount: 0,
        metadata: {
          channel: 'terminal',
        },
      },
    ]);
    const getRun = vi.fn((runId: string) => ({
      summary: coreListRuns().find((run) => run.runId === runId),
      metrics: { durationMs: 1000, toolCallCount: 2 },
      artifacts: [],
    }));
    const buildProofLedgerForRun = vi.fn(() => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T03:00:00.000Z',
      kind: 'proof_ledger_entry' as const,
      status: 'proven' as const,
      summary: 'Completed with proof.',
      run: {
        artifactCount: 1,
        eventCount: 3,
        objective: 'Hermes candidate queue',
        runId: 'run_hermes',
        source: 'cowork',
        status: 'completed' as const,
        tags: ['fleet'],
      },
      privacy: {
        artifactContentIncluded: false as const,
        redaction: 'secrets-redacted' as const,
        redactionCount: 0,
      },
      tests: {
        commands: [
          {
            command: 'npm test -- tests/observability/proof-ledger.test.ts --run',
            durationMs: 450,
            isTest: true,
            sequence: 2,
            success: true,
            toolName: 'shell_exec',
            ts: 1_779_129_500_100,
          },
        ],
        failed: 0,
        passed: 1,
        total: 1,
      },
      commands: [
        {
          command: 'npm test -- tests/observability/proof-ledger.test.ts --run',
          durationMs: 450,
          isTest: true,
          sequence: 2,
          success: true,
          toolName: 'shell_exec',
          ts: 1_779_129_500_100,
        },
      ],
      artifacts: [{ kind: 'summary', name: 'summary.md' }],
      filesChanged: ['src/observability/proof-ledger.ts'],
      risks: [],
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/proof-ledger.js') {
        return { buildProofLedgerForRun };
      }
      return {
        RunStore: {
          getInstance: () => ({
            getRun,
            getEvents: () => [],
            listRuns: coreListRuns,
            searchRuns: coreSearchRuns,
          }),
        },
      };
    });

    const response = await searchRuns({
      query: ' candidate queue ',
      limit: 500,
      sources: ['Cowork, fleet', 'cowork'],
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('observability/run-store.js');
    expect(coreSearchRuns).toHaveBeenCalledWith('candidate queue', {
      limit: 100,
      sources: ['cowork', 'fleet'],
    });
    expect(response).toMatchObject({
      schemaVersion: 1,
      query: 'candidate queue',
      filters: {
        limit: 100,
        sources: ['cowork', 'fleet'],
      },
      count: 1,
      results: [
        {
          runId: 'run_hermes',
          matched: 'artifact',
          artifact: 'summary.md',
          source: 'cowork',
        },
      ],
    });
    expect(new Date(response.generatedAt).toString()).not.toBe('Invalid Date');

    const filtered = await listRuns({ limit: 20, sources: ['desktop'] });
    expect(filtered.map((run) => run.runId)).toEqual(['run_hermes']);

    const detail = await getRunDetail('run_hermes');
    expect(mockedLoadCoreModule).toHaveBeenCalledWith('observability/proof-ledger.js');
    expect(buildProofLedgerForRun).toHaveBeenCalledWith(expect.any(Object), 'run_hermes');
    expect(detail?.proofLedger).toMatchObject({
      kind: 'proof_ledger_entry',
      status: 'proven',
      tests: {
        passed: 1,
        total: 1,
      },
      commands: [
        {
          command: 'npm test -- tests/observability/proof-ledger.test.ts --run',
          success: true,
          toolName: 'shell_exec',
        },
      ],
    });
  });

  it('returns an empty envelope for blank queries without loading the core module', async () => {
    const response = await searchRuns({ query: '   ' });

    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      schemaVersion: 1,
      query: '',
      filters: {
        limit: 20,
        sources: [],
      },
      count: 0,
      results: [],
    });
  });

  it('builds a recall pack through the core recall-pack module', async () => {
    const buildRunRecallPackAsync = vi.fn(async () => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T19:10:00.000Z',
      query: 'architect lead discovery',
      filters: {
        limit: 25,
        maxMemories: 3,
        maxMatchesPerRun: 4,
        maxLessons: 2,
        maxSessions: 1,
        sources: ['cowork'],
      },
      count: 2,
      lessonCount: 1,
      lessons: [],
      memories: [],
      memoryCount: 1,
      runCount: 1,
      results: [],
      runs: [],
      sessionCount: 1,
      sessions: [],
      promptContext: '# Run recall pack\nQuery: architect lead discovery',
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildRunRecallPackAsync });

    const response = await buildRecallPack({
      cwd: ' D:\\CascadeProjects\\grok-cli-weekend ',
      query: ' architect lead discovery ',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      limit: 25,
      maxMemories: 3,
      maxMatchesPerRun: 4,
      maxLessons: 2,
      maxSessions: 1,
      sources: ['Cowork'],
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('observability/run-recall-pack.js');
    expect(buildRunRecallPackAsync).toHaveBeenCalledWith('architect lead discovery', {
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      limit: 25,
      maxMemories: 3,
      maxMatchesPerRun: 4,
      maxLessons: 2,
      maxSessions: 1,
      sources: ['cowork'],
    });
    expect(response).toMatchObject({
      schemaVersion: 1,
      query: 'architect lead discovery',
      filters: {
        limit: 25,
        maxMemories: 3,
        maxMatchesPerRun: 4,
        maxLessons: 2,
        maxSessions: 1,
        sources: ['cowork'],
      },
      memoryCount: 1,
      sessionCount: 1,
      promptContext: '# Run recall pack\nQuery: architect lead discovery',
    });
  });

  it('builds a redacted trajectory export through the core module', async () => {
    const buildRunTrajectoryExport = vi.fn(() => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T01:15:00.000Z',
      kind: 'run_trajectory_export' as const,
      mode: 'redacted_review_export' as const,
      run: {
        artifactCount: 1,
        channel: 'cowork',
        eventCount: 4,
        objective: 'Trajectory export',
        runId: 'run_trajectory',
        startedAt: 1_779_132_000_000,
        status: 'completed' as const,
        tags: ['fleet'],
      },
      privacy: {
        artifactContentIncluded: false,
        maxArtifactBytes: 4000,
        maxEventValueBytes: 2000,
        redaction: 'secrets-redacted' as const,
        redactionCount: 1,
      },
      prompt: {
        sources: ['summary.objective'],
        text: 'Trajectory export',
      },
      selectedContext: [],
      toolCalls: [
        {
          sequence: 2,
          toolName: 'web_search',
          ts: 1_779_132_000_010,
        },
      ],
      toolResults: [],
      artifacts: [
        {
          name: 'summary.md',
        },
      ],
      metrics: {},
      events: [],
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildRunTrajectoryExport });

    const response = await buildTrajectoryExport({
      includeArtifactContent: true,
      maxArtifactBytes: 50_000,
      maxEventValueBytes: 100_000,
      runId: ' run_trajectory ',
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('observability/run-trajectory-export.js');
    expect(buildRunTrajectoryExport).toHaveBeenCalledWith('run_trajectory', {
      includeArtifactContent: true,
      maxArtifactBytes: 50000,
      maxEventValueBytes: 50000,
    });
    expect(response).toMatchObject({
      kind: 'run_trajectory_export',
      mode: 'redacted_review_export',
      run: {
        runId: 'run_trajectory',
      },
      privacy: {
        redaction: 'secrets-redacted',
      },
    });
  });

  it('builds a policy eval report through the core modules', async () => {
    const trajectory = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T01:50:00.000Z',
      kind: 'run_trajectory_export' as const,
      mode: 'redacted_review_export' as const,
      run: {
        artifactCount: 1,
        channel: 'cowork',
        eventCount: 4,
        objective: 'Safe profile review',
        runId: 'run_policy',
        startedAt: 1_779_134_000_000,
        status: 'completed' as const,
        tags: ['profile:safe'],
      },
      privacy: {
        artifactContentIncluded: true,
        maxArtifactBytes: 8000,
        maxEventValueBytes: 2000,
        redaction: 'secrets-redacted' as const,
        redactionCount: 0,
      },
      prompt: {
        sources: ['summary.objective'],
        text: 'Safe profile review',
      },
      selectedContext: [],
      toolCalls: [],
      toolResults: [],
      artifacts: [{ name: 'source-evidence.md', contentPreview: 'https://example.com' }],
      metrics: {},
      events: [
        {
          data: {
            kind: 'tool_filter_block',
            reason: 'Tool "create_file" is disabled by the active tool filter and was not executed.',
            source: 'active_tool_filter',
            toolCallId: 'call_filtered',
            toolName: 'create_file',
          },
          sequence: 2,
          ts: 1_779_134_000_500,
          type: 'decision',
        },
      ],
    };
    const buildRunTrajectoryExport = vi.fn(() => trajectory);
    const buildPolicyEvalManifest = vi.fn(() => ({
      policies: [
        { id: 'safe-profile-no-mutation' },
        { id: 'public-data-source-urls' },
      ],
    }));
    const evaluatePolicyEval = vi.fn((policyId: string) => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T01:51:00.000Z',
      kind: 'policy_eval_result' as const,
      passed: policyId === 'safe-profile-no-mutation',
      policy: {
        id: policyId,
        objective: 'Policy objective',
        scope: 'test scope',
        title: `Policy ${policyId}`,
      },
      results: [
        {
          assertionId: 'assertion',
          description: 'Assertion',
          kind: 'require_text',
          passed: policyId === 'safe-profile-no-mutation',
          reason: 'Evaluated.',
        },
      ],
      runId: 'run_policy',
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/run-trajectory-export.js') {
        return { buildRunTrajectoryExport };
      }
      if (modulePath === 'observability/policy-evals.js') {
        return { buildPolicyEvalManifest, evaluatePolicyEval };
      }
      return null;
    });

    const response = await buildPolicyEvalReport({
      maxArtifactBytes: 50_000,
      runId: ' run_policy ',
    });

    expect(buildRunTrajectoryExport).toHaveBeenCalledWith('run_policy', {
      includeArtifactContent: true,
      maxArtifactBytes: 50000,
      maxEventValueBytes: 2000,
    });
    expect(buildPolicyEvalManifest).toHaveBeenCalled();
    expect(evaluatePolicyEval).toHaveBeenCalledWith('safe-profile-no-mutation', trajectory);
    expect(evaluatePolicyEval).toHaveBeenCalledWith('public-data-source-urls', trajectory);
    expect(response).toMatchObject({
      kind: 'policy_eval_report',
      mode: 'redacted_trajectory_policy_eval',
      runId: 'run_policy',
      safety: {
        readOnly: true,
        toolReplay: false,
      },
      summary: {
        failed: 1,
        passed: 1,
        total: 2,
      },
      trajectory: {
        toolFilterBlocks: [
          expect.objectContaining({
            source: 'active_tool_filter',
            toolCallId: 'call_filtered',
            toolName: 'create_file',
          }),
        ],
      },
    });
  });

  it('builds a golden workflow eval report through the core modules', async () => {
    const trajectory = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T02:20:00.000Z',
      kind: 'run_trajectory_export' as const,
      mode: 'redacted_review_export' as const,
      run: {
        artifactCount: 1,
        channel: 'cowork',
        eventCount: 4,
        objective: 'Document workshop',
        runId: 'run_golden',
        startedAt: 1_779_134_000_000,
        status: 'completed' as const,
        tags: ['fleet'],
      },
      privacy: {
        artifactContentIncluded: true,
        maxArtifactBytes: 8000,
        maxEventValueBytes: 2000,
        redaction: 'secrets-redacted' as const,
        redactionCount: 0,
      },
      prompt: {
        sources: ['summary.objective'],
        text: 'Document workshop',
      },
      selectedContext: [],
      toolCalls: [],
      toolResults: [],
      artifacts: [{ name: 'document-workshop.docx', contentPreview: 'review export' }],
      metrics: {},
      events: [],
    };
    const buildRunTrajectoryExport = vi.fn(() => trajectory);
    const buildGoldenWorkflowEvalManifest = vi.fn(() => ({
      fixtures: [
        { id: 'doc-workshop' },
        { id: 'fleet-review' },
      ],
    }));
    const evaluateGoldenWorkflowFixture = vi.fn((fixtureId: string) => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T02:21:00.000Z',
      kind: 'golden_workflow_eval_result' as const,
      passed: fixtureId === 'doc-workshop',
      fixture: {
        id: fixtureId,
        objective: 'Golden objective',
        title: `Golden ${fixtureId}`,
        workflow: 'plan -> run -> verify',
      },
      results: [
        {
          assertionId: 'assertion',
          description: 'Assertion',
          kind: 'require_artifact',
          passed: fixtureId === 'doc-workshop',
          reason: 'Evaluated.',
        },
      ],
      runId: 'run_golden',
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/run-trajectory-export.js') {
        return { buildRunTrajectoryExport };
      }
      if (modulePath === 'observability/golden-workflow-evals.js') {
        return { buildGoldenWorkflowEvalManifest, evaluateGoldenWorkflowFixture };
      }
      return null;
    });

    const response = await buildGoldenWorkflowEvalReport({
      maxArtifactBytes: 50_000,
      runId: ' run_golden ',
    });

    expect(buildRunTrajectoryExport).toHaveBeenCalledWith('run_golden', {
      includeArtifactContent: true,
      maxArtifactBytes: 50000,
      maxEventValueBytes: 2000,
    });
    expect(buildGoldenWorkflowEvalManifest).toHaveBeenCalled();
    expect(evaluateGoldenWorkflowFixture).toHaveBeenCalledWith('doc-workshop', trajectory);
    expect(evaluateGoldenWorkflowFixture).toHaveBeenCalledWith('fleet-review', trajectory);
    expect(response).toMatchObject({
      kind: 'golden_workflow_eval_report',
      mode: 'redacted_trajectory_golden_eval',
      runId: 'run_golden',
      safety: {
        readOnly: true,
        toolReplay: false,
      },
      summary: {
        failed: 1,
        passed: 1,
        total: 2,
      },
    });
  });

  it('builds a mobile supervision snapshot through the core module', async () => {
    const buildMobileSupervisionSnapshot = vi.fn(async () => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T21:40:00.000Z',
      mode: 'review_only' as const,
      query: 'architect handoff',
      safety: {
        autoDispatch: false as const,
        localApprovalRequired: true as const,
        outreachDisabled: true as const,
        remoteExecutionDisabled: true as const,
        redaction: 'secrets-redacted' as const,
      },
      allowedActions: ['view_run_summary'],
      blockedActions: ['execute_tool'],
      redactionCount: 1,
      recallPack: {
        count: 1,
        filters: {
          limit: 10,
          maxMemories: 2,
          maxMatchesPerRun: 3,
          maxLessons: 2,
          maxSessions: 1,
          sources: ['mobile'],
        },
        lessonCount: 0,
        memoryCount: 0,
        promptContext: '# Run recall pack\nQuery: architect handoff',
        runCount: 1,
        schemaVersion: 1 as const,
        sessionCount: 0,
      },
      runs: [],
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildMobileSupervisionSnapshot });

    const response = await buildMobileSnapshot({
      cwd: ' D:\\CascadeProjects\\grok-cli-weekend ',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      limit: 10,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      query: ' architect handoff ',
      sources: ['Mobile'],
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('observability/mobile-supervision-snapshot.js');
    expect(buildMobileSupervisionSnapshot).toHaveBeenCalledWith('architect handoff', {
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      limit: 10,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      sources: ['mobile'],
    });
    expect(response).toMatchObject({
      mode: 'review_only',
      redactionCount: 1,
      safety: {
        remoteExecutionDisabled: true,
      },
    });
  });

  it('builds a mobile gateway contract through the core module', async () => {
    const buildMobileSupervisionGatewayContract = vi.fn(async () => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T21:55:00.000Z',
      mode: 'contract_only' as const,
      basePath: '/api/mobile',
      query: 'mobile gateway',
      auth: {
        required: true as const,
        scheme: 'bearer_or_pairing_code' as const,
        scopes: ['mobile:read', 'mobile:draft'],
        ttlSeconds: 900,
      },
      transport: {
        exposure: 'local_first' as const,
        offDeviceTlsRequired: true as const,
        remoteExecution: 'disabled' as const,
      },
      endpoints: [
        {
          action: 'view_run_summary',
          auth: {
            required: true as const,
            scheme: 'bearer_or_pairing_code' as const,
            scopes: ['mobile:read', 'mobile:draft'],
            ttlSeconds: 900,
          },
          description: 'Return a snapshot.',
          id: 'mobile.snapshot.read',
          localApprovalRequired: false,
          method: 'GET' as const,
          path: '/api/mobile/snapshot',
          policy: {
            action: 'view_run_summary',
            allowed: true,
            requiresLocalOperator: false,
            reason: 'Allowed as review-only.',
          },
          sideEffects: 'none' as const,
        },
      ],
      blockedOperations: [
        {
          action: 'execute_tool',
          policy: {
            action: 'execute_tool',
            allowed: false,
            requiresLocalOperator: true,
            reason: 'Blocked.',
          },
        },
      ],
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildMobileSupervisionGatewayContract });

    const response = await buildMobileGatewayContract({
      cwd: ' D:\\CascadeProjects\\grok-cli-weekend ',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      includeSnapshot: false,
      limit: 10,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      query: ' mobile gateway ',
      sources: ['Mobile'],
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('observability/mobile-supervision-gateway-contract.js');
    expect(buildMobileSupervisionGatewayContract).toHaveBeenCalledWith('mobile gateway', {
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      includeSnapshot: false,
      limit: 10,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      sources: ['mobile'],
    });
    expect(response).toMatchObject({
      mode: 'contract_only',
      transport: {
        remoteExecution: 'disabled',
      },
      endpoints: [
        expect.objectContaining({
          path: '/api/mobile/snapshot',
        }),
      ],
      blockedOperations: [
        expect.objectContaining({
          action: 'execute_tool',
        }),
      ],
    });
    expect(response.snapshot).toBeUndefined();
  });

  it('builds a mobile gateway review draft through the core policy module', async () => {
    const contract = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T22:25:00.000Z',
      mode: 'contract_only' as const,
      basePath: '/api/mobile',
      query: 'mobile gateway',
      auth: {
        required: true as const,
        scheme: 'bearer_or_pairing_code' as const,
        scopes: ['mobile:read', 'mobile:draft'],
        ttlSeconds: 900,
      },
      transport: {
        exposure: 'local_first' as const,
        offDeviceTlsRequired: true as const,
        remoteExecution: 'disabled' as const,
      },
      endpoints: [],
      blockedOperations: [],
    };
    const buildMobileSupervisionGatewayContract = vi.fn(async () => contract);
    const buildMobileSupervisionGatewayReviewDraft = vi.fn((query, receivedContract, request) => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T22:26:00.000Z',
      query,
      draftId: 'mobile-review-post-draft-followup-prompt-api-mobile-followup-draft',
      contract: receivedContract,
      request,
      decision: {
        action: request.action,
        allowed: false,
        method: request.method,
        path: request.path,
        reason: 'Requires local operator approval.',
        requiresLocalOperator: true,
        sideEffects: 'draft_only' as const,
      },
      status: 'needs_local_operator' as const,
      operatorActions: ['approve_draft' as const, 'cancel_draft' as const],
      safety: {
        autoDispatch: false as const,
        localOnly: true as const,
        outreachDisabled: true as const,
        remoteExecutionDisabled: true as const,
      },
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/mobile-supervision-gateway-contract.js') {
        return { buildMobileSupervisionGatewayContract };
      }
      if (modulePath === 'observability/mobile-supervision-gateway-policy.js') {
        return { buildMobileSupervisionGatewayReviewDraft };
      }
      return null;
    });

    const response = await buildMobileGatewayReviewDraft({
      action: ' draft_followup_prompt ',
      cwd: ' D:\\CascadeProjects\\grok-cli-weekend ',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      includeSnapshot: true,
      limit: 10,
      localOperator: false,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      method: 'post',
      path: ' /api/mobile/followup-draft ',
      query: ' mobile gateway ',
      sources: ['Mobile'],
    });

    expect(buildMobileSupervisionGatewayContract).toHaveBeenCalledWith('mobile gateway', {
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      includeSnapshot: true,
      limit: 10,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      sources: ['mobile'],
    });
    expect(buildMobileSupervisionGatewayReviewDraft).toHaveBeenCalledWith(
      'mobile gateway',
      contract,
      {
        action: 'draft_followup_prompt',
        localOperator: undefined,
        method: 'POST',
        path: '/api/mobile/followup-draft',
      },
    );
    expect(response).toMatchObject({
      status: 'needs_local_operator',
      operatorActions: ['approve_draft', 'cancel_draft'],
      safety: {
        remoteExecutionDisabled: true,
      },
    });
  });

  it('builds a mobile gateway listener shell through the core module', async () => {
    const contract = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:25:00.000Z',
      mode: 'contract_only' as const,
      basePath: '/api/mobile',
      query: 'mobile gateway',
      auth: {
        required: true as const,
        scheme: 'bearer_or_pairing_code' as const,
        scopes: ['mobile:read', 'mobile:draft'],
        ttlSeconds: 900,
      },
      transport: {
        exposure: 'local_first' as const,
        offDeviceTlsRequired: true as const,
        remoteExecution: 'disabled' as const,
      },
      endpoints: [
        {
          action: 'draft_followup_prompt',
          auth: {
            required: true as const,
            scheme: 'bearer_or_pairing_code' as const,
            scopes: ['mobile:read', 'mobile:draft'],
            ttlSeconds: 900,
          },
          description: 'Draft only.',
          id: 'mobile.followup.draft',
          localApprovalRequired: true,
          method: 'POST' as const,
          path: '/api/mobile/followup-draft',
          policy: {
            action: 'draft_followup_prompt',
            allowed: true,
            requiresLocalOperator: false,
            reason: 'Allowed as review-only.',
          },
          sideEffects: 'draft_only' as const,
        },
      ],
      blockedOperations: [],
    };
    const buildMobileSupervisionGatewayContract = vi.fn(async () => contract);
    const buildMobileSupervisionGatewayListenerShell = vi.fn((receivedContract) => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:26:00.000Z',
      kind: 'mobile_gateway_listener_shell' as const,
      query: receivedContract.query,
      mode: 'disabled_shell' as const,
      basePath: receivedContract.basePath,
      bind: {
        host: '127.0.0.1' as const,
        networkExposure: 'loopback_only' as const,
        port: 0,
        status: 'not_started' as const,
      },
      auth: receivedContract.auth,
      transport: {
        ...receivedContract.transport,
        listener: 'not_started' as const,
      },
      safety: {
        localOperatorRequiredForDrafts: true as const,
        mutationRoutesDisabled: true as const,
        outreachDisabled: true as const,
        remoteExecutionDisabled: true as const,
        serverStarted: false as const,
      },
      routes: [
        {
          action: 'draft_followup_prompt',
          handler: 'local_operator_review_stub' as const,
          localApprovalRequired: true,
          method: 'POST' as const,
          path: '/api/mobile/followup-draft',
          policyReason: 'Allowed as review-only.',
          sideEffects: 'draft_only' as const,
          status: 'planned_not_bound' as const,
        },
      ],
      blockedRoutes: [],
      acceptanceChecks: ['No HTTP server is started by this shell.'],
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/mobile-supervision-gateway-contract.js') {
        return { buildMobileSupervisionGatewayContract };
      }
      if (modulePath === 'observability/mobile-supervision-gateway-listener-shell.js') {
        return { buildMobileSupervisionGatewayListenerShell };
      }
      return null;
    });

    const response = await buildMobileGatewayListenerShell({
      cwd: ' D:\\CascadeProjects\\grok-cli-weekend ',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      limit: 10,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      query: ' mobile gateway ',
      sources: ['Mobile'],
    });

    expect(buildMobileSupervisionGatewayContract).toHaveBeenCalledWith('mobile gateway', {
      cwd: 'D:\\CascadeProjects\\grok-cli-weekend',
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
      includeSnapshot: false,
      limit: 10,
      maxMemories: 2,
      maxLessons: 2,
      maxSessions: 1,
      sources: ['mobile'],
    });
    expect(buildMobileSupervisionGatewayListenerShell).toHaveBeenCalledWith(contract);
    expect(response).toMatchObject({
      kind: 'mobile_gateway_listener_shell',
      mode: 'disabled_shell',
      safety: {
        remoteExecutionDisabled: true,
        serverStarted: false,
      },
      routes: [
        expect.objectContaining({
          handler: 'local_operator_review_stub',
        }),
      ],
    });
  });

  it('builds mobile pairing state through the core module', async () => {
    const contract = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:30:00.000Z',
      mode: 'contract_only' as const,
      basePath: '/api/mobile',
      query: 'mobile pairing',
      auth: {
        required: true as const,
        scheme: 'bearer_or_pairing_code' as const,
        scopes: ['mobile:read', 'mobile:draft'],
        ttlSeconds: 900,
      },
      transport: {
        exposure: 'local_first' as const,
        offDeviceTlsRequired: true as const,
        remoteExecution: 'disabled' as const,
      },
      endpoints: [],
      blockedOperations: [],
    };
    const shell = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:31:00.000Z',
      kind: 'mobile_gateway_listener_shell' as const,
      query: contract.query,
      mode: 'disabled_shell' as const,
      basePath: contract.basePath,
      bind: {
        host: '127.0.0.1' as const,
        networkExposure: 'loopback_only' as const,
        port: 0,
        status: 'not_started' as const,
      },
      auth: contract.auth,
      transport: {
        ...contract.transport,
        listener: 'not_started' as const,
      },
      safety: {
        localOperatorRequiredForDrafts: true as const,
        mutationRoutesDisabled: true as const,
        outreachDisabled: true as const,
        remoteExecutionDisabled: true as const,
        serverStarted: false as const,
      },
      routes: [],
      blockedRoutes: [],
      acceptanceChecks: ['No HTTP server is started by this shell.'],
    };
    const buildMobileSupervisionGatewayContract = vi.fn(async () => contract);
    const buildMobileSupervisionGatewayListenerShell = vi.fn(() => shell);
    const buildMobileSupervisionPairingState = vi.fn((
      _shell: typeof shell,
      options: { deviceLabel?: string; ttlSeconds?: number },
    ) => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:32:00.000Z',
      kind: 'mobile_supervision_pairing_state' as const,
      mode: 'local_pairing_plan' as const,
      query: shell.query,
      basePath: shell.basePath,
      pairing: {
        acceptedByListener: false as const,
        codeFingerprint: 'abc123abc123abcd',
        deviceLabel: options.deviceLabel,
        expiresAt: '2026-05-18T23:37:00.000Z',
        persisted: false as const,
        previewCode: '123456',
        scopes: shell.auth.scopes,
        status: 'preview_only' as const,
        tokenIssued: false as const,
        ttlSeconds: options.ttlSeconds,
      },
      listener: {
        bindStatus: 'not_started' as const,
        listenerStatus: 'not_started' as const,
        networkExposure: 'loopback_only' as const,
        serverStarted: false as const,
      },
      safety: {
        approvalMutationsDisabled: true as const,
        notAcceptedByAnyServer: true as const,
        pairingRequiresLocalOperator: true as const,
        remoteExecutionDisabled: true as const,
        secretMaterialPersisted: false as const,
      },
      operatorChecklist: ['No listener accepts this preview code.'],
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/mobile-supervision-gateway-contract.js') {
        return { buildMobileSupervisionGatewayContract };
      }
      if (modulePath === 'observability/mobile-supervision-gateway-listener-shell.js') {
        return { buildMobileSupervisionGatewayListenerShell };
      }
      if (modulePath === 'observability/mobile-supervision-pairing-state.js') {
        return { buildMobileSupervisionPairingState };
      }
      return null;
    });

    const response = await buildMobilePairingState({
      deviceLabel: ' Patrice phone ',
      limit: 5,
      query: ' mobile pairing ',
      sources: ['Mobile'],
      ttlSeconds: 120,
    });

    expect(buildMobileSupervisionPairingState).toHaveBeenCalledWith(shell, {
      deviceLabel: 'Patrice phone',
      ttlSeconds: 120,
    });
    expect(response).toMatchObject({
      kind: 'mobile_supervision_pairing_state',
      pairing: {
        deviceLabel: 'Patrice phone',
        status: 'preview_only',
        tokenIssued: false,
      },
      listener: {
        listenerStatus: 'not_started',
        serverStarted: false,
      },
      safety: {
        notAcceptedByAnyServer: true,
        secretMaterialPersisted: false,
      },
    });
  });

  it('builds a mobile pairing acceptance plan through the core module', async () => {
    const contract = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:50:00.000Z',
      mode: 'contract_only' as const,
      basePath: '/api/mobile',
      query: 'mobile pairing',
      auth: {
        required: true as const,
        scheme: 'bearer_or_pairing_code' as const,
        scopes: ['mobile:read', 'mobile:draft'],
        ttlSeconds: 900,
      },
      transport: {
        exposure: 'local_first' as const,
        offDeviceTlsRequired: true as const,
        remoteExecution: 'disabled' as const,
      },
      endpoints: [],
      blockedOperations: [],
    };
    const shell = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:51:00.000Z',
      kind: 'mobile_gateway_listener_shell' as const,
      query: contract.query,
      mode: 'disabled_shell' as const,
      basePath: contract.basePath,
      bind: {
        host: '127.0.0.1' as const,
        networkExposure: 'loopback_only' as const,
        port: 0,
        status: 'not_started' as const,
      },
      auth: contract.auth,
      transport: {
        ...contract.transport,
        listener: 'not_started' as const,
      },
      safety: {
        localOperatorRequiredForDrafts: true as const,
        mutationRoutesDisabled: true as const,
        outreachDisabled: true as const,
        remoteExecutionDisabled: true as const,
        serverStarted: false as const,
      },
      routes: [],
      blockedRoutes: [],
      acceptanceChecks: ['No HTTP server is started by this shell.'],
    };
    const pairingState = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:52:00.000Z',
      kind: 'mobile_supervision_pairing_state' as const,
      mode: 'local_pairing_plan' as const,
      query: shell.query,
      basePath: shell.basePath,
      pairing: {
        acceptedByListener: false as const,
        codeFingerprint: 'abc123abc123abcd',
        deviceLabel: 'Patrice phone',
        expiresAt: '2026-05-18T23:57:00.000Z',
        persisted: false as const,
        previewCode: '123456',
        scopes: shell.auth.scopes,
        status: 'preview_only' as const,
        tokenIssued: false as const,
        ttlSeconds: 120,
      },
      listener: {
        bindStatus: 'not_started' as const,
        listenerStatus: 'not_started' as const,
        networkExposure: 'loopback_only' as const,
        serverStarted: false as const,
      },
      safety: {
        approvalMutationsDisabled: true as const,
        notAcceptedByAnyServer: true as const,
        pairingRequiresLocalOperator: true as const,
        remoteExecutionDisabled: true as const,
        secretMaterialPersisted: false as const,
      },
      operatorChecklist: ['No listener accepts this preview code.'],
    };
    const buildMobileSupervisionGatewayContract = vi.fn(async () => contract);
    const buildMobileSupervisionGatewayListenerShell = vi.fn(() => shell);
    const buildMobileSupervisionPairingState = vi.fn(() => pairingState);
    const buildMobileSupervisionPairingAcceptancePlan = vi.fn((
      state: typeof pairingState,
      options: { localOperatorLabel?: string },
    ) => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-18T23:53:00.000Z',
      kind: 'mobile_supervision_pairing_acceptance_plan' as const,
      mode: 'acceptance_plan_only' as const,
      query: state.query,
      basePath: state.basePath,
      pairing: {
        acceptedByListener: false as const,
        codeFingerprint: state.pairing.codeFingerprint,
        deviceLabel: state.pairing.deviceLabel,
        expiresAt: state.pairing.expiresAt,
        scopes: state.pairing.scopes,
        status: 'preview_only' as const,
        tokenIssued: false as const,
      },
      acceptance: {
        canAcceptNow: false as const,
        localOperatorLabel: options.localOperatorLabel,
        requestId: `mobile-pairing-acceptance-${state.pairing.codeFingerprint}`,
        status: 'blocked_until_listener_exists' as const,
        endpoint: {
          action: 'accept_pairing_code' as const,
          enabled: false as const,
          method: 'POST' as const,
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
        approvalMutationEndpointEnabled: false as const,
        autoAccept: false as const,
        localOnly: true as const,
        remoteExecutionDisabled: true as const,
        secretMaterialPersisted: false as const,
        serverStarted: false as const,
        tokenIssued: false as const,
      },
      operatorChecklist: ['No endpoint enabled.'],
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/mobile-supervision-gateway-contract.js') {
        return { buildMobileSupervisionGatewayContract };
      }
      if (modulePath === 'observability/mobile-supervision-gateway-listener-shell.js') {
        return { buildMobileSupervisionGatewayListenerShell };
      }
      if (modulePath === 'observability/mobile-supervision-pairing-state.js') {
        return { buildMobileSupervisionPairingState };
      }
      if (modulePath === 'observability/mobile-supervision-pairing-acceptance-plan.js') {
        return { buildMobileSupervisionPairingAcceptancePlan };
      }
      return null;
    });

    const response = await buildMobilePairingAcceptancePlan({
      deviceLabel: ' Patrice phone ',
      localOperatorLabel: ' Patrice ',
      query: ' mobile pairing ',
      ttlSeconds: 120,
    });

    expect(buildMobileSupervisionPairingAcceptancePlan).toHaveBeenCalledWith(pairingState, {
      localOperatorLabel: 'Patrice',
    });
    expect(response).toMatchObject({
      kind: 'mobile_supervision_pairing_acceptance_plan',
      mode: 'acceptance_plan_only',
      acceptance: {
        canAcceptNow: false,
        endpoint: {
          enabled: false,
          path: '/api/mobile/pairing/accept',
        },
      },
      safety: {
        approvalMutationEndpointEnabled: false,
        serverStarted: false,
        tokenIssued: false,
      },
    });
  });

  it('builds a mobile approval queue through the core module', async () => {
    const contract = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T00:00:00.000Z',
      mode: 'contract_only' as const,
      basePath: '/api/mobile',
      query: 'mobile approval',
      auth: {
        required: true as const,
        scheme: 'bearer_or_pairing_code' as const,
        scopes: ['mobile:read', 'mobile:draft'],
        ttlSeconds: 900,
      },
      transport: {
        exposure: 'local_first' as const,
        offDeviceTlsRequired: true as const,
        remoteExecution: 'disabled' as const,
      },
      endpoints: [],
      blockedOperations: [],
    };
    const shell = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T00:01:00.000Z',
      kind: 'mobile_gateway_listener_shell' as const,
      query: contract.query,
      mode: 'disabled_shell' as const,
      basePath: contract.basePath,
      bind: {
        host: '127.0.0.1' as const,
        networkExposure: 'loopback_only' as const,
        port: 0,
        status: 'not_started' as const,
      },
      auth: contract.auth,
      transport: {
        ...contract.transport,
        listener: 'not_started' as const,
      },
      safety: {
        localOperatorRequiredForDrafts: true as const,
        mutationRoutesDisabled: true as const,
        outreachDisabled: true as const,
        remoteExecutionDisabled: true as const,
        serverStarted: false as const,
      },
      routes: [],
      blockedRoutes: [],
      acceptanceChecks: ['No HTTP server is started by this shell.'],
    };
    const pairingState = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T00:02:00.000Z',
      kind: 'mobile_supervision_pairing_state' as const,
      mode: 'local_pairing_plan' as const,
      query: shell.query,
      basePath: shell.basePath,
      pairing: {
        acceptedByListener: false as const,
        codeFingerprint: 'abc123abc123abcd',
        deviceLabel: 'Patrice phone',
        expiresAt: '2026-05-19T00:07:00.000Z',
        persisted: false as const,
        previewCode: '123456',
        scopes: shell.auth.scopes,
        status: 'preview_only' as const,
        tokenIssued: false as const,
        ttlSeconds: 300,
      },
      listener: {
        bindStatus: 'not_started' as const,
        listenerStatus: 'not_started' as const,
        networkExposure: 'loopback_only' as const,
        serverStarted: false as const,
      },
      safety: {
        approvalMutationsDisabled: true as const,
        notAcceptedByAnyServer: true as const,
        pairingRequiresLocalOperator: true as const,
        remoteExecutionDisabled: true as const,
        secretMaterialPersisted: false as const,
      },
      operatorChecklist: ['No listener accepts this preview code.'],
    };
    const buildMobileSupervisionGatewayContract = vi.fn(async () => contract);
    const buildMobileSupervisionGatewayListenerShell = vi.fn(() => shell);
    const buildMobileSupervisionPairingState = vi.fn(() => pairingState);
    const buildMobileSupervisionApprovalQueue = vi.fn((
      receivedContract: typeof contract,
      receivedPairing: typeof pairingState,
    ) => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-05-19T00:03:00.000Z',
      kind: 'mobile_supervision_approval_queue' as const,
      mode: 'local_review_queue' as const,
      query: receivedContract.query,
      basePath: receivedContract.basePath,
      pairing: {
        acceptedByListener: false as const,
        deviceLabel: receivedPairing.pairing.deviceLabel,
        status: 'preview_only' as const,
        tokenIssued: false as const,
      },
      listener: {
        listenerStatus: 'not_started' as const,
        serverStarted: false as const,
      },
      counts: {
        blocked: 1,
        pending: 1,
        ready: 0,
        total: 2,
      },
      items: [
        {
          id: 'mobile.followup.draft',
          source: 'gateway_endpoint' as const,
          action: 'draft_followup_prompt',
          description: 'Draft only.',
          method: 'POST' as const,
          path: '/api/mobile/followup-draft',
          status: 'pending_local_operator' as const,
          operatorActions: ['approve_draft' as const, 'cancel_draft' as const],
          reason: 'Requires local operator.',
          localApprovalRequired: true,
          canDispatch: false as const,
        },
      ],
      safety: {
        approvalMutationEndpointEnabled: false as const,
        autoDispatch: false as const,
        localOnly: true as const,
        outreachDisabled: true as const,
        remoteExecutionDisabled: true as const,
      },
    }));
    mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
      if (modulePath === 'observability/mobile-supervision-gateway-contract.js') {
        return { buildMobileSupervisionGatewayContract };
      }
      if (modulePath === 'observability/mobile-supervision-gateway-listener-shell.js') {
        return { buildMobileSupervisionGatewayListenerShell };
      }
      if (modulePath === 'observability/mobile-supervision-pairing-state.js') {
        return { buildMobileSupervisionPairingState };
      }
      if (modulePath === 'observability/mobile-supervision-approval-queue.js') {
        return { buildMobileSupervisionApprovalQueue };
      }
      return null;
    });

    const response = await buildMobileApprovalQueue({
      deviceLabel: ' Patrice phone ',
      query: ' mobile approval ',
      ttlSeconds: 300,
    });

    expect(buildMobileSupervisionApprovalQueue).toHaveBeenCalledWith(contract, pairingState);
    expect(response).toMatchObject({
      kind: 'mobile_supervision_approval_queue',
      counts: {
        pending: 1,
        blocked: 1,
      },
      pairing: {
        tokenIssued: false,
      },
      safety: {
        approvalMutationEndpointEnabled: false,
        autoDispatch: false,
      },
    });
  });
});
