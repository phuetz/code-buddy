/**
 * Audit 2026-09-02 — famille « faux succès / bascule silencieuse » sur le
 * provider Gemini natif (fetch mocké, zéro réseau) :
 *  - D3 : une erreur réseau EN COURS de stream (des chunks déjà émis)
 *    déclenchait le repli non-stream qui REJOUAIT toute la réponse → le
 *    consommateur recevait « préfixe + réponse complète » concaténés, sans
 *    erreur. Attendu : ne replier que si zéro chunk émis, sinon propager.
 *  - D8 : les erreurs HTTP (429/5xx) étaient levées sans `.status`, donc le
 *    prédicat de retry (RetryPredicates.llmApiError) ne retentait jamais.
 *  - D1 : un stream fermé sans finishReason terminait en `finish: 'stop'`
 *    sans aucune trace. Attendu : au minimum un warn de troncature possible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat';
import { GeminiNativeProvider } from '../../../src/codebuddy/providers/provider-gemini-native.js';
import { logger } from '../../../src/utils/logger.js';

const realFetch = globalThis.fetch;
let fetchImpl: (url: string) => Promise<Response>;

beforeEach(() => {
  (globalThis as any).fetch = async (url: any) => fetchImpl(String(url));
});
afterEach(() => {
  (globalThis as any).fetch = realFetch;
  vi.restoreAllMocks();
});

function sse(...lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
function textChunk(t: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;
}

function makeProvider(model = 'gemini-2.5-pro') {
  return new GeminiNativeProvider({
    apiKey: 'test-key',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model,
    defaultMaxTokens: 1024,
    geminiRequestTimeoutMs: 5000,
  });
}

async function collectStream(p: GeminiNativeProvider) {
  let content = '';
  let threw: string | null = null;
  try {
    for await (const chunk of p.chatStream([{ role: 'user', content: 'salut' }])) {
      const c = chunk.choices[0];
      if (c?.delta?.content) content += c.delta.content;
    }
  } catch (e) {
    threw = (e as Error).message;
  }
  return { content, threw };
}

describe('Gemini natif — intégrité du stream', () => {
  it('D3 : erreur mi-stream après émission → propage, ne duplique jamais le contenu', async () => {
    const full = 'Bonjour, voici le début et la fin de la réponse.';
    fetchImpl = async (url) => {
      if (url.includes('streamGenerateContent')) {
        const enc = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(textChunk('Bonjour, voici le déb')));
            setTimeout(() => c.error(new Error('read ECONNRESET')), 5);
          },
        });
        return new Response(body, { status: 200 });
      }
      // repli non-stream : rejouerait toute la réponse
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: full }] }, finishReason: 'STOP' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const r = await collectStream(makeProvider());
    // Avant correctif : content === 'Bonjour, voici le déb' + full (dupliqué), threw null.
    expect(r.threw).toBeTruthy();
    expect(r.content).toBe('Bonjour, voici le déb');
  });

  it('D3bis : erreur AVANT tout chunk → le repli non-stream reste actif', async () => {
    const full = 'Réponse complète du repli.';
    fetchImpl = async (url) => {
      if (url.includes('streamGenerateContent')) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.error(new Error('read ECONNRESET'));
          },
        });
        return new Response(body, { status: 200 });
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: full }] }, finishReason: 'STOP' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const r = await collectStream(makeProvider());
    expect(r.threw).toBeNull();
    expect(r.content).toBe(full);
  });

  it('D8 : une erreur HTTP porte .status pour le prédicat de retry', async () => {
    fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
    const p = makeProvider();
    let caught: any = null;
    try {
      await p.chat([{ role: 'user', content: 'salut' }]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.status).toBe(429);
  });

  it('D1 : fin de stream sans finishReason → warn de troncature possible', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    fetchImpl = async () => sse(textChunk('Voici le début de la réponse'));
    const r = await collectStream(makeProvider());
    expect(r.content).toBe('Voici le début de la réponse');
    const warned = warnSpy.mock.calls.some((c) => String(c[0]).toLowerCase().includes('finishreason'));
    expect(warned).toBe(true);
  });

  it('D1 : émet un seul finish_reason honnête avant lequel le footer est livré', async () => {
    fetchImpl = async () => sse(
      textChunk('Réponse partielle'),
      `data: ${JSON.stringify({
        candidates: [{
          finishReason: 'MAX_TOKENS',
          groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://example.test/source', title: 'Source' } }],
          },
        }],
      })}\n\n`,
    );

    const emitted: ChatCompletionChunk[] = [];
    for await (const chunk of makeProvider().chatStream([{ role: 'user', content: 'salut' }])) {
      emitted.push(chunk);
    }

    const terminal = emitted.filter((chunk) => chunk.choices[0]?.finish_reason !== null);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]?.choices[0]?.finish_reason).toBe('length');
    const footerIndex = emitted.findIndex((chunk) => chunk.choices[0]?.delta?.content?.includes('**Sources:**'));
    const terminalIndex = emitted.findIndex((chunk) => chunk.choices[0]?.finish_reason !== null);
    expect(footerIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeLessThan(terminalIndex);
  });

  it('D4 : échec définitif d’appel malformé → erreur explicite', async () => {
    let calls = 0;
    fetchImpl = async () => {
      calls++;
      return new Response(
        JSON.stringify({ candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }),
        { status: 200 },
      );
    };

    await expect(makeProvider().chat([{ role: 'user', content: 'utilise un outil' }])).rejects.toThrow(
      'Gemini malformed function call retries exhausted',
    );
    expect(calls).toBe(3);
  });

  it('D5 : candidat sans parts → erreur, sans réponse française inventée', async () => {
    fetchImpl = async () => new Response(
      JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }),
      { status: 200 },
    );

    await expect(makeProvider().chat([{ role: 'user', content: 'write code' }])).rejects.toThrow(
      'Gemini returned empty content parts',
    );
  });
});
