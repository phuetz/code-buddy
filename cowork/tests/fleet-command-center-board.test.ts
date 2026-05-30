import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { TFunction } from 'i18next';
import {
  buildHermesPlanGoal,
  summarizeHermesPlanRisks,
} from '../src/renderer/components/hermes-plan-strip';
import {
  AGENT_RUN_METADATA_KEY,
  isAgentRun,
} from '../../src/agent/agent-run-contract.js';
import { buildHermesIntegrationPlan } from '../../src/agent/hermes-agent-profile.js';
import {
  buildAgentRunDraftPreview,
  buildFleetOutcomeChips,
  buildFleetOutcomeDispatchPreset,
  buildFleetOutcomeFollowUpGoal,
  buildFleetOutcomeFollowUpRun,
  buildFleetOutcomeLessonContent,
  buildFleetOutcomeMemoryContent,
  buildFleetDispatchGoalWithMemories,
  buildFleetScheduledDispatchDraft,
  buildFleetScheduledDispatchPrompt,
  buildFleetScheduledRunNowLabel,
  buildFleetScheduledWorkChips,
  formatFleetScheduleRule,
  isFleetActivity,
  isFleetTerminalActivity,
  isFleetScheduledTask,
  outcomeStatusLabel,
  summarizeSagaToolDecisions,
} from '../src/renderer/components/fleet-command-center-helpers';
import type { ScheduleTask } from '../src/renderer/types';

const commandCenterPath = path.resolve(
  process.cwd(),
  'src/renderer/components/FleetCommandCenter.tsx',
);
const helperPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-command-center-helpers.ts',
);
const outcomePanelPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-outcome-panel.tsx',
);
const scheduledWorkPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-scheduled-work-strip.tsx',
);
const sagaBoardPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-saga-board.tsx',
);
const sagaDetailPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-saga-detail.tsx',
);
const memoryStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-memory-strip.tsx',
);
const peerPanelPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-peer-panel.tsx',
);
const hermesPlanStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-plan-strip.tsx',
);
const toolProfileInspectorStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/tool-profile-inspector-strip.tsx',
);
const skillCandidateReviewQueueStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/skill-candidate-review-queue-strip.tsx',
);
const learningSkillUsageStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/learning-skill-usage-strip.tsx',
);

const t = ((key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
  const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
  const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
  return Object.entries(options ?? {}).reduce(
    (value, [optionKey, optionValue]) =>
      value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
    template,
  );
}) as TFunction;

const baseTask: ScheduleTask = {
  id: 'task-1',
  title: 'Nightly fleet review',
  prompt: 'Review open sagas',
  cwd: 'D:/CascadeProjects/grok-cli-weekend',
  runAt: Date.UTC(2026, 4, 16, 22, 0),
  nextRunAt: Date.UTC(2026, 4, 16, 22, 0),
  scheduleConfig: null,
  repeatEvery: null,
  repeatUnit: null,
  enabled: true,
  lastRunAt: null,
  lastRunSessionId: null,
  lastError: null,
  metadata: null,
  createdAt: Date.UTC(2026, 4, 16, 12, 0),
  updatedAt: Date.UTC(2026, 4, 16, 12, 0),
};

describe('FleetCommandCenter saga board', () => {
  it('groups sagas by operational status instead of rendering one flat list', () => {
    const source = [
      fs.readFileSync(commandCenterPath, 'utf8'),
      fs.readFileSync(helperPath, 'utf8'),
      fs.readFileSync(outcomePanelPath, 'utf8'),
      fs.readFileSync(scheduledWorkPath, 'utf8'),
      fs.readFileSync(sagaBoardPath, 'utf8'),
      fs.readFileSync(sagaDetailPath, 'utf8'),
      fs.readFileSync(memoryStripPath, 'utf8'),
      fs.readFileSync(peerPanelPath, 'utf8'),
      fs.readFileSync(hermesPlanStripPath, 'utf8'),
      fs.readFileSync(toolProfileInspectorStripPath, 'utf8'),
      fs.readFileSync(skillCandidateReviewQueueStripPath, 'utf8'),
      fs.readFileSync(learningSkillUsageStripPath, 'utf8'),
    ].join('\n');

    expect(source).toContain('SAGA_BOARD_COLUMNS');
    expect(source).toContain('groupSagasForBoard');
    expect(source).toContain('fleet-saga-board');
    expect(source).toContain('fleet-saga-lane-${columnKey}');
    expect(source).toContain("statuses: ['failed', 'cancelled']");
    expect(source).toContain("t('fleet.sagaBoard.title'");
    expect(source).toContain('selectedSagaId');
    expect(source).toContain('onSelectSaga');
    expect(source).toContain('SagaDetail');
    expect(source).toContain("t('fleet.sagaDetail'");
    expect(source).toContain('getScheduleApi');
    expect(source).toContain('ScheduledWorkStrip');
    expect(source).toContain('fleet-scheduled-work');
    expect(source).toContain('upcomingScheduledTasks');
    expect(source).toContain('getActivityApi');
    expect(source).toContain('FleetOutcomeStrip');
    expect(source).toContain('FleetMemoryStrip');
    expect(source).toContain('fleet-memory-context');
    expect(source).toContain('includeMemoryContext');
    expect(source).toContain('const hasMemories = memories.length > 0');
    expect(source).toContain('dispatchProfile');
    expect(source).toContain('toolPolicy');
    expect(source).toContain('hasToolMetadata');
    expect(source).toContain("t('fleet.detail.toolPolicy'");
    expect(source).toContain('summarizeSagaToolDecisions');
    expect(source).toContain('data-testid="fleet-saga-tool-decision-summary"');
    expect(source).toContain('buildFleetInternetProofStepLabels');
    expect(source).toContain('data-testid="fleet-saga-internet-proof-loop"');
    expect(source).toContain("t('fleet.detail.internetProofLoop'");
    expect(source).toContain('FLEET_DISPATCH_PROFILES');
    expect(source).toContain('HermesPlanStrip');
    expect(source).toContain('fleet-hermes-plan');
    expect(source).toContain('ToolProfileInspectorStrip');
    expect(source).toContain('fleet-tool-profile-inspector');
    expect(source).toContain('summarizeToolProfileDecisions');
    expect(source).toContain('SkillCandidateReviewQueueStrip');
    expect(source).toContain('fleet-skill-candidate-review-queue');
    expect(source).toContain('LearningSkillUsageStrip');
    expect(source).toContain('fleet-learning-skill-usage');
    expect(source).toContain('buddy skills learning-usage --json');
    expect(source).toContain('getSkillCandidateApi');
    expect(source).toContain('skillCandidate?: SkillCandidateApiBridge');
    expect(source).toContain('setSkillCandidates(list)');
    expect(source).toContain('eligibleOnly: true');
    expect(source).toContain('candidates={skillCandidates}');
    expect(source).toContain('error={skillCandidateLoadError}');
    expect(source).toContain('handleUseSkillCandidateReviewAsGoal');
    expect(source).toContain('buildSkillCandidateReviewQueueGoal');
    expect(source).toContain('handleUseHermesPlanAsGoal');
    expect(source).toContain('buildHermesIntegrationPlan');
    expect(source).toContain('buildHermesPlanGoal');
    expect(source).toContain('buildFleetDispatchGoalContext');
    expect(source).toContain('fleet-recent-outcomes');
    expect(source).toContain('isFleetTerminalActivity');
    expect(source).toContain('isFleetScheduledTaskActivity');
    expect(source).toContain('selectedOutcomeId');
    expect(source).toContain('FleetOutcomeDetail');
    expect(source).toContain('onUseAsGoal');
    expect(source).toContain('handleUseOutcomeAsGoal');
    expect(source).toContain('buildAgentRunDraftPreview');
    expect(source).toContain('data-testid="fleet-agent-run-draft-preview"');
    expect(source).toContain('buildDispatchRunMetadata(goalRunDraft)');
    expect(source).toContain("t('fleet.outcomeDetail'");
    expect(source).toContain('finalResultPreview');
    expect(source).toContain('errorSummary');
    expect(source).toContain('chatSessions');
    expect(source).toContain("t('fleet.detail.chatSessions'");
    expect(source).toContain("t('fleet.detail.turnCount'");
    expect(source).toContain('buildFleetScheduledWorkChips');
    expect(source).toContain('formatFleetScheduleRule');
    expect(source).toContain('isFleetScheduledTask');
    expect(source).toContain('const fleetRank');
    expect(source).toContain('const fleetCount');
    expect(source).toContain("t('fleet.scheduledWork.fleetCount'");
    expect(source).toContain('lastRunSessionId');
    expect(source).toContain("t('fleet.scheduledWork.errorChip'");
    expect(source).toContain("t('fleet.scheduledWork.hermesPlanChip'");
    expect(source).toContain('runningScheduledTaskId');
    expect(source).toContain('handleRunScheduledTaskNow');
    expect(source).toContain('isFleetScheduledTask(updated) && updated.lastRunSessionId');
    expect(source).toContain('setSelectedSagaId(updated.lastRunSessionId)');
    expect(source).toContain('setSelectedPeerId(null)');
    expect(source).toContain('setSelectedOutcomeId(null)');
    expect(source).toContain('const loadFleetActivities = useCallback');
    expect(source).toContain('const refreshRunNowContext = async () =>');
    expect(source).toContain('await loadFleetActivities();');
    expect(source).toContain('handleOpenScheduleSettings');
    expect(source).toContain('handleScheduleDispatch');
    expect(source).toContain('scheduleDispatchGoal');
    expect(source).toContain('handleScheduleHermesPlan');
    expect(source).toContain('buildFleetScheduledDispatchDraft');
    expect(source).toContain('buildFleetScheduledDispatchPrompt');
    expect(source).toContain('buildFleetInternetProofPlan');
    expect(source).toContain('buildInternetProofSummaryMetadata');
    expect(source).toContain('setScheduleDraft');
    expect(source).toContain('fleetGoalDraft');
    expect(source).toContain('setFleetGoalDraft(null)');
    expect(source).toContain('setGoalText(fleetGoalDraft.goal)');
    expect(source).toContain('targetPeerIds: dispatchPeerTargets.map((peer) => peer.id)');
    expect(source).toContain('targetPeerLabels: dispatchPeerTargets.map((peer) => peer.label)');
    expect(source).toContain("source: 'fleet-command-center'");
    expect(source).toContain('dispatchGoal,');
    expect(source).toContain('dispatchProfile,');
    expect(source).toContain('privacyTag,');
    expect(source).toContain('parallelism,');
    expect(source).toContain('peerCount: targetPeerIds.length');
    expect(source).toContain('targetPeerIds: scheduledPeerTargets.map((peer) => peer.id)');
    expect(source).toContain('targetPeerLabels: scheduledPeerTargets.map((peer) => peer.label)');
    expect(source).toContain("deliveryChannel: 'cowork-schedule'");
    expect(source).toContain('includeMemoryContext,');
    expect(source).toContain('const dispatchMemories =');
    expect(source).toContain('const scheduleMemories =');
    expect(source).toContain('includeMemoryContext: scheduleMemories.length > 0');
    expect(source).toContain('memoryCount: scheduleMemories.length');
    expect(source).toContain('proofMetadata: internetProofMetadata');
    expect(source).toContain('...proofMetadata');
    expect(source).toContain("hermesPlanId: 'hermes-integration-plan'");
    expect(source).toContain("hermesPlanSurface: 'cowork'");
    expect(source).toContain('hermesPlanProfile: dispatchProfile');
    expect(source).toContain("setSettingsTab('schedule')");
    expect(source).toContain('setShowSettings(true)');
    expect(source).toContain('runNow?: (taskId: string) => Promise<ScheduleTask | null>');
    expect(source).toContain("t('fleet.scheduledWork.runNow'");
    expect(source).toContain("t('fleet.scheduledWork.openSettings'");
    expect(source).toContain("t('fleet.scheduleDispatch'");
    expect(source).toContain("t('fleet.hermesPlan.schedule'");
    // GAP-8: the lessons vault cockpit is reachable — the strip's Browse trigger
    // toggles state that mounts the previously-dead LessonsVaultGraph modal.
    expect(source).toContain("import { LessonsVaultGraph } from './LessonsVaultGraph'");
    expect(source).toContain('showLessonsGraph');
    expect(source).toContain('onBrowse={() => setShowLessonsGraph(true)}');
    expect(source).toContain('<LessonsVaultGraph onClose={() => setShowLessonsGraph(false)} />');
  });

  it('builds a Cowork dispatch goal from the Hermes plan contract', () => {
    const plan = buildHermesIntegrationPlan('safe');
    const goal = buildHermesPlanGoal(plan);
    const risks = summarizeHermesPlanRisks(plan);

    expect(goal).toContain('Run this Hermes integration plan from Cowork.');
    expect(goal).toContain('Dispatch profile: safe');
    expect(goal).toContain('Toolset: fleet.hermes.safe');
    expect(goal).toContain('Recommended CLI check: buddy hermes doctor safe --json');
    expect(goal).toContain('Interaction surfaces:');
    expect(goal).toContain('- Cowork: Render the checklist');
    expect(goal).toContain('Export a navigable lessons vault [prepare, local-write]');
    expect(goal).toContain('Acceptance: The generated vault includes a manifest.json file.');
    expect(risks).toEqual({ readOnly: 2, localWrite: 1, interactive: 1 });
  });

  it('builds a reusable dispatch goal from a persisted Fleet outcome', () => {
    const commandCenterSource = fs.readFileSync(commandCenterPath, 'utf8');
    const helperSource = fs.readFileSync(helperPath, 'utf8');
    const outcomePanelSource = fs.readFileSync(outcomePanelPath, 'utf8');
    const reusableOutcome = {
      id: 7,
      type: 'fleet.saga.completed',
      title: 'Fleet saga completed',
      description: 'Hermes follow-up',
      timestamp: Date.UTC(2026, 4, 18, 16, 0),
      metadata: {
        privacyTag: 'sensitive',
        dispatchProfile: 'research',
      },
    };
    const unsafeOutcome = {
      ...reusableOutcome,
      metadata: {
        privacyTag: 'internal-only',
        dispatchProfile: 'unbounded',
      },
    };

    expect(commandCenterSource).toContain('setGoalText(draft)');
    expect(commandCenterSource).toContain('buildFleetOutcomeDispatchPreset(entry)');
    expect(buildFleetOutcomeDispatchPreset(reusableOutcome)).toEqual({
      privacyTag: 'sensitive',
      dispatchProfile: 'research',
    });
    expect(buildFleetOutcomeDispatchPreset(unsafeOutcome)).toEqual({});
    expect(outcomePanelSource).toContain('buildFleetOutcomeFollowUpGoal');
    expect(outcomePanelSource).toContain('fleet.detail.useOutcomeAsGoal');
    expect(outcomePanelSource).toContain('fleet.detail.saveOutcomeMemory');
    expect(outcomePanelSource).toContain('fleet.detail.saveOutcomeLesson');
    expect(outcomePanelSource).toContain("addMemory('pattern', memoryContent)");
    expect(outcomePanelSource).toContain("addLesson('PATTERN', lessonContent)");
    expect(helperSource).toContain('export function buildFleetOutcomeMemoryContent');
    expect(helperSource).toContain('export function buildFleetOutcomeLessonContent');
    expect(helperSource).toContain('export function buildFleetDispatchGoalWithMemories');
    expect(helperSource).toContain('export function buildFleetDispatchGoalWithProfile');
    expect(helperSource).toContain('export function buildFleetDispatchGoalContext');
    expect(helperSource).toContain('export const FLEET_DISPATCH_PROFILES');
    expect(helperSource).toContain('export function isFleetOutcomeMemory');
    expect(helperSource).toContain('Fleet outcome lesson');
    expect(helperSource).toContain('export function buildFleetOutcomeFollowUpGoal');
    expect(helperSource).toContain('fleet.followUp.heading');
    expect(helperSource).toContain('fleet.followUp.finalResultPreview');
    expect(helperSource).toContain('fleet.followUp.errorSummary');
  });

  it('summarizes scheduled work rule, last run, session and error metadata', () => {
    expect(formatFleetScheduleRule({
      ...baseTask,
      scheduleConfig: { kind: 'daily', times: ['08:00', '18:00'] },
    }, t)).toBe('Daily at 08:00, 18:00');

    const chips = buildFleetScheduledWorkChips({
      ...baseTask,
      repeatEvery: 2,
      repeatUnit: 'hour',
      lastRunAt: Date.UTC(2026, 4, 16, 20, 0),
      lastRunSessionId: 'session-abcdef123456',
      lastError: 'network timeout',
      metadata: {
        source: 'fleet-command-center',
        dispatchProfile: 'review',
        privacyTag: 'sensitive',
        peerCount: 2,
        targetPeerLabels: ['alpha', 'beta'],
        deliveryChannel: 'cowork-schedule',
        memoryCount: 2,
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        internetProofStepCount: 5,
        internetProofRequiredCount: 4,
        internetProofAssertionCount: 1,
      },
    }, t);

    expect(chips[0]).toBe('Every 2 hours');
    expect(chips).toContain('Saga session-');
    expect(chips).toContain('Fleet');
    expect(chips).toContain('Hermes safe');
    expect(chips).toContain('Profile review');
    expect(chips).toContain('Privacy sensitive');
    expect(chips).toContain('2 peers');
    expect(chips).toContain('Targets alpha, beta');
    expect(chips).toContain('Channel cowork-schedule');
    expect(chips).toContain('Memory 2');
    expect(chips).toContain('web proof 5/4 assert 1');
    expect(chips).toContain('Last error');
    expect(chips.some((chip) => chip.startsWith('Last '))).toBe(true);
  });

  it('labels run-now actions with Fleet and Hermes lineage for icon-only buttons', () => {
    expect(buildFleetScheduledRunNowLabel(baseTask, t)).toBe('Run now');
    expect(buildFleetScheduledRunNowLabel({
      ...baseTask,
      metadata: { source: 'fleet-command-center' },
    }, t)).toBe('Run Fleet task now');
    expect(buildFleetScheduledRunNowLabel({
      ...baseTask,
      metadata: {
        source: 'fleet-command-center',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
      },
    }, t)).toBe('Run Hermes safe now');
    expect(buildFleetScheduledRunNowLabel({
      ...baseTask,
      metadata: {
        source: 'fleet-command-center',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
      },
    }, t, true)).toBe('Running Hermes safe');
  });

  it('builds a schedule-ready Fleet dispatch prompt without losing profile metadata', () => {
    const prompt = buildFleetScheduledDispatchPrompt(
      'Refactor the Fleet command center.',
      'review',
      'sensitive',
      3,
      t,
      {
        targetPeerIds: ['alpha-id', 'beta-id'],
        targetPeerLabels: ['alpha', 'beta'],
        deliveryChannel: 'cowork-schedule',
      },
    );

    expect(prompt).toContain('Run this scheduled Fleet dispatch.');
    expect(prompt).toContain('Profile: review');
    expect(prompt).toContain('Privacy: sensitive');
    expect(prompt).toContain('Parallelism: 3');
    expect(prompt).toContain('Target peer IDs: alpha-id, beta-id');
    expect(prompt).toContain('Target peers: alpha, beta');
    expect(prompt).toContain('Delivery channel: cowork-schedule');
    expect(prompt).toContain('Refactor the Fleet command center.');
  });

  it('builds a schedule draft with Hermes plan lineage metadata', () => {
    const draft = buildFleetScheduledDispatchDraft({
      dispatchGoal: 'Run the Hermes Cowork checklist.',
      dispatchProfile: 'safe',
      privacyTag: 'public',
      parallelism: 2,
      targetPeerIds: ['peer-a', 'peer-b'],
      targetPeerLabels: ['local-alpha', 'local-beta'],
      deliveryChannel: 'cowork-schedule',
      includeMemoryContext: true,
      memoryCount: 1,
      proofMetadata: {
        internetProofStepCount: 4,
        internetProofRequiredCount: 3,
      },
      metadataExtras: {
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanSurface: 'cowork',
        hermesPlanProfile: 'safe',
      },
      t,
    });

    expect(draft.scheduleMode).toBe('once');
    expect(draft.enabled).toBe(true);
    expect(draft.prompt).toContain('Run this scheduled Fleet dispatch.');
    expect(draft.prompt).toContain('Profile: safe');
    expect(draft.prompt).toContain('Target peer IDs: peer-a, peer-b');
    expect(draft.prompt).toContain('Target peers: local-alpha, local-beta');
    expect(draft.prompt).toContain('Run the Hermes Cowork checklist.');
    expect(draft.metadata).toMatchObject({
      source: 'fleet-command-center',
      dispatchGoal: 'Run the Hermes Cowork checklist.',
      dispatchProfile: 'safe',
      privacyTag: 'public',
      parallelism: 2,
      peerCount: 2,
      includeMemoryContext: true,
      memoryCount: 1,
      internetProofStepCount: 4,
      internetProofRequiredCount: 3,
      hermesPlanId: 'hermes-integration-plan',
      hermesPlanSurface: 'cowork',
      hermesPlanProfile: 'safe',
    });
    expect(draft.metadata.targetPeerIds).toEqual(['peer-a', 'peer-b']);
    expect(draft.metadata.targetPeerLabels).toEqual(['local-alpha', 'local-beta']);
    expect(draft.metadata.agentRunId).toEqual(expect.stringMatching(/^agent-run-cowork-/));
    expect(draft.metadata.agentRunSchemaVersion).toBe(1);

    const agentRun = draft.metadata[AGENT_RUN_METADATA_KEY];
    expect(isAgentRun(agentRun)).toBe(true);
    if (!isAgentRun(agentRun)) {
      throw new Error('Expected Fleet schedule draft to include an AgentRun contract');
    }
    expect(agentRun).toMatchObject({
      source: 'cowork',
      status: 'draft',
      title: 'Scheduled Fleet dispatch',
      prompt: 'Run the Hermes Cowork checklist.',
      profile: 'safe',
      privacyTag: 'public',
      lineage: {
        deliveryChannel: 'cowork-schedule',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        hermesPlanSurface: 'cowork',
      },
      memory: {
        included: true,
        count: 1,
      },
      fleet: {
        peerCount: 2,
        targetPeerIds: ['peer-a', 'peer-b'],
        targetPeerLabels: ['local-alpha', 'local-beta'],
      },
      proof: {
        stepCount: 4,
        requiredCount: 3,
      },
      toolPolicy: {
        toolsetId: 'fleet.hermes.safe',
        profile: 'safe',
      },
    });
  });

  it('detects Fleet-origin scheduled tasks for cockpit prioritization', () => {
    expect(isFleetScheduledTask(baseTask)).toBe(false);
    expect(
      isFleetScheduledTask({
        ...baseTask,
        metadata: { source: 'fleet-command-center' },
      }),
    ).toBe(true);
  });

  it('summarizes route tool decisions across saga steps', () => {
    const summary = summarizeSagaToolDecisions({
      id: 'saga-1',
      goal: 'Review a patch',
      status: 'running',
      finalResult: undefined,
      createdAt: Date.now(),
      steps: [
        {
          peerId: 'peer-a',
          model: 'reviewer',
          lane: 'primary',
          status: 'running',
          toolDecisions: [
            { tool: 'view_file', action: 'allow' },
            { tool: 'create_file', action: 'deny' },
          ],
        },
        {
          peerId: 'peer-b',
          model: 'fallback',
          lane: 'fallback',
          status: 'pending',
          toolDecisions: [
            { tool: 'web_fetch', action: 'confirm' },
          ],
        },
      ],
    });

    expect(summary).toEqual({
      allow: 1,
      confirm: 1,
      deny: 1,
      total: 3,
    });
  });

  it('keeps Fleet outcome tool-policy counts visible in recent outcome chips', () => {
    const chips = buildFleetOutcomeChips({
      id: 1,
      type: 'fleet.saga.completed',
      title: 'Fleet saga completed',
      description: 'Review complete',
      metadata: {
        sagaId: 'saga-abcdef123456',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        hermesPlanSurface: 'cowork',
        dispatchProfile: 'review',
        targetPeerLabels: ['alpha', 'beta'],
        deliveryChannel: 'cowork-schedule',
        memoryCount: 2,
        completedSteps: 2,
        totalSteps: 2,
        toolDecisionCount: 4,
        toolAllowCount: 1,
        toolConfirmCount: 1,
        toolDenyCount: 2,
        toolsetId: 'fleet.hermes.review',
      },
      timestamp: Date.now(),
    }, t);

    expect(chips).toEqual([
      'saga saga-abc',
      'Hermes safe',
      'review',
      'Targets alpha, beta',
      'Channel cowork-schedule',
      'Memory 2',
      '2/2 done',
      'fleet.hermes.review tools 1/1/2',
    ]);
  });

  it('keeps Fleet internet proof context visible in outcome chips, memory, and follow-up goals', () => {
    const entry = {
      id: 2,
      type: 'fleet.saga.completed',
      title: 'Fleet saga completed',
      description: 'Research complete',
      metadata: {
        sagaId: 'saga-proof123456',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanSurface: 'cowork',
        hermesPlanProfile: 'safe',
        dispatchProfile: 'research',
        targetPeerLabels: ['alpha', 'beta'],
        deliveryChannel: 'cowork-schedule',
        memoryCount: 1,
        completedSteps: 3,
        totalSteps: 3,
        toolDecisionCount: 3,
        toolAllowCount: 2,
        toolConfirmCount: 1,
        toolDenyCount: 0,
        internetProofStepCount: 5,
        internetProofRequiredCount: 4,
        internetProofAssertionCount: 1,
        internetProofSteps: [
          { id: 'static-read', tool: 'web_fetch' },
          { id: 'observe', tool: 'browser', action: 'observe' },
          { id: 'extract', tool: 'browser', action: 'extract' },
          { id: 'assert', tool: 'browser', action: 'assert_text' },
          { id: 'persist', tool: 'remember' },
        ],
      },
      timestamp: Date.now(),
    };

    expect(buildFleetOutcomeChips(entry, t)).toContain('web proof 5/4 assert 1');

    const memoryContent = buildFleetOutcomeMemoryContent(entry);
    const lessonContent = buildFleetOutcomeLessonContent(entry);
    expect(memoryContent).toContain('hermes=id=hermes-integration-plan, profile=safe, surface=cowork');
    expect(memoryContent).toContain('targets=alpha, beta');
    expect(memoryContent).toContain('channel=cowork-schedule');
    expect(memoryContent).toContain('memory=1');
    expect(memoryContent).toContain('toolPolicy=tools 2/1/0');
    expect(memoryContent).toContain('webProof=5/4 steps, 1 assertion');
    expect(memoryContent).toContain('proofSteps=static-read:web_fetch');
    expect(memoryContent).toContain('assert:browser.assert_text');
    expect(lessonContent).toContain('[[fleet-outcome]] [[agent-run-lineage]]');
    expect(lessonContent).toContain('Outcome id: 2');
    expect(lessonContent).toContain('Hermes context: id=hermes-integration-plan, profile=safe, surface=cowork');
    expect(lessonContent).toContain('Target peers: alpha, beta');
    expect(lessonContent).toContain('Web proof: 5/4 steps, 1 assertion');
    expect(lessonContent).toContain('Do not silently write lessons from outcomes');

    const followUpGoal = buildFleetOutcomeFollowUpGoal(entry, t);
    expect(followUpGoal).toContain('Hermes plan: id=hermes-integration-plan, profile=safe, surface=cowork');
    expect(followUpGoal).toContain('Targets: alpha, beta');
    expect(followUpGoal).toContain('Delivery channel: cowork-schedule');
    expect(followUpGoal).toContain('Memory context: 1');
    expect(followUpGoal).toContain('Tool policy: tools 2/1/0');
    expect(followUpGoal).toContain('Web proof: 5/4 steps, 1 assertion');
    expect(followUpGoal).toContain('Proof steps: static-read:web_fetch');
    expect(followUpGoal).toContain('persist:remember');

    const dispatchGoal = buildFleetDispatchGoalWithMemories(
      'Continue the verified internet research.',
      [{
        category: 'pattern',
        content: memoryContent,
        timestamp: Date.now(),
      }],
      t,
    );

    expect(dispatchGoal).toContain('Continue the verified internet research.');
    expect(dispatchGoal).toContain('Relevant Fleet memories:');
    expect(dispatchGoal).toContain('toolPolicy=tools 2/1/0');
    expect(dispatchGoal).toContain('webProof=5/4 steps, 1 assertion');
    expect(dispatchGoal).toContain('proofSteps=static-read:web_fetch');
  });

  it('turns a Fleet outcome follow-up into a canonical AgentRun draft', () => {
    const entry = {
      id: 4,
      type: 'fleet.saga.completed',
      title: 'Fleet saga completed',
      description: 'Hermes follow-up ready',
      metadata: {
        agentRunId: 'agent-run-cowork-parent',
        sagaId: 'saga-followup123456',
        status: 'completed',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanSurface: 'cowork',
        hermesPlanProfile: 'safe',
        dispatchProfile: 'research',
        privacyTag: 'public',
        targetPeerIds: ['peer-a', 'peer-b'],
        targetPeerLabels: ['alpha', 'beta'],
        deliveryChannel: 'cowork-schedule',
        memoryCount: 2,
        internetProofStepCount: 5,
        internetProofRequiredCount: 4,
        internetProofAssertionCount: 1,
        internetProofSteps: [
          { id: 'static-read', tool: 'web_fetch' },
          { id: 'assert', tool: 'browser', action: 'assert_text' },
        ],
      },
      timestamp: Date.now(),
    };
    const followUpGoal = buildFleetOutcomeFollowUpGoal(entry, t);
    const agentRun = buildFleetOutcomeFollowUpRun({ entry, followUpGoal, t });
    const preview = buildAgentRunDraftPreview(agentRun, t);

    expect(isAgentRun(agentRun)).toBe(true);
    expect(agentRun).toMatchObject({
      source: 'cowork',
      status: 'draft',
      title: 'Fleet outcome follow-up',
      prompt: followUpGoal,
      profile: 'research',
      privacyTag: 'public',
      lineage: {
        outcomeId: '4',
        parentRunId: 'agent-run-cowork-parent',
        sagaId: 'saga-followup123456',
        deliveryChannel: 'cowork-schedule',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        hermesPlanSurface: 'cowork',
      },
      memory: {
        included: true,
        count: 2,
      },
      fleet: {
        peerCount: 2,
        targetPeerIds: ['peer-a', 'peer-b'],
        targetPeerLabels: ['alpha', 'beta'],
      },
      proof: {
        stepCount: 5,
        requiredCount: 4,
        assertionCount: 1,
        steps: [
          { id: 'static-read', tool: 'web_fetch' },
          { id: 'assert', tool: 'browser', action: 'assert_text' },
        ],
      },
      toolPolicy: {
        toolsetId: 'fleet.hermes.research',
        profile: 'research',
      },
      metadata: {
        outcomeTitle: 'Fleet saga completed',
        outcomeDescription: 'Hermes follow-up ready',
        outcomeStatus: 'completed',
        sourceActivityType: 'fleet.saga.completed',
      },
    });
    expect(preview).toMatchObject({
      title: 'Follow-up run draft',
      runId: agentRun.id,
    });
    expect(preview.chips).toEqual([
      `run ${agentRun.id.slice(0, 8)}`,
      'parent agent-ru',
      'outcome 4',
      'Hermes safe',
      'profile research',
      'privacy public',
      '2 peers',
      'targets alpha, beta',
      'memory 2',
      'web proof 5/4 assert 1',
      'fleet.hermes.research',
    ]);
    expect(preview.promptPreview).toContain('Continue from this Fleet outcome.');
  });

  it('surfaces Fleet scheduled dispatch failures as reusable command-center outcomes', () => {
    const entry = {
      id: 3,
      type: 'scheduledTask.failed',
      title: 'Scheduled task failed',
      description: 'Nightly Fleet review',
      metadata: {
        source: 'fleet-command-center',
        taskId: 'task-abcdef123456',
        scheduleKind: 'daily',
        dispatchProfile: 'review',
        privacyTag: 'sensitive',
        error: 'No peer with known capabilities',
        internetProofStepCount: 4,
        internetProofRequiredCount: 3,
      },
      timestamp: Date.now(),
    };

    expect(isFleetActivity(entry)).toBe(true);
    expect(isFleetTerminalActivity(entry)).toBe(true);
    expect(outcomeStatusLabel(entry)).toBe('failed');
    expect(buildFleetOutcomeChips(entry, t)).toEqual([
      'task task-abc',
      'daily',
      'sensitive',
      'review',
      'web proof 4/3 steps',
      'error',
    ]);

    const memoryContent = buildFleetOutcomeMemoryContent(entry);
    expect(memoryContent).toContain('status=failed');
    expect(memoryContent).toContain('error=No peer with known capabilities');

    const followUpGoal = buildFleetOutcomeFollowUpGoal(entry, t);
    expect(followUpGoal).toContain('Status: failed');
    expect(followUpGoal).toContain('Previous error summary');
    expect(followUpGoal).toContain('No peer with known capabilities');
  });
});
