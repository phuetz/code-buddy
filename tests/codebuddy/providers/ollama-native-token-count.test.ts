import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { admitOllamaCompactRequest, resetNativeTokenCounters } from '../../../src/codebuddy/providers/ollama-native-token-count.js';

// A byte vocabulary without merges makes the boundary independently countable.
function metadata() {
  const bytes = [...Array(94)].map((_, i) => i + 33).concat([...Array(12)].map((_, i) => i + 161), [...Array(82)].map((_, i) => i + 174));
  const chars = [...bytes]; let next = 0;
  for (let i = 0; i < 256; i++) if (!bytes.includes(i)) { bytes.push(i); chars.push(256 + next++); }
  return { 'tokenizer.ggml.pre': 'qwen35', 'tokenizer.ggml.model': 'gpt2',
    'tokenizer.ggml.tokens': chars.map(c => String.fromCodePoint(c)),
    'tokenizer.ggml.merges': [], 'tokenizer.ggml.token_type': chars.map(() => 1) };
}
const body = { model: 'qwen3.5:4b', messages: [{ role: 'user', content: 'hello' }], think: false, options: { num_ctx: 32768 } };
const fetcher = () => vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/api/version')
  ? { version: '0.30.7' } : { details: { family: 'qwen35' }, model_info: metadata() })));
beforeEach(() => { vi.stubEnv('CODEBUDDY_HEADLESS', 'true'); vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', 'true'); resetNativeTokenCounters(); });
afterEach(() => { vi.unstubAllEnvs(); resetNativeTokenCounters(); });
it('admits a small rendered request using served tokens, without a generation probe', async () => {
  const transport = fetcher();
  expect(await admitOllamaCompactRequest('http://fixture', body, transport)).toBeGreaterThan(5);
  expect(transport.mock.calls.map(call => call[0])).toEqual(['http://fixture/api/version', 'http://fixture/api/show']);
});
it('rejects an oversized assembled prompt before generation, including schema overhead', async () => {
  const transport = fetcher();
  await expect(admitOllamaCompactRequest('http://fixture', { ...body,
    messages: [{ role: 'user', content: 'x'.repeat(1500) }] }, transport)).rejects.toThrow(/not sent.*1500.*before generation/);
  expect(transport.mock.calls.every(call => !call[0].endsWith('/api/chat'))).toBe(true);
});
it('never treats unavailable metadata or a changed renderer version as a measured count', async () => {
  await expect(admitOllamaCompactRequest('http://fixture', body,
    vi.fn(async () => new Response('{"version":"0.30.8"}')))).rejects.toThrow(/only been verified/);
  await expect(admitOllamaCompactRequest('http://fixture', body,
    vi.fn(async url => new Response(url.endsWith('/api/version') ? '{"version":"0.30.7"}' : '{}')))).rejects.toThrow(/does not match/);
});
it('does not change the noncompact transport', async () => {
  vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', 'false');
  const transport = fetcher();
  expect(await admitOllamaCompactRequest('http://fixture', body, transport)).toBeUndefined();
  expect(transport).not.toHaveBeenCalled();
});
