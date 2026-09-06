/**
 * Audit 2026-09-02 (D5) — famille « bascule silencieuse » :
 * dans chatStreamWithProviderFallback, si le secours n°1 échoue APRÈS avoir
 * émis des chunks, le catch passait au secours n°2 qui rejouait TOUTE la
 * réponse → le consommateur recevait un texte HYBRIDE (préfixe modèle A +
 * réponse complète modèle B) présenté comme UNE réponse, sans erreur.
 * Attendu : après émission par un secours, un échec PROPAGE.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import type { RuntimeFallbackProvider } from '../../src/providers/provider-fallback.js';

const realFetch = globalThis.fetch;
const enc = new TextEncoder();
const G = 'https://generativelanguage.googleapis.com/v1beta';
let impl: (url: string) => Promise<Response>;

beforeEach(() => {
  (globalThis as any).fetch = async (url: any) => impl(String(url));
});
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

function fb(provider: string, model: string): RuntimeFallbackProvider {
  return {
    provider, label: provider, apiMode: 'gemini' as any, authMode: 'api-key' as any,
    apiKey: 'fb-key', baseURL: G, defaultModel: model, source: 'override' as any,
    model, rawSpec: `${provider}:${model}`, fallbackSource: 'environment',
  } as RuntimeFallbackProvider;
}

describe('client — intégrité du repli de stream', () => {
  it('un secours qui échoue après émission propage au lieu de passer au secours suivant', async () => {
    impl = async (url) => {
      if (url.includes('gemini-primary')) {
        return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
      }
      if (url.includes('gemini-fb1')) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '[FB1] La capitale de la France est P' }] } }] })}\n\n`));
            setTimeout(() => c.error(new Error('read ECONNRESET')), 5);
          },
        });
        return new Response(body, { status: 200 });
      }
      if (url.includes('gemini-fb2')) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[FB2] La capitale de la France est Paris.' }] }, finishReason: 'STOP' }] }), { status: 200 });
      }
      throw new Error('unexpected ' + url);
    };

    const client = new CodeBuddyClient('primary-key', 'gemini-primary', G, {
      credentialPoolProviders: [],
      fallbackProviders: [fb('fb1', 'gemini-fb1'), fb('fb2', 'gemini-fb2')],
    } as any);

    let content = '';
    let threw: string | null = null;
    try {
      for await (const chunk of client.chatStream([{ role: 'user', content: 'salut' }])) {
        const c = chunk.choices[0];
        if (c?.delta?.content) content += c.delta.content;
      }
    } catch (e) {
      threw = (e as Error).message;
    }
    // Avant correctif : content hybride '[FB1] …P[FB2] … Paris.', threw null.
    expect(content).not.toContain('[FB2]');
    expect(threw).toBeTruthy();
  });
});
