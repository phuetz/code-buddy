import { describe, expect, it } from 'vitest';
import { streamOllamaNative } from '../../../src/codebuddy/providers/ollama-native-transport.js';
import { StreamingHandler } from '../../../src/agent/streaming/streaming-handler.js';

async function accumulate(frames: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n'));
      controller.close();
    },
  });
  const handler = new StreamingHandler({ trackTokens: false, model: 'local-fixture' });
  for await (const chunk of streamOllamaNative(body, 'local-fixture')) {
    handler.accumulateChunk(chunk as Parameters<StreamingHandler['accumulateChunk']>[0]);
  }
  return handler.getAccumulatedMessage().tool_calls;
}

const frame = (id: string | undefined, index: number | undefined, path: string) => ({
  message: { tool_calls: [{ ...(id ? { id } : {}), function: { ...(index === undefined ? {} : { index }), name: 'view_file', arguments: { path } } }] },
});

describe('native call identity spans NDJSON frames', () => {
  it('keeps the two calls observed on the real daemon separate in the actual accumulator', async () => {
    const calls = await accumulate([frame('first', 0, 'AGENTS.md'), frame('second', 1, 'lib/worker.cjs'), { done: true }]);
    expect(calls).toHaveLength(2);
    expect(calls?.map(call => call.function.name)).toEqual(['view_file', 'view_file']);
    expect(calls?.map(call => JSON.parse(call.function.arguments))).toEqual([{ path: 'AGENTS.md' }, { path: 'lib/worker.cjs' }]);
  });

  it.each([true, false])('assigns distinct identities across frames when the index is absent (IDs: %s)', async ids => {
    const calls = await accumulate([frame(ids ? 'first' : undefined, undefined, 'a.js'), frame(ids ? 'second' : undefined, undefined, 'b.js')]);
    expect(calls).toHaveLength(2);
    expect(new Set(calls?.map(call => call.id)).size).toBe(2);
    expect(calls?.map(call => JSON.parse(call.function.arguments))).toEqual([{ path: 'a.js' }, { path: 'b.js' }]);
  });

  it('does not execute an identical complete native call twice', async () => {
    const calls = await accumulate([frame('first', 0, 'a.js'), frame('first', 0, 'a.js')]);
    expect(calls).toHaveLength(1);
    expect(calls?.[0]?.function.name).toBe('view_file');
    expect(JSON.parse(calls![0]!.function.arguments)).toEqual({ path: 'a.js' });
  });

  it('fails loudly when two different calls claim the same native index', async () => {
    await expect(accumulate([frame('first', 0, 'a.js'), frame('second', 0, 'b.js')])).rejects.toThrow(/identity|index/i);
  });

  it('does not reuse a generated ID in another response', async () => {
    const first = await accumulate([frame(undefined, undefined, 'a.js')]);
    const second = await accumulate([frame(undefined, undefined, 'a.js')]);
    expect(first?.[0]?.id).not.toBe(second?.[0]?.id);
  });
});

it('keeps length termination visible even when a native response has tools', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...frame('first', 0, 'a.js'), done: true, done_reason: 'length' }) + '\n'));
    controller.close();
  } });
  const chunks = [];
  for await (const chunk of streamOllamaNative(body, 'local-fixture')) chunks.push(chunk);
  expect(chunks[0]?.choices[0]?.finish_reason).toBe('length');
});
