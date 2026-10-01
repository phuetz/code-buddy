import { describe, it, expect, vi } from 'vitest';
import { PromptBuilder } from '../../src/services/prompt-builder.js';
import { PromptCacheManager } from '../../src/optimization/prompt-cache.js';

describe('PromptBuilder with unknown ID', () => {
  it('throws when building a system prompt with an unknown ID', async () => {
    const builder = new PromptBuilder({ cwd: process.cwd() }, new PromptCacheManager());
    await expect(builder.buildSystemPrompt('nosuch', 'claude-3-5-sonnet-20241022', null))
      .rejects.toThrow(/Unknown system prompt "nosuch"/);
  });
});
