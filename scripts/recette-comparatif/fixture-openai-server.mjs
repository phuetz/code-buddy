/**
 * Deterministic OpenAI-compatible FIXTURE provider on 127.0.0.1 (not a model).
 *
 *   import { startFixtureProvider } from './fixture-openai-server.mjs';
 *   const provider = await startFixtureProvider({ script: (req, index) => reply });
 *
 * `script(request, index)` returns `{ content?: string, toolCalls?: [{ name, arguments }] }`.
 * Supports streaming (SSE) and non-streaming chat completions plus /v1/models.
 * Every request body is kept in `provider.requests` for assertions.
 */
import http from 'node:http';

export async function startFixtureProvider({ script, model = 'fixture-model' }) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', context_length: 32768 }] }));
      return;
    }
    if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `fixture: unsupported ${req.method} ${url.pathname}` } }));
      return;
    }

    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep empty */ }
    const index = requests.length;
    requests.push(body);
    const reply = (await script(body, index)) ?? { content: 'fixture: done' };
    const toolCalls = (reply.toolCalls ?? []).map((call, i) => ({
      index: i,
      id: `fixture_call_${index}_${i}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
    }));
    const finish = toolCalls.length ? 'tool_calls' : 'stop';
    const created = Math.floor(Date.now() / 1000);

    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      const base = { id: `fixture-${index}`, object: 'chat.completion.chunk', created, model };
      if (reply.content) send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: reply.content }, finish_reason: null }] });
      if (toolCalls.length) send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: toolCalls }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      res.end('data: [DONE]\n\n');
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `fixture-${index}`,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: reply.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls.map(({ index: _i, ...c }) => c) } : {}) },
        finish_reason: finish,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
