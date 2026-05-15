import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBtw, setBtwClient } from '../../src/commands/handlers/btw-handler.js';

describe('handleBtw', () => {
  beforeEach(() => {
    setBtwClient(null);
  });

  it('returns usage when no args provided', async () => {
    const result = await handleBtw([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Usage: /btw');
  });

  it('returns error when client not available', async () => {
    const result = await handleBtw(['what', 'is', 'CORS?']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('client not available');
  });

  it('makes one-shot LLM call and returns response', async () => {
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'CORS is Cross-Origin Resource Sharing.' }, finish_reason: 'stop' }],
      }),
    };
    setBtwClient(mockClient as any);

    const result = await handleBtw(['what', 'is', 'CORS?']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('CORS is Cross-Origin Resource Sharing');
    expect(result.entry?.content).toContain('[/btw]');

    // Verify the call was made with minimal system prompt
    expect(mockClient.chat).toHaveBeenCalledWith([
      { role: 'system', content: 'Answer this side question briefly. Do not use tools.' },
      { role: 'user', content: 'what is CORS?' },
    ]);
  });

  it('does not set passToAI flag', async () => {
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
      }),
    };
    setBtwClient(mockClient as any);

    const result = await handleBtw(['test']);
    expect(result.passToAI).toBeUndefined();
  });

  it('handles LLM errors gracefully', async () => {
    const mockClient = {
      chat: vi.fn().mockRejectedValue(new Error('API rate limit')),
    };
    setBtwClient(mockClient as any);

    const result = await handleBtw(['test', 'question']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('API rate limit');
  });

  it('reports an error when response has no content', async () => {
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      }),
    };
    setBtwClient(mockClient as any);

    const result = await handleBtw(['test']);
    expect(result.entry?.content).toContain('/btw received no assistant response');
  });
});
