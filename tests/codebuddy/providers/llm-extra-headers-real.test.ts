/**
 * Extra HTTP headers for LLM API calls (Hermes upstream parity, 2026-07-03).
 *
 * `CODEBUDDY_LLM_EXTRA_HEADERS` (JSON object) must reach the wire on every
 * OpenAI-compat call — proven with a REAL loopback HTTP server speaking
 * minimal chat-completions (no mocked transport), per the no-mocks rule.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OpenAICompatProvider,
  resolveLlmExtraHeaders,
} from '../../../src/codebuddy/providers/provider-openai-compat.js';
import { logger } from '../../../src/utils/logger.js';

describe('resolveLlmExtraHeaders', () => {
  it('parses a JSON object of string values', () => {
    expect(resolveLlmExtraHeaders('{"Helicone-Auth":"Bearer h","X-Tag":"cb"}')).toEqual({
      'Helicone-Auth': 'Bearer h',
      'X-Tag': 'cb',
    });
  });

  it('returns undefined for unset/blank input', () => {
    expect(resolveLlmExtraHeaders(undefined)).toBeUndefined();
    expect(resolveLlmExtraHeaders('   ')).toBeUndefined();
  });

  it('warns and disables on invalid JSON or non-object values', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      expect(resolveLlmExtraHeaders('{not json')).toBeUndefined();
      expect(resolveLlmExtraHeaders('["a"]')).toBeUndefined();
      expect(resolveLlmExtraHeaders('"just-a-string"')).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('drops transport-managed headers and non-string values', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      expect(
        resolveLlmExtraHeaders(
          '{"Host":"evil","Content-Type":"text/plain","X-Ok":"yes","X-Num":5}',
        ),
      ).toEqual({ 'X-Ok': 'yes' });
    } finally {
      warn.mockRestore();
    }
  });
});

describe('OpenAICompatProvider extra headers (real loopback round-trip)', () => {
  let server: http.Server;
  let baseURL: string;
  let seenHeaders: http.IncomingHttpHeaders | null;
  let seenBody: Record<string, unknown> | null;
  const envBefore = process.env.CODEBUDDY_LLM_EXTRA_HEADERS;
  const lemonadeHostBefore = process.env.LEMONADE_HOST;
  const lemonadeThinkingBefore = process.env.CODEBUDDY_LEMONADE_THINKING;

  beforeEach(async () => {
    seenHeaders = null;
    seenBody = null;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        seenHeaders = req.headers;
        seenBody = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-loopback',
            object: 'chat.completion',
            created: 0,
            model: 'loopback-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'pong' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterEach(async () => {
    if (envBefore === undefined) delete process.env.CODEBUDDY_LLM_EXTRA_HEADERS;
    else process.env.CODEBUDDY_LLM_EXTRA_HEADERS = envBefore;
    if (lemonadeHostBefore === undefined) delete process.env.LEMONADE_HOST;
    else process.env.LEMONADE_HOST = lemonadeHostBefore;
    if (lemonadeThinkingBefore === undefined) delete process.env.CODEBUDDY_LEMONADE_THINKING;
    else process.env.CODEBUDDY_LEMONADE_THINKING = lemonadeThinkingBefore;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends the configured extra headers on the wire and still parses the response', async () => {
    process.env.CODEBUDDY_LLM_EXTRA_HEADERS = '{"X-Proxy-Tag":"codebuddy-parity","Helicone-Auth":"Bearer h-test"}';
    const provider = new OpenAICompatProvider({
      apiKey: 'test-key',
      baseURL,
      model: 'loopback-model',
      defaultMaxTokens: 128,
      getCircuitBreakerConfig: () => undefined,
    });
    const response = await provider.chat([{ role: 'user', content: 'ping' }]);
    expect(response.choices[0]?.message?.content).toBe('pong');
    expect(seenHeaders?.['x-proxy-tag']).toBe('codebuddy-parity');
    expect(seenHeaders?.['helicone-auth']).toBe('Bearer h-test');
    // The normal auth header is untouched by extra headers.
    expect(seenHeaders?.authorization).toBe('Bearer test-key');
  });

  it('sends no extra headers when the env is unset', async () => {
    delete process.env.CODEBUDDY_LLM_EXTRA_HEADERS;
    const provider = new OpenAICompatProvider({
      apiKey: 'test-key',
      baseURL,
      model: 'loopback-model',
      defaultMaxTokens: 128,
      getCircuitBreakerConfig: () => undefined,
    });
    await provider.chat([{ role: 'user', content: 'ping' }]);
    expect(seenHeaders?.['x-proxy-tag']).toBeUndefined();
  });

  it('disables hidden Lemonade thinking by default on the wire', async () => {
    process.env.LEMONADE_HOST = baseURL;
    delete process.env.CODEBUDDY_LEMONADE_THINKING;
    const provider = new OpenAICompatProvider({
      apiKey: 'lemonade',
      baseURL,
      model: 'Qwen3.6-35B-A3B-MTP-GGUF',
      defaultMaxTokens: 128,
      getCircuitBreakerConfig: () => undefined,
    });

    await provider.chat([{ role: 'user', content: 'ping' }]);

    expect(seenBody?.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('allows deliberate Lemonade jobs to opt thinking back in', async () => {
    process.env.LEMONADE_HOST = baseURL;
    process.env.CODEBUDDY_LEMONADE_THINKING = '1';
    const provider = new OpenAICompatProvider({
      apiKey: 'lemonade',
      baseURL,
      model: 'Qwen3.6-35B-A3B-MTP-GGUF',
      defaultMaxTokens: 128,
      getCircuitBreakerConfig: () => undefined,
    });

    await provider.chat([{ role: 'user', content: 'ping' }]);

    expect(seenBody?.chat_template_kwargs).toEqual({ enable_thinking: true });
  });
});
