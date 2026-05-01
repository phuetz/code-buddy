/**
 * Advisor Tool Tests
 *
 * Verifies that the advisor tool:
 * - reads conversation history from the registered provider
 * - forwards to a separate CodeBuddyClient with the configured model
 * - returns the advisor's content as ToolResult
 * - handles missing provider, missing API key, empty history, and call failures
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executeAdvisor,
  setAdvisorContextProvider,
  resetAdvisorContextProvider,
  type AdvisorContext,
} from '../../src/tools/advisor-tool.js';

// Mock the dynamic CodeBuddyClient import. Use vi.hoisted so the mockChat ref
// is available inside the vi.mock factory (factories are hoisted above imports).
const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class FakeCodeBuddyClient {
    constructor(_apiKey: string, _model?: string, _baseURL?: string) {}
    chat = mockChat;
  },
}));

describe('Advisor Tool', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ANTHROPIC_API_KEY: 'sk-test-1234' };
    mockChat.mockReset();
    resetAdvisorContextProvider();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    resetAdvisorContextProvider();
  });

  describe('config gating', () => {
    it('returns error when disabled', async () => {
      const result = await executeAdvisor({ enabled: false });
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('returns error when context provider not registered', async () => {
      const result = await executeAdvisor({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('provider not registered');
    });

    it('returns error when API key env var is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      setAdvisorContextProvider(() => ({
        messages: [{ role: 'user', content: 'hi' }],
      }));
      const result = await executeAdvisor({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('API key not set');
      expect(result.error).toContain('ANTHROPIC_API_KEY');
    });

    it('respects custom api_key_env', async () => {
      process.env.MY_CUSTOM_KEY = 'sk-custom';
      setAdvisorContextProvider(() => ({
        messages: [{ role: 'user', content: 'hi' }],
      }));
      mockChat.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'review ok' }, finish_reason: 'stop' }],
      });
      const result = await executeAdvisor({ api_key_env: 'MY_CUSTOM_KEY' });
      expect(result.success).toBe(true);
      delete process.env.MY_CUSTOM_KEY;
    });
  });

  describe('history forwarding', () => {
    it('returns error when history is empty', async () => {
      setAdvisorContextProvider(() => ({ messages: [] }));
      const result = await executeAdvisor({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('No conversation history');
    });

    it('forwards messages excluding system, prepending advisor system prompt and final user request', async () => {
      const history: AdvisorContext['messages'] = [
        { role: 'system', content: 'old system prompt' },
        { role: 'user', content: 'fix the bug' },
        { role: 'assistant', content: 'I will read the file' },
      ];
      setAdvisorContextProvider(() => ({ messages: history }));
      mockChat.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Looks risky.' }, finish_reason: 'stop' }],
      });

      const result = await executeAdvisor({});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Looks risky.');

      const callArgs = mockChat.mock.calls[0]![0];
      expect(callArgs[0].role).toBe('system');
      expect(callArgs[0].content).toContain('expert software engineering reviewer');
      expect(callArgs.some((m: { role: string }) => m.role === 'system' && m.content === 'old system prompt')).toBe(false);
      expect(callArgs.some((m: { role: string; content: string }) => m.role === 'user' && m.content === 'fix the bug')).toBe(true);
      expect(callArgs[callArgs.length - 1].role).toBe('user');
      expect(callArgs[callArgs.length - 1].content).toContain('review the assistant');
    });
  });

  describe('error handling', () => {
    it('returns error when client.chat throws', async () => {
      setAdvisorContextProvider(() => ({
        messages: [{ role: 'user', content: 'hi' }],
      }));
      mockChat.mockRejectedValue(new Error('rate limited'));
      const result = await executeAdvisor({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('rate limited');
    });

    it('returns error when advisor response is empty', async () => {
      setAdvisorContextProvider(() => ({
        messages: [{ role: 'user', content: 'hi' }],
      }));
      mockChat.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      });
      const result = await executeAdvisor({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty response');
    });
  });

  describe('output trimming', () => {
    it('trims whitespace from advisor response', async () => {
      setAdvisorContextProvider(() => ({
        messages: [{ role: 'user', content: 'hi' }],
      }));
      mockChat.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: '   verdict   \n' }, finish_reason: 'stop' }],
      });
      const result = await executeAdvisor({});
      expect(result.success).toBe(true);
      expect(result.output).toBe('verdict');
    });
  });
});
