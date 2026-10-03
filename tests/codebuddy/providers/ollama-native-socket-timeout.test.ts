/**
 * Délais de socket du transport Ollama natif (banc harnais 2026-10-03).
 *
 * Constat sur traces réelles : Node fetch garde les 300 s par défaut d'undici
 * (`headersTimeout`, `bodyTimeout`) alors que le garde de stall de Code Buddy
 * accorde jusqu'à `CODEBUDDY_STALL_MAX_MS` (20 min) à un runtime local. Une
 * génération locale silencieuse (appel d'outil tamponné par Ollama, longue
 * évaluation du prompt) était coupée à 300 s : `TypeError: terminated`
 * (C-4b du banc, 350 s après la requête) ou `fetch failed` / HeadersTimeoutError
 * (C-27b-2 Astra). La requête native doit donc emprunter un dispatcher aligné.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOllamaNativeDispatcher } from '../../../src/codebuddy/providers/ollama-native-transport.js';
import { OpenAICompatProvider } from '../../../src/codebuddy/providers/provider-openai-compat.js';
import { resetRuntimeModelContextCache } from '../../../src/config/model-tools.js';
import { resolveLocalTransportTimeoutMs } from '../../../src/utils/stream-stall-guard.js';

const UNDICI_DEFAULT_MS = 300_000;

function agentOptions(dispatcher: object): Record<string, unknown> {
  const symbol = Object.getOwnPropertySymbols(dispatcher).find((s) => s.description === 'options');
  return (symbol ? (dispatcher as Record<symbol, unknown>)[symbol] : {}) as Record<string, unknown>;
}

describe('resolveLocalTransportTimeoutMs', () => {
  it('dépasse le défaut undici et couvre le plafond du garde de stall (20 min par défaut)', () => {
    const value = resolveLocalTransportTimeoutMs({});
    expect(value).toBeGreaterThan(UNDICI_DEFAULT_MS);
    expect(value).toBeGreaterThan(20 * 60 * 1000);
  });

  it('suit CODEBUDDY_STALL_MAX_MS et un délai explicite plus long', () => {
    expect(resolveLocalTransportTimeoutMs({ CODEBUDDY_STALL_MAX_MS: '3600000' })).toBeGreaterThan(3_600_000);
    expect(resolveLocalTransportTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: '5400000' })).toBeGreaterThan(5_400_000);
  });

  it('reste fini, et ne vaut 0 que si l’opérateur désactive le garde', () => {
    expect(Number.isFinite(resolveLocalTransportTimeoutMs({ CODEBUDDY_STALL_MAX_MS: 'abc' }))).toBe(true);
    expect(resolveLocalTransportTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: '0' })).toBe(0);
  });
});

describe('getOllamaNativeDispatcher', () => {
  it('configure headersTimeout et bodyTimeout au plafond résolu', () => {
    const env = { CODEBUDDY_STALL_MAX_MS: '1800000' };
    const options = agentOptions(getOllamaNativeDispatcher(env));
    expect(options.headersTimeout).toBe(resolveLocalTransportTimeoutMs(env));
    expect(options.bodyTimeout).toBe(resolveLocalTransportTimeoutMs(env));
    expect(getOllamaNativeDispatcher(env)).toBe(getOllamaNativeDispatcher(env));
  });
});

describe('requête native /api/chat', () => {
  let server: http.Server;
  let baseURL: string;

  beforeEach(async () => {
    resetRuntimeModelContextCache();
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'qwen3:4b-instruct', message: { role: 'assistant', content: 'pong' }, done: true, done_reason: 'stop' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ollama/v1`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetRuntimeModelContextCache();
  });

  it('passe le dispatcher aligné au lieu des 300 s par défaut', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const provider = new OpenAICompatProvider({
      apiKey: 'ollama', baseURL, model: 'qwen3:4b-instruct', defaultMaxTokens: 64,
      getCircuitBreakerConfig: () => undefined,
    });

    const response = await provider.chat([{ role: 'user', content: 'ping' }]);

    expect(response.choices[0]?.message?.content).toBe('pong');
    const nativeCall = spy.mock.calls.find(([url]) => String(url).endsWith('/api/chat'));
    expect(nativeCall).toBeDefined();
    const init = nativeCall?.[1] as { dispatcher?: object } | undefined;
    expect(init?.dispatcher).toBe(getOllamaNativeDispatcher());
    expect(agentOptions(init!.dispatcher!).bodyTimeout).toBeGreaterThan(UNDICI_DEFAULT_MS);
  });
});
