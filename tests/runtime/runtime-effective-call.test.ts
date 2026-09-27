import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatCompletionChunk } from 'openai/resources/chat';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { OpenAICompatProvider } from '../../src/codebuddy/providers/provider-openai-compat.js';
import { getCurrentProcessEffectiveCall, getLastEffectiveCall, getServerRuntimeStatus } from '../../src/runtime/runtime-status.js';

const profiles: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of profiles.splice(0)) rmSync(root, { recursive: true, force: true }); });

function client() {
  const profile = mkdtempSync(join(tmpdir(), 'buddy-effective-call-'));
  profiles.push(profile);
  vi.stubEnv('CODEBUDDY_HOME', profile);
  const instance = new CodeBuddyClient('fixture-key', 'configured-model', 'https://example.invalid/v1', { enableFallbacks: false });
  return { profile, instance };
}

describe('effective LLM observation', () => {
  it('persists the served model after success, then preserves it after failure', async () => {
    const { profile, instance } = client();
    const strategy = { chat: vi.fn().mockResolvedValue({
      model: 'served-model', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }) };
    (instance as unknown as { openaiCompatProvider: unknown }).openaiCompatProvider = strategy;
    expect(getLastEffectiveCall(profile)).toBeNull();
    await instance.chat([{ role: 'user', content: 'hello' }]);
    expect(getLastEffectiveCall(profile)?.model).toBe('served-model');
    expect(getLastEffectiveCall(profile)?.scope).toBe('profile');
    expect(getCurrentProcessEffectiveCall()).toMatchObject({ model: 'served-model', scope: 'process' });
    expect(getServerRuntimeStatus().lastEffectiveCall).toMatchObject({ model: 'served-model', scope: 'process' });
    strategy.chat.mockRejectedValueOnce(new Error('offline'));
    await expect(instance.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('offline');
    expect(getLastEffectiveCall(profile)?.model).toBe('served-model');
  });

  it('observes a streamed model only once a real chunk arrives', async () => {
    const { profile, instance } = client();
    (instance as unknown as { openaiCompatProvider: unknown }).openaiCompatProvider = {
      chatStream: async function* () {
        yield { id: 'chunk', object: 'chat.completion.chunk', created: 0,
          model: 'served-stream', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
        } as ChatCompletionChunk;
      },
    };
    expect(getLastEffectiveCall(profile)).toBeNull();
    for await (const _chunk of instance.chatStream([{ role: 'user', content: 'hello' }])) { /* consume */ }
    expect(getLastEffectiveCall(profile)?.model).toBe('served-stream');
  });

  it('attributes a successful fallback to the provider that served it', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'buddy-effective-fallback-'));
    profiles.push(profile);
    vi.stubEnv('CODEBUDDY_HOME', profile);
    vi.spyOn(OpenAICompatProvider.prototype, 'chat').mockImplementation(async (_messages, _tools, opts) => {
      if (opts.model !== 'fallback-model') throw new Error('primary offline');
      return { model: 'served-fallback', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] };
    });
    const instance = new CodeBuddyClient('fixture-key', 'primary-model', 'https://api.x.ai/v1', {
      enableCredentialPool: false,
      fallbackProviders: [{ provider: 'openrouter', model: 'fallback-model', apiKey: 'fixture-key',
        baseURL: 'https://openrouter.ai/api/v1', rawSpec: 'openrouter:fallback-model', fallbackSource: 'environment' }],
    });
    await instance.chat([{ role: 'user', content: 'hello' }]);
    expect(getLastEffectiveCall(profile)).toMatchObject({ provider: 'openrouter', model: 'served-fallback' });
  });
});
