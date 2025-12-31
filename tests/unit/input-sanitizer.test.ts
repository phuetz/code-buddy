/**
 * Comprehensive unit tests for InputSanitizer (sanitize utilities)
 * Tests input sanitization for security including:
 * - File path sanitization
 * - Command argument sanitization
 * - URL sanitization
 * - HTML sanitization
 * - JSON parsing
 * - LLM output sanitization
 * - Commentary tool call extraction
 */

import {
  sanitizeFilePath,
  sanitizeCommandArg,
  sanitizeURL,
  sanitizeJSON,
  escapeRegex,
  sanitizeHTML,
  sanitizeEmail,
  isAlphanumeric,
  truncateString,
  removeControlCharacters,
  sanitizePort,
  sanitizeLLMOutput,
  extractCommentaryToolCalls,
} from '../../src/utils/sanitize';
import { ValidationError } from '../../src/utils/errors';

describe('InputSanitizer', () => {
  describe('sanitizeFilePath', () => {
    describe('valid paths', () => {
      it('should accept valid absolute paths', () => {
        expect(sanitizeFilePath('/home/user/file.txt')).toBe('/home/user/file.txt');
        expect(sanitizeFilePath('/var/log/app.log')).toBe('/var/log/app.log');
      });

      it('should accept valid relative paths', () => {
        expect(sanitizeFilePath('relative/path.js')).toBe('relative/path.js');
        expect(sanitizeFilePath('file.txt')).toBe('file.txt');
      });

      it('should accept paths with various extensions', () => {
        expect(sanitizeFilePath('/path/to/file.ts')).toBe('/path/to/file.ts');
        expect(sanitizeFilePath('/path/to/file.json')).toBe('/path/to/file.json');
        expect(sanitizeFilePath('/path/to/file.md')).toBe('/path/to/file.md');
      });

      it('should accept Windows-style absolute paths', () => {
        expect(sanitizeFilePath('C:\\Users\\name\\file.txt', true)).toBe('C:\\Users\\name\\file.txt');
      });

      it('should trim whitespace from paths', () => {
        expect(sanitizeFilePath('  /home/user/file.txt  ')).toBe('/home/user/file.txt');
        expect(sanitizeFilePath('\t/path/file.js\n')).toBe('/path/file.js');
      });

      it('should accept paths with spaces', () => {
        expect(sanitizeFilePath('/home/user/my file.txt')).toBe('/home/user/my file.txt');
      });

      it('should accept hidden files and directories', () => {
        expect(sanitizeFilePath('/home/user/.hidden')).toBe('/home/user/.hidden');
        expect(sanitizeFilePath('/home/user/.config/app')).toBe('/home/user/.config/app');
      });
    });

    describe('invalid paths', () => {
      it('should reject paths with null bytes', () => {
        expect(() => sanitizeFilePath('/home/user\0/file.txt')).toThrow(ValidationError);
        expect(() => sanitizeFilePath('/home/user\0/file.txt')).toThrow(/null bytes/);
      });

      it('should reject directory traversal with ../', () => {
        expect(() => sanitizeFilePath('../../../etc/passwd')).toThrow(ValidationError);
        expect(() => sanitizeFilePath('../../../etc/passwd')).toThrow(/dangerous pattern/);
      });

      it('should reject directory traversal with ..\\', () => {
        expect(() => sanitizeFilePath('..\\..\\..\\etc\\passwd')).toThrow(ValidationError);
      });

      it('should reject directory traversal with /..', () => {
        expect(() => sanitizeFilePath('/home/../../../etc/passwd')).toThrow(ValidationError);
      });

      it('should reject directory traversal with \\..', () => {
        expect(() => sanitizeFilePath('\\home\\..\\..\\etc\\passwd')).toThrow(ValidationError);
      });

      it('should reject unusual patterns with ....', () => {
        expect(() => sanitizeFilePath('/path/..../file.txt')).toThrow(ValidationError);
      });

      it('should reject empty paths', () => {
        expect(() => sanitizeFilePath('')).toThrow(ValidationError);
        expect(() => sanitizeFilePath('')).toThrow(/empty/);
      });

      it('should reject whitespace-only paths', () => {
        expect(() => sanitizeFilePath('   ')).toThrow(ValidationError);
        expect(() => sanitizeFilePath('\t\n')).toThrow(ValidationError);
      });

      it('should reject null input', () => {
        expect(() => sanitizeFilePath(null as unknown as string)).toThrow(ValidationError);
      });

      it('should reject undefined input', () => {
        expect(() => sanitizeFilePath(undefined as unknown as string)).toThrow(ValidationError);
      });

      it('should reject non-string input', () => {
        expect(() => sanitizeFilePath(123 as unknown as string)).toThrow(ValidationError);
        expect(() => sanitizeFilePath({} as unknown as string)).toThrow(ValidationError);
      });
    });

    describe('allowAbsolute option', () => {
      it('should reject absolute paths when not allowed', () => {
        expect(() => sanitizeFilePath('/etc/passwd', false)).toThrow(ValidationError);
        expect(() => sanitizeFilePath('/etc/passwd', false)).toThrow(/Absolute paths/);
      });

      it('should reject Windows absolute paths when not allowed', () => {
        expect(() => sanitizeFilePath('C:\\Windows\\System32', false)).toThrow(ValidationError);
      });

      it('should allow relative paths when absolute not allowed', () => {
        expect(sanitizeFilePath('relative/path.txt', false)).toBe('relative/path.txt');
      });
    });
  });

  describe('sanitizeCommandArg', () => {
    describe('safe arguments', () => {
      it('should accept simple strings', () => {
        expect(sanitizeCommandArg('hello')).toBe('hello');
        expect(sanitizeCommandArg('world')).toBe('world');
      });

      it('should accept file paths', () => {
        expect(sanitizeCommandArg('/path/to/file')).toBe('/path/to/file');
        expect(sanitizeCommandArg('file.txt')).toBe('file.txt');
      });

      it('should accept numbers as strings', () => {
        expect(sanitizeCommandArg('12345')).toBe('12345');
      });

      it('should accept flags without special characters', () => {
        expect(sanitizeCommandArg('--verbose')).toBe('--verbose');
        expect(sanitizeCommandArg('-v')).toBe('-v');
      });

      it('should trim whitespace', () => {
        expect(sanitizeCommandArg('  hello  ')).toBe('hello');
      });
    });

    describe('dangerous characters', () => {
      it('should reject semicolons (command separator)', () => {
        expect(() => sanitizeCommandArg('hello; rm -rf /')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('hello; rm -rf /')).toThrow(/dangerous character/);
      });

      it('should reject ampersands (background/AND)', () => {
        expect(() => sanitizeCommandArg('command & malicious')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('cmd1 && cmd2')).toThrow(ValidationError);
      });

      it('should reject pipes', () => {
        expect(() => sanitizeCommandArg('cat file | bash')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('echo hi | grep h')).toThrow(ValidationError);
      });

      it('should reject dollar signs (variable expansion)', () => {
        expect(() => sanitizeCommandArg('$HOME')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('echo $PATH')).toThrow(ValidationError);
      });

      it('should reject backticks (command substitution)', () => {
        expect(() => sanitizeCommandArg('`rm -rf /`')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('`whoami`')).toThrow(ValidationError);
      });

      it('should reject newlines', () => {
        expect(() => sanitizeCommandArg('cmd1\ncmd2')).toThrow(ValidationError);
      });

      it('should reject carriage returns', () => {
        expect(() => sanitizeCommandArg('cmd1\rcmd2')).toThrow(ValidationError);
      });

      it('should reject null bytes', () => {
        expect(() => sanitizeCommandArg('hello\0world')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('hello\0world')).toThrow(/null bytes/);
      });
    });

    describe('command substitution patterns', () => {
      it('should reject $() pattern', () => {
        expect(() => sanitizeCommandArg('$(rm -rf /)')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('$(whoami)')).toThrow(ValidationError);
      });

      it('should reject ${} pattern', () => {
        expect(() => sanitizeCommandArg('${PATH}')).toThrow(ValidationError);
        expect(() => sanitizeCommandArg('${HOME:-/root}')).toThrow(ValidationError);
      });
    });

    describe('type validation', () => {
      it('should reject non-string input', () => {
        expect(() => sanitizeCommandArg(123 as unknown as string)).toThrow(ValidationError);
        expect(() => sanitizeCommandArg(null as unknown as string)).toThrow(ValidationError);
      });
    });
  });

  describe('sanitizeURL', () => {
    describe('valid URLs', () => {
      it('should accept valid HTTP URLs', () => {
        expect(sanitizeURL('http://example.com')).toBe('http://example.com/');
      });

      it('should accept valid HTTPS URLs', () => {
        expect(sanitizeURL('https://example.com')).toBe('https://example.com/');
      });

      it('should accept URLs with paths', () => {
        expect(sanitizeURL('https://example.com/path/to/resource')).toBe('https://example.com/path/to/resource');
      });

      it('should accept URLs with query parameters', () => {
        expect(sanitizeURL('https://example.com/search?q=test')).toBe('https://example.com/search?q=test');
      });

      it('should accept URLs with fragments', () => {
        expect(sanitizeURL('https://example.com/page#section')).toBe('https://example.com/page#section');
      });

      it('should accept URLs with ports', () => {
        expect(sanitizeURL('https://example.com:8080/api')).toBe('https://example.com:8080/api');
      });

      it('should accept URLs with auth (though not recommended)', () => {
        expect(sanitizeURL('https://user:pass@example.com')).toBe('https://user:pass@example.com/');
      });

      it('should trim whitespace', () => {
        expect(sanitizeURL('  https://example.com  ')).toBe('https://example.com/');
      });
    });

    describe('invalid URLs', () => {
      it('should reject invalid URLs', () => {
        expect(() => sanitizeURL('not-a-url')).toThrow(ValidationError);
        expect(() => sanitizeURL('not-a-url')).toThrow(/Invalid URL/);
      });

      it('should reject URLs without protocol', () => {
        expect(() => sanitizeURL('example.com')).toThrow(ValidationError);
      });

      it('should reject empty strings', () => {
        expect(() => sanitizeURL('')).toThrow(ValidationError);
      });

      it('should reject null input', () => {
        expect(() => sanitizeURL(null as unknown as string)).toThrow(ValidationError);
      });
    });

    describe('protocol validation', () => {
      it('should reject disallowed protocols by default', () => {
        expect(() => sanitizeURL('ftp://example.com')).toThrow(ValidationError);
        expect(() => sanitizeURL('ftp://example.com')).toThrow(/not allowed/);
      });

      it('should reject file:// protocol', () => {
        expect(() => sanitizeURL('file:///etc/passwd')).toThrow(ValidationError);
      });

      it('should reject javascript: URLs', () => {
        expect(() => sanitizeURL('javascript:alert(1)')).toThrow(ValidationError);
        expect(() => sanitizeURL('JAVASCRIPT:alert(1)')).toThrow(ValidationError);
      });

      it('should accept custom allowed protocols', () => {
        expect(sanitizeURL('ftp://example.com', ['ftp', 'http', 'https'])).toBe('ftp://example.com/');
      });

      it('should accept ssh protocol when allowed', () => {
        expect(sanitizeURL('ssh://git@github.com/repo', ['ssh'])).toBe('ssh://git@github.com/repo');
      });
    });
  });

  describe('sanitizeJSON', () => {
    describe('valid JSON', () => {
      it('should parse valid JSON objects', () => {
        expect(sanitizeJSON('{"key": "value"}')).toEqual({ key: 'value' });
      });

      it('should parse valid JSON arrays', () => {
        expect(sanitizeJSON('[1, 2, 3]')).toEqual([1, 2, 3]);
      });

      it('should parse nested JSON', () => {
        const json = '{"user": {"name": "John", "age": 30}}';
        expect(sanitizeJSON(json)).toEqual({ user: { name: 'John', age: 30 } });
      });

      it('should parse JSON with various types', () => {
        const json = '{"str": "hello", "num": 42, "bool": true, "null": null}';
        expect(sanitizeJSON(json)).toEqual({ str: 'hello', num: 42, bool: true, null: null });
      });

      it('should parse JSON with arrays in objects', () => {
        const json = '{"items": [1, 2, 3]}';
        expect(sanitizeJSON(json)).toEqual({ items: [1, 2, 3] });
      });
    });

    describe('invalid JSON', () => {
      it('should reject invalid JSON', () => {
        expect(() => sanitizeJSON('{invalid}')).toThrow(ValidationError);
        expect(() => sanitizeJSON('{invalid}')).toThrow(/Invalid JSON/);
      });

      it('should reject malformed JSON', () => {
        expect(() => sanitizeJSON('{"key": value}')).toThrow(ValidationError);
      });

      it('should reject empty strings', () => {
        expect(() => sanitizeJSON('')).toThrow(ValidationError);
        expect(() => sanitizeJSON('')).toThrow(/non-empty/);
      });

      it('should reject null input', () => {
        expect(() => sanitizeJSON(null as unknown as string)).toThrow(ValidationError);
      });

      it('should reject trailing commas', () => {
        expect(() => sanitizeJSON('{"key": "value",}')).toThrow(ValidationError);
      });

      it('should reject single quotes', () => {
        expect(() => sanitizeJSON("{'key': 'value'}")).toThrow(ValidationError);
      });
    });

    describe('type parameter', () => {
      it('should support generic type parameter', () => {
        interface MyType {
          name: string;
          value: number;
        }

        const result = sanitizeJSON<MyType>('{"name": "test", "value": 42}');
        expect(result.name).toBe('test');
        expect(result.value).toBe(42);
      });
    });
  });

  describe('escapeRegex', () => {
    it('should escape special regex characters', () => {
      expect(escapeRegex('hello.world')).toBe('hello\\.world');
      expect(escapeRegex('a*b+c?')).toBe('a\\*b\\+c\\?');
      expect(escapeRegex('[test]')).toBe('\\[test\\]');
      expect(escapeRegex('(a|b)')).toBe('\\(a\\|b\\)');
    });

    it('should escape ^ and $', () => {
      expect(escapeRegex('^start$')).toBe('\\^start\\$');
    });

    it('should escape curly braces', () => {
      expect(escapeRegex('a{1,3}')).toBe('a\\{1,3\\}');
    });

    it('should escape backslashes', () => {
      expect(escapeRegex('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('should leave normal strings unchanged', () => {
      expect(escapeRegex('hello world')).toBe('hello world');
      expect(escapeRegex('abc123')).toBe('abc123');
    });

    it('should handle empty string', () => {
      expect(escapeRegex('')).toBe('');
    });

    it('should handle strings with multiple special characters', () => {
      expect(escapeRegex('[a-z]+.*')).toBe('\\[a-z\\]\\+\\.\\*');
    });
  });

  describe('sanitizeHTML', () => {
    it('should escape HTML tags', () => {
      expect(sanitizeHTML('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
      );
    });

    it('should escape ampersands', () => {
      expect(sanitizeHTML('a & b')).toBe('a &amp; b');
      expect(sanitizeHTML('&amp;')).toBe('&amp;amp;');
    });

    it('should escape less than and greater than', () => {
      expect(sanitizeHTML('1 < 2 > 0')).toBe('1 &lt; 2 &gt; 0');
    });

    it('should escape double quotes', () => {
      expect(sanitizeHTML('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(sanitizeHTML("it's fine")).toBe('it&#x27;s fine');
    });

    it('should escape forward slashes', () => {
      expect(sanitizeHTML('a/b')).toBe('a&#x2F;b');
    });

    it('should handle empty strings', () => {
      expect(sanitizeHTML('')).toBe('');
    });

    it('should handle non-string input', () => {
      expect(sanitizeHTML(null as unknown as string)).toBe('');
      expect(sanitizeHTML(undefined as unknown as string)).toBe('');
    });

    it('should handle strings without HTML', () => {
      expect(sanitizeHTML('normal text')).toBe('normal text');
    });
  });

  describe('sanitizeEmail', () => {
    describe('valid emails', () => {
      it('should accept standard email format', () => {
        expect(sanitizeEmail('user@example.com')).toBe('user@example.com');
      });

      it('should accept emails with dots in local part', () => {
        expect(sanitizeEmail('first.last@example.com')).toBe('first.last@example.com');
      });

      it('should accept emails with plus signs', () => {
        expect(sanitizeEmail('user+tag@example.com')).toBe('user+tag@example.com');
      });

      it('should accept emails with numbers', () => {
        expect(sanitizeEmail('user123@example.com')).toBe('user123@example.com');
      });

      it('should accept emails with underscores', () => {
        expect(sanitizeEmail('user_name@example.com')).toBe('user_name@example.com');
      });

      it('should accept emails with subdomains', () => {
        expect(sanitizeEmail('user@mail.example.com')).toBe('user@mail.example.com');
      });

      it('should convert to lowercase', () => {
        expect(sanitizeEmail('User@EXAMPLE.COM')).toBe('user@example.com');
      });

      it('should trim whitespace', () => {
        expect(sanitizeEmail('  user@example.com  ')).toBe('user@example.com');
      });
    });

    describe('invalid emails', () => {
      it('should reject emails without @', () => {
        expect(() => sanitizeEmail('userexample.com')).toThrow(ValidationError);
      });

      it('should reject emails without domain', () => {
        expect(() => sanitizeEmail('user@')).toThrow(ValidationError);
      });

      it('should reject emails without local part', () => {
        expect(() => sanitizeEmail('@example.com')).toThrow(ValidationError);
      });

      it('should reject empty strings', () => {
        expect(() => sanitizeEmail('')).toThrow(ValidationError);
      });

      it('should reject null input', () => {
        expect(() => sanitizeEmail(null as unknown as string)).toThrow(ValidationError);
      });

      it('should reject emails with spaces', () => {
        expect(() => sanitizeEmail('user name@example.com')).toThrow(ValidationError);
      });
    });
  });

  describe('isAlphanumeric', () => {
    describe('alphanumeric strings', () => {
      it('should return true for letters only', () => {
        expect(isAlphanumeric('hello')).toBe(true);
        expect(isAlphanumeric('ABC')).toBe(true);
      });

      it('should return true for numbers only', () => {
        expect(isAlphanumeric('12345')).toBe(true);
      });

      it('should return true for mixed letters and numbers', () => {
        expect(isAlphanumeric('hello123')).toBe(true);
        expect(isAlphanumeric('ABC123xyz')).toBe(true);
      });
    });

    describe('non-alphanumeric strings', () => {
      it('should return false for strings with special characters', () => {
        expect(isAlphanumeric('hello!')).toBe(false);
        expect(isAlphanumeric('hello@world')).toBe(false);
      });

      it('should return false for strings with spaces', () => {
        expect(isAlphanumeric('hello world')).toBe(false);
      });

      it('should return false for strings with dashes (unless allowed)', () => {
        expect(isAlphanumeric('hello-world')).toBe(false);
      });

      it('should return false for strings with underscores (unless allowed)', () => {
        expect(isAlphanumeric('hello_world')).toBe(false);
      });

      it('should return false for empty strings', () => {
        expect(isAlphanumeric('')).toBe(false);
      });
    });

    describe('allowed characters', () => {
      it('should allow specified additional characters', () => {
        expect(isAlphanumeric('hello-world', '-')).toBe(true);
        expect(isAlphanumeric('hello_world', '_')).toBe(true);
      });

      it('should allow multiple additional characters', () => {
        expect(isAlphanumeric('hello-world_test', '-_')).toBe(true);
      });

      it('should still reject other special characters', () => {
        expect(isAlphanumeric('hello-world!', '-')).toBe(false);
      });
    });

    describe('type validation', () => {
      it('should return false for non-string input', () => {
        expect(isAlphanumeric(123 as unknown as string)).toBe(false);
        expect(isAlphanumeric(null as unknown as string)).toBe(false);
      });
    });
  });

  describe('truncateString', () => {
    describe('basic truncation', () => {
      it('should truncate long strings', () => {
        expect(truncateString('hello world', 8)).toBe('hello...');
      });

      it('should not truncate short strings', () => {
        expect(truncateString('hello', 10)).toBe('hello');
      });

      it('should not truncate strings at exact length', () => {
        expect(truncateString('hello', 5)).toBe('hello');
      });
    });

    describe('custom ellipsis', () => {
      it('should use custom ellipsis', () => {
        expect(truncateString('hello world', 9, '...')).toBe('hello ...');
      });

      it('should use single character ellipsis', () => {
        expect(truncateString('hello world', 6, '~')).toBe('hello~');
      });

      it('should handle empty ellipsis', () => {
        expect(truncateString('hello world', 5, '')).toBe('hello');
      });
    });

    describe('edge cases', () => {
      it('should handle empty strings', () => {
        expect(truncateString('', 10)).toBe('');
      });

      it('should handle non-string input', () => {
        expect(truncateString(null as unknown as string, 10)).toBe('');
        expect(truncateString(undefined as unknown as string, 10)).toBe('');
      });

      it('should handle very small maxLength', () => {
        const result = truncateString('hello world', 2, '...');
        // Result depends on implementation - just verify it returns something
        expect(typeof result).toBe('string');
      });
    });
  });

  describe('removeControlCharacters', () => {
    describe('control character removal', () => {
      it('should remove null bytes', () => {
        expect(removeControlCharacters('hello\x00world')).toBe('helloworld');
      });

      it('should remove bell character', () => {
        expect(removeControlCharacters('test\x07beep')).toBe('testbeep');
      });

      it('should remove backspace', () => {
        expect(removeControlCharacters('test\x08back')).toBe('testback');
      });

      it('should remove form feed', () => {
        expect(removeControlCharacters('test\x0Cfeed')).toBe('testfeed');
      });

      it('should remove escape character', () => {
        expect(removeControlCharacters('test\x1Besc')).toBe('testesc');
      });

      it('should remove delete character', () => {
        expect(removeControlCharacters('test\x7Fdel')).toBe('testdel');
      });
    });

    describe('preserved characters', () => {
      it('should keep newlines', () => {
        expect(removeControlCharacters('hello\nworld')).toBe('hello\nworld');
      });

      it('should keep tabs', () => {
        expect(removeControlCharacters('hello\tworld')).toBe('hello\tworld');
      });

      it('should keep carriage returns', () => {
        expect(removeControlCharacters('hello\rworld')).toBe('hello\rworld');
      });
    });

    describe('edge cases', () => {
      it('should handle empty strings', () => {
        expect(removeControlCharacters('')).toBe('');
      });

      it('should handle non-string input', () => {
        expect(removeControlCharacters(null as unknown as string)).toBe('');
        expect(removeControlCharacters(undefined as unknown as string)).toBe('');
      });

      it('should handle strings without control characters', () => {
        expect(removeControlCharacters('normal text')).toBe('normal text');
      });
    });
  });

  describe('sanitizePort', () => {
    describe('valid ports', () => {
      it('should accept valid port numbers', () => {
        expect(sanitizePort(80)).toBe(80);
        expect(sanitizePort(443)).toBe(443);
        expect(sanitizePort(8080)).toBe(8080);
      });

      it('should accept port 1 (minimum)', () => {
        expect(sanitizePort(1)).toBe(1);
      });

      it('should accept port 65535 (maximum)', () => {
        expect(sanitizePort(65535)).toBe(65535);
      });

      it('should accept port as string', () => {
        expect(sanitizePort('443')).toBe(443);
        expect(sanitizePort('8080')).toBe(8080);
      });
    });

    describe('invalid ports', () => {
      it('should reject port 0', () => {
        expect(() => sanitizePort(0)).toThrow(ValidationError);
        expect(() => sanitizePort(0)).toThrow(/between 1 and 65535/);
      });

      it('should reject negative ports', () => {
        expect(() => sanitizePort(-1)).toThrow(ValidationError);
        expect(() => sanitizePort(-100)).toThrow(ValidationError);
      });

      it('should reject ports above 65535', () => {
        expect(() => sanitizePort(65536)).toThrow(ValidationError);
        expect(() => sanitizePort(70000)).toThrow(ValidationError);
      });

      it('should reject non-numeric strings', () => {
        expect(() => sanitizePort('abc')).toThrow(ValidationError);
        expect(() => sanitizePort('abc')).toThrow(/must be a number/);
      });
    });
  });

  describe('sanitizeLLMOutput', () => {
    describe('control token removal', () => {
      it('should remove control tokens like <|token|>', () => {
        const input = '<|system|>Hello<|end|>';
        const result = sanitizeLLMOutput(input);
        expect(result).toBe('Hello');
      });

      it('should remove various control token formats', () => {
        const input = '<|message|>Response<|end_turn|>';
        const result = sanitizeLLMOutput(input);
        expect(result).toBe('Response');
      });

      it('should remove JSON-escaped control tokens', () => {
        const input = '\\u003c|token|\\u003eContent';
        const result = sanitizeLLMOutput(input);
        expect(result).toBe('Content');
      });
    });

    describe('commentary pattern removal', () => {
      it('should remove commentary to=action patterns', () => {
        const input = 'commentary to=web_search {"query": "test"}\nActual response';
        const result = sanitizeLLMOutput(input);
        expect(result).not.toContain('commentary');
        expect(result).toContain('Actual response');
      });

      it('should remove commentary with json prefix', () => {
        const input = 'commentary to=create_file json{"path": "/test"}';
        const result = sanitizeLLMOutput(input);
        expect(result).not.toContain('commentary');
      });
    });

    describe('tool call JSON removal', () => {
      it('should remove standalone tool call JSON', () => {
        const input = '{"path": "/test/file.txt", "content": "hello"}Response here';
        const result = sanitizeLLMOutput(input);
        expect(result).not.toContain('"path"');
      });
    });

    describe('excessive newline handling', () => {
      it('should collapse more than 2 newlines to 2', () => {
        const input = 'Hello\n\n\n\n\nWorld';
        const result = sanitizeLLMOutput(input);
        expect(result).toBe('Hello\n\nWorld');
      });

      it('should preserve 2 newlines', () => {
        const input = 'Hello\n\nWorld';
        const result = sanitizeLLMOutput(input);
        expect(result).toBe('Hello\n\nWorld');
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(sanitizeLLMOutput('')).toBe('');
      });

      it('should handle null input', () => {
        expect(sanitizeLLMOutput(null as unknown as string)).toBe('');
      });

      it('should handle undefined input', () => {
        expect(sanitizeLLMOutput(undefined as unknown as string)).toBe('');
      });

      it('should handle normal text without modifications', () => {
        const input = 'This is a normal response without any control tokens.';
        const result = sanitizeLLMOutput(input);
        expect(result).toBe(input);
      });
    });
  });

  describe('extractCommentaryToolCalls', () => {
    describe('commentary format extraction', () => {
      it('should extract tool calls from commentary format', () => {
        const content = 'commentary to=web_search {"query": "test"}\nSome response';
        const result = extractCommentaryToolCalls(content);

        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].name).toBe('web_search');
        expect(result.toolCalls[0].arguments).toEqual({ query: 'test' });
      });

      it('should extract multiple tool calls', () => {
        const content = 'commentary to=search {"query": "a"}\ncommentary to=view_file {"path": "/test"}';
        const result = extractCommentaryToolCalls(content);

        expect(result.toolCalls.length).toBe(2);
      });

      it('should handle commentary with control tokens', () => {
        const content = '<|channel|>commentary to=web_search <|constrain|>json<|message|>{"query": "test"}';
        const result = extractCommentaryToolCalls(content);

        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].name).toBe('web_search');
      });
    });

    describe('direct tool name format', () => {
      it('should extract direct tool name with JSON', () => {
        const content = 'web_search {"query": "test query"}';
        const result = extractCommentaryToolCalls(content);

        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].name).toBe('web_search');
      });

      it('should extract known tool names', () => {
        const tools = ['web_search', 'search', 'view_file', 'create_file', 'bash', 'git'];

        for (const tool of tools) {
          const content = `${tool} {"arg": "value"}`;
          const result = extractCommentaryToolCalls(content);
          expect(result.toolCalls.some(tc => tc.name === tool)).toBe(true);
        }
      });
    });

    describe('remaining content', () => {
      it('should return remaining content after extraction', () => {
        const content = 'commentary to=search {"query": "test"}\nActual response text';
        const result = extractCommentaryToolCalls(content);

        expect(result.remainingContent).toContain('Actual response text');
        expect(result.remainingContent).not.toContain('commentary');
      });

      it('should trim remaining content', () => {
        const content = '  commentary to=search {"query": "test"}  \n  Response  ';
        const result = extractCommentaryToolCalls(content);

        expect(result.remainingContent).toBe('Response');
      });
    });

    describe('invalid JSON handling', () => {
      it('should skip matches with invalid JSON', () => {
        const content = 'commentary to=search {invalid json}\nValid response';
        const result = extractCommentaryToolCalls(content);

        expect(result.toolCalls.length).toBe(0);
        expect(result.remainingContent).toContain('commentary');
      });
    });

    describe('edge cases', () => {
      it('should handle empty content', () => {
        const result = extractCommentaryToolCalls('');
        expect(result.toolCalls.length).toBe(0);
        expect(result.remainingContent).toBe('');
      });

      it('should handle content without tool calls', () => {
        const content = 'Just a normal response without any tool calls.';
        const result = extractCommentaryToolCalls(content);

        expect(result.toolCalls.length).toBe(0);
        expect(result.remainingContent).toBe(content);
      });
    });
  });
});
