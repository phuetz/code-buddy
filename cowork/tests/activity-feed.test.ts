import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildActivityActionLines,
  buildFleetActivityChips,
  buildFleetInternetProofStepLabels,
  buildScheduledTaskActivityChips,
  filterActivityEntries,
  isFleetActivity,
  shouldOpenFleetCommandCenter,
  shouldOpenScheduleSettings,
  shouldRenderFleetActivityMeta,
  shouldRenderScheduledTaskActivityMeta,
  type ActivityEntry,
} from '../src/renderer/components/activity-feed-helpers';

const activityFeedComponentPath = path.resolve(
  process.cwd(),
  'src/renderer/components/ActivityFeed.tsx',
);
const activityFeedHelperPath = path.resolve(
  process.cwd(),
  'src/renderer/components/activity-feed-helpers.ts',
);
const activityFeedServicePath = path.resolve(
  process.cwd(),
  'src/main/activity/activity-feed.ts',
);
const mainIndexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('ActivityFeed scheduled-task visibility', () => {
  it('records and renders scheduled task lifecycle activity without prompt content metadata', () => {
    const componentSource = fs.readFileSync(activityFeedComponentPath, 'utf8');
    const helperSource = fs.readFileSync(activityFeedHelperPath, 'utf8');
    const serviceSource = fs.readFileSync(activityFeedServicePath, 'utf8');
    const mainSource = fs.readFileSync(mainIndexPath, 'utf8');

    expect(serviceSource).toContain("'scheduledTask.started'");
    expect(serviceSource).toContain("'scheduledTask.failed'");
    expect(componentSource).toContain("'scheduledTask.started': CalendarClock");
    expect(helperSource).toContain('isScheduledTaskActivity');
    expect(helperSource).toContain("type ActivityFilter = 'all' | 'fleet' | 'scheduled'");
    expect(componentSource).toContain('filterActivityEntries(entries, filter)');
    expect(componentSource).toContain("setSettingsTab('schedule')");
    expect(componentSource).toContain('shouldOpenScheduleSettings(entry)');
    expect(componentSource).toContain('shouldOpenFleetCommandCenter(entry)');
    expect(componentSource).toContain("t('activity.filterScheduled'");
    expect(componentSource).toContain("t('activity.emptyScheduled'");
    expect(componentSource).toContain('ScheduledTaskActivityMeta');
    expect(componentSource).toContain('ActivityActionRail');
    expect(componentSource).toContain('buildActivityActionLines(entry)');
    expect(helperSource).toContain('buildActivityActionLines');
    expect(helperSource).toContain('readLatestCommandSummary(metadata)');
    expect(componentSource).toContain('buildFleetInternetProofStepLabels');
    expect(componentSource).toContain('const proofSteps = buildFleetInternetProofStepLabels(metadata);');
    expect(helperSource).toContain('buildScheduledTaskActivityChips');
    expect(componentSource).toContain('shouldRenderFleetActivityMeta(entry)');
    expect(componentSource).toContain('shouldRenderScheduledTaskActivityMeta(entry)');
    expect(helperSource).toContain('isFleetScheduledTaskActivity');
    expect(helperSource).toContain("entry.metadata?.source === 'fleet-command-center'");
    expect(helperSource).toContain("metadata.source === 'fleet-command-center'");
    expect(helperSource).toContain("typeof metadata.dispatchProfile === 'string'");
    expect(helperSource).toContain("typeof metadata.privacyTag === 'string'");
    expect(helperSource).toContain('appendRunLineageChips(chips, metadata)');
    expect(helperSource).toContain('buildHermesPlanChip(metadata)');
    expect(helperSource).toContain("parallel ${metadata.parallelism}");
    expect(helperSource).toContain("memory ${metadata.memoryCount}");
    expect(mainSource).toContain("type: 'scheduledTask.started'");
    expect(mainSource).toContain("type: 'scheduledTask.failed'");
    expect(mainSource).toContain('buildScheduledTaskActivityMetadata');
    expect(mainSource).toContain('buildScheduledTaskFleetMetadata');
    expect(mainSource).toContain('buildScheduledTaskCreateMetadata');
    expect(mainSource).toContain('buildInternetProofSummaryMetadata');
    expect(mainSource).toContain('metadata.agentRunId');
    expect(mainSource).toContain('metadata.parentRunId');
    expect(mainSource).toContain('metadata.outcomeId');
    expect(mainSource).toContain('metadata.agentRunSchemaVersion');
    expect(mainSource).toContain('metadata.includeMemoryContext');
    expect(mainSource).toContain('metadata.memoryCount');
    expect(mainSource).toContain('metadata.peerCount');
    expect(mainSource).toContain('metadata.targetPeerIds');
    expect(mainSource).toContain('metadata.targetPeerLabels');
    expect(mainSource).toContain('metadata.deliveryChannel');
    expect(mainSource).toContain('metadata.internetProofStepCount');
    expect(mainSource).toContain('metadata.internetProofSteps');
    expect(mainSource).not.toContain('prompt: task.prompt');
  });

  it('keeps Fleet-origin scheduled events in both filters but renders one metadata family', () => {
    const fleetDispatch: ActivityEntry = {
      id: 1,
      type: 'fleet.dispatch',
      title: 'Dispatch',
      timestamp: 1,
    };
    const fleetScheduledRun: ActivityEntry = {
      id: 2,
      type: 'scheduledTask.started',
      title: 'Scheduled Fleet',
      metadata: {
        source: 'fleet-command-center',
        taskId: 'task-abcdef123456',
        sessionId: 'session-abcdef123456',
        sessionShortId: 'session-a',
        sagaId: 'saga-abcdef123456',
        sagaShortId: 'saga-a',
        agentRunId: 'run-followup123456',
        parentRunId: 'run-parent123456',
        outcomeId: 'outcome-abcdef123456',
        scheduleKind: 'daily',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        privacyTag: 'sensitive',
        dispatchProfile: 'review',
        parallelism: 3,
        peerCount: 2,
        targetPeerLabels: ['alpha', 'beta'],
        deliveryChannel: 'cowork-schedule',
        memoryCount: 2,
        toolDecisionCount: 3,
        toolAllowCount: 1,
        toolConfirmCount: 1,
        toolDenyCount: 1,
        internetProofStepCount: 5,
        internetProofRequiredCount: 4,
        internetProofAssertionCount: 1,
        internetProofSteps: [
          {
            id: 'static-read',
            title: 'Read the source cheaply',
            tool: 'web_fetch',
            evidence: 'static-read',
            required: true,
          },
          {
            id: 'assert',
            title: 'Assert the expected page state',
            tool: 'browser',
            action: 'assert_text',
            evidence: 'assertion',
            required: true,
          },
        ],
      },
      timestamp: 2,
    };
    const manualScheduledRun: ActivityEntry = {
      id: 3,
      type: 'scheduledTask.failed',
      title: 'Manual scheduled',
      metadata: { taskId: 'task-manual', error: 'timeout' },
      timestamp: 3,
    };

    const entries = [fleetDispatch, fleetScheduledRun, manualScheduledRun];

    expect(filterActivityEntries(entries, 'fleet')).toEqual([
      fleetDispatch,
      fleetScheduledRun,
    ]);
    expect(filterActivityEntries(entries, 'scheduled')).toEqual([
      fleetScheduledRun,
      manualScheduledRun,
    ]);
    expect(isFleetActivity(manualScheduledRun)).toBe(false);

    expect(shouldRenderFleetActivityMeta(fleetDispatch)).toBe(true);
    expect(shouldRenderFleetActivityMeta(fleetScheduledRun)).toBe(false);
    expect(shouldRenderScheduledTaskActivityMeta(fleetScheduledRun)).toBe(true);
    expect(shouldOpenScheduleSettings(fleetScheduledRun)).toBe(true);
    expect(shouldOpenFleetCommandCenter(fleetScheduledRun)).toBe(false);
    expect(shouldOpenFleetCommandCenter(fleetDispatch)).toBe(true);

    expect(buildScheduledTaskActivityChips(fleetScheduledRun.metadata ?? {})).toEqual([
      'task task-abc',
      'saga saga-a',
      'run run-foll',
      'parent run-pare',
      'outcome outcome-',
      'daily',
      'fleet',
      'hermes safe',
      'sensitive',
      'review',
      'parallel 3',
      '2 peers',
      'targets alpha, beta',
      'channel cowork-schedule',
      'memory 2',
      'tools 1/1/1',
      'web proof 5/4 assert 1',
    ]);
    expect(buildFleetInternetProofStepLabels(fleetScheduledRun.metadata ?? {})).toEqual([
      '1. Read the source cheaply - web_fetch - static-read',
      '2. Assert the expected page state - browser.assert_text - assertion',
    ]);
  });

  it('labels legacy Fleet scheduled run session ids as sagas', () => {
    expect(buildScheduledTaskActivityChips({
      source: 'fleet-command-center',
      taskId: 'task-abcdef123456',
      sessionId: 'saga-legacy123456',
      sessionShortId: 'saga-leg',
    })).toEqual([
      'task task-abc',
      'saga saga-leg',
      'fleet',
    ]);
  });

  it('keeps Fleet tool-policy counts visible on terminal activity chips', () => {
    expect(buildFleetActivityChips({
      sagaId: 'saga-abcdef123456',
      agentRunId: 'run-terminal123456',
      parentRunId: 'run-parent123456',
      outcomeId: 'outcome-abcdef123456',
      hermesPlanId: 'hermes-integration-plan',
      hermesPlanProfile: 'safe',
      completedSteps: 1,
      totalSteps: 2,
      toolDecisionCount: 3,
      toolAllowCount: 1,
      toolConfirmCount: 1,
      toolDenyCount: 1,
      durationMs: 1_250,
    })).toEqual([
      'saga saga-abc',
      'run run-term',
      'parent run-pare',
      'outcome outcome-',
      'hermes safe',
      '1/2 done',
      'tools 1/1/1',
      '1s',
    ]);
  });

  it('keeps Fleet internet proof-loop counts visible on terminal activity chips', () => {
    expect(buildFleetActivityChips({
      sagaId: 'saga-abcdef123456',
      completedSteps: 2,
      totalSteps: 2,
      internetProofStepCount: 5,
      internetProofRequiredCount: 4,
      internetProofAssertionCount: 1,
    })).toEqual([
      'saga saga-abc',
      '2/2 done',
      'web proof 5/4 assert 1',
    ]);
  });

  it('builds Codex-like action lines from proof commands and proof metadata', () => {
    const entry: ActivityEntry = {
      id: 4,
      type: 'fleet.saga.completed',
      title: 'Fleet saga completed',
      metadata: {
        proofCommands: [
          {
            command: 'npm run typecheck',
            durationMs: 2200,
            sequence: 1,
            success: true,
            toolName: 'shell_exec',
          },
          {
            command: 'npm test -- tests/cowork/proof.test.ts --run',
            durationMs: 912,
            sequence: 2,
            success: true,
            toolName: 'shell_exec',
          },
        ],
        completedSteps: 2,
        totalSteps: 2,
        durationMs: 1250,
        internetProofStepCount: 5,
        internetProofRequiredCount: 4,
        internetProofAssertionCount: 1,
        finalResultPreview: 'OK',
      },
      timestamp: 4,
    };

    expect(buildActivityActionLines(entry)).toEqual([
      {
        label: 'passed 912ms npm test -- tests/cowork/proof.test.ts --run (2 commands)',
        tone: 'success',
        title: 'npm test -- tests/cowork/proof.test.ts --run',
      },
      { label: 'Steps 2/2 in 1s', tone: 'success' },
      { label: 'Proof 5/4, 1 assertion', tone: 'neutral' },
      { label: 'Result: OK', tone: 'success', title: 'OK' },
    ]);
  });

  it('builds warning action lines from failed direct command metadata', () => {
    const entry: ActivityEntry = {
      id: 5,
      type: 'fleet.saga.failed',
      title: 'Fleet saga failed',
      metadata: {
        lastCommandText: 'npm test -- tests/cowork/proof.test.ts --run',
        lastCommandStatus: 'failed',
        lastCommandDurationMs: 1220,
        completedSteps: 0,
        failedSteps: 1,
        totalSteps: 2,
        status: 'failed',
        errorSummary: 'test assertion failed',
      },
      timestamp: 5,
    };

    expect(buildActivityActionLines(entry)).toEqual([
      {
        label: 'failed 1.2s npm test -- tests/cowork/proof.test.ts --run',
        tone: 'warning',
        title: 'npm test -- tests/cowork/proof.test.ts --run',
      },
      { label: 'Steps 0/2, 1 failed', tone: 'warning' },
      {
        label: 'Error: test assertion failed',
        tone: 'warning',
        title: 'test assertion failed',
      },
    ]);
  });

  it('keeps Fleet internet proof-loop required counts visible without assertions', () => {
    expect(buildFleetActivityChips({
      internetProofStepCount: 4,
      internetProofRequiredCount: 3,
      internetProofAssertionCount: 0,
    })).toEqual([
      'web proof 4/3',
    ]);
  });

  it('renders Fleet internet proof-loop steps as compact labels', () => {
    expect(buildFleetInternetProofStepLabels({
      internetProofSteps: [
        {
          id: 'observe',
          title: 'Observe page state before acting',
          tool: 'browser',
          action: 'observe',
          evidence: 'observation',
          required: true,
        },
        {
          id: 'persist',
          title: 'Persist only proven durable facts',
          tool: 'remember',
          evidence: 'memory',
          required: false,
        },
      ],
    })).toEqual([
      '1. Observe page state before acting - browser.observe - observation',
      '2. Persist only proven durable facts - remember - memory optional',
    ]);
  });
});
