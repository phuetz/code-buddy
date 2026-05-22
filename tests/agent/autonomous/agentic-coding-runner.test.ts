import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildAgenticCodingApprovalSnapshot,
  buildAgenticCodingEditProposalProducerDispatch,
  buildAgenticCodingEditProposalReviewSnapshot,
  buildAgenticCodingEditProposalRequest,
  buildAgenticCodingProposalLoopArtifactBundle,
  buildAgenticCodingProposalLoopCanvas,
  buildAgenticCodingProposalLoopCoworkImport,
  buildAgenticCodingProposalLoopCoworkImportCheck,
  buildAgenticCodingProposalLoopCoworkWorkspace,
  buildAgenticCodingProposalLoopNextActionSnapshot,
  buildAgenticCodingProposalLoopSnapshot,
  buildAgenticCodingWorkflowBuilderProposalCanvas,
  buildAgenticCodingWorkflowCanvas,
  buildAgenticCodingWorkflowEventsSnapshot,
  buildAgenticCodingWorkflowProgressSnapshot,
  renderAgenticCodingApprovalDecisionPrompt,
  renderAgenticCodingEditProposalPrompt,
  renderAgenticCodingWorkflowBuilderPrompt,
  runAgenticCodingCell,
  writeAgenticCodingApprovalDecisionPrompt,
  writeAgenticCodingApprovalSnapshot,
  writeAgenticCodingEditProposalProducerDispatch,
  writeAgenticCodingEditProposalReviewSnapshot,
  writeAgenticCodingEditProposalPrompt,
  writeAgenticCodingProposalLoopArtifactBundle,
  writeAgenticCodingProposalLoopCanvas,
  writeAgenticCodingProposalLoopCoworkImport,
  writeAgenticCodingProposalLoopCoworkImportCheck,
  writeAgenticCodingProposalLoopCoworkWorkspace,
  writeAgenticCodingProposalLoopNextActionSnapshot,
  writeAgenticCodingProposalLoopSnapshot,
  writeAgenticCodingRunReport,
  writeAgenticCodingWorkflowBuilderPrompt,
  writeAgenticCodingWorkflowBuilderProposalCanvas,
  writeAgenticCodingWorkflowCanvas,
  writeAgenticCodingWorkflowEventsSnapshot,
  writeAgenticCodingWorkflowProgressSnapshot,
} from '../../../src/agent/autonomous/agentic-coding-runner.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;

async function createTempGitRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(tempRoot, 'repo-'));
  await execFileAsync('git', ['init'], { cwd: repo });
  return repo;
}

async function writeTaskFile(task: Record<string, unknown>): Promise<string> {
  const taskFile = path.join(tempRoot, `task-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(taskFile, JSON.stringify(task, null, 2), 'utf8');
  return taskFile;
}

async function writeEditProposalFile(proposal: Record<string, unknown>): Promise<string> {
  const proposalFile = path.join(tempRoot, `proposal-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(proposalFile, JSON.stringify(proposal, null, 2), 'utf8');
  return proposalFile;
}

async function writeApprovalDecisionFile(decision: Record<string, unknown>): Promise<string> {
  const decisionFile = path.join(tempRoot, `approval-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(decisionFile, JSON.stringify(decision, null, 2), 'utf8');
  return decisionFile;
}

function taskFor(repo: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    repo,
    task: 'Run a bounded Agentic Coding Cell preflight.',
    allowedPaths: ['docs/...'],
    verification: ['node -e "console.log(123)"'],
    riskLevel: 'low',
    ...overrides,
  };
}

describe('runAgenticCodingCell', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-agentic-cell-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { force: true, recursive: true });
  });

  it('returns ready after contract validation and clean git preflight', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));

    const report = await runAgenticCodingCell({ generatedAt: '2026-05-19T00:00:00.000Z', taskFile });

    expect(report.status).toBe('ready');
    expect(report.approval).toEqual({
      reason: 'No scoped edits were declared.',
      requiredBeforeApply: false,
      state: 'not_required',
    });
    expect(report.autoExecutable).toBe(true);
    expect(report.blockedReasons).toEqual([]);
    expect(report.contract?.allowedPaths).toEqual(['docs/...']);
    expect(report.gitStatus).toContain('##');
    expect(report.rulesFiles).toEqual([
      { path: 'AGENTS.md', present: false },
      { path: 'CLAUDE.md', present: false },
      { path: 'COLAB.md', present: false },
      { path: 'README.md', present: false },
    ]);
    expect(report.plan).toEqual([
      expect.objectContaining({ id: 'contract', status: 'completed' }),
      expect.objectContaining({ id: 'workspace-rules', status: 'completed' }),
      expect.objectContaining({ id: 'git-preflight', status: 'completed' }),
      expect.objectContaining({ id: 'safety-gate', status: 'completed' }),
      expect.objectContaining({ id: 'understanding', status: 'ready' }),
      expect.objectContaining({ id: 'behavior-lock', status: 'ready' }),
      expect.objectContaining({ id: 'edit-proposal', status: 'pending' }),
      expect.objectContaining({ id: 'edit-preview', status: 'pending' }),
      expect.objectContaining({ id: 'approval-decision', status: 'pending' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'pending' }),
      expect.objectContaining({ id: 'verification', status: 'pending' }),
      expect.objectContaining({ id: 'handoff', status: 'pending' }),
    ]);
    expect(report.workflow).toEqual(expect.objectContaining({
      activeNodeId: 'understanding',
      blockedNodeIds: [],
      completedNodeIds: ['contract', 'workspace-rules', 'git-preflight', 'safety-gate'],
      edges: expect.arrayContaining([
        expect.objectContaining({
          id: 'edge-contract-workspace-rules',
          source: 'contract',
          target: 'workspace-rules',
        }),
      ]),
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'safety-gate',
          label: 'Apply V0 safety gate',
          type: 'gate',
        }),
        expect.objectContaining({
          id: 'scoped-edit',
          label: 'Apply scoped edits',
          type: 'edit',
        }),
      ]),
    }));
    expect(report.editRequested).toBe(false);
    expect(report.editResults).toEqual([]);
  });

  it('blocks when the worktree has dirty files outside allowedPaths', async () => {
    const repo = await createTempGitRepo();
    await fs.writeFile(path.join(repo, 'package.json'), '{}\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));

    const report = await runAgenticCodingCell({ taskFile });

    expect(report.status).toBe('blocked');
    expect(report.autoExecutable).toBe(false);
    expect(report.dirtyFiles).toEqual([
      { allowed: false, path: 'package.json', status: '??' },
    ]);
    expect(report.blockedReasons).toEqual(['dirty files outside allowedPaths: package.json']);
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'git-preflight', status: 'blocked' }),
      expect.objectContaining({ id: 'safety-gate', status: 'blocked' }),
      expect.objectContaining({ id: 'understanding', status: 'pending' }),
    ]));
    expect(report.workflow.activeNodeId).toBe('git-preflight');
    expect(report.workflow.blockedNodeIds).toEqual(['git-preflight', 'safety-gate']);
    expect(report.workflow.nodeErrors).toEqual([
      {
        message: 'Dirty files outside allowedPaths: package.json.',
        nodeId: 'git-preflight',
      },
      {
        message: 'dirty files outside allowedPaths: package.json',
        nodeId: 'safety-gate',
      },
    ]);
    expect(buildAgenticCodingWorkflowCanvas(report).nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessages: ['Dirty files outside allowedPaths: package.json.'],
        }),
        id: 'git-preflight',
      }),
    ]));
  });

  it('runs verification only when requested and preflight passes', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));

    const report = await runAgenticCodingCell({ runVerification: true, taskFile });

    expect(report.status).toBe('verified');
    expect(report.verification).toEqual([
      expect.objectContaining({
        command: 'node -e "console.log(123)"',
        exitCode: 0,
        status: 'passed',
      }),
    ]);
    expect(report.verification[0]?.stdout).toContain('123');
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'verification', status: 'completed' }),
      expect.objectContaining({ id: 'handoff', status: 'completed' }),
    ]));
  });

  it('applies declared scoped edits when requested', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ applyEdits: true, taskFile });
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('edited');
    expect(report.approval).toEqual({
      reason: 'Scoped edits were applied after validation and preflight.',
      requiredBeforeApply: false,
      state: 'approved',
    });
    expect(report.editRequested).toBe(true);
    expect(report.editResults).toEqual([
      { occurrences: 1, path: 'docs/note.md', status: 'applied' },
    ]);
    expect(edited).toBe('after\n');
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'scoped-edit', status: 'completed' }),
      expect.objectContaining({ id: 'verification', status: 'pending' }),
    ]));
  });

  it('previews declared scoped edits without writing files', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('previewed');
    expect(report.approval).toEqual({
      reason: 'Scoped edit preview is ready for human or Cowork approval before applying.',
      requiredBeforeApply: false,
      state: 'needs_approval',
    });
    expect(report.editPreviewRequested).toBe(true);
    expect(report.editPreviews).toEqual([
      {
        after: 'after\n',
        before: 'before\n',
        occurrences: 1,
        path: 'docs/note.md',
        status: 'previewed',
      },
    ]);
    expect(report.editResults).toEqual([]);
    expect(unchanged).toBe('before\n');
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edit-preview', status: 'completed' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'ready' }),
    ]));
    expect(report.workflow.activeNodeId).toBe('approval-decision');
    expect(report.workflow.completedNodeIds).toContain('edit-preview');
  });

  it('requires a successful preview before applying edits when requested', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ applyEdits: true, requirePreview: true, taskFile });
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('edited');
    expect(report.approval).toEqual({
      reason: 'Scoped edits were applied after validation and preflight.',
      requiredBeforeApply: true,
      state: 'approved',
    });
    expect(report.editPreviewRequired).toBe(true);
    expect(report.editPreviewRequested).toBe(true);
    expect(report.editPreviews).toEqual([
      expect.objectContaining({
        after: 'after\n',
        before: 'before\n',
        path: 'docs/note.md',
        status: 'previewed',
      }),
    ]);
    expect(report.editResults).toEqual([
      { occurrences: 1, path: 'docs/note.md', status: 'applied' },
    ]);
    expect(edited).toBe('after\n');
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edit-preview', status: 'completed' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'completed' }),
    ]));
  });

  it('blocks apply when an approval decision is required but missing', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ applyEdits: true, requireApproval: true, taskFile });
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('blocked');
    expect(report.approval).toEqual({
      reason: 'Preflight blocked scoped edits: approval decision file is required before applying scoped edits',
      requiredBeforeApply: true,
      state: 'rejected',
    });
    expect(report.editPreviews).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'previewed' }),
    ]);
    expect(report.editResults).toEqual([]);
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edit-preview', status: 'completed' }),
      expect.objectContaining({ id: 'approval-decision', status: 'blocked' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'pending' }),
    ]));
    expect(unchanged).toBe('before\n');
  });

  it('applies edits only after a controlled approval decision when required', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));
    const approvalDecisionFile = await writeApprovalDecisionFile({
      kind: 'agentic-coding-approval-decision',
      schemaVersion: 1,
      decision: 'approved',
      reviewer: 'patrice',
      reason: 'Preview reviewed in Cowork.',
    });

    const report = await runAgenticCodingCell({
      applyEdits: true,
      approvalDecisionFile,
      requireApproval: true,
      taskFile,
    });
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('edited');
    expect(report.approval).toEqual({
      reason: 'Scoped edit preview approved by patrice: Preview reviewed in Cowork.',
      requiredBeforeApply: true,
      state: 'approved',
    });
    expect(report.approvalDecision).toEqual({
      decision: 'approved',
      file: approvalDecisionFile,
      reason: 'Preview reviewed in Cowork.',
      reviewer: 'patrice',
    });
    expect(report.editPreviews).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'previewed' }),
    ]);
    expect(report.editResults).toEqual([
      { occurrences: 1, path: 'docs/note.md', status: 'applied' },
    ]);
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approval-decision', status: 'completed' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'completed' }),
    ]));
    expect(edited).toBe('after\n');
  });

  it('does not write files when the required preview fails', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ applyEdits: true, requirePreview: true, taskFile });
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('blocked');
    expect(report.approval).toEqual({
      reason: 'Scoped edit preview failed for docs/note.md: expected 1 occurrence(s), found 2',
      requiredBeforeApply: true,
      state: 'rejected',
    });
    expect(report.editPreviewRequired).toBe(true);
    expect(report.blockedReasons).toEqual([
      'scoped edit preview failed: docs/note.md (expected 1 occurrence(s), found 2)',
    ]);
    expect(report.editPreviews).toEqual([
      expect.objectContaining({
        occurrences: 2,
        path: 'docs/note.md',
        reason: 'expected 1 occurrence(s), found 2',
        status: 'blocked',
      }),
    ]);
    expect(report.editResults).toEqual([]);
    expect(unchanged).toBe('before before\n');
  });

  it('loads a controlled edit proposal file before applying edits', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'Replace the placeholder documentation word.',
      producer: 'unit-test-agent',
      risks: ['Only touches docs/note.md.'],
      verificationNotes: ['Read docs/note.md after applying.'],
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    });

    const report = await runAgenticCodingCell({
      applyEdits: true,
      editProposalFile,
      taskFile,
    });
    const edited = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('edited');
    expect(report.contract?.edits).toEqual([
      expect.objectContaining({ path: 'docs/note.md', replace: 'after' }),
    ]);
    expect(report.editProposal).toEqual({
      editCount: 1,
      file: editProposalFile,
      producer: 'unit-test-agent',
      risks: ['Only touches docs/note.md.'],
      summary: 'Replace the placeholder documentation word.',
      verificationNotes: ['Read docs/note.md after applying.'],
    });
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edit-proposal', status: 'completed' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'completed' }),
    ]));
    expect(edited).toBe('after\n');
  });

  it('previews a controlled edit proposal file without writing files', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'Preview the documentation replacement.',
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    });

    const report = await runAgenticCodingCell({
      editProposalFile,
      previewEdits: true,
      taskFile,
    });
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('previewed');
    expect(report.editProposal).toEqual(expect.objectContaining({
      editCount: 1,
      summary: 'Preview the documentation replacement.',
    }));
    expect(report.editPreviews).toEqual([
      expect.objectContaining({
        after: 'after\n',
        before: 'before\n',
        path: 'docs/note.md',
        status: 'previewed',
      }),
    ]);
    expect(unchanged).toBe('before\n');
  });

  it('blocks edit preview when the expected occurrence count does not match', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('blocked');
    expect(report.approval).toEqual({
      reason: 'Scoped edit preview failed for docs/note.md: expected 1 occurrence(s), found 2',
      requiredBeforeApply: false,
      state: 'rejected',
    });
    expect(report.blockedReasons).toEqual([
      'scoped edit preview failed: docs/note.md (expected 1 occurrence(s), found 2)',
    ]);
    expect(report.editPreviews).toEqual([
      expect.objectContaining({
        occurrences: 2,
        path: 'docs/note.md',
        reason: 'expected 1 occurrence(s), found 2',
        status: 'blocked',
      }),
    ]);
    expect(unchanged).toBe('before before\n');
  });

  it('fails validation for malformed edit proposal files before applying edits', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'No concrete edits.',
      edits: [],
    });

    const report = await runAgenticCodingCell({
      applyEdits: true,
      editProposalFile,
      taskFile,
    });
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('validation_failed');
    expect(report.approval.state).toBe('rejected');
    expect(report.validationErrors).toContain(
      'editProposalFile: edits: Array must contain at least 1 element(s)'
    );
    expect(report.editResults).toEqual([]);
    expect(unchanged).toBe('before\n');
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'contract', status: 'blocked' }),
      expect.objectContaining({ id: 'scoped-edit', status: 'pending' }),
    ]));
  });

  it('blocks proposal edits outside allowedPaths before file writes', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'src'), { recursive: true });
    await fs.writeFile(path.join(repo, 'src', 'outside.ts'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'Try to edit outside docs.',
      edits: [{
        type: 'replace_text',
        path: 'src/outside.ts',
        find: 'before',
        replace: 'after',
      }],
    });

    const report = await runAgenticCodingCell({
      applyEdits: true,
      editProposalFile,
      taskFile,
    });
    const unchanged = await fs.readFile(path.join(repo, 'src', 'outside.ts'), 'utf8');

    expect(report.status).toBe('blocked');
    expect(report.blockedReasons).toContain('declared edit paths outside allowedPaths: src/outside.ts');
    expect(report.editResults).toEqual([]);
    expect(unchanged).toBe('before\n');
  });

  it('blocks declared edits outside allowedPaths', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'src/outside.ts',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ applyEdits: true, taskFile });

    expect(report.status).toBe('blocked');
    expect(report.editResults).toEqual([]);
    expect(report.blockedReasons).toEqual([
      'declared edit paths outside allowedPaths: src/outside.ts',
    ]);
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'scoped-edit', status: 'pending' }),
    ]));
  });

  it('blocks declared edits when the expected occurrence count does not match', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        type: 'replace_text',
        path: 'docs/note.md',
        find: 'before',
        replace: 'after',
      }],
    }));

    const report = await runAgenticCodingCell({ applyEdits: true, taskFile });
    const unchanged = await fs.readFile(path.join(repo, 'docs', 'note.md'), 'utf8');

    expect(report.status).toBe('blocked');
    expect(report.editResults).toEqual([
      expect.objectContaining({
        occurrences: 2,
        path: 'docs/note.md',
        reason: 'expected 1 occurrence(s), found 2',
        status: 'blocked',
      }),
    ]);
    expect(unchanged).toBe('before before\n');
  });

  it('blocks dangerous verification commands instead of executing them', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo, {
      verification: ['rm -rf /'],
    }));

    const report = await runAgenticCodingCell({ runVerification: true, taskFile });

    expect(report.status).toBe('blocked');
    expect(report.verification).toEqual([
      expect.objectContaining({
        command: 'rm -rf /',
        exitCode: 1,
        status: 'blocked',
      }),
    ]);
    expect(report.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'verification', status: 'blocked' }),
      expect.objectContaining({ id: 'handoff', status: 'pending' }),
    ]));
  });

  it('writes a JSON run report artifact', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));
    const report = await runAgenticCodingCell({ taskFile });
    const reportFile = path.join(tempRoot, 'reports', 'agentic-cell-report.json');

    const writtenPath = await writeAgenticCodingRunReport(report, reportFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as { status: string; plan: unknown[] };

    expect(writtenPath).toBe(reportFile);
    expect(saved.status).toBe('ready');
    expect(saved.plan.length).toBeGreaterThan(0);
  });

  it('builds and writes a PostCommander-style workflow canvas artifact', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));
    const report = await runAgenticCodingCell({ taskFile });
    const workflowFile = path.join(tempRoot, 'workflows', 'agentic-cell-workflow.json');

    const canvas = buildAgenticCodingWorkflowCanvas(report);
    const writtenPath = await writeAgenticCodingWorkflowCanvas(report, workflowFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof canvas;

    expect(canvas.kind).toBe('agentic-coding-workflow-canvas');
    expect(canvas.source.status).toBe('ready');
    expect(canvas.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({
          iconName: 'ShieldCheck',
          label: 'Validate task contract',
          type: 'trigger',
        }),
        id: 'contract',
        position: { x: 250, y: 50 },
        type: 'customNode',
      }),
      expect.objectContaining({
        data: expect.objectContaining({
          agenticType: 'approval',
          type: 'logic',
        }),
        id: 'edit-preview',
      }),
    ]));
    expect(canvas.edges[0]).toEqual({
      animated: true,
      id: 'edge-contract-workspace-rules',
      source: 'contract',
      style: { stroke: '#8b5cf6', strokeWidth: 2 },
      target: 'workspace-rules',
    });
    expect(writtenPath).toBe(workflowFile);
    expect(saved).toEqual(canvas);
  });

  it('builds and writes a compact workflow progress snapshot', async () => {
    const repo = await createTempGitRepo();
    await fs.writeFile(path.join(repo, 'package.json'), '{}\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const progressFile = path.join(tempRoot, 'workflows', 'agentic-cell-progress.json');
    const report = await runAgenticCodingCell({ taskFile });

    const progress = buildAgenticCodingWorkflowProgressSnapshot(report);
    const writtenPath = await writeAgenticCodingWorkflowProgressSnapshot(report, progressFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof progress;

    expect(progress).toEqual(expect.objectContaining({
      activeNodeId: 'git-preflight',
      approvalState: 'not_required',
      kind: 'agentic-coding-workflow-progress',
      nextAction: {
        message: 'Dirty files outside allowedPaths: package.json.',
        nodeId: 'git-preflight',
        type: 'inspect_blocker',
      },
    }));
    expect(progress.counts).toEqual({
      blocked: 2,
      completed: 2,
      pending: 8,
      ready: 0,
      skipped: 0,
      total: 12,
    });
    expect(progress.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        errorMessages: ['Dirty files outside allowedPaths: package.json.'],
        id: 'git-preflight',
        status: 'blocked',
      }),
    ]));
    expect(writtenPath).toBe(progressFile);
    expect(saved).toEqual(progress);
  });

  it('builds and writes a compact workflow event timeline', async () => {
    const repo = await createTempGitRepo();
    await fs.writeFile(path.join(repo, 'package.json'), '{}\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const eventsFile = path.join(tempRoot, 'workflows', 'agentic-cell-events.json');
    const report = await runAgenticCodingCell({ taskFile });

    const events = buildAgenticCodingWorkflowEventsSnapshot(report);
    const writtenPath = await writeAgenticCodingWorkflowEventsSnapshot(report, eventsFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof events;

    expect(events).toEqual(expect.objectContaining({
      activeNodeId: 'git-preflight',
      kind: 'agentic-coding-workflow-events',
    }));
    expect(events.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        message: 'Dirty files outside allowedPaths: package.json.',
        nodeId: 'git-preflight',
        nodeType: 'gate',
        sequence: 3,
        severity: 'error',
        status: 'blocked',
      }),
      expect.objectContaining({
        nodeId: 'contract',
        sequence: 1,
        severity: 'success',
        status: 'completed',
      }),
    ]));
    expect(writtenPath).toBe(eventsFile);
    expect(saved).toEqual(events);
  });

  it('builds and writes a compact approval snapshot for Cowork', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before\n',
        path: 'docs/note.md',
        replace: 'after\n',
        type: 'replace_text',
      }],
    }));
    const approvalFile = path.join(tempRoot, 'approvals', 'agentic-cell-approval.json');
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });

    const approval = buildAgenticCodingApprovalSnapshot(report);
    const writtenPath = await writeAgenticCodingApprovalSnapshot(report, approvalFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof approval;

    expect(approval).toEqual(expect.objectContaining({
      kind: 'agentic-coding-approval-state',
      nextAction: {
        message: 'Scoped edit preview is ready for human or Cowork approval before applying.',
        nodeId: 'edit-preview',
        type: 'review_preview',
      },
      state: 'needs_approval',
    }));
    expect(approval.editSummary).toEqual({
      applied: 0,
      blocked: 0,
      declared: 1,
      files: ['docs/note.md'],
      previewed: 1,
    });
    expect(approval.gateNodeIds).toEqual(expect.arrayContaining(['edit-preview']));
    expect(approval.source.activeNodeId).toBe('approval-decision');
    expect(writtenPath).toBe(approvalFile);
    expect(saved).toEqual(approval);
  });

  it('builds and writes an accepted edit proposal review snapshot for Cowork', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'Update the docs note.',
      edits: [{
        expectedOccurrences: 1,
        find: 'before\n',
        path: 'docs/note.md',
        replace: 'after\n',
        type: 'replace_text',
      }],
      producer: 'agent-producer',
      risks: ['none'],
      verificationNotes: ['Run the declared verification.'],
    });
    const report = await runAgenticCodingCell({ editProposalFile, taskFile });
    const reviewFile = path.join(tempRoot, 'reviews', 'edit-proposal-review.json');

    const review = buildAgenticCodingEditProposalReviewSnapshot(report);
    const writtenPath = await writeAgenticCodingEditProposalReviewSnapshot(report, reviewFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof review;

    expect(review).toEqual(expect.objectContaining({
      kind: 'agentic-coding-edit-proposal-review',
      nextAction: {
        message: 'Controlled edit proposal is valid; run preview before requesting approval.',
        stepId: 'preview-scoped-edits',
        type: 'preview_edits',
      },
      reason: 'Accepted 1 controlled edit proposal item(s).',
      state: 'accepted',
      validationErrors: [],
    }));
    expect(review.editSummary).toEqual({
      declared: 1,
      files: ['docs/note.md'],
      proposal: expect.objectContaining({
        editCount: 1,
        file: editProposalFile,
        producer: 'agent-producer',
        summary: 'Update the docs note.',
      }),
    });
    expect(review.source.proposalFile).toBe(editProposalFile);
    expect(writtenPath).toBe(reviewFile);
    expect(saved).toEqual(review);
  });

  it('builds a rejected edit proposal review snapshot for malformed producer output', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'No concrete edits.',
      edits: [],
    });
    const report = await runAgenticCodingCell({ editProposalFile, taskFile });

    const review = buildAgenticCodingEditProposalReviewSnapshot(report);

    expect(review).toEqual(expect.objectContaining({
      editSummary: {
        declared: 0,
        files: [],
      },
      kind: 'agentic-coding-edit-proposal-review',
      nextAction: {
        message: 'Fix the controlled edit proposal JSON before previewing.',
        stepId: 'produce-edit-proposal',
        type: 'fix_edit_proposal',
      },
      state: 'rejected',
      validationErrors: ['editProposalFile: edits: Array must contain at least 1 element(s)'],
    }));
    expect(review.reason).toContain('editProposalFile: edits: Array must contain at least 1 element(s)');
  });

  it('renders and writes a constrained approval decision prompt artifact', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before\n',
        path: 'docs/note.md',
        replace: 'after\n',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const promptFile = path.join(tempRoot, 'prompts', 'approval-decision-prompt.md');

    const prompt = renderAgenticCodingApprovalDecisionPrompt(report);
    const writtenPath = await writeAgenticCodingApprovalDecisionPrompt(report, promptFile);
    const saved = await fs.readFile(writtenPath, 'utf8');

    expect(prompt).toContain('Return only valid JSON');
    expect(prompt).toContain('agentic-coding-approval-decision');
    expect(prompt).toContain('Scoped edit previews:');
    expect(prompt).toContain('docs/note.md');
    expect(prompt).toContain('Before:');
    expect(prompt).toContain('After:');
    expect(prompt).toContain('Current approval state:');
    expect(writtenPath).toBe(promptFile);
    expect(saved).toContain('You are reviewing an Agentic Coding Cell scoped edit preview.');
    expect(saved).toContain('Use decision "approved"');
  });

  it('builds and writes a Cowork proposal loop packet', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before\n',
        path: 'docs/note.md',
        replace: 'after\n',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const loopFile = path.join(tempRoot, 'loop', 'proposal-loop.json');
    const artifacts = {
      applyReportFile: path.join(tempRoot, 'loop', 'apply-report.json'),
      approvalDecisionFile: path.join(tempRoot, 'loop', 'approval-decision.json'),
      approvalDecisionPromptFile: path.join(tempRoot, 'loop', 'approval-decision-prompt.md'),
      approvalFile: path.join(tempRoot, 'loop', 'approval-state.json'),
      editProposalFile: path.join(tempRoot, 'loop', 'edit-proposal.json'),
      editProposalProducerDispatchFile: path.join(tempRoot, 'loop', 'edit-proposal-producer-dispatch.json'),
      editProposalReviewFile: path.join(tempRoot, 'loop', 'edit-proposal-review.json'),
      previewReportFile: path.join(tempRoot, 'loop', 'preview-report.json'),
      proposalPromptFile: path.join(tempRoot, 'loop', 'edit-proposal-prompt.md'),
      workflowEventsFile: path.join(tempRoot, 'loop', 'workflow-events.json'),
      workflowProgressFile: path.join(tempRoot, 'loop', 'workflow-progress.json'),
    };

    const loop = buildAgenticCodingProposalLoopSnapshot(report, artifacts);
    const writtenPath = await writeAgenticCodingProposalLoopSnapshot(report, loopFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof loop;

    expect(loop).toEqual(expect.objectContaining({
      activeStepId: 'review-preview',
      blockedStepIds: [],
      completedStepIds: [
        'prepare-edit-proposal-prompt',
        'produce-edit-proposal',
        'review-edit-proposal',
        'preview-scoped-edits',
      ],
      counts: {
        blocked: 0,
        completed: 4,
        pending: 3,
        ready: 1,
        skipped: 0,
        total: 8,
      },
      events: expect.arrayContaining([
        expect.objectContaining({
          active: true,
          message: 'Review the scoped edit preview and write an approval decision JSON file.',
          sequence: 5,
          severity: 'warning',
          status: 'ready',
          stepId: 'review-preview',
        }),
        expect.objectContaining({
          sequence: 1,
          severity: 'success',
          status: 'completed',
          stepId: 'prepare-edit-proposal-prompt',
        }),
      ]),
      kind: 'agentic-coding-proposal-loop',
      nextAction: {
        message: 'Review the scoped edit preview and write an approval decision JSON file.',
        stepId: 'review-preview',
        type: 'review_preview',
      },
      edges: expect.arrayContaining([
        expect.objectContaining({
          id: 'proposal-loop-edge-produce-edit-proposal-review-edit-proposal',
          source: 'produce-edit-proposal',
          target: 'review-edit-proposal',
        }),
        expect.objectContaining({
          id: 'proposal-loop-edge-review-edit-proposal-preview-scoped-edits',
          source: 'review-edit-proposal',
          target: 'preview-scoped-edits',
        }),
        expect.objectContaining({
          id: 'proposal-loop-edge-preview-scoped-edits-review-preview',
          source: 'preview-scoped-edits',
          target: 'review-preview',
        }),
      ]),
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'review-edit-proposal',
          status: 'completed',
          type: 'analysis',
        }),
        expect.objectContaining({
          id: 'review-preview',
          status: 'ready',
          type: 'approval',
        }),
        expect.objectContaining({
          id: 'run-verification',
          type: 'verification',
        }),
      ]),
    }));
    expect(loop.prompts.editProposal).toContain('controlled edit proposal');
    expect(loop.prompts.approvalDecision).toContain('agentic-coding-approval-decision');
    expect(loop.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'preview-scoped-edits',
        outputArtifacts: expect.arrayContaining([artifacts.approvalDecisionPromptFile]),
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'review-preview',
        outputArtifacts: [artifacts.approvalDecisionFile],
        status: 'ready',
      }),
      expect.objectContaining({
        command: expect.objectContaining({
          args: expect.arrayContaining(['--require-approval', '--apply-edits']),
        }),
        id: 'apply-approved-edits',
      }),
    ]));
    expect(writtenPath).toBe(loopFile);
    expect(saved.activeStepId).toBe('review-preview');
    expect(saved.kind).toBe('agentic-coding-proposal-loop');
    expect(saved.counts.ready).toBe(1);
    expect(saved.completedStepIds).toEqual([
      'prepare-edit-proposal-prompt',
      'produce-edit-proposal',
      'review-edit-proposal',
      'preview-scoped-edits',
    ]);
    expect(saved.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'review-preview', type: 'approval' }),
    ]));
    expect(saved.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'review-preview', target: 'apply-approved-edits' }),
    ]));
    expect(saved.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        stepId: 'review-preview',
      }),
    ]));
    expect(saved.artifacts.editProposalFile).toBe(path.join(path.dirname(loopFile), 'edit-proposal.json'));
    expect(saved.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: expect.objectContaining({
          args: expect.arrayContaining(['--edit-proposal-review-file']),
        }),
        id: 'review-edit-proposal',
        outputArtifacts: [path.join(path.dirname(loopFile), 'edit-proposal-review.json')],
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'preview-scoped-edits',
        inputArtifacts: expect.arrayContaining([path.join(path.dirname(loopFile), 'edit-proposal-review.json')]),
        outputArtifacts: expect.arrayContaining([path.join(path.dirname(loopFile), 'approval-decision-prompt.md')]),
      }),
    ]));
  });

  it('activates producer-output review before previewing a generated edit proposal', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'Update docs note.',
      edits: [{
        expectedOccurrences: 1,
        find: 'before\n',
        path: 'docs/note.md',
        replace: 'after\n',
        type: 'replace_text',
      }],
      producer: 'agent-producer',
    });
    const report = await runAgenticCodingCell({ editProposalFile, taskFile });
    const artifacts = {
      applyReportFile: path.join(tempRoot, 'loop', 'apply-report.json'),
      approvalDecisionFile: path.join(tempRoot, 'loop', 'approval-decision.json'),
      approvalDecisionPromptFile: path.join(tempRoot, 'loop', 'approval-decision-prompt.md'),
      approvalFile: path.join(tempRoot, 'loop', 'approval-state.json'),
      editProposalFile: path.join(tempRoot, 'loop', 'edit-proposal.json'),
      editProposalProducerDispatchFile: path.join(tempRoot, 'loop', 'edit-proposal-producer-dispatch.json'),
      editProposalReviewFile: path.join(tempRoot, 'loop', 'edit-proposal-review.json'),
      previewReportFile: path.join(tempRoot, 'loop', 'preview-report.json'),
      proposalPromptFile: path.join(tempRoot, 'loop', 'edit-proposal-prompt.md'),
      workflowEventsFile: path.join(tempRoot, 'loop', 'workflow-events.json'),
      workflowProgressFile: path.join(tempRoot, 'loop', 'workflow-progress.json'),
    };

    const loop = buildAgenticCodingProposalLoopSnapshot(report, artifacts);
    const nextActionFile = path.join(tempRoot, 'loop', 'proposal-loop-next-action.json');

    expect(loop).toEqual(expect.objectContaining({
      activeStepId: 'review-edit-proposal',
      completedStepIds: ['prepare-edit-proposal-prompt', 'produce-edit-proposal'],
      counts: expect.objectContaining({
        completed: 2,
        pending: 5,
        ready: 1,
        total: 8,
      }),
      nextAction: {
        message: 'Review the controlled edit proposal output before previewing.',
        stepId: 'review-edit-proposal',
        type: 'review_edit_proposal',
      },
    }));
    expect(loop.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'review-edit-proposal',
        status: 'ready',
      }),
      expect.objectContaining({
        id: 'preview-scoped-edits',
        status: 'pending',
      }),
    ]));

    const nextAction = buildAgenticCodingProposalLoopNextActionSnapshot(report, artifacts);
    const writtenPath = await writeAgenticCodingProposalLoopNextActionSnapshot(report, nextActionFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof nextAction;

    expect(nextAction).toEqual(expect.objectContaining({
      activeStep: expect.objectContaining({
        command: expect.objectContaining({
          args: expect.arrayContaining(['--edit-proposal-review-file', artifacts.editProposalReviewFile]),
        }),
        id: 'review-edit-proposal',
        status: 'ready',
      }),
      canRunCommand: true,
      kind: 'agentic-coding-proposal-loop-next-action',
      nextAction: {
        message: 'Review the controlled edit proposal output before previewing.',
        stepId: 'review-edit-proposal',
        type: 'review_edit_proposal',
      },
      runState: 'ready_command',
      ui: expect.objectContaining({
        artifactHints: expect.objectContaining({
          outputArtifacts: expect.arrayContaining([artifacts.editProposalReviewFile]),
        }),
        primaryAction: expect.objectContaining({
          commandText: expect.stringContaining('--edit-proposal-review-file'),
          enabled: true,
          label: 'Run: Review controlled edit proposal',
          type: 'run_command',
        }),
      }),
    }));
    expect(writtenPath).toBe(nextActionFile);
    expect(saved).toEqual(nextAction);
  });

  it('builds and writes a Cowork proposal loop canvas', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before\n',
        path: 'docs/note.md',
        replace: 'after\n',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const canvasFile = path.join(tempRoot, 'loop', 'proposal-loop-canvas.json');
    const loop = buildAgenticCodingProposalLoopSnapshot(report, {
      applyReportFile: path.join(tempRoot, 'loop', 'apply-report.json'),
      approvalDecisionFile: path.join(tempRoot, 'loop', 'approval-decision.json'),
      approvalDecisionPromptFile: path.join(tempRoot, 'loop', 'approval-decision-prompt.md'),
      approvalFile: path.join(tempRoot, 'loop', 'approval-state.json'),
      editProposalFile: path.join(tempRoot, 'loop', 'edit-proposal.json'),
      editProposalProducerDispatchFile: path.join(tempRoot, 'loop', 'edit-proposal-producer-dispatch.json'),
      editProposalReviewFile: path.join(tempRoot, 'loop', 'edit-proposal-review.json'),
      previewReportFile: path.join(tempRoot, 'loop', 'preview-report.json'),
      proposalPromptFile: path.join(tempRoot, 'loop', 'edit-proposal-prompt.md'),
      workflowEventsFile: path.join(tempRoot, 'loop', 'workflow-events.json'),
      workflowProgressFile: path.join(tempRoot, 'loop', 'workflow-progress.json'),
    });

    const canvas = buildAgenticCodingProposalLoopCanvas(loop);
    const writtenPath = await writeAgenticCodingProposalLoopCanvas(report, canvasFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof canvas;

    expect(canvas).toEqual(expect.objectContaining({
      activeNodeId: 'review-preview',
      blockedNodeIds: [],
      completedNodeIds: [
        'prepare-edit-proposal-prompt',
        'produce-edit-proposal',
        'review-edit-proposal',
        'preview-scoped-edits',
      ],
      kind: 'agentic-coding-proposal-loop-canvas',
    }));
    expect(canvas.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({
          agenticType: 'approval',
          iconName: 'ClipboardCheck',
          status: 'ready',
          type: 'logic',
        }),
        id: 'review-preview',
        type: 'customNode',
      }),
      expect.objectContaining({
        data: expect.objectContaining({
          agenticType: 'analysis',
          iconName: 'Search',
          status: 'completed',
          type: 'action',
        }),
        id: 'review-edit-proposal',
        type: 'customNode',
      }),
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'trigger',
        }),
        id: 'prepare-edit-proposal-prompt',
      }),
    ]));
    expect(canvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'review-preview',
        style: { stroke: '#14b8a6', strokeWidth: 2 },
        target: 'apply-approved-edits',
      }),
    ]));
    expect(writtenPath).toBe(canvasFile);
    expect(saved.kind).toBe('agentic-coding-proposal-loop-canvas');
    expect(saved.activeNodeId).toBe('review-preview');
    expect(saved.nodes.length).toBe(8);
    expect(saved.edges.length).toBe(7);
  });

  it('builds and writes a non-writing proposal loop artifact bundle', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before\n', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before\n',
        path: 'docs/note.md',
        replace: 'after\n',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'loop-bundle');
    const artifactPaths = {
      applyReportFile: path.join(bundleDir, 'apply-report.json'),
      approvalDecisionFile: path.join(bundleDir, 'approval-decision.json'),
      approvalDecisionPromptFile: path.join(bundleDir, 'approval-decision-prompt.md'),
      approvalFile: path.join(bundleDir, 'approval-state.json'),
      artifactBundleFile: path.join(bundleDir, 'artifact-bundle.json'),
      editProposalFile: path.join(bundleDir, 'edit-proposal.json'),
      editProposalProducerDispatchFile: path.join(bundleDir, 'edit-proposal-producer-dispatch.json'),
      editProposalRequestFile: path.join(bundleDir, 'edit-proposal-request.json'),
      editProposalReviewFile: path.join(bundleDir, 'edit-proposal-review.json'),
      previewReportFile: path.join(bundleDir, 'preview-report.json'),
      proposalLoopCanvasFile: path.join(bundleDir, 'proposal-loop-canvas.json'),
      proposalLoopFile: path.join(bundleDir, 'proposal-loop.json'),
      proposalLoopNextActionFile: path.join(bundleDir, 'proposal-loop-next-action.json'),
      proposalPromptFile: path.join(bundleDir, 'edit-proposal-prompt.md'),
      seedReportFile: path.join(bundleDir, 'seed-report.json'),
      workflowEventsFile: path.join(bundleDir, 'workflow-events.json'),
      workflowProgressFile: path.join(bundleDir, 'workflow-progress.json'),
    };

    const request = buildAgenticCodingEditProposalRequest(report, artifactPaths);
    const dispatch = buildAgenticCodingEditProposalProducerDispatch(report, artifactPaths);
    const coworkImport = buildAgenticCodingProposalLoopCoworkImport(report, artifactPaths);
    const bundle = buildAgenticCodingProposalLoopArtifactBundle(report, artifactPaths);
    const writtenPath = await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof bundle;
    const prompt = await fs.readFile(saved.artifacts.proposalPromptFile, 'utf8');
    const savedRequest = JSON.parse(await fs.readFile(saved.artifacts.editProposalRequestFile, 'utf8')) as typeof request;
    const savedDispatch = JSON.parse(
      await fs.readFile(saved.artifacts.editProposalProducerDispatchFile, 'utf8'),
    ) as typeof dispatch;
    const savedReview = JSON.parse(await fs.readFile(saved.artifacts.editProposalReviewFile, 'utf8')) as {
      kind: string;
      state: string;
    };
    const nextAction = JSON.parse(await fs.readFile(saved.artifacts.proposalLoopNextActionFile, 'utf8')) as {
      canRunCommand: boolean;
      kind: string;
      runState: string;
      ui: {
        primaryAction: {
          disabledReason?: string;
          enabled: boolean;
          label: string;
          type: string;
        };
      };
      graphLegend: {
        activeNodeId: string;
        edgeCount: number;
        mode: string;
        nodeCount: number;
        nodeTypes: Array<{ canvasTypes: string[]; count: number; iconNames: string[]; id: string }>;
        safetyNote: string;
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
        safetyNote: string;
      };
    };
    const loop = JSON.parse(await fs.readFile(saved.artifacts.proposalLoopFile, 'utf8')) as { activeStepId: string; kind: string };
    const canvas = JSON.parse(await fs.readFile(saved.artifacts.proposalLoopCanvasFile, 'utf8')) as { activeNodeId: string; kind: string };
    const approval = JSON.parse(await fs.readFile(saved.artifacts.approvalFile, 'utf8')) as { state: string };
    const progress = JSON.parse(await fs.readFile(saved.artifacts.workflowProgressFile, 'utf8')) as { kind: string; nextAction: { type: string } };
    const events = JSON.parse(await fs.readFile(saved.artifacts.workflowEventsFile, 'utf8')) as { events: unknown[]; kind: string };
    const seedReport = JSON.parse(await fs.readFile(saved.artifacts.seedReportFile, 'utf8')) as { status: string };

    expect(bundle).toEqual(expect.objectContaining({
      coworkImport: expect.objectContaining({
        defaultPanelId: 'canvas',
        primaryArtifactPath: artifactPaths.proposalLoopFile,
        queueArtifactPath: artifactPaths.proposalLoopNextActionFile,
        requiredArtifactPaths: expect.arrayContaining([
          artifactPaths.proposalLoopFile,
          artifactPaths.proposalLoopCanvasFile,
          artifactPaths.proposalLoopNextActionFile,
        ]),
        suggestedFocusPanelId: 'approval',
      }),
      kind: 'agentic-coding-proposal-loop-artifact-bundle',
      source: expect.objectContaining({
        activeStepId: 'review-preview',
        approvalState: 'needs_approval',
        status: 'previewed',
      }),
    }));
    expect(coworkImport).toEqual(expect.objectContaining({
      defaultPanelId: 'canvas',
      primaryArtifactPath: artifactPaths.proposalLoopFile,
      queueArtifactPath: artifactPaths.proposalLoopNextActionFile,
      suggestedFocusPanelId: 'approval',
    }));
    expect(writtenPath).toBe(path.join(bundleDir, 'artifact-bundle.json'));
    expect(saved.materialized).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: saved.artifacts.proposalLoopFile,
        role: 'proposal_loop_packet',
      }),
      expect.objectContaining({
        path: saved.artifacts.proposalPromptFile,
        role: 'edit_proposal_prompt',
      }),
      expect.objectContaining({
        path: saved.artifacts.editProposalRequestFile,
        role: 'edit_proposal_request',
      }),
      expect.objectContaining({
        path: saved.artifacts.editProposalProducerDispatchFile,
        role: 'edit_proposal_producer_dispatch',
      }),
      expect.objectContaining({
        path: saved.artifacts.editProposalReviewFile,
        role: 'edit_proposal_review',
      }),
      expect.objectContaining({
        path: saved.artifacts.proposalLoopNextActionFile,
        role: 'proposal_loop_next_action',
      }),
      expect.objectContaining({
        path: saved.artifacts.seedReportFile,
        role: 'seed_report',
      }),
    ]));
    expect(saved.coworkImport.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactPath: saved.artifacts.proposalLoopCanvasFile,
        id: 'canvas',
        view: 'canvas',
      }),
      expect.objectContaining({
        artifactPath: saved.artifacts.proposalLoopNextActionFile,
        id: 'next-action',
        view: 'queue',
      }),
      expect.objectContaining({
        artifactPath: saved.artifacts.approvalFile,
        id: 'approval',
        view: 'review',
      }),
      expect.objectContaining({
        artifactPath: saved.artifacts.editProposalRequestFile,
        id: 'producer-request',
        view: 'prompt',
      }),
      expect.objectContaining({
        artifactPath: saved.artifacts.editProposalProducerDispatchFile,
        id: 'producer-dispatch',
        view: 'prompt',
      }),
    ]));
    expect(prompt).toContain('controlled edit proposal');
    expect(request).toEqual(expect.objectContaining({
      kind: 'agentic-coding-edit-proposal-request',
      output: expect.objectContaining({
        editProposalFile: artifactPaths.editProposalFile,
      }),
      source: expect.objectContaining({
        activeStepId: 'review-preview',
      }),
    }));
    expect(savedRequest).toEqual(expect.objectContaining({
      input: {
        proposalPromptFile: saved.artifacts.proposalPromptFile,
        taskFile,
      },
      kind: 'agentic-coding-edit-proposal-request',
      safety: expect.arrayContaining([
        'This request is data-only and never applies edits by itself.',
      ]),
    }));
    expect(dispatch).toEqual(expect.objectContaining({
      kind: 'agentic-coding-edit-proposal-producer-dispatch',
      output: expect.objectContaining({
        editProposalFile: artifactPaths.editProposalFile,
        reviewCommand: expect.objectContaining({
          args: expect.arrayContaining(['--edit-proposal-review-file', artifactPaths.editProposalReviewFile]),
        }),
      }),
      runPolicy: expect.objectContaining({
        cwd: repo,
        mode: 'data_only_edit_proposal',
      }),
    }));
    expect(savedDispatch).toEqual(expect.objectContaining({
      allowedTools: expect.arrayContaining(['file_read', 'rg']),
      disallowedActions: expect.arrayContaining(['apply_patch', 'push', 'deploy']),
      input: {
        proposalPromptFile: saved.artifacts.proposalPromptFile,
        repo,
        taskFile,
      },
      kind: 'agentic-coding-edit-proposal-producer-dispatch',
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ content: expect.stringContaining('Return only valid JSON'), role: 'user' }),
      ]),
    }));
    expect(savedReview).toEqual(expect.objectContaining({
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
          label: 'Review: Review preview and write approval decision',
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
    expect(progress.kind).toBe('agentic-coding-workflow-progress');
    expect(progress.nextAction.type).toBe('approve_preview');
    expect(events.kind).toBe('agentic-coding-workflow-events');
    expect(events.events.length).toBe(12);
    expect(seedReport.status).toBe('previewed');
  });

  it('writes a standalone Cowork import manifest for proposal loop artifacts', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const importFile = path.join(tempRoot, 'loop-import', 'cowork-import.json');

    const writtenPath = await writeAgenticCodingProposalLoopCoworkImport(report, importFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      defaultPanelId: string;
      panels: Array<{ id: string; view: string }>;
      queueArtifactPath: string;
      requiredArtifactPaths: string[];
      suggestedFocusPanelId: string;
    };

    expect(writtenPath).toBe(importFile);
    expect(saved).toEqual(expect.objectContaining({
      defaultPanelId: 'canvas',
      queueArtifactPath: path.join(path.dirname(importFile), 'proposal-loop-next-action.json'),
      suggestedFocusPanelId: 'approval',
    }));
    expect(saved.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'canvas', view: 'canvas' }),
      expect.objectContaining({ id: 'next-action', view: 'queue' }),
      expect.objectContaining({ id: 'approval', view: 'review' }),
      expect.objectContaining({ id: 'producer-request', view: 'prompt' }),
      expect.objectContaining({ id: 'producer-dispatch', view: 'prompt' }),
    ]));
    expect(saved.requiredArtifactPaths).toEqual(expect.arrayContaining([
      path.join(path.dirname(importFile), 'proposal-loop.json'),
      path.join(path.dirname(importFile), 'proposal-loop-canvas.json'),
      path.join(path.dirname(importFile), 'proposal-loop-next-action.json'),
    ]));
  });

  it('checks a standalone Cowork import manifest before opening artifacts', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'checked-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const checkFile = path.join(bundleDir, 'cowork-import-check.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const check = await buildAgenticCodingProposalLoopCoworkImportCheck(importFile);
    const writtenPath = await writeAgenticCodingProposalLoopCoworkImportCheck(importFile, checkFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof check;

    expect(check).toEqual(expect.objectContaining({
      defaultPanelId: 'canvas',
      missingRequiredArtifactPaths: [],
      primaryArtifactPath: path.join(bundleDir, 'proposal-loop.json'),
      primaryArtifactExists: true,
      queueArtifactExists: true,
      resolvedPrimaryArtifactPath: path.join(bundleDir, 'proposal-loop.json'),
      status: 'ready',
      validationErrors: [],
    }));
    expect(check.panels.length).toBe(9);
    expect(check.panels.every((panel) => panel.exists)).toBe(true);
    expect(check.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'next-action',
        required: true,
        resolvedArtifactPath: path.join(bundleDir, 'proposal-loop-next-action.json'),
      }),
      expect.objectContaining({
        id: 'producer-request',
        required: false,
        resolvedArtifactPath: path.join(bundleDir, 'edit-proposal-request.json'),
      }),
      expect.objectContaining({
        id: 'manifest',
        required: false,
        resolvedArtifactPath: path.join(bundleDir, 'artifact-bundle.json'),
      }),
    ]));
    expect(check.requiredArtifacts.every((artifact) => artifact.exists)).toBe(true);
    expect(writtenPath).toBe(checkFile);
    expect(saved.status).toBe('ready');
  });

  it('writes a Cowork workspace summary from an import manifest', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const check = await buildAgenticCodingProposalLoopCoworkImportCheck(importFile);
    const workspace = buildAgenticCodingProposalLoopCoworkWorkspace(check);
    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof workspace;

    expect(workspace).toEqual(expect.objectContaining({
      availablePanelIds: expect.arrayContaining(['canvas', 'approval', 'producer-request', 'producer-dispatch']),
      defaultPanelId: 'canvas',
      kind: 'agentic-coding-proposal-loop-cowork-workspace',
      openPanelId: 'approval',
      status: 'ready',
      suggestedFocusPanelId: 'approval',
      unavailablePanelIds: [],
    }));
    expect(workspace.ui.primaryAction).toEqual(expect.objectContaining({
      enabled: true,
      panelId: 'approval',
      type: 'open_panel',
    }));
    expect(workspace.ui.statusText).toBe('Workspace ready: 9/9 panels available.');
    expect(workspace.navigation).toEqual(expect.objectContaining({
      activePanelId: 'approval',
      availableCount: 9,
      defaultPanelId: 'canvas',
      missingRequiredCount: 0,
      panelCount: 9,
      recommendedPanelId: 'approval',
      requiredCount: 4,
    }));
    expect(workspace.navigation.tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        available: true,
        id: 'approval',
        recommended: true,
        required: true,
        view: 'review',
      }),
      expect.objectContaining({
        active: false,
        available: true,
        id: 'canvas',
        recommended: false,
        required: true,
        view: 'canvas',
      }),
    ]));
    expect(workspace.navigation.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        availablePanelIds: ['canvas', 'next-action', 'events'],
        id: 'workflow',
        panelIds: ['canvas', 'next-action', 'events'],
        unavailablePanelIds: [],
      }),
      expect.objectContaining({
        id: 'producer',
        panelIds: ['producer-request', 'producer-dispatch'],
      }),
    ]));
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
        id: 'artifact-availability',
        tone: 'success',
        value: '0 missing',
      }),
      expect.objectContaining({
        id: 'command-readiness',
        tone: 'neutral',
        value: '0/5 ready',
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
    expect(saved.layout.badgeStrip).toEqual({
      badgeIds: [
        'workspace-status',
        'approval-state',
        'supervision-state',
        'artifact-availability',
        'command-readiness',
        'review-checklist',
      ],
      placement: 'top',
    });
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
        availablePanelIds: ['canvas', 'next-action', 'events'],
        id: 'workflow-map',
        panelIds: ['canvas', 'next-action', 'events'],
        primaryPanelId: 'canvas',
        required: true,
        unavailablePanelIds: [],
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
        availableArtifactCount: 3,
        id: 'workflow-map',
        panelIds: ['canvas', 'next-action', 'events'],
        primaryPanelId: 'canvas',
        requiredArtifactCount: 3,
        totalArtifactCount: 3,
        unavailableArtifactCount: 0,
      }),
      expect.objectContaining({
        availableArtifactCount: 2,
        id: 'operator-review',
        panelIds: ['approval', 'producer-review'],
        primaryPanelId: 'approval',
        requiredArtifactCount: 1,
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
    expect(saved.decisionForm.reason).toBe('Scoped edit preview is ready for human or Cowork approval before applying.');
    expect(saved.decisionForm.safetyNotes).toEqual(expect.arrayContaining([
      'Decision form is a passive UI descriptor.',
      'Use rejected unless the preview is fully inspected and acceptable.',
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
        badgeIds: ['approval-state', 'supervision-state'],
        enabled: true,
        id: 'fill-approval-decision',
        panelId: 'approval',
        type: 'fill_form',
      }),
      expect.objectContaining({
        enabled: true,
        id: 'inspect-guardrails',
        panelId: 'manifest',
        type: 'open_panel',
      }),
      expect.objectContaining({
        disabledReason: 'Review the scoped edit preview and write an approval decision JSON file.',
        enabled: false,
        id: 'copy-next-command',
        panelId: 'next-action',
        type: 'copy_command',
      }),
    ]));
    expect(saved.operatorBrief).toEqual(expect.objectContaining({
      body: 'Scoped edit preview is ready for human or Cowork approval before applying.',
      headline: 'Review needed: approval',
      nextActionId: 'open-active-panel',
      panelId: 'approval',
      severity: 'warning',
      state: 'human_review_required',
    }));
    expect(saved.operatorBrief.evidence).toEqual([
      '9/9 panels available',
      '0/5 commands ready',
      'checklist pending',
    ]);
    expect(saved.operatorHandoff).toEqual(expect.objectContaining({
      actionId: 'open-active-panel',
      artifactPath: path.join(bundleDir, 'approval-state.json'),
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
        id: 'canvas',
        recommended: false,
        regionId: 'workflow-map',
        required: true,
        view: 'canvas',
      }),
    ]));
    expect(workspace.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        available: true,
        id: 'approval',
        resolvedArtifactPath: path.join(bundleDir, 'approval-state.json'),
      }),
    ]));
    expect(writtenPath).toBe(workspaceFile);
    expect(saved.openPanelId).toBe('approval');
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
    expect(saved.guardrails.disallowedActions).toEqual(expect.arrayContaining([
      'apply_patch',
      'deploy',
      'file_write',
      'push',
      'shell_exec',
    ]));
    expect(saved.guardrails.readOnlyTools).toEqual(['file_read', 'git_status', 'rg']);
    expect(saved.guardrails.safetyNotes).toEqual(expect.arrayContaining([
      'Does not modify repository files.',
      'Requires an approved decision file.',
      'Visualizes the safe route for Cowork; does not grant write authority.',
    ]));
    expect(saved.harness).toEqual(expect.objectContaining({
      canExecute: false,
      executionMode: 'display_only',
      kind: 'agentic-coding-harness-contract',
      label: 'Harness / security and orchestration contract',
      mode: 'passive',
      schemaVersion: 1,
    }));
    expect(saved.harness.activeState).toEqual(expect.objectContaining({
      activePanelId: 'approval',
      activeStepId: 'review-preview',
      approvalState: 'needs_approval',
      canRunCommand: false,
      missingRequiredCount: 0,
      readyCommandCount: 0,
      recommendedPanelId: 'approval',
      supervisionState: 'human_review_required',
      workspaceStatus: 'ready',
    }));
    expect(saved.harness.contractTerms).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run', label: 'Run' }),
      expect.objectContaining({ id: 'evidence', label: 'Evidence' }),
      expect.objectContaining({ id: 'sensitive-action', label: 'Sensitive action' }),
      expect.objectContaining({ id: 'workflow', label: 'Workflow' }),
      expect.objectContaining({ id: 'human-approval', label: 'Human approval' }),
      expect.objectContaining({ id: 'memory-or-lesson', label: 'Memory or lesson' }),
      expect.objectContaining({ id: 'agent-boundary', label: 'Agent boundary' }),
    ]));
    expect(saved.harness.hermes).toEqual(expect.objectContaining({
      agentId: 'hermes',
      dispatchProfile: 'balanced',
      toolsetId: 'fleet.hermes.balanced',
    }));
    expect(saved.harness.hermes.nativeSurfaces.map((surface: { id: string }) => surface.id)).toEqual(expect.arrayContaining([
      'toolsets',
      'skills',
      'memory',
      'lessons',
      'session-search',
      'scheduled-work',
      'hooks',
      'delegation',
    ]));
    expect(saved.harness.hermes.lifecycleStages.map((stage: { stage: string }) => stage.stage)).toEqual([
      'before_tool_call',
      'after_tool_call',
      'before_memory_write',
      'after_run_complete',
      'before_scheduled_delivery',
    ]);
    expect(saved.harness.safetyNotes).toEqual(expect.arrayContaining([
      'Harness data is display metadata only.',
      'Runner validation remains the authority for preview, approval and apply.',
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
      expect.objectContaining({
        id: 'write-approval-decision',
        panelId: 'approval',
        status: 'pending',
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
        artifactPath: path.join(bundleDir, 'approval-state.json'),
        id: 'open-review-panel',
        panelId: 'approval',
        regionId: 'operator-review',
        status: 'pending',
      }),
      expect.objectContaining({
        actionId: 'inspect-guardrails',
        active: false,
        artifactPath: path.join(bundleDir, 'artifact-bundle.json'),
        id: 'confirm-guardrails',
        panelId: 'manifest',
        regionId: 'evidence-strip',
        status: 'completed',
      }),
      expect.objectContaining({
        actionId: 'fill-approval-decision',
        id: 'write-approval-decision',
        panelId: 'approval',
        status: 'pending',
      }),
    ]));
  });

  it('adds passive queue details to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-queue-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      queue: {
        activeStepId: string;
        canRunCommand: boolean;
        nextActionType: string;
        runState: string;
        uiPrimaryAction: { enabled: boolean; type: string };
        validationErrors: string[];
      };
    };

    expect(saved.queue).toEqual(expect.objectContaining({
      activeStepId: 'review-preview',
      canRunCommand: false,
      nextActionType: 'review_preview',
      runState: 'human_input_required',
      validationErrors: [],
    }));
    expect(saved.queue.uiPrimaryAction).toEqual(expect.objectContaining({
      enabled: false,
      type: 'human_review',
    }));
  });

  it('adds a passive stepper summary to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-stepper-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      stepper: {
        activeStepId: string;
        blockedStepIds: string[];
        completedStepIds: string[];
        counts: { completed: number; ready: number; total: number };
        steps: Array<{ active: boolean; id: string; label: string; status: string }>;
        validationErrors: string[];
      };
    };

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.stepper).toEqual(expect.objectContaining({
      activeStepId: 'review-preview',
      blockedStepIds: [],
      completedStepIds: [
        'prepare-edit-proposal-prompt',
        'produce-edit-proposal',
        'review-edit-proposal',
        'preview-scoped-edits',
      ],
      validationErrors: [],
    }));
    expect(saved.stepper.counts).toEqual(expect.objectContaining({
      completed: 4,
      ready: 1,
      total: 8,
    }));
    expect(saved.stepper.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        id: 'review-preview',
        label: 'Review preview and write approval decision',
        status: 'ready',
      }),
    ]));
  });

  it('adds a passive command catalog to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-commands-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      commands: {
        commandCount: number;
        commands: Array<{
          canRunNow: boolean;
          command: { args: string[]; executable: string };
          commandText: string;
          id: string;
          outputArtifacts: string[];
          safety: string[];
          status: string;
        }>;
        readyCommandCount: number;
        validationErrors: string[];
      };
    };

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.commands).toEqual(expect.objectContaining({
      commandCount: 5,
      readyCommandCount: 0,
      validationErrors: [],
    }));
    expect(saved.commands.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        canRunNow: false,
        command: expect.objectContaining({
          args: expect.arrayContaining(['--preview-edits']),
          executable: 'buddy',
        }),
        commandText: expect.stringContaining('--preview-edits'),
        id: 'preview-scoped-edits',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'apply-approved-edits',
        outputArtifacts: [path.join(bundleDir, 'apply-report.json')],
        safety: expect.arrayContaining(['Requires an approved decision file.']),
        status: 'pending',
      }),
    ]));
  });

  it('adds a passive graph summary to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-graph-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      graph: {
        activeNodeId: string;
        approvalNodeIds: string[];
        blockedNodeIds: string[];
        edgeCount: number;
        edges: Array<{ source: string; target: string }>;
        nodeCount: number;
        nodes: Array<{
          active: boolean;
          canvasType: string;
          iconName: string;
          id: string;
          position: { x: number; y: number };
          status: string;
          type: string;
        }>;
        statusCounts: { completed: number; ready: number; total: number };
        validationErrors: string[];
      };
    };

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.graph).toEqual(expect.objectContaining({
      activeNodeId: 'review-preview',
      approvalNodeIds: ['review-preview'],
      blockedNodeIds: [],
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
        status: 'ready',
        type: 'approval',
      }),
    ]));
    expect(saved.graphLegend).toEqual(expect.objectContaining({
      activeNodeId: 'review-preview',
      edgeCount: 7,
      mode: 'passive',
      nodeCount: 8,
      safetyNote: 'Graph legend is display metadata only.',
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
      expect.objectContaining({
        count: 3,
        id: 'pending',
        tone: 'neutral',
      }),
    ]));
    expect(saved.graphLegend.nodeTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        canvasTypes: ['logic'],
        count: 1,
        iconNames: ['ClipboardCheck'],
        id: 'approval',
      }),
      expect.objectContaining({
        canvasTypes: ['action'],
        count: 2,
        id: 'edit',
      }),
    ]));
    expect(saved.graphViewport).toEqual({
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
      safetyNote: 'Graph viewport is display metadata only.',
    });
    expect(saved.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'review-edit-proposal',
        target: 'preview-scoped-edits',
      }),
    ]));
  });

  it('adds a passive activity summary to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const expectedEvents = buildAgenticCodingWorkflowEventsSnapshot(report);
    const bundleDir = path.join(tempRoot, 'workspace-activity-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      activity: {
        activeEventId: string;
        activeNodeId: string;
        counts: { error: number; success: number; total: number; warning: number };
        events: Array<{ active: boolean; id: string; nodeId: string; severity: string }>;
        validationErrors: string[];
      };
    };
    const expectedActiveEvent = expectedEvents.events.find((event) => event.active);

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.activity).toEqual(expect.objectContaining({
      activeEventId: expectedActiveEvent?.id,
      activeNodeId: report.workflow.activeNodeId,
      validationErrors: [],
    }));
    expect(saved.activity.counts).toEqual(expect.objectContaining({
      total: expectedEvents.events.length,
      warning: expectedEvents.events.filter((event) => event.severity === 'warning').length,
    }));
    expect(saved.activity.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        id: expectedActiveEvent?.id,
        nodeId: report.workflow.activeNodeId,
      }),
    ]));
  });

  it('adds a passive approval summary to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const expectedApproval = buildAgenticCodingApprovalSnapshot(report);
    const bundleDir = path.join(tempRoot, 'workspace-approval-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      approval: {
        affectedFiles: string[];
        editSummary: { applied: number; declared: number; previewed: number };
        gateNodeIds: string[];
        nextAction: { nodeId: string; type: string };
        requiredBeforeApply: boolean;
        sourceActiveNodeId: string;
        state: string;
        validationErrors: string[];
      };
    };

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.approval).toEqual(expect.objectContaining({
      affectedFiles: ['docs/note.md'],
      gateNodeIds: expectedApproval.gateNodeIds,
      requiredBeforeApply: false,
      sourceActiveNodeId: 'approval-decision',
      state: 'needs_approval',
      validationErrors: [],
    }));
    expect(saved.approval.editSummary).toEqual(expect.objectContaining({
      applied: 0,
      declared: 1,
      previewed: 1,
    }));
    expect(saved.approval.nextAction).toEqual(expect.objectContaining({
      nodeId: 'edit-preview',
      type: 'review_preview',
    }));
  });

  it('adds a passive producer summary to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo));
    const editProposalFile = await writeEditProposalFile({
      summary: 'Update docs note.',
      producer: 'agent-producer',
      risks: ['Docs-only change.'],
      verificationNotes: ['Preview before approval.'],
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    });
    const report = await runAgenticCodingCell({ editProposalFile, previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-producer-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      producer: {
        request: {
          editProposalFile: string;
          instructionCount: number;
          instructions: string[];
          proposalPromptFile: string;
          safetyCount: number;
          schemaKeys: string[];
          sourceActiveStepId: string;
          status: string;
          taskFile: string;
          validationErrors: string[];
        };
        dispatch: {
          allowedTools: string[];
          editProposalFile: string;
          mode: string;
          reviewCommand: { args: string[]; executable: string };
          validationErrors: string[];
        };
        review: {
          affectedFiles: string[];
          editSummary: { declared: number; producer: string; proposed: number; summary: string };
          nextAction: { stepId: string; type: string };
          sourceProposalFile: string;
          state: string;
          validationErrors: string[];
        };
        validationErrors: string[];
      };
    };

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.producer.request).toEqual(expect.objectContaining({
      editProposalFile: path.join(bundleDir, 'edit-proposal.json'),
      instructionCount: 5,
      proposalPromptFile: path.join(bundleDir, 'edit-proposal-prompt.md'),
      safetyCount: 3,
      schemaKeys: ['edits', 'producer', 'risks', 'summary', 'verificationNotes'],
      sourceActiveStepId: 'review-preview',
      status: 'previewed',
      taskFile,
      validationErrors: [],
    }));
    expect(saved.producer.request.instructions).toEqual(expect.arrayContaining([
      'Do not modify repository files directly.',
    ]));
    expect(saved.producer.dispatch).toEqual(expect.objectContaining({
      allowedTools: ['file_read', 'rg', 'git_status'],
      editProposalFile: path.join(bundleDir, 'edit-proposal.json'),
      mode: 'data_only_edit_proposal',
      validationErrors: [],
    }));
    expect(saved.producer.dispatch.reviewCommand).toEqual(expect.objectContaining({
      executable: 'buddy',
      args: expect.arrayContaining(['--edit-proposal-review-file', path.join(bundleDir, 'edit-proposal-review.json')]),
    }));
    expect(saved.producer.review).toEqual(expect.objectContaining({
      affectedFiles: ['docs/note.md'],
      sourceProposalFile: editProposalFile,
      state: 'accepted',
      validationErrors: [],
    }));
    expect(saved.producer.review.editSummary).toEqual({
      declared: 1,
      producer: 'agent-producer',
      proposed: 1,
      summary: 'Update docs note.',
    });
    expect(saved.producer.review.nextAction).toEqual(expect.objectContaining({
      stepId: 'preview-scoped-edits',
      type: 'preview_edits',
    }));
    expect(saved.producer.validationErrors).toEqual([]);
  });

  it('adds a passive evidence summary to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-evidence-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      evidence: {
        approvalState: string;
        autoExecutable: boolean;
        blockedReasons: string[];
        editSummary: { applied: number; blocked: number; declared: number; previewed: number };
        status: string;
        validationErrors: string[];
        verificationSummary: { blocked: number; failed: number; passed: number; total: number };
        workflow: { activeNodeId: string; blocked: number; completed: number; total: number };
      };
    };

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.evidence).toEqual(expect.objectContaining({
      approvalState: 'needs_approval',
      autoExecutable: true,
      blockedReasons: [],
      status: 'previewed',
      validationErrors: [],
    }));
    expect(saved.evidence.editSummary).toEqual({
      applied: 0,
      blocked: 0,
      declared: 1,
      previewed: 1,
    });
    expect(saved.evidence.verificationSummary).toEqual({
      blocked: 0,
      failed: 0,
      passed: 0,
      total: 0,
    });
    expect(saved.evidence.workflow).toEqual(expect.objectContaining({
      activeNodeId: report.workflow.activeNodeId,
      blocked: 0,
      total: report.workflow.nodes.length,
    }));
  });

  it('adds a passive manifest summary to the Cowork workspace summary', async () => {
    const repo = await createTempGitRepo();
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'note.md'), 'before', 'utf8');
    const taskFile = await writeTaskFile(taskFor(repo, {
      edits: [{
        expectedOccurrences: 1,
        find: 'before',
        path: 'docs/note.md',
        replace: 'after',
        type: 'replace_text',
      }],
    }));
    const report = await runAgenticCodingCell({ previewEdits: true, taskFile });
    const bundleDir = path.join(tempRoot, 'workspace-manifest-loop');
    const importFile = path.join(bundleDir, 'cowork-import.json');
    const workspaceFile = path.join(bundleDir, 'cowork-workspace.json');
    await writeAgenticCodingProposalLoopArtifactBundle(report, bundleDir);
    await writeAgenticCodingProposalLoopCoworkImport(report, importFile);

    const writtenPath = await writeAgenticCodingProposalLoopCoworkWorkspace(importFile, workspaceFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      manifest: {
        coworkImport: {
          defaultPanelId: string;
          panelCount: number;
          requiredArtifactCount: number;
          suggestedFocusPanelId: string;
        };
        materialized: Array<{ path: string; role: string; safety: string }>;
        materializedCount: number;
        roles: string[];
        source: { activeStepId: string; approvalState: string; status: string };
        validationErrors: string[];
      };
    };

    expect(writtenPath).toBe(workspaceFile);
    expect(saved.manifest).toEqual(expect.objectContaining({
      materializedCount: 13,
      roles: expect.arrayContaining([
        'artifact_manifest',
        'proposal_loop_packet',
        'seed_report',
      ]),
      source: expect.objectContaining({
        activeStepId: 'review-preview',
        approvalState: 'needs_approval',
        status: 'previewed',
      }),
      validationErrors: [],
    }));
    expect(saved.manifest.coworkImport).toEqual(expect.objectContaining({
      defaultPanelId: 'canvas',
      panelCount: 9,
      requiredArtifactCount: 5,
      suggestedFocusPanelId: 'approval',
    }));
    expect(saved.manifest.materialized).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'artifact_manifest',
        safety: 'Manifest of materialized artifacts for Cowork or an agent consumer.',
      }),
    ]));
  });

  it('renders a constrained prompt for future edit proposal generation', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo, {
      task: 'Update one docs sentence.',
    }));
    const report = await runAgenticCodingCell({ taskFile });

    const prompt = renderAgenticCodingEditProposalPrompt(report, { includeDirtyFiles: true });

    expect(prompt).toContain('Return only valid JSON');
    expect(prompt).toContain('Update one docs sentence.');
    expect(prompt).toContain('Allowed paths: docs/...');
    expect(prompt).toContain('"type": "replace_text"');
    expect(prompt).toContain('Before applying any proposal');
  });

  it('writes a constrained edit proposal prompt artifact', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));
    const report = await runAgenticCodingCell({ taskFile });
    const promptFile = path.join(tempRoot, 'prompts', 'proposal-prompt.md');

    const writtenPath = await writeAgenticCodingEditProposalPrompt(report, promptFile);
    const saved = await fs.readFile(writtenPath, 'utf8');

    expect(writtenPath).toBe(promptFile);
    expect(saved).toContain('You are preparing a controlled edit proposal');
    expect(saved).toContain(`- Repo: ${repo}`);
  });

  it('writes a data-only edit proposal producer dispatch artifact', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo, {
      task: 'Propose a focused docs edit.',
    }));
    const report = await runAgenticCodingCell({ taskFile });
    const dispatchFile = path.join(tempRoot, 'dispatch', 'edit-proposal-producer-dispatch.json');

    const writtenPath = await writeAgenticCodingEditProposalProducerDispatch(report, dispatchFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as {
      allowedTools: string[];
      disallowedActions: string[];
      kind: string;
      messages: Array<{ content: string; role: string }>;
      output: {
        editProposalFile: string;
        reviewCommand: { args: string[]; executable: string };
      };
      runPolicy: { cwd: string; mode: string };
    };

    expect(writtenPath).toBe(dispatchFile);
    expect(saved).toEqual(expect.objectContaining({
      allowedTools: expect.arrayContaining(['file_read', 'rg', 'git_status']),
      disallowedActions: expect.arrayContaining(['apply_patch', 'file_write', 'shell_exec']),
      kind: 'agentic-coding-edit-proposal-producer-dispatch',
      runPolicy: expect.objectContaining({
        cwd: repo,
        mode: 'data_only_edit_proposal',
      }),
    }));
    expect(saved.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({
        content: expect.stringContaining('Propose a focused docs edit.'),
        role: 'user',
      }),
    ]));
    expect(saved.output.editProposalFile).toBe(path.join(path.dirname(dispatchFile), 'edit-proposal.json'));
    expect(saved.output.reviewCommand.args).toEqual(expect.arrayContaining([
      '--edit-proposal-file',
      path.join(path.dirname(dispatchFile), 'edit-proposal.json'),
      '--edit-proposal-review-file',
      path.join(path.dirname(dispatchFile), 'edit-proposal-review.json'),
    ]));
  });

  it('renders a constrained prompt for future workflow builder generation', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo, {
      task: 'Design a guarded docs edit workflow.',
    }));
    const report = await runAgenticCodingCell({ taskFile });

    const prompt = renderAgenticCodingWorkflowBuilderPrompt(report, {
      includeCurrentCanvas: true,
    });

    expect(prompt).toContain('PostCommander-style workflow');
    expect(prompt).toContain('agentic-coding-workflow-builder-proposal');
    expect(prompt).toContain('Design a guarded docs edit workflow.');
    expect(prompt).toContain('Use graph nodes and edges only');
    expect(prompt).toContain('Current runner canvas:');
    expect(prompt).toContain('agentic-coding-workflow-canvas');
  });

  it('writes a constrained workflow builder prompt artifact', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));
    const report = await runAgenticCodingCell({ taskFile });
    const promptFile = path.join(tempRoot, 'prompts', 'workflow-builder-prompt.md');

    const writtenPath = await writeAgenticCodingWorkflowBuilderPrompt(report, promptFile, {
      includeCurrentCanvas: false,
    });
    const saved = await fs.readFile(writtenPath, 'utf8');

    expect(writtenPath).toBe(promptFile);
    expect(saved).toContain('You are designing a PostCommander-style workflow');
    expect(saved).toContain(`- Repo: ${repo}`);
    expect(saved).not.toContain('Current runner canvas:');
  });

  it('loads a controlled workflow builder proposal file into the run report', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));
    const proposalFile = path.join(tempRoot, 'workflow-builder-proposal.json');
    await fs.writeFile(proposalFile, JSON.stringify({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Render a guarded coding workflow.',
      nodes: [
        {
          id: 'contract',
          label: 'Validate task',
          description: 'Validate the task contract first.',
          agenticType: 'gate',
          type: 'trigger',
        },
        {
          id: 'approval',
          label: 'Approve preview',
          description: 'Require review before apply.',
          agenticType: 'approval',
          type: 'logic',
        },
      ],
      edges: [{ source: 'contract', target: 'approval' }],
      approvalGates: ['Approve preview before apply.'],
      coworkVisualizationNotes: ['Show the active node.'],
      risks: ['none'],
    }), 'utf8');

    const report = await runAgenticCodingCell({
      taskFile,
      workflowBuilderProposalFile: proposalFile,
    });

    expect(report.status).toBe('ready');
    expect(report.workflowBuilderProposal).toEqual(expect.objectContaining({
      approvalGates: ['Approve preview before apply.'],
      coworkVisualizationNotes: ['Show the active node.'],
      edgeCount: 1,
      file: proposalFile,
      nodeCount: 2,
      risks: ['none'],
      summary: 'Render a guarded coding workflow.',
    }));
    expect(report.workflowBuilderProposal?.nodes.map((node) => node.id)).toEqual(['contract', 'approval']);
    expect(report.workflowBuilderProposal?.edges).toEqual([{ source: 'contract', target: 'approval' }]);
  });

  it('rejects malformed workflow builder proposal files', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));
    const proposalFile = path.join(tempRoot, 'bad-workflow-builder-proposal.json');
    await fs.writeFile(proposalFile, JSON.stringify({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Dangling edge.',
      nodes: [{
        id: 'contract',
        label: 'Validate task',
        description: 'Validate the task contract.',
        agenticType: 'gate',
        type: 'trigger',
      }],
      edges: [{ source: 'contract', target: 'missing' }],
    }), 'utf8');

    const report = await runAgenticCodingCell({
      taskFile,
      workflowBuilderProposalFile: proposalFile,
    });

    expect(report.status).toBe('validation_failed');
    expect(report.validationErrors).toContain(
      'workflowBuilderProposalFile: edges.0.target: edge target "missing" does not reference a node'
    );
  });

  it('builds and writes a canvas for a validated workflow builder proposal', async () => {
    const repo = await createTempGitRepo();
    const taskFile = await writeTaskFile(taskFor(repo));
    const proposalFile = path.join(tempRoot, 'workflow-builder-proposal.json');
    const canvasFile = path.join(tempRoot, 'workflows', 'workflow-builder-proposal-canvas.json');
    await fs.writeFile(proposalFile, JSON.stringify({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Render the proposed workflow.',
      nodes: [
        {
          id: 'contract',
          label: 'Validate task',
          description: 'Validate before work.',
          agenticType: 'gate',
          type: 'trigger',
        },
        {
          id: 'handoff',
          label: 'Handoff',
          description: 'Summarize evidence.',
          agenticType: 'handoff',
          type: 'action',
        },
      ],
      edges: [{ source: 'contract', target: 'handoff' }],
    }), 'utf8');
    const report = await runAgenticCodingCell({
      taskFile,
      workflowBuilderProposalFile: proposalFile,
    });

    const canvas = buildAgenticCodingWorkflowBuilderProposalCanvas(report);
    const writtenPath = await writeAgenticCodingWorkflowBuilderProposalCanvas(report, canvasFile);
    const saved = JSON.parse(await fs.readFile(writtenPath, 'utf8')) as typeof canvas;

    expect(canvas).toEqual(expect.objectContaining({
      kind: 'agentic-coding-workflow-builder-proposal-canvas',
      summary: 'Render the proposed workflow.',
    }));
    expect(canvas?.source.proposalFile).toBe(proposalFile);
    expect(canvas?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({
          agenticType: 'gate',
          label: 'Validate task',
          status: 'pending',
          type: 'trigger',
        }),
        id: 'contract',
        type: 'customNode',
      }),
    ]));
    expect(canvas?.edges).toEqual([
      {
        animated: true,
        id: 'proposal-edge-contract-handoff-0',
        source: 'contract',
        style: { stroke: '#06b6d4', strokeWidth: 2 },
        target: 'handoff',
      },
    ]);
    expect(writtenPath).toBe(canvasFile);
    expect(saved).toEqual(canvas);
  });
});
