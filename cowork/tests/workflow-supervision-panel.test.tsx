/** @vitest-environment happy-dom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowSupervisionPanel } from '../src/renderer/components/settings/WorkflowSupervisionPanel';

const history = [{
  id: 'run-2',
  workflowId: 'wf-1',
  workflowName: 'Publish',
  source: 'replay' as const,
  replayOf: 'run-1',
  definitionHash: 'hash',
  definition: { id: 'wf-1', name: 'Publish', nodes: [], edges: [] },
  initialContext: {},
  startedAt: 2,
  completedAt: 3,
  result: { success: true, status: 'completed' as const, duration: 5, completedSteps: 1, totalSteps: 1 },
  events: [],
}, {
  id: 'run-1',
  workflowId: 'wf-1',
  workflowName: 'Publish',
  source: 'manual' as const,
  definitionHash: 'hash',
  definition: { id: 'wf-1', name: 'Publish', nodes: [], edges: [] },
  initialContext: {},
  startedAt: 1,
  completedAt: 2,
  result: { success: false, status: 'failed' as const, duration: 10, completedSteps: 0, totalSteps: 1, error: 'OAuth 401' },
  events: [],
  diagnostic: {
    category: 'authentication' as const,
    title: 'The connector must be authenticated again',
    explanation: 'OAuth 401',
    suggestedActions: [{ id: 'open', label: 'Open connectors', description: 'Reconnect.', safeAutomatic: false as const }],
  },
}];

const workflow = {
  preview: vi.fn(async () => ({
    valid: true,
    workflowId: 'wf-1',
    definitionHash: 'hash',
    generatedAt: 1,
    totalExecutableSteps: 1,
    approvalSteps: 0,
    externalToolSteps: 1,
    steps: [{ id: 'tool', kind: 'task' as const, label: 'Publish', depth: 0, toolName: 'publish', requiresApproval: false }],
    warnings: ['1 external action'],
  })),
  history: vi.fn(async () => history),
  replay: vi.fn(async () => ({ success: true })),
  compare: vi.fn(async () => ({
    leftRunId: 'run-1',
    rightRunId: 'run-2',
    sameDefinition: true,
    statusChanged: true,
    durationDeltaMs: -5,
    completedStepsDelta: 1,
    changedError: true,
    summary: ['Status changed from failed to completed.'],
  })),
};

describe('WorkflowSupervisionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: unknown }).electronAPI = { workflow };
  });

  afterEach(cleanup);

  it('renders compiled preview, persistent history and guided diagnosis', async () => {
    render(<WorkflowSupervisionPanel workflowId="wf-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Compilation valide')).toBeTruthy();
    expect(screen.getByText('The connector must be authenticated again')).toBeTruthy();
    expect(screen.getAllByText('Rejouer')).toHaveLength(2);
  });

  it('compares and replays stored runs', async () => {
    render(<WorkflowSupervisionPanel workflowId="wf-1" onClose={vi.fn()} />);
    await screen.findByText('Compilation valide');
    fireEvent.click(screen.getByText('Comparer les 2 derniers'));
    await waitFor(() => expect(workflow.compare).toHaveBeenCalledWith('run-1', 'run-2'));
    expect(await screen.findByText('Status changed from failed to completed.')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Rejouer')[0]);
    await waitFor(() => expect(workflow.replay).toHaveBeenCalledWith('run-2'));
  });
});
