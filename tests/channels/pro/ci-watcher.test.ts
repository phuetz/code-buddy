import { CIWatcher } from '../../../src/channels/pro/ci-watcher.js';
import type { CIAlertType, CIProviderType } from '../../../src/channels/pro/types.js';

const mockAuthManager = {
  checkScope: jest.fn().mockReturnValue({ allowed: true }),
};

function makeWatcher(overrides: Record<string, unknown> = {}, auth?: unknown) {
  return new CIWatcher(
    {
      enabled: true,
      chatId: 'chat123',
      providers: [],
      alertOn: ['build-failure', 'deploy-failure', 'vulnerable-deps'] as CIAlertType[],
      mutedPatterns: [],
      ...overrides,
    },
    auth as any
  );
}

function ghWorkflowPayload(conclusion = 'failure', name = 'CI', branch = 'main', sha = 'abc1234567') {
  return {
    action: 'completed',
    workflow_run: {
      conclusion,
      name,
      head_branch: branch,
      head_sha: sha,
      html_url: 'https://github.com/org/repo/actions/runs/1',
    },
    repository: { full_name: 'org/repo' },
  };
}

describe('CIWatcher', () => {
  let watcher: CIWatcher;

  beforeEach(() => {
    watcher = makeWatcher();
    jest.clearAllMocks();
  });

  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(watcher.isRunning()).toBe(false);
      watcher.start();
      expect(watcher.isRunning()).toBe(true);
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    it('should emit started and stopped events', () => {
      const started = jest.fn();
      const stopped = jest.fn();
      watcher.on('started', started);
      watcher.on('stopped', stopped);

      watcher.start();
      expect(started).toHaveBeenCalledTimes(1);

      watcher.stop();
      expect(stopped).toHaveBeenCalledTimes(1);
    });

    it('should not emit started twice if already running', () => {
      const started = jest.fn();
      watcher.on('started', started);
      watcher.start();
      watcher.start();
      expect(started).toHaveBeenCalledTimes(1);
    });
  });

  describe('processWebhookEvent', () => {
    it('should return null when not running', async () => {
      const result = await watcher.processWebhookEvent(
        ghWorkflowPayload(),
        'github-actions'
      );
      expect(result).toBeNull();
    });

    it('should process event when running', async () => {
      watcher.start();
      const result = await watcher.processWebhookEvent(
        ghWorkflowPayload(),
        'github-actions'
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('build-failure');
      expect(result!.provider).toBe('github-actions');
    });
  });

  describe('parseGitHubActionsEvent', () => {
    it('should parse workflow_run failure', () => {
      const event = watcher.parseGitHubActionsEvent(ghWorkflowPayload('failure'));
      expect(event).not.toBeNull();
      expect(event!.type).toBe('build-failure');
      expect(event!.repo).toBe('org/repo');
      expect(event!.branch).toBe('main');
      expect(event!.severity).toBe('error');
      expect(event!.commit).toBe('abc1234');
      expect(event!.logUrl).toContain('github.com');
    });

    it('should ignore successful workflows', () => {
      const event = watcher.parseGitHubActionsEvent(ghWorkflowPayload('success'));
      expect(event).toBeNull();
    });

    it('should parse non-failure conclusion as flaky-test', () => {
      const event = watcher.parseGitHubActionsEvent(ghWorkflowPayload('timed_out'));
      expect(event).not.toBeNull();
      expect(event!.type).toBe('flaky-test');
      expect(event!.severity).toBe('warning');
    });

    it('should parse check_run events', () => {
      const payload = {
        action: 'completed',
        check_run: {
          conclusion: 'failure',
          name: 'lint',
          html_url: 'https://github.com/org/repo/runs/42',
          output: { summary: 'Lint failed' },
          check_suite: { head_branch: 'feature', head_sha: 'def456789a' },
        },
        repository: { full_name: 'org/repo' },
      };
      const event = watcher.parseGitHubActionsEvent(payload);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('build-failure');
      expect(event!.branch).toBe('feature');
      expect(event!.details).toBe('Lint failed');
      expect(event!.commit).toBe('def4567');
    });

    it('should parse deployment_status failure', () => {
      const payload = {
        deployment_status: {
          state: 'failure',
          environment: 'production',
          description: 'Deploy crashed',
          log_url: 'https://logs.example.com/123',
        },
        repository: { full_name: 'org/repo' },
      };
      const event = watcher.parseGitHubActionsEvent(payload);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('deploy-failure');
      expect(event!.severity).toBe('critical');
      expect(event!.branch).toBe('production');
    });

    it('should ignore successful deployments', () => {
      const payload = {
        deployment_status: { state: 'success', environment: 'staging' },
        repository: { full_name: 'org/repo' },
      };
      expect(watcher.parseGitHubActionsEvent(payload)).toBeNull();
    });
  });

  describe('parseGitLabCIEvent', () => {
    it('should parse pipeline failure', () => {
      const payload = {
        object_kind: 'pipeline',
        object_attributes: { status: 'failed', ref: 'develop', id: 99, sha: 'aabbccdd11', url: 'https://gl.example.com/pipelines/99' },
        project: { path_with_namespace: 'team/project' },
      };
      const event = watcher.parseGitLabCIEvent(payload);
      expect(event).not.toBeNull();
      expect(event!.provider).toBe('gitlab-ci');
      expect(event!.repo).toBe('team/project');
      expect(event!.branch).toBe('develop');
      expect(event!.commit).toBe('aabbccd');
    });

    it('should ignore non-pipeline/build events', () => {
      const payload = { object_kind: 'merge_request', object_attributes: { status: 'failed' } };
      expect(watcher.parseGitLabCIEvent(payload)).toBeNull();
    });

    it('should ignore non-failed pipelines', () => {
      const payload = { object_kind: 'pipeline', object_attributes: { status: 'success', ref: 'main' }, project: {} };
      expect(watcher.parseGitLabCIEvent(payload)).toBeNull();
    });
  });

  describe('parseJenkinsEvent', () => {
    it('should parse build failure', () => {
      const payload = {
        name: 'my-job',
        build: { number: 42, status: 'FAILURE', full_url: 'https://jenkins.local/job/my-job/42', scm: { branch: 'release' } },
      };
      const event = watcher.parseJenkinsEvent(payload);
      expect(event).not.toBeNull();
      expect(event!.provider).toBe('jenkins');
      expect(event!.repo).toBe('my-job');
      expect(event!.title).toContain('42');
    });

    it('should return null if no build object', () => {
      expect(watcher.parseJenkinsEvent({})).toBeNull();
    });

    it('should ignore successful builds', () => {
      const payload = { name: 'job', build: { number: 1, status: 'SUCCESS' } };
      expect(watcher.parseJenkinsEvent(payload)).toBeNull();
    });
  });

  describe('parseCustomWebhookEvent', () => {
    it('should parse generic format', () => {
      const payload = {
        type: 'build-failure',
        repo: 'custom/repo',
        branch: 'main',
        title: 'Build broke',
        details: 'Something went wrong',
        severity: 'error',
      };
      const event = watcher.parseCustomWebhookEvent(payload);
      expect(event).not.toBeNull();
      expect(event!.provider).toBe('custom-webhook');
      expect(event!.title).toBe('Build broke');
    });

    it('should return null if no type', () => {
      expect(watcher.parseCustomWebhookEvent({ repo: 'x' })).toBeNull();
    });
  });

  describe('deduplication', () => {
    it('should deduplicate events with same commit+workflow+type', async () => {
      watcher.start();
      const first = await watcher.processWebhookEvent(ghWorkflowPayload('failure', 'CI', 'main', 'aaaa'), 'github-actions');
      const second = await watcher.processWebhookEvent(ghWorkflowPayload('failure', 'CI', 'main', 'aaaa'), 'github-actions');
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });
  });

  describe('muted events', () => {
    it('should suppress muted events', async () => {
      watcher = makeWatcher({ mutedPatterns: ['CI_org/repo'] });
      watcher.start();
      const result = await watcher.processWebhookEvent(ghWorkflowPayload(), 'github-actions');
      expect(result).toBeNull();
    });
  });

  describe('static getSeverityIcon', () => {
    it('should return icons for each severity level', () => {
      expect(CIWatcher.getSeverityIcon('info')).toContain('INFO');
      expect(CIWatcher.getSeverityIcon('warning')).toContain('WARN');
      expect(CIWatcher.getSeverityIcon('error')).toContain('ERROR');
      expect(CIWatcher.getSeverityIcon('critical')).toContain('CRIT');
    });
  });

  describe('handleFixIt', () => {
    it('should return objective when event exists', async () => {
      watcher.start();
      const event = await watcher.processWebhookEvent(ghWorkflowPayload(), 'github-actions');
      const result = await watcher.handleFixIt(event!.id, 'user1', 'chat1');
      expect(result.objective).toBeDefined();
      expect(result.text).toContain('Launching fix agent');
    });

    it('should return not found for unknown event', async () => {
      const result = await watcher.handleFixIt('nonexistent', 'user1', 'chat1');
      expect(result.text).toBe('Event not found.');
      expect(result.objective).toBeUndefined();
    });

    it('should check write-patch scope via authManager', async () => {
      mockAuthManager.checkScope.mockReturnValueOnce({ allowed: false, reason: 'no permission' });
      watcher = makeWatcher({}, mockAuthManager);
      watcher.start();
      const event = await watcher.processWebhookEvent(ghWorkflowPayload(), 'github-actions');
      const result = await watcher.handleFixIt(event!.id, 'user1', 'chat1');
      expect(result.text).toContain('Permission denied');
      expect(mockAuthManager.checkScope).toHaveBeenCalledWith('user1', 'write-patch', { repo: 'org/repo' });
    });
  });

  describe('handleMute and handleUnmute', () => {
    it('should add pattern to muted list', async () => {
      watcher.start();
      const event = await watcher.processWebhookEvent(ghWorkflowPayload(), 'github-actions');
      const result = watcher.handleMute(event!.id);
      expect(result.text).toContain('Muted');
      expect(watcher.getConfig().mutedPatterns).toContain('CI_org/repo');
    });

    it('should unmute a pattern', () => {
      watcher = makeWatcher({ mutedPatterns: ['CI_org/repo'] });
      const result = watcher.handleUnmute('CI_org/repo');
      expect(result.text).toContain('Unmuted');
      expect(watcher.getConfig().mutedPatterns).not.toContain('CI_org/repo');
    });

    it('should return not found for unknown pattern', () => {
      const result = watcher.handleUnmute('nonexistent');
      expect(result.text).toContain('Pattern not found');
    });
  });

  describe('alertOn filtering', () => {
    it('should filter out unconfigured alert types', async () => {
      watcher = makeWatcher({ alertOn: ['deploy-failure'] as CIAlertType[] });
      watcher.start();
      const result = await watcher.processWebhookEvent(ghWorkflowPayload(), 'github-actions');
      expect(result).toBeNull();
    });
  });

  describe('onAlert callback', () => {
    it('should invoke onAlert with chatId and event', async () => {
      const onAlert = jest.fn().mockResolvedValue(undefined);
      watcher.onAlert = onAlert;
      watcher.start();
      await watcher.processWebhookEvent(ghWorkflowPayload(), 'github-actions');
      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onAlert).toHaveBeenCalledWith(
        'chat123',
        expect.objectContaining({
          type: 'build-failure',
          provider: 'github-actions',
          repo: 'org/repo',
        }),
        undefined
      );
    });
  });

  describe('event pruning', () => {
    it('should prune events beyond 200', async () => {
      watcher.start();
      for (let i = 0; i < 210; i++) {
        const payload = {
          type: 'build-failure' as CIAlertType,
          repo: `repo-${i}`,
          branch: 'main',
          title: `Event ${i}`,
          details: 'fail',
          commit: `commit_${i}`,
          workflow: `wf_${i}`,
        };
        await watcher.processWebhookEvent(payload, 'custom-webhook');
      }
      expect(watcher.listEvents(300).length).toBeLessThanOrEqual(200);
    });
  });

  describe('listEvents', () => {
    it('should return events sorted by timestamp descending', async () => {
      watcher.start();
      for (let i = 0; i < 5; i++) {
        await watcher.processWebhookEvent(
          { type: 'build-failure', repo: `r${i}`, branch: 'b', title: `e${i}`, details: 'd', commit: `c${i}`, workflow: `w${i}` },
          'custom-webhook'
        );
      }
      const events = watcher.listEvents();
      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].timestamp).toBeGreaterThanOrEqual(events[i].timestamp);
      }
    });

    it('should respect limit parameter', async () => {
      watcher.start();
      const realNow = Date.now;
      let counter = 1000000;
      Date.now = () => ++counter;
      try {
        for (let i = 0; i < 5; i++) {
          await watcher.processWebhookEvent(
            ghWorkflowPayload('failure', `wf${i}`, `branch${i}`, `sha_unique_${i}`),
            'github-actions'
          );
        }
        const all = watcher.listEvents();
        expect(all.length).toBe(5);
        expect(watcher.listEvents(2).length).toBe(2);
      } finally {
        Date.now = realNow;
      }
    });

    it('should return event by id via getEvent', async () => {
      watcher.start();
      const event = await watcher.processWebhookEvent(ghWorkflowPayload(), 'github-actions');
      expect(watcher.getEvent(event!.id)).toBe(event);
      expect(watcher.getEvent('nonexistent')).toBeUndefined();
    });
  });
});
