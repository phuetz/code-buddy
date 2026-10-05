/**
 * CB-SSE-1005 — parseurs de flux : UTF-8 coupé, JSON coupé, tool_calls
 * désordonnés / multi-index, [DONE] absent, keep-alive, event: inconnu,
 * connexion coupée.
 *
 * Les cas tool_calls multi-index exposent le défaut où Gemini et Ollama
 * émettaient toujours `index: 0`, ce qui faisait fusionner les appels dans
 * `reduceStreamChunk` (id/name/arguments concaténés).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat';
import { GeminiNativeProvider } from '../../../src/codebuddy/providers/provider-gemini-native.js';
import { parseSseStream } from '../../../src/codebuddy/providers/provider-chatgpt-responses.js';
import { streamOllamaNative } from '../../../src/codebuddy/providers/ollama-native-transport.js';
import { reduceStreamChunk } from '../../../src/agent/streaming/message-reducer.js';

const enc = new TextEncoder();

function streamFromParts(parts: Array<string | Uint8Array>, opts?: { cutAfterMs?: number }): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      for (const p of parts) {
        controller.enqueue(typeof p === 'string' ? enc.encode(p) : p);
        await new Promise((r) => setTimeout(r, 1));
      }
      if (opts?.cutAfterMs != null) {
        await new Promise((r) => setTimeout(r, opts.cutAfterMs));
        controller.error(new Error('ECONNRESET simulated'));
        return;
      }
      controller.close();
    },
  });
}

function splitUtf8Mid(s: string): [Uint8Array, Uint8Array] {
  const all = enc.encode(s);
  const idx = all.indexOf(0xc3);
  const cut = idx >= 0 ? idx + 1 : Math.floor(all.length / 2);
  return [all.slice(0, cut), all.slice(cut)];
}

async function reduceAll(gen: AsyncIterable<ChatCompletionChunk>) {
  let text = '';
  let err: string | null = null;
  let finish: string | null = null;
  let acc: Record<string, unknown> = {};
  try {
    for await (const chunk of gen) {
      const c = chunk.choices[0];
      if (c?.delta?.content) text += c.delta.content;
      if (c?.finish_reason) finish = c.finish_reason;
      acc = reduceStreamChunk(acc, chunk);
    }
  } catch (e) {
    err = (e as Error).message;
  }
  return { text, finish, err, toolCalls: (acc.tool_calls as unknown[]) ?? null };
}

describe('CB-SSE-1005 Responses parseSseStream', () => {
  it('UTF-8 mid-character across TCP-like chunks → café intact', async () => {
    const event = 'data: {"type":"response.output_text.delta","delta":"café"}\n\n';
    const [a, b] = splitUtf8Mid(event);
    const r = await reduceAll(parseSseStream(
      streamFromParts([a, b, 'data: {"type":"response.completed"}\n\n']),
      'm',
    ));
    expect(r.text).toBe('café');
    expect(r.finish).toBe('stop');
    expect(r.err).toBeNull();
  });

  it('JSON coupé au milieu → Hello intact', async () => {
    const event = 'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n';
    const mid = Math.floor(event.length / 2);
    const r = await reduceAll(parseSseStream(
      streamFromParts([event.slice(0, mid), event.slice(mid) + 'data: {"type":"response.completed"}\n\n']),
      'm',
    ));
    expect(r.text).toBe('Hello');
    expect(r.err).toBeNull();
  });

  it('tool_calls parallèles (ordre B puis A) → deux slots distincts', async () => {
    const r = await reduceAll(parseSseStream(streamFromParts([
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"beta","arguments":"{\\"y\\":2}","call_id":"call_b"}}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"alpha","arguments":"{\\"x\\":1}","call_id":"call_a"}}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]), 'm'));
    expect(r.err).toBeNull();
    expect(r.toolCalls).toEqual([
      { id: 'call_b', type: 'function', function: { name: 'beta', arguments: '{"y":2}' } },
      { id: 'call_a', type: 'function', function: { name: 'alpha', arguments: '{"x":1}' } },
    ]);
  });

  it('keep-alive + event: inconnu → texte ok', async () => {
    const r = await reduceAll(parseSseStream(streamFromParts([
      ': keep-alive\n\n',
      'event: weird\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]), 'm'));
    expect(r.text).toBe('hi');
    expect(r.err).toBeNull();
  });

  it('[DONE] manquant (pas de terminal) → erreur explicite, texte partiel', async () => {
    const r = await reduceAll(parseSseStream(streamFromParts([
      'data: {"type":"response.output_text.delta","delta":"x"}\n\n',
    ]), 'm'));
    expect(r.text).toBe('x');
    expect(r.err).toMatch(/without a terminal event/i);
  });

  it('connexion coupée après delta → texte partial + erreur', async () => {
    const r = await reduceAll(parseSseStream(
      streamFromParts([
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      ], { cutAfterMs: 5 }),
      'm',
    ));
    expect(r.text).toBe('partial');
    expect(r.err).toMatch(/ECONNRESET/);
  });

  it('value présent avec done:true n’est pas perdu', async () => {
    const reads: Array<{ done: boolean; value?: Uint8Array }> = [
      { done: false, value: enc.encode('data: {"type":"response.output_text.delta","delta":"keep"}\n\n') },
      {
        done: true,
        value: enc.encode(
          'data: {"type":"response.output_text.delta","delta":"END"}\n\ndata: {"type":"response.completed"}\n\n',
        ),
      },
    ];
    let i = 0;
    const body = {
      getReader() {
        return {
          async read() {
            if (i >= reads.length) return { done: true as const, value: undefined };
            return reads[i++]!;
          },
          releaseLock() {},
          cancel() {},
        };
      },
    } as unknown as ReadableStream<Uint8Array>;
    const r = await reduceAll(parseSseStream(body, 'm'));
    expect(r.text).toBe('keepEND');
    expect(r.finish).toBe('stop');
    expect(r.err).toBeNull();
  });
});

describe('CB-SSE-1005 Gemini parseGeminiSSE / chatStream', () => {
  const realFetch = globalThis.fetch;
  let fetchImpl: (url: string) => Promise<Response>;

  beforeEach(() => {
    (globalThis as { fetch: typeof fetch }).fetch = async (url: RequestInfo | URL) =>
      fetchImpl(String(url));
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function provider() {
    return new GeminiNativeProvider({
      apiKey: 'k',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 256,
      geminiRequestTimeoutMs: 3000,
    });
  }

  function sseResponse(parts: Array<string | Uint8Array>, opts?: { cutAfterMs?: number }) {
    return new Response(streamFromParts(parts, opts), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  const textEv = (t: string, finish?: string) => {
    const cand: Record<string, unknown> = { content: { parts: [{ text: t }] } };
    if (finish) cand.finishReason = finish;
    return `data: ${JSON.stringify({ candidates: [cand] })}\n\n`;
  };
  const fcEv = (name: string, args: Record<string, unknown>) =>
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] })}\n\n`;
  const stopEv = () => `data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}\n\n`;

  it('UTF-8 mid-character → café', async () => {
    const ev = textEv('café');
    const [a, b] = splitUtf8Mid(ev);
    fetchImpl = async () => sseResponse([a, b, stopEv()]);
    const r = await reduceAll(provider().chatStream([{ role: 'user', content: 'x' }]));
    expect(r.text).toBe('café');
    expect(r.err).toBeNull();
  });

  it('JSON coupé → Hello', async () => {
    const ev = textEv('Hello') + stopEv();
    const mid = Math.floor(ev.length / 2);
    fetchImpl = async () => sseResponse([ev.slice(0, mid), ev.slice(mid)]);
    const r = await reduceAll(provider().chatStream([{ role: 'user', content: 'x' }]));
    expect(r.text).toBe('Hello');
    expect(r.err).toBeNull();
  });

  it('deux functionCall (beta puis alpha) → deux tool_calls distincts, pas de concaténation', async () => {
    fetchImpl = async () => sseResponse([fcEv('beta', { y: 2 }), fcEv('alpha', { x: 1 }), stopEv()]);
    const r = await reduceAll(provider().chatStream([{ role: 'user', content: 'x' }]));
    expect(r.err).toBeNull();
    expect(r.toolCalls).toHaveLength(2);
    const tools = r.toolCalls as Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    expect(tools[0]?.function.name).toBe('beta');
    expect(tools[0]?.function.arguments).toBe('{"y":2}');
    expect(tools[1]?.function.name).toBe('alpha');
    expect(tools[1]?.function.arguments).toBe('{"x":1}');
    // Pas de concaténation (symptôme du index:0 hardcodé)
    expect(tools[0]?.function.name).not.toContain('alpha');
    expect(tools[0]?.type).toBe('function');
  });

  it('keep-alive + event: inconnu', async () => {
    fetchImpl = async () => sseResponse([
      ': keep-alive\n\n',
      'event: weird\ndata: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n',
      stopEv(),
    ]);
    const r = await reduceAll(provider().chatStream([{ role: 'user', content: 'x' }]));
    expect(r.text).toBe('hi');
    expect(r.err).toBeNull();
  });

  it('[DONE]/finishReason absents → texte + finish stop (warn D1)', async () => {
    fetchImpl = async () => sseResponse([textEv('hi')]);
    const r = await reduceAll(provider().chatStream([{ role: 'user', content: 'x' }]));
    expect(r.text).toBe('hi');
    expect(r.finish).toBe('stop');
    expect(r.err).toBeNull();
  });

  it('connexion coupée après émission → partial + erreur (pas de FALLBACK)', async () => {
    fetchImpl = async (url) => {
      if (url.includes('streamGenerateContent')) {
        return sseResponse([textEv('partial')], { cutAfterMs: 5 });
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'FALLBACK' }] }, finishReason: 'STOP' }] }),
        { status: 200 },
      );
    };
    const r = await reduceAll(provider().chatStream([{ role: 'user', content: 'x' }]));
    expect(r.text).toBe('partial');
    expect(r.err).toMatch(/ECONNRESET/);
  });

  it('value présent avec done:true n’est pas perdu', async () => {
    const reads: Array<{ done: boolean; value?: Uint8Array }> = [
      { done: false, value: enc.encode(textEv('keep')) },
      { done: true, value: enc.encode(textEv('END', 'STOP')) },
    ];
    let i = 0;
    fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                if (i >= reads.length) return { done: true as const, value: undefined };
                return reads[i++]!;
              },
              releaseLock() {},
              cancel() {},
            };
          },
        },
      }) as unknown as Response;
    const r = await reduceAll(provider().chatStream([{ role: 'user', content: 'x' }]));
    expect(r.text).toBe('keepEND');
    expect(r.err).toBeNull();
  });
});

describe('CB-SSE-1005 Ollama streamOllamaNative', () => {
  it('UTF-8 mid-character → café', async () => {
    const line = `${JSON.stringify({ message: { content: 'café' }, done: false })}\n`;
    const [a, b] = splitUtf8Mid(line);
    const r = await reduceAll(streamOllamaNative(
      streamFromParts([a, b, `${JSON.stringify({ message: { content: '' }, done: true })}\n`]),
      'm',
    ));
    expect(r.text).toBe('café');
    expect(r.err).toBeNull();
  });

  it('JSON coupé entre morceaux → Hello', async () => {
    const payload =
      `${JSON.stringify({ message: { content: 'Hello' }, done: false })}\n` +
      `${JSON.stringify({ message: { content: '' }, done: true })}\n`;
    const mid = Math.floor(payload.length / 3);
    const r = await reduceAll(streamOllamaNative(streamFromParts([payload.slice(0, mid), payload.slice(mid)]), 'm'));
    expect(r.text).toBe('Hello');
    expect(r.err).toBeNull();
  });

  it('tool_calls sur deux lignes NDJSON (beta puis alpha) → deux slots, pas de concaténation', async () => {
    const r = await reduceAll(streamOllamaNative(streamFromParts([
      `${JSON.stringify({ message: { content: '', tool_calls: [{ id: 't1', function: { name: 'beta', arguments: { y: 2 } } }] }, done: false })}\n`,
      `${JSON.stringify({ message: { content: '', tool_calls: [{ id: 't0', function: { name: 'alpha', arguments: { x: 1 } } }] }, done: false })}\n`,
      `${JSON.stringify({ message: { content: '' }, done: true })}\n`,
    ]), 'm'));
    expect(r.err).toBeNull();
    expect(r.toolCalls).toHaveLength(2);
    const tools = r.toolCalls as Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    expect(tools[0]).toMatchObject({ id: 't1', function: { name: 'beta', arguments: '{"y":2}' } });
    expect(tools[1]).toMatchObject({ id: 't0', function: { name: 'alpha', arguments: '{"x":1}' } });
    expect(tools[0]?.type).toBe('function');
    expect(tools[0]?.id).not.toContain('t0');
  });

  it('lignes vides (keep-alive NDJSON) + ligne non-JSON ignorée', async () => {
    const r = await reduceAll(streamOllamaNative(streamFromParts([
      '\n',
      'event: weird\n',
      `${JSON.stringify({ message: { content: 'hi' }, done: true })}\n`,
    ]), 'm'));
    expect(r.text).toBe('hi');
    expect(r.err).toBeNull();
  });

  it('done:true manquant → texte hi, pas d’exception', async () => {
    const r = await reduceAll(streamOllamaNative(streamFromParts([
      `${JSON.stringify({ message: { content: 'hi' }, done: false })}\n`,
    ]), 'm'));
    expect(r.text).toBe('hi');
    expect(r.err).toBeNull();
  });

  it('connexion coupée → partial + erreur', async () => {
    const r = await reduceAll(streamOllamaNative(
      streamFromParts([
        `${JSON.stringify({ message: { content: 'partial' }, done: false })}\n`,
      ], { cutAfterMs: 5 }),
      'm',
    ));
    expect(r.text).toBe('partial');
    expect(r.err).toMatch(/ECONNRESET/);
  });
});

describe('CB-SSE-1005 OpenAI-compat deltas + reduceStreamChunk', () => {
  it('tool_call deltas désordonnés (index 1 avant 0) → deux appels reconstitués', () => {
    const chunks: ChatCompletionChunk[] = [
      {
        id: '1', object: 'chat.completion.chunk', created: 1, model: 'm',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'beta', arguments: '' } }] }, finish_reason: null }],
      },
      {
        id: '2', object: 'chat.completion.chunk', created: 1, model: 'm',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'alpha', arguments: '' } }] }, finish_reason: null }],
      },
      {
        id: '3', object: 'chat.completion.chunk', created: 1, model: 'm',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '{"y":2}' } }] }, finish_reason: null }],
      },
      {
        id: '4', object: 'chat.completion.chunk', created: 1, model: 'm',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] }, finish_reason: null }],
      },
    ];
    let acc: Record<string, unknown> = {};
    for (const ch of chunks) acc = reduceStreamChunk(acc, ch);
    const tools = acc.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ id: 'call_a', function: { name: 'alpha', arguments: '{"x":1}' } });
    expect(tools[1]).toMatchObject({ id: 'call_b', function: { name: 'beta', arguments: '{"y":2}' } });
  });
});
