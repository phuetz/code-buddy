import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ImportanceScorer } from '../../src/context/importance-scorer.js';
import type { Message } from '../../src/context/smart-compaction.js';
import {
  getSmartCompactionEngine,
  resetSmartCompactionEngine,
} from '../../src/context/smart-compaction.js';

function multimodalUser(text: string): CodeBuddyMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: 'https://example.com/frame.png' } },
    ],
  } as unknown as CodeBuddyMessage;
}

describe('Mission R38 — jumeaux multimodal importance-scorer / smart-compaction', () => {
  it('ImportanceScorer applies a length penalty to multimodal text parts', () => {
    const scorer = new ImportanceScorer({ recencyBoost: 0 });
    const longText = 'payload '.repeat(800);
    const score = scorer.scoreMessage(multimodalUser(longText), 0, 1);
    expect(
      score.factors.some((factor) => factor.startsWith('length(')),
      'ImportanceScorer ignored multimodal text and skipped the length penalty',
    ).toBe(true);
  });

  it('ImportanceScorer detects code inside multimodal text parts', () => {
    const scorer = new ImportanceScorer();
    const msg = {
      role: 'assistant',
      content: [{ type: 'text', text: '```typescript\nconst x = 1;\n```' }],
    } as unknown as CodeBuddyMessage;
    expect(scorer.detectContentType(msg)).toBe('code');
  });

  it('SmartCompactionEngine counts tokens of multimodal text instead of array length', async () => {
    resetSmartCompactionEngine();
    const engine = getSmartCompactionEngine({
      maxTokens: 100_000,
      provider: 'openai',
      channelType: 'cli',
    });
    const text = 'word '.repeat(2000);
    const { result } = await engine.compact([
      { role: 'user', content: [{ type: 'text', text }] as unknown as string },
    ]);
    expect(
      result.originalTokens,
      `counted only ${result.originalTokens} tokens for a long multimodal text part`,
    ).toBeGreaterThan(500);
    resetSmartCompactionEngine();
  });

  it('SmartCompactionEngine preserves failed tool text from multimodal content', async () => {
    resetSmartCompactionEngine();
    const engine = getSmartCompactionEngine({
      maxTokens: 80,
      provider: 'openai',
      channelType: 'cli',
    });
    const filler = 'data '.repeat(400);
    const messages: Message[] = [
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: filler },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{}' } }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: [{ type: 'text', text: 'Error: boom failed' }] as unknown as string,
      },
      { role: 'user', content: filler },
      { role: 'assistant', content: filler },
    ];
    const { messages: compacted } = await engine.compact(messages);
    const joined = compacted.map((message) => {
      const content = message.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
          .join(' ');
      }
      return '';
    }).join('\n');
    expect(
      joined,
      'failed multimodal tool result was dropped because content was not a string',
    ).toMatch(/Failed tool attempts[\s\S]*boom/i);
    resetSmartCompactionEngine();
  });
});
