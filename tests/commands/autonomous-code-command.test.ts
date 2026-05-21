import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAutonomousCodeCommand } from '../../src/commands/cli/autonomous-code-command.js';

const execFileAsync = promisify(execFile);

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

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

describe('autonomous-code CLI command', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-autonomous-code-cli-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
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
        activeNodeId: string;
        activePosition: { x: number; y: number };
        bounds: { height: number; maxX: number; maxY: number; minX: number; minY: number; width: number };
        center: { x: number; y: number };
        edgeCount: number;
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
      activeNodeId: 'review-preview',
      activePosition: { x: 250, y: 650 },
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
});
