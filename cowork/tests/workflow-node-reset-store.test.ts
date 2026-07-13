import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/renderer/store';

describe('workflow node reset events', () => {
  beforeEach(() => {
    useAppStore.setState({ workflowExecutions: {} });
  });

  it('returns a completed loop body node to pending for the next iteration', () => {
    const eventBase = {
      workflowId: 'workflow-1',
      instanceId: 'instance-1',
      nodeId: 'body-node',
    };

    useAppStore.getState().applyWorkflowEvent({
      type: 'node_completed',
      ...eventBase,
    });
    expect(
      useAppStore.getState().workflowExecutions['instance-1'].nodeStatuses['body-node']
    ).toBe('completed');

    useAppStore.getState().applyWorkflowEvent({
      type: 'node_reset',
      ...eventBase,
    });
    expect(
      useAppStore.getState().workflowExecutions['instance-1'].nodeStatuses['body-node']
    ).toBe('pending');
  });
});
