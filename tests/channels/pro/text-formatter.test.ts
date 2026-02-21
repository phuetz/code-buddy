import { TextProFormatter } from '../../../src/channels/pro/text-formatter.js';
import type {
  PendingDiff,
  FileDiffSummary,
  RunRecord,
  RunStep,
  CIEvent,
  RepoInfo,
  BranchInfo,
  PRInfo,
  PRSummary,
} from '../../../src/channels/pro/types.js';

function makeDiff(overrides?: Partial<FileDiffSummary>): FileDiffSummary {
  return {
    path: 'src/index.ts',
    action: 'modify',
    linesAdded: 5,
    linesRemoved: 2,
    excerpt: '+const x = 1;\n-const y = 2;',
    ...overrides,
  };
}

function makePendingDiff(overrides?: Partial<PendingDiff>): PendingDiff {
  return {
    id: 'abc123',
    chatId: 'chat1',
    userId: 'user1',
    turnId: 3,
    diffs: [makeDiff()],
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000,
    ...overrides,
  };
}

function makeRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: 'run_abc123',
    sessionId: 'sess1',
    objective: 'Fix the bug',
    status: 'completed',
    steps: [],
    artifacts: [],
    tokenCount: 0,
    totalCost: 0,
    startedAt: Date.now() - 10000,
    endedAt: Date.now(),
    ...overrides,
  };
}

function makeCIEvent(overrides?: Partial<CIEvent>): CIEvent {
  return {
    id: 'gh_abc123',
    type: 'build-failure',
    provider: 'github-actions',
    repo: 'org/repo',
    branch: 'main',
    title: 'CI failure',
    details: 'Tests failed on main',
    logUrl: 'https://github.com/org/repo/actions/runs/1',
    severity: 'error',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('TextProFormatter', () => {
  let formatter: TextProFormatter;

  beforeEach(() => {
    formatter = new TextProFormatter();
  });

  describe('formatDiffMessage', () => {
    it('should include file summaries and line counts', () => {
      const pending = makePendingDiff({
        turnId: 3,
        diffs: [
          makeDiff({ path: 'a.ts', linesAdded: 10, linesRemoved: 3 }),
          makeDiff({ path: 'b.ts', action: 'create', linesAdded: 20, linesRemoved: 0 }),
        ],
      });
      const { text, buttons } = formatter.formatDiffMessage(pending);

      expect(text).toContain('Turn #3');
      expect(text).toContain('2 file(s)');
      expect(text).toContain('+30 -3');
      expect(text).toContain('a.ts');
      expect(text).toContain('b.ts');
      expect(text).toContain('[MOD]');
      expect(text).toContain('[NEW]');
    });

    it('should produce buttons with pro: callback data', () => {
      const pending = makePendingDiff({ id: 'abc123' });
      const { buttons } = formatter.formatDiffMessage(pending);

      expect(buttons).toHaveLength(3);
      expect(buttons![0].data).toBe('pro:diff:apply:abc123');
      expect(buttons![1].data).toBe('pro:diff:view:abc123');
      expect(buttons![2].data).toBe('pro:diff:cancel:abc123');
      expect(buttons![0].text).toBe('Apply');
      expect(buttons![1].text).toBe('Full Diff');
      expect(buttons![2].text).toBe('Cancel');
    });

    it('should show action icons for different actions', () => {
      const pending = makePendingDiff({
        diffs: [
          makeDiff({ action: 'delete', path: 'old.ts' }),
          makeDiff({ action: 'rename', path: 'new.ts' }),
        ],
      });
      const { text } = formatter.formatDiffMessage(pending);
      expect(text).toContain('[DEL]');
      expect(text).toContain('[REN]');
    });

    it('should truncate long excerpts', () => {
      const longExcerpt = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
      const pending = makePendingDiff({
        diffs: [makeDiff({ excerpt: longExcerpt })],
      });
      const { text } = formatter.formatDiffMessage(pending);
      expect(text).toContain('... (20 more lines)');
    });
  });

  describe('formatFullDiff', () => {
    it('should return fullDiff when available', () => {
      const pending = makePendingDiff({ fullDiff: 'the full diff' });
      expect(formatter.formatFullDiff(pending)).toBe('the full diff');
    });

    it('should build diff from excerpts when fullDiff absent', () => {
      const pending = makePendingDiff({
        fullDiff: undefined,
        diffs: [makeDiff({ path: 'foo.ts', excerpt: '+added line' })],
      });
      const result = formatter.formatFullDiff(pending);
      expect(result).toContain('--- a/foo.ts');
      expect(result).toContain('+++ b/foo.ts');
      expect(result).toContain('+added line');
    });
  });

  describe('formatPlanMessage', () => {
    it('should format plan with files and commands', () => {
      const { text, buttons } = formatter.formatPlanMessage(
        'Refactor the module',
        ['src/a.ts', 'src/b.ts'],
        ['npm test']
      );
      expect(text).toContain('Execution Plan');
      expect(text).toContain('Refactor the module');
      expect(text).toContain('src/a.ts');
      expect(text).toContain('npm test');
      expect(buttons!.length).toBe(2);
      expect(buttons![0].text).toBe('Approve Plan');
      expect(buttons![1].text).toBe('Reject');
    });
  });

  describe('formatRunsList', () => {
    it('should format empty runs list', () => {
      const result = formatter.formatRunsList([]);
      expect(result.text).toBe('No runs recorded yet.');
      expect(result.buttons).toBeUndefined();
    });

    it('should format runs with detail buttons', () => {
      const runs = [
        makeRun({ id: 'run_abc123456789', objective: 'Build feature', steps: [{ stepId: 'step_1' } as any] }),
      ];
      const result = formatter.formatRunsList(runs);
      expect(result.text).toContain('Recent Runs:');
      expect(result.text).toContain('Build feature');
      expect(result.text).toContain('1 steps');
      expect(result.buttons).toBeDefined();
      expect(result.buttons![0].data).toContain('pro:run:detail:');
    });
  });

  describe('formatRunTimeline', () => {
    it('should format run with steps and artifacts', () => {
      const run = makeRun({
        objective: 'Deploy app',
        totalCost: 0.01,
        tokenCount: 1000,
        steps: [
          {
            stepId: 'step_1',
            toolName: 'bash',
            args: { command: 'npm run build' },
            success: true,
            startedAt: Date.now() - 5000,
            endedAt: Date.now(),
            filesChanged: ['dist/index.js'],
          },
        ],
        artifacts: [{ type: 'commit', ref: 'abc123', description: 'build' }],
      });
      const result = formatter.formatRunTimeline(run);

      expect(result.text).toContain('Deploy app');
      expect(result.text).toContain('Timeline:');
      expect(result.text).toContain('[OK] bash');
      expect(result.text).toContain('npm run build');
      expect(result.text).toContain('dist/index.js');
      expect(result.text).toContain('Artifacts:');
      expect(result.text).toContain('[commit]');
      expect(result.text).toContain('abc123');
      expect(result.text).toContain('$0.0100');
    });
  });

  describe('formatRunDetail', () => {
    it('should include action buttons for completed runs with tests and commits', () => {
      const run = makeRun({ status: 'completed' });
      const testSteps: RunStep[] = [{ stepId: 's1', toolName: 'bash', args: { command: 'npm test' }, startedAt: 0 }];
      const commitRefs = ['abc123'];

      const result = formatter.formatRunDetail(run, testSteps, commitRefs);
      expect(result.buttons).toBeDefined();
      const buttonTexts = result.buttons!.map((b) => b.text);
      expect(buttonTexts).toContain('Re-run');
      expect(buttonTexts).toContain('Tests');
      expect(buttonTexts).toContain('Rollback');
    });

    it('should omit Re-run for running runs', () => {
      const run = makeRun({ status: 'running' });
      const result = formatter.formatRunDetail(run, [], []);
      const buttonTexts = (result.buttons || []).map((b) => b.text);
      expect(buttonTexts).not.toContain('Re-run');
    });

    it('should omit Tests button when no test steps', () => {
      const run = makeRun({ status: 'completed' });
      const result = formatter.formatRunDetail(run, [], ['abc']);
      const buttonTexts = (result.buttons || []).map((b) => b.text);
      expect(buttonTexts).not.toContain('Tests');
    });

    it('should omit Rollback for rolled_back runs', () => {
      const run = makeRun({ status: 'rolled_back' as any });
      const result = formatter.formatRunDetail(run, [], ['abc']);
      const buttonTexts = (result.buttons || []).map((b) => b.text);
      expect(buttonTexts).not.toContain('Rollback');
    });
  });

  describe('formatCIAlert', () => {
    it('should include Fix and Mute buttons with log URL', () => {
      const event = makeCIEvent();
      const result = formatter.formatCIAlert(event);

      expect(result.text).toContain('CI Alert');
      expect(result.text).toContain('org/repo');
      expect(result.text).toContain('main');
      expect(result.buttons!.some((b) => b.text === 'Fix it')).toBe(true);
      expect(result.buttons!.some((b) => b.text === 'Logs' && b.type === 'url')).toBe(true);
      expect(result.buttons!.some((b) => b.text === 'Mute')).toBe(true);
    });

    it('should omit Logs button when no logUrl', () => {
      const event = makeCIEvent({ logUrl: undefined });
      const result = formatter.formatCIAlert(event);
      expect(result.buttons!.some((b) => b.text === 'Logs')).toBe(false);
    });

    it('should include analysis when provided', () => {
      const event = makeCIEvent();
      const result = formatter.formatCIAlert(event, 'Root cause: flaky network');
      expect(result.text).toContain('Analysis:');
      expect(result.text).toContain('Root cause: flaky network');
    });
  });

  describe('formatRepoInfo', () => {
    it('should format repo info', () => {
      const info: RepoInfo = {
        remote: 'https://github.com/user/repo.git',
        branch: 'main',
        commitCount: '42',
        lastCommit: 'abc1234 Fix bug',
        recentCommits: 'abc1234 Fix bug (1 day ago)',
        openPRs: '5',
      };
      const result = formatter.formatRepoInfo(info);
      expect(result.text).toContain('Repository Info');
      expect(result.text).toContain('https://github.com/user/repo.git');
      expect(result.text).toContain('Branch: main');
      expect(result.text).toContain('Commits: 42');
      expect(result.text).toContain('Recent Commits:');
      expect(result.text).toContain('Open PRs: ~5');
    });
  });

  describe('formatBranchInfo', () => {
    it('should format branch info with diff stats', () => {
      const info: BranchInfo = {
        branch: 'feature-x',
        mainBranch: 'main',
        diffStat: '3 files changed',
        commitsAhead: '5',
        commitsBehind: '2',
      };
      const result = formatter.formatBranchInfo(info);
      expect(result.text).toContain('Branch: feature-x');
      expect(result.text).toContain('3 files changed');
      expect(result.text).toContain('Ahead: 5');
      expect(result.text).toContain('Behind: 2');
    });
  });

  describe('formatPRInfo', () => {
    it('should format PR info with buttons', () => {
      const pr: PRInfo = {
        number: '42',
        title: 'Fix critical bug',
        state: 'OPEN',
        author: 'alice',
        additions: 10,
        deletions: 3,
        changedFiles: 2,
        body: 'This fixes the crash on startup',
        url: 'https://github.com/user/repo/pull/42',
      };
      const result = formatter.formatPRInfo(pr);
      expect(result.text).toContain('PR #42: Fix critical bug');
      expect(result.text).toContain('State: OPEN');
      expect(result.text).toContain('+10 -3 | 2 files');
      expect(result.buttons).toBeDefined();
      expect(result.buttons!.some((b) => b.text === 'View on GitHub' && b.type === 'url')).toBe(true);
      expect(result.buttons!.some((b) => b.text === 'Merge')).toBe(true);
      expect(result.buttons!.some((b) => b.text === 'Review')).toBe(true);
    });

    it('should omit Merge/Review for non-OPEN PRs', () => {
      const pr: PRInfo = {
        number: '42',
        title: 'Merged PR',
        state: 'MERGED',
        author: 'alice',
        additions: 5,
        deletions: 1,
        changedFiles: 1,
        body: 'Done',
      };
      const result = formatter.formatPRInfo(pr);
      const buttonTexts = (result.buttons || []).map((b) => b.text);
      expect(buttonTexts).not.toContain('Merge');
      expect(buttonTexts).not.toContain('Review');
    });
  });

  describe('formatPRList', () => {
    it('should format PR list', () => {
      const prs: PRSummary[] = [
        { number: 1, title: 'Fix bug', author: 'alice' },
        { number: 2, title: 'Add feature', author: 'bob' },
      ];
      const result = formatter.formatPRList(prs);
      expect(result.text).toContain('Open PRs:');
      expect(result.text).toContain('#1 Fix bug (alice)');
      expect(result.text).toContain('#2 Add feature (bob)');
    });

    it('should handle empty PR list', () => {
      const result = formatter.formatPRList([]);
      expect(result.text).toBe('No open PRs.');
    });
  });

  describe('getCommandList', () => {
    it('should return a list of commands', () => {
      const cmds = formatter.getCommandList();
      expect(cmds.length).toBeGreaterThan(0);
      const names = cmds.map((c) => c.command);
      expect(names).toContain('repo');
      expect(names).toContain('branch');
      expect(names).toContain('pr');
      expect(names).toContain('task');
      expect(names).toContain('yolo');
      expect(names).toContain('runs');
    });
  });
});
