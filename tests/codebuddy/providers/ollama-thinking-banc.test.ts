import { expect, it } from 'vitest';
import { streamOllamaNative, fromOllamaNativeResponse, toOllamaNativeMessages } from '../../../src/codebuddy/providers/ollama-native-transport.js';
import { reduceStreamChunk } from '../../../src/agent/streaming/message-reducer.js';

it('retains native thinking across chunks and sends it back with the tool result', async () => {
  const data = [
    { message: { role: 'assistant', thinking: 'Inspect the test. ' }, done: false },
    { message: { role: 'assistant', thinking: 'Then edit the implementation.' }, done: false },
    { message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_read', function: { name: 'view_file', arguments: { path: 'src/example.ts' } } }] }, done: false },
    { message: { role: 'assistant', content: '' }, done: true },
  ];
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const part of data) controller.enqueue(new TextEncoder().encode(JSON.stringify(part) + '\n'));
    controller.close();
  } });
  let accumulated: Record<string, unknown> = {};
  for await (const chunk of streamOllamaNative(body, 'qwen3.8:27b')) accumulated = reduceStreamChunk(accumulated, chunk);
  expect(accumulated.ollama_thinking).toBe('Inspect the test. Then edit the implementation.');
  expect(accumulated.content ?? '').toBe('');
  const messages = toOllamaNativeMessages([
    { ...accumulated, role: 'assistant', content: '' },
    { role: 'tool', tool_call_id: 'call_read', content: 'source text' },
  ]);
  expect(messages[0]?.thinking).toBe(accumulated.ollama_thinking);
  expect(messages[0]).not.toHaveProperty('ollama_thinking');
  expect(messages[1]?.tool_name).toBe('view_file');
});

it('also preserves thinking on non-streaming native completions', () => {
  const response = fromOllamaNativeResponse({ message: { role: 'assistant', thinking: 'A retained observation', content: 'Done' }, done: true }, 'qwen3.8:27b');
  expect(response).toMatchObject({ choices: [{ message: { content: 'Done', ollama_thinking: 'A retained observation' } }] });
});
