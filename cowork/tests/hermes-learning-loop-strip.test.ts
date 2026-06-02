/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesLearningLoopStrip,
  buildHermesLearningLoopCommand,
  type HermesLearningLoopStatus,
} from '../src/renderer/components/hermes-learning-loop-strip';
import { LESSON_CANDIDATES_UPDATED_EVENT } from '../src/renderer/components/lesson-candidate-review-strip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

const learningStatus: HermesLearningLoopStatus = {
  autoRetrospective: {
    enabled: false,
    envVar: 'CODEBUDDY_LEARNING_AGENT',
    mode: 'disabled',
  },
  commands: {
    candidateReview: 'skill_manage action=candidate_list',
    lessonCandidates: 'buddy lessons candidate list --json',
    retrospective: 'buddy run retrospective <run-id> --force --json',
    runDoctor: 'buddy run doctor --json --limit 6',
    skillUsage: 'buddy skills learning-usage --json',
    userModel: 'buddy user-model show --json',
  },
  generatedAt: '2026-05-31T21:45:00.000Z',
  kind: 'hermes_learning_loop_status',
  nextAction: {
    command: 'buddy lessons candidate show lc-real --json',
    description: 'lesson_candidate review is waiting behind lessonWritesRequireApproval.',
    kind: 'review_queue',
    requiresHumanReview: true,
  },
  ok: true,
  nextRetrospectiveRun: {
    artifactCount: 1,
    channel: 'cowork',
    command: 'buddy run retrospective run-needs-retro --force --json',
    eventCount: 8,
    runId: 'run-needs-retro',
    status: 'completed',
    tags: ['real'],
  },
  recommendations: [
    'Set CODEBUDDY_LEARNING_AGENT=true to enable automatic post-run retrospectives outside forced CLI runs.',
    'Run buddy run retrospective run-needs-retro --force --json on the next finished real run to feed the Learning Agent loop.',
  ],
  reviewGates: {
    lessonWritesRequireApproval: true,
    skillCandidatesRequireReview: true,
    skillLifecycleRequiresApproval: true,
    userModelWritesRequireApproval: true,
  },
  reviewQueue: {
    items: [
      {
        command: 'buddy lessons candidate list --status pending --json',
        description: 'Pending lesson candidates from retrospectives.',
        kind: 'lesson_candidate',
        nextReviewCommand: 'buddy lessons candidate show lc-real --json',
        pendingCount: 1,
        reviewGate: 'lessonWritesRequireApproval',
        sampleIds: ['lc-real'],
      },
      {
        command: 'buddy tools skill-candidate list --eligible-only --json',
        description: 'Pending Learning Agent SKILL.md candidates.',
        kind: 'skill_candidate',
        nextReviewCommand: 'buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/learned-search-view-file-bash --json',
        pendingCount: 1,
        reviewGate: 'skillCandidatesRequireReview',
        sampleIds: ['skill-candidate-real'],
      },
    ],
    totalPending: 2,
  },
  state: {
    recentRuns: [
      {
        artifactCount: 2,
        eventCount: 12,
        hasLearningRetrospective: true,
        runId: 'run-learning-loop',
        status: 'completed',
        tags: ['real'],
      },
      {
        artifactCount: 1,
        channel: 'cowork',
        eventCount: 8,
        hasLearningRetrospective: false,
        runId: 'run-needs-retro',
        status: 'completed',
        tags: ['real'],
      },
    ],
    patterns: {
      deprecatedCount: 0,
      observedCount: 1,
      reinforcedCount: 1,
      total: 2,
    },
    skillCandidates: {
      learningCandidateCount: 1,
      root: 'D:/workspace/.codebuddy/skill-candidates/learning',
      samples: [
        {
          candidateId: 'skill-candidate-real',
          eligible: true,
          inspectCommand: 'buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/learned-search-view-file-bash --json',
          skillName: 'learned-search-view-file-bash',
        },
      ],
    },
    skillUsage: {
      count: 1,
      deprecatedCount: 0,
      reinforcedCount: 1,
      top: [
        {
          invocationCount: 4,
          recommendation: 'reinforce',
          score: 95,
          skillName: 'learned-search-view-file-bash',
        },
      ],
    },
  },
  summary: {
    acceptedUserObservationCount: 3,
    deprecatedSkillCount: 0,
    inspectedRunLimit: 6,
    lessonCandidateCount: 2,
    patternCount: 2,
    pendingLessonCandidateCount: 1,
    pendingReviewCount: 2,
    pendingUserObservationCount: 0,
    recentRunCount: 2,
    retrospectiveCoveragePercent: 50,
    retrospectiveEligibleRunCount: 2,
    reinforcedSkillCount: 1,
    retrospectiveArtifactCount: 1,
    runningRunCount: 2,
    skillUsageCount: 1,
    staleRunningRunCount: 1,
  },
  workDir: 'D:/CascadeProjects/grok-cli',
};

describe('HermesLearningLoopStrip', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('renders count-only Learning Agent loop readiness and review gates', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesLearningLoopStrip, {
          error: 'learning status unavailable',
          status: learningStatus,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-learning-loop"]');
    expect(strip?.textContent).toContain('Hermes learning loop');
    expect(strip?.textContent).toContain('learning attention');
    expect(strip?.textContent).toContain('Runs');
    expect(strip?.textContent).toContain('1/2');
    expect(strip?.textContent).toContain('Candidates');
    expect(strip?.textContent).toContain('1/2');
    expect(strip?.textContent).toContain('Patterns');
    expect(strip?.textContent).toContain('auto disabled');
    expect(strip?.textContent).toContain('50% reviewed');
    expect(strip?.textContent).toContain('3 accepted observations');
    expect(strip?.textContent).toContain('2 pending review');
    expect(strip?.textContent).toContain('Next action');
    expect(strip?.textContent).toContain('review_queue');
    expect(strip?.textContent).toContain('lesson_candidate review is waiting behind lessonWritesRequireApproval.');
    expect(strip?.textContent).toContain('1 reinforced / 0 deprecated');
    expect(strip?.textContent).toContain('1 skill candidates');
    expect(strip?.querySelector('[data-testid="hermes-learning-run-doctor"]')?.textContent)
      .toContain('1 stale / 2 running runs in last 6 inspected');
    expect(strip?.textContent).toContain('buddy run doctor --json --limit 6');
    expect(strip?.textContent).toContain('Review queue');
    expect(strip?.textContent).toContain('lesson_candidate: 1');
    expect(strip?.textContent).toContain('buddy lessons candidate show lc-real --json');
    expect(strip?.querySelector('[data-testid="hermes-learning-next-action"]')?.textContent).toContain('lc-real');
    expect(strip?.textContent).toContain('skill_candidate: 1');
    expect(strip?.textContent).toContain('buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/learned-search-view-file-bash --json');
    expect(strip?.textContent).toContain('Next retrospective');
    expect(strip?.textContent).toContain('run-needs-retro');
    expect(strip?.textContent).toContain('completed | 1 artifacts');
    expect(strip?.textContent).toContain('| 8 events');
    expect(strip?.textContent).toContain('buddy run retrospective run-needs-retro --force --json');
    expect(strip?.querySelector('[data-testid="hermes-learning-retrospective-run-needs-retro"]')).toBeTruthy();
    expect(strip?.textContent).toContain('learned-search-view-file-bash');
    expect(strip?.textContent).toContain('95/100 reinforce');
    expect(strip?.textContent).toContain('Review gates enabled');
    expect(strip?.textContent).toContain('CODEBUDDY_LEARNING_AGENT=true');
    expect(strip?.textContent).toContain('Hermes learning loop load failed');
    expect(strip?.textContent).toContain('learning status unavailable');
    expect(strip?.textContent).toContain('buddy hermes learning status --json');
    expect(strip?.textContent).not.toContain('private observation');
  });

  it('keeps the CLI helper command stable', () => {
    expect(buildHermesLearningLoopCommand()).toBe('buddy hermes learning status --json');
  });

  it('loads status from the readonly Electron bridge when no status is provided', async () => {
    const target = container();
    const refreshedStatus: HermesLearningLoopStatus = {
      ...learningStatus,
      nextRetrospectiveRun: undefined,
      summary: {
        ...learningStatus.summary,
        retrospectiveArtifactCount: 2,
      },
    };
    const get = vi.fn()
      .mockResolvedValueOnce(learningStatus)
      .mockResolvedValueOnce(refreshedStatus);
    const lessonCandidateUpdate = vi.fn();
    const onOpenLessonReview = vi.fn();
    const runRetrospective = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        command: 'buddy run retrospective run-needs-retro --force --json',
        lessonCandidateCount: 2,
        ok: true,
        retrospectiveArtifact: 'learning-retrospective.json',
        runId: 'run-needs-retro',
        skillCandidateCount: 1,
        skillUsageCount: 1,
        skipped: false,
        toolSequence: ['search', 'view_file', 'bash'],
      },
    });
    window.addEventListener(LESSON_CANDIDATES_UPDATED_EVENT, lessonCandidateUpdate);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesLearningLoop?: {
            get: typeof get;
            runRetrospective: typeof runRetrospective;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesLearningLoop: {
          get,
          runRetrospective,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesLearningLoopStrip, {
        cwd: 'D:/CascadeProjects/grok-cli',
        onOpenLessonReview,
      }));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli',
      limit: 6,
    });
    expect(target.textContent).toContain('learned-search-view-file-bash');
    expect(target.textContent).toContain('buddy hermes learning status --json');

    const button = target.querySelector('[data-testid="hermes-learning-retrospective-run-needs-retro"]') as HTMLButtonElement;
    expect(button).toBeTruthy();

    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runRetrospective).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli',
      force: true,
      runId: 'run-needs-retro',
    });
    expect(lessonCandidateUpdate).toHaveBeenCalledTimes(1);
    expect((lessonCandidateUpdate.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      lessonCandidateCount: 2,
      runId: 'run-needs-retro',
      source: 'hermes-learning-loop',
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(target.textContent).toContain('Retrospective saved: learning-retrospective.json | 2 lessons | 1 skills');

    const reviewButton = target.querySelector('[data-testid="hermes-learning-review-lessons"]') as HTMLButtonElement;
    expect(reviewButton?.textContent).toContain('Review lessons');
    await act(async () => {
      reviewButton.click();
    });
    expect(onOpenLessonReview).toHaveBeenCalledTimes(1);
    window.removeEventListener(LESSON_CANDIDATES_UPDATED_EVENT, lessonCandidateUpdate);
  });
});
