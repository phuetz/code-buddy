/**
 * Comprehensive Unit Tests for Formatters Module
 *
 * Tests cover:
 * 1. Code Formatting (code-formatter.ts)
 *    - Language detection
 *    - JavaScript/TypeScript formatting
 *    - Python formatting
 *    - JSON formatting
 *    - YAML formatting
 *    - SQL formatting
 *    - HTML formatting
 *    - CSS formatting
 *    - Markdown formatting
 *    - Format options
 *
 * 2. Error Formatting (error-formatter.ts)
 *    - Error context creation
 *    - Error formatting for terminal
 *    - Error formatting as JSON
 *    - Error templates
 *    - Warning/Success/Info formatting
 *
 * 3. Output Formatting (headless-output.ts)
 *    - JSON output
 *    - Text output
 *    - Markdown output
 */

import {
  detectLanguage,
  formatCode,
  checkFormatters,
  Language,
} from '../../src/tools/code-formatter';

import {
  formatError,
  formatErrorJson,
  createErrorContext,
  formatWarning,
  formatSuccess,
  formatInfo,
  ERROR_TEMPLATES,
  ErrorContext,
} from '../../src/utils/error-formatter';

import { EXIT_CODES } from '../../src/utils/exit-codes';

import {
  formatAsJson,
  formatAsText,
  formatAsMarkdown,
  formatAsStreamJson,
  formatOutput,
  createHeadlessResult,
  HeadlessResult,
  HeadlessMessage,
} from '../../src/utils/headless-output';

// Mock child_process to avoid external dependencies
jest.mock('child_process', () => ({
  execSync: jest.fn(() => {
    throw new Error('External formatter not available');
  }),
}));

// Mock fs-extra for formatFile tests
jest.mock('fs-extra', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

describe('Code Formatter', () => {
  describe('detectLanguage', () => {
    it('should detect TypeScript files', () => {
      expect(detectLanguage('/path/to/file.ts')).toBe('typescript');
      expect(detectLanguage('/path/to/file.tsx')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      expect(detectLanguage('/path/to/file.js')).toBe('javascript');
      expect(detectLanguage('/path/to/file.jsx')).toBe('javascript');
      expect(detectLanguage('/path/to/file.mjs')).toBe('javascript');
      expect(detectLanguage('/path/to/file.cjs')).toBe('javascript');
    });

    it('should detect Python files', () => {
      expect(detectLanguage('/path/to/file.py')).toBe('python');
    });

    it('should detect JSON files', () => {
      expect(detectLanguage('/path/to/file.json')).toBe('json');
    });

    it('should detect YAML files', () => {
      expect(detectLanguage('/path/to/file.yaml')).toBe('yaml');
      expect(detectLanguage('/path/to/file.yml')).toBe('yaml');
    });

    it('should detect SQL files', () => {
      expect(detectLanguage('/path/to/file.sql')).toBe('sql');
    });

    it('should detect HTML files', () => {
      expect(detectLanguage('/path/to/file.html')).toBe('html');
      expect(detectLanguage('/path/to/file.htm')).toBe('html');
    });

    it('should detect CSS files', () => {
      expect(detectLanguage('/path/to/file.css')).toBe('css');
      expect(detectLanguage('/path/to/file.scss')).toBe('css');
    });

    it('should detect Markdown files', () => {
      expect(detectLanguage('/path/to/file.md')).toBe('markdown');
    });

    it('should return null for unknown extensions', () => {
      expect(detectLanguage('/path/to/file.xyz')).toBeNull();
      expect(detectLanguage('/path/to/file')).toBeNull();
    });

    it('should handle case insensitive extensions', () => {
      expect(detectLanguage('/path/to/file.TS')).toBe('typescript');
      expect(detectLanguage('/path/to/file.JSON')).toBe('json');
    });
  });

  describe('formatCode - JavaScript/TypeScript', () => {
    it('should format basic JavaScript code', () => {
      const code = 'function test(){return 1;}';
      const result = formatCode(code, 'javascript');

      expect(result.success).toBe(true);
      expect(result.language).toBe('javascript');
      expect(result.formatter).toBe('built-in');
      expect(result.formatted).toBeDefined();
    });

    it('should format TypeScript code', () => {
      const code = 'interface User{name:string;age:number;}';
      const result = formatCode(code, 'typescript');

      expect(result.success).toBe(true);
      expect(result.language).toBe('typescript');
    });

    it('should handle empty lines', () => {
      const code = 'const a = 1;\n\nconst b = 2;';
      const result = formatCode(code, 'javascript');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('\n');
    });

    it('should handle proper indentation for braces', () => {
      const code = 'if(true){\nconsole.log("test");\n}';
      const result = formatCode(code, 'javascript');

      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
    });

    it('should respect indentSize option', () => {
      const code = 'function test(){\nreturn 1;\n}';
      const result = formatCode(code, 'javascript', { indentSize: 4 });

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('    '); // 4 spaces
    });

    it('should respect useTabs option', () => {
      const code = 'function test(){\nreturn 1;\n}';
      const result = formatCode(code, 'javascript', { useTabs: true });

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('\t');
    });
  });

  describe('formatCode - Python', () => {
    it('should format basic Python code', () => {
      const code = 'def hello():\nprint("Hello")';
      const result = formatCode(code, 'python');

      expect(result.success).toBe(true);
      expect(result.language).toBe('python');
      expect(result.formatter).toBe('built-in');
    });

    it('should handle Python indentation after colons', () => {
      const code = 'if True:\nprint("yes")\nelse:\nprint("no")';
      const result = formatCode(code, 'python');

      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
    });

    it('should handle elif/else/except dedentation', () => {
      const code = 'if True:\npass\nelif False:\npass\nelse:\npass';
      const result = formatCode(code, 'python');

      expect(result.success).toBe(true);
    });

    it('should use default indentation for Python', () => {
      const code = 'def test():\nreturn 1';
      const result = formatCode(code, 'python');

      expect(result.success).toBe(true);
      // Default is 2 spaces (from DEFAULT_OPTIONS)
      expect(result.formatted).toContain('  return');
    });

    it('should use 4-space indentation when specified', () => {
      const code = 'def test():\nreturn 1';
      const result = formatCode(code, 'python', { indentSize: 4 });

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('    return');
    });
  });

  describe('formatCode - JSON', () => {
    it('should format valid JSON', () => {
      const code = '{"name":"test","value":123}';
      const result = formatCode(code, 'json');

      expect(result.success).toBe(true);
      expect(result.language).toBe('json');
      expect(result.formatter).toBe('built-in');
    });

    it('should pretty print JSON with indentation', () => {
      const code = '{"a":1,"b":2}';
      const result = formatCode(code, 'json');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('\n');
    });

    it('should fail for invalid JSON', () => {
      const code = '{invalid json}';
      const result = formatCode(code, 'json');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should respect indentSize option', () => {
      const code = '{"a":1}';
      const result = formatCode(code, 'json', { indentSize: 4 });

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('    '); // 4 spaces
    });

    it('should respect useTabs option for JSON', () => {
      const code = '{"a":1}';
      const result = formatCode(code, 'json', { useTabs: true });

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('\t');
    });

    it('should handle nested JSON objects', () => {
      const code = '{"outer":{"inner":{"deep":"value"}}}';
      const result = formatCode(code, 'json');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('inner');
      expect(result.formatted).toContain('deep');
    });

    it('should handle JSON arrays', () => {
      const code = '[1,2,3,{"a":"b"}]';
      const result = formatCode(code, 'json');

      expect(result.success).toBe(true);
    });
  });

  describe('formatCode - YAML', () => {
    it('should format basic YAML', () => {
      const code = 'name: test\nvalue: 123';
      const result = formatCode(code, 'yaml');

      expect(result.success).toBe(true);
      expect(result.language).toBe('yaml');
      expect(result.formatter).toBe('built-in');
    });

    it('should preserve YAML structure', () => {
      const code = 'parent:\n  child: value';
      const result = formatCode(code, 'yaml');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('parent:');
      expect(result.formatted).toContain('child:');
    });

    it('should normalize indentation', () => {
      const code = 'root:\n   child: value';
      const result = formatCode(code, 'yaml', { indentSize: 2 });

      expect(result.success).toBe(true);
    });
  });

  describe('formatCode - SQL', () => {
    it('should format basic SQL', () => {
      const code = 'SELECT * FROM users WHERE id = 1';
      const result = formatCode(code, 'sql');

      expect(result.success).toBe(true);
      expect(result.language).toBe('sql');
      expect(result.formatter).toBe('built-in');
    });

    it('should add newlines after keywords', () => {
      const code = 'SELECT name FROM users WHERE active = 1 ORDER BY name';
      const result = formatCode(code, 'sql');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('\n');
    });

    it('should handle JOIN statements', () => {
      const code = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id';
      const result = formatCode(code, 'sql');

      expect(result.success).toBe(true);
      expect(result.formatted?.toUpperCase()).toContain('JOIN');
    });

    it('should handle INSERT statements', () => {
      const code = 'INSERT INTO users VALUES (1, "test")';
      const result = formatCode(code, 'sql');

      expect(result.success).toBe(true);
    });

    it('should handle UPDATE statements', () => {
      const code = 'UPDATE users SET name = "new" WHERE id = 1';
      const result = formatCode(code, 'sql');

      expect(result.success).toBe(true);
    });
  });

  describe('formatCode - HTML', () => {
    it('should format basic HTML', () => {
      const code = '<div><p>Hello</p></div>';
      const result = formatCode(code, 'html');

      expect(result.success).toBe(true);
      expect(result.language).toBe('html');
      expect(result.formatter).toBe('built-in');
    });

    it('should add indentation for nested tags', () => {
      const code = '<div><span>text</span></div>';
      const result = formatCode(code, 'html');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('\n');
    });

    it('should handle self-closing tags', () => {
      const code = '<div><img src="test.jpg"/><br/></div>';
      const result = formatCode(code, 'html');

      expect(result.success).toBe(true);
    });

    it('should handle void elements', () => {
      const code = '<div><input type="text"><meta charset="utf-8"></div>';
      const result = formatCode(code, 'html');

      expect(result.success).toBe(true);
    });
  });

  describe('formatCode - CSS', () => {
    it('should format basic CSS', () => {
      const code = '.class{color:red;margin:0;}';
      const result = formatCode(code, 'css');

      expect(result.success).toBe(true);
      expect(result.language).toBe('css');
      expect(result.formatter).toBe('built-in');
    });

    it('should add newlines after braces and semicolons', () => {
      const code = '.a{color:red;}.b{color:blue;}';
      const result = formatCode(code, 'css');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('\n');
    });

    it('should indent properties within rules', () => {
      const code = '.class{color:red;}';
      const result = formatCode(code, 'css');

      expect(result.success).toBe(true);
    });
  });

  describe('formatCode - Markdown', () => {
    it('should format basic Markdown', () => {
      const code = '#Header\n\nParagraph';
      const result = formatCode(code, 'markdown');

      expect(result.success).toBe(true);
      expect(result.language).toBe('markdown');
      expect(result.formatter).toBe('built-in');
    });

    it('should normalize line endings', () => {
      const code = 'Line 1\r\nLine 2\r\n';
      const result = formatCode(code, 'markdown');

      expect(result.success).toBe(true);
      expect(result.formatted).not.toContain('\r');
    });

    it('should add space after headers', () => {
      const code = '#Header';
      const result = formatCode(code, 'markdown');

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('# Header');
    });

    it('should ensure single blank line between paragraphs', () => {
      const code = 'Para 1\n\n\n\nPara 2';
      const result = formatCode(code, 'markdown');

      expect(result.success).toBe(true);
      expect(result.formatted).not.toContain('\n\n\n');
    });

    it('should add trailing newline', () => {
      const code = 'Content';
      const result = formatCode(code, 'markdown');

      expect(result.success).toBe(true);
      expect(result.formatted?.endsWith('\n')).toBe(true);
    });
  });

  describe('formatCode - Error Handling', () => {
    it('should return error for unsupported language', () => {
      const code = 'some code';
      const result = formatCode(code, 'unsupported' as Language);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported language');
      expect(result.formatter).toBe('none');
    });
  });

  describe('formatCode - Default Options', () => {
    it('should use default options when not specified', () => {
      const code = '{"a":1}';
      const result = formatCode(code, 'json');

      expect(result.success).toBe(true);
      // Default indent is 2 spaces
      expect(result.formatted).toContain('  ');
    });

    it('should merge custom options with defaults', () => {
      const code = '{"a":1}';
      const result = formatCode(code, 'json', { indentSize: 4 });

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('    ');
    });
  });

  describe('checkFormatters', () => {
    it('should return object with formatter availability', () => {
      const available = checkFormatters();

      expect(typeof available).toBe('object');
      expect('prettier' in available).toBe(true);
      expect('black' in available).toBe(true);
      expect('eslint' in available).toBe(true);
    });

    it('should indicate formatters are not available when mocked', () => {
      const available = checkFormatters();

      // Since we mocked execSync to throw, all should be false
      expect(available.prettier).toBe(false);
      expect(available.black).toBe(false);
      expect(available.eslint).toBe(false);
    });
  });
});

describe('Error Formatter', () => {
  describe('ERROR_TEMPLATES', () => {
    it('should have all required templates', () => {
      expect(ERROR_TEMPLATES.API_KEY_MISSING).toBeDefined();
      expect(ERROR_TEMPLATES.API_KEY_INVALID).toBeDefined();
      expect(ERROR_TEMPLATES.RATE_LIMITED).toBeDefined();
      expect(ERROR_TEMPLATES.NETWORK_ERROR).toBeDefined();
      expect(ERROR_TEMPLATES.TIMEOUT).toBeDefined();
      expect(ERROR_TEMPLATES.FILE_NOT_FOUND).toBeDefined();
      expect(ERROR_TEMPLATES.PERMISSION_DENIED).toBeDefined();
      expect(ERROR_TEMPLATES.COST_LIMIT).toBeDefined();
    });

    it('should have code, message, and exitCode for each template', () => {
      const templates = Object.values(ERROR_TEMPLATES);

      templates.forEach(template => {
        expect(template.code).toBeDefined();
        expect(template.message).toBeDefined();
        expect(template.exitCode).toBeDefined();
      });
    });

    it('should have suggestions for common errors', () => {
      expect(ERROR_TEMPLATES.API_KEY_MISSING.suggestion).toBeDefined();
      expect(ERROR_TEMPLATES.RATE_LIMITED.suggestion).toBeDefined();
      expect(ERROR_TEMPLATES.FILE_NOT_FOUND.suggestion).toBeDefined();
    });

    it('should have documentation URLs for key errors', () => {
      expect(ERROR_TEMPLATES.API_KEY_MISSING.docUrl).toBeDefined();
      expect(ERROR_TEMPLATES.COST_LIMIT.docUrl).toBeDefined();
    });
  });

  describe('formatError', () => {
    it('should format error with message', () => {
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Test error message',
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Error: Test error message');
    });

    it('should include details when provided', () => {
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Error',
        details: 'Additional details here',
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Details: Additional details here');
    });

    it('should include suggestion when provided', () => {
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Error',
        suggestion: 'Try this fix',
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Suggestion: Try this fix');
    });

    it('should include documentation URL when provided', () => {
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Error',
        docUrl: 'https://example.com/docs',
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Documentation: https://example.com/docs');
    });

    it('should include cause when provided', () => {
      const cause = new Error('Original error');
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Error',
        cause,
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Cause: Original error');
    });

    it('should include exit code description when provided', () => {
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Error',
        exitCode: EXIT_CODES.AUTHENTICATION_ERROR,
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Exit Code: 4');
    });

    it('should include error code in footer', () => {
      const ctx: ErrorContext = {
        code: 'CUSTOM_CODE',
        message: 'Error',
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Error Code: CUSTOM_CODE');
    });

    it('should include version in footer', () => {
      const ctx: ErrorContext = {
        code: 'TEST',
        message: 'Error',
      };

      const formatted = formatError(ctx);

      expect(formatted).toContain('Version:');
    });
  });

  describe('formatErrorJson', () => {
    it('should return valid JSON', () => {
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Test error',
      };

      const json = formatErrorJson(ctx);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include all context fields', () => {
      const ctx: ErrorContext = {
        code: 'TEST_ERROR',
        message: 'Test error',
        details: 'Details',
        suggestion: 'Suggestion',
        docUrl: 'https://example.com',
        exitCode: EXIT_CODES.GENERAL_ERROR,
      };

      const json = formatErrorJson(ctx);
      const parsed = JSON.parse(json);

      expect(parsed.error.code).toBe('TEST_ERROR');
      expect(parsed.error.message).toBe('Test error');
      expect(parsed.error.details).toBe('Details');
      expect(parsed.error.suggestion).toBe('Suggestion');
      expect(parsed.error.documentation).toBe('https://example.com');
      expect(parsed.error.exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
    });

    it('should include timestamp', () => {
      const ctx: ErrorContext = {
        code: 'TEST',
        message: 'Error',
      };

      const json = formatErrorJson(ctx);
      const parsed = JSON.parse(json);

      expect(parsed.error.timestamp).toBeDefined();
      expect(() => new Date(parsed.error.timestamp)).not.toThrow();
    });

    it('should include cause message', () => {
      const cause = new Error('Cause message');
      const ctx: ErrorContext = {
        code: 'TEST',
        message: 'Error',
        cause,
      };

      const json = formatErrorJson(ctx);
      const parsed = JSON.parse(json);

      expect(parsed.error.cause).toBe('Cause message');
    });

    it('should be pretty printed with 2-space indent', () => {
      const ctx: ErrorContext = {
        code: 'TEST',
        message: 'Error',
      };

      const json = formatErrorJson(ctx);

      expect(json).toContain('\n  ');
    });
  });

  describe('createErrorContext', () => {
    it('should create context from Error with template', () => {
      const error = new Error('Some error');
      const ctx = createErrorContext(error, 'API_KEY_MISSING');

      expect(ctx.code).toBe('API_KEY_MISSING');
      expect(ctx.message).toBe('API key is not configured');
      expect(ctx.details).toBe('Some error');
      expect(ctx.cause).toBe(error);
    });

    it('should auto-detect API key missing errors', () => {
      const error = new Error('API key is missing from config');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('API_KEY_MISSING');
    });

    it('should auto-detect unauthorized errors', () => {
      const error = new Error('Request failed with status 401 unauthorized');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('API_KEY_INVALID');
    });

    it('should auto-detect rate limit errors', () => {
      const error = new Error('Rate limit exceeded, 429 Too Many Requests');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('RATE_LIMITED');
    });

    it('should auto-detect timeout errors', () => {
      const error = new Error('Request timeout after 30 seconds');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('TIMEOUT');
    });

    it('should auto-detect file not found errors', () => {
      const error = new Error('ENOENT: no such file or directory');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('FILE_NOT_FOUND');
    });

    it('should auto-detect permission errors', () => {
      const error = new Error('EACCES: permission denied');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('PERMISSION_DENIED');
    });

    it('should auto-detect network errors', () => {
      const error = new Error('ECONNREFUSED: Connection refused');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('NETWORK_ERROR');
    });

    it('should auto-detect cost limit errors', () => {
      const error = new Error('Session cost limit exceeded');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('COST_LIMIT');
    });

    it('should return generic context for unknown errors', () => {
      const error = new Error('Unknown strange error');
      const ctx = createErrorContext(error);

      expect(ctx.code).toBe('UNKNOWN_ERROR');
      expect(ctx.exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
    });
  });

  describe('formatWarning', () => {
    it('should format warning message', () => {
      const formatted = formatWarning('This is a warning');

      expect(formatted).toContain('Warning: This is a warning');
    });

    it('should include suggestion when provided', () => {
      const formatted = formatWarning('Warning message', 'Try this');

      expect(formatted).toContain('Try this');
    });
  });

  describe('formatSuccess', () => {
    it('should format success message', () => {
      const formatted = formatSuccess('Operation completed');

      expect(formatted).toContain('Operation completed');
    });

    it('should include details when provided', () => {
      const formatted = formatSuccess('Done', ['Detail 1', 'Detail 2']);

      expect(formatted).toContain('Detail 1');
      expect(formatted).toContain('Detail 2');
    });

    it('should use bullet points for details', () => {
      const formatted = formatSuccess('Done', ['Item 1']);

      expect(formatted).toMatch(/[*\-\u2022]/); // bullet or dash
    });
  });

  describe('formatInfo', () => {
    it('should format info message', () => {
      const formatted = formatInfo('Information message');

      expect(formatted).toContain('Information message');
    });
  });
});

describe('Output Formatter (Headless)', () => {
  const sampleMessages: HeadlessMessage[] = [
    {
      role: 'user',
      content: 'Test message',
      timestamp: '2024-01-01T12:00:00.000Z',
    },
    {
      role: 'assistant',
      content: 'Response',
      timestamp: '2024-01-01T12:00:01.000Z',
    },
  ];

  const sampleResult: HeadlessResult = {
    success: true,
    exitCode: 0,
    messages: sampleMessages,
    summary: {
      totalMessages: 2,
      toolCalls: 0,
      successfulTools: 0,
      failedTools: 0,
      filesModified: [],
      filesCreated: [],
      commandsExecuted: [],
      errors: [],
    },
    metadata: {
      model: 'grok-3',
      startTime: '2024-01-01T12:00:00.000Z',
      endTime: '2024-01-01T12:00:05.000Z',
      durationMs: 5000,
      workingDirectory: '/test',
    },
  };

  describe('formatAsJson', () => {
    it('should produce valid JSON', () => {
      const json = formatAsJson(sampleResult);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include all result fields', () => {
      const json = formatAsJson(sampleResult);
      const parsed = JSON.parse(json);

      expect(parsed.success).toBe(true);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.summary).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });
  });

  describe('formatAsStreamJson', () => {
    it('should return array of JSON strings', () => {
      const lines = formatAsStreamJson(sampleMessages);

      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBe(2);
    });

    it('should produce valid JSON for each line', () => {
      const lines = formatAsStreamJson(sampleMessages);

      lines.forEach(line => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });
  });

  describe('formatAsText', () => {
    it('should format messages as text', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('> Test message');
      expect(text).toContain('Response');
    });

    it('should include summary section', () => {
      const text = formatAsText(sampleResult);

      expect(text).toContain('Success: true');
      expect(text).toContain('Duration: 5000ms');
    });
  });

  describe('formatAsMarkdown', () => {
    it('should include header', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('# Grok CLI Result');
    });

    it('should include conversation section', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('## Conversation');
      expect(md).toContain('### User');
      expect(md).toContain('### Assistant');
    });

    it('should include summary table', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('## Summary');
      expect(md).toContain('| Metric | Value |');
    });

    it('should include metadata section', () => {
      const md = formatAsMarkdown(sampleResult);

      expect(md).toContain('## Metadata');
      expect(md).toContain('**Model**: grok-3');
    });
  });

  describe('formatOutput', () => {
    it('should route to correct formatter', () => {
      const json = formatOutput(sampleResult, 'json');
      const text = formatOutput(sampleResult, 'text');
      const md = formatOutput(sampleResult, 'markdown');

      expect(() => JSON.parse(json)).not.toThrow();
      expect(text).toContain('> Test message');
      expect(md).toContain('# Grok CLI Result');
    });

    it('should handle stream-json format', () => {
      const streamJson = formatOutput(sampleResult, 'stream-json');
      const lines = streamJson.split('\n');

      expect(lines.length).toBe(2);
      lines.forEach(line => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });
  });

  describe('createHeadlessResult', () => {
    it('should create result from chat entries', () => {
      const entries = [
        { type: 'user', content: 'Hello', timestamp: new Date() },
        { type: 'assistant', content: 'Hi', timestamp: new Date() },
      ];

      const result = createHeadlessResult(entries, {
        model: 'grok-3',
        startTime: new Date(),
        workingDirectory: '/test',
      });

      expect(result.messages).toHaveLength(2);
      expect(result.summary.totalMessages).toBe(2);
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
    });

    it('should determine success based on errors', () => {
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
          toolResult: { success: false, error: 'Failed' },
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
      expect(failResult.success).toBe(false);
    });
  });
});

describe('Integration - Formatter Combinations', () => {
  it('should format code and then format error if it fails', () => {
    const invalidJson = '{invalid}';
    const codeResult = formatCode(invalidJson, 'json');

    expect(codeResult.success).toBe(false);

    // Create error context from the failure
    const error = new Error(codeResult.error || 'Unknown error');
    const errorCtx = createErrorContext(error);

    const formattedError = formatError(errorCtx);
    expect(formattedError).toContain('Error:');
  });

  it('should format multiple languages in sequence', () => {
    const languages: Array<{ code: string; lang: Language }> = [
      { code: '{"a":1}', lang: 'json' },
      { code: 'const x = 1;', lang: 'javascript' },
      { code: 'def foo(): pass', lang: 'python' },
      { code: '<div>test</div>', lang: 'html' },
    ];

    languages.forEach(({ code, lang }) => {
      const result = formatCode(code, lang);
      expect(result.success).toBe(true);
      expect(result.language).toBe(lang);
    });
  });

  it('should format headless result with tool errors into readable output', () => {
    const result: HeadlessResult = {
      success: false,
      exitCode: 1,
      messages: [
        {
          role: 'tool',
          content: '',
          timestamp: new Date().toISOString(),
          toolCall: { id: '1', name: 'bash', arguments: { command: 'invalid' } },
          toolResult: { success: false, error: 'Command not found' },
        },
      ],
      summary: {
        totalMessages: 1,
        toolCalls: 1,
        successfulTools: 0,
        failedTools: 1,
        filesModified: [],
        filesCreated: [],
        commandsExecuted: ['invalid'],
        errors: ['Command not found'],
      },
      metadata: {
        model: 'grok-3',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 100,
        workingDirectory: '/test',
      },
    };

    const text = formatAsText(result);
    const json = formatAsJson(result);
    const md = formatAsMarkdown(result);

    expect(text).toContain('Error: Command not found');
    expect(json).toContain('"failedTools": 1');
    expect(md).toContain('### Errors');
  });
});
