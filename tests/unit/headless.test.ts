/**
 * Tests for Headless Mode Processing
 */

import {
  processPromptHeadless,
  handleCommitAndPushHeadless,
  readPipedInput,
  HeadlessOptions,
} from '../../src/cli/headless';

// Mock the agent module
jest.mock('../../src/agent/codebuddy-agent', () => {
  const mockAgent = {
    setSelfHealing: jest.fn(),
    processUserMessage: jest.fn(),
    executeBashCommand: jest.fn(),
  };

  return {
    CodeBuddyAgent: jest.fn(() => mockAgent),
    __mockAgent: mockAgent,
  };
});

// Mock the confirmation service
jest.mock('../../src/utils/confirmation-service', () => {
  const mockService = {
    setSessionFlag: jest.fn(),
  };

  return {
    ConfirmationService: {
      getInstance: jest.fn(() => mockService),
    },
    __mockService: mockService,
  };
});

// Get mocks for assertions
const { CodeBuddyAgent, __mockAgent: mockAgent } = jest.requireMock(
  '../../src/agent/codebuddy-agent'
);
const { ConfirmationService, __mockService: mockConfirmService } = jest.requireMock(
  '../../src/utils/confirmation-service'
);

describe('headless mode', () => {
  // Spy on console and process
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  const defaultOptions: HeadlessOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.x.ai/v1',
    model: 'grok-code-fast-1',
    maxToolRounds: 400,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('processPromptHeadless', () => {
    it('should create agent with provided options', async () => {
      mockAgent.processUserMessage.mockResolvedValue([]);

      await processPromptHeadless('test prompt', defaultOptions);

      expect(CodeBuddyAgent).toHaveBeenCalledWith(
        'test-api-key',
        'https://api.x.ai/v1',
        'grok-code-fast-1',
        400
      );
    });

    it('should disable self-healing when selfHealEnabled is false', async () => {
      mockAgent.processUserMessage.mockResolvedValue([]);

      await processPromptHeadless('test prompt', {
        ...defaultOptions,
        selfHealEnabled: false,
      });

      expect(mockAgent.setSelfHealing).toHaveBeenCalledWith(false);
    });

    it('should enable self-healing by default', async () => {
      mockAgent.processUserMessage.mockResolvedValue([]);

      await processPromptHeadless('test prompt', defaultOptions);

      // setSelfHealing should not be called with false when selfHealEnabled is true/default
      expect(mockAgent.setSelfHealing).not.toHaveBeenCalledWith(false);
    });

    it('should configure confirmation service for auto-approve', async () => {
      mockAgent.processUserMessage.mockResolvedValue([]);

      await processPromptHeadless('test prompt', defaultOptions);

      expect(ConfirmationService.getInstance).toHaveBeenCalled();
      expect(mockConfirmService.setSessionFlag).toHaveBeenCalledWith('allOperations', true);
    });

    it('should process user message through agent', async () => {
      mockAgent.processUserMessage.mockResolvedValue([]);

      await processPromptHeadless('my test prompt', defaultOptions);

      expect(mockAgent.processUserMessage).toHaveBeenCalledWith('my test prompt');
    });

    it('should output user messages as JSON', async () => {
      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'user', content: 'Hello' },
      ]);

      await processPromptHeadless('test prompt', defaultOptions);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({ role: 'user', content: 'Hello' })
      );
    });

    it('should output assistant messages as JSON', async () => {
      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: 'Hi there!' },
      ]);

      await processPromptHeadless('test prompt', defaultOptions);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({ role: 'assistant', content: 'Hi there!' })
      );
    });

    it('should output assistant messages with tool calls', async () => {
      mockAgent.processUserMessage.mockResolvedValue([
        {
          type: 'assistant',
          content: 'Using a tool',
          toolCalls: [
            {
              id: 'call-123',
              function: {
                name: 'read_file',
                arguments: '{"path": "/test/file.ts"}',
              },
            },
          ],
        },
      ]);

      await processPromptHeadless('test prompt', defaultOptions);

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.role).toBe('assistant');
      expect(output.tool_calls).toHaveLength(1);
      expect(output.tool_calls[0].id).toBe('call-123');
      expect(output.tool_calls[0].type).toBe('function');
      expect(output.tool_calls[0].function.name).toBe('read_file');
    });

    it('should output tool results as JSON', async () => {
      mockAgent.processUserMessage.mockResolvedValue([
        {
          type: 'tool_result',
          content: 'File content here',
          toolCall: {
            id: 'call-123',
          },
        },
      ]);

      await processPromptHeadless('test prompt', defaultOptions);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({
          role: 'tool',
          tool_call_id: 'call-123',
          content: 'File content here',
        })
      );
    });

    it('should skip tool results without toolCall reference', async () => {
      mockAgent.processUserMessage.mockResolvedValue([
        {
          type: 'tool_result',
          content: 'Orphan result',
          // No toolCall property
        },
      ]);

      await processPromptHeadless('test prompt', defaultOptions);

      // Should not output anything for orphan tool results
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should handle errors and output error message', async () => {
      mockAgent.processUserMessage.mockRejectedValue(new Error('API Error'));

      await expect(
        processPromptHeadless('test prompt', defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({ role: 'assistant', content: 'Error: API Error' })
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      mockAgent.processUserMessage.mockRejectedValue('String error');

      await expect(
        processPromptHeadless('test prompt', defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({ role: 'assistant', content: 'Error: String error' })
      );
    });

    it('should process multiple chat entries', async () => {
      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'user', content: 'Question' },
        { type: 'assistant', content: 'Answer' },
        { type: 'user', content: 'Follow up' },
        { type: 'assistant', content: 'More details' },
      ]);

      await processPromptHeadless('test prompt', defaultOptions);

      expect(consoleLogSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('handleCommitAndPushHeadless', () => {
    it('should create agent with provided options', async () => {
      mockAgent.executeBashCommand.mockResolvedValue({
        success: false,
        output: '',
      });

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(CodeBuddyAgent).toHaveBeenCalledWith(
        'test-api-key',
        'https://api.x.ai/v1',
        'grok-code-fast-1',
        400
      );
    });

    it('should configure confirmation service for auto-approve', async () => {
      mockAgent.executeBashCommand.mockResolvedValue({
        success: false,
        output: '',
      });

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(mockConfirmService.setSessionFlag).toHaveBeenCalledWith('allOperations', true);
    });

    it('should check git status first', async () => {
      mockAgent.executeBashCommand.mockResolvedValue({
        success: true,
        output: '',
      });

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(mockAgent.executeBashCommand).toHaveBeenCalledWith('git status --porcelain');
    });

    it('should exit when no changes to commit', async () => {
      mockAgent.executeBashCommand.mockResolvedValue({
        success: true,
        output: '', // Empty output means no changes
      });

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'No changes to commit. Working directory is clean.'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should stage changes with git add', async () => {
      // First call: git status (has changes)
      // Second call: git add
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' })
        .mockResolvedValueOnce({ success: false, error: 'Add failed' });

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(mockAgent.executeBashCommand).toHaveBeenNthCalledWith(2, 'git add .');
    });

    it('should exit when git add fails', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' })
        .mockResolvedValueOnce({ success: false, error: 'Staging failed' });

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith('git add: Staging failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should get diff for commit message generation', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' }) // status
        .mockResolvedValueOnce({ success: true }) // add
        .mockResolvedValueOnce({ success: true, output: 'diff output' }); // diff

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: '' },
      ]);

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(mockAgent.executeBashCommand).toHaveBeenNthCalledWith(3, 'git diff --cached');
    });

    it('should generate commit message using AI', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' }) // status
        .mockResolvedValueOnce({ success: true }) // add
        .mockResolvedValueOnce({ success: true, output: 'diff content' }); // diff

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: '' },
      ]);

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(mockAgent.processUserMessage).toHaveBeenCalledWith(
        expect.stringContaining('Generate a concise, professional git commit message')
      );
    });

    it('should exit when commit message generation fails', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, output: 'diff' });

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: '' }, // Empty content
      ]);

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith('Failed to generate commit message');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should execute commit with generated message', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' }) // status
        .mockResolvedValueOnce({ success: true }) // add
        .mockResolvedValueOnce({ success: true, output: 'diff' }) // diff
        .mockResolvedValueOnce({ success: false, error: 'Commit failed' }); // commit

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: 'feat: add new feature' },
      ]);

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(mockAgent.executeBashCommand).toHaveBeenCalledWith(
        'git commit -m "feat: add new feature"'
      );
    });

    it('should clean commit message by removing surrounding quotes', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, output: 'diff' })
        .mockResolvedValueOnce({ success: false, error: 'Commit failed' });

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: '"fix: quoted message"' },
      ]);

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(mockAgent.executeBashCommand).toHaveBeenCalledWith(
        'git commit -m "fix: quoted message"'
      );
    });

    it('should push after successful commit', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' }) // status
        .mockResolvedValueOnce({ success: true }) // add
        .mockResolvedValueOnce({ success: true, output: 'diff' }) // diff
        .mockResolvedValueOnce({ success: true, output: 'Commit success' }) // commit
        .mockResolvedValueOnce({ success: true, output: 'Push success' }); // push

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: 'feat: add feature' },
      ]);

      await handleCommitAndPushHeadless(defaultOptions);

      expect(mockAgent.executeBashCommand).toHaveBeenCalledWith('git push');
    });

    it('should try push with upstream when regular push fails', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' }) // status
        .mockResolvedValueOnce({ success: true }) // add
        .mockResolvedValueOnce({ success: true, output: 'diff' }) // diff
        .mockResolvedValueOnce({ success: true, output: 'Commit success' }) // commit
        .mockResolvedValueOnce({ success: false, error: 'no upstream branch' }) // push fails
        .mockResolvedValueOnce({ success: true, output: 'Push with upstream success' }); // push -u

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: 'feat: add feature' },
      ]);

      await handleCommitAndPushHeadless(defaultOptions);

      expect(mockAgent.executeBashCommand).toHaveBeenCalledWith('git push -u origin HEAD');
    });

    it('should exit when push fails', async () => {
      mockAgent.executeBashCommand
        .mockResolvedValueOnce({ success: true, output: 'M file.ts' })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, output: 'diff' })
        .mockResolvedValueOnce({ success: true, output: 'Commit success' })
        .mockResolvedValueOnce({ success: false, error: 'Push denied' });

      mockAgent.processUserMessage.mockResolvedValue([
        { type: 'assistant', content: 'feat: add feature' },
      ]);

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledWith('git push: Push denied');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle exceptions during execution', async () => {
      mockAgent.executeBashCommand.mockRejectedValue(new Error('Network error'));

      await expect(
        handleCommitAndPushHeadless(defaultOptions)
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error during commit and push:',
        'Network error'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('readPipedInput', () => {
    const originalStdin = process.stdin;

    afterEach(() => {
      // Restore stdin
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        writable: true,
      });
    });

    it('should return empty string when stdin is TTY', async () => {
      // Mock stdin as TTY
      Object.defineProperty(process, 'stdin', {
        value: {
          isTTY: true,
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('ignored');
          },
        },
        writable: true,
      });

      const result = await readPipedInput();

      expect(result).toBe('');
    });

    it('should read and return piped input', async () => {
      const testInput = 'piped content here';

      // Mock stdin as non-TTY with async iterator
      Object.defineProperty(process, 'stdin', {
        value: {
          isTTY: false,
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(testInput);
          },
        },
        writable: true,
      });

      const result = await readPipedInput();

      expect(result).toBe(testInput);
    });

    it('should concatenate multiple chunks', async () => {
      // Mock stdin with multiple chunks
      Object.defineProperty(process, 'stdin', {
        value: {
          isTTY: false,
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('chunk1');
            yield Buffer.from('chunk2');
            yield Buffer.from('chunk3');
          },
        },
        writable: true,
      });

      const result = await readPipedInput();

      expect(result).toBe('chunk1chunk2chunk3');
    });

    it('should trim whitespace from result', async () => {
      Object.defineProperty(process, 'stdin', {
        value: {
          isTTY: false,
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('  content with whitespace  \n');
          },
        },
        writable: true,
      });

      const result = await readPipedInput();

      expect(result).toBe('content with whitespace');
    });

    it('should handle empty piped input', async () => {
      Object.defineProperty(process, 'stdin', {
        value: {
          isTTY: false,
          [Symbol.asyncIterator]: async function* () {
            // No yields - empty input
          },
        },
        writable: true,
      });

      const result = await readPipedInput();

      expect(result).toBe('');
    });
  });
});
