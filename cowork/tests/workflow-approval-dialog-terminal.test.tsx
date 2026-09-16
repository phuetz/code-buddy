// @vitest-environment happy-dom
/**
 * ApprovalDialog — the approvals of a workflow run that ended disappear.
 *
 * Events are fed to the real store through the same actions `useIPC` routes
 * `workflow.approval_required` and `workflow.event` to (checked on its source in
 * workflow-approval-terminal-flow.test.ts, with the real bridge and core). Only
 * the IPC answer (`window.electronAPI.workflow.approve`) is a fixture. Closing a
 * finished run's approval never answers it, never touches another run's
 * approval, and leaves the global tool confirmation alone. An answer quotes the
 * request's full identity and removes that request only.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDialog } from '../src/renderer/components/ApprovalDialog';
import { useAppStore } from '../src/renderer/store';
import type { PendingApproval } from '../src/shared/workflow-types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function approval(
  workflowInstanceId: string,
  stepId: string,
  message: string,
  approvalId = `${workflowInstanceId}:${stepId}`
): PendingApproval {
  return { approvalId, workflowInstanceId, stepId, message, expiresAt: Date.now() + 60_000 };
}

function receiveApproval(payload: PendingApproval): void {
  act(() => useAppStore.getState().pushPendingApproval(payload));
}

function receiveRunEnd(type: 'completed' | 'failed', instanceId: string): void {
  act(() =>
    useAppStore
      .getState()
      .applyWorkflowEvent(
        type === 'completed'
          ? { type, workflowId: 'wf', instanceId, output: {} }
          : { type, workflowId: 'wf', instanceId, error: 'Task timeout' }
      )
  );
}

function dialogMessage(): string | null {
  const dialog = screen.queryByRole('dialog');
  return dialog ? within(dialog).getByText(/run/).textContent : null;
}

const globalToolConfirmation = {
  toolUseId: 'tool-use-7',
  toolName: 'bash',
  input: { command: 'ls' },
  sessionId: 'session-1',
};

describe('ApprovalDialog when a workflow run ends', () => {
  let approve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    approve = vi.fn().mockResolvedValue(true);
    (window as unknown as { electronAPI?: unknown }).electronAPI = { workflow: { approve } };
    useAppStore.setState({
      pendingApprovals: [],
      workflowExecutions: {},
      pendingPermission: globalToolConfirmation as never,
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ pendingApprovals: [], workflowExecutions: {}, pendingPermission: null });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it.each(['completed', 'failed'] as const)(
    'closes the approvals of a run that %s, without answering them',
    (type) => {
      render(<ApprovalDialog />);
      receiveApproval(approval('inst-1', 'gate-a', 'run 1, gate a'));
      receiveApproval(approval('inst-1', 'gate-b', 'run 1, gate b'));
      expect(dialogMessage()).toBe('run 1, gate a');

      receiveRunEnd(type, 'inst-1');

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useAppStore.getState().pendingApprovals).toEqual([]);
      expect(approve).not.toHaveBeenCalled();
      expect(useAppStore.getState().pendingPermission).toBe(globalToolConfirmation);
    }
  );

  it('keeps the approvals of another run, and changes nothing when the ended run had none', () => {
    render(<ApprovalDialog />);
    receiveApproval(approval('inst-1', 'gate-a', 'run 1, gate a'));
    receiveApproval(approval('inst-2', 'gate-b', 'run 2, gate b'));

    receiveRunEnd('failed', 'inst-1');
    expect(dialogMessage()).toBe('run 2, gate b');

    const remaining = useAppStore.getState().pendingApprovals;
    receiveRunEnd('completed', 'inst-3');
    expect(useAppStore.getState().pendingApprovals).toBe(remaining);
    expect(dialogMessage()).toBe('run 2, gate b');
    expect(approve).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingPermission).toBe(globalToolConfirmation);
  });

  it('keeps a running workflow’s approval when only one of its nodes ends', () => {
    render(<ApprovalDialog />);
    receiveApproval(approval('inst-1', 'gate-a', 'run 1, gate a'));

    act(() => {
      const { applyWorkflowEvent } = useAppStore.getState();
      applyWorkflowEvent({
        type: 'node_failed',
        workflowId: 'wf',
        instanceId: 'inst-1',
        nodeId: 'other',
        error: 'boom',
      });
      applyWorkflowEvent({
        type: 'node_completed',
        workflowId: 'wf',
        instanceId: 'inst-1',
        nodeId: 'next',
      });
    });

    expect(dialogMessage()).toBe('run 1, gate a');
  });

  it('lets the next run answer while the ended run’s answer is still in flight', async () => {
    const firstAnswer = deferred<boolean>();
    const secondAnswer = deferred<boolean>();
    approve
      .mockReturnValueOnce(firstAnswer.promise)
      .mockReturnValueOnce(secondAnswer.promise);
    render(<ApprovalDialog />);
    receiveApproval(approval('inst-1', 'gate', 'run 1, gate'));

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /approve/i }));
    expect(approve).toHaveBeenCalledWith({
      approvalId: 'inst-1:gate',
      workflowInstanceId: 'inst-1',
      stepId: 'gate',
      approved: true,
    });

    receiveRunEnd('failed', 'inst-1');
    expect(screen.queryByRole('dialog')).toBeNull();
    receiveApproval(approval('inst-2', 'gate', 'run 2, gate'));
    expect(dialogMessage()).toBe('run 2, gate');
    const secondApprove = within(screen.getByRole('dialog')).getByRole('button', {
      name: /approve/i,
    }) as HTMLButtonElement;
    expect(secondApprove.disabled).toBe(false);

    fireEvent.click(secondApprove);
    expect(approve).toHaveBeenNthCalledWith(2, {
      approvalId: 'inst-2:gate',
      workflowInstanceId: 'inst-2',
      stepId: 'gate',
      approved: true,
    });
    expect(secondApprove.disabled).toBe(true);

    await act(async () => {
      firstAnswer.resolve(true);
      await firstAnswer.promise;
    });

    expect(dialogMessage()).toBe('run 2, gate');
    expect(
      (within(screen.getByRole('dialog')).getByRole('button', {
        name: /approve/i,
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(useAppStore.getState().pendingApprovals).toEqual([
      expect.objectContaining({ approvalId: 'inst-2:gate' }),
    ]);
    expect(approve).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondAnswer.resolve(true);
      await secondAnswer.promise;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useAppStore.getState().pendingApprovals).toEqual([]);
  });

  it('answering an approval of a running workflow still removes exactly that approval', async () => {
    render(<ApprovalDialog />);
    receiveApproval(approval('inst-1', 'gate-a', 'run 1, gate a'));
    receiveApproval(approval('inst-1', 'gate-b', 'run 1, gate b'));

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /reject/i }));
    });

    expect(approve).toHaveBeenCalledWith({
      approvalId: 'inst-1:gate-a',
      workflowInstanceId: 'inst-1',
      stepId: 'gate-a',
      approved: false,
    });
    expect(dialogMessage()).toBe('run 1, gate b');
  });

  it('an answer still in flight never removes the same run’s next request for the same step (loop)', async () => {
    const answer = deferred<boolean>();
    approve.mockReturnValueOnce(answer.promise);
    render(<ApprovalDialog />);
    receiveApproval(approval('inst-1', 'gate', 'run 1, iteration 1', 'request-1'));

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /approve/i }));
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ approvalId: 'request-1' }));
    receiveApproval(approval('inst-1', 'gate', 'run 1, iteration 2', 'request-2'));
    expect(dialogMessage()).toBe('run 1, iteration 2');

    await act(async () => {
      answer.resolve(true);
      await answer.promise;
    });

    expect(dialogMessage()).toBe('run 1, iteration 2');
    expect(useAppStore.getState().pendingApprovals).toEqual([
      expect.objectContaining({ approvalId: 'request-2' }),
    ]);
    expect(approve).toHaveBeenCalledTimes(1);
  });
});
