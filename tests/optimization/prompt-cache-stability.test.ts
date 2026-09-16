import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';
import { PromptCacheManager } from '../../src/optimization/prompt-cache.js';

const rawHash = (content: string) => createHash('sha256').update(content).digest('hex').slice(0, 16);
const tool = (name: string): CodeBuddyTool => ({
  type: 'function',
  function: { name, description: 'Read a file', parameters: { type: 'object', properties: {} } },
});

describe('prompt prefix stability diagnostics', () => {
  it('counts consecutive exact changes independently of the cache threshold', () => {
    const manager = new PromptCacheManager();
    for (const prompt of ['read files', 'read files', 'read  files', 'read files']) {
      expect(manager.cacheSystemPrompt(prompt)).toBe(rawHash(prompt));
    }
    expect(manager.getPrefixStats()).toEqual({
      system: { observations: 4, unchanged: 1, changes: 2 },
      tools: { observations: 0, unchanged: 0, changes: 0 },
    });
    expect(manager.getStats()).toMatchObject({ hits: 0, misses: 0, entries: 0 });
  });

  it('keeps raw tool keys and lookup truthful when property insertion order changes', () => {
    const first = [tool('read')];
    const reordered: CodeBuddyTool[] = [{
      function: { parameters: first[0].function.parameters, description: 'Read a file', name: 'read' },
      type: 'function',
    }];
    const before = [JSON.stringify(first), JSON.stringify(reordered)];
    expect(before[0]).not.toBe(before[1]);
    const manager = new PromptCacheManager({ minTokensToCache: 0 });

    expect(manager.cacheTools(first)).toBe(rawHash(before[0]));
    expect(manager.isCached(before[0])).toBe(true);
    expect(manager.isCached(before[1])).toBe(false);
    expect(manager.cacheTools(reordered)).toBe(rawHash(before[1]));
    manager.cacheTools(reordered);

    expect([JSON.stringify(first), JSON.stringify(reordered)]).toEqual(before);
    expect(manager.isCached(before[0])).toBe(true);
    expect(manager.isCached(before[1])).toBe(true);
    expect(manager.getStats()).toMatchObject({ hits: 1, misses: 2, entries: 2 });
    expect(manager.getPrefixStats().tools).toEqual({ observations: 3, unchanged: 1, changes: 1 });
  });

  it('counts tool array order changes without altering tools or system observations', () => {
    const manager = new PromptCacheManager();
    const first = Object.freeze(tool('first'));
    const second = Object.freeze(tool('second'));
    const tools = [first, second];
    const before = JSON.stringify(tools);
    manager.cacheSystemPrompt('system');
    manager.cacheTools(tools);
    manager.cacheTools([second, first]);
    manager.cacheTools(tools);
    expect(JSON.stringify(tools)).toBe(before);
    expect(manager.getPrefixStats()).toEqual({
      system: { observations: 1, unchanged: 0, changes: 0 },
      tools: { observations: 3, unchanged: 0, changes: 2 },
    });
  });

  it('returns detached statistics and starts a fresh diagnostic baseline after clear', () => {
    const manager = new PromptCacheManager();
    manager.cacheSystemPrompt('before');
    manager.cacheTools([tool('before')]);
    const snapshot = manager.getPrefixStats();
    snapshot.system.changes = 100;
    snapshot.tools.observations = 100;
    expect(manager.getPrefixStats().system.changes).toBe(0);
    expect(manager.getPrefixStats().tools.observations).toBe(1);
    manager.clear();
    manager.cacheSystemPrompt('after');
    manager.cacheTools([tool('after')]);
    expect(manager.getPrefixStats()).toEqual({
      system: { observations: 1, unchanged: 0, changes: 0 },
      tools: { observations: 1, unchanged: 0, changes: 0 },
    });
  });

  it('does not observe components while disabled', () => {
    const manager = new PromptCacheManager({ enabled: false });
    manager.cacheSystemPrompt('ignored');
    manager.cacheTools([tool('ignored')]);
    manager.updateConfig({ enabled: true });
    manager.cacheSystemPrompt('first observed');
    manager.cacheTools([tool('first_observed')]);
    expect(manager.getPrefixStats()).toEqual({
      system: { observations: 1, unchanged: 0, changes: 0 },
      tools: { observations: 1, unchanged: 0, changes: 0 },
    });
  });

  it('labels the diagnostic as local and does not claim measured provider savings', () => {
    const manager = new PromptCacheManager();
    manager.cacheSystemPrompt('before');
    manager.cacheSystemPrompt('after');
    expect(manager.formatStats()).toContain('Prefix Changes (local): system 1, tools 0');
    expect(manager.formatStats()).toContain('provider cache usage is not measured');
    expect(manager.formatStats()).toContain('Est. Cost Saved (heuristic)');
  });
});
