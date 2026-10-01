import { describe, expect, it, vi } from 'vitest';
import { assertOllamaRequestBound, checkOllamaRequest } from '../../../src/codebuddy/providers/ollama-request-preflight.js';
const body = { model: 'fixture', messages: [{ role: 'system', content: 'RULES' }, { role: 'user', content: 'Read' }, { role: 'assistant', content: 'observed' }], tools: [], options: { num_ctx: 32768 }, stream: true };
const transport = (context = 32768) => vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'fixture', context_length: context }] })));
describe('Ollama measured request admission', () => {
  it('checks actual usage and the effective context without a synthetic generation', async () => {
    const fetcher = transport();
    expect((await checkOllamaRequest('http://localhost:11434', body, 700, fetcher)).promptTokens).toBe(700);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://localhost:11434/api/ps', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('refuses effective num_ctx smaller than the measured request', async () => {
    await expect(checkOllamaRequest('http://localhost:11434', body, 700, transport(512))).rejects.toThrow(/effective.*512.*700/i);
  });
  it('refuses a possible silent truncation before any call', () => {
    expect(() => assertOllamaRequestBound({ ...body, messages: [{ role: 'user', content: 'é'.repeat(40000) }] })).toThrow(/window.*bound/i);
  });
  it('does not accept missing real token evidence or effective window', async () => {
    const fetcher = transport();
    await expect(checkOllamaRequest('http://localhost:11434', body, undefined, fetcher)).rejects.toThrow(/real prompt token count/i);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(checkOllamaRequest('http://localhost:11434', body, 700, vi.fn(async () => new Response('{"models":[]}')))).rejects.toThrow(/effective context/i);
  });
});
