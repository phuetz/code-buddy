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
    skillUsage: 'buddy skills learning-usage --json',
    userModel: 'buddy user-model show --json',
  },
  generatedAt: '2026-05-31T21:45:00.000Z',
  kind: 'hermes_learning_loop_status',
  ok: true,
  nextRetrospectiveRun: {
    artifactCount: 1,
    channel: 'cowork',
    command: 'buddy run retrospective run-needs-retro --force --json',
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
  state: {
    recentRuns: [
      {
        artifactCount: 2,
        hasLearningRetrospective: true,
        runId: 'run-learning-loop',
        status: 'completed',
        tags: ['real'],
      },
      {
        artifactCount: 1,
        channel: 'cowork',
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
    lessonCandidateCount: 2,
    patternCount: 2,
    pendingLessonCandidateCount: 1,
    recentRunCount: 2,
    reinforcedSkillCount: 1,
    retrospectiveArtifactCount: 1,
    skillUsageCount: 1,
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
    expect(strip?.textContent).toContain('3 accepted observations');
    expect(strip?.textContent).toContain('1 reinforced / 0 deprecated');
    expect(strip?.textContent).toContain('1 skill candidates');
    expect(strip?.textContent).toContain('Next retrospective');
    expect(strip?.textContent).toContain('run-needs-retro');
    expect(strip?.textContent).toContain('completed | 1 artifacts');
    expect(strip?.textContent).toContain('buddy run retrospective run-needs-retro --force --json');
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
    const get = vi.fn().mockResolvedValue(learningStatus);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesLearningLoop?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesLearningLoop: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesLearningLoopStrip, { cwd: 'D:/CascadeProjects/grok-cli' }));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli',
      limit: 6,
    });
    expect(target.textContent).toContain('learned-search-view-file-bash');
    expect(target.textContent).toContain('buddy hermes learning status --json');
  });
});
