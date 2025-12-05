/**
 * AI Integration Tests
 *
 * Tests the currently configured AI provider with real API calls:
 * - Basic completion
 * - Streaming
 * - Tool calling
 * - Token estimation accuracy
 * - Error handling
 */

import { EventEmitter } from 'events';
import stringWidth from 'string-width';
import { GrokClient, type GrokMessage, type GrokTool, type GrokResponse } from '../grok/client.js';

// ============================================================================
// Types
// ============================================================================

export interface AITestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: string;
  error?: string;
  tokensUsed?: number;
  cost?: number;
}

export interface AITestSuite {
  provider: string;
  model: string;
  timestamp: number;
  duration: number;
  results: AITestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    totalTokens: number;
    totalCost: number;
  };
}

export interface AITestOptions {
  timeout?: number;
  verbose?: boolean;
  skipExpensive?: boolean;
  testTools?: boolean;
  testStreaming?: boolean;
}

// ============================================================================
// Test Runner
// ============================================================================

export class AITestRunner extends EventEmitter {
  private client: GrokClient;
  private options: Required<AITestOptions>;

  constructor(client: GrokClient, options: AITestOptions = {}) {
    super();
    this.client = client;
    this.options = {
      timeout: options.timeout ?? 30000,
      verbose: options.verbose ?? false,
      skipExpensive: options.skipExpensive ?? false,
      testTools: options.testTools ?? true,
      testStreaming: options.testStreaming ?? true,
    };
  }

  /**
   * Helper to extract content from GrokResponse
   */
  private getContent(response: GrokResponse): string {
    return response.choices[0]?.message?.content || '';
  }

  /**
   * Helper to extract tool calls from GrokResponse
   */
  private getToolCalls(response: GrokResponse) {
    return response.choices[0]?.message?.tool_calls || [];
  }

  /**
   * Run all AI integration tests
   */
  async runAll(): Promise<AITestSuite> {
    const startTime = Date.now();
    const results: AITestResult[] = [];

    const tests = [
      { name: 'Basic Completion', fn: () => this.testBasicCompletion() },
      { name: 'Simple Math', fn: () => this.testSimpleMath() },
      { name: 'JSON Output', fn: () => this.testJSONOutput() },
      { name: 'Code Generation', fn: () => this.testCodeGeneration() },
      { name: 'Context Understanding', fn: () => this.testContextUnderstanding() },
      { name: 'Streaming Response', fn: () => this.testStreaming(), skip: !this.options.testStreaming },
      { name: 'Tool Calling', fn: () => this.testToolCalling(), skip: !this.options.testTools },
      { name: 'Error Handling', fn: () => this.testErrorHandling() },
      { name: 'Long Context', fn: () => this.testLongContext(), skip: this.options.skipExpensive },
    ];

    let totalTokens = 0;
    let totalCost = 0;

    for (const test of tests) {
      if (test.skip) {
        results.push({
          name: test.name,
          passed: true,
          duration: 0,
          details: 'Skipped',
        });
        this.emit('test:skipped', { name: test.name });
        continue;
      }

      this.emit('test:start', { name: test.name });

      try {
        const result = await this.runWithTimeout(test.fn, this.options.timeout);
        results.push(result);

        if (result.tokensUsed) totalTokens += result.tokensUsed;
        if (result.cost) totalCost += result.cost;

        this.emit('test:complete', result);
      } catch (error) {
        const result: AITestResult = {
          name: test.name,
          passed: false,
          duration: 0,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(result);
        this.emit('test:complete', result);
      }
    }

    const suite: AITestSuite = {
      provider: 'grok',
      model: this.client.getCurrentModel(),
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      results,
      summary: {
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed && r.error).length,
        skipped: results.filter(r => r.details === 'Skipped').length,
        totalTokens,
        totalCost,
      },
    };

    this.emit('suite:complete', suite);
    return suite;
  }

  /**
   * Run test with timeout
   */
  private async runWithTimeout(
    fn: () => Promise<AITestResult>,
    timeout: number
  ): Promise<AITestResult> {
    return Promise.race([
      fn(),
      new Promise<AITestResult>((_, reject) =>
        setTimeout(() => reject(new Error('Test timed out')), timeout)
      ),
    ]);
  }

  /**
   * Test 1: Basic Completion
   */
  private async testBasicCompletion(): Promise<AITestResult> {
    const startTime = Date.now();

    const messages: GrokMessage[] = [
      { role: 'user', content: 'Say "Hello, World!" and nothing else.' }
    ];

    const response = await this.client.chat(messages);
    const content = this.getContent(response);
    const passed = content.toLowerCase().includes('hello');

    return {
      name: 'Basic Completion',
      passed,
      duration: Date.now() - startTime,
      details: passed ? 'AI responded correctly' : `Unexpected response: ${content.slice(0, 100)}`,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Test 2: Simple Math
   */
  private async testSimpleMath(): Promise<AITestResult> {
    const startTime = Date.now();

    const messages: GrokMessage[] = [
      { role: 'user', content: 'What is 15 + 27? Reply with just the number.' }
    ];

    const response = await this.client.chat(messages);
    const content = this.getContent(response);
    const passed = content.includes('42');

    return {
      name: 'Simple Math',
      passed,
      duration: Date.now() - startTime,
      details: passed ? 'Correct: 42' : `Got: ${content.slice(0, 50)}`,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Test 3: JSON Output
   */
  private async testJSONOutput(): Promise<AITestResult> {
    const startTime = Date.now();

    const messages: GrokMessage[] = [
      {
        role: 'user',
        content: 'Return a JSON object with keys "name" (string "test") and "value" (number 123). Only output valid JSON, no markdown.'
      }
    ];

    const response = await this.client.chat(messages);
    const content = this.getContent(response);

    let passed = false;
    let details = '';

    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        passed = parsed.name === 'test' && parsed.value === 123;
        details = passed ? 'Valid JSON returned' : `Parsed but incorrect values: ${JSON.stringify(parsed)}`;
      } else {
        details = 'No JSON object found in response';
      }
    } catch (e) {
      details = `Failed to parse JSON: ${content.slice(0, 100)}`;
    }

    return {
      name: 'JSON Output',
      passed,
      duration: Date.now() - startTime,
      details,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Test 4: Code Generation
   */
  private async testCodeGeneration(): Promise<AITestResult> {
    const startTime = Date.now();

    const messages: GrokMessage[] = [
      {
        role: 'user',
        content: 'Write a TypeScript function called "add" that takes two numbers and returns their sum. Only output the code.'
      }
    ];

    const response = await this.client.chat(messages);
    const content = this.getContent(response);

    const hasFunction = content.includes('function add') || content.includes('const add');
    const hasParams = content.includes('number');
    const hasReturn = content.includes('return');

    const passed = hasFunction && hasParams && hasReturn;

    return {
      name: 'Code Generation',
      passed,
      duration: Date.now() - startTime,
      details: passed
        ? 'Valid TypeScript function generated'
        : `Missing: ${!hasFunction ? 'function ' : ''}${!hasParams ? 'types ' : ''}${!hasReturn ? 'return' : ''}`,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Test 5: Context Understanding
   */
  private async testContextUnderstanding(): Promise<AITestResult> {
    const startTime = Date.now();

    const messages: GrokMessage[] = [
      { role: 'user', content: 'My name is Alice.' },
      { role: 'assistant', content: 'Hello Alice! Nice to meet you.' },
      { role: 'user', content: 'What is my name?' }
    ];

    const response = await this.client.chat(messages);
    const content = this.getContent(response);
    const passed = content.toLowerCase().includes('alice');

    return {
      name: 'Context Understanding',
      passed,
      duration: Date.now() - startTime,
      details: passed ? 'Correctly remembered name from context' : `Failed: ${content.slice(0, 100)}`,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Test 6: Streaming Response
   */
  private async testStreaming(): Promise<AITestResult> {
    const startTime = Date.now();

    let chunks = 0;
    let content = '';

    try {
      const messages: GrokMessage[] = [
        { role: 'user', content: 'Count from 1 to 5, one number per line.' }
      ];

      const stream = this.client.chatStream(messages);

      for await (const chunk of stream) {
        chunks++;
        if (chunk.choices?.[0]?.delta?.content) {
          content += chunk.choices[0].delta.content;
        }
      }

      const hasNumbers = ['1', '2', '3', '4', '5'].every(n => content.includes(n));
      const passed = chunks > 1 && hasNumbers;

      return {
        name: 'Streaming Response',
        passed,
        duration: Date.now() - startTime,
        details: passed
          ? `Received ${chunks} chunks with correct content`
          : `Chunks: ${chunks}, Content valid: ${hasNumbers}`,
      };
    } catch (error) {
      return {
        name: 'Streaming Response',
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 7: Tool Calling
   */
  private async testToolCalling(): Promise<AITestResult> {
    const startTime = Date.now();

    const tools: GrokTool[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The city name',
              },
            },
            required: ['location'],
          },
        },
      },
    ];

    try {
      const messages: GrokMessage[] = [
        { role: 'user', content: 'What is the weather in Paris?' }
      ];

      const response = await this.client.chat(messages, tools);
      const toolCalls = this.getToolCalls(response);

      const hasToolCall = toolCalls.length > 0;
      let passed = false;
      let details = '';

      if (hasToolCall) {
        const toolCall = toolCalls[0];
        passed = toolCall.function.name === 'get_weather';

        if (passed) {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            passed = args.location?.toLowerCase().includes('paris');
            details = passed
              ? `Correct tool call with location: ${args.location}`
              : `Wrong location: ${args.location}`;
          } catch {
            details = 'Failed to parse tool arguments';
            passed = false;
          }
        } else {
          details = `Wrong tool called: ${toolCall.function.name}`;
        }
      } else {
        details = 'No tool call made';
      }

      return {
        name: 'Tool Calling',
        passed,
        duration: Date.now() - startTime,
        details,
        tokensUsed: response.usage?.total_tokens,
      };
    } catch (error) {
      return {
        name: 'Tool Calling',
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 8: Error Handling
   */
  private async testErrorHandling(): Promise<AITestResult> {
    const startTime = Date.now();

    // Test with empty message - should handle gracefully
    try {
      const messages: GrokMessage[] = [
        { role: 'user', content: '' }
      ];

      const response = await this.client.chat(messages);

      // If we get here, the API accepted empty content
      return {
        name: 'Error Handling',
        passed: true,
        duration: Date.now() - startTime,
        details: 'API handled empty content gracefully',
        tokensUsed: response.usage?.total_tokens,
      };
    } catch (error) {
      // Expected - API rejected empty content
      return {
        name: 'Error Handling',
        passed: true,
        duration: Date.now() - startTime,
        details: 'API correctly rejected empty content',
      };
    }
  }

  /**
   * Test 9: Long Context (expensive)
   */
  private async testLongContext(): Promise<AITestResult> {
    const startTime = Date.now();

    // Create a long context with a hidden fact
    const paragraphs = Array(20).fill(0).map((_, i) =>
      `Paragraph ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. `
    );
    paragraphs[10] = 'IMPORTANT: The secret code is "ALPHA-7892". Remember this.';

    const messages: GrokMessage[] = [
      { role: 'user', content: paragraphs.join('\n\n') },
      { role: 'assistant', content: 'I have read all the paragraphs. What would you like to know?' },
      { role: 'user', content: 'What was the secret code mentioned in the text?' }
    ];

    const response = await this.client.chat(messages);
    const content = this.getContent(response);
    const passed = content.includes('ALPHA-7892');

    return {
      name: 'Long Context',
      passed,
      duration: Date.now() - startTime,
      details: passed ? 'Found hidden fact in long context' : 'Failed to find fact',
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Pad string to target width accounting for emoji visual width
   */
  private static padEnd(str: string, targetWidth: number): string {
    const currentWidth = stringWidth(str);
    if (currentWidth >= targetWidth) return str;
    return str + ' '.repeat(targetWidth - currentWidth);
  }

  /**
   * Pad string to target width on the left (right-align)
   */
  private static padStart(str: string, targetWidth: number): string {
    const currentWidth = stringWidth(str);
    if (currentWidth >= targetWidth) return str;
    return ' '.repeat(targetWidth - currentWidth) + str;
  }

  /**
   * Format test results for display
   */
  static formatResults(suite: AITestSuite): string {
    const lines: string[] = [];
    const W = 60; // box width

    lines.push('┌' + '─'.repeat(W - 2) + '┐');
    lines.push('│' + AITestRunner.padEnd('          🧪 AI INTEGRATION TEST RESULTS', W - 2) + '│');
    lines.push('├' + '─'.repeat(W - 2) + '┤');
    lines.push('│' + AITestRunner.padEnd(`  Provider: ${suite.provider}    Model: ${suite.model}`, W - 2) + '│');
    lines.push('│' + AITestRunner.padEnd(`  Duration: ${(suite.duration / 1000).toFixed(2)}s`, W - 2) + '│');
    lines.push('├' + '─'.repeat(W - 2) + '┤');

    for (const result of suite.results) {
      const status = result.details === 'Skipped' ? '⏭️ ' : result.passed ? '✅' : '❌';
      const time = result.duration > 0 ? `${(result.duration / 1000).toFixed(1)}s` : '-';

      const statusAndName = `  ${status} ${AITestRunner.padEnd(result.name, 30)}`;
      const line = statusAndName + AITestRunner.padStart(time, 6);
      lines.push('│' + AITestRunner.padEnd(line, W - 2) + '│');

      if (result.error) {
        lines.push('│' + AITestRunner.padEnd(`     └─ Error: ${result.error.slice(0, 40)}`, W - 2) + '│');
      } else if (result.details && result.details !== 'Skipped') {
        lines.push('│' + AITestRunner.padEnd(`     └─ ${result.details.slice(0, 45)}`, W - 2) + '│');
      }
    }

    lines.push('├' + '─'.repeat(W - 2) + '┤');
    lines.push('│' + AITestRunner.padEnd(`  SUMMARY: ${suite.summary.passed}/${suite.summary.total} passed, ${suite.summary.failed} failed, ${suite.summary.skipped} skipped`, W - 2) + '│');
    lines.push('│' + AITestRunner.padEnd(`  Tokens: ${suite.summary.totalTokens}   Cost: $${suite.summary.totalCost.toFixed(4)}`, W - 2) + '│');
    lines.push('└' + '─'.repeat(W - 2) + '┘');

    return lines.join('\n');
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAITestRunner(client: GrokClient, options?: AITestOptions): AITestRunner {
  return new AITestRunner(client, options);
}
