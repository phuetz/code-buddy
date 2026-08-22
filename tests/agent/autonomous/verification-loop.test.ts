import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runVerificationAndSelfCorrectionLoop } from '../../../src/agent/autonomous/verification-loop.js';
import { loadCheckpoint } from '../../../src/agent/autonomous/checkpoint-manager.js';
import type { AgenticCodingTaskContract } from '../../../src/agent/autonomous/agentic-coding-contract.js';
import type { AgenticCodingEditProposalProducerDispatch } from '../../../src/agent/autonomous/agentic-coding-runner.js';
import type { CodeBuddyClient } from '../../../src/codebuddy/client.js';

const execFileAsync = promisify(execFile);

describe('runVerificationAndSelfCorrectionLoop', () => {
  let tempRoot: string;
  let repoPath: string;
  let testFile: string;
  let taskFile: string;
  let oldCodeBuddyHome: string | undefined;
  const allowedPaths = ['docs/example.md'];

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-verification-loop-'));
    oldCodeBuddyHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tempRoot;
    repoPath = path.join(tempRoot, 'repo');
    testFile = path.join(repoPath, 'docs/example.md');
    taskFile = path.join(tempRoot, 'task.json');

    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(path.dirname(testFile), { recursive: true });

    // Initialize clean git repository
    await execFileAsync('git', ['init'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });

    await fs.writeFile(
      taskFile,
      JSON.stringify({ allowedPaths }),
      'utf8'
    );
  });

  afterEach(async () => {
    process.env.CODEBUDDY_HOME = oldCodeBuddyHome;
    await fs.rm(tempRoot, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  });

  function getContract(repo: string): AgenticCodingTaskContract {
    return {
      repo,
      task: 'Fix the greeting in docs/example.md',
      allowedPaths,
      verification: [
        'node -e "const fs = require(\'fs\'); const content = fs.readFileSync(\'docs/example.md\', \'utf8\'); if (!content.includes(\'Hello Correct\')) throw new Error(\'Fails validation\');"'
      ],
      riskLevel: 'low',
      output: 'text',
      maxFilesChanged: 5,
      maxToolRounds: 5,
      memoryPolicy: 'none',
      fleetPolicy: 'none',
      edits: [
        {
          type: 'replace_text',
          path: 'docs/example.md',
          find: 'Hello Wrong',
          replace: 'Hello Wrong Correction Attempt',
          expectedOccurrences: 1,
        },
      ],
    };
  }

  function getDispatch(repo: string, taskPath: string): AgenticCodingEditProposalProducerDispatch {
    return {
      kind: 'agentic-coding-edit-proposal-producer-dispatch',
      generatedAt: new Date().toISOString(),
      allowedTools: ['file_read', 'rg', 'git_status'],
      disallowedActions: [],
      input: {
        repo,
        taskFile: taskPath,
        proposalPromptFile: path.join(repo, 'prompt.md'),
      },
      output: {
        editProposalFile: path.join(repo, 'edit-proposal.json'),
        reviewCommand: { executable: 'buddy', args: [] },
        schema: {},
      },
      currentState: {
        approvalState: 'draft',
        workflow: {
          nodeErrors: [],
          blockedNodeIds: [],
          nodes: [],
          edges: [],
        },
      },
      runPolicy: {
        cwd: repo,
        maxToolRounds: 5,
        mode: 'data_only_edit_proposal',
      },
      messages: [
        { role: 'user', content: 'Generate edits.' }
      ],
      schemaVersion: 1,
      safety: [],
      source: {
        repo,
        status: 'ready',
        taskFile: taskPath,
      },
    };
  }

  it('returns immediately if verification passes on first try', async () => {
    // Write correct greeting and commit it to make it clean
    await fs.writeFile(testFile, 'Hello Correct content', 'utf8');
    await execFileAsync('git', ['add', 'docs/example.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });

    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    // Inject a client so the loop does not call detectProviderFromEnv(), which
    // throws "No LLM provider configuration found" on CI runners that have no
    // API keys. Verification passes on the first try, so the client is never
    // actually used (chat would fail the test loudly if it were).
    const chat = vi.fn(() => {
      throw new Error('chat must not be called when verification passes on first try');
    });
    const mockClient = {
      chat,
      getCurrentModel: () => 'gpt-4o',
    } as unknown as CodeBuddyClient;

    const result = await runVerificationAndSelfCorrectionLoop(
      {
        ...contract,
        edits: [], // No edits needed, already correct
      },
      { taskFile },
      dispatch,
      mockClient
    );

    expect(result.status).toBe('verified');
    expect(result.iterations).toBe(0);
    expect(result.verification[0].status).toBe('passed');
  });

  it('runs loop and corrects edit proposal from wrong to correct', async () => {
    // Write initial wrong greeting and commit it so we have a clean baseline
    await fs.writeFile(testFile, 'Hello Wrong content', 'utf8');
    await execFileAsync('git', ['add', 'docs/example.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });

    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    // Mock client:
    // Chat call will return a correct edit proposal on the second round
    const chat = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '```json\n{\n  "summary": "Fix correctly",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "Hello Wrong",\n      "replace": "Hello Correct",\n      "expectedOccurrences": 1\n    }\n  ],\n  "risks": [],\n  "verificationNotes": []\n}\n```',
          },
        },
      ],
    });
    const mockClient = {
      chat,
      getCurrentModel: () => 'gpt-4o',
    } as unknown as CodeBuddyClient;

    const result = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile },
      dispatch,
      mockClient,
      2
    );

    expect(result.status).toBe('verified');
    expect(result.iterations).toBe(1);
    expect(result.verification[0].status).toBe('passed');
    const chatMessages = chat.mock.calls[0]?.[0] as Array<{ content: string; role: string }>;
    expect(chatMessages.some((message) => message.content.includes('Mode: self-correction'))).toBe(true);
    expect(chatMessages.some((message) => message.content.includes('Protect user work'))).toBe(true);

    const updatedContent = await fs.readFile(testFile, 'utf8');
    expect(updatedContent).toBe('Hello Correct content');
  });

  it('returns blocked when max iterations exceeded and rolls back edits', async () => {
    // Write initial wrong greeting and commit it
    await fs.writeFile(testFile, 'Hello Wrong content', 'utf8');
    await execFileAsync('git', ['add', 'docs/example.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });

    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    // Mock client: keeps returning a proposal that replaces Wrong with Broken, which still fails the test.
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n{\n  "summary": "Fix incorrectly again",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "Hello Wrong",\n      "replace": "Hello Broken",\n      "expectedOccurrences": 1\n    }\n  ],\n  "risks": [],\n  "verificationNotes": []\n}\n```',
            },
          },
        ],
      }),
      getCurrentModel: () => 'gpt-4o',
    } as unknown as CodeBuddyClient;

    const result = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile },
      dispatch,
      mockClient,
      2 // max iterations = 2
    );

    expect(result.status).toBe('blocked');
    expect(result.iterations).toBe(2);
    expect(result.reason).toContain('Maximum iterations (2) reached');

    // Verify files were rolled back
    const fileContent = await fs.readFile(testFile, 'utf8');
    expect(fileContent).toBe('Hello Wrong content');
  });

  it('saves a blocked checkpoint with resume reason when max iterations are exhausted', async () => {
    await fs.writeFile(testFile, 'Hello Wrong content', 'utf8');
    await execFileAsync('git', ['add', 'docs/example.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });

    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n{\n  "summary": "Fix incorrectly again",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "Hello Wrong",\n      "replace": "Hello Broken",\n      "expectedOccurrences": 1\n    }\n  ],\n  "risks": [],\n  "verificationNotes": []\n}\n```',
            },
          },
        ],
      }),
      getCurrentModel: () => 'gpt-4o',
    } as unknown as CodeBuddyClient;

    const result = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile, runId: 'blocked-loop-run' },
      dispatch,
      mockClient,
      1,
    );

    expect(result.status).toBe('blocked');
    const checkpoint = await loadCheckpoint('blocked-loop-run');
    expect(checkpoint?.step).toBe('blocked');
    expect(checkpoint?.blockedReasons?.[0]).toContain('Maximum iterations (1) reached');
    expect(checkpoint?.verification?.[0]).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('uses options.maxIterations as the loop budget when provided', async () => {
    await fs.writeFile(testFile, 'Hello Wrong content', 'utf8');
    await execFileAsync('git', ['add', 'docs/example.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });

    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n{\n  "summary": "Fix incorrectly again",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "Hello Wrong",\n      "replace": "Hello Broken",\n      "expectedOccurrences": 1\n    }\n  ],\n  "risks": [],\n  "verificationNotes": []\n}\n```',
            },
          },
        ],
      }),
      getCurrentModel: () => 'gpt-4o',
    } as unknown as CodeBuddyClient;

    const result = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile, maxIterations: 1 },
      dispatch,
      mockClient,
    );

    expect(result.status).toBe('blocked');
    expect(result.iterations).toBe(1);
    expect(result.reason).toContain('Maximum iterations (1) reached');
  });

  it('returns blocked before work starts when loop budget options are invalid', async () => {
    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    const invalidIterations = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile, maxIterations: 0, runId: 'invalid-iterations-run' },
      dispatch,
    );

    expect(invalidIterations.status).toBe('blocked');
    expect(invalidIterations.reason).toContain('maxIterations must be a positive integer');
    expect((await loadCheckpoint('invalid-iterations-run'))?.step).toBe('blocked');

    const invalidCost = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile, maxCostUsd: Number.NaN },
      dispatch,
    );

    expect(invalidCost.status).toBe('blocked');
    expect(invalidCost.reason).toContain('maxCostUsd must be a finite non-negative number');
  });

  it('returns blocked when cost limit is exceeded', async () => {
    // Write initial wrong greeting and commit it
    await fs.writeFile(testFile, 'Hello Wrong content', 'utf8');
    await execFileAsync('git', ['add', 'docs/example.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });

    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    // Mock client that returns a proposal, but we'll set the cost limit to a very small amount
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n{\n  "summary": "Fix incorrectly again",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "Hello Wrong",\n      "replace": "Hello Broken",\n      "expectedOccurrences": 1\n    }\n  ],\n  "risks": [],\n  "verificationNotes": []\n}\n```',
            },
          },
        ],
        usage: {
          prompt_tokens: 100000,
          completion_tokens: 100000,
        }
      }),
      getCurrentModel: () => 'gpt-4o',
    } as unknown as CodeBuddyClient;

    const result = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile, maxCostUsd: 0.00001 }, // setting extremely low cost limit
      dispatch,
      mockClient,
      2
    );

    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('Cost budget');
    
    // Verify files were rolled back
    const fileContent = await fs.readFile(testFile, 'utf8');
    expect(fileContent).toBe('Hello Wrong content');
  });

  it('retries on proposal validation errors and returns blocked with reason when limit is reached', async () => {
    // Write initial wrong greeting and commit it
    await fs.writeFile(testFile, 'Hello Wrong content', 'utf8');
    await execFileAsync('git', ['add', 'docs/example.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });

    const contract = getContract(repoPath);
    const dispatch = getDispatch(repoPath, taskFile);

    // Mock client: returns an invalid JSON (non-JSON text) which fails validation
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'I am unable to fix this verification failure because it is a hardcoded error.',
            },
          },
        ],
      }),
      getCurrentModel: () => 'gpt-4o',
    } as unknown as CodeBuddyClient;

    const result = await runVerificationAndSelfCorrectionLoop(
      contract,
      { taskFile },
      dispatch,
      mockClient,
      2
    );

    expect(result.status).toBe('blocked');
    expect(result.iterations).toBe(2);
    expect(result.reason).toContain('Maximum iterations (2) reached');
    expect(result.reason).toContain('Last proposal validation error');
    expect(result.reason).toContain('Failed to parse LLM response as JSON');

    // Verify files were rolled back
    const fileContent = await fs.readFile(testFile, 'utf8');
    expect(fileContent).toBe('Hello Wrong content');
  });
});
