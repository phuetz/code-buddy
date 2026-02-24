/**
 * Tests for Issue-to-PR Pipeline
 */

import { runIssuePipeline } from '../../../src/commands/dev/issue-pipeline.js';

// ── Mocks ──────────────────────────────────────────────────────────

// Mock child_process
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// Mock workflows
const mockRunWorkflow = jest.fn();
jest.mock('../../../src/commands/dev/workflows.js', () => ({
  runWorkflow: (...args: unknown[]) => mockRunWorkflow(...args),
}));

// Mock agent
function createMockAgent() {
  return {
    processUserMessageStream: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content', content: 'test output' };
      },
    }),
    systemPromptReady: Promise.resolve(),
    dispose: jest.fn(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('runIssuePipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches issue and creates branch', async () => {
    const issueData = {
      number: 42,
      title: 'Add dark mode',
      body: 'Please add dark mode support',
      labels: [{ name: 'enhancement' }],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))  // gh issue view
      .mockReturnValueOnce('')                           // git checkout -b
      .mockReturnValueOnce('')                           // git add
      .mockReturnValueOnce('')                           // git commit
      .mockReturnValueOnce('')                           // git push
      .mockReturnValueOnce('https://github.com/test/repo/pull/1');  // gh pr create

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-123',
      status: 'completed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    const result = await runIssuePipeline('42', agent);

    expect(result.issueNumber).toBe(42);
    expect(result.branch).toBe('feat/42-add-dark-mode');
    expect(result.status).toBe('completed');
  });

  it('maps bug label to fix-tests workflow', async () => {
    const issueData = {
      number: 10,
      title: 'Login broken',
      body: 'Login form does not submit',
      labels: [{ name: 'bug' }],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))
      .mockReturnValueOnce('')   // git checkout -b
      .mockReturnValueOnce('')   // git add
      .mockReturnValueOnce('')   // git commit
      .mockReturnValueOnce('')   // git push
      .mockReturnValueOnce('https://github.com/test/repo/pull/2');

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-456',
      status: 'completed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    await runIssuePipeline('10', agent);

    expect(mockRunWorkflow).toHaveBeenCalledWith(
      'fix-tests',
      expect.stringContaining('#10'),
      agent,
      expect.objectContaining({ writePolicyMode: 'strict' }),
    );
  });

  it('maps security label to security-audit workflow', async () => {
    const issueData = {
      number: 20,
      title: 'XSS vulnerability',
      body: 'Found XSS in user input',
      labels: [{ name: 'security' }],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))
      .mockReturnValueOnce('')   // git checkout -b
      .mockReturnValueOnce('')   // git add
      .mockReturnValueOnce('')   // git commit
      .mockReturnValueOnce('')   // git push
      .mockReturnValueOnce('https://github.com/test/repo/pull/3');

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-789',
      status: 'completed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    await runIssuePipeline('20', agent);

    expect(mockRunWorkflow).toHaveBeenCalledWith(
      'security-audit',
      expect.stringContaining('#20'),
      agent,
      expect.any(Object),
    );
  });

  it('defaults to add-feature for unknown labels', async () => {
    const issueData = {
      number: 30,
      title: 'Add CSV export',
      body: 'Export data as CSV',
      labels: [{ name: 'custom-label' }],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))
      .mockReturnValueOnce('')   // git checkout -b
      .mockReturnValueOnce('')   // git add
      .mockReturnValueOnce('')   // git commit
      .mockReturnValueOnce('')   // git push
      .mockReturnValueOnce('https://github.com/test/repo/pull/4');

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-101',
      status: 'completed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    await runIssuePipeline('30', agent);

    expect(mockRunWorkflow).toHaveBeenCalledWith(
      'add-feature',
      expect.any(String),
      agent,
      expect.any(Object),
    );
  });

  it('handles workflow failure gracefully', async () => {
    const issueData = {
      number: 50,
      title: 'Complex task',
      body: 'Very hard',
      labels: [],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))
      .mockReturnValueOnce('');  // git checkout -b

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-fail',
      status: 'failed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    const result = await runIssuePipeline('50', agent);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('failed');
  });

  it('handles invalid issue reference', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const agent = createMockAgent() as any;
    await expect(runIssuePipeline('not-a-number', agent)).rejects.toThrow('Cannot parse issue reference');
  });

  it('extracts issue number from URL', async () => {
    const issueData = {
      number: 99,
      title: 'From URL',
      body: 'Test',
      labels: [],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))
      .mockReturnValueOnce('')   // git checkout -b
      .mockReturnValueOnce('')   // git add
      .mockReturnValueOnce('')   // git commit
      .mockReturnValueOnce('')   // git push
      .mockReturnValueOnce('https://github.com/test/repo/pull/5');

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-url',
      status: 'completed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    const result = await runIssuePipeline(
      'https://github.com/owner/repo/issues/99',
      agent,
    );

    expect(result.issueNumber).toBe(99);
  });

  it('handles branch creation failure by switching to existing', async () => {
    const issueData = {
      number: 77,
      title: 'Existing branch',
      body: 'Resume work',
      labels: [],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))     // gh issue view
      .mockImplementationOnce(() => { throw new Error('branch exists'); })  // git checkout -b fails
      .mockReturnValueOnce('')                              // git checkout (existing)
      .mockReturnValueOnce('')                              // git add
      .mockReturnValueOnce('')                              // git commit
      .mockReturnValueOnce('')                              // git push
      .mockReturnValueOnce('https://github.com/test/repo/pull/6');

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-existing',
      status: 'completed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    const result = await runIssuePipeline('77', agent);

    expect(result.status).toBe('completed');
  });

  it('slugifies branch name correctly', async () => {
    const issueData = {
      number: 88,
      title: 'Add support for "special" chars & more!',
      body: 'Test',
      labels: [],
    };

    mockExecSync
      .mockReturnValueOnce(JSON.stringify(issueData))
      .mockReturnValueOnce('')   // git checkout -b
      .mockReturnValueOnce('')   // git add
      .mockReturnValueOnce('')   // git commit
      .mockReturnValueOnce('')   // git push
      .mockReturnValueOnce('');

    mockRunWorkflow.mockResolvedValue({
      runId: 'run-slug',
      status: 'completed',
      artifactPaths: [],
    });

    const agent = createMockAgent() as any;
    const result = await runIssuePipeline('88', agent);

    expect(result.branch).toBe('feat/88-add-support-for-special-chars-more');
  });
});
