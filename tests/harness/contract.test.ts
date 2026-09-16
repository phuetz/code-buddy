import { describe, expect, it } from 'vitest';
import {
  HARNESS_CONTRACT_VERSION,
  approvalSchema,
  artifactToHarnessProof,
  capabilitySchema,
  harnessArtifactSchema,
  lessonSchema,
  proofSchema,
  runSchema,
  runStoreEventToHarnessEvent,
  runSummaryToHarnessRun,
  scopePathSchema,
  sensitiveActionSchema,
  workflowSchema,
} from '../../src/harness/index.js';

describe('harness contract', () => {
  it('accepts a strict run and partial metrics', () => {
    const run = runSchema.parse({
      kind: 'run',
      schemaVersion: 1,
      id: 'run_123',
      actor: { type: 'agent', id: 'code-buddy', provider: 'gpt-5.5' },
      objective: 'Test Code Buddy Studio end to end.',
      status: 'running',
      startedAt: 1800000000000,
      metrics: { totalTokens: 42 },
    });

    expect(run.metrics?.totalTokens).toBe(42);
    expect(run.metrics?.durationMs).toBeUndefined();
  });

  it('rejects unknown statuses and extra keys', () => {
    expect(() => runSchema.parse({
      kind: 'run',
      schemaVersion: 1,
      id: 'run_123',
      actor: { type: 'agent', id: 'code-buddy' },
      objective: 'Invalid status',
      status: 'paused',
      startedAt: 1,
    })).toThrow();

    expect(() => runSchema.parse({
      kind: 'run',
      schemaVersion: 1,
      id: 'run_123',
      actor: { type: 'agent', id: 'code-buddy' },
      objective: 'Unknown key',
      status: 'running',
      startedAt: 1,
      rogue: true,
    })).toThrow();
  });

  it('normalizes and bounds scope paths', () => {
    expect(scopePathSchema.parse('.\\docs\\qa\\proof.json')).toBe('docs/qa/proof.json');
    expect(() => scopePathSchema.parse('../outside')).toThrow();
    expect(() => scopePathSchema.parse('C:/Users/user/secret.txt')).toThrow();
    expect(() => scopePathSchema.parse('/etc/passwd')).toThrow();
  });

  it('defaults sensitive actions to dry-run', () => {
    const action = sensitiveActionSchema.parse({
      kind: 'sensitive-action',
      schemaVersion: 1,
      id: 'codebuddy.browser_operator.execute',
      name: 'Execute browser operator session',
      riskLevel: 'high',
      requires: 'approval-required',
    });

    expect(action.defaultDryRun).toBe(true);
    expect(action.scope).toEqual([]);
  });

  it('validates proof, approval, lesson, capability and workflow artifacts', () => {
    const approval = approvalSchema.parse({
      kind: 'approval',
      schemaVersion: 1,
      id: 'approval_1',
      target: 'codebuddy.browser_operator.execute',
      decision: 'approved',
      reviewer: 'patrice',
      reason: 'Validated in Cowork.',
      decidedAt: 1800000000001,
    });
    expect(approval.decision).toBe('approved');

    expect(lessonSchema.parse({
      kind: 'lesson',
      schemaVersion: 1,
      id: 'lesson_1',
      tier: 'experience',
      content: 'Browser proof artifacts must carry screenshots or DOM evidence.',
      sourceRunId: 'run_123',
      createdAt: 1800000000002,
    }).policy).toBe('lessons');

    expect(capabilitySchema.parse({
      kind: 'capability',
      schemaVersion: 1,
      id: 'cap_read_browser',
      name: 'Read browser',
      level: 'read',
      policy: 'autonomous',
    }).fleetPolicy).toBe('none');

    expect(workflowSchema.parse({
      kind: 'workflow',
      schemaVersion: 1,
      id: 'wf_1',
      version: 1,
      summary: 'Open, test, prove.',
      nodes: [
        { id: 'trigger', label: 'Start', canvasKind: 'trigger' },
        { id: 'verify', label: 'Verify', canvasKind: 'action', role: 'verification' },
      ],
      edges: [{ source: 'trigger', target: 'verify' }],
    }).nodes).toHaveLength(2);

    const proof = proofSchema.parse({
      kind: 'proof',
      schemaVersion: 1,
      id: 'proof_1',
      runId: 'run_123',
      type: 'artifact',
      createdAt: 1800000000003,
      producedBy: { type: 'agent', id: 'code-buddy' },
      summary: 'Screenshot saved.',
      ref: 'evidence.png',
    });

    expect(harnessArtifactSchema.parse(proof).kind).toBe('proof');
    expect(HARNESS_CONTRACT_VERSION).toBe(1);
  });

  it('adapts existing RunStore summaries, events and artifacts', () => {
    const run = runSummaryToHarnessRun({
      runId: 'run_abc',
      objective: 'Execute a QA bundle.',
      status: 'completed',
      startedAt: 1800000000000,
      endedAt: 1800000000100,
      eventCount: 2,
      artifactCount: 1,
      metadata: {
        channel: 'cowork',
        sessionId: 'session_1',
        tags: ['qa', 'organ:code-buddy'],
      },
    }, { durationMs: 100, toolCallCount: 1 });

    expect(run.actor.id).toBe('code-buddy');
    expect(run.metadata?.channel).toBe('cowork');
    expect(run.metrics?.durationMs).toBe(100);

    expect(runStoreEventToHarnessEvent({
      ts: 1800000000005,
      type: 'tool_call',
      runId: 'run_abc',
      data: { tool: 'browser_operator' },
    }).type).toBe('tool_call');

    const proof = artifactToHarnessProof({
      runId: 'run_abc',
      artifact: 'qa/browser proof.json',
      summary: 'QA browser proof.',
    });
    expect(proof.id).toContain('qa_browser_proof.json');
    expect(proof.ref).toBe('qa/browser proof.json');
  });
});
