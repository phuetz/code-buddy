/**
 * Phase d.23 — tests for the ChatGPT Codex Responses provider.
 *
 * Three layers exercised:
 *   1. Pure helpers (`convertMessages`, `flattenTools`, `buildRequestBody`)
 *      that turn chat/completions input into the Codex Responses shape.
 *   2. The SSE parser, fed a hand-rolled ReadableStream of the
 *      4 event kinds we handle (and one we ignore).
 *   3. The `chatStream()` end-to-end with `global.fetch` mocked, to verify
 *      headers (Authorization / ChatGPT-Account-ID / originator), the
 *      400/404 model_not_found error message, and 401 → refresh → retry.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  convertMessages,
  flattenTools,
  buildRequestBody,
  parseSseStream,
  isFreshUserTurn,
  ChatGptResponsesProvider,
} from '../../../src/codebuddy/providers/provider-chatgpt-responses.js';
import type { ChatGptAuth } from '../../../src/providers/codex-oauth.js';
import type { CodeBuddyMessage, CodeBuddyTool } from '../../../src/codebuddy/client.js';
import { reduceStreamChunk } from '../../../src/agent/streaming/message-reducer.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Pure helpers ────────────────────────────────────────────────

describe('convertMessages — chat/completions → Codex Responses input shape', () => {
  it('puts system message into instructions, user goes into input', () => {
    const out = convertMessages([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ] as CodeBuddyMessage[]);
    expect(out.instructions).toBe('You are helpful.');
    expect(out.input).toHaveLength(1);
    expect(out.input[0]).toMatchObject({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hi' }],
    });
  });

  it('joins multiple system messages with double newline', () => {
    const out = convertMessages([
      { role: 'system', content: 'rule 1' },
      { role: 'system', content: 'rule 2' },
      { role: 'user', content: 'go' },
    ] as CodeBuddyMessage[]);
    expect(out.instructions).toBe('rule 1\n\nrule 2');
  });

  it('converts assistant tool_calls to function_call items', () => {
    const out = convertMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'foo', arguments: '{"x":1}' } },
        ],
      },
    ] as unknown as CodeBuddyMessage[]);
    expect(out.input).toHaveLength(1);
    expect(out.input[0]).toMatchObject({
      type: 'function_call',
      name: 'foo',
      arguments: '{"x":1}',
      call_id: 'call_1',
    });
  });

  it('converts tool result messages to function_call_output items', () => {
    const out = convertMessages([
      { role: 'tool', tool_call_id: 'call_1', content: 'result-text' },
    ] as unknown as CodeBuddyMessage[]);
    expect(out.input).toHaveLength(1);
    expect(out.input[0]).toMatchObject({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'result-text',
    });
  });

  it('handles assistant messages with both text and tool_calls', () => {
    const out = convertMessages([
      {
        role: 'assistant',
        content: 'Calling tool now',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'bar', arguments: '{}' } },
        ],
      },
    ] as unknown as CodeBuddyMessage[]);
    // First the function_call, then the assistant text.
    expect(out.input).toHaveLength(2);
    expect(out.input[0].type).toBe('function_call');
    expect(out.input[1]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Calling tool now' }],
    });
  });

  it('omits instructions when there are no system messages', () => {
    const out = convertMessages([{ role: 'user', content: 'X' }] as CodeBuddyMessage[]);
    expect(out.instructions).toBeUndefined();
  });

  it('prepends prior reasoning items only when an assistant tool round exists', () => {
    const reasoning = [{ type: 'reasoning' as const, encrypted_content: 'blob-1' }];

    // No assistant round yet → reasoning blobs are skipped.
    const fresh = convertMessages(
      [{ role: 'user', content: 'first turn' }] as CodeBuddyMessage[],
      reasoning,
    );
    expect(fresh.input.find((it) => it.type === 'reasoning')).toBeUndefined();

    // Assistant tool round present → reasoning prepended.
    const midTurn = convertMessages(
      [
        { role: 'user', content: 'find the bug' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'grep', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'match found' },
      ] as unknown as CodeBuddyMessage[],
      reasoning,
    );
    expect(midTurn.input[0]).toEqual({ type: 'reasoning', encrypted_content: 'blob-1' });
  });
});

describe('isFreshUserTurn — turn boundary detection', () => {
  it('true when no messages yet', () => {
    expect(isFreshUserTurn([])).toBe(true);
  });

  it('true when last message is a user message with nothing after', () => {
    expect(isFreshUserTurn([
      { role: 'system', content: 'x' },
      { role: 'user', content: 'hello' },
    ] as CodeBuddyMessage[])).toBe(true);
  });

  it('false when an assistant message follows the last user message', () => {
    expect(isFreshUserTurn([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ] as CodeBuddyMessage[])).toBe(false);
  });

  it('false when a tool result follows the last user message (mid-turn)', () => {
    expect(isFreshUserTurn([
      { role: 'user', content: 'X' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'foo', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ] as unknown as CodeBuddyMessage[])).toBe(false);
  });
});

describe('flattenTools — chat/completions tool format → Codex Responses', () => {
  it('hoists the function fields to the top level (no nested `function`)', () => {
    const tools: CodeBuddyTool[] = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ];
    const out = flattenTools(tools);
    expect(out[0]).toMatchObject({
      type: 'function',
      name: 'search',
      description: 'Search the web',
      parameters: { type: 'object' },
    });
    expect((out[0] as Record<string, unknown>).function).toBeUndefined();
  });
});

describe('buildRequestBody — assembled body matches Codex Responses contract', () => {
  it('sets defaults: tool_choice=auto, parallel_tool_calls=true, store=false, stream=true', () => {
    const body = buildRequestBody({
      model: 'gpt-5.5',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [],
    });
    expect(body.model).toBe('gpt-5.5');
    expect(body.tool_choice).toBe('auto');
    expect(body.parallel_tool_calls).toBe(true);
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
  });

  it('falls back to a minimal default for instructions when none supplied (backend rejects empty)', () => {
    // The ChatGPT Codex backend rejects requests with missing/empty
    // instructions: { detail: "Instructions are required" }. So we ship
    // a non-empty default rather than omitting the field entirely.
    const body = buildRequestBody({
      model: 'gpt-5.5',
      input: [],
      tools: [],
    });
    expect(body.instructions).toBeTruthy();
    expect(body.instructions!.length).toBeGreaterThan(0);
    expect(body.tools).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it('uses the caller-supplied instructions when present', () => {
    const body = buildRequestBody({
      model: 'gpt-5.5',
      instructions: 'You are a French chef.',
      input: [],
      tools: [],
    });
    expect(body.instructions).toBe('You are a French chef.');
  });

  it('includes reasoning.effort when reasoningEffort is set', () => {
    const body = buildRequestBody({
      model: 'gpt-5.5',
      input: [],
      tools: [],
      reasoningEffort: 'high',
    });
    expect(body.reasoning).toEqual({ effort: 'high' });
  });

  it('sets include: ["reasoning.encrypted_content"] when includeEncryptedReasoning is true', () => {
    const body = buildRequestBody({
      model: 'gpt-5.5',
      input: [],
      tools: [],
      includeEncryptedReasoning: true,
    });
    expect(body.include).toEqual(['reasoning.encrypted_content']);
  });

  it('omits include field when includeEncryptedReasoning is false', () => {
    const body = buildRequestBody({
      model: 'gpt-5.5',
      input: [],
      tools: [],
    });
    expect(body.include).toBeUndefined();
  });

  it('includes prompt_cache_key when set (helps the backend cache)', () => {
    const body = buildRequestBody({
      model: 'gpt-5.5',
      input: [],
      tools: [],
      promptCacheKey: 'thread-abc',
    });
    expect(body.prompt_cache_key).toBe('thread-abc');
  });

  it('does not serialize maxTokens because the Codex backend rejects max_output_tokens', () => {
    const body = buildRequestBody({
      model: 'gpt-5.5',
      input: [],
      tools: [],
      maxTokens: 1234,
    });
    expect((body as Record<string, unknown>).max_output_tokens).toBeUndefined();
  });
});

// ─── 2. SSE parser ──────────────────────────────────────────────────

function makeSseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(ev));
      }
      controller.close();
    },
  });
}

describe('parseSseStream — Codex SSE → OpenAI ChatCompletionChunk', () => {
  it('emits content chunks for output_text.delta events', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);

    const chunks: Array<string | undefined> = [];
    let finished = false;
    for await (const chunk of parseSseStream(stream, 'gpt-5.5')) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) chunks.push(delta.content);
      if (chunk.choices[0]?.finish_reason === 'stop') finished = true;
    }
    expect(chunks).toEqual(['Hello', ' world']);
    expect(finished).toBe(true);
  });

  it('maps Responses usage onto the final completion chunk', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":30,"total_tokens":150,"input_tokens_details":{"cached_tokens":80}}}}\n\n',
    ]);

    const chunks = [];
    for await (const chunk of parseSseStream(stream, 'gpt-5.5')) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)?.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      cached_tokens: 80,
    });
  });

  it('emits tool_calls on output_item.done with type=function_call', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"search","arguments":"{\\"q\\":\\"X\\"}","call_id":"c1"}}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);

    const toolCalls: Array<{ name: string; id: string; args: string }> = [];
    for await (const chunk of parseSseStream(stream, 'gpt-5.5')) {
      const tcs = chunk.choices[0]?.delta?.tool_calls;
      if (tcs) {
        for (const tc of tcs) {
          if (tc.id && tc.function?.name) {
            toolCalls.push({
              id: tc.id,
              name: tc.function.name,
              args: tc.function.arguments ?? '',
            });
          }
        }
      }
    }
    expect(toolCalls).toEqual([{ id: 'c1', name: 'search', args: '{"q":"X"}' }]);
  });

  it('assigns a distinct index to each parallel function_call (regression: call_id concatenation)', async () => {
    // Two parallel tool calls arrive as separate output_item.done events.
    // Before the fix every function_call was emitted with index:0, so the
    // downstream message-reducer merged them into one slot — concatenating
    // names ("aa"), call_ids ("c1c2", >64 chars in the wild) and arguments.
    const stream = makeSseStream([
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"code_graph","arguments":"{\\"a\\":1}","call_id":"call_AAAAAAAA"}}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"search","arguments":"{\\"q\\":\\"x\\"}","call_id":"call_BBBBBBBB"}}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);

    // 1. The parser must hand out distinct indices.
    const indices: number[] = [];
    let acc: Record<string, unknown> = {};
    for await (const chunk of parseSseStream(stream, 'gpt-5.5')) {
      const tcs = chunk.choices[0]?.delta?.tool_calls;
      if (tcs) for (const tc of tcs) indices.push(tc.index as number);
      // 2. Feed every chunk through the real reducer, as the agent loop does.
      acc = reduceStreamChunk(acc, chunk);
    }
    expect(indices).toEqual([0, 1]);

    // 3. After reduction the two calls stay separate and intact — no
    //    concatenated call_id / name / arguments.
    const merged = (acc.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>) ?? [];
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: 'call_AAAAAAAA', function: { name: 'code_graph', arguments: '{"a":1}' } });
    expect(merged[1]).toMatchObject({ id: 'call_BBBBBBBB', function: { name: 'search', arguments: '{"q":"x"}' } });
    // Guard the exact symptom: no id exceeds the Responses backend's 64-char cap.
    for (const c of merged) expect(c.id.length).toBeLessThanOrEqual(64);
  });

  it('throws on response.failed with a useful message', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.failed","response":{"error":{"code":"rate_limited","message":"Slow down"}}}\n\n',
    ]);

    let caught: Error | null = null;
    try {
      for await (const _chunk of parseSseStream(stream, 'gpt-5.5')) { /* drain */ }
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeTruthy();
    expect(caught!.message).toContain('rate_limited');
    expect(caught!.message).toContain('Slow down');
  });

  it('ignores unknown event types silently (response.in_progress, etc.)', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.in_progress"}\n\n',
      'data: {"type":"response.created"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);

    const contentChunks: string[] = [];
    for await (const chunk of parseSseStream(stream, 'gpt-5.5')) {
      const c = chunk.choices[0]?.delta?.content;
      if (c) contentChunks.push(c);
    }
    expect(contentChunks).toEqual(['hi']);
  });

  it('captures encrypted_content from reasoning items via the onReasoningItem callback', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"opaque-blob-A"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);

    const captured: Array<{ type: string; encrypted_content: string }> = [];
    for await (const _ of parseSseStream(stream, 'gpt-5.5', (item) => captured.push(item))) {
      /* drain */
    }
    expect(captured).toEqual([{ type: 'reasoning', encrypted_content: 'opaque-blob-A' }]);
  });

  it('emits reasoning_text.delta as delta.reasoning_content (passthrough field)', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.reasoning_text.delta","delta":"Let me think..."}\n\n',
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Plan: search code"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"answer"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);

    const reasoningChunks: string[] = [];
    const contentChunks: string[] = [];
    for await (const chunk of parseSseStream(stream, 'gpt-5.5')) {
      const delta = chunk.choices[0]?.delta as { content?: string; reasoning_content?: string } | undefined;
      if (delta?.reasoning_content) reasoningChunks.push(delta.reasoning_content);
      if (delta?.content) contentChunks.push(delta.content);
    }
    expect(reasoningChunks).toEqual(['Let me think...', 'Plan: search code']);
    expect(contentChunks).toEqual(['answer']);
  });

  // Regression: the Codex backend has been observed to stall mid-stream
  // (TCP open, headers received, then no SSE event ever arrives). Without
  // the idle timeout the agent loop hangs on "thinking…" forever.
  it('throws a clear error when no SSE event arrives within idleTimeoutMs', async () => {
    // Stream that never enqueues anything and never closes.
    const stallingStream = new ReadableStream<Uint8Array>({
      start() { /* intentionally idle */ },
    });

    const start = Date.now();
    let caught: Error | null = null;
    try {
      for await (const _ of parseSseStream(stallingStream, 'gpt-5.5', undefined, 50)) {
        /* drain */
      }
    } catch (err) {
      caught = err as Error;
    }
    const elapsed = Date.now() - start;

    expect(caught).toBeTruthy();
    expect(caught!.message).toMatch(/stalled/i);
    expect(caught!.message).toMatch(/50ms/);
    // Must actually wait for the timer, not return synchronously.
    expect(elapsed).toBeGreaterThanOrEqual(40);
    // And must not wait orders of magnitude longer (catches a bug where
    // the timer is cleared by accident).
    expect(elapsed).toBeLessThan(2000);
  });

  it('does not trip the idle timeout when events arrive fast enough', async () => {
    const stream = makeSseStream([
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);
    const chunks: string[] = [];
    for await (const chunk of parseSseStream(stream, 'gpt-5.5', undefined, 1000)) {
      const c = chunk.choices[0]?.delta?.content;
      if (c) chunks.push(c);
    }
    expect(chunks).toEqual(['ok']);
  });

  it('cancels a stalled reader immediately when the caller aborts', async () => {
    const cancel = vi.fn();
    const stallingStream = new ReadableStream<Uint8Array>({
      start() { /* intentionally idle */ },
      cancel,
    });
    const controller = new AbortController();
    const generator = parseSseStream(
      stallingStream,
      'gpt-5.5',
      undefined,
      10_000,
      controller.signal,
    );
    const pending = generator.next();
    await Promise.resolve();

    const startedAt = Date.now();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

// ─── 3. End-to-end (mocked fetch) ───────────────────────────────────

function authBundle(overrides: Partial<ChatGptAuth> = {}): ChatGptAuth {
  return {
    access_token: 'tok-123',
    account_id: 'acct_xyz',
    email: 'patrice@example.com',
    plan_type: 'plus',
    is_fedramp: false,
    ...overrides,
  };
}

function streamingResponse(events: string[]): Response {
  return new Response(makeSseStream(events), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('ChatGptResponsesProvider — chatStream wiring', () => {
  it('sends Authorization, ChatGPT-Account-ID, and originator headers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(streamingResponse([
        'data: {"type":"response.output_text.delta","delta":"4"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]));

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    const out: string[] = [];
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: '2+2?' } as CodeBuddyMessage],
      [],
      {},
    )) {
      const c = chunk.choices[0]?.delta?.content;
      if (c) out.push(c);
    }

    expect(out.join('')).toBe('4');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(headers['ChatGPT-Account-ID']).toBe('acct_xyz');
    expect(headers.originator).toBe('codex_cli_rs');
    expect(headers.Accept).toBe('text/event-stream');
  });

  it('sends X-OpenAI-Fedramp header only when is_fedramp is true', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(streamingResponse([
        'data: {"type":"response.completed"}\n\n',
      ]));

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle({ is_fedramp: true }),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    const gen = provider.chatStream(
      [{ role: 'user', content: 'X' } as CodeBuddyMessage],
      [],
      {},
    );
    for await (const _ of gen) { /* drain */ }

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-OpenAI-Fedramp']).toBe('true');
  });

  it('throws a helpful message when no auth on disk', async () => {
    const provider = new ChatGptResponsesProvider({
      authProvider: async () => null,
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    let caught: Error | null = null;
    try {
      const gen = provider.chatStream(
        [{ role: 'user', content: 'X' } as CodeBuddyMessage],
        [],
        {},
      );
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toMatch(/login chatgpt/i);
  });

  it('refreshes auth on 401 and retries the request once', async () => {
    let callCount = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response('unauthorized', { status: 401 });
      }
      return streamingResponse([
        'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]);
    });

    let refreshCalls = 0;
    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle({ access_token: 'old' }),
      refreshAuth: async () => {
        refreshCalls += 1;
        return authBundle({ access_token: 'new' });
      },
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    const out: string[] = [];
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: 'X' } as CodeBuddyMessage],
      [],
      {},
    )) {
      const c = chunk.choices[0]?.delta?.content;
      if (c) out.push(c);
    }

    expect(refreshCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.join('')).toBe('ok');
    // Second call uses the fresh token.
    const headers2 = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(headers2.Authorization).toBe('Bearer new');
  });

  it('multi-turn: round 2 injects the encrypted reasoning captured in round 1', async () => {
    // Round 1 stream: reasoning blob + function_call.
    // Round 2 stream: completed (no body, we just inspect the request body).
    const responses: Response[] = [
      streamingResponse([
        'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"opaque-blob-r1"}}\n\n',
        'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"search","arguments":"{\\"q\\":\\"x\\"}","call_id":"c1"}}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]),
      streamingResponse([
        'data: {"type":"response.output_text.delta","delta":"answer"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]),
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return responses.shift() ?? new Response('', { status: 500 });
    });

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    // Round 1: user asks something that triggers a tool_call.
    const round1Messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'find the bug' } as CodeBuddyMessage,
    ];
    for await (const _ of provider.chatStream(round1Messages, [], { thinkingLevel: 'medium' })) {
      /* drain */
    }

    // Round 2: append the assistant's tool_call + tool result, then call again.
    const round2Messages: CodeBuddyMessage[] = [
      ...round1Messages,
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
      } as unknown as CodeBuddyMessage,
      { role: 'tool', tool_call_id: 'c1', content: 'match: line 42' } as unknown as CodeBuddyMessage,
    ];
    for await (const _ of provider.chatStream(round2Messages, [], { thinkingLevel: 'medium' })) {
      /* drain */
    }

    // Inspect round-2 request body — must contain the reasoning item.
    const round2Body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(round2Body.input[0]).toEqual({
      type: 'reasoning',
      encrypted_content: 'opaque-blob-r1',
    });
    // And the include flag should be set since reasoning effort is on.
    expect(round2Body.include).toEqual(['reasoning.encrypted_content']);
  });

  it('multi-turn: a fresh user prompt clears stale reasoning from a previous turn', async () => {
    // Round 1 produces a reasoning blob.
    // Round 2 is a NEW user turn (no assistant round in between in messages[]).
    // The provider must NOT inject the stale reasoning blob.
    const responses: Response[] = [
      streamingResponse([
        'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"stale-blob"}}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]),
      streamingResponse([
        'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]),
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return responses.shift() ?? new Response('', { status: 500 });
    });

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    for await (const _ of provider.chatStream(
      [{ role: 'user', content: 'first' } as CodeBuddyMessage],
      [], { thinkingLevel: 'medium' },
    )) { /* drain */ }

    // Brand-new conversation turn — no assistant message follows the
    // last user message → isFreshUserTurn() returns true, stale
    // reasoning gets dropped before convertMessages() runs.
    for await (const _ of provider.chatStream(
      [{ role: 'user', content: 'second turn' } as CodeBuddyMessage],
      [], { thinkingLevel: 'medium' },
    )) { /* drain */ }

    const round2Body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    // No reasoning item — the input is just the user message.
    const reasoningItems = (round2Body.input as Array<{ type: string }>).filter(
      (it) => it.type === 'reasoning',
    );
    expect(reasoningItems).toHaveLength(0);
  });

  it('does NOT include encrypted_reasoning when reasoning effort is unset', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamingResponse([
      'data: {"type":"response.completed"}\n\n',
    ]));

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    for await (const _ of provider.chatStream(
      [{ role: 'user', content: 'hi' } as CodeBuddyMessage],
      [], {},  // no thinkingLevel
    )) { /* drain */ }

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.include).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it('auto-fallback: model_not_supported triggers retry with next FALLBACK_MODELS entry', async () => {
    const responses: Response[] = [
      // Round 1 with the user's chosen model → 400 model_not_supported
      new Response(
        JSON.stringify({ detail: "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account." }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
      // Round 2 with the auto-fallback → success
      streamingResponse([
        'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]),
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return responses.shift() ?? new Response('', { status: 500 });
    });

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5', // first FALLBACK_MODELS entry is 'gpt-5.2'
      defaultMaxTokens: 1000,
    });

    const out: string[] = [];
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: 'X' } as CodeBuddyMessage],
      [],
      {}, // no `model` override → auto-fallback enabled
    )) {
      const c = chunk.choices[0]?.delta?.content;
      if (c) out.push(c);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.join('')).toBe('OK');
    // 2nd request used the fallback model (first entry of FALLBACK_MODELS).
    const body2 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(body2.model).toBe('gpt-5.2');
  });

  it('proactive remap: a mis-routed non-Codex model (grok-*) uses the configured model, no failed round-trip', async () => {
    // Backend would serve a single successful response.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      streamingResponse([
        'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]),
    );

    // Constructed with the user's configured ChatGPT model…
    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });
    // …but the agent's task-router hands back a grok coding model mid-session
    // (this is what crashed: grok → 400, fallback gpt-5.2 → 400 → throw).
    provider.setModel('grok-code-fast-1');

    const out: string[] = [];
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: 'fix the bug' } as CodeBuddyMessage],
      [],
      {}, // no explicit --model override
    )) {
      const c = chunk.choices[0]?.delta?.content;
      if (c) out.push(c);
    }

    // The grok slug was remapped to the configured gpt-5.5 BEFORE the request:
    // a single call, and it never sent a non-Codex model to the backend.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-5.5');
    expect(out.join('')).toBe('OK');
  });

  it('auto-fallback: skipped when caller pinned --model explicitly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "The 'gpt-5.5' model is not supported." }),
        { status: 400 },
      ),
    );

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'fallback-model',
      defaultMaxTokens: 1000,
    });

    let caught: Error | null = null;
    try {
      const gen = provider.chatStream(
        [{ role: 'user', content: 'X' } as CodeBuddyMessage],
        [],
        { model: 'gpt-5.5' }, // explicit pin → no fallback
      );
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeTruthy();
    expect(caught!.message).toContain('gpt-5.5');
  });

  it('auto-fallback: stops when current model is already a fallback candidate', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "The 'gpt-5.1-codex' model is not supported." }),
        { status: 400 },
      ),
    );

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.1-codex',
      defaultMaxTokens: 1000,
    });

    let caught: Error | null = null;
    try {
      const gen = provider.chatStream(
        [{ role: 'user', content: 'X' } as CodeBuddyMessage],
        [],
        {},
      );
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err as Error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(caught).toBeTruthy();
    expect(caught!.message).toContain('gpt-5.1-codex');
  });

  it('auto-fallback: skipped when disableModelFallback=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "The 'gpt-5.5' model is not supported." }),
        { status: 400 },
      ),
    );

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
      disableModelFallback: true,
    });

    let caught: Error | null = null;
    try {
      const gen = provider.chatStream(
        [{ role: 'user', content: 'X' } as CodeBuddyMessage],
        [],
        {},
      );
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeTruthy();
  });

  it('surfaces model_not_found errors with suggested fallbacks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'not allowed' } }), {
        status: 404,
      }),
    );

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
      // Disable auto-fallback so the rejection message references the
      // exact model the caller used, not the post-fallback retry slug.
      disableModelFallback: true,
    });

    let caught: Error | null = null;
    try {
      const gen = provider.chatStream(
        [{ role: 'user', content: 'X' } as CodeBuddyMessage],
        [],
        {},
      );
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toContain('gpt-5.5');
    expect(caught?.message).toMatch(/gpt-5\.1-codex/);
  });

  // Regression: prior versions called fetch() with no AbortController,
  // so a stalled TLS/auth phase would hang the agent loop indefinitely.
  it('passes an AbortSignal to fetch (so connect timeout can fire)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamingResponse(['data: {"type":"response.completed"}\n\n']),
    );

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    for await (const _ of provider.chatStream(
      [{ role: 'user', content: 'X' } as CodeBuddyMessage],
      [],
      {},
    )) { /* drain */ }

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a friendly connect-timeout error when fetch aborts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      // Mimic a real fetch that respects the AbortSignal: when it fires,
      // throw a DOMException-like AbortError.
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });

    const provider = new ChatGptResponsesProvider({
      authProvider: async () => authBundle(),
      model: 'gpt-5.5',
      defaultMaxTokens: 1000,
    });

    // Trigger abort artificially via global AbortController hijack: easier
    // path is to rely on the real connect timeout, but 60s is too slow for
    // tests. So we patch AbortController to abort immediately.
    const RealAbortController = globalThis.AbortController;
    class InstantAbortController extends RealAbortController {
      constructor() {
        super();
        // Abort on next microtask so the fetch implementation has time to
        // attach its abort listener.
        queueMicrotask(() => this.abort());
      }
    }
    globalThis.AbortController = InstantAbortController as typeof AbortController;

    let caught: Error | null = null;
    try {
      const gen = provider.chatStream(
        [{ role: 'user', content: 'X' } as CodeBuddyMessage],
        [],
        {},
      );
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err as Error;
    } finally {
      globalThis.AbortController = RealAbortController;
    }

    expect(caught).toBeTruthy();
    expect(caught!.message).toMatch(/did not respond/i);
    expect(caught!.message).toMatch(/login chatgpt/i);
  });
});
