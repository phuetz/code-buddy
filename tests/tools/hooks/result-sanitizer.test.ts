/**
 * Result Sanitizer Tests
 */

import {
  ResultSanitizer,
  createSanitizer,
  sanitizeResult,
  sanitizeToolUseResultPairing,
  PROVIDER_POLICIES,
  type ToolResultInput,
} from '../../../src/tools/hooks/index.js';

describe('ResultSanitizer', () => {
  describe('basic sanitization', () => {
    it('should pass through valid result', () => {
      const sanitizer = createSanitizer('openai');

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        success: true,
        output: 'Hello world',
      };

      const result = sanitizer.sanitize(input);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello world');
      expect(result.sanitization.truncated).toBe(false);
    });

    it('should truncate large output', () => {
      const sanitizer = createSanitizer('mistral', { maxResultSize: 100 });

      const longOutput = 'x'.repeat(200);
      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        success: true,
        output: longOutput,
      };

      const result = sanitizer.sanitize(input);

      expect(result.sanitization.truncated).toBe(true);
      expect(result.output!.length).toBeLessThanOrEqual(100);
      expect(result.output).toContain('[Output truncated...]');
    });

    it('should strip ANSI codes', () => {
      const sanitizer = createSanitizer('openai');

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        success: true,
        output: '\x1B[31mRed text\x1B[0m',
      };

      const result = sanitizer.sanitize(input);

      expect(result.output).toBe('Red text');
      expect(result.sanitization.appliedSanitizers).toContain('stripAnsi');
    });

    it('should strip control characters', () => {
      const sanitizer = createSanitizer('openai');

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        success: true,
        output: 'Hello\x00World\x07!',
      };

      const result = sanitizer.sanitize(input);

      expect(result.output).toBe('HelloWorld!');
      expect(result.sanitization.appliedSanitizers).toContain('stripControlChars');
    });

    it('should preserve newlines and tabs', () => {
      const sanitizer = createSanitizer('openai');

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        success: true,
        output: 'Line1\nLine2\tTabbed',
      };

      const result = sanitizer.sanitize(input);

      expect(result.output).toBe('Line1\nLine2\tTabbed');
    });
  });

  describe('provider-specific policies', () => {
    it('should sanitize tool call ID for Mistral', () => {
      const sanitizer = createSanitizer('mistral');

      const input: ToolResultInput = {
        toolCallId: 'call-with-dashes-123',
        toolName: 'test_tool',
        success: true,
        output: 'test',
      };

      const result = sanitizer.sanitize(input);

      expect(result.toolCallId).toMatch(/^[a-zA-Z0-9]{9}$/);
      expect(result.sanitization.toolCallIdModified).toBe(true);
    });

    it('should have correct max sizes per provider', () => {
      expect(PROVIDER_POLICIES.openai.maxResultSize).toBe(100_000);
      expect(PROVIDER_POLICIES.mistral.maxResultSize).toBe(50_000);
      expect(PROVIDER_POLICIES.anthropic.maxImageDimension).toBe(1568);
      expect(PROVIDER_POLICIES.gemini.maxImageDimension).toBe(3072);
    });

    it('should apply custom sanitizers', () => {
      const sanitizer = createSanitizer('openai', {
        customSanitizers: [
          (content) => content.replace(/secret/gi, '[REDACTED]'),
        ],
      });

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        success: true,
        output: 'The secret password is SECRET123',
      };

      const result = sanitizer.sanitize(input);

      expect(result.output).toBe('The [REDACTED] password is [REDACTED]123');
    });
  });

  describe('error sanitization', () => {
    it('should truncate long error messages', () => {
      const sanitizer = createSanitizer('openai');

      const longError = 'Error: ' + 'x'.repeat(10000);
      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        success: false,
        error: longError,
      };

      const result = sanitizer.sanitize(input);

      expect(result.error!.length).toBeLessThanOrEqual(5000);
      expect(result.sanitization.truncated).toBe(true);
    });
  });

  describe('image sanitization', () => {
    it('should detect PNG format', () => {
      const sanitizer = createSanitizer('openai');

      // PNG magic bytes in base64
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'screenshot',
        success: true,
        imageData: pngBase64,
      };

      const result = sanitizer.sanitize(input);

      expect(result.imageFormat).toBe('png');
    });

    it('should detect JPEG format', () => {
      const sanitizer = createSanitizer('openai');

      // JPEG magic bytes in base64
      const jpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAA==';

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'screenshot',
        success: true,
        imageData: jpegBase64,
      };

      const result = sanitizer.sanitize(input);

      expect(result.imageFormat).toBe('jpeg');
    });
  });

  describe('size calculation', () => {
    it('should calculate size correctly', () => {
      const sanitizer = createSanitizer('openai');

      const input: ToolResultInput = {
        toolCallId: 'call_123',
        toolName: 'test',
        success: true,
        output: 'x'.repeat(1000),
      };

      const result = sanitizer.sanitize(input);

      expect(result.sanitization.originalSize).toBeGreaterThan(1000);
      expect(result.sanitization.finalSize).toBeGreaterThan(1000);
    });
  });

  describe('sanitizeResult helper', () => {
    it('should sanitize with provider', () => {
      const result = sanitizeResult('openai', {
        toolCallId: 'call_123',
        toolName: 'test',
        success: true,
        output: '\x1B[31mColored\x1B[0m',
      });

      expect(result.output).toBe('Colored');
    });
  });
});

describe('sanitizeToolUseResultPairing', () => {
  it('should validate matching pairs', () => {
    const toolUses = [
      { id: 'call_1', name: 'tool_a', arguments: {} },
      { id: 'call_2', name: 'tool_b', arguments: {} },
    ];

    const toolResults = [
      { toolCallId: 'call_1', content: 'result 1' },
      { toolCallId: 'call_2', content: 'result 2' },
    ];

    const result = sanitizeToolUseResultPairing(toolUses, toolResults);

    expect(result.valid).toBe(true);
    expect(result.orphanedResults).toHaveLength(0);
    expect(result.missingResults).toHaveLength(0);
  });

  it('should detect orphaned results', () => {
    const toolUses = [
      { id: 'call_1', name: 'tool_a', arguments: {} },
    ];

    const toolResults = [
      { toolCallId: 'call_1', content: 'result 1' },
      { toolCallId: 'call_unknown', content: 'orphan' },
    ];

    const result = sanitizeToolUseResultPairing(toolUses, toolResults);

    expect(result.valid).toBe(false);
    expect(result.orphanedResults).toContain('call_unknown');
    expect(result.cleanedResults).toHaveLength(1);
  });

  it('should synthesize missing results', () => {
    const toolUses = [
      { id: 'call_1', name: 'tool_a', arguments: {} },
      { id: 'call_2', name: 'tool_b', arguments: {} },
    ];

    const toolResults = [
      { toolCallId: 'call_1', content: 'result 1' },
    ];

    const result = sanitizeToolUseResultPairing(toolUses, toolResults);

    expect(result.valid).toBe(false);
    expect(result.missingResults).toContain('call_2');
    expect(result.synthesizedResults).toHaveLength(1);
    expect(result.synthesizedResults[0].content).toContain('tool_b');
    expect(result.cleanedResults).toHaveLength(2);
  });

  it('should handle empty arrays', () => {
    const result = sanitizeToolUseResultPairing([], []);

    expect(result.valid).toBe(true);
    expect(result.cleanedResults).toHaveLength(0);
  });
});
