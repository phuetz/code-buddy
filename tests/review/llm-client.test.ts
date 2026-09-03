/**
 * Default full-mode reviewer resolution — a local Ollama qwen3.8 must be
 * pickable (CODEBUDDY_DIFF_REVIEW=full with no cloud key), an explicit pin
 * wins, and a dead model is skipped. Fail-closed when nothing usable remains.
 *
 * The wrapped chat call must cap maxTokens: qwen3.8's model default is 16k
 * output, which lets hidden thinking eat the whole review timeout.
 */
import { describe, expect, it, vi } from 'vitest';

const { chatCalls } = vi.hoisted(() => ({ chatCalls: [] as unknown[] }));

vi.mock('../../src/providers/active-llm-model-pool.js', () => ({
  listActiveLlmModelPool: vi.fn(async () => [
    {
      provider: 'ollama',
      model: 'qwen3.8:27b',
      apiKey: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      egress: 'local',
      costInputUsdPerMtok: 0,
    },
  ]),
}));

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    async chat(_messages: unknown, _tools: unknown, options?: unknown) {
      chatCalls.push(options);
      return { choices: [{ message: { content: '{"decision":"accept"}' } }], usage: { prompt_tokens: 1, total_tokens: 1 } };
    }
  },
}));

vi.mock('../../src/fleet/model-scoreboard.js', () => ({
  getModelScoreboard: () => ({ consecutiveRecentFailures: () => 0 }),
}));

import { pickReviewerPoolEntry, resolveDefaultReviewClient } from '../../src/review/llm-client.js';
import type { ActiveLlmModelPoolEntry } from '../../src/providers/active-llm-model-pool.js';

function entry(
  over: Partial<ActiveLlmModelPoolEntry> & Pick<ActiveLlmModelPoolEntry, 'provider' | 'model'>,
): ActiveLlmModelPoolEntry {
  return {
    apiKey: 'ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    egress: 'local',
    costInputUsdPerMtok: 0,
    ...over,
  };
}

const LOCAL_ONLY_POOL: ActiveLlmModelPoolEntry[] = [
  entry({ provider: 'omniroute', model: 'auto/best-free', apiKey: 'omniroute', baseURL: 'http://localhost:20128/v1', egress: 'cloud' }),
  entry({ provider: 'ollama', model: 'gemma4-moe-rag:latest' }),
  entry({ provider: 'ollama', model: 'nomic-embed-text:latest' }),
  entry({ provider: 'ollama', model: 'qwen3.8-ctx32k:latest' }),
  entry({ provider: 'ollama', model: 'qwen3.8:27b' }),
  entry({ provider: 'ollama', model: 'qwen3:4b-instruct' }),
  entry({ provider: 'ollama', model: 'llama3:latest' }),
];

describe('pickReviewerPoolEntry', () => {
  it('picks a local qwen3.8 reviewer when the pool has no cloud strong model', () => {
    const pick = pickReviewerPoolEntry(LOCAL_ONLY_POOL, {}, () => 0);
    expect(pick?.model).toMatch(/^qwen3\.8/);
    expect(pick?.provider).toBe('ollama');
    expect(pick?.egress).toBe('local');
  });

  it('honours CODEBUDDY_DIFF_REVIEW_MODEL over GROK_MODEL and pool order', () => {
    const pick = pickReviewerPoolEntry(
      LOCAL_ONLY_POOL,
      { CODEBUDDY_DIFF_REVIEW_MODEL: 'qwen3.8:27b', GROK_MODEL: 'qwen3.8-ctx32k:latest' },
      () => 0,
    );
    expect(pick?.model).toBe('qwen3.8:27b');
  });

  it('falls back to GROK_MODEL when no explicit review pin is set', () => {
    const pick = pickReviewerPoolEntry(LOCAL_ONLY_POOL, { GROK_MODEL: 'qwen3.8:27b' }, () => 0);
    expect(pick?.model).toBe('qwen3.8:27b');
  });

  it('synthesizes a pinned Ollama model that the capped pool omitted', () => {
    const truncated = LOCAL_ONLY_POOL.filter((p) => p.model !== 'qwen3.8:27b');
    const pick = pickReviewerPoolEntry(
      truncated,
      { CODEBUDDY_DIFF_REVIEW_MODEL: 'qwen3.8:27b' },
      () => 0,
    );
    expect(pick?.model).toBe('qwen3.8:27b');
    expect(pick?.provider).toBe('ollama');
    expect(pick?.baseURL).toBe('http://127.0.0.1:11434/v1');
  });

  it('never silently seats a cloud gateway when a local strong reviewer exists', () => {
    const pick = pickReviewerPoolEntry(LOCAL_ONLY_POOL, {}, () => 0);
    expect(pick?.provider).not.toBe('omniroute');
    expect(pick?.egress).not.toBe('cloud');
  });

  it('skips a dead model (trailing failure streak) and still fail-closes if nothing remains', () => {
    const skipped = pickReviewerPoolEntry(LOCAL_ONLY_POOL, { CODEBUDDY_DIFF_REVIEW_MODEL: 'qwen3.8:27b' }, (m) =>
      m === 'qwen3.8:27b' ? 2 : 0,
    );
    expect(skipped?.model).not.toBe('qwen3.8:27b');

    const empty = pickReviewerPoolEntry(
      [entry({ provider: 'ollama', model: 'llama3:latest' })],
      {},
      () => 0,
    );
    expect(empty).toBeNull();
  });
});

describe('resolveDefaultReviewClient — bounded JSON review call', () => {
  it('caps maxTokens and disables thinking-sized defaults so a local 27b can finish', async () => {
    chatCalls.length = 0;
    const client = await resolveDefaultReviewClient();
    expect(client).not.toBeNull();
    await client!.chat([{ role: 'user', content: 'review' }]);
    expect(chatCalls[0]).toMatchObject({
      temperature: 0,
      maxTokens: 1024,
      disableProviderFallback: true,
    });
    const opts = chatCalls[0] as { maxTokens: number };
    expect(opts.maxTokens).toBeLessThan(4096);
  });
});
