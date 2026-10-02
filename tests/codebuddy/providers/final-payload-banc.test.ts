import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatProvider } from '../../../src/codebuddy/providers/provider-openai-compat.js';
import type { OpenAiChatPayload } from '../../../src/codebuddy/providers/ollama-native-transport.js';
import { getRestorableCompressor, resetRestorableCompressor } from '../../../src/context/restorable-compression.js';

const recorded = JSON.parse(fs.readFileSync(new URL('../../fixtures/ollama-banc-b-context.json', import.meta.url), 'utf8'));
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); resetRestorableCompressor(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

async function send(extra: Record<string, unknown>[] = []) {
  vi.stubEnv('CODEBUDDY_PROVIDER', 'ollama'); vi.stubEnv('CODEBUDDY_MAX_CONTEXT', '8192');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-banc-')); roots.push(workspace);
  const messages = structuredClone(recorded.messages) as Record<string, unknown>[];
  for (const message of messages) {
    if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) call.function.arguments = JSON.stringify(call.function.arguments);
  }
  messages.push(...extra);
  const input: OpenAiChatPayload = { model: recorded.model, messages, tools: recorded.tools, max_tokens: 512 };
  const before = JSON.stringify(input);
  let seen: Record<string, unknown> = {};
  const server = http.createServer(async (request, response) => {
    let text = ''; for await (const part of request) text += part;
    seen = JSON.parse(text);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ model: recorded.model, message: { role: 'assistant', content: 'ok' }, done: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = new OpenAICompatProvider({ apiKey: 'ollama', baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: recorded.model, defaultMaxTokens: 512, getCircuitBreakerConfig: () => undefined });
    const seam = provider as unknown as { createChatCompletion(payload: OpenAiChatPayload, signal: undefined, scope: { workDir: string; sessionId: string }): Promise<unknown> };
    await seam.createChatCompletion(input, undefined, { workDir: workspace, sessionId: 'banc' });
    expect(JSON.stringify(input)).toBe(before);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  return { seen, workspace, input };
}

describe('payload final enregistré de B, avec injections et schémas', () => {
  it('réduit avant envoi, préserve exactement la dernière mission et rend le retrait récupérable', async () => {
    const { seen, workspace, input } = await send();
    const messages = seen.messages as Record<string, unknown>[];
    const options = seen.options as { num_ctx: number; num_predict: number };
    const wireEstimate = Math.ceil(Buffer.byteLength(JSON.stringify({ messages, tools: seen.tools })) / 3);
    expect(wireEstimate + options.num_predict + 512).toBeLessThanOrEqual(options.num_ctx);
    expect(messages.findLast(message => message.role === 'user')?.content).toBe(input.messages.findLast(message => message.role === 'user')?.content);
    const key = JSON.stringify(messages).match(/payload-[a-f0-9]+/)?.[0];
    expect(key).toBeTruthy();
    const restored = getRestorableCompressor().restore(key!, workspace, 'banc');
    expect(restored.found).toBe(true);
    expect(JSON.parse(restored.content)).toEqual(input);
    expect(getRestorableCompressor().restore(key!, workspace, 'another-session').found).toBe(false);
  });

  it('compte les injections tardives et les résultats, même après la dernière mission', async () => {
    const { seen, input } = await send([{ role: 'system', content: '<late-tree>' + 'late injection '.repeat(9000) + '</late-tree>' }]);
    const options = seen.options as { num_ctx: number; num_predict: number };
    expect(Math.ceil(Buffer.byteLength(JSON.stringify({ messages: seen.messages, tools: seen.tools })) / 3) + options.num_predict + 512).toBeLessThanOrEqual(options.num_ctx);
    expect((seen.messages as Record<string, unknown>[]).findLast(message => message.role === 'user')?.content).toBe(input.messages.findLast(message => message.role === 'user')?.content);
  });
});

it('conserve une grande sortie cloud autorisée par le profil du modèle', async () => {
  const { budgetFinalPayload } = await import('../../../src/context/final-payload-budget.js');
  const payload = { model: 'fixture-cloud', messages: [{ role: 'user', content: 'mission' }], max_tokens: 98304 };
  const budget = budgetFinalPayload(payload, 131072, { workDir: process.cwd(), sessionId: 'cloud-output' }, 98304);
  expect(budget.outputTokens).toBe(98304);
  expect(budget.inputTokens + budget.outputTokens + budget.safetyTokens).toBeLessThanOrEqual(131072);
});
