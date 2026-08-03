import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { EnhancedContextCompressor } from '../../src/context/enhanced-compression.js';
import {
  countMessagesTokens,
  createTokenCounter,
  IMAGE_URL_LOW_DETAIL_TOKEN_ESTIMATE,
  IMAGE_URL_TOKEN_ESTIMATE,
} from '../../src/context/token-counter.js';

describe('EnhancedContextCompressor', () => {
  it('counts image_url parts once through the legacy message counter', () => {
    const textOnly = [{
      role: 'user',
      content: [{ type: 'text', text: 'describe this image' }],
    }];
    const withImage = [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe this image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    }];

    expect(countMessagesTokens(withImage) - countMessagesTokens(textOnly))
      .toBe(IMAGE_URL_TOKEN_ESTIMATE);
  });

  it('includes image_url parts once in original token metrics', () => {
    const compressor = new EnhancedContextCompressor(createTokenCounter('gpt-4'), {
      enableArchiving: false,
    });
    const textOnly = [{
      role: 'user',
      content: [{ type: 'text', text: 'describe this image' }],
    }] as unknown as CodeBuddyMessage[];
    const withImage = [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe this image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    }] as unknown as CodeBuddyMessage[];

    const textResult = compressor.compress(textOnly, 100_000);
    const imageResult = compressor.compress(withImage, 100_000);

    expect(imageResult.metrics.originalTokens - textResult.metrics.originalTokens)
      .toBe(IMAGE_URL_TOKEN_ESTIMATE);
  });

  it('preserves every system message in order during compression', () => {
    const compressor = new EnhancedContextCompressor(createTokenCounter('gpt-4'), {
      enableArchiving: false,
      slidingWindow: {
        windowSize: 3,
        overlapSize: 1,
        summarizeOldMessages: false,
      },
    });
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base prompt' },
      { role: 'system', content: '<context type="lessons">rule A</context>' },
      { role: 'system', content: '<context type="todo">next step</context>' },
    ];
    for (let index = 0; index < 20; index++) {
      messages.push({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${index}: ${'x'.repeat(160)}`,
      });
    }

    const result = compressor.compress(messages, 180);
    const systemContents = result.messages
      .filter(message => message.role === 'system')
      .map(message => message.content);

    expect(result.compressed).toBe(true);
    expect(systemContents).toEqual([
      'base prompt',
      '<context type="lessons">rule A</context>',
      '<context type="todo">next step</context>',
    ]);
    expect(result.messages.slice(0, 3).every(message => message.role === 'system')).toBe(true);
  });

  it('pays for the preserved system messages inside the requested budget', () => {
    // The system blocks are put back AFTER every strategy, so budgeting the
    // conversation against the full limit overshoots by exactly their cost —
    // and that cost grows with each injected block.
    const counter = createTokenCounter('gpt-4');
    const compressor = new EnhancedContextCompressor(counter, {
      enableArchiving: false,
      slidingWindow: { windowSize: 3, overlapSize: 1, summarizeOldMessages: false },
    });
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: `base prompt ${'b'.repeat(400)}` },
      { role: 'system', content: `<context type="lessons">${'l'.repeat(400)}</context>` },
      { role: 'system', content: `<context type="todo">${'t'.repeat(400)}</context>` },
    ];
    for (let index = 0; index < 20; index++) {
      messages.push({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${index}: ${'x'.repeat(160)}`,
      });
    }

    const limit = 600;
    const result = compressor.compress(messages, limit);

    expect(result.messages.filter(message => message.role === 'system')).toHaveLength(3);
    expect(counter.countMessageTokens(
      result.messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : null })),
    )).toBeLessThanOrEqual(limit);
  });

  it('charges a low-detail image at the flat provider rate, not the full estimate', () => {
    const lowDetail = [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe this image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'low' } },
      ],
    }];
    const textOnly = [{
      role: 'user',
      content: [{ type: 'text', text: 'describe this image' }],
    }];

    expect(countMessagesTokens(lowDetail) - countMessagesTokens(textOnly))
      .toBe(IMAGE_URL_LOW_DETAIL_TOKEN_ESTIMATE);
    expect(IMAGE_URL_LOW_DETAIL_TOKEN_ESTIMATE).toBeLessThan(IMAGE_URL_TOKEN_ESTIMATE);
  });
});
