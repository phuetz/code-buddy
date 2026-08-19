import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateCompletedSupervisionWindowMs,
  registerAutonomousCodeCommand,
} from '../../src/commands/cli/autonomous-code-command.js';
import { saveCheckpoint } from '../../src/agent/autonomous/checkpoint-manager.js';

const execFileAsync = promisify(execFile);

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;
let oldGrokKey: string | undefined;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

async function createTaskFile(overrides: Record<string, unknown> = {}): Promise<{ repo: string; taskFile: string }> {
  const repo = await fs.mkdtemp(path.join(tempRoot, 'repo-'));
  await execFileAsync('git', ['init'], { cwd: repo });
  const taskFile = path.join(tempRoot, 'task.json');
  await fs.writeFile(taskFile, JSON.stringify({
    repo,
    task: 'Run CLI preflight.',
    allowedPaths: ['docs/...'],
    verification: ['node -e "console.log(123)"'],
    riskLevel: 'low',
    ...overrides,
  }), 'utf8');
  return { repo, taskFile };
}

function createProducerTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fleet: {
      attemptedPeerChainCalls: 1,
      attemptedRoutePeerCalls: 0,
      completedPeerChainCalls: 1,
      completedRoutePeerCalls: 0,
      expectedCollaboration: true,
      mode: 'data_only_delegated_slices',
      policy: 'delegated-slices',
      state: 'completed',
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
    kind: 'agentic-coding-edit-proposal-producer-trace',
    maxToolRounds: 50,
    messageRounds: 1,
    schemaVersion: 1,
    source: {
      repo: 'repo',
      taskFile: 'task.json',
    },
    toolCalls: [
      {
        allowed: true,
        args: {
          chainRoles: ['research', 'code', 'review', 'safe'],
          privacyTag: 'sensitive',
          promptLength: 42,
        },
        index: 1,
        name: 'peer_chain',
        resultSummary: 'returned 120 chars',
        success: true,
      },
    ],
    ...overrides,
  };
}

describe('autonomous-code CLI command', () => {
  let oldHome: string | undefined;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-autonomous-code-cli-'));
    oldHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tempRoot;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The verification/self-correction loop resolves an LLM client up front and
    // throws "No LLM provider configuration found" when none is detected. CI
    // runners have no API keys, so pin a dummy provider key to make detection
    // deterministic. Verification here passes before any LLM call, so the client
    // is constructed but never invoked — no network.
    oldGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = 'test-dummy-key-not-used';
  });

  afterEach(async () => {
    vi.doUnmock('../../src/agent/autonomous/edit-proposal-producer.js');
    vi.doUnmock('../../src/agent/autonomous/agentic-coding-runner.js');
    process.env.CODEBUDDY_HOME = oldHome;
    if (oldGrokKey === undefined) {
      delete process.env.GROK_API_KEY;
    } else {
      process.env.GROK_API_KEY = oldGrokKey;
    }
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await fs.rm(tempRoot, { force: true, recursive: true });
  });

  it('prints JSON report for a valid task contract', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      autoExecutable: boolean;
      plan: Array<{ id: string; status: string }>;
      verificationRequested: boolean;
      workflow: { activeNodeId?: string; nodes: Array<{ id: string }> };
    };

    expect(output.status).toBe('ready');
    expect(output.autoExecutable).toBe(true);
    expect(output.workflow.activeNodeId).toBe('understanding');
    expect(output.workflow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'contract' }),
      expect.objectContaining({ id: 'scoped-edit' }),
    ]));
    expect(output.verificationRequested).toBe(false);
    expect(output.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'understanding', status: 'ready' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'pending' }),
    ]));
  });

  it('can run requested verification from the CLI', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--run-verification',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      verification: Array<{ status: string; stdout: string }>;
    };

    expect(output.status).toBe('verified');
    expect(output.verification[0]).toEqual(expect.objectContaining({
      status: 'passed',
      stdout: expect.stringContaining('123'),
    }));
  });

  it('writes a JSON report file when requested', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    const reportFile = path.join(tempRoot, 'reports', 'run.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--report-file',
      reportFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      reportPath: string;
      status: string;
    };
    const saved = JSON.parse(await fs.readFile(output.reportPath, 'utf8')) as { status: string };

    expect(output.status).toBe('ready');
    expect(output.reportPath).toBe(reportFile);
    expect(saved.status).toBe('ready');
  });

  it('can apply declared edits from the CLI', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--apply-edits',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editResults: Array<{ path: string; status: string }>;
      status: string;
    };
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(output.status).toBe('edited');
    expect(output.editResults).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'applied' }),
    ]);
    expect(edited).toBe('after\n');
  });

  it('can apply edits from a controlled proposal file', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const proposalFile = path.join(tempRoot, 'proposal.json');
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Replace the placeholder word.',
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-file',
      proposalFile,
      '--apply-edits',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editProposal: { editCount: number; summary: string };
      status: string;
    };
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(output.status).toBe('edited');
    expect(output.editProposal).toEqual(expect.objectContaining({
      editCount: 1,
      summary: 'Replace the placeholder word.',
    }));
    expect(edited).toBe('after\n');
  });

  it('can require preview before applying edits from a controlled proposal file', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const proposalFile = path.join(tempRoot, 'required-preview-proposal.json');
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Replace the placeholder word after preview.',
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-file',
      proposalFile,
      '--require-preview',
      '--apply-edits',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      approval: { state: string };
      editPreviewRequired: boolean;
      editPreviews: Array<{ path: string; status: string }>;
      editResults: Array<{ path: string; status: string }>;
      status: string;
    };
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(output.status).toBe('edited');
    expect(output.approval.state).toBe('approved');
    expect(output.editPreviewRequired).toBe(true);
    expect(output.editPreviews).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'previewed' }),
    ]);
    expect(output.editResults).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'applied' }),
    ]);
    expect(edited).toBe('after\n');
  });

  it('can preview edits from a controlled proposal file without writing', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const proposalFile = path.join(tempRoot, 'preview-proposal.json');
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Preview the placeholder replacement.',
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-file',
      proposalFile,
      '--preview-edits',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editPreviews: Array<{ after: string; before: string; path: string; status: string }>;
      status: string;
    };
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(output.status).toBe('previewed');
    expect(output.editPreviews).toEqual([
      expect.objectContaining({
        after: 'after\n',
        before: 'before\n',
        path: 'docs/note.md',
        status: 'previewed',
      }),
    ]);
    expect(unchanged).toBe('before\n');
  });

  it('writes an edit proposal review snapshot when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const proposalFile = path.join(tempRoot, 'proposal.json');
    const reviewFile = path.join(tempRoot, 'reviews', 'edit-proposal-review.json');
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Review the placeholder replacement.',
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before\n',
        replace: 'after\n',
        expectedOccurrences: 1,
      }],
      producer: 'cli-agent',
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-file',
      proposalFile,
      '--edit-proposal-review-file',
      reviewFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editProposalReviewPath: string;
      status: string;
    };
    const review = JSON.parse(await fs.readFile(output.editProposalReviewPath, 'utf8')) as {
      editSummary: { declared: number; files: string[]; proposal: { producer: string; summary: string } };
      kind: string;
      nextAction: { type: string };
      state: string;
    };

    expect(output.status).toBe('ready');
    expect(output.editProposalReviewPath).toBe(reviewFile);
    expect(review.kind).toBe('agentic-coding-edit-proposal-review');
    expect(review.state).toBe('accepted');
    expect(review.nextAction.type).toBe('preview_edits');
    expect(review.editSummary).toEqual(expect.objectContaining({
      declared: 1,
      files: ['docs/note.md'],
      proposal: expect.objectContaining({
        producer: 'cli-agent',
        summary: 'Review the placeholder replacement.',
      }),
    }));
  });

  it('writes a constrained proposal prompt file when requested', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile({
      task: 'Prepare one docs edit.',
    });
    const proposalPromptFile = path.join(tempRoot, 'prompts', 'proposal-prompt.md');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--proposal-prompt-file',
      proposalPromptFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalPromptPath: string;
      status: string;
    };
    const prompt = await fs.readFile(output.proposalPromptPath, 'utf8');

    expect(output.status).toBe('ready');
    expect(output.proposalPromptPath).toBe(proposalPromptFile);
    expect(prompt).toContain('Prepare one docs edit.');
    expect(prompt).toContain('Return only valid JSON');
    expect(prompt).toContain('"type": "replace_text"');
  });

  it('writes a workflow canvas file when requested', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    const workflowFile = path.join(tempRoot, 'workflows', 'agentic-cell-workflow.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--workflow-file',
      workflowFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      workflowPath: string;
    };
    const workflow = JSON.parse(await fs.readFile(output.workflowPath, 'utf8')) as {
      kind: string;
      nodes: Array<{ id: string; type: string }>;
      source: { status: string };
    };

    expect(output.status).toBe('ready');
    expect(output.workflowPath).toBe(workflowFile);
    expect(workflow.kind).toBe('agentic-coding-workflow-canvas');
    expect(workflow.source.status).toBe('ready');
    expect(workflow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'contract', type: 'customNode' }),
      expect.objectContaining({ id: 'handoff', type: 'customNode' }),
    ]));
  });

  it('writes a workflow builder prompt file when requested', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile({
      task: 'Design the visible coding workflow.',
    });
    const workflowBuilderPromptFile = path.join(tempRoot, 'prompts', 'workflow-builder.md');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--workflow-builder-prompt-file',
      workflowBuilderPromptFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      workflowBuilderPromptPath: string;
    };
    const prompt = await fs.readFile(output.workflowBuilderPromptPath, 'utf8');

    expect(output.status).toBe('ready');
    expect(output.workflowBuilderPromptPath).toBe(workflowBuilderPromptFile);
    expect(prompt).toContain('Design the visible coding workflow.');
    expect(prompt).toContain('agentic-coding-workflow-builder-proposal');
    expect(prompt).toContain('Current runner canvas:');
  });

  it('loads a workflow builder proposal file when requested', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    const workflowBuilderProposalFile = path.join(tempRoot, 'workflow-builder-proposal.json');
    await fs.writeFile(workflowBuilderProposalFile, JSON.stringify({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Use a visible two-node workflow.',
      nodes: [
        {
          id: 'contract',
          label: 'Validate task',
          description: 'Validate the task contract.',
          agenticType: 'gate',
          type: 'trigger',
        },
        {
          id: 'handoff',
          label: 'Handoff',
          description: 'Summarize evidence for Cowork.',
          agenticType: 'handoff',
          type: 'action',
        },
      ],
      edges: [{ source: 'contract', target: 'handoff' }],
      approvalGates: ['Review graph before execution.'],
      coworkVisualizationNotes: ['Show node counts.'],
      risks: ['none'],
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--workflow-builder-proposal-file',
      workflowBuilderProposalFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      workflowBuilderProposal: {
        edgeCount: number;
        file: string;
        nodeCount: number;
        summary: string;
      };
    };

    expect(output.status).toBe('ready');
    expect(output.workflowBuilderProposal).toEqual(expect.objectContaining({
      edgeCount: 1,
      file: workflowBuilderProposalFile,
      nodeCount: 2,
      summary: 'Use a visible two-node workflow.',
    }));
  });

  it('writes a workflow builder proposal canvas file when requested', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    const workflowBuilderProposalFile = path.join(tempRoot, 'workflow-builder-proposal.json');
    const workflowBuilderProposalCanvasFile = path.join(
      tempRoot,
      'workflows',
      'workflow-builder-proposal-canvas.json',
    );
    await fs.writeFile(workflowBuilderProposalFile, JSON.stringify({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Render a proposal canvas.',
      nodes: [
        {
          id: 'contract',
          label: 'Validate task',
          description: 'Validate the task contract.',
          agenticType: 'gate',
          type: 'trigger',
        },
        {
          id: 'handoff',
          label: 'Handoff',
          description: 'Summarize evidence for Cowork.',
          agenticType: 'handoff',
          type: 'action',
        },
      ],
      edges: [{ source: 'contract', target: 'handoff' }],
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--workflow-builder-proposal-file',
      workflowBuilderProposalFile,
      '--workflow-builder-proposal-canvas-file',
      workflowBuilderProposalCanvasFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      workflowBuilderProposalCanvasPath: string;
    };
    const canvas = JSON.parse(await fs.readFile(output.workflowBuilderProposalCanvasPath, 'utf8')) as {
      kind: string;
      nodes: Array<{ id: string; type: string }>;
      source: { proposalFile: string };
      summary: string;
    };

    expect(output.status).toBe('ready');
    expect(output.workflowBuilderProposalCanvasPath).toBe(workflowBuilderProposalCanvasFile);
    expect(canvas.kind).toBe('agentic-coding-workflow-builder-proposal-canvas');
    expect(canvas.source.proposalFile).toBe(workflowBuilderProposalFile);
    expect(canvas.summary).toBe('Render a proposal canvas.');
    expect(canvas.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'contract', type: 'customNode' }),
    ]));
  });

  it('writes a workflow progress snapshot file when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    await fs.writeFile(path.join(repo, 'package.json'), '{}\n', 'utf8');
    const workflowProgressFile = path.join(tempRoot, 'workflows', 'agentic-cell-progress.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--workflow-progress-file',
      workflowProgressFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      workflowProgressPath: string;
    };
    const progress = JSON.parse(await fs.readFile(output.workflowProgressPath, 'utf8')) as {
      activeNodeId: string;
      counts: { blocked: number; total: number };
      kind: string;
      nextAction: { nodeId?: string; type: string };
      nodeErrors: Array<{ nodeId: string }>;
    };

    expect(output.status).toBe('blocked');
    expect(output.workflowProgressPath).toBe(workflowProgressFile);
    expect(progress.kind).toBe('agentic-coding-workflow-progress');
    expect(progress.activeNodeId).toBe('git-preflight');
    expect(progress.counts).toEqual(expect.objectContaining({ blocked: 2, total: 12 }));
    expect(progress.nextAction).toEqual({
      message: 'Dirty files outside allowedPaths: package.json.',
      nodeId: 'git-preflight',
      type: 'inspect_blocker',
    });
    expect(progress.nodeErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'git-preflight' }),
    ]));
  });

  it('writes a workflow events timeline file when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    await fs.writeFile(path.join(repo, 'package.json'), '{}\n', 'utf8');
    const workflowEventsFile = path.join(tempRoot, 'workflows', 'agentic-cell-events.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--workflow-events-file',
      workflowEventsFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      workflowEventsPath: string;
    };
    const events = JSON.parse(await fs.readFile(output.workflowEventsPath, 'utf8')) as {
      activeNodeId: string;
      events: Array<{ active: boolean; nodeId: string; severity: string; status: string }>;
      kind: string;
    };

    expect(output.status).toBe('blocked');
    expect(output.workflowEventsPath).toBe(workflowEventsFile);
    expect(events.kind).toBe('agentic-coding-workflow-events');
    expect(events.activeNodeId).toBe('git-preflight');
    expect(events.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        nodeId: 'git-preflight',
        severity: 'error',
        status: 'blocked',
      }),
    ]));
  });

  it('writes a compact approval state file when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const approvalFile = path.join(tempRoot, 'approvals', 'agentic-cell-approval.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--approval-file',
      approvalFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      approvalPath: string;
      status: string;
    };
    const approval = JSON.parse(await fs.readFile(output.approvalPath, 'utf8')) as {
      editSummary: { declared: number; files: string[]; previewed: number };
      kind: string;
      nextAction: { nodeId?: string; type: string };
      state: string;
    };

    expect(output.status).toBe('previewed');
    expect(output.approvalPath).toBe(approvalFile);
    expect(approval.kind).toBe('agentic-coding-approval-state');
    expect(approval.state).toBe('needs_approval');
    expect(approval.nextAction).toEqual({
      message: 'Scoped edit preview is ready for human or Cowork approval before applying.',
      nodeId: 'edit-preview',
      type: 'review_preview',
    });
    expect(approval.editSummary).toEqual(expect.objectContaining({
      declared: 1,
      files: ['docs/note.md'],
      previewed: 1,
    }));
  });

  it('writes an approval decision prompt file when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const approvalDecisionPromptFile = path.join(tempRoot, 'prompts', 'approval-decision.md');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--approval-decision-prompt-file',
      approvalDecisionPromptFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      approvalDecisionPromptPath: string;
      status: string;
    };
    const prompt = await fs.readFile(output.approvalDecisionPromptPath, 'utf8');

    expect(output.status).toBe('previewed');
    expect(output.approvalDecisionPromptPath).toBe(approvalDecisionPromptFile);
    expect(prompt).toContain('agentic-coding-approval-decision');
    expect(prompt).toContain('Scoped edit previews:');
    expect(prompt).toContain('docs/note.md');
    expect(prompt).toContain('Use decision "approved"');
  });

  it('writes a proposal loop packet when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const proposalLoopFile = path.join(tempRoot, 'loop', 'proposal-loop.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--proposal-loop-file',
      proposalLoopFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalLoopPath: string;
      status: string;
    };
    const loop = JSON.parse(await fs.readFile(output.proposalLoopPath, 'utf8')) as {
      activeStepId: string;
      artifacts: { approvalDecisionFile: string; editProposalFile: string; editProposalReviewFile: string };
      completedStepIds: string[];
      counts: { completed: number; ready: number; total: number };
      events: Array<{ active: boolean; sequence: number; severity: string; stepId: string }>;
      kind: string;
      nextAction: { stepId: string; type: string };
      edges: Array<{ source: string; target: string }>;
      nodes: Array<{ id: string; type: string }>;
      prompts: { approvalDecision: string; editProposal: string };
      steps: Array<{ id: string; outputArtifacts: string[]; status: string }>;
    };

    expect(output.status).toBe('previewed');
    expect(output.proposalLoopPath).toBe(proposalLoopFile);
    expect(loop.activeStepId).toBe('review-preview');
    expect(loop.kind).toBe('agentic-coding-proposal-loop');
    expect(loop.counts).toEqual(expect.objectContaining({
      completed: 4,
      ready: 1,
      total: 8,
    }));
    expect(loop.completedStepIds).toEqual([
      'prepare-edit-proposal-prompt',
      'produce-edit-proposal',
      'review-edit-proposal',
      'preview-scoped-edits',
    ]);
    expect(loop.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'review-edit-proposal',
        type: 'analysis',
      }),
      expect.objectContaining({
        id: 'review-preview',
        type: 'approval',
      }),
    ]));
    expect(loop.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'produce-edit-proposal',
        target: 'review-edit-proposal',
      }),
      expect.objectContaining({
        source: 'review-edit-proposal',
        target: 'preview-scoped-edits',
      }),
      expect.objectContaining({
        source: 'review-preview',
        target: 'apply-approved-edits',
      }),
    ]));
    expect(loop.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        sequence: 5,
        severity: 'warning',
        stepId: 'review-preview',
      }),
    ]));
    expect(loop.nextAction).toEqual(expect.objectContaining({
      stepId: 'review-preview',
      type: 'review_preview',
    }));
    expect(loop.artifacts.editProposalFile).toBe(path.join(path.dirname(proposalLoopFile), 'edit-proposal.json'));
    expect(loop.artifacts.editProposalReviewFile).toBe(path.join(path.dirname(proposalLoopFile), 'edit-proposal-review.json'));
    expect(loop.prompts.editProposal).toContain('controlled edit proposal');
    expect(loop.prompts.approvalDecision).toContain('agentic-coding-approval-decision');
    expect(loop.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'review-edit-proposal',
        outputArtifacts: expect.arrayContaining([path.join(path.dirname(proposalLoopFile), 'edit-proposal-review.json')]),
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'preview-scoped-edits',
        outputArtifacts: expect.arrayContaining([path.join(path.dirname(proposalLoopFile), 'approval-decision-prompt.md')]),
        status: 'completed',
      }),
    ]));
  });

  it('writes a proposal loop canvas file when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const proposalLoopCanvasFile = path.join(tempRoot, 'loop', 'proposal-loop-canvas.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--proposal-loop-canvas-file',
      proposalLoopCanvasFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalLoopCanvasPath: string;
      status: string;
    };
    const canvas = JSON.parse(await fs.readFile(output.proposalLoopCanvasPath, 'utf8')) as {
      activeNodeId: string;
      edges: Array<{ source: string; style?: { stroke: string; strokeWidth: number }; target: string }>;
      kind: string;
      nodes: Array<{
        data: {
          agenticType?: string;
          iconName?: string;
          status?: string;
          type?: string;
        };
        id: string;
        type: string;
      }>;
    };

    expect(output.status).toBe('previewed');
    expect(output.proposalLoopCanvasPath).toBe(proposalLoopCanvasFile);
    expect(canvas.kind).toBe('agentic-coding-proposal-loop-canvas');
    expect(canvas.activeNodeId).toBe('review-preview');
    expect(canvas.nodes.length).toBe(8);
    expect(canvas.edges.length).toBe(7);
    expect(canvas.nodes.find((node) => node.id === 'review-edit-proposal')).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        agenticType: 'analysis',
        iconName: 'Search',
        status: 'completed',
        type: 'action',
      }),
      type: 'customNode',
    }));
    expect(canvas.nodes.find((node) => node.id === 'review-preview')).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        agenticType: 'approval',
        iconName: 'ClipboardCheck',
        status: 'ready',
        type: 'logic',
      }),
      type: 'customNode',
    }));
    expect(canvas.nodes.find((node) => node.id === 'prepare-edit-proposal-prompt')).toEqual(expect.objectContaining({
      data: expect.objectContaining({ type: 'trigger' }),
      type: 'customNode',
    }));
    expect(canvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'review-preview',
        style: { stroke: '#14b8a6', strokeWidth: 2 },
        target: 'apply-approved-edits',
      }),
    ]));
  });

  it('writes a proposal loop next-action snapshot when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const editProposalFile = path.join(tempRoot, 'edit-proposal.json');
    await fs.writeFile(editProposalFile, JSON.stringify({
      summary: 'Update note.',
      producer: 'agent-producer',
      risks: ['none'],
      verificationNotes: ['Smoke only.'],
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }), 'utf8');
    const proposalLoopNextActionFile = path.join(tempRoot, 'loop', 'proposal-loop-next-action.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-file',
      editProposalFile,
      '--proposal-loop-next-action-file',
      proposalLoopNextActionFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalLoopNextActionPath: string;
      status: string;
    };
    const nextAction = JSON.parse(await fs.readFile(output.proposalLoopNextActionPath, 'utf8')) as {
      activeStep: { command?: { args: string[] }; id: string; status: string };
      canRunCommand: boolean;
      kind: string;
      nextAction: { stepId: string; type: string };
      runState: string;
      ui: { primaryAction: { commandText?: string; enabled: boolean; type: string } };
    };

    expect(output.status).toBe('ready');
    expect(output.proposalLoopNextActionPath).toBe(proposalLoopNextActionFile);
    expect(nextAction).toEqual(expect.objectContaining({
      activeStep: expect.objectContaining({
        id: 'review-edit-proposal',
        status: 'ready',
      }),
      canRunCommand: true,
      kind: 'agentic-coding-proposal-loop-next-action',
      nextAction: expect.objectContaining({
        stepId: 'review-edit-proposal',
        type: 'review_edit_proposal',
      }),
      runState: 'ready_command',
      ui: expect.objectContaining({
        primaryAction: expect.objectContaining({
          commandText: expect.stringContaining('buddy autonomous-code'),
          enabled: true,
          type: 'run_command',
        }),
      }),
    }));
    expect(nextAction.activeStep.command?.args).toEqual(expect.arrayContaining(['--edit-proposal-review-file']));
  });

  it('writes an edit proposal producer dispatch when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      task: 'Prepare a safe docs edit proposal.',
    });
    const dispatchFile = path.join(tempRoot, 'loop', 'edit-proposal-producer-dispatch.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-producer-dispatch-file',
      dispatchFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      fleet: {
        chainRoles: string[];
        mode: string;
        policy: string;
      };
      editProposalProducerDispatchPath: string;
      status: string;
    };
    const dispatch = JSON.parse(await fs.readFile(output.editProposalProducerDispatchPath, 'utf8')) as {
      allowedTools: string[];
      disallowedActions: string[];
      kind: string;
      messages: Array<{ content: string; role: string }>;
      output: { editProposalFile: string; reviewCommand: { args: string[] } };
      runPolicy: { cwd: string; mode: string };
    };

    expect(output.status).toBe('ready');
    expect(output.editProposalProducerDispatchPath).toBe(dispatchFile);
    expect(dispatch).toEqual(expect.objectContaining({
      allowedTools: expect.arrayContaining(['file_read', 'rg']),
      disallowedActions: expect.arrayContaining(['apply_patch', 'shell_exec']),
      kind: 'agentic-coding-edit-proposal-producer-dispatch',
      output: expect.objectContaining({
        editProposalFile: path.join(path.dirname(dispatchFile), 'edit-proposal.json'),
        reviewCommand: expect.objectContaining({
          args: expect.arrayContaining(['--edit-proposal-review-file']),
        }),
      }),
      runPolicy: expect.objectContaining({
        cwd: repo,
        mode: 'data_only_edit_proposal',
      }),
    }));
    expect(dispatch.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringContaining('Prepare a safe docs edit proposal.'),
        role: 'user',
      }),
    ]));
  });

  it('includes Fleet peer-chain guidance in producer dispatches for delegated slices', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile({
      fleetPolicy: 'delegated-slices',
      task: 'Coordinate peers for a safe docs proposal.',
    });
    const dispatchFile = path.join(tempRoot, 'loop', 'fleet-edit-proposal-producer-dispatch.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-producer-dispatch-file',
      dispatchFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editProposalProducerDispatchPath: string;
      fleet: {
        chainRoles: string[];
        mode: string;
        policy: string;
      };
      status: string;
    };
    const dispatch = JSON.parse(await fs.readFile(output.editProposalProducerDispatchPath, 'utf8')) as {
      allowedTools: string[];
      fleet: {
        chainRoles: string[];
        invocation: { tool: string };
        mode: string;
        policy: string;
      };
    };

    expect(output.status).toBe('ready');
    expect(output.fleet).toEqual(expect.objectContaining({
      chainRoles: ['research', 'code', 'review', 'safe'],
      mode: 'data_only_delegated_slices',
      policy: 'delegated-slices',
    }));
    expect(dispatch.allowedTools).toEqual(expect.arrayContaining(['route_peer', 'peer_chain']));
    expect(dispatch.fleet).toEqual(expect.objectContaining({
      chainRoles: ['research', 'code', 'review', 'safe'],
      invocation: expect.objectContaining({ tool: 'peer_chain' }),
      mode: 'data_only_delegated_slices',
      policy: 'delegated-slices',
    }));
  });

  it('runs the data-only producer and writes a generated edit proposal when requested', async () => {
    const generateEditProposalMock = vi.fn(async () => ({
      proposal: {
        summary: 'Generated docs update',
        edits: [
          {
            type: 'replace_text' as const,
            path: 'docs/readme.md',
            find: 'old',
            replace: 'new',
            expectedOccurrences: 1,
          },
        ],
        producer: 'mock-producer',
        risks: [],
        verificationNotes: ['Run declared verification after approval.'],
      },
      trace: createProducerTrace({
        source: {
          repo: 'mock-repo',
          taskFile: 'task.json',
        },
      }),
    }));
    vi.doMock('../../src/agent/autonomous/edit-proposal-producer.js', () => ({
      generateEditProposalWithTrace: generateEditProposalMock,
    }));

    const program = createProgram();
    const { taskFile } = await createTaskFile({
      fleetPolicy: 'delegated-slices',
      task: 'Generate a controlled docs proposal with Fleet advice.',
    });
    const proposalFile = path.join(tempRoot, 'loop', 'generated-edit-proposal.json');
    const dispatchFile = path.join(tempRoot, 'loop', 'generated-dispatch.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--generate-edit-proposal-file',
      proposalFile,
      '--edit-proposal-producer-dispatch-file',
      dispatchFile,
      '--require-fleet-collaboration',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editProposalProducerDispatchPath: string;
      editProposalProducerTracePath: string;
      generatedEditProposalPath: string;
      status: string;
    };
    const savedProposal = JSON.parse(await fs.readFile(output.generatedEditProposalPath, 'utf8')) as {
      edits: Array<{ path: string }>;
      producer: string;
      summary: string;
    };
    const savedDispatch = JSON.parse(await fs.readFile(output.editProposalProducerDispatchPath, 'utf8')) as {
      allowedTools: string[];
      fleet: { chainRoles: string[]; mode: string };
      messages: Array<{ content: string }>;
    };
    const savedTrace = JSON.parse(await fs.readFile(output.editProposalProducerTracePath, 'utf8')) as {
      fleet: { completedPeerChainCalls: number; state: string };
      kind: string;
      toolCalls: Array<{ name: string; success: boolean }>;
    };

    expect(output.status).toBe('ready');
    expect(output.generatedEditProposalPath).toBe(proposalFile);
    expect(output.editProposalProducerDispatchPath).toBe(dispatchFile);
    expect(output.editProposalProducerTracePath).toBe(path.join(path.dirname(proposalFile), 'edit-proposal-producer-trace.json'));
    expect(savedProposal).toEqual(expect.objectContaining({
      producer: 'mock-producer',
      summary: 'Generated docs update',
    }));
    expect(savedProposal.edits[0]?.path).toBe('docs/readme.md');
    expect(savedDispatch.allowedTools).toEqual(expect.arrayContaining(['route_peer', 'peer_chain']));
    expect(savedDispatch.fleet).toEqual(expect.objectContaining({
      chainRoles: ['research', 'code', 'review', 'safe'],
      mode: 'data_only_delegated_slices',
    }));
    expect(savedDispatch.messages[0]?.content).toContain('Fleet collaboration policy');
    expect(savedTrace).toEqual(expect.objectContaining({
      fleet: expect.objectContaining({
        completedPeerChainCalls: 1,
        state: 'completed',
      }),
      kind: 'agentic-coding-edit-proposal-producer-trace',
      toolCalls: [expect.objectContaining({ name: 'peer_chain', success: true })],
    }));
    expect(generateEditProposalMock).toHaveBeenCalledWith(expect.objectContaining({
      fleet: expect.objectContaining({ mode: 'data_only_delegated_slices' }),
    }));
  });

  it('rejects generated proposals when required Fleet collaboration did not complete', async () => {
    const generateEditProposalMock = vi.fn(async () => ({
      proposal: {
        summary: 'Generated without peer help',
        edits: [
          {
            type: 'replace_text' as const,
            path: 'docs/readme.md',
            find: 'old',
            replace: 'new',
            expectedOccurrences: 1,
          },
        ],
        producer: 'mock-producer',
        risks: [],
        verificationNotes: [],
      },
      trace: createProducerTrace({
        fleet: {
          attemptedPeerChainCalls: 1,
          attemptedRoutePeerCalls: 0,
          completedPeerChainCalls: 0,
          completedRoutePeerCalls: 0,
          expectedCollaboration: true,
          mode: 'data_only_delegated_slices',
          policy: 'delegated-slices',
          state: 'attempted',
        },
        toolCalls: [
          {
            allowed: true,
            args: { chainRoles: ['research', 'code', 'review', 'safe'], promptLength: 42 },
            error: 'No fleet peers connected',
            index: 1,
            name: 'peer_chain',
            resultSummary: 'Error: No fleet peers connected',
            success: false,
          },
        ],
      }),
    }));
    vi.doMock('../../src/agent/autonomous/edit-proposal-producer.js', () => ({
      generateEditProposalWithTrace: generateEditProposalMock,
    }));

    const program = createProgram();
    const { taskFile } = await createTaskFile({
      fleetPolicy: 'delegated-slices',
      task: 'Generate a controlled docs proposal with required Fleet help.',
    });
    const proposalFile = path.join(tempRoot, 'loop', 'rejected-generated-edit-proposal.json');
    const traceFile = path.join(path.dirname(proposalFile), 'edit-proposal-producer-trace.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--generate-edit-proposal-file',
      proposalFile,
      '--require-fleet-collaboration',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    const trace = JSON.parse(await fs.readFile(traceFile, 'utf8')) as {
      fleet: { completedPeerChainCalls: number; state: string };
      toolCalls: Array<{ name: string; success: boolean }>;
    };

    expect(errorOutput).toContain('--require-fleet-collaboration requires a generated proposal trace');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(trace.fleet).toEqual(expect.objectContaining({
      completedPeerChainCalls: 0,
      state: 'attempted',
    }));
    expect(trace.toolCalls).toEqual([
      expect.objectContaining({ name: 'peer_chain', success: false }),
    ]);
    await expect(fs.access(proposalFile)).rejects.toThrow();
  });

  it('can generate, preview, apply, and verify a proposal in one autonomous CLI run', async () => {
    const generateEditProposalMock = vi.fn(async () => ({
      proposal: {
        summary: 'Generated autonomous docs update',
        edits: [
          {
            type: 'replace_text' as const,
            path: 'docs/readme.md',
            find: 'old autonomous text',
            replace: 'new autonomous text',
            expectedOccurrences: 1,
          },
        ],
        producer: 'mock-producer',
        risks: [],
        verificationNotes: ['Verified by the CLI run.'],
      },
      trace: createProducerTrace(),
    }));
    vi.doMock('../../src/agent/autonomous/edit-proposal-producer.js', () => ({
      generateEditProposalWithTrace: generateEditProposalMock,
    }));

    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      task: 'Generate and apply a controlled docs proposal autonomously.',
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'readme.md'), 'old autonomous text\n', 'utf8');
    const proposalFile = path.join(tempRoot, 'loop', 'generated-apply-proposal.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--generate-edit-proposal-file',
      proposalFile,
      '--apply-edits',
      '--require-fleet-collaboration',
      '--require-preview',
      '--run-verification',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editPreviews: Array<{ path: string; status: string }>;
      editResults: Array<{ path: string; status: string }>;
      generatedEditProposalPath: string;
      status: string;
      verification: Array<{ status: string }>;
    };
    const finalContent = await fs.readFile(path.join(repo, 'docs', 'readme.md'), 'utf8');

    expect(output.status).toBe('verified');
    expect(output.generatedEditProposalPath).toBe(proposalFile);
    expect(output.editPreviews).toEqual([
      expect.objectContaining({ path: 'docs/readme.md', status: 'previewed' }),
    ]);
    expect(output.editResults).toEqual([
      expect.objectContaining({ path: 'docs/readme.md', status: 'applied' }),
    ]);
    expect(output.verification).toEqual([
      expect.objectContaining({ status: 'passed' }),
    ]);
    expect(finalContent).toBe('new autonomous text\n');
    expect(generateEditProposalMock).toHaveBeenCalledOnce();
  });

  it('stores generated proposals as the overnight manifest execution profile', async () => {
    const generateEditProposalMock = vi.fn(async () => ({
      proposal: {
        summary: 'Generated overnight docs update',
        edits: [
          {
            type: 'replace_text' as const,
            path: 'docs/readme.md',
            find: 'old overnight text',
            replace: 'new overnight text',
            expectedOccurrences: 1,
          },
        ],
        producer: 'mock-producer',
        risks: [],
        verificationNotes: ['Verified by the overnight CLI run.'],
      },
      trace: createProducerTrace(),
    }));
    vi.doMock('../../src/agent/autonomous/edit-proposal-producer.js', () => ({
      generateEditProposalWithTrace: generateEditProposalMock,
    }));

    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      task: 'Generate and apply a controlled overnight docs proposal autonomously.',
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'readme.md'), 'old overnight text\n', 'utf8');
    const proposalFile = path.join(tempRoot, 'loop', 'generated-overnight-proposal.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--generate-edit-proposal-file',
      proposalFile,
      '--apply-edits',
      '--require-fleet-collaboration',
      '--require-preview',
      '--run-verification',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editProposalProducerTracePath: string;
      generatedEditProposalPath: string;
      overnightReadiness: {
        completionProven: boolean;
        configuredForOvernight: boolean;
        fleetCollaborationProven: boolean;
        multiAgentReady: boolean;
        ready: boolean;
      };
      overnightManifestPath: string;
      status: string;
    };
    const manifest = JSON.parse(await fs.readFile(output.overnightManifestPath, 'utf8')) as {
      auditCommand: string[];
      artifacts: Record<string, string>;
      executionProfile: {
        applyEdits: boolean;
        editProposalFile: string;
        requireFleetCollaboration: boolean;
        requirePreview: boolean;
        runVerification: boolean;
      };
      overnightReadiness: {
        completionProven: boolean;
        configuredForOvernight: boolean;
        fleetCollaborationProven: boolean;
        multiAgentReady: boolean;
        ready: boolean;
      };
      resumeCommand: string[];
      superviseCommand: string[];
    };

    expect(output.status).toBe('verified');
    expect(output.generatedEditProposalPath).toBe(proposalFile);
    expect(output.editProposalProducerTracePath).toBe(path.join(path.dirname(proposalFile), 'edit-proposal-producer-trace.json'));
    expect(manifest.artifacts.generatedEditProposalPath).toBe(proposalFile);
    expect(manifest.artifacts.editProposalProducerTracePath).toBe(output.editProposalProducerTracePath);
    expect(manifest.executionProfile).toEqual(expect.objectContaining({
      applyEdits: true,
      editProposalFile: proposalFile,
      requireFleetCollaboration: true,
      requirePreview: true,
      runVerification: true,
    }));
    expect(output.overnightReadiness).toEqual(expect.objectContaining({
      completionProven: false,
      configuredForOvernight: true,
      fleetCollaborationProven: true,
      multiAgentReady: true,
      ready: true,
    }));
    expect(manifest.overnightReadiness).toEqual(expect.objectContaining({
      completionProven: false,
      configuredForOvernight: true,
      fleetCollaborationProven: true,
      multiAgentReady: true,
      ready: true,
    }));
    expect(manifest.resumeCommand).toEqual([
      'buddy',
      'autonomous-code',
      '--resume-from-manifest',
      output.overnightManifestPath,
      '--edit-proposal-file',
      proposalFile,
      '--apply-edits',
      '--require-preview',
      '--require-fleet-collaboration',
      '--run-verification',
      '--json',
    ]);
    expect(manifest.auditCommand).toEqual([
      'buddy',
      'autonomous-code',
      '--audit-overnight-manifest',
      output.overnightManifestPath,
      '--json',
      '--require-overnight-completion',
    ]);
    expect(manifest.superviseCommand).toEqual([
      'buddy',
      'autonomous-code',
      '--supervise-from-manifest',
      output.overnightManifestPath,
      '--supervise-cycles',
      '961',
      '--supervise-sleep-ms',
      '30000',
      '--supervise-max-stalled-cycles',
      '3',
      '--supervise-max-error-cycles',
      '3',
      '--edit-proposal-file',
      proposalFile,
      '--apply-edits',
      '--require-preview',
      '--require-fleet-collaboration',
      '--run-verification',
      '--json',
      '--require-overnight-readiness',
      '--require-overnight-completion',
    ]);
  });

  it('rejects ambiguous generated and pre-existing proposal inputs', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    const proposalFile = path.join(tempRoot, 'proposal.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--edit-proposal-file',
      proposalFile,
      '--generate-edit-proposal-file',
      path.join(tempRoot, 'generated-proposal.json'),
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--generate-edit-proposal-file cannot be combined with --edit-proposal-file');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('writes a standalone proposal loop Cowork import manifest when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const proposalLoopCoworkImportFile = path.join(tempRoot, 'loop-import', 'cowork-import.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--proposal-loop-cowork-import-file',
      proposalLoopCoworkImportFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalLoopCoworkImportPath: string;
      status: string;
    };
    const saved = JSON.parse(await fs.readFile(output.proposalLoopCoworkImportPath, 'utf8')) as {
      defaultPanelId: string;
      panels: Array<{ id: string; view: string }>;
      queueArtifactPath: string;
      suggestedFocusPanelId: string;
    };

    expect(output.status).toBe('previewed');
    expect(output.proposalLoopCoworkImportPath).toBe(proposalLoopCoworkImportFile);
    expect(saved).toEqual(expect.objectContaining({
      defaultPanelId: 'canvas',
      queueArtifactPath: path.join(path.dirname(proposalLoopCoworkImportFile), 'proposal-loop-next-action.json'),
      suggestedFocusPanelId: 'approval',
    }));
    expect(saved.panels.length).toBe(9);
    expect(saved.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'producer-request', view: 'prompt' }),
      expect.objectContaining({ id: 'producer-dispatch', view: 'prompt' }),
      expect.objectContaining({ id: 'approval', view: 'review' }),
    ]));
  });

  it('writes a passive Cowork import artifact check when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const proposalLoopArtifactsDir = path.join(tempRoot, 'loop-bundle');
    const proposalLoopCoworkImportFile = path.join(proposalLoopArtifactsDir, 'cowork-import.json');
    const proposalLoopCoworkImportCheckFile = path.join(proposalLoopArtifactsDir, 'cowork-import-check.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--proposal-loop-artifacts-dir',
      proposalLoopArtifactsDir,
      '--proposal-loop-cowork-import-file',
      proposalLoopCoworkImportFile,
      '--proposal-loop-cowork-import-check-file',
      proposalLoopCoworkImportCheckFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalLoopCoworkImportCheckPath: string;
      proposalLoopCoworkImportPath: string;
      status: string;
    };
    const saved = JSON.parse(await fs.readFile(output.proposalLoopCoworkImportCheckPath, 'utf8')) as {
      missingRequiredArtifactPaths: string[];
      panels: Array<{ exists: boolean; id: string }>;
      queueArtifactExists: boolean;
      status: string;
    };

    expect(output.status).toBe('previewed');
    expect(output.proposalLoopCoworkImportPath).toBe(proposalLoopCoworkImportFile);
    expect(output.proposalLoopCoworkImportCheckPath).toBe(proposalLoopCoworkImportCheckFile);
    expect(saved.status).toBe('ready');
    expect(saved.missingRequiredArtifactPaths).toEqual([]);
    expect(saved.queueArtifactExists).toBe(true);
    expect(saved.panels.length).toBe(9);
    expect(saved.panels.every((panel) => panel.exists)).toBe(true);
    expect(saved.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({ exists: true, id: 'producer-request' }),
      expect.objectContaining({ exists: true, id: 'producer-dispatch' }),
      expect.objectContaining({ exists: true, id: 'approval' }),
    ]));
  });

  it('writes a Cowork workspace summary when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const proposalLoopArtifactsDir = path.join(tempRoot, 'loop-workspace');
    const proposalLoopCoworkImportFile = path.join(proposalLoopArtifactsDir, 'cowork-import.json');
    const proposalLoopCoworkWorkspaceFile = path.join(proposalLoopArtifactsDir, 'cowork-workspace.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--proposal-loop-artifacts-dir',
      proposalLoopArtifactsDir,
      '--proposal-loop-cowork-import-file',
      proposalLoopCoworkImportFile,
      '--proposal-loop-cowork-workspace-file',
      proposalLoopCoworkWorkspaceFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalLoopCoworkWorkspacePath: string;
      status: string;
    };
    const saved = JSON.parse(await fs.readFile(output.proposalLoopCoworkWorkspacePath, 'utf8')) as {
      actionRail: {
        actions: Array<{
          disabledReason?: string;
          enabled: boolean;
          id: string;
          panelId: string;
          type: string;
        }>;
        mode: string;
        primaryActionId: string;
      };
      artifactShelf: {
        availableArtifactCount: number;
        groups: Array<{
          availableArtifactCount: number;
          id: string;
          panelIds: string[];
          primaryPanelId: string;
          requiredArtifactCount: number;
          totalArtifactCount: number;
          unavailableArtifactCount: number;
        }>;
        missingRequiredCount: number;
        mode: string;
        requiredArtifactCount: number;
        totalArtifactCount: number;
      };
      activity: {
        activeEventId: string;
        counts: { total: number; warning: number };
        events: Array<{ active: boolean; id: string }>;
      };
      approval: {
        affectedFiles: string[];
        editSummary: { declared: number; previewed: number };
        gateNodeIds: string[];
        nextAction: { nodeId: string; type: string };
        sourceActiveNodeId: string;
        state: string;
      };
      badges: Array<{ id: string; tone: string; value: string }>;
      commands: {
        commandCount: number;
        commands: Array<{ commandText: string; id: string; status: string }>;
        readyCommandCount: number;
        validationErrors: string[];
      };
      decisionForm: {
        affectedFiles: string[];
        allowedDecisions: string[];
        artifactKind: string;
        defaultDecision: string;
        panelId: string;
        reason: string;
        required: boolean;
        requiredFields: string[];
        safetyNotes: string[];
      };
      evidence: {
        approvalState: string;
        editSummary: { applied: number; blocked: number; declared: number; previewed: number };
        status: string;
        validationErrors: string[];
        verificationSummary: { total: number };
        workflow: { activeNodeId: string };
      };
      graph: {
        activeNodeId: string;
        approvalNodeIds: string[];
        edgeCount: number;
        nodeCount: number;
        nodes: Array<{
          active: boolean;
          canvasType: string;
          iconName: string;
          id: string;
          position: { x: number; y: number };
        }>;
        statusCounts: { completed: number; ready: number; total: number };
        validationErrors: string[];
      };
      graphLegend: {
        activeNodeId: string;
        edgeCount: number;
        mode: string;
        nodeCount: number;
        nodeTypes: Array<{ canvasTypes: string[]; count: number; iconNames: string[]; id: string }>;
        statuses: Array<{ count: number; id: string; tone: string }>;
      };
      graphViewport: {
        activeIndex: number;
        activeNodeId: string;
        activePosition: { x: number; y: number };
        activeTrailEdgeIds: string[];
        activeTrailNodeIds: string[];
        activeTrailBounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
        activeTrailProgress: {
          activeIndex: number;
          activeOrdinal: number;
          ratio: number;
          totalEdgeCount: number;
          totalNodeCount: number;
          trailEdgeCount: number;
          trailNodeCount: number;
        };
        activeTrailSegments: Array<{
          edgeId: string;
          source: string;
          sourcePosition: { x: number; y: number };
          target: string;
          targetPosition: { x: number; y: number };
        }>;
        upcomingTrailEdgeIds: string[];
        upcomingTrailNodeIds: string[];
        upcomingTrailSegments: Array<{
          edgeId: string;
          source: string;
          sourcePosition: { x: number; y: number };
          target: string;
          targetPosition: { x: number; y: number };
        }>;
        upcomingTrailBounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
        upcomingTrailProgress: {
          remainingEdgeCount: number;
          remainingNodeCount: number;
          remainingRatio: number;
          totalEdgeCount: number;
          totalNodeCount: number;
        };
        trailProgressSummary: {
          activeNodeId: string;
          isAtEnd: boolean;
          reachedEdgeCount: number;
          reachedNodeCount: number;
          reachedRatio: number;
          remainingEdgeCount: number;
          remainingNodeCount: number;
          remainingRatio: number;
          totalEdgeCount: number;
          totalNodeCount: number;
        };
        bounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
        center: { x: number; y: number };
        edgeCount: number;
        statusBounds: Array<{
          bounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
          count: number;
          id: string;
          label: string;
          nodeIds: string[];
          tone: string;
        }>;
        statusTransitions: Array<{
          count: number;
          edgeIds: string[];
          from: string;
          fromNodeIds: string[];
          fromTone: string;
          id: string;
          isCrossStatus: boolean;
          label: string;
          to: string;
          toNodeIds: string[];
          toTone: string;
        }>;
        statusTransitionBridges: Array<{
          count: number;
          edgeIds: string[];
          from: string;
          fromBounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
          fromCenter: { x: number; y: number };
          fromTone: string;
          id: string;
          isCrossStatus: true;
          label: string;
          to: string;
          toBounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
          toCenter: { x: number; y: number };
          toTone: string;
        }>;
        statusTransitionBridgeSummary: {
          allBridgesCrossStatus: boolean;
          bridgeCount: number;
          bridgeEdgeCount: number;
          bridgeIds: string[];
          fromStatusIds: string[];
          toStatusIds: string[];
          tonePairs: Array<{
            fromTone: string;
            id: string;
            toTone: string;
          }>;
        };
        statusTransitionBridgeViewport: {
          bounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
          bridgeCount: number;
          bridgeEdgeCount: number;
          bridgeIds: string[];
          center: { x: number; y: number };
          padding: number;
        };
        renderLayers: Array<{
          id: string;
          itemCount: number;
          label: string;
          mode: string;
          order: number;
          safetyNote: string;
          visible: boolean;
        }>;
        renderLayerSummary: {
          layerCount: number;
          layerIds: string[];
          mode: string;
          safetyNote: string;
          totalItemCount: number;
          visibleLayerCount: number;
          visibleLayerIds: string[];
        };
        renderLayerSafety: {
          allLayersPassive: boolean;
          canExecuteAny: false;
          executableLayerCount: number;
          layerCount: number;
          mode: string;
          safetyNote: string;
        };
        renderLayerGroups: Array<{
          id: string;
          label: string;
          layerCount: number;
          layerIds: string[];
          mode: string;
          order: number;
          safetyNote: string;
          totalItemCount: number;
          visibleLayerCount: number;
          visibleLayerIds: string[];
        }>;
        renderLayerGroupSummary: {
          groupCount: number;
          groupIds: string[];
          mode: string;
          safetyNote: string;
          totalItemCount: number;
          visibleGroupCount: number;
          visibleGroupIds: string[];
        };
        renderLayerGroupSafety: {
          allGroupsPassive: boolean;
          canExecuteAny: false;
          executableGroupCount: number;
          groupCount: number;
          mode: string;
          safetyNote: string;
        };
        renderLayerGroupBadges: Array<{
          accessibilityLabel: string;
          countLabel: string;
          groupId: string;
          id: string;
          itemCount: number;
          label: string;
          layerCount: number;
          mode: string;
          safetyNote: string;
          tone: string;
          visible: boolean;
        }>;
        renderLayerGroupBadgeSummary: {
          badgeCount: number;
          badgeIds: string[];
          countLabels: string[];
          mode: string;
          safetyNote: string;
          totalItemCount: number;
          visibleBadgeCount: number;
          visibleBadgeIds: string[];
        };
        renderLayerGroupBadgeAccessibilitySummary: {
          accessibilityLabels: string[];
          badgeCount: number;
          badgeIds: string[];
          labelCount: number;
          mode: string;
          safetyNote: string;
        };
        renderLayerGroupBadgeAccessibilityAudit: {
          allLabelsPresent: boolean;
          badgeCount: number;
          duplicateLabelCount: number;
          duplicateLabels: string[];
          labelCount: number;
          missingLabelCount: number;
          mode: string;
          safetyNote: string;
        };
        renderLayerGroupBadgeAccessibilityHealth: {
          badgeCount: number;
          duplicateLabelCount: number;
          labelCount: number;
          missingLabelCount: number;
          mode: string;
          safetyNote: string;
          status: string;
          summary: string;
          tone: string;
        };
        renderLayerGroupBadgeAccessibilityChecklist: Array<{
          badgeCount: number;
          id: string;
          issueCount: number;
          label: string;
          mode: string;
          safetyNote: string;
          status: string;
          summary: string;
          tone: string;
        }>;
        renderLayerGroupBadgeAccessibilityChecklistSummary: {
          badgeCount: number;
          checkCount: number;
          checkIds: string[];
          issueCount: number;
          mode: string;
          needsAttentionCheckCount: number;
          readyCheckCount: number;
          safetyNote: string;
          status: string;
          tone: string;
        };
        renderLayerGroupBadgeSafety: {
          allBadgesPassive: boolean;
          badgeCount: number;
          canExecuteAny: false;
          executableBadgeCount: number;
          mode: string;
          safetyNote: string;
        };
        renderLayerGroupBadgeToneSummary: {
          badgeCount: number;
          mode: string;
          safetyNote: string;
          toneIds: string[];
          tonePairs: Array<{
            badgeId: string;
            tone: string;
          }>;
          uniqueToneCount: number;
          uniqueToneIds: string[];
        };
        renderLayerGroupBadgeToneLegend: Array<{
          badgeCount: number;
          badgeIds: string[];
          id: string;
          label: string;
          mode: string;
          safetyNote: string;
          tone: string;
        }>;
        renderLayerGroupBadgeToneLegendSummary: {
          badgeCount: number;
          labelIds: string[];
          labels: string[];
          legendCount: number;
          mode: string;
          safetyNote: string;
          toneIds: string[];
        };
        statusTransitionSummary: {
          crossStatusEdgeCount: number;
          crossStatusTransitionCount: number;
          crossStatusTransitionIds: string[];
          sameStatusEdgeCount: number;
          sameStatusTransitionCount: number;
          sameStatusTransitionIds: string[];
          totalEdgeCount: number;
          trackedEdgeCount: number;
          transitionCount: number;
          untrackedEdgeCount: number;
        };
        focusWindowBounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
        focusWindowRange: {
          containsEnd: boolean;
          containsStart: boolean;
          endIndex: number;
          nodeIds: string[];
          size: number;
          startIndex: number;
          totalNodeCount: number;
        };
        focusWindowSegments: Array<{
          edgeId: string;
          source: string;
          sourcePosition: { x: number; y: number };
          target: string;
          targetPosition: { x: number; y: number };
        }>;
        focusWindowStatuses: Array<{
          count: number;
          id: string;
          label: string;
          tone: string;
        }>;
        focusWindowSummary: {
          currentIndex: number;
          currentNodeId: string;
          currentStatus: string;
          currentTone: string;
          endIndex: number;
          hasNext: boolean;
          hasPrevious: boolean;
          nodeIds: string[];
          segmentCount: number;
          startIndex: number;
          statusIds: string[];
          totalNodeCount: number;
          windowNodeCount: number;
        };
        focusWindowControls: Array<{
          actionType: string;
          canExecute: boolean;
          disabledReason?: string;
          enabled: boolean;
          executionMode: string;
          id: string;
          isActive: boolean;
          keyHint: string;
          label: string;
          safetyNote: string;
          targetIndex?: number;
          targetNodeId?: string;
          targetPosition?: { x: number; y: number };
          targetStatus?: string;
          tone: string;
        }>;
        focusWindowControlSummary: {
          activeControlId?: string;
          controlCount: number;
          disabledControlIds: string[];
          enabledControlIds: string[];
          keyHints: Array<{
            actionType: string;
            id: string;
            keyHint: string;
          }>;
        };
        focusWindowControlSafety: {
          allControlsDisplayOnly: boolean;
          canExecuteAny: boolean;
          controlCount: number;
          displayOnlyControlCount: number;
          executableControlCount: number;
          executionMode: string;
          safetyNote: string;
        };
        focusWindow: {
          current: {
            id: string;
            index: number;
            position: { x: number; y: number };
          };
          hasNext: boolean;
          hasPrevious: boolean;
          next?: {
            id: string;
            index: number;
            position: { x: number; y: number };
          };
          previous?: {
            id: string;
            index: number;
            position: { x: number; y: number };
          };
        };
        focusNodeIds: string[];
        mode: string;
        nodeCount: number;
        padding: number;
      };
      focus: {
        activeBadgeIds: string[];
        activePanelId: string;
        activeRegionId: string;
        reason: string;
        recommendedPanelId: string;
        supervisionState: string;
      };
      guardrails: {
        approvalState: string;
        canRunCommand: boolean;
        commandCount: number;
        disallowedActions: string[];
        missingRequiredCount: number;
        needsApprovalDecision: boolean;
        needsHumanReview: boolean;
        producerMode: string;
        readOnlyTools: string[];
        readyCommandCount: number;
        requiredBeforeApply: boolean;
        safetyNotes: string[];
        validationErrors: string[];
      };
      layout: {
        badgeStrip: { badgeIds: string[]; placement: string };
        density: string;
        regions: Array<{
          active: boolean;
          availablePanelIds: string[];
          id: string;
          panelIds: string[];
          primaryPanelId: string;
          required: boolean;
          unavailablePanelIds: string[];
        }>;
      };
      manifest: {
        coworkImport: { panelCount: number; requiredArtifactCount: number };
        materializedCount: number;
        roles: string[];
        source: { activeStepId: string; status: string };
        validationErrors: string[];
      };
      navigation: {
        activePanelId: string;
        availableCount: number;
        groups: Array<{ availablePanelIds: string[]; id: string; panelIds: string[] }>;
        missingRequiredCount: number;
        panelCount: number;
        recommendedPanelId: string;
        requiredCount: number;
        tabs: Array<{ active: boolean; available: boolean; id: string; recommended: boolean; required: boolean }>;
      };
      openPanelId: string;
      operatorBrief: {
        body: string;
        evidence: string[];
        headline: string;
        nextActionId: string;
        panelId: string;
        severity: string;
        state: string;
      };
      operatorHandoff: {
        actionId: string;
        artifactPath: string;
        evidence: string[];
        mode: string;
        panelId: string;
        regionId: string;
        required: boolean;
        safetyNotes: string[];
        state: string;
        summary: string;
        title: string;
      };
      panelStates: Array<{
        active: boolean;
        attentionBadgeIds: string[];
        attentionTone: string;
        available: boolean;
        id: string;
        recommended: boolean;
        regionId: string;
        required: boolean;
        view: string;
      }>;
      producer: {
        request: {
          editProposalFile: string;
          instructionCount: number;
          proposalPromptFile: string;
          safetyCount: number;
          schemaKeys: string[];
          status: string;
          validationErrors: string[];
        };
        dispatch: {
          allowedTools: string[];
          mode: string;
          reviewCommand: { args: string[]; executable: string };
          validationErrors: string[];
        };
        review: {
          nextAction: { stepId: string; type: string };
          state: string;
          validationErrors: string[];
        };
        validationErrors: string[];
      };
      queue: {
        nextActionType: string;
        runState: string;
        uiPrimaryAction: { enabled: boolean; type: string };
      };
      reviewChecklist: {
        affectedFiles: string[];
        items: Array<{ id: string; panelId: string; status: string }>;
        nextItemId: string;
        required: boolean;
        status: string;
      };
      reviewRoute: {
        mode: string;
        nextStepId: string;
        required: boolean;
        steps: Array<{
          actionId?: string;
          active: boolean;
          artifactPath?: string;
          id: string;
          panelId?: string;
          regionId?: string;
          status: string;
        }>;
      };
      status: string;
      stepper: {
        activeStepId: string;
        counts: { completed: number; ready: number; total: number };
        steps: Array<{ active: boolean; id: string; status: string }>;
      };
      supervision: {
        actionType: string;
        approvalState: string;
        panelId: string;
        reason: string;
        required: boolean;
        state: string;
      };
      ui: { primaryAction: { enabled: boolean; panelId: string; type: string }; statusText: string };
      unavailablePanelIds: string[];
    };

    expect(output.status).toBe('previewed');
    expect(output.proposalLoopCoworkWorkspacePath).toBe(proposalLoopCoworkWorkspaceFile);
    expect(saved.status).toBe('ready');
    expect(saved.openPanelId).toBe('approval');
    expect(saved.unavailablePanelIds).toEqual([]);
    expect(saved.ui.primaryAction).toEqual(expect.objectContaining({
      enabled: true,
      panelId: 'approval',
      type: 'open_panel',
    }));
    expect(saved.ui.statusText).toBe('Workspace ready: 9/9 panels available.');
    expect(saved.badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'workspace-status',
        tone: 'success',
        value: 'ready',
      }),
      expect.objectContaining({
        id: 'approval-state',
        tone: 'warning',
        value: 'needs_approval',
      }),
      expect.objectContaining({
        id: 'supervision-state',
        tone: 'warning',
        value: 'human_review_required',
      }),
      expect.objectContaining({
        id: 'review-checklist',
        tone: 'warning',
        value: 'pending',
      }),
    ]));
    expect(saved.layout).toEqual(expect.objectContaining({
      density: 'compact',
    }));
    expect(saved.layout.badgeStrip).toEqual(expect.objectContaining({
      badgeIds: [
        'workspace-status',
        'approval-state',
        'supervision-state',
        'artifact-availability',
        'command-readiness',
        'review-checklist',
      ],
      placement: 'top',
    }));
    expect(saved.layout.regions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        availablePanelIds: ['approval', 'producer-review'],
        id: 'operator-review',
        panelIds: ['approval', 'producer-review'],
        primaryPanelId: 'approval',
        required: true,
        unavailablePanelIds: [],
      }),
      expect.objectContaining({
        active: false,
        availablePanelIds: ['producer-request', 'producer-dispatch'],
        id: 'producer-handoff',
        panelIds: ['producer-request', 'producer-dispatch'],
        primaryPanelId: 'producer-request',
      }),
    ]));
    expect(saved.artifactShelf).toEqual(expect.objectContaining({
      availableArtifactCount: 9,
      missingRequiredCount: 0,
      mode: 'passive',
      requiredArtifactCount: 4,
      totalArtifactCount: 9,
    }));
    expect(saved.artifactShelf.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        availableArtifactCount: 2,
        id: 'operator-review',
        panelIds: ['approval', 'producer-review'],
        primaryPanelId: 'approval',
        requiredArtifactCount: 1,
        totalArtifactCount: 2,
        unavailableArtifactCount: 0,
      }),
      expect.objectContaining({
        availableArtifactCount: 2,
        id: 'producer-handoff',
        panelIds: ['producer-request', 'producer-dispatch'],
        primaryPanelId: 'producer-request',
        requiredArtifactCount: 0,
        totalArtifactCount: 2,
        unavailableArtifactCount: 0,
      }),
    ]));
    expect(saved.focus).toEqual(expect.objectContaining({
      activeBadgeIds: ['approval-state', 'supervision-state', 'review-checklist'],
      activePanelId: 'approval',
      activeRegionId: 'operator-review',
      recommendedPanelId: 'approval',
      supervisionState: 'human_review_required',
    }));
    expect(saved.focus.reason).toBe('Scoped edit preview is ready for human or Cowork approval before applying.');
    expect(saved.decisionForm).toEqual(expect.objectContaining({
      affectedFiles: ['docs/note.md'],
      allowedDecisions: ['approved', 'rejected'],
      artifactKind: 'agentic-coding-approval-decision',
      defaultDecision: 'rejected',
      panelId: 'approval',
      required: true,
      requiredFields: ['kind', 'reviewer', 'decision', 'reason'],
    }));
    expect(saved.decisionForm.safetyNotes).toEqual(expect.arrayContaining([
      'Decision form is a passive UI descriptor.',
      'The runner validates the approval-decision JSON before applying edits.',
    ]));
    expect(saved.actionRail).toEqual(expect.objectContaining({
      mode: 'passive',
      primaryActionId: 'open-active-panel',
    }));
    expect(saved.actionRail.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        enabled: true,
        id: 'open-active-panel',
        panelId: 'approval',
        type: 'open_panel',
      }),
      expect.objectContaining({
        enabled: true,
        id: 'fill-approval-decision',
        panelId: 'approval',
        type: 'fill_form',
      }),
      expect.objectContaining({
        enabled: false,
        id: 'copy-next-command',
        panelId: 'next-action',
        type: 'copy_command',
      }),
    ]));
    expect(saved.operatorBrief).toEqual(expect.objectContaining({
      body: 'Scoped edit preview is ready for human or Cowork approval before applying.',
      evidence: ['9/9 panels available', '0/5 commands ready', 'checklist pending'],
      headline: 'Review needed: approval',
      nextActionId: 'open-active-panel',
      panelId: 'approval',
      severity: 'warning',
      state: 'human_review_required',
    }));
    expect(saved.operatorHandoff).toEqual(expect.objectContaining({
      actionId: 'open-active-panel',
      artifactPath: path.join(proposalLoopArtifactsDir, 'approval-state.json'),
      evidence: ['9/9 panels available', '0/5 commands ready', 'checklist pending'],
      mode: 'passive',
      panelId: 'approval',
      regionId: 'operator-review',
      required: true,
      state: 'human_review_required',
      summary: 'Scoped edit preview is ready for human or Cowork approval before applying.',
      title: 'Review needed: approval',
    }));
    expect(saved.operatorHandoff.safetyNotes).toEqual(expect.arrayContaining([
      'Operator handoff is display metadata only.',
      'The runner still validates approval and preview artifacts before any write.',
    ]));
    expect(saved.panelStates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        attentionBadgeIds: ['approval-state', 'supervision-state', 'review-checklist'],
        attentionTone: 'warning',
        available: true,
        id: 'approval',
        recommended: true,
        regionId: 'operator-review',
        required: true,
        view: 'review',
      }),
      expect.objectContaining({
        active: false,
        attentionBadgeIds: [],
        attentionTone: 'neutral',
        available: true,
        id: 'producer-request',
        recommended: false,
        regionId: 'producer-handoff',
        required: false,
        view: 'prompt',
      }),
    ]));
    expect(saved.navigation).toEqual(expect.objectContaining({
      activePanelId: 'approval',
      availableCount: 9,
      missingRequiredCount: 0,
      panelCount: 9,
      recommendedPanelId: 'approval',
      requiredCount: 4,
    }));
    expect(saved.navigation.tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        available: true,
        id: 'approval',
        recommended: true,
        required: true,
      }),
    ]));
    expect(saved.navigation.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        availablePanelIds: ['canvas', 'next-action', 'events'],
        id: 'workflow',
        panelIds: ['canvas', 'next-action', 'events'],
      }),
    ]));
    expect(saved.queue).toEqual(expect.objectContaining({
      nextActionType: 'review_preview',
      runState: 'human_input_required',
      uiPrimaryAction: expect.objectContaining({
        enabled: false,
        type: 'human_review',
      }),
    }));
    expect(saved.stepper).toEqual(expect.objectContaining({
      activeStepId: 'review-preview',
      counts: expect.objectContaining({
        completed: 4,
        ready: 1,
        total: 8,
      }),
    }));
    expect(saved.stepper.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        id: 'review-preview',
        status: 'ready',
      }),
    ]));
    expect(saved.activity).toEqual(expect.objectContaining({
      counts: expect.objectContaining({
        total: 12,
        warning: 1,
      }),
    }));
    expect(saved.activity.activeEventId).toBeTruthy();
    expect(saved.activity.events.some((event) => event.active && event.id === saved.activity.activeEventId)).toBe(true);
    expect(saved.approval).toEqual(expect.objectContaining({
      affectedFiles: ['docs/note.md'],
      gateNodeIds: expect.arrayContaining(['edit-preview']),
      sourceActiveNodeId: 'approval-decision',
      state: 'needs_approval',
    }));
    expect(saved.approval.editSummary).toEqual(expect.objectContaining({
      declared: 1,
      previewed: 1,
    }));
    expect(saved.approval.nextAction).toEqual(expect.objectContaining({
      nodeId: 'edit-preview',
      type: 'review_preview',
    }));
    expect(saved.commands).toEqual(expect.objectContaining({
      commandCount: 5,
      readyCommandCount: 0,
      validationErrors: [],
    }));
    expect(saved.commands.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commandText: expect.stringContaining('--preview-edits'),
        id: 'preview-scoped-edits',
        status: 'completed',
      }),
      expect.objectContaining({
        commandText: expect.stringContaining('--apply-edits'),
        id: 'apply-approved-edits',
        status: 'pending',
      }),
    ]));
    expect(saved.graph).toEqual(expect.objectContaining({
      activeNodeId: 'review-preview',
      approvalNodeIds: ['review-preview'],
      edgeCount: 7,
      nodeCount: 8,
      validationErrors: [],
    }));
    expect(saved.graph.statusCounts).toEqual(expect.objectContaining({
      completed: 4,
      ready: 1,
      total: 8,
    }));
    expect(saved.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        canvasType: 'logic',
        iconName: 'ClipboardCheck',
        id: 'review-preview',
        position: { x: 250, y: 650 },
      }),
    ]));
    expect(saved.graphLegend).toEqual(expect.objectContaining({
      activeNodeId: 'review-preview',
      edgeCount: 7,
      mode: 'passive',
      nodeCount: 8,
    }));
    expect(saved.graphLegend.statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        count: 4,
        id: 'completed',
        tone: 'success',
      }),
      expect.objectContaining({
        count: 1,
        id: 'ready',
        tone: 'warning',
      }),
    ]));
    expect(saved.graphLegend.nodeTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        canvasTypes: ['logic'],
        iconNames: ['ClipboardCheck'],
        id: 'approval',
      }),
    ]));
    expect(saved.graphViewport).toEqual(expect.objectContaining({
      activeIndex: 4,
      activeNodeId: 'review-preview',
      activePosition: { x: 250, y: 650 },
      activeTrailEdgeIds: [
        'proposal-loop-edge-prepare-edit-proposal-prompt-produce-edit-proposal',
        'proposal-loop-edge-produce-edit-proposal-review-edit-proposal',
        'proposal-loop-edge-review-edit-proposal-preview-scoped-edits',
        'proposal-loop-edge-preview-scoped-edits-review-preview',
      ],
      activeTrailNodeIds: [
        'prepare-edit-proposal-prompt',
        'produce-edit-proposal',
        'review-edit-proposal',
        'preview-scoped-edits',
        'review-preview',
      ],
      activeTrailBounds: {
        height: 760,
        maxX: 330,
        maxY: 730,
        minX: 170,
        minY: -30,
        width: 160,
      },
      activeTrailProgress: {
        activeIndex: 4,
        activeOrdinal: 5,
        ratio: 0.625,
        totalEdgeCount: 7,
        totalNodeCount: 8,
        trailEdgeCount: 4,
        trailNodeCount: 5,
      },
      activeTrailSegments: [
        {
          edgeId: 'proposal-loop-edge-prepare-edit-proposal-prompt-produce-edit-proposal',
          source: 'prepare-edit-proposal-prompt',
          sourcePosition: { x: 250, y: 50 },
          target: 'produce-edit-proposal',
          targetPosition: { x: 250, y: 200 },
        },
        {
          edgeId: 'proposal-loop-edge-produce-edit-proposal-review-edit-proposal',
          source: 'produce-edit-proposal',
          sourcePosition: { x: 250, y: 200 },
          target: 'review-edit-proposal',
          targetPosition: { x: 250, y: 350 },
        },
        {
          edgeId: 'proposal-loop-edge-review-edit-proposal-preview-scoped-edits',
          source: 'review-edit-proposal',
          sourcePosition: { x: 250, y: 350 },
          target: 'preview-scoped-edits',
          targetPosition: { x: 250, y: 500 },
        },
        {
          edgeId: 'proposal-loop-edge-preview-scoped-edits-review-preview',
          source: 'preview-scoped-edits',
          sourcePosition: { x: 250, y: 500 },
          target: 'review-preview',
          targetPosition: { x: 250, y: 650 },
        },
      ],
      trailProgressSummary: {
        activeNodeId: 'review-preview',
        isAtEnd: false,
        reachedEdgeCount: 4,
        reachedNodeCount: 5,
        reachedRatio: 0.625,
        remainingEdgeCount: 3,
        remainingNodeCount: 3,
        remainingRatio: 0.375,
        totalEdgeCount: 7,
        totalNodeCount: 8,
      },
      upcomingTrailEdgeIds: [
        'proposal-loop-edge-review-preview-apply-approved-edits',
        'proposal-loop-edge-apply-approved-edits-run-verification',
        'proposal-loop-edge-run-verification-handoff',
      ],
      upcomingTrailNodeIds: [
        'apply-approved-edits',
        'run-verification',
        'handoff',
      ],
      upcomingTrailBounds: {
        height: 610,
        maxX: 330,
        maxY: 1180,
        minX: 170,
        minY: 570,
        width: 160,
      },
      upcomingTrailProgress: {
        remainingEdgeCount: 3,
        remainingNodeCount: 3,
        remainingRatio: 0.375,
        totalEdgeCount: 7,
        totalNodeCount: 8,
      },
      upcomingTrailSegments: [
        {
          edgeId: 'proposal-loop-edge-review-preview-apply-approved-edits',
          source: 'review-preview',
          sourcePosition: { x: 250, y: 650 },
          target: 'apply-approved-edits',
          targetPosition: { x: 250, y: 800 },
        },
        {
          edgeId: 'proposal-loop-edge-apply-approved-edits-run-verification',
          source: 'apply-approved-edits',
          sourcePosition: { x: 250, y: 800 },
          target: 'run-verification',
          targetPosition: { x: 250, y: 950 },
        },
        {
          edgeId: 'proposal-loop-edge-run-verification-handoff',
          source: 'run-verification',
          sourcePosition: { x: 250, y: 950 },
          target: 'handoff',
          targetPosition: { x: 250, y: 1100 },
        },
      ],
      bounds: {
        height: 1210,
        maxX: 330,
        maxY: 1180,
        minX: 170,
        minY: -30,
        width: 160,
      },
      center: { x: 250, y: 575 },
      edgeCount: 7,
      statusBounds: [
        {
          bounds: {
            height: 610,
            maxX: 330,
            maxY: 580,
            minX: 170,
            minY: -30,
            width: 160,
          },
          count: 4,
          id: 'completed',
          label: 'completed',
          nodeIds: [
            'prepare-edit-proposal-prompt',
            'produce-edit-proposal',
            'review-edit-proposal',
            'preview-scoped-edits',
          ],
          tone: 'success',
        },
        {
          bounds: {
            height: 160,
            maxX: 330,
            maxY: 730,
            minX: 170,
            minY: 570,
            width: 160,
          },
          count: 1,
          id: 'ready',
          label: 'ready',
          nodeIds: ['review-preview'],
          tone: 'warning',
        },
        {
          bounds: {
            height: 460,
            maxX: 330,
            maxY: 1180,
            minX: 170,
            minY: 720,
            width: 160,
          },
          count: 3,
          id: 'pending',
          label: 'pending',
          nodeIds: [
            'apply-approved-edits',
            'run-verification',
            'handoff',
          ],
          tone: 'neutral',
        },
      ],
      statusTransitions: [
        {
          count: 3,
          edgeIds: [
            'proposal-loop-edge-prepare-edit-proposal-prompt-produce-edit-proposal',
            'proposal-loop-edge-produce-edit-proposal-review-edit-proposal',
            'proposal-loop-edge-review-edit-proposal-preview-scoped-edits',
          ],
          from: 'completed',
          fromNodeIds: [
            'prepare-edit-proposal-prompt',
            'produce-edit-proposal',
            'review-edit-proposal',
          ],
          fromTone: 'success',
          id: 'completed->completed',
          isCrossStatus: false,
          label: 'completed to completed',
          to: 'completed',
          toNodeIds: [
            'produce-edit-proposal',
            'review-edit-proposal',
            'preview-scoped-edits',
          ],
          toTone: 'success',
        },
        {
          count: 1,
          edgeIds: ['proposal-loop-edge-preview-scoped-edits-review-preview'],
          from: 'completed',
          fromNodeIds: ['preview-scoped-edits'],
          fromTone: 'success',
          id: 'completed->ready',
          isCrossStatus: true,
          label: 'completed to ready',
          to: 'ready',
          toNodeIds: ['review-preview'],
          toTone: 'warning',
        },
        {
          count: 1,
          edgeIds: ['proposal-loop-edge-review-preview-apply-approved-edits'],
          from: 'ready',
          fromNodeIds: ['review-preview'],
          fromTone: 'warning',
          id: 'ready->pending',
          isCrossStatus: true,
          label: 'ready to pending',
          to: 'pending',
          toNodeIds: ['apply-approved-edits'],
          toTone: 'neutral',
        },
        {
          count: 2,
          edgeIds: [
            'proposal-loop-edge-apply-approved-edits-run-verification',
            'proposal-loop-edge-run-verification-handoff',
          ],
          from: 'pending',
          fromNodeIds: [
            'apply-approved-edits',
            'run-verification',
          ],
          fromTone: 'neutral',
          id: 'pending->pending',
          isCrossStatus: false,
          label: 'pending to pending',
          to: 'pending',
          toNodeIds: [
            'run-verification',
            'handoff',
          ],
          toTone: 'neutral',
        },
      ],
      statusTransitionBridges: [
        {
          count: 1,
          edgeIds: ['proposal-loop-edge-preview-scoped-edits-review-preview'],
          from: 'completed',
          fromBounds: {
            height: 610,
            maxX: 330,
            maxY: 580,
            minX: 170,
            minY: -30,
            width: 160,
          },
          fromCenter: { x: 250, y: 275 },
          fromTone: 'success',
          id: 'completed->ready',
          isCrossStatus: true,
          label: 'completed to ready',
          to: 'ready',
          toBounds: {
            height: 160,
            maxX: 330,
            maxY: 730,
            minX: 170,
            minY: 570,
            width: 160,
          },
          toCenter: { x: 250, y: 650 },
          toTone: 'warning',
        },
        {
          count: 1,
          edgeIds: ['proposal-loop-edge-review-preview-apply-approved-edits'],
          from: 'ready',
          fromBounds: {
            height: 160,
            maxX: 330,
            maxY: 730,
            minX: 170,
            minY: 570,
            width: 160,
          },
          fromCenter: { x: 250, y: 650 },
          fromTone: 'warning',
          id: 'ready->pending',
          isCrossStatus: true,
          label: 'ready to pending',
          to: 'pending',
          toBounds: {
            height: 460,
            maxX: 330,
            maxY: 1180,
            minX: 170,
            minY: 720,
            width: 160,
          },
          toCenter: { x: 250, y: 950 },
          toTone: 'neutral',
        },
      ],
      statusTransitionBridgeSummary: {
        allBridgesCrossStatus: true,
        bridgeCount: 2,
        bridgeEdgeCount: 2,
        bridgeIds: [
          'completed->ready',
          'ready->pending',
        ],
        fromStatusIds: [
          'completed',
          'ready',
        ],
        toStatusIds: [
          'ready',
          'pending',
        ],
        tonePairs: [
          {
            fromTone: 'success',
            id: 'completed->ready',
            toTone: 'warning',
          },
          {
            fromTone: 'warning',
            id: 'ready->pending',
            toTone: 'neutral',
          },
        ],
      },
      statusTransitionBridgeViewport: {
        bounds: {
          height: 835,
          maxX: 330,
          maxY: 1030,
          minX: 170,
          minY: 195,
          width: 160,
        },
        bridgeCount: 2,
        bridgeEdgeCount: 2,
        bridgeIds: [
          'completed->ready',
          'ready->pending',
        ],
        center: { x: 250, y: 613 },
        padding: 80,
      },
      statusTransitionSummary: {
        crossStatusEdgeCount: 2,
        crossStatusTransitionCount: 2,
        crossStatusTransitionIds: [
          'completed->ready',
          'ready->pending',
        ],
        sameStatusEdgeCount: 5,
        sameStatusTransitionCount: 2,
        sameStatusTransitionIds: [
          'completed->completed',
          'pending->pending',
        ],
        totalEdgeCount: 7,
        trackedEdgeCount: 7,
        transitionCount: 4,
        untrackedEdgeCount: 0,
      },
      renderLayers: [
        {
          id: 'status-regions',
          itemCount: 3,
          label: 'Status regions',
          mode: 'passive',
          order: 10,
          safetyNote: 'Render layer is display metadata only.',
          visible: true,
        },
        {
          id: 'status-bridges',
          itemCount: 2,
          label: 'Status bridges',
          mode: 'passive',
          order: 20,
          safetyNote: 'Render layer is display metadata only.',
          visible: true,
        },
        {
          id: 'active-trail',
          itemCount: 4,
          label: 'Active trail',
          mode: 'passive',
          order: 30,
          safetyNote: 'Render layer is display metadata only.',
          visible: true,
        },
        {
          id: 'upcoming-trail',
          itemCount: 3,
          label: 'Upcoming trail',
          mode: 'passive',
          order: 40,
          safetyNote: 'Render layer is display metadata only.',
          visible: true,
        },
        {
          id: 'focus-window',
          itemCount: 2,
          label: 'Focus window',
          mode: 'passive',
          order: 50,
          safetyNote: 'Render layer is display metadata only.',
          visible: true,
        },
        {
          id: 'focus-controls',
          itemCount: 3,
          label: 'Focus controls',
          mode: 'passive',
          order: 60,
          safetyNote: 'Render layer is display metadata only.',
          visible: true,
        },
      ],
      renderLayerSummary: {
        layerCount: 6,
        layerIds: [
          'status-regions',
          'status-bridges',
          'active-trail',
          'upcoming-trail',
          'focus-window',
          'focus-controls',
        ],
        mode: 'passive',
        safetyNote: 'Render layers are display metadata only.',
        totalItemCount: 17,
        visibleLayerCount: 6,
        visibleLayerIds: [
          'status-regions',
          'status-bridges',
          'active-trail',
          'upcoming-trail',
          'focus-window',
          'focus-controls',
        ],
      },
      renderLayerSafety: {
        allLayersPassive: true,
        canExecuteAny: false,
        executableLayerCount: 0,
        layerCount: 6,
        mode: 'passive',
        safetyNote: 'Render layers are display metadata only.',
      },
      renderLayerGroups: [
        {
          id: 'regions',
          label: 'Regions',
          layerCount: 2,
          layerIds: [
            'status-regions',
            'status-bridges',
          ],
          mode: 'passive',
          order: 10,
          safetyNote: 'Render layer group is display metadata only.',
          totalItemCount: 5,
          visibleLayerCount: 2,
          visibleLayerIds: [
            'status-regions',
            'status-bridges',
          ],
        },
        {
          id: 'paths',
          label: 'Paths',
          layerCount: 2,
          layerIds: [
            'active-trail',
            'upcoming-trail',
          ],
          mode: 'passive',
          order: 20,
          safetyNote: 'Render layer group is display metadata only.',
          totalItemCount: 7,
          visibleLayerCount: 2,
          visibleLayerIds: [
            'active-trail',
            'upcoming-trail',
          ],
        },
        {
          id: 'focus',
          label: 'Focus',
          layerCount: 2,
          layerIds: [
            'focus-window',
            'focus-controls',
          ],
          mode: 'passive',
          order: 30,
          safetyNote: 'Render layer group is display metadata only.',
          totalItemCount: 5,
          visibleLayerCount: 2,
          visibleLayerIds: [
            'focus-window',
            'focus-controls',
          ],
        },
      ],
      renderLayerGroupSummary: {
        groupCount: 3,
        groupIds: [
          'regions',
          'paths',
          'focus',
        ],
        mode: 'passive',
        safetyNote: 'Render layer groups are display metadata only.',
        totalItemCount: 17,
        visibleGroupCount: 3,
        visibleGroupIds: [
          'regions',
          'paths',
          'focus',
        ],
      },
      renderLayerGroupSafety: {
        allGroupsPassive: true,
        canExecuteAny: false,
        executableGroupCount: 0,
        groupCount: 3,
        mode: 'passive',
        safetyNote: 'Render layer groups are display metadata only.',
      },
      renderLayerGroupBadges: [
        {
          accessibilityLabel: 'Regions badge: 5 items, success tone.',
          countLabel: '5 items',
          groupId: 'regions',
          id: 'regions-badge',
          itemCount: 5,
          label: 'Regions',
          layerCount: 2,
          mode: 'passive',
          safetyNote: 'Render layer group badge is display metadata only.',
          tone: 'success',
          visible: true,
        },
        {
          accessibilityLabel: 'Paths badge: 7 items, warning tone.',
          countLabel: '7 items',
          groupId: 'paths',
          id: 'paths-badge',
          itemCount: 7,
          label: 'Paths',
          layerCount: 2,
          mode: 'passive',
          safetyNote: 'Render layer group badge is display metadata only.',
          tone: 'warning',
          visible: true,
        },
        {
          accessibilityLabel: 'Focus badge: 5 items, neutral tone.',
          countLabel: '5 items',
          groupId: 'focus',
          id: 'focus-badge',
          itemCount: 5,
          label: 'Focus',
          layerCount: 2,
          mode: 'passive',
          safetyNote: 'Render layer group badge is display metadata only.',
          tone: 'neutral',
          visible: true,
        },
      ],
      renderLayerGroupBadgeSummary: {
        badgeCount: 3,
        badgeIds: [
          'regions-badge',
          'paths-badge',
          'focus-badge',
        ],
        countLabels: [
          '5 items',
          '7 items',
          '5 items',
        ],
        mode: 'passive',
        safetyNote: 'Render layer group badges are display metadata only.',
        totalItemCount: 17,
        visibleBadgeCount: 3,
        visibleBadgeIds: [
          'regions-badge',
          'paths-badge',
          'focus-badge',
        ],
      },
      renderLayerGroupBadgeAccessibilitySummary: {
        accessibilityLabels: [
          'Regions badge: 5 items, success tone.',
          'Paths badge: 7 items, warning tone.',
          'Focus badge: 5 items, neutral tone.',
        ],
        badgeCount: 3,
        badgeIds: [
          'regions-badge',
          'paths-badge',
          'focus-badge',
        ],
        labelCount: 3,
        mode: 'passive',
        safetyNote: 'Render layer group badge accessibility labels are display metadata only.',
      },
      renderLayerGroupBadgeAccessibilityAudit: {
        allLabelsPresent: true,
        badgeCount: 3,
        duplicateLabelCount: 0,
        duplicateLabels: [],
        labelCount: 3,
        missingLabelCount: 0,
        mode: 'passive',
        safetyNote: 'Render layer group badge accessibility audit is display metadata only.',
      },
      renderLayerGroupBadgeAccessibilityHealth: {
        badgeCount: 3,
        duplicateLabelCount: 0,
        labelCount: 3,
        missingLabelCount: 0,
        mode: 'passive',
        safetyNote: 'Render layer group badge accessibility health is display metadata only.',
        status: 'ready',
        summary: 'All render layer group badge accessibility labels are present and unique.',
        tone: 'success',
      },
      renderLayerGroupBadgeAccessibilityChecklist: [
        {
          badgeCount: 3,
          id: 'labels-present',
          issueCount: 0,
          label: 'Labels present',
          mode: 'passive',
          safetyNote: 'Render layer group badge accessibility checklist is display metadata only.',
          status: 'ready',
          summary: 'All render layer group badge accessibility labels are present.',
          tone: 'success',
        },
        {
          badgeCount: 3,
          id: 'labels-unique',
          issueCount: 0,
          label: 'Labels unique',
          mode: 'passive',
          safetyNote: 'Render layer group badge accessibility checklist is display metadata only.',
          status: 'ready',
          summary: 'All render layer group badge accessibility labels are unique.',
          tone: 'success',
        },
      ],
      renderLayerGroupBadgeAccessibilityChecklistSummary: {
        badgeCount: 3,
        checkCount: 2,
        checkIds: [
          'labels-present',
          'labels-unique',
        ],
        issueCount: 0,
        mode: 'passive',
        needsAttentionCheckCount: 0,
        readyCheckCount: 2,
        safetyNote: 'Render layer group badge accessibility checklist summary is display metadata only.',
        status: 'ready',
        tone: 'success',
      },
      renderLayerGroupBadgeSafety: {
        allBadgesPassive: true,
        badgeCount: 3,
        canExecuteAny: false,
        executableBadgeCount: 0,
        mode: 'passive',
        safetyNote: 'Render layer group badges are display metadata only.',
      },
      renderLayerGroupBadgeToneSummary: {
        badgeCount: 3,
        mode: 'passive',
        safetyNote: 'Render layer group badge tones are display metadata only.',
        toneIds: [
          'success',
          'warning',
          'neutral',
        ],
        tonePairs: [
          {
            badgeId: 'regions-badge',
            tone: 'success',
          },
          {
            badgeId: 'paths-badge',
            tone: 'warning',
          },
          {
            badgeId: 'focus-badge',
            tone: 'neutral',
          },
        ],
        uniqueToneCount: 3,
        uniqueToneIds: [
          'success',
          'warning',
          'neutral',
        ],
      },
      renderLayerGroupBadgeToneLegend: [
        {
          badgeCount: 1,
          badgeIds: [
            'regions-badge',
          ],
          id: 'success-badge-tone',
          label: 'Success',
          mode: 'passive',
          safetyNote: 'Render layer group badge tone legend is display metadata only.',
          tone: 'success',
        },
        {
          badgeCount: 1,
          badgeIds: [
            'paths-badge',
          ],
          id: 'warning-badge-tone',
          label: 'Warning',
          mode: 'passive',
          safetyNote: 'Render layer group badge tone legend is display metadata only.',
          tone: 'warning',
        },
        {
          badgeCount: 1,
          badgeIds: [
            'focus-badge',
          ],
          id: 'neutral-badge-tone',
          label: 'Neutral',
          mode: 'passive',
          safetyNote: 'Render layer group badge tone legend is display metadata only.',
          tone: 'neutral',
        },
      ],
      renderLayerGroupBadgeToneLegendSummary: {
        badgeCount: 3,
        labelIds: [
          'success-badge-tone',
          'warning-badge-tone',
          'neutral-badge-tone',
        ],
        labels: [
          'Success',
          'Warning',
          'Neutral',
        ],
        legendCount: 3,
        mode: 'passive',
        safetyNote: 'Render layer group badge tone legend summary is display metadata only.',
        toneIds: [
          'success',
          'warning',
          'neutral',
        ],
      },
      focusWindowBounds: {
        height: 460,
        maxX: 330,
        maxY: 880,
        minX: 170,
        minY: 420,
        width: 160,
      },
      focusWindowRange: {
        containsEnd: false,
        containsStart: false,
        endIndex: 5,
        nodeIds: [
          'preview-scoped-edits',
          'review-preview',
          'apply-approved-edits',
        ],
        size: 3,
        startIndex: 3,
        totalNodeCount: 8,
      },
      focusWindowSegments: [
        {
          edgeId: 'proposal-loop-edge-preview-scoped-edits-review-preview',
          source: 'preview-scoped-edits',
          sourcePosition: { x: 250, y: 500 },
          target: 'review-preview',
          targetPosition: { x: 250, y: 650 },
        },
        {
          edgeId: 'proposal-loop-edge-review-preview-apply-approved-edits',
          source: 'review-preview',
          sourcePosition: { x: 250, y: 650 },
          target: 'apply-approved-edits',
          targetPosition: { x: 250, y: 800 },
        },
      ],
      focusWindowStatuses: [
        {
          count: 1,
          id: 'completed',
          label: 'completed',
          tone: 'success',
        },
        {
          count: 1,
          id: 'ready',
          label: 'ready',
          tone: 'warning',
        },
        {
          count: 1,
          id: 'pending',
          label: 'pending',
          tone: 'neutral',
        },
      ],
      focusWindowSummary: {
        currentIndex: 4,
        currentNodeId: 'review-preview',
        currentStatus: 'ready',
        currentTone: 'warning',
        endIndex: 5,
        hasNext: true,
        hasPrevious: true,
        nodeIds: [
          'preview-scoped-edits',
          'review-preview',
          'apply-approved-edits',
        ],
        segmentCount: 2,
        startIndex: 3,
        statusIds: ['completed', 'ready', 'pending'],
        totalNodeCount: 8,
        windowNodeCount: 3,
      },
      focusWindowControls: [
        {
          actionType: 'focus_previous',
          canExecute: false,
          enabled: true,
          executionMode: 'display_only',
          id: 'previous',
          isActive: false,
          keyHint: 'ArrowUp',
          label: 'Previous focus',
          safetyNote: 'Focus controls are display metadata only.',
          targetIndex: 3,
          targetNodeId: 'preview-scoped-edits',
          targetPosition: { x: 250, y: 500 },
          targetStatus: 'completed',
          tone: 'success',
        },
        {
          actionType: 'focus_current',
          canExecute: false,
          enabled: true,
          executionMode: 'display_only',
          id: 'current',
          isActive: true,
          keyHint: 'Enter',
          label: 'Current focus',
          safetyNote: 'Focus controls are display metadata only.',
          targetIndex: 4,
          targetNodeId: 'review-preview',
          targetPosition: { x: 250, y: 650 },
          targetStatus: 'ready',
          tone: 'warning',
        },
        {
          actionType: 'focus_next',
          canExecute: false,
          enabled: true,
          executionMode: 'display_only',
          id: 'next',
          isActive: false,
          keyHint: 'ArrowDown',
          label: 'Next focus',
          safetyNote: 'Focus controls are display metadata only.',
          targetIndex: 5,
          targetNodeId: 'apply-approved-edits',
          targetPosition: { x: 250, y: 800 },
          targetStatus: 'pending',
          tone: 'neutral',
        },
      ],
      focusWindowControlSummary: {
        activeControlId: 'current',
        controlCount: 3,
        disabledControlIds: [],
        enabledControlIds: ['previous', 'current', 'next'],
        keyHints: [
          {
            actionType: 'focus_previous',
            id: 'previous',
            keyHint: 'ArrowUp',
          },
          {
            actionType: 'focus_current',
            id: 'current',
            keyHint: 'Enter',
          },
          {
            actionType: 'focus_next',
            id: 'next',
            keyHint: 'ArrowDown',
          },
        ],
      },
      focusWindowControlSafety: {
        allControlsDisplayOnly: true,
        canExecuteAny: false,
        controlCount: 3,
        displayOnlyControlCount: 3,
        executableControlCount: 0,
        executionMode: 'display_only',
        safetyNote: 'Focus controls are display metadata only.',
      },
      focusWindow: {
        current: {
          id: 'review-preview',
          index: 4,
          position: { x: 250, y: 650 },
        },
        hasNext: true,
        hasPrevious: true,
        next: {
          id: 'apply-approved-edits',
          index: 5,
          position: { x: 250, y: 800 },
        },
        previous: {
          id: 'preview-scoped-edits',
          index: 3,
          position: { x: 250, y: 500 },
        },
      },
      focusNodeIds: [
        'prepare-edit-proposal-prompt',
        'produce-edit-proposal',
        'review-edit-proposal',
        'preview-scoped-edits',
        'review-preview',
        'apply-approved-edits',
        'run-verification',
        'handoff',
      ],
      mode: 'passive',
      nodeCount: 8,
      padding: 80,
    }));
    expect(saved.guardrails).toEqual(expect.objectContaining({
      approvalState: 'needs_approval',
      canRunCommand: false,
      commandCount: 5,
      missingRequiredCount: 0,
      needsApprovalDecision: true,
      needsHumanReview: true,
      producerMode: 'data_only_edit_proposal',
      readyCommandCount: 0,
      requiredBeforeApply: false,
      validationErrors: [],
    }));
    expect(saved.guardrails.disallowedActions).toEqual(expect.arrayContaining(['apply_patch', 'push', 'deploy']));
    expect(saved.guardrails.readOnlyTools).toEqual(['file_read', 'git_status', 'rg']);
    expect(saved.guardrails.safetyNotes).toEqual(expect.arrayContaining([
      'Does not modify repository files.',
      'Requires an approved decision file.',
    ]));
    expect(saved.supervision).toEqual(expect.objectContaining({
      actionType: 'review_preview',
      approvalState: 'needs_approval',
      panelId: 'approval',
      reason: 'Scoped edit preview is ready for human or Cowork approval before applying.',
      required: true,
      state: 'human_review_required',
    }));
    expect(saved.reviewChecklist).toEqual(expect.objectContaining({
      affectedFiles: ['docs/note.md'],
      nextItemId: 'open-review-panel',
      required: true,
      status: 'pending',
    }));
    expect(saved.reviewChecklist.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'open-review-panel',
        panelId: 'approval',
        status: 'pending',
      }),
      expect.objectContaining({
        id: 'confirm-guardrails',
        panelId: 'manifest',
        status: 'completed',
      }),
    ]));
    expect(saved.reviewRoute).toEqual(expect.objectContaining({
      mode: 'passive',
      nextStepId: 'open-review-panel',
      required: true,
    }));
    expect(saved.reviewRoute.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionId: 'open-active-panel',
        active: true,
        artifactPath: path.join(proposalLoopArtifactsDir, 'approval-state.json'),
        id: 'open-review-panel',
        panelId: 'approval',
        regionId: 'operator-review',
        status: 'pending',
      }),
      expect.objectContaining({
        actionId: 'inspect-guardrails',
        artifactPath: path.join(proposalLoopArtifactsDir, 'artifact-bundle.json'),
        id: 'confirm-guardrails',
        panelId: 'manifest',
        regionId: 'evidence-strip',
        status: 'completed',
      }),
    ]));
    expect(saved.producer.request).toEqual(expect.objectContaining({
      editProposalFile: path.join(proposalLoopArtifactsDir, 'edit-proposal.json'),
      instructionCount: 5,
      proposalPromptFile: path.join(proposalLoopArtifactsDir, 'edit-proposal-prompt.md'),
      safetyCount: 3,
      schemaKeys: ['edits', 'producer', 'risks', 'summary', 'verificationNotes'],
      status: 'previewed',
      validationErrors: [],
    }));
    expect(saved.producer.dispatch).toEqual(expect.objectContaining({
      allowedTools: ['file_read', 'rg', 'git_status'],
      mode: 'data_only_edit_proposal',
      validationErrors: [],
    }));
    expect(saved.producer.dispatch.reviewCommand).toEqual(expect.objectContaining({
      executable: 'buddy',
      args: expect.arrayContaining(['--edit-proposal-review-file']),
    }));
    expect(saved.producer.review).toEqual(expect.objectContaining({
      state: 'missing',
      validationErrors: [],
    }));
    expect(saved.producer.review.nextAction).toEqual(expect.objectContaining({
      stepId: 'produce-edit-proposal',
      type: 'produce_edit_proposal',
    }));
    expect(saved.producer.validationErrors).toEqual([]);
    expect(saved.evidence).toEqual(expect.objectContaining({
      approvalState: 'needs_approval',
      status: 'previewed',
      validationErrors: [],
    }));
    expect(saved.evidence.editSummary).toEqual({
      applied: 0,
      blocked: 0,
      declared: 1,
      previewed: 1,
    });
    expect(saved.evidence.verificationSummary).toEqual(expect.objectContaining({
      total: 0,
    }));
    expect(saved.evidence.workflow.activeNodeId).toBe('approval-decision');
    expect(saved.manifest).toEqual(expect.objectContaining({
      materializedCount: 13,
      roles: expect.arrayContaining(['artifact_manifest', 'seed_report']),
      source: expect.objectContaining({
        activeStepId: 'review-preview',
        status: 'previewed',
      }),
      validationErrors: [],
    }));
    expect(saved.manifest.coworkImport).toEqual(expect.objectContaining({
      panelCount: 9,
      requiredArtifactCount: 5,
    }));
  });

  it('writes a proposal loop artifact bundle when requested', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const proposalLoopArtifactsDir = path.join(tempRoot, 'loop-bundle');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--preview-edits',
      '--proposal-loop-artifacts-dir',
      proposalLoopArtifactsDir,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      proposalLoopArtifactsPath: string;
      status: string;
    };
    const bundle = JSON.parse(await fs.readFile(output.proposalLoopArtifactsPath, 'utf8')) as {
      artifacts: {
        approvalFile: string;
        editProposalProducerDispatchFile: string;
        editProposalRequestFile: string;
        editProposalReviewFile: string;
        proposalLoopCanvasFile: string;
        proposalLoopFile: string;
        proposalLoopNextActionFile: string;
        proposalPromptFile: string;
        seedReportFile: string;
      };
      coworkImport: {
        defaultPanelId: string;
        panels: Array<{ id: string; view: string }>;
        queueArtifactPath: string;
        suggestedFocusPanelId: string;
      };
      kind: string;
      materialized: Array<{ role: string }>;
      source: { activeStepId: string; approvalState: string; status: string };
    };
    const prompt = await fs.readFile(bundle.artifacts.proposalPromptFile, 'utf8');
    const request = JSON.parse(await fs.readFile(bundle.artifacts.editProposalRequestFile, 'utf8')) as {
      input: { proposalPromptFile: string; taskFile: string };
      kind: string;
      output: { editProposalFile: string };
      safety: string[];
    };
    const dispatch = JSON.parse(await fs.readFile(bundle.artifacts.editProposalProducerDispatchFile, 'utf8')) as {
      allowedTools: string[];
      disallowedActions: string[];
      kind: string;
      output: { editProposalFile: string; reviewCommand: { args: string[] } };
      runPolicy: { cwd: string; mode: string };
    };
    const review = JSON.parse(await fs.readFile(bundle.artifacts.editProposalReviewFile, 'utf8')) as {
      kind: string;
      state: string;
    };
    const nextAction = JSON.parse(await fs.readFile(bundle.artifacts.proposalLoopNextActionFile, 'utf8')) as {
      canRunCommand: boolean;
      kind: string;
      runState: string;
      ui: { primaryAction: { disabledReason?: string; enabled: boolean; type: string } };
    };
    const loop = JSON.parse(await fs.readFile(bundle.artifacts.proposalLoopFile, 'utf8')) as {
      activeStepId: string;
      kind: string;
    };
    const canvas = JSON.parse(await fs.readFile(bundle.artifacts.proposalLoopCanvasFile, 'utf8')) as {
      activeNodeId: string;
      kind: string;
    };
    const approval = JSON.parse(await fs.readFile(bundle.artifacts.approvalFile, 'utf8')) as { state: string };
    const seedReport = JSON.parse(await fs.readFile(bundle.artifacts.seedReportFile, 'utf8')) as { status: string };

    expect(output.status).toBe('previewed');
    expect(output.proposalLoopArtifactsPath).toBe(path.join(proposalLoopArtifactsDir, 'artifact-bundle.json'));
    expect(bundle.kind).toBe('agentic-coding-proposal-loop-artifact-bundle');
    expect(bundle.source).toEqual(expect.objectContaining({
      activeStepId: 'review-preview',
      approvalState: 'needs_approval',
      status: 'previewed',
    }));
    expect(bundle.coworkImport).toEqual(expect.objectContaining({
      defaultPanelId: 'canvas',
      queueArtifactPath: bundle.artifacts.proposalLoopNextActionFile,
      suggestedFocusPanelId: 'approval',
    }));
    expect(bundle.coworkImport.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'canvas', view: 'canvas' }),
      expect.objectContaining({ id: 'next-action', view: 'queue' }),
      expect.objectContaining({ id: 'approval', view: 'review' }),
      expect.objectContaining({ id: 'producer-dispatch', view: 'prompt' }),
    ]));
    expect(bundle.materialized).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'proposal_loop_packet' }),
      expect.objectContaining({ role: 'proposal_loop_canvas' }),
      expect.objectContaining({ role: 'edit_proposal_prompt' }),
      expect.objectContaining({ role: 'edit_proposal_request' }),
      expect.objectContaining({ role: 'edit_proposal_producer_dispatch' }),
      expect.objectContaining({ role: 'edit_proposal_review' }),
      expect.objectContaining({ role: 'proposal_loop_next_action' }),
      expect.objectContaining({ role: 'seed_report' }),
    ]));
    expect(prompt).toContain('controlled edit proposal');
    expect(request).toEqual(expect.objectContaining({
      input: {
        proposalPromptFile: bundle.artifacts.proposalPromptFile,
        taskFile,
      },
      kind: 'agentic-coding-edit-proposal-request',
      output: expect.objectContaining({
        editProposalFile: path.join(proposalLoopArtifactsDir, 'edit-proposal.json'),
      }),
      safety: expect.arrayContaining([
        'This request is data-only and never applies edits by itself.',
      ]),
    }));
    expect(dispatch).toEqual(expect.objectContaining({
      allowedTools: expect.arrayContaining(['file_read', 'rg']),
      disallowedActions: expect.arrayContaining(['apply_patch', 'push', 'deploy']),
      kind: 'agentic-coding-edit-proposal-producer-dispatch',
      output: expect.objectContaining({
        editProposalFile: path.join(proposalLoopArtifactsDir, 'edit-proposal.json'),
        reviewCommand: expect.objectContaining({
          args: expect.arrayContaining([
            '--edit-proposal-review-file',
            path.join(proposalLoopArtifactsDir, 'edit-proposal-review.json'),
          ]),
        }),
      }),
      runPolicy: expect.objectContaining({
        cwd: repo,
        mode: 'data_only_edit_proposal',
      }),
    }));
    expect(review).toEqual(expect.objectContaining({
      kind: 'agentic-coding-edit-proposal-review',
      state: 'missing',
    }));
    expect(nextAction).toEqual(expect.objectContaining({
      canRunCommand: false,
      kind: 'agentic-coding-proposal-loop-next-action',
      runState: 'human_input_required',
      ui: expect.objectContaining({
        primaryAction: expect.objectContaining({
          disabledReason: 'Review the scoped edit preview and write an approval decision JSON file.',
          enabled: false,
          type: 'human_review',
        }),
      }),
    }));
    expect(loop).toEqual(expect.objectContaining({
      activeStepId: 'review-preview',
      kind: 'agentic-coding-proposal-loop',
    }));
    expect(canvas).toEqual(expect.objectContaining({
      activeNodeId: 'review-preview',
      kind: 'agentic-coding-proposal-loop-canvas',
    }));
    expect(approval.state).toBe('needs_approval');
    expect(seedReport.status).toBe('previewed');
  });

  it('can require an approved decision file before applying edits', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const approvalDecisionFile = path.join(tempRoot, 'approval-decision.json');
    await fs.writeFile(approvalDecisionFile, JSON.stringify({
      kind: 'agentic-coding-approval-decision',
      schemaVersion: 1,
      decision: 'approved',
      reviewer: 'patrice',
      reason: 'Preview reviewed in Cowork.',
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--approval-decision-file',
      approvalDecisionFile,
      '--require-approval',
      '--apply-edits',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      approval: { state: string };
      approvalDecision: { decision: string; file: string; reviewer: string };
      editPreviews: Array<{ path: string; status: string }>;
      editResults: Array<{ path: string; status: string }>;
      status: string;
    };
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(output.status).toBe('edited');
    expect(output.approval.state).toBe('approved');
    expect(output.approvalDecision).toEqual(expect.objectContaining({
      decision: 'approved',
      file: approvalDecisionFile,
      reviewer: 'patrice',
    }));
    expect(output.editPreviews).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'previewed' }),
    ]);
    expect(output.editResults).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'applied' }),
    ]);
    expect(edited).toBe('after');
  });

  it('fails with an error if neither --task-file nor --resume is provided', async () => {
    const program = createProgram();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('Either --task-file, --resume, or --resume-from-manifest must be provided.');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0; // reset
  });

  it('fails fast for invalid budget flags', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--max-cost-usd',
      'not-a-number',
      '--json',
    ]);

    let errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--max-cost-usd must be a finite non-negative number');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    consoleErrorSpy.mockClear();

    const iterationsProgram = createProgram();
    registerAutonomousCodeCommand(iterationsProgram);

    await iterationsProgram.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--max-iterations',
      '0',
      '--json',
    ]);

    errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--max-iterations must be a positive integer');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('applies overnight autonomy preset defaults', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      autonomyBudgets: {
        maxCostUsd: number;
        maxIterations: number;
        verificationTimeoutMs: number;
      };
      autonomyPreset: string;
      status: string;
    };

    expect(output.status).toBe('ready');
    expect(output.autonomyPreset).toBe('overnight');
    expect(output.autonomyBudgets).toEqual({
      maxCostUsd: 10,
      maxIterations: 16,
      verificationTimeoutMs: 300000,
    });
  });

  it('creates a resumable checkpoint for overnight runs without an explicit run id', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      checkpointPath: string;
      overnightManifestPath: string;
      reportPath: string;
      runId: string;
      status: string;
      workflowEventsPath: string;
      workflowProgressPath: string;
    };
    const checkpoint = JSON.parse(await fs.readFile(output.checkpointPath, 'utf8')) as {
      runId: string;
      step: string;
      options: { runId?: string };
    };
    const manifest = JSON.parse(await fs.readFile(output.overnightManifestPath, 'utf8')) as {
      auditCommand: string[];
      autonomyBudgets: { maxCostUsd: number; maxIterations: number; verificationTimeoutMs: number };
      artifacts: Record<string, string>;
      checkpointPath: string;
      fleet: { policy: string };
      kind: string;
      overnightReadiness: {
        blockers: string[];
        configuredForOvernight: boolean;
        fleetCollaborationRequired: boolean;
        multiAgentReady: boolean;
        ready: boolean;
      };
      resumeCommand: string[];
      runId: string;
      status: string;
      supervisionDefaults: { maxErrorCycles: number; maxStalledCycles: number; requestedCycles: number; sleepMs: number };
      superviseCommand: string[];
    };
    const savedReport = JSON.parse(await fs.readFile(output.reportPath, 'utf8')) as { status: string };
    const savedProgress = JSON.parse(await fs.readFile(output.workflowProgressPath, 'utf8')) as { kind: string };
    const savedEvents = JSON.parse(await fs.readFile(output.workflowEventsPath, 'utf8')) as { kind: string };

    expect(output.status).toBe('ready');
    expect(output.runId).toMatch(/^overnight-\d{8}T\d{9}Z-[a-z0-9]+$/);
    expect(output.checkpointPath).toBe(path.join(tempRoot, 'runs', output.runId, 'state.json'));
    expect(output.overnightManifestPath).toBe(path.join(tempRoot, 'runs', output.runId, 'overnight-manifest.json'));
    expect(output.reportPath).toBe(path.join(tempRoot, 'runs', output.runId, 'report.json'));
    expect(output.workflowProgressPath).toBe(path.join(tempRoot, 'runs', output.runId, 'workflow-progress.json'));
    expect(output.workflowEventsPath).toBe(path.join(tempRoot, 'runs', output.runId, 'workflow-events.json'));
    expect(checkpoint.runId).toBe(output.runId);
    expect(checkpoint.options.runId).toBe(output.runId);
    expect(checkpoint.step).toBe('initialized');
    expect(manifest).toEqual(expect.objectContaining({
      checkpointPath: output.checkpointPath,
      kind: 'agentic-coding-overnight-manifest',
      auditCommand: ['buddy', 'autonomous-code', '--audit-overnight-manifest', output.overnightManifestPath, '--json'],
      resumeCommand: ['buddy', 'autonomous-code', '--resume-from-manifest', output.overnightManifestPath, '--json'],
      runId: output.runId,
      status: 'ready',
      superviseCommand: [
        'buddy',
        'autonomous-code',
        '--supervise-from-manifest',
        output.overnightManifestPath,
        '--supervise-cycles',
        '961',
        '--supervise-sleep-ms',
        '30000',
        '--supervise-max-stalled-cycles',
        '3',
        '--supervise-max-error-cycles',
        '3',
        '--json',
      ],
    }));
    expect(manifest.supervisionDefaults).toEqual({
      maxErrorCycles: 3,
      maxStalledCycles: 3,
      requestedCycles: 961,
      sleepMs: 30000,
    });
    expect(manifest.overnightReadiness).toEqual(expect.objectContaining({
      blockers: ['Fleet collaboration is not required by the execution profile.'],
      configuredForOvernight: true,
      fleetCollaborationRequired: false,
      multiAgentReady: false,
      ready: false,
    }));
    expect(manifest.autonomyBudgets).toEqual({
      maxCostUsd: 10,
      maxIterations: 16,
      verificationTimeoutMs: 300000,
    });
    expect(manifest.artifacts).toEqual(expect.objectContaining({
      reportPath: output.reportPath,
      workflowEventsPath: output.workflowEventsPath,
      workflowProgressPath: output.workflowProgressPath,
    }));
    expect(manifest.fleet.policy).toBe('none');
    expect(savedReport.status).toBe('ready');
    expect(savedProgress.kind).toBe('agentic-coding-workflow-progress');
    expect(savedEvents.kind).toBe('agentic-coding-workflow-events');
  });

  it('keeps overnight manifest paths resumable under high-entropy home directories', async () => {
    const program = createProgram();
    process.env.CODEBUDDY_HOME = path.join(tempRoot, 'Ab3dEf9Gh2JkLm7No4PqRs8Tu5VwXy1Z');
    const repo = path.join(process.env.CODEBUDDY_HOME, 'repo');
    const taskFile = path.join(process.env.CODEBUDDY_HOME, 'task.json');
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await execFileAsync('git', ['init'], { cwd: repo });
    const taskHandle = await fs.open(taskFile, 'w');
    await taskHandle.writeFile(JSON.stringify({
      repo,
      task: 'Run CLI preflight.',
      allowedPaths: ['docs/...'],
      verification: ['node -e "console.log(123)"'],
      riskLevel: 'low',
    }), 'utf8');
    await taskHandle.close();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      checkpointPath: string;
      overnightManifestPath: string;
      runId: string;
      status: string;
    };
    const rawManifest = await fs.readFile(output.overnightManifestPath, 'utf8');
    const manifest = JSON.parse(rawManifest) as {
      checkpointPath: string;
      resumeCommand: string[];
      runId: string;
    };
    const checkpoint = JSON.parse(await fs.readFile(output.checkpointPath, 'utf8')) as {
      contract: { repo: string };
    };

    expect(output.status).toBe('ready');
    expect(manifest.checkpointPath).toBe(output.checkpointPath);
    expect(manifest.checkpointPath).not.toContain('[REDACTED');
    expect(manifest.resumeCommand).toEqual(['buddy', 'autonomous-code', '--resume-from-manifest', output.overnightManifestPath, '--json']);
    expect(manifest.resumeCommand[3]).not.toContain('[REDACTED');
    expect(manifest.runId).toBe(output.runId);
    expect(checkpoint.contract.repo).toBe(repo);
    expect(checkpoint.contract.repo).not.toContain('[REDACTED');
  });

  it('writes an overnight manifest to a custom path', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const manifestFile = path.join(tempRoot, 'ops', 'overnight.json');
    const reportFile = path.join(tempRoot, 'ops', 'report.json');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--overnight-manifest-file',
      manifestFile,
      '--report-file',
      reportFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      overnightManifestPath: string;
      reportPath: string;
      runId: string;
      status: string;
      workflowEventsPath: string;
      workflowProgressPath: string;
    };
    const manifest = JSON.parse(await fs.readFile(output.overnightManifestPath, 'utf8')) as {
      artifacts: Record<string, string>;
      fleet: { chainRoles: string[]; policy: string };
      resumeCommand: string[];
      runId: string;
    };

    expect(output.status).toBe('ready');
    expect(output.overnightManifestPath).toBe(manifestFile);
    expect(output.reportPath).toBe(reportFile);
    expect(manifest.runId).toBe(output.runId);
    expect(manifest.resumeCommand).toEqual(['buddy', 'autonomous-code', '--resume-from-manifest', manifestFile, '--json']);
    expect(manifest.fleet).toEqual(expect.objectContaining({
      chainRoles: ['research', 'code', 'review', 'safe'],
      policy: 'delegated-slices',
    }));
    expect(manifest.artifacts).toEqual(expect.objectContaining({
      reportPath: reportFile,
      workflowEventsPath: output.workflowEventsPath,
      workflowProgressPath: output.workflowProgressPath,
    }));
  });

  it('can resume from an overnight manifest and reuse its artifacts', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const runId = 'manifest-resume-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'overnight.json');
    const reportFile = path.join(tempRoot, 'ops', 'report.json');
    const progressFile = path.join(tempRoot, 'ops', 'workflow-progress.json');
    const eventsFile = path.join(tempRoot, 'ops', 'workflow-events.json');

    await saveCheckpoint({
      runId,
      step: 'verified',
      timestamp: new Date().toISOString(),
      options: {
        runId,
        taskFile,
        maxCostUsd: 4,
        maxIterations: 9,
        verificationTimeoutMs: 240000,
      },
      contract: {
        repo,
        task: 'Resume from manifest.',
        allowedPaths: ['docs/...'],
        verification: [],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'delegated-slices',
      },
    });
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      autonomyBudgets: {
        maxCostUsd: 4,
        maxIterations: 9,
        verificationTimeoutMs: 240000,
      },
      runId,
      artifacts: {
        reportPath: reportFile,
        workflowEventsPath: eventsFile,
        workflowProgressPath: progressFile,
      },
    }), 'utf8');

    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--resume-from-manifest',
      manifestFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      autonomyBudgets: { maxCostUsd: number; maxIterations: number; verificationTimeoutMs: number };
      autonomyPreset: string;
      overnightManifestPath: string;
      reportPath: string;
      runId: string;
      status: string;
      workflowEventsPath: string;
      workflowProgressPath: string;
    };
    const updatedManifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      artifacts: Record<string, string>;
      runId: string;
      status: string;
    };

    expect(output.status).toBe('verified');
    expect(output.runId).toBe(runId);
    expect(output.autonomyPreset).toBe('overnight');
    expect(output.autonomyBudgets).toEqual({
      maxCostUsd: 4,
      maxIterations: 9,
      verificationTimeoutMs: 240000,
    });
    expect(output.overnightManifestPath).toBe(manifestFile);
    expect(output.reportPath).toBe(reportFile);
    expect(output.workflowProgressPath).toBe(progressFile);
    expect(output.workflowEventsPath).toBe(eventsFile);
    expect(updatedManifest).toEqual(expect.objectContaining({
      runId,
      status: 'verified',
    }));
    expect(updatedManifest.artifacts).toEqual(expect.objectContaining({
      reportPath: reportFile,
      workflowEventsPath: eventsFile,
      workflowProgressPath: progressFile,
    }));
  });

  it('replays the manifest execution profile when resuming without CLI action flags', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const runId = 'manifest-execution-profile-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'profile-overnight.json');
    const proposalFile = path.join(tempRoot, 'ops', 'profile-proposal.json');
    const traceFile = path.join(tempRoot, 'ops', 'edit-proposal-producer-trace.json');
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'readme.md'), 'old profile text\n', 'utf8');
    await fs.mkdir(path.dirname(proposalFile), { recursive: true });
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Manifest profile proposal',
      edits: [
        {
          expectedOccurrences: 1,
          find: 'old profile text',
          path: 'docs/readme.md',
          replace: 'new profile text',
          type: 'replace_text',
        },
      ],
      risks: [],
      verificationNotes: ['Resume should apply and verify this proposal.'],
    }), 'utf8');
    await fs.writeFile(traceFile, JSON.stringify(createProducerTrace()), 'utf8');

    await saveCheckpoint({
      runId,
      step: 'initialized',
      timestamp: new Date().toISOString(),
      options: {
        runId,
        taskFile,
      },
      contract: {
        repo,
        task: 'Resume with manifest execution profile.',
        allowedPaths: ['docs/...'],
        verification: ['node -e "console.log(123)"'],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'delegated-slices',
      },
    });
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId,
      artifacts: {
        editProposalProducerTracePath: traceFile,
      },
      executionProfile: {
        applyEdits: true,
        editProposalFile: proposalFile,
        requireFleetCollaboration: true,
        requirePreview: true,
        runVerification: true,
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--resume-from-manifest',
      manifestFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      editProposal?: { file: string };
      editPreviews: Array<{ path: string; status: string }>;
      editResults: Array<{ path: string; status: string }>;
      overnightManifestPath: string;
      status: string;
      verification: Array<{ status: string }>;
    };
    const updatedManifest = JSON.parse(await fs.readFile(output.overnightManifestPath, 'utf8')) as {
      executionProfile: {
        applyEdits: boolean;
        editProposalFile: string;
        requireFleetCollaboration: boolean;
        requirePreview: boolean;
        runVerification: boolean;
      };
      resumeCommand: string[];
    };
    const finalContent = await fs.readFile(path.join(repo, 'docs', 'readme.md'), 'utf8');

    expect(output.status).toBe('verified');
    expect(output.editProposal?.file).toBe(proposalFile);
    expect(output.editPreviews).toEqual([
      expect.objectContaining({ path: 'docs/readme.md', status: 'previewed' }),
    ]);
    expect(output.editResults).toEqual([
      expect.objectContaining({ path: 'docs/readme.md', status: 'applied' }),
    ]);
    expect(output.verification).toEqual([
      expect.objectContaining({ status: 'passed' }),
    ]);
    expect(finalContent).toBe('new profile text\n');
    expect(updatedManifest.executionProfile).toEqual({
      applyEdits: true,
      editProposalFile: proposalFile,
      requireFleetCollaboration: true,
      requirePreview: true,
      runVerification: true,
    });
    expect(updatedManifest.resumeCommand).toEqual([
      'buddy',
      'autonomous-code',
      '--resume-from-manifest',
      manifestFile,
      '--edit-proposal-file',
      proposalFile,
      '--apply-edits',
      '--require-preview',
      '--require-fleet-collaboration',
      '--run-verification',
      '--json',
    ]);
  });

  it('rejects manifest resume when required Fleet collaboration is not proven by the trace', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const runId = 'manifest-requires-fleet-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'require-fleet-overnight.json');
    const proposalFile = path.join(tempRoot, 'ops', 'require-fleet-proposal.json');
    const traceFile = path.join(tempRoot, 'ops', 'edit-proposal-producer-trace.json');
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'readme.md'), 'old required fleet text\n', 'utf8');
    await fs.mkdir(path.dirname(proposalFile), { recursive: true });
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Manifest profile proposal without completed Fleet work',
      edits: [
        {
          expectedOccurrences: 1,
          find: 'old required fleet text',
          path: 'docs/readme.md',
          replace: 'new required fleet text',
          type: 'replace_text',
        },
      ],
      risks: [],
      verificationNotes: ['This proposal must not apply without completed Fleet collaboration.'],
    }), 'utf8');
    await fs.writeFile(traceFile, JSON.stringify(createProducerTrace({
      fleet: {
        attemptedPeerChainCalls: 1,
        attemptedRoutePeerCalls: 0,
        completedPeerChainCalls: 0,
        completedRoutePeerCalls: 0,
        expectedCollaboration: true,
        mode: 'data_only_delegated_slices',
        policy: 'delegated-slices',
        state: 'attempted',
      },
      toolCalls: [
        {
          allowed: true,
          args: { chainRoles: ['research', 'code', 'review', 'safe'], promptLength: 42 },
          error: 'No fleet peers connected',
          index: 1,
          name: 'peer_chain',
          resultSummary: 'Error: No fleet peers connected',
          success: false,
        },
      ],
    })), 'utf8');

    await saveCheckpoint({
      runId,
      step: 'initialized',
      timestamp: new Date().toISOString(),
      options: {
        runId,
        taskFile,
      },
      contract: {
        repo,
        task: 'Resume should reject missing Fleet collaboration proof.',
        allowedPaths: ['docs/...'],
        verification: ['node -e "console.log(123)"'],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'delegated-slices',
      },
    });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId,
      artifacts: {
        editProposalProducerTracePath: traceFile,
      },
      executionProfile: {
        applyEdits: true,
        editProposalFile: proposalFile,
        requireFleetCollaboration: true,
        requirePreview: true,
        runVerification: true,
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--resume-from-manifest',
      manifestFile,
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    const finalContent = await fs.readFile(path.join(repo, 'docs', 'readme.md'), 'utf8');

    expect(errorOutput).toContain('--require-fleet-collaboration requires a generated proposal trace');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(finalContent).toBe('old required fleet text\n');
  });

  it('records required Fleet collaboration proof in supervised manifest events', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const runId = 'manifest-supervise-fleet-proof-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'proof-overnight.json');
    const proposalFile = path.join(tempRoot, 'ops', 'proof-proposal.json');
    const traceFile = path.join(tempRoot, 'ops', 'edit-proposal-producer-trace.json');
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'readme.md'), 'old proof text\n', 'utf8');
    await fs.mkdir(path.dirname(proposalFile), { recursive: true });
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Manifest profile proposal with proven Fleet work',
      edits: [
        {
          expectedOccurrences: 1,
          find: 'old proof text',
          path: 'docs/readme.md',
          replace: 'new proof text',
          type: 'replace_text',
        },
      ],
      risks: [],
      verificationNotes: ['Supervision should expose the Fleet proof.'],
    }), 'utf8');
    await fs.writeFile(traceFile, JSON.stringify(createProducerTrace()), 'utf8');

    await saveCheckpoint({
      runId,
      step: 'initialized',
      timestamp: new Date().toISOString(),
      options: {
        runId,
        taskFile,
      },
      contract: {
        repo,
        task: 'Supervise with manifest Fleet collaboration proof.',
        allowedPaths: ['docs/...'],
        verification: ['node -e "console.log(123)"'],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'delegated-slices',
      },
    });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId,
      artifacts: {
        editProposalProducerTracePath: traceFile,
      },
      executionProfile: {
        applyEdits: true,
        editProposalFile: proposalFile,
        requireFleetCollaboration: true,
        requirePreview: true,
        runVerification: true,
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--supervise-cycles',
      '1',
      '--supervise-sleep-ms',
      '0',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      supervision: {
        fleetCollaborationProof: {
          completedPeerChainCalls: number;
          completedRoutePeerCalls: number;
          expectedCollaboration: boolean;
          proven: boolean;
          state: string;
          tracePath: string;
        };
        stoppedReason: string;
      };
      overnightReadiness: {
        configuredForOvernight: boolean;
        fleetCollaborationProven: boolean;
        multiAgentReady: boolean;
        ready: boolean;
      };
      supervisionEventsPath: string;
    };
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      overnightReadiness: {
        configuredForOvernight: boolean;
        fleetCollaborationProven: boolean;
        multiAgentReady: boolean;
        ready: boolean;
      };
      supervision: {
        fleetCollaborationProof: {
          completedPeerChainCalls: number;
          proven: boolean;
          tracePath: string;
        };
      };
    };
    const eventLines = (await fs.readFile(output.supervisionEventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        fleetCollaborationProof: {
          completedPeerChainCalls: number;
          completedRoutePeerCalls: number;
          expectedCollaboration: boolean;
          proven: boolean;
          state: string;
          tracePath: string;
        };
      });
    const finalContent = await fs.readFile(path.join(repo, 'docs', 'readme.md'), 'utf8');

    expect(output.status).toBe('verified');
    expect(output.supervision.stoppedReason).toBe('terminal_status');
    expect(output.supervision.fleetCollaborationProof).toEqual({
      completedPeerChainCalls: 1,
      completedRoutePeerCalls: 0,
      expectedCollaboration: true,
      proven: true,
      state: 'completed',
      tracePath: traceFile,
    });
    expect(output.overnightReadiness).toEqual(expect.objectContaining({
      configuredForOvernight: false,
      fleetCollaborationProven: true,
      multiAgentReady: true,
      ready: false,
    }));
    expect(manifest.overnightReadiness).toEqual(expect.objectContaining({
      configuredForOvernight: false,
      fleetCollaborationProven: true,
      multiAgentReady: true,
      ready: false,
    }));
    expect(manifest.supervision.fleetCollaborationProof).toEqual(expect.objectContaining({
      completedPeerChainCalls: 1,
      proven: true,
      tracePath: traceFile,
    }));
    expect(eventLines).toEqual([
      expect.objectContaining({
        fleetCollaborationProof: expect.objectContaining({
          completedPeerChainCalls: 1,
          completedRoutePeerCalls: 0,
          expectedCollaboration: true,
          proven: true,
          tracePath: traceFile,
        }),
      }),
    ]);
    expect(finalContent).toBe('new proof text\n');
  });

  it('rejects supervised runs when overnight readiness is required but not satisfied', async () => {
    const program = createProgram();
    const manifestFile = path.join(tempRoot, 'ops', 'not-ready-overnight.json');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      autonomyPreset: 'overnight',
      runId: 'not-ready-run-id',
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--supervise-cycles',
      '2',
      '--supervise-sleep-ms',
      '0',
      '--require-overnight-readiness',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--require-overnight-readiness failed');
    expect(errorOutput).toContain('Supervision window is shorter than the minimum overnight window.');
    expect(errorOutput).toContain('Fleet collaboration is not required by the execution profile.');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('allows readiness-required supervised manifests with Fleet proof and the default overnight window', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const runId = 'manifest-supervise-ready-proof-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'ready-proof-overnight.json');
    const proposalFile = path.join(tempRoot, 'ops', 'ready-proof-proposal.json');
    const traceFile = path.join(tempRoot, 'ops', 'ready-proof-trace.json');
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'readme.md'), 'old ready proof text\n', 'utf8');
    await fs.mkdir(path.dirname(proposalFile), { recursive: true });
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Readiness-gated Fleet proof proposal',
      edits: [
        {
          expectedOccurrences: 1,
          find: 'old ready proof text',
          path: 'docs/readme.md',
          replace: 'new ready proof text',
          type: 'replace_text',
        },
      ],
      risks: [],
      verificationNotes: ['Supervision readiness gate should allow this run.'],
    }), 'utf8');
    await fs.writeFile(traceFile, JSON.stringify(createProducerTrace()), 'utf8');

    await saveCheckpoint({
      runId,
      step: 'initialized',
      timestamp: new Date().toISOString(),
      options: {
        runId,
        taskFile,
      },
      contract: {
        repo,
        task: 'Supervise with required overnight readiness.',
        allowedPaths: ['docs/...'],
        verification: ['node -e "console.log(123)"'],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'delegated-slices',
      },
    });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId,
      artifacts: {
        editProposalProducerTracePath: traceFile,
      },
      executionProfile: {
        applyEdits: true,
        editProposalFile: proposalFile,
        requireFleetCollaboration: true,
        requirePreview: true,
        runVerification: true,
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--require-overnight-readiness',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      overnightReadiness: {
        completionProven: boolean;
        configuredForOvernight: boolean;
        fleetCollaborationProven: boolean;
        multiAgentReady: boolean;
        ready: boolean;
      };
      supervision: {
        requestedCycles: number;
        sleepMs: number;
        stoppedReason: string;
      };
    };
    const finalContent = await fs.readFile(path.join(repo, 'docs', 'readme.md'), 'utf8');

    expect(output.status).toBe('verified');
    expect(output.supervision).toEqual(expect.objectContaining({
      requestedCycles: 961,
      sleepMs: 30000,
      stoppedReason: 'terminal_status',
    }));
    expect(output.overnightReadiness).toEqual(expect.objectContaining({
      completionProven: false,
      configuredForOvernight: true,
      fleetCollaborationProven: true,
      multiAgentReady: true,
      ready: true,
    }));
    expect(finalContent).toBe('new ready proof text\n');
  });

  it('does not prove overnight completion when a ready watchdog stops on the first terminal cycle', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const runId = 'early-terminal-ready-watchdog-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'early-terminal-ready-watchdog.json');
    const proposalFile = path.join(tempRoot, 'ops', 'early-terminal-proposal.json');
    const traceFile = path.join(tempRoot, 'ops', 'early-terminal-trace.json');
    await fs.mkdir(path.dirname(proposalFile), { recursive: true });
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Unused proposal for terminal checkpoint readiness proof',
      edits: [],
      risks: [],
      verificationNotes: ['Terminal checkpoint should not prove overnight completion.'],
    }), 'utf8');
    await fs.writeFile(traceFile, JSON.stringify(createProducerTrace()), 'utf8');
    await saveCheckpoint({
      runId,
      step: 'verified',
      timestamp: new Date().toISOString(),
      options: { runId, taskFile },
      contract: {
        repo,
        task: 'Terminal checkpoint should not prove overnight completion.',
        allowedPaths: ['docs/...'],
        verification: [],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'delegated-slices',
      },
    });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId,
      artifacts: {
        editProposalProducerTracePath: traceFile,
      },
      executionProfile: {
        editProposalFile: proposalFile,
        requireFleetCollaboration: true,
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--supervise-cycles',
      '2',
      '--supervise-sleep-ms',
      '28800000',
      '--require-overnight-readiness',
      '--json',
    ]);

    const outputText = getLogOutput();
    if (!outputText) {
      const manifestAfterFailure = await fs.readFile(created.overnightManifestPath, 'utf8').catch(() => '');
      throw new Error([
        consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n'),
        manifestAfterFailure,
      ].filter(Boolean).join('\n'));
    }
    const output = JSON.parse(outputText) as {
      overnightReadiness: {
        completedOvernightWindow: boolean;
        completedWindowMs: number;
        completionProven: boolean;
        configuredForOvernight: boolean;
        configuredWindowMs: number;
        ready: boolean;
      };
      supervision: { completedCycles: number; stoppedReason: string };
    };

    expect(output.supervision).toEqual(expect.objectContaining({
      completedCycles: 1,
      stoppedReason: 'terminal_status',
    }));
    expect(output.overnightReadiness).toEqual(expect.objectContaining({
      completedOvernightWindow: false,
      completedWindowMs: 0,
      completionProven: false,
      configuredForOvernight: true,
      configuredWindowMs: 28800000,
      ready: true,
    }));
  });

  it('rejects required overnight completion when a ready watchdog stops before the full window', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    const runId = 'required-completion-early-terminal-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'required-completion-early-terminal.json');
    const proposalFile = path.join(tempRoot, 'ops', 'required-completion-proposal.json');
    const traceFile = path.join(tempRoot, 'ops', 'required-completion-trace.json');
    await fs.mkdir(path.dirname(proposalFile), { recursive: true });
    await fs.writeFile(proposalFile, JSON.stringify({
      summary: 'Unused proposal for required overnight completion',
      edits: [],
      risks: [],
      verificationNotes: ['Terminal checkpoint should not satisfy completion.'],
    }), 'utf8');
    await fs.writeFile(traceFile, JSON.stringify(createProducerTrace()), 'utf8');
    await saveCheckpoint({
      runId,
      step: 'verified',
      timestamp: new Date().toISOString(),
      options: { runId, taskFile },
      contract: {
        repo,
        task: 'Terminal checkpoint should fail required overnight completion.',
        allowedPaths: ['docs/...'],
        verification: [],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'delegated-slices',
      },
    });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId,
      artifacts: {
        editProposalProducerTracePath: traceFile,
      },
      executionProfile: {
        editProposalFile: proposalFile,
        requireFleetCollaboration: true,
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--supervise-cycles',
      '2',
      '--supervise-sleep-ms',
      '28800000',
      '--require-overnight-completion',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      overnightReadiness: {
        completedOvernightWindow: boolean;
        completionProven: boolean;
        configuredForOvernight: boolean;
        ready: boolean;
      };
      supervision: { completedCycles: number; stoppedReason: string };
    };

    expect(errorOutput).toContain('--require-overnight-completion failed');
    expect(errorOutput).toContain('Completed supervision window 0ms is shorter than minimum 28800000ms');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(manifest.supervision).toEqual(expect.objectContaining({
      completedCycles: 1,
      stoppedReason: 'terminal_status',
    }));
    expect(manifest.overnightReadiness).toEqual(expect.objectContaining({
      completedOvernightWindow: false,
      completionProven: false,
      configuredForOvernight: true,
      ready: true,
    }));
  });

  it('audits completed overnight manifests without running supervision', async () => {
    const program = createProgram();
    const manifestFile = path.join(tempRoot, 'ops', 'completed-audit-overnight.json');
    const eventsFile = path.join(tempRoot, 'ops', 'completed-audit-events.jsonl');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    const cycles = [
      {
        consecutiveErrorCycles: 0,
        index: 1,
        progressSignature: 'ready-1',
        runId: 'completed-audit-run-id',
        stalledCycles: 1,
        status: 'ready',
        timestamp: '2026-05-23T00:00:00.000Z',
      },
      {
        consecutiveErrorCycles: 0,
        index: 2,
        progressSignature: 'ready-2',
        runId: 'completed-audit-run-id',
        stalledCycles: 1,
        status: 'ready',
        timestamp: '2026-05-23T08:00:00.000Z',
      },
    ];
    await fs.writeFile(eventsFile, cycles.map((cycle, index) => JSON.stringify({
      kind: 'agentic-coding-supervision-cycle',
      maxErrorCycles: 3,
      maxStalledCycles: 3,
      schemaVersion: 1,
      cycle,
      requestedCycles: 2,
      sleepMs: 28800000,
      sourceManifestPath: manifestFile,
      stoppedReason: index === cycles.length - 1 ? 'cycle_limit' : undefined,
    })).join('\n'), 'utf8');
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId: 'completed-audit-run-id',
      artifacts: {
        supervisionEventsPath: eventsFile,
      },
      executionProfile: {
        requireFleetCollaboration: true,
      },
      supervision: {
        completedCycles: 2,
        cycles,
        fleetCollaborationProof: {
          completedPeerChainCalls: 1,
          completedRoutePeerCalls: 0,
          expectedCollaboration: true,
          proven: true,
          state: 'completed',
          tracePath: path.join(tempRoot, 'ops', 'completed-audit-trace.json'),
        },
        maxErrorCycles: 3,
        maxStalledCycles: 3,
        requestedCycles: 2,
        sleepMs: 28800000,
        sourceManifestPath: manifestFile,
        stoppedReason: 'cycle_limit',
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--audit-overnight-manifest',
      manifestFile,
      '--require-overnight-completion',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      evidence: { completedCycles: number; stoppedReason: string; supervisionEventsPath: string };
      eventAudit: { eventCount: number; exists: boolean; matchesSupervision: boolean; path: string };
      kind: string;
      overnightReadiness: {
        completedOvernightWindow: boolean;
        completedWindowMs: number;
        completionProven: boolean;
        fleetCollaborationProven: boolean;
        ready: boolean;
      };
      status: string;
      supervision: { completedCycles: number; stoppedReason: string };
    };

    expect(output.kind).toBe('agentic-coding-overnight-audit');
    expect(output.status).toBe('completion_proven');
    expect(output.evidence).toEqual(expect.objectContaining({
      completedCycles: 2,
      stoppedReason: 'cycle_limit',
      supervisionEventsPath: eventsFile,
    }));
    expect(output.eventAudit).toEqual(expect.objectContaining({
      eventCount: 2,
      exists: true,
      matchesSupervision: true,
      path: eventsFile,
    }));
    expect(output.overnightReadiness).toEqual(expect.objectContaining({
      completedOvernightWindow: true,
      completedWindowMs: 28800000,
      completionProven: true,
      fleetCollaborationProven: true,
      ready: true,
    }));
    expect(output.supervision).toEqual(expect.objectContaining({
      completedCycles: 2,
      stoppedReason: 'cycle_limit',
    }));
  });

  it('rejects completed overnight manifest audits when supervision event evidence is missing', async () => {
    const program = createProgram();
    const manifestFile = path.join(tempRoot, 'ops', 'missing-events-audit-overnight.json');
    const eventsFile = path.join(tempRoot, 'ops', 'missing-events-audit-events.jsonl');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId: 'missing-events-audit-run-id',
      artifacts: {
        supervisionEventsPath: eventsFile,
      },
      executionProfile: {
        requireFleetCollaboration: true,
      },
      supervision: {
        completedCycles: 2,
        cycles: [
          {
            consecutiveErrorCycles: 0,
            index: 1,
            progressSignature: 'ready-1',
            runId: 'missing-events-audit-run-id',
            stalledCycles: 1,
            status: 'ready',
            timestamp: '2026-05-23T00:00:00.000Z',
          },
          {
            consecutiveErrorCycles: 0,
            index: 2,
            progressSignature: 'ready-2',
            runId: 'missing-events-audit-run-id',
            stalledCycles: 1,
            status: 'ready',
            timestamp: '2026-05-23T08:00:00.000Z',
          },
        ],
        fleetCollaborationProof: {
          completedPeerChainCalls: 1,
          completedRoutePeerCalls: 0,
          expectedCollaboration: true,
          proven: true,
          state: 'completed',
          tracePath: path.join(tempRoot, 'ops', 'missing-events-audit-trace.json'),
        },
        maxErrorCycles: 3,
        maxStalledCycles: 3,
        requestedCycles: 2,
        sleepMs: 28800000,
        sourceManifestPath: manifestFile,
        stoppedReason: 'cycle_limit',
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--audit-overnight-manifest',
      manifestFile,
      '--require-overnight-completion',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--require-overnight-completion failed');
    expect(errorOutput).toContain('Supervision event audit file is missing or unreadable');
    expect(errorOutput).toContain(eventsFile);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('rejects overnight manifest audits when observed completion is missing', async () => {
    const program = createProgram();
    const manifestFile = path.join(tempRoot, 'ops', 'not-complete-audit-overnight.json');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      schemaVersion: 1,
      autonomyPreset: 'overnight',
      runId: 'not-complete-audit-run-id',
      executionProfile: {
        requireFleetCollaboration: true,
      },
      supervisionDefaults: {
        maxErrorCycles: 3,
        maxStalledCycles: 3,
        requestedCycles: 2,
        sleepMs: 28800000,
      },
      supervision: {
        completedCycles: 1,
        cycles: [
          {
            consecutiveErrorCycles: 0,
            index: 1,
            progressSignature: 'verified',
            runId: 'not-complete-audit-run-id',
            stalledCycles: 1,
            status: 'verified',
            timestamp: '2026-05-23T00:00:00.000Z',
          },
        ],
        fleetCollaborationProof: {
          completedPeerChainCalls: 1,
          completedRoutePeerCalls: 0,
          expectedCollaboration: true,
          proven: true,
          state: 'completed',
          tracePath: path.join(tempRoot, 'ops', 'not-complete-audit-trace.json'),
        },
        maxErrorCycles: 3,
        maxStalledCycles: 3,
        requestedCycles: 2,
        sleepMs: 28800000,
        sourceManifestPath: manifestFile,
        stoppedReason: 'terminal_status',
      },
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--audit-overnight-manifest',
      manifestFile,
      '--require-overnight-completion',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--require-overnight-completion failed');
    expect(errorOutput).toContain('Completed supervision window 0ms is shorter than minimum 28800000ms');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('measures overnight completion from observed supervision timestamps', () => {
    expect(calculateCompletedSupervisionWindowMs({
      cycles: [
        { timestamp: '2026-05-23T00:00:00.000Z' },
        { timestamp: '2026-05-23T08:00:00.000Z' },
      ],
      stoppedReason: 'cycle_limit',
    })).toBe(28800000);
  });

  it('can supervise repeated bounded resume cycles from an overnight manifest', async () => {
    const createProgramInstance = createProgram();
    const { taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    registerAutonomousCodeCommand(createProgramInstance);

    await createProgramInstance.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--json',
    ]);

    const created = JSON.parse(getLogOutput()) as {
      overnightManifestPath: string;
      runId: string;
    };
    consoleLogSpy.mockClear();
    const superviseProgram = createProgram();
    registerAutonomousCodeCommand(superviseProgram);

    await superviseProgram.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      created.overnightManifestPath,
      '--supervise-cycles',
      '2',
      '--supervise-sleep-ms',
      '0',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      runId: string;
      status: string;
      supervision: {
        completedCycles: number;
        cycles: Array<{ index: number; nextCycleAt?: string; status: string }>;
        requestedCycles: number;
        sleepMs: number;
        sourceManifestPath: string;
        stoppedReason: string;
      };
      supervisionEventsPath: string;
    };
    const manifest = JSON.parse(await fs.readFile(created.overnightManifestPath, 'utf8')) as {
      artifacts: Record<string, string>;
      supervision: {
        completedCycles: number;
        maxErrorCycles: number;
        maxStalledCycles: number;
        requestedCycles: number;
        stoppedReason: string;
      };
      supervisionDefaults: { maxErrorCycles: number; maxStalledCycles: number; requestedCycles: number; sleepMs: number };
      superviseCommand: string[];
    };
    const eventLines = (await fs.readFile(output.supervisionEventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        cycle: { index: number; nextCycleAt?: string; status: string };
        fleet: {
          chainRoles: string[];
          expectedCollaboration: boolean;
          mode: string;
          policy: string;
          state: string;
        };
        kind: string;
        maxErrorCycles: number;
        requestedCycles: number;
        sourceManifestPath: string;
        stoppedReason?: string;
      });

    expect(output.runId).toBe(created.runId);
    expect(output.status).toBe('ready');
    expect(output.supervisionEventsPath).toBe(
      path.join(path.dirname(created.overnightManifestPath), 'supervision-events.jsonl'),
    );
    expect(output.supervision).toEqual(expect.objectContaining({
      completedCycles: 2,
      maxErrorCycles: 3,
      maxStalledCycles: 3,
      requestedCycles: 2,
      sleepMs: 0,
      sourceManifestPath: created.overnightManifestPath,
      stoppedReason: 'cycle_limit',
    }));
    expect(output.supervision.cycles).toEqual([
      expect.objectContaining({ index: 1, nextCycleAt: expect.any(String), status: 'ready' }),
      expect.objectContaining({ index: 2, status: 'ready' }),
    ]);
    expect(output.supervision.cycles[1]?.nextCycleAt).toBeUndefined();
    expect(manifest.supervision).toEqual(expect.objectContaining({
      completedCycles: 2,
      maxErrorCycles: 3,
      maxStalledCycles: 3,
      requestedCycles: 2,
      stoppedReason: 'cycle_limit',
    }));
    expect(manifest.supervisionDefaults).toEqual({
      maxErrorCycles: 3,
      maxStalledCycles: 3,
      requestedCycles: 2,
      sleepMs: 0,
    });
    expect(manifest.superviseCommand).toEqual([
      'buddy',
      'autonomous-code',
      '--supervise-from-manifest',
      created.overnightManifestPath,
      '--supervise-cycles',
      '2',
      '--supervise-sleep-ms',
      '0',
      '--supervise-max-stalled-cycles',
      '3',
      '--supervise-max-error-cycles',
      '3',
      '--json',
      '--supervision-events-file',
      manifest.artifacts.supervisionEventsPath,
      '--supervision-recovery-file',
      manifest.artifacts.supervisionRecoveryPath,
      '--supervision-fleet-triage-file',
      manifest.artifacts.supervisionFleetTriagePath,
      '--supervision-fleet-triage-result-file',
      manifest.artifacts.supervisionFleetTriageResultPath,
    ]);
    expect(manifest.artifacts.supervisionEventsPath).toBe(output.supervisionEventsPath);
    expect(eventLines).toEqual([
      expect.objectContaining({
        cycle: expect.objectContaining({ index: 1, status: 'ready' }),
        fleet: expect.objectContaining({
          chainRoles: ['research', 'code', 'review', 'safe'],
          expectedCollaboration: true,
          mode: 'data_only_delegated_slices',
          policy: 'delegated-slices',
          state: 'delegated_chain_ready',
        }),
        kind: 'agentic-coding-supervision-cycle',
        maxErrorCycles: 3,
        requestedCycles: 2,
        sourceManifestPath: created.overnightManifestPath,
      }),
      expect.objectContaining({
        cycle: expect.objectContaining({ index: 2, status: 'ready' }),
        fleet: expect.objectContaining({
          state: 'delegated_chain_ready',
        }),
        kind: 'agentic-coding-supervision-cycle',
        maxErrorCycles: 3,
        requestedCycles: 2,
        sourceManifestPath: created.overnightManifestPath,
        stoppedReason: 'cycle_limit',
      }),
    ]);
    expect(eventLines[0]?.cycle.nextCycleAt).toEqual(expect.any(String));
    expect(eventLines[1]?.cycle.nextCycleAt).toBeUndefined();
  });

  it('stops overnight supervision when progress stalls across cycles', async () => {
    const createProgramInstance = createProgram();
    const { taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    registerAutonomousCodeCommand(createProgramInstance);

    await createProgramInstance.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--json',
    ]);

    const created = JSON.parse(getLogOutput()) as {
      overnightManifestPath: string;
      runId: string;
    };
    consoleLogSpy.mockClear();
    const superviseProgram = createProgram();
    registerAutonomousCodeCommand(superviseProgram);

    await superviseProgram.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      created.overnightManifestPath,
      '--supervise-cycles',
      '5',
      '--supervise-sleep-ms',
      '0',
      '--supervise-max-stalled-cycles',
      '2',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      supervision: {
        completedCycles: number;
        cycles: Array<{
          index: number;
          nextCycleAt?: string;
          progressSignature: string;
          stalledCycles: number;
          status: string;
        }>;
        maxErrorCycles: number;
        maxStalledCycles: number;
        requestedCycles: number;
        stoppedReason: string;
      };
      supervisionEventsPath: string;
      supervisionFleetTriagePath: string;
      supervisionFleetTriageResultPath: string;
      supervisionRecoveryPath: string;
    };
    const manifest = JSON.parse(await fs.readFile(created.overnightManifestPath, 'utf8')) as {
      artifacts: {
        supervisionFleetTriagePath?: string;
        supervisionFleetTriageResultPath?: string;
        supervisionRecoveryPath?: string;
      };
      supervisionDefaults: { maxErrorCycles: number; maxStalledCycles: number; requestedCycles: number; sleepMs: number };
      superviseCommand: string[];
    };
    const recovery = JSON.parse(await fs.readFile(output.supervisionRecoveryPath, 'utf8')) as {
      actions: Array<{ command?: string[]; invocation?: { tool: string }; path?: string; type: string }>;
      artifacts: { supervisionFleetTriagePath?: string; supervisionFleetTriageResultPath?: string };
      fleet: { state: string };
      kind: string;
      lastCycle: { stalledCycles: number; status: string };
      sourceManifestPath: string;
      stoppedReason: string;
      summary: { completedCycles: number; maxStalledCycles: number };
    };
    const triage = JSON.parse(await fs.readFile(output.supervisionFleetTriagePath, 'utf8')) as {
      artifacts: { supervisionEventsPath?: string; supervisionRecoveryPath?: string };
      fleet: { state: string };
      kind: string;
      lastCycle: { stalledCycles: number; status: string };
      peerChainCall: { chainRoles: string[]; prompt: string; tool: string };
      recoveryPath: string;
      sourceManifestPath: string;
      stoppedReason: string;
    };
    const triageResult = JSON.parse(await fs.readFile(output.supervisionFleetTriageResultPath, 'utf8')) as {
      error: string;
      kind: string;
      peerChainCall: { promptLength: number; stageTimeoutMs: number; tool: string };
      success: boolean;
      triagePath: string;
    };
    const eventLines = (await fs.readFile(output.supervisionEventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        cycle: { nextCycleAt?: string };
        fleet: { expectedCollaboration: boolean; state: string };
        maxErrorCycles: number;
        maxStalledCycles: number;
        stoppedReason?: string;
      });

    expect(output.status).toBe('ready');
    expect(output.supervision).toEqual(expect.objectContaining({
      completedCycles: 2,
      maxErrorCycles: 3,
      maxStalledCycles: 2,
      requestedCycles: 5,
      stoppedReason: 'stalled',
    }));
    expect(output.supervision.cycles).toEqual([
      expect.objectContaining({ index: 1, nextCycleAt: expect.any(String), stalledCycles: 1, status: 'ready' }),
      expect.objectContaining({ index: 2, stalledCycles: 2, status: 'ready' }),
    ]);
    expect(output.supervision.cycles[1]?.nextCycleAt).toBeUndefined();
    expect(output.supervision.cycles[0]?.progressSignature).toBe(output.supervision.cycles[1]?.progressSignature);
    expect(manifest.supervisionDefaults).toEqual({
      maxErrorCycles: 3,
      maxStalledCycles: 2,
      requestedCycles: 5,
      sleepMs: 0,
    });
    expect(manifest.artifacts.supervisionRecoveryPath).toBe(output.supervisionRecoveryPath);
    expect(manifest.artifacts.supervisionFleetTriagePath).toBe(output.supervisionFleetTriagePath);
    expect(manifest.artifacts.supervisionFleetTriageResultPath).toBe(output.supervisionFleetTriageResultPath);
    expect(recovery).toEqual(expect.objectContaining({
      artifacts: expect.objectContaining({
        supervisionFleetTriagePath: output.supervisionFleetTriagePath,
        supervisionFleetTriageResultPath: output.supervisionFleetTriageResultPath,
      }),
      fleet: expect.objectContaining({ state: 'delegated_chain_ready' }),
      kind: 'agentic-coding-supervision-recovery',
      lastCycle: expect.objectContaining({ stalledCycles: 2, status: 'ready' }),
      sourceManifestPath: created.overnightManifestPath,
      stoppedReason: 'stalled',
      summary: expect.objectContaining({ completedCycles: 2, maxStalledCycles: 2 }),
    }));
    expect(recovery.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: output.supervisionEventsPath, type: 'inspect_supervision_events' }),
      expect.objectContaining({
        path: output.supervisionFleetTriageResultPath,
        type: 'inspect_fleet_triage_result',
      }),
      expect.objectContaining({
        command: ['buddy', 'autonomous-code', '--audit-overnight-manifest', created.overnightManifestPath, '--json'],
        type: 'audit_overnight_manifest',
      }),
      expect.objectContaining({
        invocation: expect.objectContaining({ tool: 'peer_chain' }),
        path: output.supervisionFleetTriagePath,
        type: 'ask_fleet_triage',
      }),
      expect.objectContaining({ command: expect.arrayContaining(['--resume-from-manifest']), type: 'resume_once' }),
      expect.objectContaining({ command: expect.arrayContaining(['--supervise-from-manifest']), type: 'restart_supervision' }),
    ]));
    const restartCommand = recovery.actions.find((action) => action.type === 'restart_supervision')?.command ?? [];
    expect(restartCommand).toEqual(expect.arrayContaining([
      '--supervision-events-file',
      output.supervisionEventsPath,
      '--supervision-recovery-file',
      output.supervisionRecoveryPath,
      '--supervision-fleet-triage-file',
      output.supervisionFleetTriagePath,
      '--supervision-fleet-triage-result-file',
      output.supervisionFleetTriageResultPath,
    ]));
    expect(manifest.superviseCommand).toEqual(expect.arrayContaining([
      '--supervision-events-file',
      output.supervisionEventsPath,
      '--supervision-recovery-file',
      output.supervisionRecoveryPath,
      '--supervision-fleet-triage-file',
      output.supervisionFleetTriagePath,
      '--supervision-fleet-triage-result-file',
      output.supervisionFleetTriageResultPath,
    ]));
    expect(triage).toEqual(expect.objectContaining({
      artifacts: expect.objectContaining({
        supervisionEventsPath: output.supervisionEventsPath,
        supervisionRecoveryPath: output.supervisionRecoveryPath,
      }),
      fleet: expect.objectContaining({ state: 'delegated_chain_ready' }),
      kind: 'agentic-coding-supervision-fleet-triage',
      lastCycle: expect.objectContaining({ stalledCycles: 2, status: 'ready' }),
      peerChainCall: expect.objectContaining({
        chainRoles: ['research', 'code', 'review', 'safe'],
        prompt: expect.stringContaining('Stopped reason: stalled'),
        tool: 'peer_chain',
      }),
      recoveryPath: output.supervisionRecoveryPath,
      sourceManifestPath: created.overnightManifestPath,
      stoppedReason: 'stalled',
    }));
    expect(triage.peerChainCall.prompt).toContain(output.supervisionEventsPath);
    expect(triageResult).toEqual(expect.objectContaining({
      error: expect.stringContaining('No fleet peers connected'),
      kind: 'agentic-coding-supervision-fleet-triage-result',
      peerChainCall: expect.objectContaining({
        promptLength: triage.peerChainCall.prompt.length,
        stageTimeoutMs: 30000,
        tool: 'peer_chain',
      }),
      success: false,
      triagePath: output.supervisionFleetTriagePath,
    }));
    expect(eventLines).toEqual([
      expect.objectContaining({
        fleet: expect.objectContaining({ expectedCollaboration: true, state: 'delegated_chain_ready' }),
        maxErrorCycles: 3,
        maxStalledCycles: 2,
      }),
      expect.objectContaining({
        fleet: expect.objectContaining({ expectedCollaboration: true, state: 'delegated_chain_ready' }),
        maxErrorCycles: 3,
        maxStalledCycles: 2,
        stoppedReason: 'stalled',
      }),
    ]);
    expect(eventLines[0]?.cycle.nextCycleAt).toEqual(expect.any(String));
    expect(eventLines[1]?.cycle.nextCycleAt).toBeUndefined();
  });

  it('can restart overnight supervision directly from a recovery handoff', async () => {
    const createProgramInstance = createProgram();
    const { taskFile } = await createTaskFile({ fleetPolicy: 'delegated-slices' });
    registerAutonomousCodeCommand(createProgramInstance);

    await createProgramInstance.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--json',
    ]);

    const created = JSON.parse(getLogOutput()) as {
      overnightManifestPath: string;
      runId: string;
    };
    consoleLogSpy.mockClear();
    const superviseProgram = createProgram();
    registerAutonomousCodeCommand(superviseProgram);

    await superviseProgram.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      created.overnightManifestPath,
      '--supervise-cycles',
      '5',
      '--supervise-sleep-ms',
      '0',
      '--supervise-max-stalled-cycles',
      '2',
      '--json',
    ]);

    const stopped = JSON.parse(getLogOutput()) as {
      supervisionEventsPath: string;
      supervisionRecoveryPath: string;
    };
    const initialEventCount = (await fs.readFile(stopped.supervisionEventsPath, 'utf8'))
      .trim()
      .split('\n')
      .length;
    consoleLogSpy.mockClear();
    const recoveryProgram = createProgram();
    registerAutonomousCodeCommand(recoveryProgram);

    await recoveryProgram.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--recover-from-supervision',
      stopped.supervisionRecoveryPath,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      overnightManifestPath: string;
      runId: string;
      supervision: {
        completedCycles: number;
        maxErrorCycles: number;
        maxStalledCycles: number;
        requestedCycles: number;
        sleepMs: number;
        sourceManifestPath: string;
        stoppedReason: string;
      };
      supervisionEventsPath: string;
      supervisionFleetTriagePath: string;
      supervisionFleetTriageResultPath: string;
      supervisionRecoveryPath: string;
      supervisionRecoverySourcePath: string;
    };
    const manifest = JSON.parse(await fs.readFile(created.overnightManifestPath, 'utf8')) as {
      artifacts: {
        supervisionEventsPath?: string;
        supervisionFleetTriagePath?: string;
        supervisionFleetTriageResultPath?: string;
        supervisionRecoveryPath?: string;
      };
      supervision: {
        completedCycles: number;
        cycles: unknown[];
        stoppedReason: string;
      };
      supervisionDefaults: { maxErrorCycles: number; maxStalledCycles: number; requestedCycles: number; sleepMs: number };
    };
    const eventLines = (await fs.readFile(stopped.supervisionEventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { stoppedReason?: string });
    consoleLogSpy.mockClear();
    const auditProgram = createProgram();
    registerAutonomousCodeCommand(auditProgram);

    await auditProgram.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--audit-overnight-manifest',
      created.overnightManifestPath,
      '--json',
    ]);

    const audit = JSON.parse(getLogOutput()) as {
      eventAudit: { eventCount: number; matchesSupervision: boolean };
    };

    expect(output.runId).toBe(created.runId);
    expect(output.overnightManifestPath).toBe(created.overnightManifestPath);
    expect(output.supervisionRecoverySourcePath).toBe(stopped.supervisionRecoveryPath);
    expect(output.supervisionEventsPath).toBe(stopped.supervisionEventsPath);
    expect(output.supervisionRecoveryPath).toBe(stopped.supervisionRecoveryPath);
    expect(output.supervisionFleetTriagePath).toBe(path.join(path.dirname(stopped.supervisionRecoveryPath), 'supervision-fleet-triage.json'));
    expect(output.supervisionFleetTriageResultPath).toBe(path.join(path.dirname(stopped.supervisionRecoveryPath), 'supervision-fleet-triage-result.json'));
    expect(output.supervision).toEqual(expect.objectContaining({
      completedCycles: 2,
      maxErrorCycles: 3,
      maxStalledCycles: 2,
      requestedCycles: 5,
      sleepMs: 0,
      sourceManifestPath: created.overnightManifestPath,
      stoppedReason: 'stalled',
    }));
    expect(manifest.artifacts.supervisionEventsPath).toBe(stopped.supervisionEventsPath);
    expect(manifest.artifacts.supervisionRecoveryPath).toBe(stopped.supervisionRecoveryPath);
    expect(manifest.artifacts.supervisionFleetTriagePath).toBe(output.supervisionFleetTriagePath);
    expect(manifest.artifacts.supervisionFleetTriageResultPath).toBe(output.supervisionFleetTriageResultPath);
    expect(manifest.supervisionDefaults).toEqual({
      maxErrorCycles: 3,
      maxStalledCycles: 2,
      requestedCycles: 5,
      sleepMs: 0,
    });
    expect(manifest.supervision).toEqual(expect.objectContaining({
      completedCycles: initialEventCount + 2,
      stoppedReason: 'stalled',
    }));
    expect(manifest.supervision.cycles).toHaveLength(initialEventCount + 2);
    expect(eventLines).toHaveLength(initialEventCount + 2);
    expect(eventLines.at(-1)).toEqual(expect.objectContaining({ stoppedReason: 'stalled' }));
    expect(audit.eventAudit).toEqual(expect.objectContaining({
      eventCount: initialEventCount + 2,
      matchesSupervision: true,
    }));
  });

  it('records supervised cycle errors and stops at the consecutive error limit', async () => {
    vi.resetModules();
    vi.doMock('../../src/agent/autonomous/agentic-coding-runner.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/agent/autonomous/agentic-coding-runner.js')>();
      return {
        ...actual,
        runAgenticCodingCell: vi.fn().mockRejectedValue(new Error('transient resume failure')),
      };
    });
    const { registerAutonomousCodeCommand: registerWithThrowingRunner } = await import(
      '../../src/commands/cli/autonomous-code-command.js'
    );
    const program = createProgram();
    const runId = 'supervision-error-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'error-overnight.json');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      autonomyPreset: 'overnight',
      runId,
    }), 'utf8');
    registerWithThrowingRunner(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--supervise-cycles',
      '4',
      '--supervise-sleep-ms',
      '0',
      '--supervise-max-error-cycles',
      '2',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    const eventsPath = path.join(path.dirname(manifestFile), 'supervision-events.jsonl');
    const eventLines = (await fs.readFile(eventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        cycle: {
          consecutiveErrorCycles: number;
          error: string;
          index: number;
          nextCycleAt?: string;
          stalledCycles: number;
          status: string;
        };
        fleet?: unknown;
        maxErrorCycles: number;
        maxStalledCycles: number;
        requestedCycles: number;
        stoppedReason?: string;
      });

    expect(errorOutput).toContain('supervision failed before producing a report');
    expect(errorOutput).toContain('transient resume failure');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      artifacts: { supervisionEventsPath?: string; supervisionRecoveryPath?: string };
      supervision: {
        completedCycles: number;
        cycles: Array<{ consecutiveErrorCycles: number; nextCycleAt?: string; status: string }>;
        maxErrorCycles: number;
        maxStalledCycles: number;
        requestedCycles: number;
        stoppedReason: string;
      };
      supervisionDefaults: { maxErrorCycles: number; maxStalledCycles: number; requestedCycles: number; sleepMs: number };
      superviseCommand: string[];
    };
    const recovery = JSON.parse(await fs.readFile(manifest.artifacts.supervisionRecoveryPath ?? '', 'utf8')) as {
      actions: Array<{ command?: string[]; invocation?: unknown; path?: string; type: string }>;
      artifacts: { supervisionEventsPath?: string; supervisionRecoveryPath?: string };
      fleet?: unknown;
      lastCycle: { consecutiveErrorCycles: number; error: string; status: string };
      stoppedReason: string;
    };
    expect(manifest.artifacts.supervisionEventsPath).toBe(eventsPath);
    expect(manifest.artifacts.supervisionRecoveryPath).toBe(path.join(path.dirname(manifestFile), 'supervision-recovery.json'));
    expect(manifest.supervision).toEqual(expect.objectContaining({
      completedCycles: 2,
      maxErrorCycles: 2,
      maxStalledCycles: 3,
      requestedCycles: 4,
      stoppedReason: 'cycle_error_limit',
    }));
    expect(manifest.supervision.cycles).toEqual([
      expect.objectContaining({
        consecutiveErrorCycles: 1,
        nextCycleAt: expect.any(String),
        status: 'cycle_error',
      }),
      expect.objectContaining({ consecutiveErrorCycles: 2, status: 'cycle_error' }),
    ]);
    expect(manifest.supervision.cycles[1]?.nextCycleAt).toBeUndefined();
    expect(manifest.supervisionDefaults).toEqual({
      maxErrorCycles: 2,
      maxStalledCycles: 3,
      requestedCycles: 4,
      sleepMs: 0,
    });
    expect(manifest.superviseCommand).toEqual(expect.arrayContaining([
      '--supervision-events-file',
      eventsPath,
      '--supervision-recovery-file',
      path.join(path.dirname(manifestFile), 'supervision-recovery.json'),
    ]));
    expect(recovery).toEqual(expect.objectContaining({
      artifacts: expect.objectContaining({
        supervisionEventsPath: eventsPath,
        supervisionRecoveryPath: path.join(path.dirname(manifestFile), 'supervision-recovery.json'),
      }),
      lastCycle: expect.objectContaining({
        consecutiveErrorCycles: 2,
        error: 'transient resume failure',
        status: 'cycle_error',
      }),
      stoppedReason: 'cycle_error_limit',
    }));
    expect(recovery.fleet).toBeUndefined();
    expect(recovery.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'inspect_supervision_events' }),
      expect.objectContaining({
        command: ['buddy', 'autonomous-code', '--audit-overnight-manifest', manifestFile, '--json'],
        type: 'audit_overnight_manifest',
      }),
      expect.objectContaining({ command: expect.arrayContaining(['--resume-from-manifest']), type: 'resume_once' }),
      expect.objectContaining({ command: expect.arrayContaining(['--supervise-from-manifest']), type: 'restart_supervision' }),
    ]));
    const restartCommand = recovery.actions.find((action) => action.type === 'restart_supervision')?.command ?? [];
    expect(restartCommand).toEqual(expect.arrayContaining([
      '--supervision-events-file',
      eventsPath,
      '--supervision-recovery-file',
      path.join(path.dirname(manifestFile), 'supervision-recovery.json'),
    ]));
    expect(recovery.actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'ask_fleet_triage' }),
    ]));
    expect(eventLines).toEqual([
      expect.objectContaining({
        cycle: expect.objectContaining({
          consecutiveErrorCycles: 1,
          error: expect.any(String),
          index: 1,
          stalledCycles: 0,
          status: 'cycle_error',
        }),
        maxErrorCycles: 2,
        maxStalledCycles: 3,
        requestedCycles: 4,
      }),
      expect.objectContaining({
        cycle: expect.objectContaining({
          consecutiveErrorCycles: 2,
          error: expect.any(String),
          index: 2,
          stalledCycles: 0,
          status: 'cycle_error',
        }),
        maxErrorCycles: 2,
        maxStalledCycles: 3,
        requestedCycles: 4,
        stoppedReason: 'cycle_error_limit',
      }),
    ]);
    expect(eventLines[0]?.cycle.nextCycleAt).toEqual(expect.any(String));
    expect(eventLines[1]?.cycle.nextCycleAt).toBeUndefined();
    expect(eventLines[0]?.fleet).toBeUndefined();
    expect(eventLines[1]?.fleet).toBeUndefined();
  });

  it('stops overnight supervision when a terminal checkpoint status is reached', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    const runId = 'terminal-supervision-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'terminal-overnight.json');

    await saveCheckpoint({
      runId,
      step: 'verified',
      timestamp: new Date().toISOString(),
      options: { runId, taskFile },
      contract: {
        repo,
        task: 'Terminal supervision.',
        allowedPaths: ['docs/...'],
        verification: [],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'none',
      },
    });
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      autonomyPreset: 'overnight',
      runId,
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--supervise-cycles',
      '3',
      '--supervise-sleep-ms',
      '0',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      status: string;
      supervision: {
        completedCycles: number;
        maxErrorCycles: number;
        requestedCycles: number;
        stoppedReason: string;
      };
      supervisionEventsPath: string;
    };
    const eventLines = (await fs.readFile(output.supervisionEventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        cycle: { index: number; status: string };
        fleet: { expectedCollaboration: boolean; state: string };
        kind: string;
        maxErrorCycles: number;
        stoppedReason?: string;
      });

    expect(output.status).toBe('verified');
    expect(output.supervision).toEqual(expect.objectContaining({
      completedCycles: 1,
      maxErrorCycles: 3,
      requestedCycles: 3,
      stoppedReason: 'terminal_status',
    }));
    expect(eventLines).toEqual([
      expect.objectContaining({
        cycle: expect.objectContaining({ index: 1, status: 'verified' }),
        fleet: expect.objectContaining({
          expectedCollaboration: false,
          state: 'disabled',
        }),
        kind: 'agentic-coding-supervision-cycle',
        maxErrorCycles: 3,
        stoppedReason: 'terminal_status',
      }),
    ]);
  });

  it('defaults manifest supervision to an eight-hour watchdog window', async () => {
    const program = createProgram();
    const { repo, taskFile } = await createTaskFile();
    const runId = 'default-supervision-run-id';
    const manifestFile = path.join(tempRoot, 'ops', 'default-supervision-overnight.json');

    await saveCheckpoint({
      runId,
      step: 'verified',
      timestamp: new Date().toISOString(),
      options: { runId, taskFile },
      contract: {
        repo,
        task: 'Default supervision.',
        allowedPaths: ['docs/...'],
        verification: [],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'none',
      },
    });
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      autonomyPreset: 'overnight',
      runId,
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      supervision: {
        completedCycles: number;
        maxErrorCycles: number;
        maxStalledCycles: number;
        requestedCycles: number;
        sleepMs: number;
        stoppedReason: string;
      };
    };
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      supervisionDefaults: { maxErrorCycles: number; maxStalledCycles: number; requestedCycles: number; sleepMs: number };
      superviseCommand: string[];
    };

    expect(output.supervision).toEqual(expect.objectContaining({
      completedCycles: 1,
      maxErrorCycles: 3,
      maxStalledCycles: 3,
      requestedCycles: 961,
      sleepMs: 30000,
      stoppedReason: 'terminal_status',
    }));
    expect(manifest.supervisionDefaults).toEqual({
      maxErrorCycles: 3,
      maxStalledCycles: 3,
      requestedCycles: 961,
      sleepMs: 30000,
    });
    expect(manifest.superviseCommand).toEqual([
      'buddy',
      'autonomous-code',
      '--supervise-from-manifest',
      manifestFile,
      '--supervise-cycles',
      '961',
      '--supervise-sleep-ms',
      '30000',
      '--supervise-max-stalled-cycles',
      '3',
      '--supervise-max-error-cycles',
      '3',
      '--json',
      '--supervision-events-file',
      path.join(path.dirname(manifestFile), 'supervision-events.jsonl'),
    ]);
  });

  it('rejects a manifest resume when --resume points at a different run id', async () => {
    const program = createProgram();
    const manifestFile = path.join(tempRoot, 'ops', 'overnight.json');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({
      kind: 'agentic-coding-overnight-manifest',
      runId: 'manifest-run-id',
    }), 'utf8');
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--resume',
      'other-run-id',
      '--resume-from-manifest',
      manifestFile,
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--resume must match the runId stored in --resume-from-manifest');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('lets explicit budget flags override the overnight autonomy preset', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'overnight',
      '--max-cost-usd',
      '1.25',
      '--max-iterations',
      '7',
      '--verification-timeout-ms',
      '1500',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      autonomyBudgets: {
        maxCostUsd: number;
        maxIterations: number;
        verificationTimeoutMs: number;
      };
      autonomyPreset: string;
      status: string;
    };

    expect(output.status).toBe('ready');
    expect(output.autonomyPreset).toBe('overnight');
    expect(output.autonomyBudgets).toEqual({
      maxCostUsd: 1.25,
      maxIterations: 7,
      verificationTimeoutMs: 1500,
    });
  });

  it('rejects unknown autonomy presets', async () => {
    const program = createProgram();
    const { taskFile } = await createTaskFile();
    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--task-file',
      taskFile,
      '--autonomy-preset',
      'marathon',
      '--json',
    ]);

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).toContain('--autonomy-preset must be one of: standard, overnight');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('can resume a run using --resume <runId>', async () => {
    const program = createProgram();
    const { repo } = await createTaskFile();
    
    // Save a completed/verified checkpoint to resume from
    await saveCheckpoint({
      runId: 'cli-resume-run-id',
      step: 'verified',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json' },
      contract: {
        repo,
        task: 'Do task',
        allowedPaths: ['file.ts'],
        verification: [],
        riskLevel: 'low',
        edits: [],
        maxFilesChanged: 5,
        maxToolRounds: 5,
        memoryPolicy: 'none',
        fleetPolicy: 'none',
      },
    });

    registerAutonomousCodeCommand(program);

    await program.parseAsync([
      'node',
      'test',
      'autonomous-code',
      '--resume',
      'cli-resume-run-id',
      '--json',
    ]);

    const logOutput = getLogOutput();
    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    if (errorOutput) {
      console.log('--- CLI ERROR OUTPUT ---');
      console.log(errorOutput);
      console.log('------------------------');
    }

    const output = JSON.parse(logOutput) as {
      status: string;
      autoExecutable: boolean;
    };

    expect(output.status).toBe('verified');
    expect(output.autoExecutable).toBe(true);
  });
});
