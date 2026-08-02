import { describe, expect, it, vi } from 'vitest';
import { RemoteApprovalService } from '../../src/security/remote-approval.js';

function requestIdFrom(message: string): string {
  const match = message.match(/Request ID: `([^`]+)`/);
  if (!match?.[1]) throw new Error('request id missing');
  return match[1];
}

describe('RemoteApprovalService identity binding', () => {
  it('uses an unguessable UUID and accepts the matching initiator', async () => {
    const service = new RemoteApprovalService();
    let id = '';
    service.registerChannel('telegram', async (message) => { id = requestIdFrom(message); }, 'session-a');
    const pending = service.requestApproval({
      toolName: 'bash', summary: 'npm test', initiator: 'session-a', timeoutMs: 1_000,
    });
    await vi.waitFor(() => expect(id).toMatch(/^approval-[0-9a-f-]{36}$/));
    expect(service.handleResponse(id, true, 'session-a')).toBe('accepted');
    await expect(pending).resolves.toBe(true);
  });

  it('rejects another identity and a missing responder without consuming the request', async () => {
    const service = new RemoteApprovalService();
    let id = '';
    service.registerChannel('telegram', async (message) => { id = requestIdFrom(message); }, 'session-a');
    const pending = service.requestApproval({
      toolName: 'bash', summary: 'npm publish', initiator: 'session-a', timeoutMs: 1_000,
    });
    await vi.waitFor(() => expect(id).not.toBe(''));
    expect(service.handleResponse(id, true, 'session-b')).toBe('identity_mismatch');
    expect(service.handleResponse(id, true)).toBe('identity_mismatch');
    expect(service.getPending()).toHaveLength(1);
    expect(service.handleResponse(id, false, 'session-a')).toBe('accepted');
    await expect(pending).resolves.toBe(false);
  });

  it('routes simultaneous requests only to their initiating sessions', async () => {
    const service = new RemoteApprovalService();
    const sentA: string[] = [];
    const sentB: string[] = [];
    service.registerChannel('telegram', async (message) => { sentA.push(message); }, 'session-a');
    service.registerChannel('telegram', async (message) => { sentB.push(message); }, 'session-b');

    const pendingA = service.requestApproval({
      toolName: 'bash', summary: 'A', initiator: 'session-a', timeoutMs: 1_000,
    });
    const pendingB = service.requestApproval({
      toolName: 'bash', summary: 'B', initiator: 'session-b', timeoutMs: 1_000,
    });
    await vi.waitFor(() => {
      expect(sentA).toHaveLength(1);
      expect(sentB).toHaveLength(1);
    });
    const idA = requestIdFrom(sentA[0]!);
    const idB = requestIdFrom(sentB[0]!);
    expect(idA).not.toBe(idB);
    service.handleResponse(idA, true, 'session-a');
    service.handleResponse(idB, false, 'session-b');
    await expect(pendingA).resolves.toBe(true);
    await expect(pendingB).resolves.toBe(false);
  });

  it('does not lose a response received while the channel send is pending', async () => {
    const service = new RemoteApprovalService();
    service.registerChannel('telegram', async (message) => {
      expect(service.handleResponse(requestIdFrom(message), true, 'session-a')).toBe('accepted');
      await Promise.resolve();
    }, 'session-a');
    await expect(service.requestApproval({
      toolName: 'bash', summary: 'fast', initiator: 'session-a', timeoutMs: 1_000,
    })).resolves.toBe(true);
  });

  it('reports unknown requests explicitly', () => {
    expect(new RemoteApprovalService().handleResponse('approval-missing', true, 'session-a'))
      .toBe('unknown');
  });

  it('expires even when channel delivery never settles and emits requested first', async () => {
    vi.useFakeTimers();
    try {
      const service = new RemoteApprovalService();
      const events: string[] = [];
      let captureMessage!: (message: string) => void;
      const messageSent = new Promise<string>((resolve) => { captureMessage = resolve; });
      service.on('approval-requested', () => events.push('requested'));
      service.on('approval-expired', () => events.push('expired'));
      service.registerChannel('telegram', async (message) => {
        captureMessage(message);
        await new Promise<void>(() => undefined);
      }, 'session-a');

      const pending = service.requestApproval({
        toolName: 'bash', summary: 'hung transport', initiator: 'session-a', timeoutMs: 25,
      });
      await messageSent;
      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toBe(false);
      expect(events).toEqual(['requested', 'expired']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('scopes registration cleanup without deleting a newer replacement', () => {
    const service = new RemoteApprovalService();
    const disposeOld = service.registerChannel('telegram', async () => undefined, 'session-a');
    const disposeNew = service.registerChannel('telegram', async () => undefined, 'session-a');

    disposeNew();
    expect(service.hasChannelForIdentity('session-a')).toBe(true);
    disposeOld();
    expect(service.hasChannelForIdentity('session-a')).toBe(false);
  });

  it('preserves legacy type-wide channel discovery and unregistration', () => {
    const service = new RemoteApprovalService();
    service.registerChannel('telegram', async () => undefined, 'session-a');
    service.registerChannel('telegram', async () => undefined, 'session-b');

    expect(service.hasChannels()).toBe(true);
    service.unregisterChannel('telegram');
    expect(service.hasChannels()).toBe(false);
  });
});
