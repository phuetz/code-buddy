import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capturing ipcMain.handle (mirrors tests/fleet-ipc.test.ts).
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

const coreLoaderMock = vi.hoisted(() => ({ loadCoreModule: vi.fn(), resolveCoreEntry: vi.fn() }));

vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));
vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: coreLoaderMock.loadCoreModule,
  resolveCoreEntry: coreLoaderMock.resolveCoreEntry,
}));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import { registerLessonCandidateIpcHandlers } from '../src/main/ipc/lessons-candidate-ipc';
import { registerUserModelIpcHandlers } from '../src/main/ipc/user-model-ipc';
import { registerCompanionIpcHandlers } from '../src/main/ipc/companion-ipc';
import { registerSpecIpcHandlers } from '../src/main/ipc/spec-ipc';
import { registerSpecNextIpcHandlers, buildSpecNextArgs } from '../src/main/ipc/spec-next-ipc';

// Project manager source: active project resolves to a workspace path; pass
// `null` to simulate "no active project" (empty-state path).
function projectSource(workspacePath: string | null) {
  if (workspacePath === null) return () => null;
  return () => ({
    getActiveId: () => 'p1',
    getActive: () => ({ id: 'p1', workspacePath }),
    get: (_id: string) => ({ id: 'p1', workspacePath }),
  }) as never;
}

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.handle.mockClear();
  coreLoaderMock.loadCoreModule.mockReset();
  coreLoaderMock.resolveCoreEntry.mockReset();
});

describe('lesson-candidate IPC', () => {
  it('lists candidates from the active project queue', async () => {
    const list = vi.fn(() => [{ id: 'lc-1', category: 'RULE', content: 'Run tsc', status: 'pending' }]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getLessonCandidateQueue: () => ({ list }) });
    registerLessonCandidateIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('lessonCandidate.list');
    const res = (await handler?.({}, 'pending')) as { ok: boolean; items: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(list).toHaveBeenCalledWith('pending');
  });

  it('returns NO_ACTIVE_PROJECT empty-state when no project is selected', async () => {
    registerLessonCandidateIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('lessonCandidate.list');
    await expect(handler?.({})).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT', items: [] });
    // Core module is never even loaded without a workDir.
    expect(coreLoaderMock.loadCoreModule).not.toHaveBeenCalled();
  });

  it('refuses to approve without a reviewer (no silent write)', async () => {
    const approve = vi.fn();
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getLessonCandidateQueue: () => ({ approve }) });
    registerLessonCandidateIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('lessonCandidate.approve');
    const res = (await handler?.({}, 'lc-1', { reviewedBy: '   ' })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewedBy is required/);
    expect(approve).not.toHaveBeenCalled();
  });

  it('approves through the queue and returns the written lesson id', async () => {
    const approve = vi.fn(async () => ({ candidate: { id: 'lc-1', status: 'approved' }, lesson: { id: 'lesson-9' } }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getLessonCandidateQueue: () => ({ approve }) });
    registerLessonCandidateIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('lessonCandidate.approve');
    const res = (await handler?.({}, 'lc-1', { reviewedBy: 'Patrice', content: 'edited' })) as {
      ok: boolean;
      lessonId?: string;
    };
    expect(res.ok).toBe(true);
    expect(res.lessonId).toBe('lesson-9');
    expect(approve).toHaveBeenCalledWith('lc-1', { reviewedBy: 'Patrice', content: 'edited' });
  });
});

describe('user-model IPC', () => {
  it('refuses to accept without a reviewer', async () => {
    const accept = vi.fn();
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getUserModel: () => ({ accept }) });
    registerUserModelIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('userModel.accept');
    const res = (await handler?.({}, 'um-1', {})) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewedBy is required/);
    expect(accept).not.toHaveBeenCalled();
  });

  it('surfaces a privacy refusal as a clean error, not a crash', async () => {
    const accept = vi.fn(() => {
      throw new Error('refused: "salary" is outside the user-model privacy scope (working preferences only)');
    });
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getUserModel: () => ({ accept }) });
    registerUserModelIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('userModel.accept');
    const res = (await handler?.({}, 'um-1', { reviewedBy: 'Patrice' })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/outside the user-model privacy scope/);
  });

  it('lists observations for the active project', async () => {
    const list = vi.fn(() => [{ id: 'um-1', kind: 'preference', content: 'async/await', status: 'pending' }]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getUserModel: () => ({ list }) });
    registerUserModelIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('userModel.list');
    const res = (await handler?.({}, 'pending')) as { ok: boolean; items: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
  });
});

describe('companion IPC', () => {
  it('runs companion setup in the active project and records the first self-state', async () => {
    const setupCompanionMode = vi.fn(async () => ({
      cwd: '/tmp/proj',
      wroteSoul: true,
      wroteBoot: true,
      skippedSoul: false,
      skippedBoot: false,
      voiceConfigured: true,
      modelConfigured: true,
      model: 'gpt-5.5',
      status: { cwd: '/tmp/proj', model: 'gpt-5.5' },
    }));
    const recordCompanionSelfState = vi.fn(async () => ({ id: 'self-1', modality: 'self' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ setupCompanionMode, recordCompanionSelfState });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.setup');
    const res = (await handler?.({}, { configureVoice: true, configureModel: true })) as {
      ok: boolean;
      result?: { selfPercept?: { id: string } };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.selfPercept?.id).toBe('self-1');
    expect(setupCompanionMode).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      forceIdentity: undefined,
      configureVoice: true,
      configureModel: true,
      language: undefined,
      sttProvider: undefined,
      ttsProvider: undefined,
      ttsVoice: undefined,
      model: undefined,
    });
    expect(recordCompanionSelfState).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('loads companion status from the active project workspace', async () => {
    const getCompanionStatus = vi.fn(async () => ({ cwd: '/tmp/proj', model: 'gpt-5.5' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getCompanionStatus });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.status');
    const res = (await handler?.({})) as { ok: boolean; status?: { model: string } };
    expect(res.ok).toBe(true);
    expect(res.status?.model).toBe('gpt-5.5');
    expect(getCompanionStatus).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('returns recent percepts from the active project journal', async () => {
    const readRecentCompanionPercepts = vi.fn(async () => [
      { id: 'p1', modality: 'vision', source: 'camera_snapshot' },
    ]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ readRecentCompanionPercepts });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.percepts.recent');
    const res = (await handler?.({}, { limit: 5, modality: 'vision' })) as { ok: boolean; items: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(readRecentCompanionPercepts).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      limit: 5,
      modality: 'vision',
    });
  });

  it('exposes raw-free quality insights and side-effect-free manual measurement', async () => {
    const readConversationQualityInsights = vi.fn(() => ({
      schemaVersion: 1,
      available: true,
      sampleCount: 3,
      trend: { direction: 'improving' },
      privacy: { verbatimIncluded: false, fingerprintsIncluded: false },
    }));
    const measureConversationQualityNow = vi.fn(async () => ({
      at: 2_000,
      overallScore: 0.84,
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      readConversationQualityInsights,
      measureConversationQualityNow,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const insights = (await electronMock.handlers.get('companion.quality.insights')?.(
      {},
      { windowSize: 12 },
    )) as { ok: boolean; insights?: { sampleCount: number } };
    const measurement = (await electronMock.handlers.get('companion.quality.measure')?.(
      {},
      { limit: 50 },
    )) as { ok: boolean; measurement?: { overallScore: number } };

    expect(insights.ok).toBe(true);
    expect(insights.insights?.sampleCount).toBe(3);
    expect(measurement.ok).toBe(true);
    expect(measurement.measurement?.overallScore).toBe(0.84);
    expect(readConversationQualityInsights).toHaveBeenCalledWith({ windowSize: 12 });
    expect(measureConversationQualityNow).toHaveBeenCalledWith({ limit: 50 });
  });

  it('records companion self-state through the core module', async () => {
    const recordCompanionSelfState = vi.fn(async () => ({ id: 'self-1', modality: 'self' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ recordCompanionSelfState });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.self.record');
    const res = (await handler?.({})) as { ok: boolean; percept?: { id: string } };
    expect(res.ok).toBe(true);
    expect(res.percept?.id).toBe('self-1');
    expect(recordCompanionSelfState).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('exposes companion privacy report, export, and purge through the active workspace', async () => {
    const buildCompanionPrivacyReport = vi.fn(async () => ({ schemaVersion: 1, totalEntries: 3 }));
    const exportCompanionPrivacyBundle = vi.fn(async () => ({ exportDir: '/tmp/proj/export' }));
    const purgeCompanionPrivacyData = vi.fn(async () => ({ purgedAt: 'now', removed: [] }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      buildCompanionPrivacyReport,
      exportCompanionPrivacyBundle,
      purgeCompanionPrivacyData,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const report = (await electronMock.handlers.get('companion.privacy.report')?.({})) as { ok: boolean };
    const exported = (await electronMock.handlers.get('companion.privacy.export')?.({}, { kinds: ['percepts'] })) as { ok: boolean };
    const purged = (await electronMock.handlers.get('companion.privacy.purge')?.({}, { kinds: ['percepts'], backup: true })) as { ok: boolean };

    expect(report.ok).toBe(true);
    expect(exported.ok).toBe(true);
    expect(purged.ok).toBe(true);
    expect(buildCompanionPrivacyReport).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
    expect(exportCompanionPrivacyBundle).toHaveBeenCalledWith({ cwd: '/tmp/proj', kinds: ['percepts'] });
    expect(purgeCompanionPrivacyData).toHaveBeenCalledWith({ cwd: '/tmp/proj', kinds: ['percepts'], backup: true });
  });

  it('runs companion self-evaluation in the active workspace', async () => {
    const evaluateCompanionSelf = vi.fn(async () => ({ id: 'companion-eval-1', score: 80 }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ evaluateCompanionSelf });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.evaluate');
    const res = (await handler?.({}, { recordSuggestions: false })) as {
      ok: boolean;
      evaluation?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.evaluation?.id).toBe('companion-eval-1');
    expect(evaluateCompanionSelf).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      recordSuggestions: false,
    });
  });

  it('builds the companion competitive radar in the active workspace', async () => {
    const buildCompanionCompetitiveRadar = vi.fn(async () => ({ id: 'companion-radar-1', score: 70 }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ buildCompanionCompetitiveRadar });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.radar');
    const res = (await handler?.({}, { recordSuggestions: false })) as {
      ok: boolean;
      radar?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.radar?.id).toBe('companion-radar-1');
    expect(buildCompanionCompetitiveRadar).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      recordSuggestions: false,
    });
  });

  it('runs the companion improvement cycle in the active workspace', async () => {
    const runCompanionImprovementCycle = vi.fn(async () => ({
      id: 'companion-improve-1',
      radar: { id: 'radar-1' },
      board: { missions: [] },
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ runCompanionImprovementCycle });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.improve');
    const res = (await handler?.({}, {
      dryRun: true,
      recordSuggestions: false,
      runMission: false,
    })) as {
      ok: boolean;
      cycle?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.cycle?.id).toBe('companion-improve-1');
    expect(runCompanionImprovementCycle).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      dryRun: true,
      recordSuggestions: false,
      runMission: false,
    });
  });

  it('builds companion impulses in the active workspace', async () => {
    const buildCompanionImpulseBrief = vi.fn(async () => ({
      id: 'companion-impulses-1',
      impulses: [{ id: 'mission-1', priority: 'high' }],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ buildCompanionImpulseBrief });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.impulses');
    const res = (await handler?.({}, { recordSuggestions: false })) as {
      ok: boolean;
      brief?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.brief?.id).toBe('companion-impulses-1');
    expect(buildCompanionImpulseBrief).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      recordSuggestions: false,
    });
  });

  it('builds a companion check-in cue in the active workspace', async () => {
    const buildCompanionCheckIn = vi.fn(async () => ({
      id: 'companion-check-in-1',
      spokenText: 'Je suis la.',
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ buildCompanionCheckIn });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.checkIn');
    const res = (await handler?.({}, {
      userText: 'je suis bloque',
      recordPercept: false,
      createCard: false,
      recordSafety: false,
    })) as {
      ok: boolean;
      cue?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.cue?.id).toBe('companion-check-in-1');
    expect(buildCompanionCheckIn).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      userText: 'je suis bloque',
      recordPercept: false,
      createCard: false,
      recordSafety: false,
    });
  });

  it('reads the companion gateway inbox from the active workspace', async () => {
    const readCompanionGatewayInbox = vi.fn(async () => ({
      schemaVersion: 1,
      kind: 'companion_gateway_inbox',
      generatedAt: '2026-06-07T10:00:00.000Z',
      cwd: '/tmp/proj',
      storePath: '/tmp/proj/.codebuddy/companion/gateway-inbox.json',
      counts: {
        queued: 1,
        ignored: 0,
        highPriority: 1,
        total: 1,
      },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
        outboundDisabledByDefault: true,
        localOnly: true,
      },
      items: [
        {
          id: 'gateway_telegram_1',
          receivedAt: '2026-06-07T10:00:00.000Z',
          channel: 'telegram',
          threadId: 'thread-1',
          sender: { id: 'user-1', name: 'Patrice' },
          sessionKey: 'telegram:thread-1',
          content: {
            preview: 'Peux-tu preparer une reponse ?',
            contentType: 'text',
            attachmentCount: 0,
            redacted: true,
          },
          mode: 'assist',
          priority: 'high',
          status: 'queued',
          proposedAction: {
            type: 'draft_reply',
            label: 'Draft a reply for local approval.',
            requiresLocalApproval: true,
            canAutoDispatch: false,
          },
          safety: {
            outboundDisabled: true,
            localApprovalRequired: true,
            secretRedaction: 'preview_only',
            rawTextStored: false,
          },
          tags: ['gateway-inbox', 'telegram'],
          reason: 'Accepted by companion gateway.',
        },
      ],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ readCompanionGatewayInbox });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.inbox');
    const res = (await handler?.({})) as {
      ok: boolean;
      inbox?: { counts: { queued: number }; safety: { autoDispatch: boolean }; items: unknown[] };
    };
    expect(res.ok).toBe(true);
    expect(res.inbox?.counts.queued).toBe(1);
    expect(res.inbox?.safety.autoDispatch).toBe(false);
    expect(res.inbox?.items).toHaveLength(1);
    expect(coreLoaderMock.loadCoreModule).toHaveBeenCalledWith('companion/gateway-inbox.js');
    expect(readCompanionGatewayInbox).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('reads the companion gateway lifecycle report from the active workspace', async () => {
    const buildCompanionGatewayLifecycleReport = vi.fn(async () => ({
      kind: 'companion_gateway_lifecycle',
      schemaVersion: 1,
      generatedAt: '2026-06-07T10:00:00.000Z',
      cwd: '/tmp/proj',
      profilePath: '/tmp/proj/.codebuddy/companion/gateway-profile.json',
      inboxPath: '/tmp/proj/.codebuddy/companion/gateway-inbox.json',
      outboxPath: '/tmp/proj/.codebuddy/messages/outbox.jsonl',
      summary: {
        channelCount: 8,
        enabledCount: 1,
        actModeCount: 1,
        queuedCount: 0,
        ignoredCount: 0,
        draftCount: 1,
        fleetDraftCount: 1,
        replyDraftCount: 1,
        outboundSendCount: 1,
        failedSendCount: 0,
        blockedSendCount: 0,
        readyChannelCount: 1,
        attentionChannelCount: 0,
      },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
        localApprovalRequired: true,
        sendPolicyRequired: true,
      },
      channels: [
        {
          channel: 'telegram',
          state: 'ready',
          enabled: true,
          mode: 'act',
          allowOutbound: true,
          requireApprovalForTools: true,
          recordPercepts: true,
          queueCount: 0,
          ignoredCount: 0,
          draftCount: 1,
          fleetDraftCount: 1,
          replyDraftCount: 1,
          lastSendStatus: 'preview',
          issues: [],
        },
      ],
      recommendations: [],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ buildCompanionGatewayLifecycleReport });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.lifecycle');
    const res = (await handler?.({})) as {
      ok: boolean;
      report?: { summary: { readyChannelCount: number }; safety: { rawTextStored: boolean }; channels: unknown[] };
    };
    expect(res.ok).toBe(true);
    expect(res.report?.summary.readyChannelCount).toBe(1);
    expect(res.report?.safety.rawTextStored).toBe(false);
    expect(res.report?.channels).toHaveLength(1);
    expect(coreLoaderMock.loadCoreModule).toHaveBeenCalledWith('companion/gateway.js');
    expect(buildCompanionGatewayLifecycleReport).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('reads the companion gateway admin plan from the active workspace', async () => {
    const buildCompanionGatewayAdminPlan = vi.fn(async () => ({
      kind: 'companion_gateway_admin_plan',
      schemaVersion: 1,
      generatedAt: '2026-06-07T10:05:00.000Z',
      cwd: '/tmp/proj',
      profilePath: '/tmp/proj/.codebuddy/companion/gateway-profile.json',
      inboxPath: '/tmp/proj/.codebuddy/companion/gateway-inbox.json',
      outboxPath: '/tmp/proj/.codebuddy/messages/outbox.jsonl',
      safety: {
        dryRun: true,
        requiresLocalApproval: true,
        secretsIncluded: false,
        rawMessageContentIncluded: false,
        executesChannelAdmin: false,
      },
      summary: {
        actionCount: 3,
        channelCount: 1,
        enabledCount: 1,
        attentionChannelCount: 0,
        replayablePreviewCount: 1,
        failedSendCount: 0,
        blockedSendCount: 0,
      },
      actions: [
        {
          id: 'gateway-admin-telegram-reconnect',
          channel: 'telegram',
          action: 'reconnect',
          label: 'Reconnect telegram adapter',
          reason: 'Restart the adapter when lifecycle diagnostics show stale or failed delivery.',
          command: ['buddy', 'channels', 'stop', '--type', 'telegram', '&&', 'buddy', 'channels', 'start', '--type', 'telegram'],
          requiresLocalApproval: true,
          destructive: true,
          available: true,
        },
      ],
      deliveryDiagnostics: {
        outboxPath: '/tmp/proj/.codebuddy/messages/outbox.jsonl',
        counts: {
          preview: 1,
          sent: 0,
          failed: 0,
          blocked: 0,
        },
        replayablePreviews: [
          {
            id: 'outbox-1',
            channel: 'telegram',
            status: 'preview',
            dryRun: true,
            createdAt: '2026-06-07T10:04:00.000Z',
            approved: true,
            hasError: false,
          },
        ],
      },
      recommendations: ['Replay delivery diagnostics as dry-run previews before approving live outbound sends.'],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ buildCompanionGatewayAdminPlan });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.adminPlan');
    const res = (await handler?.({})) as {
      ok: boolean;
      plan?: {
        safety: { secretsIncluded: boolean; executesChannelAdmin: boolean };
        summary: { replayablePreviewCount: number };
        actions: unknown[];
      };
    };
    expect(res.ok).toBe(true);
    expect(res.plan?.safety.secretsIncluded).toBe(false);
    expect(res.plan?.safety.executesChannelAdmin).toBe(false);
    expect(res.plan?.summary.replayablePreviewCount).toBe(1);
    expect(res.plan?.actions).toHaveLength(1);
    expect(coreLoaderMock.loadCoreModule).toHaveBeenCalledWith('companion/gateway.js');
    expect(buildCompanionGatewayAdminPlan).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('executes a confirmed companion gateway admin action from the active workspace', async () => {
    const executeCompanionGatewayAdminAction = vi.fn(async () => ({
      kind: 'companion_gateway_admin_execution_result',
      ok: true,
      adminLogPath: '/tmp/proj/.codebuddy/companion/gateway-admin.jsonl',
      record: {
        id: 'admin-exec-1',
        kind: 'companion_gateway_admin_execution',
        schemaVersion: 1,
        createdAt: '2026-06-07T10:06:00.000Z',
        cwd: '/tmp/proj',
        channel: 'telegram',
        action: 'stop',
        approvedBy: 'Patrice',
        liveAdminConfirmed: true,
        status: 'completed',
        result: {
          stopped: true,
          runtimeBefore: { registered: true, connected: true, authenticated: true },
          runtimeAfter: { registered: false },
        },
      },
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ executeCompanionGatewayAdminAction });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.executeAdminAction');
    const res = (await handler?.({}, {
      action: 'stop',
      channel: 'telegram',
      approvedBy: 'Patrice',
      liveAdminConfirmed: true,
    })) as {
      ok: boolean;
      result?: { ok: boolean; record: { status: string }; adminLogPath: string };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.ok).toBe(true);
    expect(res.result?.record.status).toBe('completed');
    expect(res.result?.adminLogPath).toContain('gateway-admin.jsonl');
    expect(coreLoaderMock.loadCoreModule).toHaveBeenCalledWith('companion/gateway.js');
    expect(executeCompanionGatewayAdminAction).toHaveBeenCalledWith({
      action: 'stop',
      channel: 'telegram',
      approvedBy: 'Patrice',
      liveAdminConfirmed: true,
    }, { cwd: '/tmp/proj' });
  });

  it('drafts a companion gateway inbox item without dispatching it', async () => {
    const draftCompanionGatewayInboxItem = vi.fn(async () => ({
      schemaVersion: 1,
      id: 'draft_gateway_telegram_1',
      sourceItemId: 'gateway_telegram_1',
      createdAt: '2026-06-07T10:01:00.000Z',
      kind: 'autonomous_code_task',
      taskFile: '/tmp/proj/.codebuddy/companion/gateway-drafts/draft_gateway_telegram_1.task.json',
      command: [
        'buddy',
        'autonomous-code',
        '--task-file',
        '/tmp/proj/.codebuddy/companion/gateway-drafts/draft_gateway_telegram_1.task.json',
        '--require-approval',
        '--json',
      ],
      autoDispatch: false,
      requiresLocalApproval: true,
      source: {
        channel: 'telegram',
        threadId: 'thread-1',
        senderId: 'user-1',
        priority: 'high',
        proposedAction: 'prepare_task',
      },
      task: {
        repo: '/tmp/proj',
        task: 'Review preview only.',
        allowedPaths: ['docs/...'],
        verification: ['npm run typecheck'],
        riskLevel: 'low',
        output: 'json',
        branchName: 'companion/gateway-telegram-1',
        maxFilesChanged: 5,
        maxToolRounds: 25,
        memoryPolicy: 'handoff',
        fleetPolicy: 'none',
        edits: [],
      },
      safety: {
        rawTextStored: false,
        previewOnly: true,
        autoDispatch: false,
        requiresLocalApproval: true,
      },
    }));
    const readCompanionGatewayInbox = vi.fn(async () => ({
      schemaVersion: 1,
      kind: 'companion_gateway_inbox',
      generatedAt: '2026-06-07T10:01:00.000Z',
      cwd: '/tmp/proj',
      storePath: '/tmp/proj/.codebuddy/companion/gateway-inbox.json',
      counts: { queued: 0, ignored: 0, highPriority: 1, total: 1 },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
        outboundDisabledByDefault: true,
        localOnly: true,
      },
      items: [],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      draftCompanionGatewayInboxItem,
      readCompanionGatewayInbox,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.draft');
    const res = (await handler?.({}, { itemId: 'gateway_telegram_1' })) as {
      ok: boolean;
      draft?: { autoDispatch: boolean; requiresLocalApproval: boolean; command: string[] };
      inbox?: { counts: { queued: number } };
    };
    expect(res.ok).toBe(true);
    expect(res.draft?.autoDispatch).toBe(false);
    expect(res.draft?.requiresLocalApproval).toBe(true);
    expect(res.draft?.command).toContain('--require-approval');
    expect(res.inbox?.counts.queued).toBe(0);
    expect(draftCompanionGatewayInboxItem).toHaveBeenCalledWith('gateway_telegram_1', { cwd: '/tmp/proj' });
    expect(readCompanionGatewayInbox).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('routes a companion gateway draft into a Fleet draft without dispatching a saga', async () => {
    const routeCompanionGatewayDraftToFleet = vi.fn(async () => ({
      schemaVersion: 1,
      id: 'fleet_draft_gateway_telegram_1',
      sourceItemId: 'gateway_telegram_1',
      sourceDraftId: 'draft_gateway_telegram_1',
      createdAt: '2026-06-07T10:02:00.000Z',
      kind: 'fleet_dispatch_draft',
      draftFile: '/tmp/proj/.codebuddy/companion/gateway-drafts/fleet_draft_gateway_telegram_1.fleet.json',
      dispatchInput: {
        goal: 'Review supervised companion gateway draft.',
        parallelism: 1,
        privacyTag: 'sensitive',
        dispatchProfile: 'safe',
        deliveryChannel: 'companion-gateway:telegram',
        sourceSessionId: 'companion:telegram:thread-1',
      },
      autoDispatch: false,
      requiresLocalApproval: true,
      safety: {
        rawTextStored: false,
        previewOnly: true,
        autoDispatch: false,
        requiresLocalApproval: true,
        outboundChannelReply: false,
      },
    }));
    const readCompanionGatewayInbox = vi.fn(async () => ({
      schemaVersion: 1,
      kind: 'companion_gateway_inbox',
      generatedAt: '2026-06-07T10:02:00.000Z',
      cwd: '/tmp/proj',
      storePath: '/tmp/proj/.codebuddy/companion/gateway-inbox.json',
      counts: { queued: 0, ignored: 0, highPriority: 1, total: 1 },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
        outboundDisabledByDefault: true,
        localOnly: true,
      },
      items: [],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      routeCompanionGatewayDraftToFleet,
      readCompanionGatewayInbox,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.fleetDraft');
    const res = (await handler?.({}, { itemId: 'gateway_telegram_1' })) as {
      ok: boolean;
      fleetDraft?: {
        autoDispatch: boolean;
        dispatchInput: { dispatchProfile: string; privacyTag: string };
        safety: { outboundChannelReply: boolean };
      };
      inbox?: { counts: { queued: number } };
    };
    expect(res.ok).toBe(true);
    expect(res.fleetDraft?.autoDispatch).toBe(false);
    expect(res.fleetDraft?.dispatchInput.dispatchProfile).toBe('safe');
    expect(res.fleetDraft?.dispatchInput.privacyTag).toBe('sensitive');
    expect(res.fleetDraft?.safety.outboundChannelReply).toBe(false);
    expect(res.inbox?.counts.queued).toBe(0);
    expect(routeCompanionGatewayDraftToFleet).toHaveBeenCalledWith('gateway_telegram_1', { cwd: '/tmp/proj' });
    expect(readCompanionGatewayInbox).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('drafts a companion gateway outbound reply only after local review metadata is provided', async () => {
    const draftCompanionGatewayOutboundReply = vi.fn(async () => ({
      schemaVersion: 1,
      id: 'reply_fleet_draft_gateway_telegram_1',
      sourceItemId: 'gateway_telegram_1',
      sourceDraftId: 'draft_gateway_telegram_1',
      sourceFleetDraftId: 'fleet_draft_gateway_telegram_1',
      createdAt: '2026-06-07T10:03:00.000Z',
      kind: 'outbound_reply_draft',
      draftFile: '/tmp/proj/.codebuddy/companion/gateway-drafts/reply_fleet_draft_gateway_telegram_1.reply.json',
      channel: 'telegram',
      channelId: 'thread-1',
      threadId: 'thread-1',
      replyTo: 'message-1',
      contentPreview: 'Approved reply. access_token=[redacted]',
      reviewedBy: 'Patrice',
      autoDispatch: false,
      requiresLocalApproval: true,
      readyToSend: false,
      sendPreview: {
        channel: 'telegram',
        channelId: 'thread-1',
        threadId: 'thread-1',
        replyTo: 'message-1',
        contentPreview: 'Approved reply. access_token=[redacted]',
        sessionKey: 'companion:telegram:thread-1',
        dryRun: true,
      },
      safety: {
        rawTextStored: false,
        previewOnly: true,
        autoDispatch: false,
        requiresLocalApproval: true,
        readyToSend: false,
        outboundChannelReply: false,
      },
    }));
    const readCompanionGatewayInbox = vi.fn(async () => ({
      schemaVersion: 1,
      kind: 'companion_gateway_inbox',
      generatedAt: '2026-06-07T10:03:00.000Z',
      cwd: '/tmp/proj',
      storePath: '/tmp/proj/.codebuddy/companion/gateway-inbox.json',
      counts: { queued: 0, ignored: 0, highPriority: 1, total: 1 },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
        outboundDisabledByDefault: true,
        localOnly: true,
      },
      items: [],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      draftCompanionGatewayOutboundReply,
      readCompanionGatewayInbox,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.outboundReplyDraft');
    const rejected = (await handler?.({}, {
      itemId: 'gateway_telegram_1',
      text: 'Approved reply',
      reviewedBy: ' ',
    })) as { ok: boolean; error?: string };
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/reviewedBy is required/);
    expect(draftCompanionGatewayOutboundReply).not.toHaveBeenCalled();

    const res = (await handler?.({}, {
      itemId: 'gateway_telegram_1',
      text: 'Approved reply. access_token=reply-secret-fixture',
      reviewedBy: 'Patrice',
    })) as {
      ok: boolean;
      replyDraft?: {
        contentPreview: string;
        autoDispatch: boolean;
        readyToSend: boolean;
        safety: { rawTextStored: boolean; outboundChannelReply: boolean };
      };
      inbox?: { counts: { queued: number } };
    };
    expect(res.ok).toBe(true);
    expect(res.replyDraft?.contentPreview).toContain('[redacted]');
    expect(JSON.stringify(res.replyDraft)).not.toContain('reply-secret-fixture');
    expect(res.replyDraft?.autoDispatch).toBe(false);
    expect(res.replyDraft?.readyToSend).toBe(false);
    expect(res.replyDraft?.safety.rawTextStored).toBe(false);
    expect(res.replyDraft?.safety.outboundChannelReply).toBe(false);
    expect(res.inbox?.counts.queued).toBe(0);
    expect(draftCompanionGatewayOutboundReply).toHaveBeenCalledWith(
      'gateway_telegram_1',
      {
        text: 'Approved reply. access_token=reply-secret-fixture',
        reviewedBy: 'Patrice',
      },
      { cwd: '/tmp/proj' },
    );
    expect(readCompanionGatewayInbox).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('sends a companion gateway outbound reply through the approved core send path', async () => {
    const sendCompanionGatewayOutboundReply = vi.fn(async () => ({
      kind: 'companion_gateway_outbound_reply_send_result',
      sourceItemId: 'gateway_telegram_1',
      sourceReplyDraftId: 'reply_fleet_draft_gateway_telegram_1',
      approvedBy: 'Patrice',
      dryRun: false,
      send: {
        ok: true,
        status: 'sent',
        dryRun: false,
        outboxPath: '/tmp/proj/.codebuddy/messages/outbox.jsonl',
        entry: {
          id: 'outbox-1',
          channel: 'telegram',
          channelId: 'thread-1',
          status: 'sent',
          dryRun: false,
          approvedBy: 'Patrice',
          content: 'Approved live reply.',
        },
      },
    }));
    const readCompanionGatewayInbox = vi.fn(async () => ({
      schemaVersion: 1,
      kind: 'companion_gateway_inbox',
      generatedAt: '2026-06-07T10:04:00.000Z',
      cwd: '/tmp/proj',
      storePath: '/tmp/proj/.codebuddy/companion/gateway-inbox.json',
      counts: { queued: 0, ignored: 0, highPriority: 1, total: 1 },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
        outboundDisabledByDefault: true,
        localOnly: true,
      },
      items: [],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      sendCompanionGatewayOutboundReply,
      readCompanionGatewayInbox,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.gateway.sendOutboundReply');
    const rejected = (await handler?.({}, {
      itemId: 'gateway_telegram_1',
      text: 'Approved live reply.',
      approvedBy: ' ',
      dryRun: false,
      liveDeliveryConfirmed: true,
    })) as { ok: boolean; error?: string };
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/approvedBy is required/);
    expect(sendCompanionGatewayOutboundReply).not.toHaveBeenCalled();

    const res = (await handler?.({}, {
      itemId: 'gateway_telegram_1',
      text: 'Approved live reply.',
      approvedBy: 'Patrice',
      dryRun: false,
      liveDeliveryConfirmed: true,
    })) as {
      ok: boolean;
      result?: {
        approvedBy: string;
        dryRun: boolean;
        send: { status: string; outboxPath: string; entry: { approvedBy?: string } };
      };
      inbox?: { counts: { queued: number } };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.approvedBy).toBe('Patrice');
    expect(res.result?.dryRun).toBe(false);
    expect(res.result?.send.status).toBe('sent');
    expect(res.result?.send.outboxPath).toContain('outbox.jsonl');
    expect(res.result?.send.entry.approvedBy).toBe('Patrice');
    expect(res.inbox?.counts.queued).toBe(0);
    expect(sendCompanionGatewayOutboundReply).toHaveBeenCalledWith(
      'gateway_telegram_1',
      {
        text: 'Approved live reply.',
        approvedBy: 'Patrice',
        dryRun: false,
        liveDeliveryConfirmed: true,
      },
      { cwd: '/tmp/proj' },
    );
    expect(readCompanionGatewayInbox).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('reads OpenClaw bridge status from the active workspace without exposing the token', async () => {
    const discovery = {
      detected: true,
      endpoint: 'http://127.0.0.1:8787',
      tokenPresent: true,
      tokenPreview: '<redacted>',
    };
    const descriptor = {
      id: 'openclaw-local',
      kind: 'openclaw_gateway_peer',
      endpoint: 'http://127.0.0.1:8787',
    };
    const discoverOpenClawGateway = vi.fn(async () => discovery);
    const buildOpenClawNodeDescriptor = vi.fn(() => descriptor);
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      discoverOpenClawGateway,
      buildOpenClawNodeDescriptor,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.openclaw.status');
    const res = (await handler?.({}, { source: '/home/u/.openclaw' })) as {
      ok: boolean;
      discovery?: { tokenPreview: string };
      descriptor?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.discovery?.tokenPreview).toBe('<redacted>');
    expect(JSON.stringify(res)).not.toContain('openclaw-secret-fixture');
    expect(res.descriptor?.id).toBe('openclaw-local');
    expect(coreLoaderMock.loadCoreModule).toHaveBeenCalledWith('openclaw/gateway-bridge.js');
    expect(discoverOpenClawGateway).toHaveBeenCalledWith({ cwd: '/tmp/proj', home: '/home/u/.openclaw' });
    expect(buildOpenClawNodeDescriptor).toHaveBeenCalledWith(discovery, { cwd: '/tmp/proj' });
  });

  it('drafts an OpenClaw Fleet handoff without direct dispatch', async () => {
    const prepareOpenClawFleetHandoffDraft = vi.fn(async () => ({
      kind: 'openclaw_fleet_handoff_draft',
      draftFile: '/tmp/proj/.codebuddy/openclaw/bridge/msg-1.fleet.json',
      autoDispatch: false,
      requiresLocalApproval: true,
      dispatchInput: {
        privacyTag: 'sensitive',
        dispatchProfile: 'safe',
      },
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ prepareOpenClawFleetHandoffDraft });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.openclaw.draft');
    const res = (await handler?.({}, {
      channel: 'slack',
      messageId: 'msg-1',
      senderId: 'user-1',
      text: 'Investigate this. token=openclaw-secret-fixture',
    })) as {
      ok: boolean;
      result?: {
        autoDispatch: boolean;
        requiresLocalApproval: boolean;
        dispatchInput: { dispatchProfile: string; privacyTag: string };
      };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.autoDispatch).toBe(false);
    expect(res.result?.requiresLocalApproval).toBe(true);
    expect(res.result?.dispatchInput.dispatchProfile).toBe('safe');
    expect(res.result?.dispatchInput.privacyTag).toBe('sensitive');
    expect(prepareOpenClawFleetHandoffDraft).toHaveBeenCalledWith(
      {
        channel: 'slack',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderName: undefined,
        text: 'Investigate this. token=openclaw-secret-fixture',
        threadId: undefined,
      },
      { cwd: '/tmp/proj' },
    );
  });

  it('requires explicit approval before live OpenClaw attach and send operations', async () => {
    const attachOpenClawGateway = vi.fn(async () => ({ dryRun: false, status: 'attached' }));
    const sendOpenClawResponse = vi.fn(async () => ({ dryRun: false, status: 'sent' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      attachOpenClawGateway,
      sendOpenClawResponse,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const attachHandler = electronMock.handlers.get('companion.openclaw.attach');
    const rejectedAttach = (await attachHandler?.({}, {
      approvedBy: 'Patrice',
      liveAttachConfirmed: false,
    })) as { ok: boolean; error?: string };
    expect(rejectedAttach.ok).toBe(false);
    expect(rejectedAttach.error).toMatch(/liveAttachConfirmed=true/);
    expect(attachOpenClawGateway).not.toHaveBeenCalled();

    const acceptedAttach = (await attachHandler?.({}, {
      approvedBy: 'Patrice',
      endpointPath: '/api/attach',
      liveAttachConfirmed: true,
    })) as { ok: boolean; result?: { status: string } };
    expect(acceptedAttach.ok).toBe(true);
    expect(acceptedAttach.result?.status).toBe('attached');
    expect(attachOpenClawGateway).toHaveBeenCalledWith(
      {
        approvedBy: 'Patrice',
        dryRun: false,
        endpointPath: '/api/attach',
        liveAttachConfirmed: true,
      },
      { cwd: '/tmp/proj', home: undefined },
    );

    const sendHandler = electronMock.handlers.get('companion.openclaw.send');
    const rejectedSend = (await sendHandler?.({}, {
      approvedBy: 'Patrice',
      channel: 'slack',
      liveSendConfirmed: false,
      messageId: 'msg-1',
      text: 'Approved reply.',
    })) as { ok: boolean; error?: string };
    expect(rejectedSend.ok).toBe(false);
    expect(rejectedSend.error).toMatch(/liveSendConfirmed=true/);
    expect(sendOpenClawResponse).toHaveBeenCalledTimes(0);

    const acceptedSend = (await sendHandler?.({}, {
      approvedBy: 'Patrice',
      channel: 'slack',
      liveSendConfirmed: true,
      messageId: 'msg-1',
      text: 'Approved reply.',
    })) as { ok: boolean; result?: { status: string } };
    expect(acceptedSend.ok).toBe(true);
    expect(acceptedSend.result?.status).toBe('sent');
    expect(sendOpenClawResponse).toHaveBeenCalledWith(
      {
        approvedBy: 'Patrice',
        channel: 'slack',
        dryRun: false,
        endpointPath: undefined,
        liveSendConfirmed: true,
        messageId: 'msg-1',
        text: 'Approved reply.',
        threadId: undefined,
      },
      { cwd: '/tmp/proj', home: undefined },
    );
  });

  it('requires explicit approval before live OpenClaw node pairing operations', async () => {
    const listOpenClawPendingNodes = vi.fn(async () => ({ record: { status: 'called' } }));
    const approveOpenClawPendingNode = vi.fn(async () => ({
      record: {
        request: { method: 'nodes.approve', paramKeys: ['code'] },
        status: 'called',
      },
    }));
    const rejectOpenClawPendingNode = vi.fn(async () => ({
      record: {
        request: { method: 'nodes.reject', paramKeys: ['code', 'reason'] },
        status: 'called',
      },
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({
      approveOpenClawPendingNode,
      listOpenClawPendingNodes,
      rejectOpenClawPendingNode,
    });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const pendingHandler = electronMock.handlers.get('companion.openclaw.nodesPending');
    const rejectedPending = (await pendingHandler?.({}, {
      approvedBy: 'Patrice',
      liveCallConfirmed: false,
    })) as { ok: boolean; error?: string };
    expect(rejectedPending.ok).toBe(false);
    expect(rejectedPending.error).toMatch(/liveCallConfirmed=true/);
    expect(listOpenClawPendingNodes).not.toHaveBeenCalled();

    const acceptedPending = (await pendingHandler?.({}, {
      approvedBy: 'Patrice',
      liveCallConfirmed: true,
    })) as { ok: boolean; result?: { record: { status: string } } };
    expect(acceptedPending.ok).toBe(true);
    expect(acceptedPending.result?.record.status).toBe('called');
    expect(listOpenClawPendingNodes).toHaveBeenCalledWith(
      {
        approvedBy: 'Patrice',
        dryRun: false,
        liveCallConfirmed: true,
      },
      { cwd: '/tmp/proj', home: undefined },
    );

    const approveHandler = electronMock.handlers.get('companion.openclaw.nodeApprove');
    const rejectedApprove = (await approveHandler?.({}, {
      approvedBy: 'Patrice',
      code: 'PAIR-CODE-SECRET',
      liveCallConfirmed: false,
    })) as { ok: boolean; error?: string };
    expect(rejectedApprove.ok).toBe(false);
    expect(rejectedApprove.error).toMatch(/liveCallConfirmed=true/);
    expect(approveOpenClawPendingNode).not.toHaveBeenCalled();

    const acceptedApprove = (await approveHandler?.({}, {
      approvedBy: 'Patrice',
      code: 'PAIR-CODE-SECRET',
      liveCallConfirmed: true,
    })) as { ok: boolean; result?: Record<string, unknown> };
    expect(acceptedApprove.ok).toBe(true);
    expect(JSON.stringify(acceptedApprove)).not.toContain('PAIR-CODE-SECRET');
    expect(approveOpenClawPendingNode).toHaveBeenCalledWith(
      {
        approvedBy: 'Patrice',
        code: 'PAIR-CODE-SECRET',
        dryRun: false,
        liveCallConfirmed: true,
        nodeId: undefined,
      },
      { cwd: '/tmp/proj', home: undefined },
    );

    const rejectHandler = electronMock.handlers.get('companion.openclaw.nodeReject');
    const rejectedReject = (await rejectHandler?.({}, {
      approvedBy: 'Patrice',
      code: 'PAIR-CODE-SECRET',
      reason: 'bad pairing secret',
      liveCallConfirmed: false,
    })) as { ok: boolean; error?: string };
    expect(rejectedReject.ok).toBe(false);
    expect(rejectedReject.error).toMatch(/liveCallConfirmed=true/);
    expect(rejectOpenClawPendingNode).not.toHaveBeenCalled();

    const acceptedReject = (await rejectHandler?.({}, {
      approvedBy: 'Patrice',
      code: 'PAIR-CODE-SECRET',
      reason: 'bad pairing secret',
      liveCallConfirmed: true,
    })) as { ok: boolean; result?: Record<string, unknown> };
    expect(acceptedReject.ok).toBe(true);
    expect(JSON.stringify(acceptedReject)).not.toContain('PAIR-CODE-SECRET');
    expect(JSON.stringify(acceptedReject)).not.toContain('bad pairing secret');
    expect(rejectOpenClawPendingNode).toHaveBeenCalledWith(
      {
        approvedBy: 'Patrice',
        code: 'PAIR-CODE-SECRET',
        dryRun: false,
        liveCallConfirmed: true,
        nodeId: undefined,
        reason: 'bad pairing secret',
      },
      { cwd: '/tmp/proj', home: undefined },
    );
  });

  it('syncs companion missions in the active workspace', async () => {
    const syncCompanionMissionBoard = vi.fn(async () => ({ radarId: 'radar-1', board: { missions: [] } }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ syncCompanionMissionBoard });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.missions.sync');
    const res = (await handler?.({}, { recordSuggestions: false })) as {
      ok: boolean;
      result?: { radarId: string };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.radarId).toBe('radar-1');
    expect(syncCompanionMissionBoard).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      recordSuggestions: false,
    });
  });

  it('lists companion missions with a status filter', async () => {
    const readCompanionMissionBoard = vi.fn(async () => ({
      missions: [
        { id: 'm1', status: 'open' },
        { id: 'm2', status: 'done' },
      ],
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ readCompanionMissionBoard });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.missions.list');
    const res = (await handler?.({}, { status: 'open' })) as { ok: boolean; items: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.items).toEqual([{ id: 'm1', status: 'open' }]);
    expect(readCompanionMissionBoard).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('updates companion mission state', async () => {
    const updateCompanionMissionStatus = vi.fn(async () => ({ id: 'm1', status: 'in_progress' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ updateCompanionMissionStatus });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.missions.update');
    const res = (await handler?.({}, { missionId: 'm1', status: 'in_progress' })) as {
      ok: boolean;
      mission?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.mission?.id).toBe('m1');
    expect(updateCompanionMissionStatus).toHaveBeenCalledWith('m1', 'in_progress', { cwd: '/tmp/proj' });
  });

  it('runs the next companion mission in the active workspace', async () => {
    const runNextCompanionMission = vi.fn(async () => ({
      success: true,
      mission: { id: 'm1' },
      briefPath: '/tmp/proj/.codebuddy/companion/mission-runs/m1.md',
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ runNextCompanionMission });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.missions.runNext');
    const res = (await handler?.({}, { dryRun: true })) as {
      ok: boolean;
      result?: { mission?: { id: string } };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.mission?.id).toBe('m1');
    expect(runNextCompanionMission).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      dryRun: true,
    });
  });

  it('returns recent companion safety events from the active workspace', async () => {
    const readRecentCompanionSafetyEvents = vi.fn(async () => [
      { id: 's1', kind: 'mission', action: 'mission_status_update' },
    ]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ readRecentCompanionSafetyEvents });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.safety.recent');
    const res = (await handler?.({}, { limit: 3, kind: 'mission', risk: 'low' })) as {
      ok: boolean;
      items: unknown[];
    };
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(readRecentCompanionSafetyEvents).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      limit: 3,
      kind: 'mission',
      risk: 'low',
    });
  });

  it('returns companion safety ledger stats from the active workspace', async () => {
    const getCompanionSafetyLedgerStats = vi.fn(async () => ({ total: 2 }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getCompanionSafetyLedgerStats });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.safety.stats');
    const res = (await handler?.({})) as { ok: boolean; stats?: { total: number } };
    expect(res.ok).toBe(true);
    expect(res.stats?.total).toBe(2);
    expect(getCompanionSafetyLedgerStats).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('captures camera snapshots in the active workspace', async () => {
    const captureCameraSnapshot = vi.fn(async () => ({ success: true, path: '/tmp/proj/.codebuddy/camera/scene.png' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ captureCameraSnapshot });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.camera.snapshot');
    const res = (await handler?.({}, { timeoutMs: 5000 })) as { ok: boolean; result?: { path: string } };
    expect(res.ok).toBe(true);
    expect(res.result?.path).toContain('scene.png');
    expect(captureCameraSnapshot).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      outputPath: undefined,
      device: undefined,
      timeoutMs: 5000,
    });
  });

  it('inspects camera snapshots in the active workspace', async () => {
    const inspectCameraSnapshot = vi.fn(async () => ({
      success: true,
      path: '/tmp/proj/.codebuddy/camera/scene.png',
      summary: 'Inspected camera image scene.png',
    }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ inspectCameraSnapshot });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.camera.inspect');
    const res = (await handler?.({}, { imagePath: 'scene.png', includeOcr: true, ocrLanguage: 'fra' })) as {
      ok: boolean;
      result?: { summary: string };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.summary).toContain('Inspected');
    expect(inspectCameraSnapshot).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      imagePath: 'scene.png',
      outputPath: undefined,
      device: undefined,
      timeoutMs: undefined,
      includeOcr: true,
      ocrLanguage: 'fra',
    });
  });

  it('returns NO_ACTIVE_PROJECT before loading core modules', async () => {
    registerCompanionIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('companion.percepts.stats');
    await expect(handler?.({})).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT' });
    expect(coreLoaderMock.loadCoreModule).not.toHaveBeenCalled();
  });
});

describe('spec IPC', () => {
  it('lists spec projects', async () => {
    const listProjects = vi.fn(() => [{ id: 'sp-1', title: 'Q2', phase: 'sharding' }]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getSpecStore: () => ({ listProjects }) });
    registerSpecIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('spec.listProjects');
    const res = (await handler?.({})) as { ok: boolean; projects: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.projects).toHaveLength(1);
  });

  it('refuses to approve a story without a reviewer', async () => {
    const approveStory = vi.fn();
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getSpecStore: () => ({ approveStory }) });
    registerSpecIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('spec.approveStory');
    const res = (await handler?.({}, 'sp-1', 'st-1', '  ')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewedBy is required/);
    expect(approveStory).not.toHaveBeenCalled();
  });

  it('surfaces an illegal transition error from the store', async () => {
    const completeStory = vi.fn(() => {
      throw new Error('Illegal transition draft → done for story st-1. Legal next states: approved, blocked.');
    });
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getSpecStore: () => ({ completeStory }) });
    registerSpecIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('spec.completeStory');
    const res = (await handler?.({}, 'sp-1', 'st-1', 'tests pass')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Illegal transition/);
  });

  it('returns NO_ACTIVE_PROJECT empty-state for stories when no project', async () => {
    registerSpecIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('spec.listStories');
    await expect(handler?.({}, 'sp-1')).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT', stories: [] });
  });
});

describe('spec plan IPC (agentic planning)', () => {
  const config = { getAll: () => ({ apiKey: 'k', model: 'm' }) };

  /** Dispatch loadCoreModule by path so plan handlers see store + client + runner. */
  function mockCore(parts: {
    store?: unknown;
    startSpecPlan?: (...a: unknown[]) => unknown;
    advanceSpecPlan?: (...a: unknown[]) => unknown;
  }) {
    class FakeClient {
      async chat() {
        return { choices: [{ message: { content: 'x' } }] };
      }
    }
    coreLoaderMock.loadCoreModule.mockImplementation((p: string) => {
      if (p === 'spec/spec-store.js') return Promise.resolve({ getSpecStore: () => parts.store ?? {} });
      if (p === 'codebuddy/client.js') return Promise.resolve({ CodeBuddyClient: FakeClient });
      if (p === 'spec/spec-plan-runner.js') {
        return Promise.resolve({ startSpecPlan: parts.startSpecPlan, advanceSpecPlan: parts.advanceSpecPlan });
      }
      return Promise.resolve(null);
    });
  }

  it('planStart drafts the PRD through the core runner', async () => {
    const startSpecPlan = vi.fn(async () => ({ projectId: 'sp-9', title: 'Radar' }));
    mockCore({ startSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planStart');
    const res = (await handler?.({}, 'build a radar app')) as { ok: boolean; projectId?: string };
    expect(res.ok).toBe(true);
    expect(res.projectId).toBe('sp-9');
    expect(startSpecPlan).toHaveBeenCalledTimes(1);
  });

  it('planStart fails with a readable error when no API key is configured', async () => {
    const startSpecPlan = vi.fn();
    mockCore({ startSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj')); // no config source

    const handler = electronMock.handlers.get('spec.planStart');
    const res = (await handler?.({}, 'goal')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No API key/);
    expect(startSpecPlan).not.toHaveBeenCalled();
  });

  it('planContinue refuses without a reviewer (no silent advance)', async () => {
    const advanceSpecPlan = vi.fn();
    mockCore({ advanceSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planContinue');
    const res = (await handler?.({}, 'sp-1', '   ')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewer/);
    expect(advanceSpecPlan).not.toHaveBeenCalled();
  });

  it('planContinue advances one phase and returns the result', async () => {
    const advanceSpecPlan = vi.fn(async () => ({ phase: 'architecture', produced: 'architecture' }));
    mockCore({ advanceSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planContinue');
    const res = (await handler?.({}, 'sp-1', 'Patrice')) as {
      ok: boolean;
      result?: { phase: string; produced?: string };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.phase).toBe('architecture');
    expect(advanceSpecPlan).toHaveBeenCalledWith(expect.anything(), expect.any(Function), 'sp-1', 'Patrice');
  });

  it('planStatus reports phase + artifact presence', async () => {
    const store = {
      getProject: () => ({ id: 'sp-1', phase: 'prd', planApprovals: { prd: { by: 'r', at: 1 } } }),
      readArtifact: (_id: string, name: string) => (name === 'prd' ? '# PRD' : null),
      listStories: () => [{ id: 'st-1' }],
    };
    mockCore({ store });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planStatus');
    const res = (await handler?.({}, 'sp-1')) as {
      ok: boolean;
      status?: { phase: string; prd: boolean; architecture: boolean; stories: number };
    };
    expect(res.ok).toBe(true);
    expect(res.status).toMatchObject({ phase: 'prd', prd: true, architecture: false, stories: 1 });
  });
});

describe('spec.next IPC (autonomous runner bridge)', () => {
  it('buildSpecNextArgs maps options to CLI flags', () => {
    expect(buildSpecNextArgs({ storyId: 'st-1' })).toEqual(['spec', 'next', '--story', 'st-1']);
    expect(buildSpecNextArgs({ dryRun: true })).toEqual(['spec', 'next', '--dry-run']);
    expect(
      buildSpecNextArgs({ storyId: 'st-2', fleet: 'read-only-help', allowedPaths: ['src', ' '], verify: ['npm test'], runVerification: true }),
    ).toEqual(['spec', 'next', '--story', 'st-2', '--fleet', 'read-only-help', '--allowed-path', 'src', '--verify', 'npm test', '--run-verification']);
    // 'none' fleet is omitted
    expect(buildSpecNextArgs({ fleet: 'none' })).toEqual(['spec', 'next']);
  });

  it('returns NO_ACTIVE_PROJECT when no project is selected (never spawns)', async () => {
    coreLoaderMock.resolveCoreEntry.mockReturnValue('/core/dist/index.js');
    registerSpecNextIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('spec.next');
    await expect(handler?.({}, { storyId: 'st-1' })).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT' });
  });

  it('fails with a readable error when the core CLI is not built', async () => {
    coreLoaderMock.resolveCoreEntry.mockReturnValue(null);
    registerSpecNextIpcHandlers(projectSource('/tmp/proj'));
    const handler = electronMock.handlers.get('spec.next');
    const res = (await handler?.({}, { storyId: 'st-1' })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not built/i);
  });
});
