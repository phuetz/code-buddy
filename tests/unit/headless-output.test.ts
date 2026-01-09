/**
 * Comprehensive Unit Tests for Headless Output
 *
 * Tests cover:
 * 1. JSON formatting
 * 2. Stream JSON formatting (NDJSON)
 * 3. Text formatting
 * 4. Markdown formatting
 * 5. HeadlessResult creation
 * 6. Output format selection
 */

import {
  formatAsJson,
  formatAsStreamJson,
  formatAsText,
  formatAsMarkdown,
  createHeadlessResult,
  formatOutput,
  HeadlessResult,
  HeadlessMessage,
  ResultSummary,
  ResultMetadata,
  OutputFormat,
} from '../../src/utils/headless-output';

describe('Headless Output', () => {
  // Sample data for tests
  const sampleMessages: HeadlessMessage[] = [
    {
      role: 'user',
      content: 'Hello, can you help me?',
      timestamp: '2024-01-01T12:00:00.000Z',
    },
    {
      role: 'assistant',
      content: 'Of course! How can I assist you today?',
      timestamp: '2024-01-01T12:00:01.000Z',
    },
    {
      role: 'tool',
      content: '',
      timestamp: '2024-01-01T12:00:02.000Z',
      toolCall: {
        id: 'tool_1',
        name: 'bash',
        arguments: { command: 'ls -la' },
      },
      toolResult: {
        success: true,
        output: 'total 0\ndrwxr-xr-x 2 user user 40 Jan  1 12:00 .',
      },
    },
  ];

  const sampleSummary: ResultSummary = {
    totalMessages: 3,
    toolCalls: 1,
    successfulTools: 1,
    failedTools: 0,
    filesModified: ['file1.ts'],
    filesCreated: ['file2.ts'],
    commandsExecuted: ['ls -la'],
    errors: [],
  };

  const sampleMetadata: ResultMetadata = {
    model: 'grok-3',
    startTime: '2024-01-01T12:00:00.000Z',
    endTime: '2024-01-01T12:00:05.000Z',
    durationMs: 5000,
    workingDirectory: '/test/project',
  };

  const sampleResult: HeadlessResult = {
    success: true,
    exitCode: 0,
    messages: sampleMessages,
    summary: sampleSummary,
    metadata: sampleMetadata,
  };

  describe('formatAsJson', () => {
    it('should format result as pretty JSON', () => {
      const json = formatAsJson(sampleResult);

      expect(json).toBeDefined();
      expect(typeof json).toBe('string');

      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(true);
      expect(parsed.exitCode).toBe(0);
    });

    it('should include all result properties', () => {
      const json = formatAsJson(sampleResult);
      const parsed = JSON.parse(json);

      expect(parsed.messages).toHaveLength(3);
      expect(parsed.summary).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });

    it('should include messages with correct structure', () => {
      const json = formatAsJson(sampleResult);
      const parsed = JSON.parse(json);

      const userMessage = parsed.messages[0];
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBeDefined();
      expect(userMessage.timestamp).toBeDefined();
    });

    it('should include tool calls', () => {
      const json = formatAsJson(sampleResult);
      const parsed = JSON.parse(json);

      const toolMessage = parsed.messages[2];
      expect(toolMessage.toolCall).toBeDefined();
      expect(toolMessage.toolCall.name).toBe('bash');
      expect(toolMessage.toolResult).toBeDefined();
    });

    it('should be valid JSON', () => {
      const json = formatAsJson(sampleResult);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should format with 2-space indentation', () => {
      const json = formatAsJson(sampleResult);

      expect(json).toContain('\n  '); // 2-space indent
    });
  });

  describe('formatAsStreamJson', () => {
    it('should return array of JSON strings', () => {
      const lines = formatAsStreamJson(sampleMessages);

      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBe(3);
    });

    it('should have one JSON object per line', () => {
      const lines = formatAsStreamJson(sampleMessages);

      lines.forEach(line => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('should contain message data in each line', () => {
      const lines = formatAsStreamJson(sampleMessages);

      const firstMessage = JSON.parse(lines[0]);
      expect(firstMessage.role).toBe('user');
      expect(firstMessage.content).toBe('Hello, can you help me?');
    });

    it('should work with empty messages array', () => {
      const lines = formatAsStreamJson([]);

      expect(lines).toEqual([]);
    });
  });

  describe('formatAsText', () => {
    it('should format result as plain text', () => {
      const text = formatAsText(sampleResult);

      expect(text).toBeDefined();
      expect(typeof text).toBe('string');
    });

    it('should include user messages with > prefix', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('> Hello, can you help me?');
    });

    it('should include assistant messages', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('Of course! How can I assist you today?');
    });

    it('should include tool calls', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('[Tool: bash]');
    });

    it('should include successful tool output', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('drwxr-xr-x');
    });

    it('should include error for failed tools', () => {
      const resultWithError: HeadlessResult = {
        ...sampleResult,
        messages: [
          {
            role: 'tool',
            content: '',
            timestamp: '2024-01-01T12:00:02.000Z',
            toolCall: {
              id: 'tool_1',
              name: 'bash',
              arguments: { command: 'invalid' },
            },
            toolResult: {
              success: false,
              error: 'Command not found',
            },
          },
        ],
      };

      const text = formatAsText(resultWithError);

      expect(text).toContain('Error: Command not found');
    });

    it('should include summary section', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('---');
      expect(text).toContain('Success: true');
      expect(text).toContain('Tool calls: 1');
    });

    it('should include files modified', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('Files modified: file1.ts');
    });

    it('should include files created', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('Files created: file2.ts');
    });

    it('should include duration', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('Duration: 5000ms');
    });

    it('should include errors when present', () => {
      const resultWithErrors: HeadlessResult = {
        ...sampleResult,
        summary: {
          ...sampleSummary,
          errors: ['Error 1', 'Error 2'],
        },
      };

      const text = formatAsText(resultWithErrors);

      expect(text).toContain('Errors: Error 1, Error 2');
    });

    it('should show Success output for tools without output', () => {
      const resultNoOutput: HeadlessResult = {
        ...sampleResult,
        messages: [
          {
            role: 'tool',
            content: '',
            timestamp: '2024-01-01T12:00:02.000Z',
            toolCall: {
              id: 'tool_1',
              name: 'bash',
              arguments: { command: 'touch file' },
            },
            toolResult: {
              success: true,
            },
          },
        ],
      };

      const text = formatAsText(resultNoOutput);

      expect(text).toContain('Success');
    });
  });

  describe('formatAsMarkdown', () => {
    it('should format result as Markdown', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toBeDefined();
      expect(typeof md).toBe('string');
    });

    it('should include main header', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('# Grok CLI Result');
    });

    it('should include conversation section', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('## Conversation');
    });

    it('should include user message header', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('### User');
    });

    it('should include assistant message header', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('### Assistant');
    });

    it('should include tool header with name', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('### Tool: `bash`');
    });

    it('should include tool arguments in code block', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('```json');
      expect(md).toContain('"command": "ls -la"');
    });

    it('should include tool result', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('**Result:**');
      expect(md).toContain('drwxr-xr-x');
    });

    it('should show error in tool result', () => {
      const resultWithError: HeadlessResult = {
        ...sampleResult,
        messages: [
          {
            role: 'tool',
            content: '',
            timestamp: '2024-01-01T12:00:02.000Z',
            toolCall: {
              id: 'tool_1',
              name: 'bash',
              arguments: { command: 'invalid' },
            },
            toolResult: {
              success: false,
              error: 'Command not found',
            },
          },
        ],
      };

      const md = formatAsMarkdown(resultWithError);

      expect(md).toContain('Error: Command not found');
    });

    it('should include summary table', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('## Summary');
      expect(md).toContain('| Metric | Value |');
      expect(md).toContain('|--------|-------|');
    });

    it('should include success status', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('| Success |');
    });

    it('should include exit code', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('| Exit Code | 0 |');
    });

    it('should include tool statistics', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('| Tool Calls | 1 |');
      expect(md).toContain('| Successful Tools | 1 |');
      expect(md).toContain('| Failed Tools | 0 |');
    });

    it('should include files modified section', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('### Files Modified');
      expect(md).toContain('- `file1.ts`');
    });

    it('should include files created section', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('### Files Created');
      expect(md).toContain('- `file2.ts`');
    });

    it('should include commands executed section', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('### Commands Executed');
      expect(md).toContain('- `ls -la`');
    });

    it('should include errors section when present', () => {
      const resultWithErrors: HeadlessResult = {
        ...sampleResult,
        summary: {
          ...sampleSummary,
          errors: ['Error message'],
        },
      };

      const md = formatAsMarkdown(resultWithErrors);

      expect(md).toContain('### Errors');
      expect(md).toContain('- Error message');
    });

    it('should include metadata section', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('## Metadata');
      expect(md).toContain('**Model**: grok-3');
      expect(md).toContain('**Working Directory**: /test/project');
    });
  });

  describe('createHeadlessResult', () => {
    it('should create result from chat entries', () => {
      const entries = [
        {
          type: 'user',
          content: 'Hello',
          timestamp: new Date('2024-01-01T12:00:00.000Z'),
        },
        {
          type: 'assistant',
          content: 'Hi there!',
          timestamp: new Date('2024-01-01T12:00:01.000Z'),
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date('2024-01-01T12:00:00.000Z'),
        workingDirectory: '/test',
      });

      expect(result).toBeDefined();
      expect(result.messages).toHaveLength(2);
      expect(result.metadata.model).toBe('grok-3');
    });

    it('should map entry types to roles', () => {
      const entries = [
        { type: 'user', content: 'User message', timestamp: new Date() },
        { type: 'assistant', content: 'Assistant message', timestamp: new Date() },
        { type: 'tool_result', content: 'Tool result', timestamp: new Date() },
        { type: 'system', content: 'System message', timestamp: new Date() },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[2].role).toBe('tool');
      expect(result.messages[3].role).toBe('system');
    });

    it('should track tool calls', () => {
      const entries = [
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCall: {
            id: 'tool_1',
            function: { name: 'bash', arguments: '{"command":"ls"}' },
          },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.summary.toolCalls).toBe(1);
      expect(result.messages[0].toolCall?.name).toBe('bash');
    });

    it('should track successful and failed tools', () => {
      const entries = [
        {
          type: 'tool_result',
          content: '',
          timestamp: new Date(),
          toolResult: { success: true, output: 'Success' },
        },
        {
          type: 'tool_result',
          content: '',
          timestamp: new Date(),
          toolResult: { success: false, error: 'Failed' },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.summary.successfulTools).toBe(1);
      expect(result.summary.failedTools).toBe(1);
    });

    it('should track files modified', () => {
      const entries = [
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCall: {
            id: 'tool_1',
            function: {
              name: 'str_replace_editor',
              arguments: '{"path":"/test/file.ts","content":"new content"}',
            },
          },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.summary.filesModified).toContain('/test/file.ts');
    });

    it('should track files created', () => {
      const entries = [
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCall: {
            id: 'tool_1',
            function: {
              name: 'create_file',
              arguments: '{"path":"/test/new-file.ts","content":"content"}',
            },
          },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.summary.filesCreated).toContain('/test/new-file.ts');
    });

    it('should track commands executed', () => {
      const entries = [
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCall: {
            id: 'tool_1',
            function: {
              name: 'bash',
              arguments: '{"command":"npm install"}',
            },
          },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.summary.commandsExecuted).toContain('npm install');
    });

    it('should track errors', () => {
      const entries = [
        {
          type: 'tool_result',
          content: '',
          timestamp: new Date(),
          toolResult: { success: false, error: 'Something went wrong' },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.summary.errors).toContain('Something went wrong');
    });

    it('should set success based on errors', () => {
      const successEntries = [
        {
          type: 'tool_result',
          content: '',
          timestamp: new Date(),
          toolResult: { success: true },
        },
      ];

      const failEntries = [
        {
          type: 'tool_result',
          content: '',
          timestamp: new Date(),
          toolResult: { success: false, error: 'Error' },
        },
      ];

      const successResult = createHeadlessResult(successEntries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      const failResult = createHeadlessResult(failEntries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(successResult.success).toBe(true);
      expect(successResult.exitCode).toBe(0);
      expect(failResult.success).toBe(false);
      expect(failResult.exitCode).toBe(1);
    });

    it('should allow overriding success', () => {
      const entries = [
        {
          type: 'tool_result',
          content: '',
          timestamp: new Date(),
          toolResult: { success: false, error: 'Error' },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
        success: true, // Override
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('should calculate duration', () => {
      const startTime = new Date('2024-01-01T12:00:00.000Z');

      const result = createHeadlessResult([], {
        model: 'grok-3',
        startTime,
        workingDirectory: '/test',
      });

      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should not duplicate file paths', () => {
      const entries = [
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCall: {
            id: 'tool_1',
            function: {
              name: 'str_replace_editor',
              arguments: '{"path":"/test/file.ts"}',
            },
          },
        },
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCall: {
            id: 'tool_2',
            function: {
              name: 'str_replace_editor',
              arguments: '{"path":"/test/file.ts"}',
            },
          },
        },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.summary.filesModified.filter(f => f === '/test/file.ts')).toHaveLength(1);
    });
  });

  describe('formatOutput', () => {
    it('should format as JSON', () => {
      const output = formatOutput(sampleResult, 'json');

      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should format as stream JSON', () => {
      const output = formatOutput(sampleResult, 'stream-json');

      const lines = output.split('\n');
      expect(lines.length).toBe(3);
      lines.forEach(line => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('should format as text', () => {
      const output = formatOutput(sampleResult, 'text');

      expect(output).toContain('> Hello, can you help me?');
      expect(output).toContain('Success: true');
    });

    it('should format as markdown', () => {
      const output = formatOutput(sampleResult, 'markdown');

      expect(output).toContain('# Grok CLI Result');
      expect(output).toContain('## Summary');
    });

    it('should default to JSON for unknown format', () => {
      const output = formatOutput(sampleResult, 'unknown' as OutputFormat);

      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty messages array', () => {
      const emptyResult: HeadlessResult = {
        ...sampleResult,
        messages: [],
      };

      expect(() => formatAsJson(emptyResult)).not.toThrow();
      expect(() => formatAsText(emptyResult)).not.toThrow();
      expect(() => formatAsMarkdown(emptyResult)).not.toThrow();
    });

    it('should handle messages without tool calls', () => {
      const simpleResult: HeadlessResult = {
        ...sampleResult,
        messages: [
          { role: 'user', content: 'Hello', timestamp: '2024-01-01T12:00:00.000Z' },
          { role: 'assistant', content: 'Hi!', timestamp: '2024-01-01T12:00:01.000Z' },
        ],
      };

      const text = formatAsText(simpleResult);
      const md = formatAsMarkdown(simpleResult);

      expect(text).toContain('> Hello');
      expect(md).toContain('### User');
    });

    it('should handle special characters in content', () => {
      const specialResult: HeadlessResult = {
        ...sampleResult,
        messages: [
          {
            role: 'user',
            content: 'Code: `const x = 1;` and "quotes"',
            timestamp: '2024-01-01T12:00:00.000Z',
          },
        ],
      };

      const json = formatAsJson(specialResult);
      const text = formatAsText(specialResult);
      const md = formatAsMarkdown(specialResult);

      expect(() => JSON.parse(json)).not.toThrow();
      expect(text).toContain('const x = 1');
      expect(md).toContain('const x = 1');
    });

    it('should handle empty summary arrays', () => {
      const emptySummaryResult: HeadlessResult = {
        ...sampleResult,
        summary: {
          totalMessages: 0,
          toolCalls: 0,
          successfulTools: 0,
          failedTools: 0,
          filesModified: [],
          filesCreated: [],
          commandsExecuted: [],
          errors: [],
        },
      };

      const text = formatAsText(emptySummaryResult);
      const md = formatAsMarkdown(emptySummaryResult);

      // Should not include empty sections
      expect(text).not.toContain('Files modified:');
      expect(md).not.toContain('### Files Modified');
    });
  });
});
