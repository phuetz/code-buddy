import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { streamOllamaNative } from '../../../src/codebuddy/providers/ollama-native-transport.js';
import { reduceStreamChunk } from '../../../src/agent/streaming/message-reducer.js';

const recorded = readFileSync(new URL('../../fixtures/ollama-banc-two-calls.ndjson', import.meta.url), 'utf8');
async function replay(lines: string) {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    // Exercise byte framing independently from native chunk framing.
    // This fixture contains only tool snapshots, so finish the test response explicitly.
    const bytes = new TextEncoder().encode(lines.trimEnd() + '\n{"done":true,"done_reason":"stop"}\n');
    for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17));
    controller.close();
  } });
  let message: Record<string, unknown> = {};
  for await (const chunk of streamOllamaNative(body, 'qwen3.8:27b')) message = reduceStreamChunk(message, chunk);
  return message.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>;
}

describe('replay du banc Ollama (chemins anonymisés, appels natifs inchangés)', () => {
  it('transmet deux appels JSON indépendants au vrai réducteur, une exécution par ID', async () => {
    const calls = await replay(recorded);
    expect(calls).toHaveLength(2);
    const execute = vi.fn();
    for (const call of calls) {
      expect(call.function.name).toBe('bash');
      execute(call.id, JSON.parse(call.function.arguments));
    }
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['call_z96yk7nv', 'call_j4xs67u8']);
    expect(new Set(execute.mock.calls.map(([id]) => id)).size).toBe(2);
  });

  it('alloue des identités stables sans index ni ID et ne fusionne pas les chunks', async () => {
    const lines = recorded.trim().split('\n').map(line => {
      const data = JSON.parse(line);
      for (const call of data.message.tool_calls) { delete call.id; delete call.function.index; }
      return JSON.stringify(data);
    }).join('\n');
    const calls = await replay(lines);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map(call => call.id)).size).toBe(2);
    for (const call of calls) expect(() => JSON.parse(call.function.arguments)).not.toThrow();
  });

  it('ne répète pas un snapshot complet avec le même ID', async () => {
    const calls = await replay(recorded + recorded);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.function.name).toBe('bash');
  });
});
