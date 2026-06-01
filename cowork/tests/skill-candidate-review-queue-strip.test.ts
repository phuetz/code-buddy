/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SkillCandidateReviewQueueStrip,
  buildSkillCandidateReviewCommands,
  buildSkillCandidateReviewQueueGoal,
  buildSkillCandidateSideBySideDiffRows,
} from '../src/renderer/components/skill-candidate-review-queue-strip';

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

describe('SkillCandidateReviewQueueStrip', () => {
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

  it('renders the CLI review queue and seeds a safe Fleet goal', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(SkillCandidateReviewQueueStrip, {
          candidates: [
            {
              candidateDiffPreview: {
                addedLines: 1,
                preview: 'Candidate changes learned-search-view-file-bash/SKILL.md with 1 addition and 1 removal\n--- a/learned-search-view-file-bash/SKILL.md\n+++ b/learned-search-view-file-bash/SKILL.md\n- Old procedure\n+ New procedure',
                removedLines: 1,
                summary: 'Candidate changes learned-search-view-file-bash/SKILL.md with 1 addition and 1 removal',
                truncated: false,
              },
              eligible: true,
              installState: 'installed-different',
              installedIntegrityOk: true,
              installedVersion: '0.1.0',
              kind: 'learning',
              reason: '2 successful runs met the promotion threshold.',
              reviewCommands: [
                'skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/learning/learned-search-view-file-bash/SKILL.md',
                'skill_manage action=candidate_install candidate_path=.codebuddy/skill-candidates/learning/learned-search-view-file-bash/SKILL.md approved_by=<reviewer> overwrite=true',
              ],
              skillName: 'learned-search-view-file-bash',
              skillPath: '.codebuddy/skill-candidates/learning/learned-search-view-file-bash/SKILL.md',
              sourceJobId: '',
              sourceRunId: 'run-learning-architect',
              successfulRunCount: 2,
              toolSequence: ['search', 'view_file', 'bash'],
            },
          ],
          error: 'candidate manifest is unreadable',
          onUseAsGoal,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-skill-candidate-review-queue"]');
    expect(strip?.textContent).toContain('Skill candidate review');
    expect(strip?.textContent).toContain('1 eligible');
    expect(strip?.textContent).toContain('human approval required');
    expect(strip?.textContent).toContain('no auto-install');
    expect(strip?.textContent).toContain('Candidate queue load failed');
    expect(strip?.textContent).toContain('candidate manifest is unreadable');
    expect(strip?.textContent).toContain('learned-search-view-file-bash');
    expect(strip?.textContent).toContain('Learning Agent');
    expect(strip?.textContent).toContain('installed differs');
    expect(strip?.textContent).toContain('Installed: v0.1.0');
    expect(strip?.textContent).toContain('Candidate changes learned-search-view-file-bash/SKILL.md');
    expect(strip?.textContent).toContain('- Old procedure');
    expect(strip?.textContent).toContain('+ New procedure');
    expect(strip?.textContent).toContain('Show side-by-side diff');
    expect(strip?.textContent).toContain('run-learning-architect');
    expect(strip?.textContent).toContain('Tools: search -> view_file -> bash');
    expect(strip?.textContent).toContain('skill_manage action=candidate_view');
    expect(strip?.textContent).toContain('buddy tools skill-candidate list --eligible-only --json');
    expect(strip?.textContent).toContain('buddy tools skill-candidate inspect <candidate-dir>');

    const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Review queue as goal')
    );
    expect(button?.textContent).toContain('Review queue as goal');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Review the shared SKILL.md candidate queue from Cowork.');
    expect(goal).toContain('Learning Agent retrospective candidates.');
    expect(goal).toContain('buddy tools skill-candidate list --eligible-only --json');
    expect(goal).toContain('Do not install a candidate automatically.');
    expect(goal).toContain('Install only after a human reviewer approves with --approved-by.');
  });

  it('hides installed-current candidates from the actionable Cowork queue', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(SkillCandidateReviewQueueStrip, {
          candidates: [
            {
              eligible: true,
              installState: 'installed-current',
              kind: 'learning',
              reason: 'Already approved and installed.',
              reviewCommands: [
                'skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/learning/already-installed/SKILL.md',
                'skill_manage action=view name=already-installed',
              ],
              skillName: 'already-installed',
              skillPath: '.codebuddy/skill-candidates/learning/already-installed/SKILL.md',
              sourceJobId: 'learning-agent',
              sourceRunId: 'run-current',
              successfulRunCount: 2,
            },
            {
              eligible: true,
              installState: 'not-installed',
              kind: 'learning',
              reason: '2 successful runs met the promotion threshold.',
              reviewCommands: [
                'skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/learning/ready/SKILL.md',
                'skill_manage action=candidate_install candidate_path=.codebuddy/skill-candidates/learning/ready/SKILL.md approved_by=<reviewer>',
              ],
              skillName: 'ready',
              skillPath: '.codebuddy/skill-candidates/learning/ready/SKILL.md',
              sourceJobId: 'learning-agent',
              sourceRunId: 'run-ready',
              successfulRunCount: 2,
            },
          ],
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-skill-candidate-review-queue"]');
    expect(strip?.textContent).toContain('1 eligible');
    expect(strip?.textContent).toContain('ready');
    expect(strip?.textContent).not.toContain('already-installed');
    expect(target.querySelector('[data-testid="skill-candidate-install-ready"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="skill-candidate-install-already-installed"]')).toBeNull();
  });

  it('expands candidate-vs-installed SKILL.md diffs into a side-by-side review panel', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(SkillCandidateReviewQueueStrip, {
          candidates: [
            {
              candidateDiffPreview: {
                addedLines: 1,
                preview: [
                  'Candidate changes learned-search-view-file-bash/SKILL.md with 1 addition and 1 removal',
                  '--- a/learned-search-view-file-bash/SKILL.md',
                  '+++ b/learned-search-view-file-bash/SKILL.md',
                  '@@ -1,3 +1,3 @@',
                  ' # Setup',
                  '-Old procedure',
                  '+New procedure',
                  ' Keep review gates',
                ].join('\n'),
                removedLines: 1,
                summary: 'Candidate changes learned-search-view-file-bash/SKILL.md with 1 addition and 1 removal',
                truncated: true,
              },
              eligible: true,
              installState: 'installed-different',
              kind: 'learning',
              reason: '2 successful runs met the promotion threshold.',
              skillName: 'learned-search-view-file-bash',
              skillPath: '.codebuddy/skill-candidates/learning/learned-search-view-file-bash/SKILL.md',
              sourceJobId: '',
              sourceRunId: 'run-learning-architect',
              successfulRunCount: 2,
            },
          ],
        }),
      );
    });

    const toggle = target.querySelector(
      '[data-testid="skill-candidate-toggle-diff-learned-search-view-file-bash"]',
    ) as HTMLButtonElement;
    expect(toggle.textContent).toContain('Show side-by-side diff');

    act(() => {
      Simulate.click(toggle);
    });

    const panel = target.querySelector(
      '[data-testid="skill-candidate-side-by-side-learned-search-view-file-bash"]',
    );
    expect(panel?.textContent).toContain('1 added / 1 removed');
    expect(panel?.textContent).toContain('preview truncated');
    expect(panel?.textContent).toContain('Installed SKILL.md');
    expect(panel?.textContent).toContain('Candidate SKILL.md');
    expect(panel?.textContent).toContain('Old procedure');
    expect(panel?.textContent).toContain('New procedure');
    expect(panel?.textContent).toContain('Keep review gates');
  });

  it('keeps the command and goal helpers aligned', () => {
    const commands = buildSkillCandidateReviewCommands();
    const goal = buildSkillCandidateReviewQueueGoal();

    expect(commands).toEqual([
      'buddy tools skill-candidate list --eligible-only --json',
      'buddy tools skill-candidate inspect <candidate-dir>',
      'buddy tools skill-candidate install <candidate-dir> --approved-by <name>',
    ]);
    for (const command of commands.slice(0, 2)) {
      expect(goal).toContain(command);
    }
  });

  it('parses unified diff previews into side-by-side rows', () => {
    const rows = buildSkillCandidateSideBySideDiffRows([
      'Candidate changes review-helper/SKILL.md with 1 addition and 1 removal',
      '--- a/review-helper/SKILL.md',
      '+++ b/review-helper/SKILL.md',
      '@@ -1,3 +1,3 @@',
      ' # Review Helper',
      '-Old checklist',
      '+New checklist',
      ' Keep guardrails',
    ].join('\n'));

    expect(rows).toEqual([
      { candidate: '# Review Helper', installed: '# Review Helper', kind: 'context' },
      { candidate: '', installed: 'Old checklist', kind: 'removed' },
      { candidate: 'New checklist', installed: '', kind: 'added' },
      { candidate: 'Keep guardrails', installed: 'Keep guardrails', kind: 'context' },
    ]);
  });

  it('loads eligible candidates from the readonly Electron bridge when no candidates are provided', async () => {
    const target = container();
    const list = vi.fn().mockResolvedValue([
      {
        eligible: true,
        installState: 'not-installed',
        kind: 'research-script',
        reason: '2 successful runs met the promotion threshold.',
        skillName: 'research-loaded-candidate',
        skillPath: '.codebuddy/skill-candidates/research-loaded-candidate/SKILL.md',
        sourceJobId: 'research-script-loaded',
        successfulRunCount: 2,
      },
    ]);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillCandidate?: {
            list: typeof list;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillCandidate: {
          list,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillCandidateReviewQueueStrip, { cwd: 'D:/CascadeProjects/grok-cli-weekend' }));
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      eligibleOnly: true,
      limit: 3,
    });
    expect(target.textContent).toContain('research-loaded-candidate');
    expect(target.textContent).toContain('research-script-loaded');
  });

  it('requires reviewer identity before installing a candidate through Cowork', async () => {
    const target = container();
    const install = vi.fn().mockResolvedValue({
      installed: {
        approvedBy: 'Patrice',
        installedPath: '.codebuddy/skills/research-loaded-candidate/SKILL.md',
        skillName: 'research-loaded-candidate',
      },
      ok: true,
    });
    const onInstalled = vi.fn();
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillCandidate?: {
            install: typeof install;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillCandidate: {
          install,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(
        React.createElement(SkillCandidateReviewQueueStrip, {
          candidates: [
            {
              eligible: true,
              installState: 'not-installed',
              kind: 'research-script',
              reason: '2 successful runs met the promotion threshold.',
              skillName: 'research-loaded-candidate',
              skillPath: '.codebuddy/skill-candidates/research-loaded-candidate/SKILL.md',
              sourceJobId: 'research-script-loaded',
              successfulRunCount: 2,
            },
          ],
          cwd: 'D:/CascadeProjects/grok-cli-weekend',
          onInstalled,
        }),
      );
      await Promise.resolve();
    });

    let button = target.querySelector('[data-testid="skill-candidate-install-research-loaded-candidate"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const input = target.querySelector('[data-testid="skill-candidate-reviewer-input"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(input, { target: { value: 'Patrice' } } as unknown as Event);
      await Promise.resolve();
    });

    button = target.querySelector('[data-testid="skill-candidate-install-research-loaded-candidate"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
    });

    expect(install).toHaveBeenCalledWith({
      approvedBy: 'Patrice',
      candidatePath: '.codebuddy/skill-candidates/research-loaded-candidate/SKILL.md',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      overwrite: false,
    });
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Installed research-loaded-candidate by Patrice.');
  });
});
