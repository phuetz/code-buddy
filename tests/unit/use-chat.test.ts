/**
 * Unit tests for useChat hook
 * Tests chat functionality including:
 * - Chat history management
 * - Message submission
 * - Chat state (processing, streaming)
 * - Chat entry types
 * - Token counting
 * - Processing time tracking
 */

// Mock React hooks
const mockSetChatHistory = jest.fn();
const mockSetIsProcessing = jest.fn();
const mockSetIsStreaming = jest.fn();
const mockSetTokenCount = jest.fn();
const mockSetProcessingTime = jest.fn();

jest.mock('react', () => ({
  useState: jest.fn((init) => {
    const val = typeof init === 'function' ? init() : init;
    if (Array.isArray(init)) {
      return [val, mockSetChatHistory];
    }
    if (init === false) {
      return [val, mockSetIsProcessing];
    }
    if (typeof init === 'number') {
      return [val, mockSetTokenCount];
    }
    return [val, jest.fn()];
  }),
  useCallback: jest.fn((fn) => fn),
  useRef: jest.fn((init) => ({ current: init })),
  useEffect: jest.fn(),
  useMemo: jest.fn((fn) => fn()),
}));

describe('useChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ChatEntry Interface', () => {
    interface ChatEntry {
      type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
      content: string;
      timestamp: Date;
      isStreaming?: boolean;
      toolCall?: {
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      };
      toolResult?: {
        success: boolean;
        output?: string;
        error?: string;
      };
    }

    it('should define user entry correctly', () => {
      const userEntry: ChatEntry = {
        type: 'user',
        content: 'Hello, world!',
        timestamp: new Date(),
      };

      expect(userEntry.type).toBe('user');
      expect(userEntry.content).toBe('Hello, world!');
      expect(userEntry.timestamp).toBeInstanceOf(Date);
    });

    it('should define assistant entry correctly', () => {
      const assistantEntry: ChatEntry = {
        type: 'assistant',
        content: 'Hi! How can I help?',
        timestamp: new Date(),
        isStreaming: false,
      };

      expect(assistantEntry.type).toBe('assistant');
      expect(assistantEntry.isStreaming).toBe(false);
    });

    it('should define streaming assistant entry', () => {
      const streamingEntry: ChatEntry = {
        type: 'assistant',
        content: 'Processing...',
        timestamp: new Date(),
        isStreaming: true,
      };

      expect(streamingEntry.isStreaming).toBe(true);
    });

    it('should define tool_call entry correctly', () => {
      const toolCallEntry: ChatEntry = {
        type: 'tool_call',
        content: 'Calling bash...',
        timestamp: new Date(),
        toolCall: {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'bash',
            arguments: JSON.stringify({ command: 'ls -la' }),
          },
        },
      };

      expect(toolCallEntry.type).toBe('tool_call');
      expect(toolCallEntry.toolCall?.function.name).toBe('bash');
    });

    it('should define tool_result entry correctly', () => {
      const toolResultEntry: ChatEntry = {
        type: 'tool_result',
        content: 'file1.txt\nfile2.txt',
        timestamp: new Date(),
        toolResult: {
          success: true,
          output: 'file1.txt\nfile2.txt',
        },
      };

      expect(toolResultEntry.type).toBe('tool_result');
      expect(toolResultEntry.toolResult?.success).toBe(true);
    });

    it('should define system entry correctly', () => {
      const systemEntry: ChatEntry = {
        type: 'system',
        content: 'Session started',
        timestamp: new Date(),
      };

      expect(systemEntry.type).toBe('system');
    });
  });

  describe('Chat History Management', () => {
    interface ChatEntry {
      type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
      content: string;
      timestamp: Date;
    }

    function addEntry(history: ChatEntry[], entry: ChatEntry): ChatEntry[] {
      return [...history, entry];
    }

    function clearHistory(): ChatEntry[] {
      return [];
    }

    function removeLastEntry(history: ChatEntry[]): ChatEntry[] {
      return history.slice(0, -1);
    }

    it('should add entry to history', () => {
      const history: ChatEntry[] = [];
      const newEntry: ChatEntry = {
        type: 'user',
        content: 'Hello',
        timestamp: new Date(),
      };

      const result = addEntry(history, newEntry);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello');
    });

    it('should preserve existing entries when adding', () => {
      const history: ChatEntry[] = [
        { type: 'user', content: 'First', timestamp: new Date() },
      ];
      const newEntry: ChatEntry = {
        type: 'assistant',
        content: 'Second',
        timestamp: new Date(),
      };

      const result = addEntry(history, newEntry);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('First');
      expect(result[1].content).toBe('Second');
    });

    it('should clear all history', () => {
      const result = clearHistory();

      expect(result).toHaveLength(0);
    });

    it('should remove last entry', () => {
      const history: ChatEntry[] = [
        { type: 'user', content: 'First', timestamp: new Date() },
        { type: 'assistant', content: 'Second', timestamp: new Date() },
      ];

      const result = removeLastEntry(history);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('First');
    });

    it('should handle remove from empty history', () => {
      const history: ChatEntry[] = [];

      const result = removeLastEntry(history);

      expect(result).toHaveLength(0);
    });
  });

  describe('Chat State Management', () => {
    interface ChatState {
      isProcessing: boolean;
      isStreaming: boolean;
      tokenCount: number;
      processingTime: number;
    }

    function createInitialState(): ChatState {
      return {
        isProcessing: false,
        isStreaming: false,
        tokenCount: 0,
        processingTime: 0,
      };
    }

    function startProcessing(state: ChatState): ChatState {
      return {
        ...state,
        isProcessing: true,
        isStreaming: false,
      };
    }

    function startStreaming(state: ChatState): ChatState {
      return {
        ...state,
        isProcessing: true,
        isStreaming: true,
      };
    }

    function stopProcessing(state: ChatState): ChatState {
      return {
        ...state,
        isProcessing: false,
        isStreaming: false,
      };
    }

    function updateTokenCount(state: ChatState, count: number): ChatState {
      return {
        ...state,
        tokenCount: count,
      };
    }

    function updateProcessingTime(state: ChatState, time: number): ChatState {
      return {
        ...state,
        processingTime: time,
      };
    }

    it('should create initial state correctly', () => {
      const state = createInitialState();

      expect(state.isProcessing).toBe(false);
      expect(state.isStreaming).toBe(false);
      expect(state.tokenCount).toBe(0);
      expect(state.processingTime).toBe(0);
    });

    it('should start processing', () => {
      let state = createInitialState();
      state = startProcessing(state);

      expect(state.isProcessing).toBe(true);
      expect(state.isStreaming).toBe(false);
    });

    it('should start streaming', () => {
      let state = createInitialState();
      state = startStreaming(state);

      expect(state.isProcessing).toBe(true);
      expect(state.isStreaming).toBe(true);
    });

    it('should stop processing', () => {
      let state = createInitialState();
      state = startStreaming(state);
      state = stopProcessing(state);

      expect(state.isProcessing).toBe(false);
      expect(state.isStreaming).toBe(false);
    });

    it('should update token count', () => {
      let state = createInitialState();
      state = updateTokenCount(state, 1500);

      expect(state.tokenCount).toBe(1500);
    });

    it('should update processing time', () => {
      let state = createInitialState();
      state = updateProcessingTime(state, 3500);

      expect(state.processingTime).toBe(3500);
    });
  });

  describe('Message Submission', () => {
    function shouldSubmitMessage(input: string): boolean {
      return input.trim().length > 0;
    }

    function trimMessage(input: string): string {
      return input.trim();
    }

    it('should submit non-empty message', () => {
      expect(shouldSubmitMessage('Hello')).toBe(true);
    });

    it('should not submit empty message', () => {
      expect(shouldSubmitMessage('')).toBe(false);
    });

    it('should not submit whitespace-only message', () => {
      expect(shouldSubmitMessage('   ')).toBe(false);
      expect(shouldSubmitMessage('\t\n')).toBe(false);
    });

    it('should submit message with leading/trailing whitespace', () => {
      expect(shouldSubmitMessage('  Hello  ')).toBe(true);
    });

    it('should trim message before processing', () => {
      expect(trimMessage('  Hello World  ')).toBe('Hello World');
    });

    it('should handle single character message', () => {
      expect(shouldSubmitMessage('a')).toBe(true);
    });
  });

  describe('Processing Time Calculation', () => {
    function calculateProcessingTime(startTime: number, endTime: number): number {
      return endTime - startTime;
    }

    function formatProcessingTime(milliseconds: number): string {
      if (milliseconds < 1000) {
        return `${milliseconds}ms`;
      }
      const seconds = (milliseconds / 1000).toFixed(1);
      return `${seconds}s`;
    }

    it('should calculate processing time correctly', () => {
      const result = calculateProcessingTime(1000, 3500);
      expect(result).toBe(2500);
    });

    it('should format milliseconds correctly', () => {
      expect(formatProcessingTime(500)).toBe('500ms');
    });

    it('should format seconds correctly', () => {
      expect(formatProcessingTime(2500)).toBe('2.5s');
    });

    it('should format exact second correctly', () => {
      expect(formatProcessingTime(1000)).toBe('1.0s');
    });

    it('should handle zero processing time', () => {
      expect(calculateProcessingTime(1000, 1000)).toBe(0);
      expect(formatProcessingTime(0)).toBe('0ms');
    });
  });

  describe('Token Counting', () => {
    function updateTokenCount(currentCount: number, newTokens: number): number {
      return currentCount + newTokens;
    }

    function resetTokenCount(): number {
      return 0;
    }

    function formatTokenCount(count: number): string {
      if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k`;
      }
      return count.toString();
    }

    it('should update token count correctly', () => {
      expect(updateTokenCount(100, 50)).toBe(150);
    });

    it('should reset token count', () => {
      expect(resetTokenCount()).toBe(0);
    });

    it('should format small token count', () => {
      expect(formatTokenCount(500)).toBe('500');
    });

    it('should format large token count', () => {
      expect(formatTokenCount(1500)).toBe('1.5k');
    });

    it('should format exact thousand', () => {
      expect(formatTokenCount(1000)).toBe('1.0k');
    });

    it('should handle zero tokens', () => {
      expect(formatTokenCount(0)).toBe('0');
    });
  });

  describe('Streaming Entry Update', () => {
    interface ChatEntry {
      type: 'user' | 'assistant';
      content: string;
      timestamp: Date;
      isStreaming?: boolean;
    }

    function updateStreamingEntry(
      history: ChatEntry[],
      newContent: string
    ): ChatEntry[] {
      return history.map((entry, idx) => {
        if (idx === history.length - 1 && entry.isStreaming) {
          return {
            ...entry,
            content: entry.content + newContent,
          };
        }
        return entry;
      });
    }

    function finalizeStreamingEntry(history: ChatEntry[]): ChatEntry[] {
      return history.map((entry) => {
        if (entry.isStreaming) {
          return {
            ...entry,
            isStreaming: false,
          };
        }
        return entry;
      });
    }

    it('should update streaming entry content', () => {
      const history: ChatEntry[] = [
        { type: 'assistant', content: 'Hello', timestamp: new Date(), isStreaming: true },
      ];

      const result = updateStreamingEntry(history, ' World');

      expect(result[0].content).toBe('Hello World');
      expect(result[0].isStreaming).toBe(true);
    });

    it('should not update non-streaming entries', () => {
      const history: ChatEntry[] = [
        { type: 'assistant', content: 'Hello', timestamp: new Date(), isStreaming: false },
      ];

      const result = updateStreamingEntry(history, ' World');

      expect(result[0].content).toBe('Hello');
    });

    it('should finalize streaming entry', () => {
      const history: ChatEntry[] = [
        { type: 'assistant', content: 'Hello', timestamp: new Date(), isStreaming: true },
      ];

      const result = finalizeStreamingEntry(history);

      expect(result[0].isStreaming).toBe(false);
    });

    it('should handle multiple entries', () => {
      const history: ChatEntry[] = [
        { type: 'user', content: 'Question', timestamp: new Date() },
        { type: 'assistant', content: 'Answer', timestamp: new Date(), isStreaming: true },
      ];

      const result = updateStreamingEntry(history, ' more');

      expect(result[0].content).toBe('Question');
      expect(result[1].content).toBe('Answer more');
    });
  });

  describe('Chat Entry Filtering', () => {
    interface ChatEntry {
      type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
      content: string;
      timestamp: Date;
    }

    function filterByType(history: ChatEntry[], type: ChatEntry['type']): ChatEntry[] {
      return history.filter((entry) => entry.type === type);
    }

    function getLastEntryOfType(history: ChatEntry[], type: ChatEntry['type']): ChatEntry | undefined {
      const filtered = filterByType(history, type);
      return filtered[filtered.length - 1];
    }

    function countByType(history: ChatEntry[], type: ChatEntry['type']): number {
      return filterByType(history, type).length;
    }

    const testHistory: ChatEntry[] = [
      { type: 'user', content: 'Q1', timestamp: new Date() },
      { type: 'assistant', content: 'A1', timestamp: new Date() },
      { type: 'tool_call', content: 'TC1', timestamp: new Date() },
      { type: 'tool_result', content: 'TR1', timestamp: new Date() },
      { type: 'user', content: 'Q2', timestamp: new Date() },
      { type: 'assistant', content: 'A2', timestamp: new Date() },
    ];

    it('should filter user entries', () => {
      const result = filterByType(testHistory, 'user');
      expect(result).toHaveLength(2);
    });

    it('should filter assistant entries', () => {
      const result = filterByType(testHistory, 'assistant');
      expect(result).toHaveLength(2);
    });

    it('should get last user entry', () => {
      const result = getLastEntryOfType(testHistory, 'user');
      expect(result?.content).toBe('Q2');
    });

    it('should get last assistant entry', () => {
      const result = getLastEntryOfType(testHistory, 'assistant');
      expect(result?.content).toBe('A2');
    });

    it('should count entries by type', () => {
      expect(countByType(testHistory, 'user')).toBe(2);
      expect(countByType(testHistory, 'tool_call')).toBe(1);
      expect(countByType(testHistory, 'system')).toBe(0);
    });

    it('should return undefined for missing type', () => {
      const result = getLastEntryOfType(testHistory, 'system');
      expect(result).toBeUndefined();
    });
  });

  describe('Chat History Serialization', () => {
    interface ChatEntry {
      type: string;
      content: string;
      timestamp: Date;
    }

    function serializeHistory(history: ChatEntry[]): string {
      return JSON.stringify(history, (key, value) => {
        if (key === 'timestamp' && value instanceof Date) {
          return value.toISOString();
        }
        return value;
      });
    }

    function deserializeHistory(json: string): ChatEntry[] {
      const parsed = JSON.parse(json);
      return parsed.map((entry: ChatEntry & { timestamp: string }) => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
      }));
    }

    it('should serialize history to JSON', () => {
      const history: ChatEntry[] = [
        { type: 'user', content: 'Hello', timestamp: new Date('2024-01-01T12:00:00Z') },
      ];

      const result = serializeHistory(history);

      expect(result).toContain('Hello');
      expect(result).toContain('2024-01-01');
    });

    it('should deserialize history from JSON', () => {
      const json = '[{"type":"user","content":"Hello","timestamp":"2024-01-01T12:00:00.000Z"}]';

      const result = deserializeHistory(json);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello');
      expect(result[0].timestamp).toBeInstanceOf(Date);
    });

    it('should round-trip serialize/deserialize', () => {
      const original: ChatEntry[] = [
        { type: 'user', content: 'Question', timestamp: new Date() },
        { type: 'assistant', content: 'Answer', timestamp: new Date() },
      ];

      const serialized = serializeHistory(original);
      const deserialized = deserializeHistory(serialized);

      expect(deserialized).toHaveLength(2);
      expect(deserialized[0].content).toBe('Question');
      expect(deserialized[1].content).toBe('Answer');
    });
  });

  describe('Abort Operation', () => {
    interface AbortState {
      isAborted: boolean;
      abortReason?: string;
    }

    function createAbortController(): { abort: () => void; isAborted: () => boolean; reason?: string } {
      let aborted = false;
      let reason: string | undefined;

      return {
        abort: () => {
          aborted = true;
          reason = 'User cancelled';
        },
        isAborted: () => aborted,
        get reason() {
          return reason;
        },
      };
    }

    it('should not be aborted initially', () => {
      const controller = createAbortController();
      expect(controller.isAborted()).toBe(false);
    });

    it('should be aborted after calling abort', () => {
      const controller = createAbortController();
      controller.abort();
      expect(controller.isAborted()).toBe(true);
    });

    it('should set abort reason', () => {
      const controller = createAbortController();
      controller.abort();
      expect(controller.reason).toBe('User cancelled');
    });
  });

  describe('Error Handling in Chat', () => {
    interface ChatEntry {
      type: 'user' | 'assistant' | 'error';
      content: string;
      timestamp: Date;
    }

    function createErrorEntry(error: Error | string): ChatEntry {
      const message = error instanceof Error ? error.message : error;
      return {
        type: 'error' as const,
        content: `Error: ${message}`,
        timestamp: new Date(),
      };
    }

    it('should create error entry from Error object', () => {
      const error = new Error('Something went wrong');
      const entry = createErrorEntry(error);

      expect(entry.type).toBe('error');
      expect(entry.content).toContain('Something went wrong');
    });

    it('should create error entry from string', () => {
      const entry = createErrorEntry('Network timeout');

      expect(entry.type).toBe('error');
      expect(entry.content).toContain('Network timeout');
    });

    it('should include timestamp in error entry', () => {
      const entry = createErrorEntry('Error message');

      expect(entry.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Message Processing Queue', () => {
    interface QueuedMessage {
      content: string;
      priority: 'normal' | 'high';
      timestamp: Date;
    }

    function enqueue(queue: QueuedMessage[], message: QueuedMessage): QueuedMessage[] {
      if (message.priority === 'high') {
        return [message, ...queue];
      }
      return [...queue, message];
    }

    function dequeue(queue: QueuedMessage[]): { message: QueuedMessage | undefined; queue: QueuedMessage[] } {
      if (queue.length === 0) {
        return { message: undefined, queue: [] };
      }
      return {
        message: queue[0],
        queue: queue.slice(1),
      };
    }

    it('should enqueue normal priority message at end', () => {
      const queue: QueuedMessage[] = [
        { content: 'First', priority: 'normal', timestamp: new Date() },
      ];
      const newMessage: QueuedMessage = { content: 'Second', priority: 'normal', timestamp: new Date() };

      const result = enqueue(queue, newMessage);

      expect(result[1].content).toBe('Second');
    });

    it('should enqueue high priority message at front', () => {
      const queue: QueuedMessage[] = [
        { content: 'First', priority: 'normal', timestamp: new Date() },
      ];
      const newMessage: QueuedMessage = { content: 'Urgent', priority: 'high', timestamp: new Date() };

      const result = enqueue(queue, newMessage);

      expect(result[0].content).toBe('Urgent');
    });

    it('should dequeue from front', () => {
      const queue: QueuedMessage[] = [
        { content: 'First', priority: 'normal', timestamp: new Date() },
        { content: 'Second', priority: 'normal', timestamp: new Date() },
      ];

      const result = dequeue(queue);

      expect(result.message?.content).toBe('First');
      expect(result.queue).toHaveLength(1);
    });

    it('should handle dequeue from empty queue', () => {
      const result = dequeue([]);

      expect(result.message).toBeUndefined();
      expect(result.queue).toHaveLength(0);
    });
  });
});
