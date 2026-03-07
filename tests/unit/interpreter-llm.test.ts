/**
 * Tests for InterpreterService LLM integration
 *
 * Covers processMessage(), getLLMClient(), and calculateCost()
 */


// Mock the dynamic import of CodeBuddyClient

import InterpreterService from '../../src/interpreter/interpreter-service.js';

const mockChat = jest.fn();

jest.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(function() { return {
    chat: mockChat,
  }; }),
}));

// Mock logger to suppress output
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock fs to avoid filesystem side effects during construction
jest.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn().mockReturnValue([]),
  };
});

describe('InterpreterService LLM Integration', () => {
  let service: InterpreterService;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.GROK_API_KEY;
    jest.clearAllMocks();

    // Create service with persistence disabled to avoid filesystem ops
    service = new InterpreterService({
      persistUsage: false,
      profilesDir: '/tmp/test-profiles',
    });
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.GROK_API_KEY = originalApiKey;
    } else {
      delete process.env.GROK_API_KEY;
    }
  });

  // ==========================================================================
  // processMessage (invoked via chat())
  // ==========================================================================

  describe('processMessage()', () => {
    it('should return error message when GROK_API_KEY is not set', async () => {
      delete process.env.GROK_API_KEY;

      const result = await service.chat('Hello');

      expect(result.content).toContain('GROK_API_KEY');
      expect(result.content).toContain('Error');
      expect(result.tokens).toEqual({ input: 0, output: 0, total: 0 });
      expect(result.cost).toBe(0);
      expect(result.autoApproved).toBe(false);
    });

    it('should return ChatResult with content, tokens, and cost on successful LLM call', async () => {
      process.env.GROK_API_KEY = 'test-key-123';

      mockChat.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Hello! How can I help?',
              tool_calls: undefined,
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      });

      const result = await service.chat('Hello');

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.tokens).toEqual({ input: 100, output: 50, total: 150 });
      expect(result.cost).toBeGreaterThan(0);
      expect(result.autoApproved).toBe(false); // default profile has autoRun=false
    });

    it('should build messages from profile customInstructions and conversation history', async () => {
      process.env.GROK_API_KEY = 'test-key-123';

      // Set custom instructions on the profile
      service.customInstructions = 'You are a Python expert.';

      mockChat.mockResolvedValue({
        choices: [{ message: { content: 'response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      // First message to build history
      await service.chat('First message');

      // Second message - should include history
      await service.chat('Second message');

      // Check the second call's messages argument
      const secondCallMessages = mockChat.mock.calls[1][0];

      // First message should be system prompt from profile
      expect(secondCallMessages[0]).toEqual({
        role: 'system',
        content: expect.any(String),
      });

      // Should contain custom instructions as a separate system message
      // (since customInstructions differs from profile's customInstructions)
      const systemMessages = secondCallMessages.filter(
        (m: { role: string }) => m.role === 'system'
      );
      expect(systemMessages.length).toBeGreaterThanOrEqual(1);

      // Should contain conversation history entries
      const userMessages = secondCallMessages.filter(
        (m: { role: string }) => m.role === 'user'
      );
      // History includes 'First message' from prior turn + 'response' assistant + 'Second message' current
      expect(userMessages.length).toBeGreaterThanOrEqual(2);
    });

    it('should use model from active profile', async () => {
      process.env.GROK_API_KEY = 'test-key-123';

      // Load a different profile to get a different model
      service.loadProfile('fast');

      mockChat.mockResolvedValueOnce({
        choices: [{ message: { content: 'fast response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await service.chat('test');

      // chat() is called with (messages, tools, options)
      const callOptions = mockChat.mock.calls[0][2];
      expect(callOptions).toEqual(
        expect.objectContaining({
          model: service.profile.model,
        })
      );
    });

    it('should handle tool_calls in LLM response', async () => {
      process.env.GROK_API_KEY = 'test-key-123';

      mockChat.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'I will read the file for you.',
              tool_calls: [
                {
                  id: 'call_001',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: '/tmp/test.txt' }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
      });

      const result = await service.chat('Read /tmp/test.txt');

      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_001',
        name: 'read_file',
        arguments: { path: '/tmp/test.txt' },
      });
    });

    it('should return error message when LLM call throws an error', async () => {
      process.env.GROK_API_KEY = 'test-key-123';

      mockChat.mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const result = await service.chat('Hello');

      expect(result.content).toContain('Error');
      expect(result.content).toContain('Rate limit exceeded');
      expect(result.tokens).toEqual({ input: 0, output: 0, total: 0 });
      expect(result.cost).toBe(0);
      expect(result.autoApproved).toBe(false);
    });

    it('should calculate cost correctly using calculateCost()', async () => {
      process.env.GROK_API_KEY = 'test-key-123';

      mockChat.mockResolvedValueOnce({
        choices: [{ message: { content: 'result' } }],
        usage: {
          prompt_tokens: 1_000_000,
          completion_tokens: 1_000_000,
          total_tokens: 2_000_000,
        },
      });

      const result = await service.chat('expensive query');

      // Default profile uses grok-3-mini: input=$0.30/1M, output=$0.50/1M
      // Cost = (1M / 1M) * 0.30 + (1M / 1M) * 0.50 = 0.80
      const expectedCost = service.calculateCost('grok-3-mini', {
        input: 1_000_000,
        output: 1_000_000,
        total: 2_000_000,
      });
      expect(result.cost).toBeCloseTo(expectedCost, 6);
      expect(result.cost).toBeCloseTo(0.80, 6);
    });
  });

  // ==========================================================================
  // getLLMClient (private, tested via behavior)
  // ==========================================================================

  describe('getLLMClient (lazy initialization)', () => {
    it('should create the client only once across multiple chat calls', async () => {
      process.env.GROK_API_KEY = 'test-key-123';

      const { CodeBuddyClient } = await import('../../src/codebuddy/client.js');

      mockChat.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

      // Clear constructor call count from any prior usage
      (CodeBuddyClient as unknown as jest.Mock).mockClear();

      await service.chat('first');
      await service.chat('second');
      await service.chat('third');

      // The CodeBuddyClient constructor should be called exactly once
      expect(CodeBuddyClient).toHaveBeenCalledTimes(1);
      expect(CodeBuddyClient).toHaveBeenCalledWith('test-key-123');

      // But chat should be called three times
      expect(mockChat).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // calculateCost()
  // ==========================================================================

  describe('calculateCost()', () => {
    it('should calculate cost for known models', () => {
      // grok-3: input=$3.00/1M, output=$15.00/1M
      const cost = service.calculateCost('grok-3', {
        input: 500_000,
        output: 100_000,
        total: 600_000,
      });

      const expectedInputCost = (500_000 / 1_000_000) * 3.0;
      const expectedOutputCost = (100_000 / 1_000_000) * 15.0;
      expect(cost).toBeCloseTo(expectedInputCost + expectedOutputCost, 6);
      expect(cost).toBeCloseTo(3.0, 6);
    });

    it('should fall back to grok-3-mini pricing for unknown models', () => {
      const cost = service.calculateCost('unknown-model-xyz', {
        input: 1_000_000,
        output: 1_000_000,
        total: 2_000_000,
      });

      // Fallback: grok-3-mini: input=$0.30/1M, output=$0.50/1M
      expect(cost).toBeCloseTo(0.80, 6);
    });

    it('should return 0 for local models', () => {
      const cost = service.calculateCost('ollama', {
        input: 1_000_000,
        output: 1_000_000,
        total: 2_000_000,
      });

      expect(cost).toBe(0);
    });

    it('should return 0 for zero tokens', () => {
      const cost = service.calculateCost('grok-3', {
        input: 0,
        output: 0,
        total: 0,
      });

      expect(cost).toBe(0);
    });
  });
});
