/**
 * Tests for Feishu Interactive Cards + Reasoning Streams
 * (Native Engine v2026.3.11 alignment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuAdapter } from '../../src/channels/feishu/index.js';
import type { FeishuCardAction, FeishuClient } from '../../src/channels/feishu/index.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('FeishuAdapter — Interactive Cards', () => {
  let adapter: FeishuAdapter;

  beforeEach(() => {
    adapter = new FeishuAdapter({
      appId: 'test-app',
      appSecret: 'test-secret',
      agentName: 'CodeBuddy',
    });
  });

  it('buildApprovalCard produces a valid Feishu card JSON', () => {
    const actions: FeishuCardAction[] = [
      { label: 'Approve', actionId: 'approve', style: 'primary' },
      { label: 'Reject', actionId: 'reject', style: 'danger' },
    ];

    const card = adapter.buildApprovalCard('Deploy to Production', 'Release v1.2.3', actions);

    expect(card.config).toEqual({ wide_screen_mode: true });
    expect(card.header).toBeDefined();
    expect((card.header as Record<string, unknown>).template).toBe('blue');

    const elements = card.elements as Array<Record<string, unknown>>;
    expect(elements.length).toBe(3); // div + hr + action
    expect(elements[0].tag).toBe('div');
    expect(elements[1].tag).toBe('hr');
    expect(elements[2].tag).toBe('action');

    const cardActions = (elements[2] as { actions: Array<Record<string, unknown>> }).actions;
    expect(cardActions.length).toBe(2);
    expect((cardActions[0].text as { content: string }).content).toBe('Approve');
    expect((cardActions[1].text as { content: string }).content).toBe('Reject');
  });

  it('buildApprovalCard includes agent name in subtitle when configured', () => {
    const card = adapter.buildApprovalCard('Test', 'desc', []);
    const header = card.header as Record<string, unknown>;
    expect(header.subtitle).toBeDefined();
    expect((header.subtitle as { content: string }).content).toBe('CodeBuddy');
  });

  it('buildActionLauncherCard produces valid card', () => {
    const buttons: FeishuCardAction[] = [
      { label: 'Run Tests', actionId: 'run-tests' },
      { label: 'Deploy', actionId: 'deploy', style: 'primary' },
    ];

    const card = adapter.buildActionLauncherCard('Quick Actions', buttons);

    expect(card.config).toEqual({ wide_screen_mode: true });
    expect((card.header as Record<string, unknown>).template).toBe('green');

    const elements = card.elements as Array<Record<string, unknown>>;
    expect(elements.length).toBe(1); // action only
    expect(elements[0].tag).toBe('action');

    const cardActions = (elements[0] as { actions: Array<Record<string, unknown>> }).actions;
    expect(cardActions.length).toBe(2);
  });
});

describe('FeishuAdapter — Reasoning Streams', () => {
  let adapter: FeishuAdapter;

  beforeEach(() => {
    adapter = new FeishuAdapter({
      appId: 'test-app',
      appSecret: 'test-secret',
    });
  });

  it('onReasoningStream handler called during streaming', () => {
    const chunks: string[] = [];
    adapter.onReasoningStream((chunk) => {
      chunks.push(chunk);
    });

    adapter.emitReasoningStream('Thinking about...');
    adapter.emitReasoningStream('the problem...');

    expect(chunks).toEqual(['Thinking about...', 'the problem...']);
  });

  it('onReasoningEnd handler called with full reasoning', () => {
    const results: string[] = [];
    adapter.onReasoningEnd((full) => {
      results.push(full);
    });

    adapter.emitReasoningEnd('Full reasoning text here');

    expect(results).toEqual(['Full reasoning text here']);
  });

  it('multiple handlers are all called', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    adapter.onReasoningStream(handler1);
    adapter.onReasoningStream(handler2);

    adapter.emitReasoningStream('test chunk');

    expect(handler1).toHaveBeenCalledWith('test chunk');
    expect(handler2).toHaveBeenCalledWith('test chunk');
  });

  it('handler errors do not prevent other handlers from running', () => {
    const handler1 = vi.fn(() => { throw new Error('fail'); });
    const handler2 = vi.fn();

    adapter.onReasoningStream(handler1);
    adapter.onReasoningStream(handler2);

    adapter.emitReasoningStream('test');

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });
});

describe('FeishuAdapter — Thread Context', () => {
  const createClient = (): FeishuClient => ({
    start: async () => ({ accessToken: 'tenant-token-1' }),
    sendText: async () => ({ success: true, messageId: 'msg-text-1' }),
    sendCard: async () => ({ success: true, messageId: 'msg-card-1' }),
    sendImage: async () => ({ success: true, messageId: 'msg-image-1' }),
    replyMessage: async () => ({ success: true }),
    getChatMembers: async () => [],
    getThreadMessages: async () => [],
  });

  it('getThreadMessages returns array', async () => {
    const adapter = new FeishuAdapter({
      appId: 'test-app',
      appSecret: 'test-secret',
      client: createClient(),
    });
    await adapter.start();

    const messages = await adapter.getThreadMessages('chat-123');
    expect(Array.isArray(messages)).toBe(true);
    expect(adapter.getAccessToken()).toBe('tenant-token-1');
  });

  it('start rejects when no Feishu client is configured', async () => {
    const adapter = new FeishuAdapter({
      appId: 'test-app',
      appSecret: 'test-secret',
    });

    await expect(adapter.start()).rejects.toThrow('Feishu client is not configured');
  });

  it('getThreadMessages throws if not running', async () => {
    const adapter = new FeishuAdapter({
      appId: 'test-app',
      appSecret: 'test-secret',
      client: createClient(),
    });

    await expect(adapter.getThreadMessages('chat-123')).rejects.toThrow('not running');
  });
});
