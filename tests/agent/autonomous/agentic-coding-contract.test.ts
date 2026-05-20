import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  assessAgenticCodingExecutionGate,
  validateAgenticCodingApprovalDecision,
  validateAgenticCodingEditProposal,
  validateAgenticCodingTaskContract,
  validateAgenticCodingWorkflowBuilderProposal,
} from '../../../src/agent/autonomous/agentic-coding-contract.js';

const baseTask = () => ({
  repo: path.resolve('D:/CascadeProjects/grok-cli-weekend'),
  task: 'Add a focused low-risk documentation improvement.',
  allowedPaths: ['docs/example.md'],
  verification: ['git diff --check -- docs/example.md'],
  riskLevel: 'low',
});

describe('agentic coding task contract', () => {
  it('accepts a minimal low-risk task and applies defaults', () => {
    const result = validateAgenticCodingTaskContract(baseTask());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(result.contract.output).toBe('text');
    expect(result.contract.maxFilesChanged).toBe(10);
    expect(result.contract.maxToolRounds).toBe(50);
    expect(result.contract.memoryPolicy).toBe('handoff');
    expect(result.contract.fleetPolicy).toBe('none');
    expect(result.contract.edits).toEqual([]);
  });

  it('normalizes allowed path separators and trims strings', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      task: '  Update a test fixture.  ',
      allowedPaths: [' .\\tests\\fixtures\\sample.json\\ '],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(result.contract.task).toBe('Update a test fixture.');
    expect(result.contract.allowedPaths).toEqual(['tests/fixtures/sample.json']);
  });

  it('rejects a relative repository path', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      repo: 'relative/path',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain('repo: repo must be an absolute path');
  });

  it('rejects broad or traversal edit scopes', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      allowedPaths: ['.', '../outside'],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toEqual([
      'allowedPaths.0: allowedPaths must be bounded relative paths without traversal',
      'allowedPaths.1: allowedPaths must be bounded relative paths without traversal',
    ]);
  });

  it('rejects tasks without verification commands', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      verification: [],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain('verification: Array must contain at least 1 element(s)');
  });

  it('accepts bounded replace_text edit operations', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      edits: [{
        type: 'replace_text',
        path: '.\\docs\\example.md',
        find: 'old text',
        replace: 'new text',
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(result.contract.edits).toEqual([{
      type: 'replace_text',
      path: 'docs/example.md',
      find: 'old text',
      replace: 'new text',
      expectedOccurrences: 1,
    }]);
  });

  it('rejects edit paths that escape the repository', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      edits: [{
        type: 'replace_text',
        path: '../outside.md',
        find: 'old text',
        replace: 'new text',
      }],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain('edits.0.path: allowedPaths must be bounded relative paths without traversal');
  });

  it('accepts controlled edit proposal files', () => {
    const result = validateAgenticCodingEditProposal({
      summary: 'Update one documentation sentence.',
      producer: 'test-agent',
      risks: ['Documentation wording only.'],
      verificationNotes: ['Run git diff --check.'],
      edits: [{
        type: 'replace_text',
        path: 'docs/example.md',
        find: 'old text',
        replace: 'new text',
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(result.proposal.edits[0]).toEqual({
      type: 'replace_text',
      path: 'docs/example.md',
      find: 'old text',
      replace: 'new text',
      expectedOccurrences: 1,
    });
  });

  it('accepts controlled approval decisions', () => {
    const result = validateAgenticCodingApprovalDecision({
      kind: 'agentic-coding-approval-decision',
      schemaVersion: 1,
      decision: 'approved',
      reviewer: 'patrice',
      reason: 'Preview reviewed in Cowork.',
      decidedAt: '2026-05-20T01:30:00.000Z',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(result.decision).toEqual({
      kind: 'agentic-coding-approval-decision',
      schemaVersion: 1,
      decision: 'approved',
      reviewer: 'patrice',
      reason: 'Preview reviewed in Cowork.',
      decidedAt: '2026-05-20T01:30:00.000Z',
    });
  });

  it('rejects malformed approval decisions', () => {
    const result = validateAgenticCodingApprovalDecision({
      kind: 'agentic-coding-approval-decision',
      schemaVersion: 1,
      decision: 'maybe',
      reviewer: 'patrice',
      reason: 'Not a valid decision.',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain("decision: Invalid enum value. Expected 'approved' | 'rejected', received 'maybe'");
  });

  it('rejects edit proposals without edits', () => {
    const result = validateAgenticCodingEditProposal({
      summary: 'No concrete change.',
      edits: [],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain('edits: Array must contain at least 1 element(s)');
  });

  it('accepts controlled workflow builder proposals', () => {
    const result = validateAgenticCodingWorkflowBuilderProposal({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Show a visible guarded coding workflow.',
      nodes: [
        {
          id: 'contract',
          label: 'Validate task',
          description: 'Validate the task contract before any other work.',
          agenticType: 'gate',
          type: 'trigger',
        },
        {
          id: 'preview',
          label: 'Preview edits',
          description: 'Render the proposed edit before writing.',
          agenticType: 'approval',
          type: 'logic',
        },
      ],
      edges: [{ source: 'contract', target: 'preview' }],
      approvalGates: ['Human review before apply.'],
      coworkVisualizationNotes: ['Show active node and blocked reasons.'],
      risks: ['none'],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(result.proposal.nodes).toHaveLength(2);
    expect(result.proposal.edges).toEqual([{ source: 'contract', target: 'preview' }]);
  });

  it('rejects workflow builder proposals with dangling edges', () => {
    const result = validateAgenticCodingWorkflowBuilderProposal({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Invalid workflow.',
      nodes: [{
        id: 'contract',
        label: 'Validate task',
        description: 'Validate the task contract.',
        agenticType: 'gate',
        type: 'trigger',
      }],
      edges: [{ source: 'contract', target: 'missing' }],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain('edges.0.target: edge target "missing" does not reference a node');
  });

  it('rejects workflow builder proposals without exactly one trigger', () => {
    const result = validateAgenticCodingWorkflowBuilderProposal({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Invalid workflow trigger count.',
      nodes: [
        {
          id: 'manual',
          label: 'Manual trigger',
          description: 'First trigger.',
          agenticType: 'gate',
          type: 'trigger',
        },
        {
          id: 'webhook',
          label: 'Webhook trigger',
          description: 'Second trigger.',
          agenticType: 'gate',
          type: 'trigger',
        },
      ],
      edges: [{ source: 'manual', target: 'webhook' }],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain(
      'nodes: workflow builder proposals must declare exactly one trigger node, found 2'
    );
  });

  it('rejects workflow builder proposals with unreachable nodes', () => {
    const result = validateAgenticCodingWorkflowBuilderProposal({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Invalid disconnected workflow.',
      nodes: [
        {
          id: 'contract',
          label: 'Validate task',
          description: 'Validate the task contract.',
          agenticType: 'gate',
          type: 'trigger',
        },
        {
          id: 'preview',
          label: 'Preview edits',
          description: 'Preview the proposed edit.',
          agenticType: 'approval',
          type: 'logic',
        },
        {
          id: 'orphan',
          label: 'Orphan node',
          description: 'This node is not reachable.',
          agenticType: 'handoff',
          type: 'action',
        },
      ],
      edges: [{ source: 'contract', target: 'preview' }],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected validation to fail');

    expect(result.errors).toContain('nodes: workflow builder proposal has unreachable node(s): orphan');
  });

  it('allows auto-execution only for bounded low-risk tasks', () => {
    const result = validateAgenticCodingTaskContract(baseTask());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(assessAgenticCodingExecutionGate(result.contract)).toEqual({
      autoExecutable: true,
      reasons: [],
    });
  });

  it('blocks medium-risk tasks in the V0 execution gate', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      riskLevel: 'medium',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(assessAgenticCodingExecutionGate(result.contract)).toEqual({
      autoExecutable: false,
      reasons: ['V0 only auto-executes low-risk tasks'],
    });
  });

  it('blocks high-risk scopes even when the declared risk is low', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      allowedPaths: ['src/security/guardian-agent.ts'],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(assessAgenticCodingExecutionGate(result.contract)).toEqual({
      autoExecutable: false,
      reasons: ['allowed path "src/security/guardian-agent.ts" touches a high-risk scope'],
    });
  });

  it('blocks write delegation in V0', () => {
    const result = validateAgenticCodingTaskContract({
      ...baseTask(),
      fleetPolicy: 'delegated-slices',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.errors.join('\n'));

    expect(assessAgenticCodingExecutionGate(result.contract)).toEqual({
      autoExecutable: false,
      reasons: ['write delegation is not enabled in V0'],
    });
  });
});
