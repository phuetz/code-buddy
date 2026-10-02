import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchPeerRequest, registerPeerMethod, unregisterPeerMethod } from '../../src/server/websocket/peer-rpc.js';

const ctx = { connectionId: 'connection-1', principalId: 'user:creator', scopes: ['peer:invoke'], traceId: '', depth: 0 };
afterEach(() => { unregisterPeerMethod('test.effect'); vi.useRealTimers(); });

describe('optional peer RPC idempotency', () => {
  it('deduplicates in flight and replays completed response across reconnect', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const effect = vi.fn(async () => { await wait; return { value: 'executed' }; });
    registerPeerMethod('test.effect', effect);
    const frame = { id: 'first', method: 'test.effect', idempotencyKey: 'retry-effect-1', params: { prompt: 'same' } };
    const first = dispatchPeerRequest(frame, ctx);
    const second = dispatchPeerRequest({ ...frame, id: 'retry' }, { ...ctx, connectionId: 'connection-2' });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true); expect(b).toEqual({ ...a, id: 'retry' });
    expect(effect).toHaveBeenCalledTimes(1);
    expect((await dispatchPeerRequest({ ...frame, id: 'later' }, ctx)).payload).toEqual(a.payload);
    expect(effect).toHaveBeenCalledTimes(1);
    const conflict = await dispatchPeerRequest({ ...frame, params: { prompt: 'changed' } }, ctx);
    expect(conflict.error?.code).toBe('IDEMPOTENCY_CONFLICT');
    await dispatchPeerRequest(frame, { ...ctx, principalId: 'user:other' });
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('replays streaming chunks and does not rerun a failed effect', async () => {
    const effect = vi.fn(async (_params, context) => { context.emitChunk?.('partial'); throw new Error('cut'); });
    registerPeerMethod('test.effect', effect);
    const frame = { id: 'stream', method: 'test.effect', idempotencyKey: 'retry-stream-1' };
    const chunks: string[] = [];
    const first = await dispatchPeerRequest(frame, { ...ctx, emitChunk: delta => chunks.push(delta) });
    const retry = await dispatchPeerRequest({ ...frame, id: 'retry' }, { ...ctx, emitChunk: delta => chunks.push(delta) });
    expect(retry).toEqual({ ...first, id: 'retry' });
    expect(chunks).toEqual(['partial', 'partial']);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});

it('expires completed keys after five minutes and does not replay under changed scopes', async () => {
  vi.useFakeTimers();
  const effect = vi.fn(async () => 'effect');
  registerPeerMethod('test.effect', effect);
  const frame = { id: 'ttl', method: 'test.effect', idempotencyKey: 'retry-ttl-1' };
  await dispatchPeerRequest(frame, ctx);
  const downgraded = await dispatchPeerRequest(frame, { ...ctx, scopes: [] });
  expect(downgraded.error?.code).toBe('IDEMPOTENCY_CONFLICT');
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
  await dispatchPeerRequest(frame, ctx);
  expect(effect).toHaveBeenCalledTimes(2);
});

it('leaves requests without an optional key independently executable', async () => {
  const effect = vi.fn(async () => 'effect');
  registerPeerMethod('test.effect', effect);
  await Promise.all([dispatchPeerRequest({ id: 'one', method: 'test.effect' }, ctx), dispatchPeerRequest({ id: 'two', method: 'test.effect' }, ctx)]);
  expect(effect).toHaveBeenCalledTimes(2);
});
