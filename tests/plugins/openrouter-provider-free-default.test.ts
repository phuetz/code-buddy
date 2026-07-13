import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenRouterProvider } from '../../src/plugins/bundled/openrouter-provider.js';

describe('bundled OpenRouter provider', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    delete process.env.OPENROUTER_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = originalModel;
  });

  it('uses the zero-cost router by default', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenRouterProvider();
    await provider?.chat?.([{ role: 'user', content: 'hello' }]);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string };
    expect(body.model).toBe('openrouter/free');
  });

  it('honours an explicit OPENROUTER_MODEL override', async () => {
    process.env.OPENROUTER_MODEL = 'openai/gpt-oss-20b:free';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenRouterProvider();
    await provider?.chat?.([{ role: 'user', content: 'hello' }]);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string };
    expect(body.model).toBe('openai/gpt-oss-20b:free');
  });
});
