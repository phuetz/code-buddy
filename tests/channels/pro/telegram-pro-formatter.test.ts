import { TelegramProFormatter } from '../../../src/channels/telegram/pro-formatter.js';
import type {
  PendingDiff,
  FileDiffSummary,
  RunRecord,
  RunStep,
  CIEvent,
  PRInfo,
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

describe('TelegramProFormatter', () => {
  let formatter: TelegramProFormatter;

  beforeEach(() => {
    formatter = new TelegramProFormatter();
  });

  describe('formatDiffMessage - short callback prefixes', () => {
    it('should use da_, dv_, dc_ Telegram prefixes', () => {
      const pending = makePendingDiff({ id: 'abc123' });
      const { buttons } = formatter.formatDiffMessage(pending);

      expect(buttons).toHaveLength(3);
      expect(buttons![0].data).toBe('da_abc123');
      expect(buttons![1].data).toBe('dv_abc123');
      expect(buttons![2].data).toBe('dc_abc123');
    });

    it('should include file summaries and line counts', () => {
      const pending = makePendingDiff({
        turnId: 3,
        diffs: [
          makeDiff({ path: 'a.ts', linesAdded: 10, linesRemoved: 3 }),
          makeDiff({ path: 'b.ts', action: 'create', linesAdded: 20, linesRemoved: 0 }),
        ],
      });
      const { text } = formatter.formatDiffMessage(pending);

      expect(text).toContain('Turn #3');
      expect(text).toContain('2 file(s)');
      expect(text).toContain('+30 -3');
      expect(text).toContain('[MOD]');
      expect(text).toContain('[NEW]');
    });
  });

  describe('formatPlanMessage - short callback prefixes', () => {
    it('should use pa_, pr_ Telegram prefixes', () => {
      const { buttons } = formatter.formatPlanMessage('Plan', ['file.ts'], ['cmd']);
      expect(buttons![0].data).toMatch(/^pa_/);
      expect(buttons![1].data).toMatch(/^pr_/);
      expect(buttons![0].text).toBe('Approve Plan');
      expect(buttons![1].text).toBe('Reject');
    });
  });

  describe('formatRunsList - short callback prefixes', () => {
    it('should use rd_ prefix for detail buttons', () => {
      const runs: RunRecord[] = [{
        id: 'run_abc123456789',
        sessionId: 's1',
        objective: 'Build',
        status: 'completed',
        steps: [],
        artifacts: [],
        tokenCount: 0,
        totalCost: 0,
        startedAt: Date.now() - 10000,
        endedAt: Date.now(),
      }];
      const { buttons } = formatter.formatRunsList(runs);
      expect(buttons).toBeDefined();
      expect(buttons![0].data).toMatch(/^rd_/);
    });
  });

  describe('formatRunDetail - short callback prefixes', () => {
    it('should use rr_, rt_, rb_ prefixes', () => {
      const run: RunRecord = {
        id: 'run_abc123456789',
        sessionId: 's1',
        objective: 'Build',
        status: 'completed',
        steps: [],
        artifacts: [{ type: 'commit', ref: 'abc', description: 'c' }],
        tokenCount: 0,
        totalCost: 0,
        startedAt: Date.now() - 10000,
        endedAt: Date.now(),
      };
      const testSteps: RunStep[] = [{ stepId: 's1', toolName: 'bash', args: { command: 'npm test' }, startedAt: 0 }];
      const commitRefs = ['abc'];

      const { buttons } = formatter.formatRunDetail(run, testSteps, commitRefs);
      expect(buttons).toBeDefined();
      const datas = buttons!.map((b) => b.data);
      expect(datas.some((d) => d?.startsWith('rr_'))).toBe(true);
      expect(datas.some((d) => d?.startsWith('rt_'))).toBe(true);
      expect(datas.some((d) => d?.startsWith('rb_'))).toBe(true);
    });
  });

  describe('formatCIAlert - short callback prefixes', () => {
    it('should use cf_, cm_ prefixes', () => {
      const event: CIEvent = {
        id: 'gh_abc123',
        type: 'build-failure',
        provider: 'github-actions',
        repo: 'org/repo',
        branch: 'main',
        title: 'CI failure',
        details: 'Tests failed',
        logUrl: 'https://example.com/logs',
        severity: 'error',
        timestamp: Date.now(),
      };
      const { buttons } = formatter.formatCIAlert(event);
      expect(buttons!.some((b) => b.data === 'cf_gh_abc123')).toBe(true);
      expect(buttons!.some((b) => b.data === 'cm_gh_abc123')).toBe(true);
      expect(buttons!.some((b) => b.text === 'Logs' && b.type === 'url')).toBe(true);
    });
  });

  describe('formatPRInfo - short callback prefixes', () => {
    it('should use pm_, pv_ prefixes for OPEN PRs', () => {
      const pr: PRInfo = {
        number: '42',
        title: 'Fix bug',
        state: 'OPEN',
        author: 'alice',
        additions: 10,
        deletions: 3,
        changedFiles: 2,
        body: 'Fix',
        url: 'https://github.com/org/repo/pull/42',
      };
      const { buttons } = formatter.formatPRInfo(pr);
      expect(buttons!.some((b) => b.data === 'pm_42')).toBe(true);
      expect(buttons!.some((b) => b.data === 'pv_42')).toBe(true);
    });
  });

  describe('getCommandList', () => {
    it('should include BotFather commands (start, help)', () => {
      const cmds = formatter.getCommandList();
      const names = cmds.map((c) => c.command);
      expect(names).toContain('start');
      expect(names).toContain('help');
      expect(names).toContain('repo');
      expect(names).toContain('branch');
      expect(names).toContain('pr');
    });
  });
});
