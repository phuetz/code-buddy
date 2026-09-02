/**
 * A model reached through a gateway carries a vendor prefix and sometimes a
 * routing tag (`moonshotai/kimi-k3`, `minimax/minimax-m3:free`). Before this
 * fallback, any name without an exact pattern fell to the permissive 32 768
 * window, and the system prompt was truncated to 14 336 tokens for a model that
 * serves a million. The bare name (no prefix, no routing tag) is the second
 * lookup; a full-name pattern still wins when one exists.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  bareModelName,
  cacheRuntimeModelContextWindow,
  findModelToolConfig,
  getModelToolConfig,
  resetRuntimeModelContextCache,
  type ModelToolConfig,
} from '../../src/config/model-tools.js';
import { getModelInfo } from '../../src/utils/model-utils.js';

afterEach(() => {
  resetRuntimeModelContextCache();
  delete process.env.CODEBUDDY_MAX_CONTEXT;
});

describe('bareModelName', () => {
  it('drops the vendor prefix and a routing tag, keeps an Ollama size tag', () => {
    expect(bareModelName('moonshotai/kimi-k3')).toBe('kimi-k3');
    expect(bareModelName('minimax/minimax-m3:free')).toBe('minimax-m3');
    expect(bareModelName('moonshotai/kimi-k3:batch')).toBe('kimi-k3');
    expect(bareModelName('qwen3.8:27b')).toBe('qwen3.8:27b');
    expect(bareModelName('ollama/qwen3:4b-instruct')).toBe('qwen3:4b-instruct');
    expect(bareModelName('gpt-5.5')).toBe('gpt-5.5');
  });
});

describe('gateway-prefixed models resolve to their open-weights family', () => {
  it('Kimi K3 via NVIDIA Build gets its real window instead of the 32 768 fallback', () => {
    const cfg = getModelToolConfig('moonshotai/kimi-k3');
    expect(cfg.model).toBe('kimi-k3*');
    expect(cfg.contextWindow).toBe(1_048_576);
    expect(cfg.supportsToolCalls).toBe(true);
  });

  it('other families reached through a prefix', () => {
    expect(getModelToolConfig('nvidia/nemotron-3-super-120b-a12b').contextWindow).toBe(256_000);
    expect(getModelToolConfig('z-ai/glm-5').contextWindow).toBe(196_608);
    expect(getModelToolConfig('google/gemma-4-31b-it').contextWindow).toBe(262_144);
    expect(getModelToolConfig('deepseek/deepseek-v4-pro').contextWindow).toBe(1_024_000);
    expect(getModelToolConfig('openai/gpt-oss-120b').contextWindow).toBe(131_072);
    expect(getModelToolConfig('moonshotai/kimi-k2').contextWindow).toBe(131_072);
    expect(getModelToolConfig('moonshotai/kimi-k2.6').contextWindow).toBe(262_144);
  });

  it('a full-name pattern still wins over the family (free tiers keep their own caps)', () => {
    // `nvidia/nemotron-3-*:free` is declared with a 1M window; the bare
    // family says 256 000. The full-name declaration is the intentional one.
    expect(getModelToolConfig('nvidia/nemotron-3-ultra-550b-a55b:free').contextWindow).toBe(1_000_000);
    expect(getModelToolConfig('MiniMaxAI/MiniMax-M3').model).toBe('MiniMaxAI/MiniMax-M3');
  });

  it('custom configs benefit from the same bare-name fallback', () => {
    const custom: ModelToolConfig[] = [{ model: 'house-model*', contextWindow: 4242, maxOutputTokens: 11 }];
    expect(getModelToolConfig('acme/house-model-v2:free', custom).contextWindow).toBe(4242);
  });

  it('findModelToolConfig reports the family, so getModelInfo no longer calls it unsupported', () => {
    expect(findModelToolConfig('moonshotai/kimi-k3')?.model).toBe('kimi-k3*');
    const info = getModelInfo('moonshotai/kimi-k3');
    expect(info.isSupported).toBe(true);
    expect(info.maxTokens).toBe(1_048_576);
  });

  it('a truly unknown name still gets the permissive fallback', () => {
    expect(getModelToolConfig('acme/never-heard-of-it').contextWindow).toBe(32_768);
  });
});

describe('discovered context vs declared context', () => {
  it('a catalogue value REPLACES a family estimate, in both directions', () => {
    cacheRuntimeModelContextWindow('moonshotai/kimi-k3', 262_144);
    expect(getModelToolConfig('moonshotai/kimi-k3').contextWindow).toBe(262_144);
    cacheRuntimeModelContextWindow('z-ai/glm-5', 400_000);
    expect(getModelToolConfig('z-ai/glm-5').contextWindow).toBe(400_000);
  });

  it('a runtime value can only LOWER a full-name declaration', () => {
    cacheRuntimeModelContextWindow('qwen3.8:27b', 1_000_000);
    expect(getModelToolConfig('qwen3.8:27b').contextWindow).toBe(262_144);
    cacheRuntimeModelContextWindow('qwen3.8:27b', 32_768);
    expect(getModelToolConfig('qwen3.8:27b').contextWindow).toBe(32_768);
  });
});

describe('CODEBUDDY_MAX_CONTEXT overrides every source, for every consumer', () => {
  it('wins over the table, the family and discovery, and is read at call time', () => {
    expect(getModelToolConfig('moonshotai/kimi-k3').contextWindow).toBe(1_048_576);
    process.env.CODEBUDDY_MAX_CONTEXT = '65536';
    expect(getModelToolConfig('moonshotai/kimi-k3').contextWindow).toBe(65_536);
    expect(getModelToolConfig('gpt-5.5').contextWindow).toBe(65_536);
    delete process.env.CODEBUDDY_MAX_CONTEXT;
    expect(getModelToolConfig('gpt-5.5').contextWindow).not.toBe(65_536);
  });

  it('ignores garbage', () => {
    process.env.CODEBUDDY_MAX_CONTEXT = 'abc';
    expect(getModelToolConfig('moonshotai/kimi-k3').contextWindow).toBe(1_048_576);
  });
});
