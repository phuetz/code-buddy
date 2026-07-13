import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowVisualDefinition } from '../src/shared/workflow-types';
import {
  diagnoseWorkflowFailure,
  previewWorkflow,
  workflowToolRequiresConfirmation,
  WorkflowRunStore,
} from '../src/main/workflows/workflow-supervisor';

const directories: string[] = [];

function definition(toolName = 'search'): WorkflowVisualDefinition {
  return {
    id: 'wf-test',
    name: 'Test',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', position: { x: 0, y: 0 } },
      { id: 'tool', type: 'tool', name: 'Tool', position: { x: 1, y: 0 }, config: { toolName, toolInput: {} } },
      { id: 'end', type: 'end', name: 'End', position: { x: 2, y: 0 } },
    ],
    edges: [
      { id: 'a', source: 'start', target: 'tool' },
      { id: 'b', source: 'tool', target: 'end' },
    ],
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('workflow supervision', () => {
  it('uses the production compiler for a side-effect-free execution plan', () => {
    const result = previewWorkflow(definition('publish_article'));
    expect(result.valid).toBe(true);
    expect(result.totalExecutableSteps).toBe(1);
    expect(result.externalToolSteps).toBe(1);
    expect(result.definitionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.steps.some((step) => step.toolName === 'publish_article')).toBe(true);
  });

  it('classifies compound and unknown workflow tools fail-closed', () => {
    expect(workflowToolRequiresConfirmation('search_files')).toBe(false);
    expect(workflowToolRequiresConfirmation('get_then_delete')).toBe(true);
    expect(workflowToolRequiresConfirmation('list_and_update')).toBe(true);
    expect(workflowToolRequiresConfirmation('download_report')).toBe(true);
    expect(workflowToolRequiresConfirmation('mark_as_read')).toBe(true);
    expect(workflowToolRequiresConfirmation('archive_thread')).toBe(true);
    expect(workflowToolRequiresConfirmation('ack_alert')).toBe(true);
    expect(workflowToolRequiresConfirmation('custom_capability')).toBe(true);
  });

  it('returns the exact compiler failure instead of a permissive preview', () => {
    const invalid = definition();
    invalid.nodes[1] = { id: 'tool', type: 'tool', name: 'Tool', position: { x: 1, y: 0 } };
    const result = previewWorkflow(invalid);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing config.toolName');
  });

  it('persists redacted runs, diagnostics and comparisons', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-history-'));
    directories.push(directory);
    const file = join(directory, 'runs.json');
    const store = new WorkflowRunStore(file);
    const first = store.create(definition(), {
      apiToken: 'secret-value',
      query: 'authorization=also-secret',
    }, 'manual');
    store.finish(first, {
      success: false,
      status: 'failed',
      duration: 10,
      completedSteps: 0,
      totalSteps: 1,
      error: 'Tool not found: search',
    }, [{ type: 'node_failed', workflowId: 'wf-test', instanceId: 'i', nodeId: 'tool', error: 'Tool not found' }]);
    const second = store.create(definition(), { query: 'ok' }, 'replay', first.id);
    store.finish(second, {
      success: true,
      status: 'completed',
      duration: 5,
      completedSteps: 1,
      totalSteps: 1,
    }, []);

    const records = store.list('wf-test');
    expect(records).toHaveLength(2);
    expect(records[1].initialContext.apiToken).toBe('[REDACTED]');
    expect(records[1].initialContext.query).toBe('authorization=[REDACTED]');
    expect(records[1].diagnostic?.category).toBe('tool_missing');
    expect(store.compare(first.id, second.id)).toMatchObject({
      sameDefinition: true,
      statusChanged: true,
      durationDeltaMs: -5,
      completedStepsDelta: 1,
    });
    expect(readFileSync(file, 'utf8')).not.toContain('secret-value');
    expect(readFileSync(file, 'utf8')).not.toContain('also-secret');
  });

  it('bounds oversized tool outputs and event histories', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-history-bounded-'));
    directories.push(directory);
    const file = join(directory, 'runs.json');
    const store = new WorkflowRunStore(file);
    const record = store.create(definition(), {}, 'manual');
    store.finish(record, {
      success: false,
      status: 'failed',
      duration: 1,
      completedSteps: 0,
      totalSteps: 1,
      error: 'x'.repeat(2 * 1024 * 1024),
    }, Array.from({ length: 500 }, (_value, index) => ({
      type: 'node_failed' as const,
      workflowId: 'wf-test',
      instanceId: 'instance',
      nodeId: `node-${index}`,
      error: 'y'.repeat(64 * 1024),
    })));

    const persisted = readFileSync(file, 'utf8');
    expect(Buffer.byteLength(persisted, 'utf8')).toBeLessThan(2 * 1024 * 1024);
    expect(persisted).toContain('TRUNCATED BY WORKFLOW HISTORY LIMIT');
    expect(store.list()[0]!.events.length).toBeLessThanOrEqual(201);
  });

  it('offers guided actions without executing repairs', () => {
    const diagnostic = diagnoseWorkflowFailure({
      success: false,
      status: 'failed',
      duration: 1,
      completedSteps: 0,
      totalSteps: 1,
      error: 'OAuth 401 unauthorized',
    }, []);
    expect(diagnostic?.category).toBe('authentication');
    expect(diagnostic?.suggestedActions[0].safeAutomatic).toBe(false);
  });

  it('diagnoses a redacted replay as requiring fresh secret input', () => {
    const diagnostic = diagnoseWorkflowFailure({
      success: false,
      status: 'failed',
      duration: 0,
      completedSteps: 0,
      totalSteps: 1,
      error: 'Secret input required: stored snapshot contains a redacted value',
    }, []);
    expect(diagnostic?.category).toBe('secret_input');
    expect(diagnostic?.suggestedActions[0]).toMatchObject({ safeAutomatic: false });
  });
});
