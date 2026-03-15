/**
 * Tests for CI/CD integrations, Chrome Bridge, Agent SDK, PR Linker, and MCP Auto-Discovery
 */

// Mock logger before imports
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { GitHubActionRunner, GitHubActionConfig } from '../../src/integrations/github-action-runner';
import { GitLabCIRunner, GitLabCIConfig } from '../../src/integrations/gitlab-ci-runner';
import { ChromeBridge } from '../../src/integrations/chrome-bridge';
import { AgentSDK, createAgent, SDKToolDefinition } from '../../src/sdk/agent-sdk';
import { PRSessionLinker } from '../../src/integrations/pr-session-linker';
import { MCPAutoDiscovery, MCPToolInfo } from '../../src/mcp/mcp-auto-discovery';

// ============================================================================
// GitHub Action Runner Tests
// ============================================================================

describe('GitHubActionRunner', () => {
  let runner: GitHubActionRunner;

  beforeEach(() => {
    runner = new GitHubActionRunner();
  });

  describe('parseEvent', () => {
    it('should parse pull_request event', () => {
      const payload = {
        action: 'opened',
        pull_request: { number: 42 },
        repository: { full_name: 'owner/repo' },
      };
      const config = runner.parseEvent(payload);
      expect(config.event).toBe('pull_request');
      expect(config.prNumber).toBe(42);
      expect(config.repo).toBe('owner/repo');
      expect(config.mode).toBe('review');
    });

    it('should parse issues event', () => {
      const payload = {
        action: 'opened',
        issue: { number: 10 },
        repository: { full_name: 'owner/repo' },
      };
      const config = runner.parseEvent(payload);
      expect(config.event).toBe('issues');
      expect(config.issueNumber).toBe(10);
      expect(config.mode).toBe('triage');
    });

    it('should parse push event', () => {
      const payload = {
        ref: 'refs/heads/main',
        repository: { full_name: 'owner/repo' },
      };
      const config = runner.parseEvent(payload);
      expect(config.event).toBe('push');
      expect(config.mode).toBe('implement');
    });

    it('should override mode from INPUT_MODE env', () => {
      const origEnv = process.env.INPUT_MODE;
      process.env.INPUT_MODE = 'triage';
      const payload = {
        pull_request: { number: 1 },
        repository: { full_name: 'o/r' },
      };
      const config = runner.parseEvent(payload);
      expect(config.mode).toBe('triage');
      if (origEnv === undefined) {
        delete process.env.INPUT_MODE;
      } else {
        process.env.INPUT_MODE = origEnv;
      }
    });

    it('should handle missing repository', () => {
      const config = runner.parseEvent({});
      expect(config.repo).toBe('');
      expect(config.event).toBe('push');
    });

    it('should store config accessible via getConfig', () => {
      expect(runner.getConfig()).toBeNull();
      runner.parseEvent({ repository: { full_name: 'a/b' } });
      expect(runner.getConfig()).not.toBeNull();
      expect(runner.getConfig()!.repo).toBe('a/b');
    });
  });

  describe('generateReviewComment', () => {
    it('should generate structured review comment', () => {
      const diff = '+added line\n-removed line\n context';
      const files = ['src/foo.ts', 'src/bar.ts'];
      const comment = runner.generateReviewComment(diff, files);
      expect(comment).toContain('Code Buddy AI Review');
      expect(comment).toContain('src/foo.ts');
      expect(comment).toContain('src/bar.ts');
      expect(comment).toContain('Files changed (2)');
    });

    it('should count additions and deletions', () => {
      const diff = '+a\n+b\n+c\n-d\n-e\n context';
      const comment = runner.generateReviewComment(diff, ['f.ts']);
      expect(comment).toContain('+3');
      expect(comment).toContain('-2');
    });

    it('should handle empty diff', () => {
      const comment = runner.generateReviewComment('', []);
      expect(comment).toContain('Files changed (0)');
    });
  });

  describe('generateTriageLabel', () => {
    it('should detect bug labels', () => {
      const labels = runner.generateTriageLabel('App crashes on start', 'There is a bug when loading');
      expect(labels).toContain('bug');
    });

    it('should detect enhancement labels', () => {
      const labels = runner.generateTriageLabel('Feature request: dark mode', '');
      expect(labels).toContain('enhancement');
    });

    it('should detect documentation labels', () => {
      const labels = runner.generateTriageLabel('Update README', 'Documentation needs update');
      expect(labels).toContain('documentation');
    });

    it('should detect security labels', () => {
      const labels = runner.generateTriageLabel('Security vulnerability found', '');
      expect(labels).toContain('security');
    });

    it('should detect performance labels', () => {
      const labels = runner.generateTriageLabel('App is slow', 'Performance optimization needed');
      expect(labels).toContain('performance');
    });

    it('should default to needs-triage when no match', () => {
      const labels = runner.generateTriageLabel('Something', 'Generic text');
      expect(labels).toContain('needs-triage');
    });

    it('should detect multiple labels', () => {
      const labels = runner.generateTriageLabel('Bug fix documentation', 'Performance security');
      expect(labels.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('formatActionOutput', () => {
    it('should format simple key-value pairs', () => {
      const output = runner.formatActionOutput({ status: 'success', count: 5 });
      expect(output).toContain('status=success');
      expect(output).toContain('count=5');
    });

    it('should handle multiline values with delimiter', () => {
      const output = runner.formatActionOutput({ body: 'line1\nline2' });
      expect(output).toContain('body<<EOF');
      expect(output).toContain('line1\nline2');
      expect(output).toContain('EOF');
    });
  });

  describe('createActionYaml', () => {
    it('should generate valid action.yml content', () => {
      const yaml = runner.createActionYaml();
      expect(yaml).toContain("name: 'Code Buddy AI'");
      expect(yaml).toContain('anthropic_api_key');
      expect(yaml).toContain('model');
      expect(yaml).toContain('max_turns');
      expect(yaml).toContain('mode');
      expect(yaml).toContain('node20');
    });
  });
});

// ============================================================================
// GitLab CI Runner Tests
// ============================================================================

describe('GitLabCIRunner', () => {
  let runner: GitLabCIRunner;

  beforeEach(() => {
    runner = new GitLabCIRunner();
  });

  afterEach(() => {
    delete process.env.CI_JOB_TOKEN;
    delete process.env.GITLAB_TOKEN;
    delete process.env.CI_PROJECT_ID;
    delete process.env.CI_PIPELINE_SOURCE;
    delete process.env.CI_MERGE_REQUEST_IID;
  });

  describe('parseEnvironment', () => {
    it('should parse CI environment variables', () => {
      process.env.CI_JOB_TOKEN = 'test-token';
      process.env.CI_PROJECT_ID = '12345';
      process.env.CI_PIPELINE_SOURCE = 'merge_request_event';
      process.env.CI_MERGE_REQUEST_IID = '7';

      const config = runner.parseEnvironment();
      expect(config.token).toBe('test-token');
      expect(config.projectId).toBe('12345');
      expect(config.pipelineSource).toBe('merge_request_event');
      expect(config.mergeRequestIid).toBe(7);
    });

    it('should fall back to GITLAB_TOKEN', () => {
      process.env.GITLAB_TOKEN = 'fallback-token';
      const config = runner.parseEnvironment();
      expect(config.token).toBe('fallback-token');
    });

    it('should handle missing env vars with defaults', () => {
      const config = runner.parseEnvironment();
      expect(config.token).toBe('');
      expect(config.projectId).toBe('');
      expect(config.pipelineSource).toBe('push');
      expect(config.mergeRequestIid).toBeUndefined();
    });

    it('should store config via getConfig', () => {
      expect(runner.getConfig()).toBeNull();
      runner.parseEnvironment();
      expect(runner.getConfig()).not.toBeNull();
    });
  });

  describe('generateMRComment', () => {
    it('should generate MR review comment', () => {
      const diff = '+new\n-old';
      const files = ['app.py', 'test.py'];
      const comment = runner.generateMRComment(diff, files);
      expect(comment).toContain('Code Buddy AI Review');
      expect(comment).toContain('app.py');
      expect(comment).toContain('Files changed (2)');
      expect(comment).toContain('GitLab CI');
    });

    it('should handle empty file list', () => {
      const comment = runner.generateMRComment('', []);
      expect(comment).toContain('Files changed (0)');
    });
  });

  describe('formatPipelineOutput', () => {
    it('should format as JSON with timestamp', () => {
      const output = runner.formatPipelineOutput({ status: 'pass' });
      const parsed = JSON.parse(output);
      expect(parsed.codebuddy_analysis).toBeDefined();
      expect(parsed.codebuddy_analysis.status).toBe('pass');
      expect(parsed.codebuddy_analysis.timestamp).toBeDefined();
    });
  });

  describe('createGitLabTemplate', () => {
    it('should generate .gitlab-ci.yml template', () => {
      const template = runner.createGitLabTemplate();
      expect(template).toContain('stages:');
      expect(template).toContain('review');
      expect(template).toContain('merge_requests');
      expect(template).toContain('code-buddy');
      expect(template).toContain('GROK_API_KEY');
    });
  });
});

// ============================================================================
// Chrome Bridge Tests
// ============================================================================

describe('ChromeBridge', () => {
  let bridge: ChromeBridge;

  beforeEach(() => {
    ChromeBridge.resetInstance();
    bridge = ChromeBridge.getInstance({ port: 9222 });
  });

  afterEach(() => {
    ChromeBridge.resetInstance();
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const a = ChromeBridge.getInstance();
      const b = ChromeBridge.getInstance();
      expect(a).toBe(b);
    });

    it('should reset instance', () => {
      const a = ChromeBridge.getInstance();
      ChromeBridge.resetInstance();
      const b = ChromeBridge.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe('connect/disconnect', () => {
    it('should connect successfully', async () => {
      expect(bridge.isConnected()).toBe(false);
      await bridge.connect();
      expect(bridge.isConnected()).toBe(true);
    });

    it('should connect on custom port', async () => {
      await bridge.connect(3000);
      expect(bridge.isConnected()).toBe(true);
      expect(bridge.getConfig().port).toBe(3000);
    });

    it('should disconnect', async () => {
      await bridge.connect();
      await bridge.disconnect();
      expect(bridge.isConnected()).toBe(false);
    });
  });

  describe('console errors', () => {
    it('should return empty array when connected', async () => {
      await bridge.connect();
      const errors = await bridge.getConsoleErrors();
      expect(errors).toEqual([]);
    });

    it('should throw when not connected', async () => {
      await expect(bridge.getConsoleErrors()).rejects.toThrow('Not connected');
    });
  });

  describe('getDOMState', () => {
    it('should return element info for selector', async () => {
      await bridge.connect();
      const el = await bridge.getDOMState('#myDiv');
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('div');
      expect(el!.id).toBe('myDiv');
    });

    it('should handle class selector', async () => {
      await bridge.connect();
      const el = await bridge.getDOMState('.myClass');
      expect(el!.className).toBe('myClass');
    });

    it('should throw when not connected', async () => {
      await expect(bridge.getDOMState('div')).rejects.toThrow('Not connected');
    });
  });

  describe('network requests', () => {
    it('should return empty array when connected', async () => {
      await bridge.connect();
      const requests = await bridge.getNetworkRequests();
      expect(requests).toEqual([]);
    });

    it('should throw when not connected', async () => {
      await expect(bridge.getNetworkRequests()).rejects.toThrow('Not connected');
    });
  });

  describe('executeScript', () => {
    it('should accept script when connected', async () => {
      await bridge.connect();
      const result = await bridge.executeScript('console.log("hi")');
      expect(result).toBeUndefined();
    });

    it('should throw when not connected', async () => {
      await expect(bridge.executeScript('1+1')).rejects.toThrow('Not connected');
    });
  });

  describe('recording', () => {
    it('should start and stop recording', async () => {
      await bridge.connect();
      await bridge.startRecording();
      expect(bridge.isRecording()).toBe(true);
      await bridge.stopRecording();
      expect(bridge.isRecording()).toBe(false);
    });

    it('should return empty recording', async () => {
      await bridge.connect();
      await bridge.startRecording();
      const actions = bridge.getRecording();
      expect(actions).toEqual([]);
    });

    it('should throw startRecording when not connected', async () => {
      await expect(bridge.startRecording()).rejects.toThrow('Not connected');
    });
  });
});

// ============================================================================
// Agent SDK Tests
// ============================================================================

describe('AgentSDK', () => {
  let sdk: AgentSDK;

  beforeEach(() => {
    sdk = new AgentSDK({ model: 'test-model', maxTurns: 5 });
  });

  describe('constructor', () => {
    it('should use defaults when no config', () => {
      const defaultSdk = new AgentSDK();
      const config = defaultSdk.getConfig();
      expect(config.model).toBe('grok-3-mini');
      expect(config.maxTurns).toBe(10);
      expect(config.systemPrompt).toBeDefined();
    });

    it('should accept custom config', () => {
      const config = sdk.getConfig();
      expect(config.model).toBe('test-model');
      expect(config.maxTurns).toBe(5);
    });
  });

  describe('run', () => {
    it('should return successful result', async () => {
      const result = await sdk.run('Hello');
      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello');
      expect(result.toolCalls).toBe(0);
      expect(result.cost).toBe(0);
    });
  });

  describe('runStreaming', () => {
    it('should yield text and done events', async () => {
      const events = [];
      for await (const event of sdk.runStreaming('test prompt')) {
        events.push(event);
      }
      expect(events.length).toBe(2);
      expect(events[0].type).toBe('text');
      expect(events[1].type).toBe('done');
    });
  });

  describe('addTool / removeTool', () => {
    const mockTool: SDKToolDefinition = {
      name: 'my_tool',
      description: 'A test tool',
      parameters: { input: { type: 'string' } },
      execute: async () => 'result',
    };

    it('should add a tool', () => {
      sdk.addTool(mockTool);
      expect(sdk.getTools()).toContain('my_tool');
    });

    it('should throw on duplicate tool', () => {
      sdk.addTool(mockTool);
      expect(() => sdk.addTool(mockTool)).toThrow('already registered');
    });

    it('should remove a tool', () => {
      sdk.addTool(mockTool);
      expect(sdk.removeTool('my_tool')).toBe(true);
      expect(sdk.getTools()).not.toContain('my_tool');
    });

    it('should return false for non-existent tool removal', () => {
      expect(sdk.removeTool('nope')).toBe(false);
    });

    it('should list built-in and custom tools', () => {
      const sdkWithBuiltin = new AgentSDK({ tools: ['bash', 'read_file'] });
      sdkWithBuiltin.addTool(mockTool);
      const tools = sdkWithBuiltin.getTools();
      expect(tools).toContain('bash');
      expect(tools).toContain('read_file');
      expect(tools).toContain('my_tool');
    });
  });

  describe('setSystemPrompt', () => {
    it('should update system prompt', () => {
      sdk.setSystemPrompt('New prompt');
      expect(sdk.getConfig().systemPrompt).toBe('New prompt');
    });
  });

  describe('createAgent factory', () => {
    it('should create an AgentSDK instance', () => {
      const agent = createAgent({ model: 'factory-model' });
      expect(agent).toBeInstanceOf(AgentSDK);
      expect(agent.getConfig().model).toBe('factory-model');
    });

    it('should work with no args', () => {
      const agent = createAgent();
      expect(agent).toBeInstanceOf(AgentSDK);
    });
  });
});

// ============================================================================
// PR Session Linker Tests
// ============================================================================

describe('PRSessionLinker', () => {
  let linker: PRSessionLinker;
  const originalFetch = global.fetch;

  beforeEach(() => {
    linker = new PRSessionLinker();
    // Mock global.fetch to prevent flakiness from other tests polluting it
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('linkToPR', () => {
    it('should link by PR number', async () => {
      const pr = await linker.linkToPR('42');
      expect(pr.number).toBe(42);
      expect(pr.state).toBe('open');
    });

    it('should link by GitHub URL', async () => {
      const pr = await linker.linkToPR('https://github.com/acme/project/pull/99');
      expect(pr.number).toBe(99);
      expect(pr.repo).toBe('acme/project');
      expect(pr.url).toContain('acme/project/pull/99');
    });

    it('should throw for invalid identifier', async () => {
      await expect(linker.linkToPR('not-a-number')).rejects.toThrow('Invalid PR identifier');
    });
  });

  describe('getCurrentPR', () => {
    it('should return null when not linked', () => {
      expect(linker.getCurrentPR()).toBeNull();
    });

    it('should return PR info when linked', async () => {
      await linker.linkToPR('5');
      expect(linker.getCurrentPR()).not.toBeNull();
      expect(linker.getCurrentPR()!.number).toBe(5);
    });
  });

  describe('getReviewStatus', () => {
    it('should return null when no PR linked', () => {
      expect(linker.getReviewStatus()).toBeNull();
    });

    it('should return pending after linking', async () => {
      await linker.linkToPR('1');
      expect(linker.getReviewStatus()).toBe('pending');
    });
  });

  describe('unlinkPR', () => {
    it('should remove the link', async () => {
      await linker.linkToPR('1');
      linker.unlinkPR();
      expect(linker.getCurrentPR()).toBeNull();
      expect(linker.getReviewStatus()).toBeNull();
    });
  });

  describe('formatPRFooter', () => {
    it('should return empty string when no PR', () => {
      expect(linker.formatPRFooter()).toBe('');
    });

    it('should return formatted footer when linked', async () => {
      await linker.linkToPR('42');
      const footer = linker.formatPRFooter();
      expect(footer).toContain('PR #42');
      expect(footer).toContain('pending review');
      expect(footer).toContain('https://');
    });
  });

  describe('autoLinkFromBranch', () => {
    it('should auto-link from pr-N branch pattern', async () => {
      const pr = await linker.autoLinkFromBranch('pr-55');
      expect(pr).not.toBeNull();
      expect(pr!.number).toBe(55);
    });

    it('should auto-link from PR/N branch pattern', async () => {
      const pr = await linker.autoLinkFromBranch('feature/PR/123');
      expect(pr).not.toBeNull();
      expect(pr!.number).toBe(123);
    });

    it('should return null for non-PR branch', async () => {
      const pr = await linker.autoLinkFromBranch('feature/dark-mode');
      expect(pr).toBeNull();
    });
  });
});

// ============================================================================
// MCP Auto-Discovery Tests
// ============================================================================

describe('MCPAutoDiscovery', () => {
  let discovery: MCPAutoDiscovery;

  const sampleTools: MCPToolInfo[] = [
    { name: 'web_search', description: 'Search the web for information', server: 'brave', inputSchema: {} },
    { name: 'file_read', description: 'Read a file from disk', server: 'filesystem', inputSchema: {} },
    { name: 'database_query', description: 'Execute a SQL query on a database', server: 'postgres', inputSchema: {} },
    { name: 'web_scrape', description: 'Scrape content from a web page', server: 'brave', inputSchema: {} },
  ];

  beforeEach(() => {
    discovery = new MCPAutoDiscovery();
  });

  describe('shouldDeferLoading', () => {
    it('should not defer when descriptions are small', () => {
      const descriptions = ['short', 'also short'];
      expect(discovery.shouldDeferLoading(descriptions, 100000)).toBe(false);
    });

    it('should defer when descriptions exceed threshold', () => {
      // Create descriptions that total > 10% of 1000 tokens = 100 tokens = 400 chars
      const descriptions = [
        'x'.repeat(500),
        'y'.repeat(500),
      ];
      expect(discovery.shouldDeferLoading(descriptions, 1000)).toBe(true);
    });

    it('should respect custom threshold', () => {
      discovery.setThreshold(50);
      const descriptions = ["x".repeat(200)]; // 50 tokens, 50% of 50 = 25 tokens → defer; 50% of 500 = 250 → no
      expect(discovery.shouldDeferLoading(descriptions, 50)).toBe(true);
      expect(discovery.shouldDeferLoading(descriptions, 500)).toBe(false);
    });
  });

  describe('searchTools', () => {
    it('should find tools matching query', () => {
      const results = discovery.searchTools('web', sampleTools);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('web');
    });

    it('should rank exact name match higher', () => {
      const results = discovery.searchTools('web_search', sampleTools);
      expect(results[0].name).toBe('web_search');
    });

    it('should return empty for no match', () => {
      const results = discovery.searchTools('zzzznotfound', sampleTools);
      expect(results).toEqual([]);
    });

    it('should match on description', () => {
      const results = discovery.searchTools('SQL', sampleTools);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('database_query');
    });
  });

  describe('getLoadedTools / getDeferredTools', () => {
    it('should return empty by default', () => {
      expect(discovery.getLoadedTools()).toEqual([]);
      expect(discovery.getDeferredTools()).toEqual([]);
    });
  });

  describe('setThreshold', () => {
    it('should update threshold', () => {
      discovery.setThreshold(20);
      expect(discovery.getThreshold()).toBe(20);
    });

    it('should reject invalid threshold', () => {
      expect(() => discovery.setThreshold(-1)).toThrow();
      expect(() => discovery.setThreshold(101)).toThrow();
    });
  });

  describe('partitionTools', () => {
    it('should load all tools when under threshold', () => {
      const result = discovery.partitionTools(sampleTools, 1000000);
      expect(result.loaded.length).toBe(sampleTools.length);
      expect(result.deferred.length).toBe(0);
    });

    it('should defer all tools when over threshold', () => {
      // Tiny context window forces deferral
      const result = discovery.partitionTools(sampleTools, 10);
      expect(result.loaded.length).toBe(0);
      expect(result.deferred.length).toBe(sampleTools.length);
    });

    it('should update internal state after partition', () => {
      discovery.partitionTools(sampleTools, 1000000);
      expect(discovery.getLoadedTools().length).toBe(sampleTools.length);
      expect(discovery.getDeferredTools().length).toBe(0);
    });

    it('should update deferred list after partition', () => {
      discovery.partitionTools(sampleTools, 10);
      expect(discovery.getDeferredTools().length).toBe(sampleTools.length);
      expect(discovery.getLoadedTools().length).toBe(0);
    });
  });
});
