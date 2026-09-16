/**
 * `CODEBUDDY_MAX_CONTEXT` must reach the Ollama SERVER, not just Code Buddy.
 *
 * IMPROVE1 left this open: with the variable set, `ollama ps` still showed the
 * model loaded at 262 144 tokens (24 GB of VRAM for a 2.5 GB model). Measured
 * cause, on Ollama 0.30.7: the OpenAI-compatible `/v1/chat/completions`
 * endpoint silently drops `options.num_ctx` (and any top-level spelling of it),
 * while the native `/api/chat` honours it. Proven here against a REAL loopback
 * HTTP server that records what actually reaches the wire — no mocked
 * transport.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OpenAICompatProvider } from '../../src/codebuddy/providers/provider-openai-compat.js';
import { resetRuntimeModelContextCache } from '../../src/config/model-tools.js';

interface SeenRequest {
  path: string;
  body: Record<string, unknown>;
}

const NATIVE_REPLY = {
  model: 'qwen3:4b-instruct',
  message: { role: 'assistant', content: 'pong' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 3,
  eval_count: 1,
};

let server: http.Server;
let baseURL: string;
let seen: SeenRequest[];
let previousMaxContext: string | undefined;
let previousNative: string | undefined;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw));
  });
}

beforeEach(async () => {
  previousMaxContext = process.env.CODEBUDDY_MAX_CONTEXT;
  previousNative = process.env.CODEBUDDY_OLLAMA_NATIVE_CHAT;
  seen = [];
  resetRuntimeModelContextCache();

  server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    seen.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if ((req.url ?? '').endsWith('/api/chat')) {
      res.end(JSON.stringify(NATIVE_REPLY));
      return;
    }
    res.end(JSON.stringify({
      id: 'chatcmpl-compat',
      object: 'chat.completion',
      created: 1,
      model: 'qwen3:4b-instruct',
      choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // The path segment is what makes this loopback server look like Ollama to the
  // provider — the real port (11434) is owned by the local daemon.
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ollama/v1`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (previousMaxContext === undefined) delete process.env.CODEBUDDY_MAX_CONTEXT;
  else process.env.CODEBUDDY_MAX_CONTEXT = previousMaxContext;
  if (previousNative === undefined) delete process.env.CODEBUDDY_OLLAMA_NATIVE_CHAT;
  else process.env.CODEBUDDY_OLLAMA_NATIVE_CHAT = previousNative;
  resetRuntimeModelContextCache();
});

function provider(url = baseURL): OpenAICompatProvider {
  return new OpenAICompatProvider({
    apiKey: 'ollama',
    baseURL: url,
    model: 'qwen3:4b-instruct',
    defaultMaxTokens: 128,
    getCircuitBreakerConfig: () => undefined,
  });
}

describe('CODEBUDDY_MAX_CONTEXT reaches the Ollama server', () => {
  it('sends it as num_ctx on the native endpoint for a non-streaming chat', async () => {
    process.env.CODEBUDDY_MAX_CONTEXT = '32000';

    const response = await provider().chat([{ role: 'user', content: 'ping' }]);

    expect(response.choices[0]?.message?.content).toBe('pong');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe('/ollama/api/chat');
    expect(seen[0]?.body).toMatchObject({
      model: 'qwen3:4b-instruct',
      stream: false,
      options: { num_ctx: 32000 },
    });
  });

  it('sends it as num_ctx on a streaming chat too', async () => {
    process.env.CODEBUDDY_MAX_CONTEXT = '32000';

    const chunks = [];
    for await (const chunk of provider().chatStream([{ role: 'user', content: 'ping' }])) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(seen[0]?.path).toBe('/ollama/api/chat');
    expect(seen[0]?.body).toMatchObject({ stream: true, options: { num_ctx: 32000 } });
  });

  it('still pins the declared window when the override is unset', async () => {
    delete process.env.CODEBUDDY_MAX_CONTEXT;

    await provider().chat([{ role: 'user', content: 'ping' }]);

    const numCtx = (seen[0]?.body.options as { num_ctx?: number } | undefined)?.num_ctx;
    expect(typeof numCtx).toBe('number');
    expect(numCtx).toBeGreaterThan(0);
  });

  it('leaves another local runtime serving the same weights on the OpenAI-compatible path', async () => {
    // LM Studio / vLLM serve qwen3 too and have no `/api/chat`: the route must
    // key off the endpoint, never off the model name.
    process.env.CODEBUDDY_MAX_CONTEXT = '32000';
    const port = (server.address() as AddressInfo).port;

    await provider(`http://127.0.0.1:${port}/v1`).chat([{ role: 'user', content: 'ping' }]);

    expect(seen[0]?.path).toBe('/v1/chat/completions');
    expect(seen[0]?.body.options).toBeUndefined();
  });

  it('honours the CODEBUDDY_OLLAMA_NATIVE_CHAT=false escape hatch', async () => {
    process.env.CODEBUDDY_MAX_CONTEXT = '32000';
    process.env.CODEBUDDY_OLLAMA_NATIVE_CHAT = 'false';

    await provider().chat([{ role: 'user', content: 'ping' }]);

    expect(seen[0]?.path).toBe('/ollama/v1/chat/completions');
  });
});
