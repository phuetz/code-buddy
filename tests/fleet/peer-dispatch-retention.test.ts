import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _listDispatchesForTests,
  _unwireForTests,
  dispatchPeerTask,
  getDispatchState,
} from '../../src/fleet/peer-chat-bridge.js';
import { dispatchPeerRequest, type PeerMethodContext } from '../../src/server/websocket/peer-rpc.js';

const ctx: PeerMethodContext = {
  connectionId: 'retention-test',
  scopes: ['peer:invoke'],
  traceId: 'trace-retention',
  depth: 0,
};

describe('peer.dispatch retention', () => {
  beforeEach(() => {
    _unwireForTests();
    delete process.env.CODEBUDDY_PEER_DISPATCH_TTL_MS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_PEER_DISPATCH_TTL_MS;
    _unwireForTests();
  });

  it('caps completed dispatches and evicts the oldest entries first', async () => {
    for (let index = 0; index < 600; index++) {
      dispatchPeerTask({ runId: `run-${index}`, prompt: `task ${index}` });
    }

    expect(_listDispatchesForTests()).toHaveLength(500);
    expect(getDispatchState('run-0')).toBeNull();
    expect(getDispatchState('run-599')).not.toBeNull();

    const status = await dispatchPeerRequest(
      { id: 'status-1', method: 'peer.dispatchStatus', params: { runId: 'run-0' } },
      ctx,
    );
    expect(status).toMatchObject({ ok: true, payload: { found: false } });
  });

  it('purges terminal dispatches after the configured TTL', () => {
    process.env.CODEBUDDY_PEER_DISPATCH_TTL_MS = '100';
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    dispatchPeerTask({ runId: 'expired', prompt: 'old task' });
    expect(getDispatchState('expired')?.status).toBe('failed');

    now.mockReturnValue(1_101);
    dispatchPeerTask({ runId: 'fresh', prompt: 'new task' });

    expect(getDispatchState('expired')).toBeNull();
    expect(getDispatchState('fresh')).not.toBeNull();
  });
});
