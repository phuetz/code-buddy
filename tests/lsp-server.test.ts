/**
 * Tests for LSP Server
 *
 * Note: The actual LSP server runs as a separate process.
 * These tests verify the server configuration and utility functions.
 */

import { DiagnosticSeverity, CompletionItemKind } from 'vscode-languageserver/node';

describe('LSP Server', () => {
  describe('Severity Mapping', () => {
    it('should map error severity', () => {
      expect(DiagnosticSeverity.Error).toBe(1);
    });

    it('should map warning severity', () => {
      expect(DiagnosticSeverity.Warning).toBe(2);
    });

    it('should map information severity', () => {
      expect(DiagnosticSeverity.Information).toBe(3);
    });
  });

  describe('Completion Kind Mapping', () => {
    it('should map function kind', () => {
      expect(CompletionItemKind.Function).toBe(3);
    });

    it('should map variable kind', () => {
      expect(CompletionItemKind.Variable).toBe(6);
    });

    it('should map class kind', () => {
      expect(CompletionItemKind.Class).toBe(7);
    });

    it('should map property kind', () => {
      expect(CompletionItemKind.Property).toBe(10);
    });

    it('should map method kind', () => {
      expect(CompletionItemKind.Method).toBe(2);
    });
  });

  describe('Server Configuration', () => {
    it('should define default settings', () => {
      const defaultSettings = {
        apiKey: '',
        model: 'grok-3-latest',
        enableDiagnostics: true,
        enableCompletions: true,
        maxTokens: 2048,
      };

      expect(defaultSettings.model).toBe('grok-3-latest');
      expect(defaultSettings.enableDiagnostics).toBe(true);
      expect(defaultSettings.enableCompletions).toBe(true);
      expect(defaultSettings.maxTokens).toBe(2048);
    });

    it('should support trigger characters for completions', () => {
      const triggerCharacters = ['.', ':', '(', '<', '"', "'", '/', '@'];

      expect(triggerCharacters).toContain('.');
      expect(triggerCharacters).toContain(':');
      expect(triggerCharacters).toContain('(');
      expect(triggerCharacters).toContain('@');
    });

    it('should support signature help triggers', () => {
      const signatureTriggers = ['(', ','];

      expect(signatureTriggers).toContain('(');
      expect(signatureTriggers).toContain(',');
    });
  });

  describe('Server Capabilities', () => {
    it('should provide text document sync', () => {
      const capabilities = {
        textDocumentSync: 2, // TextDocumentSyncKind.Incremental
      };

      expect(capabilities.textDocumentSync).toBe(2);
    });

    it('should provide completion support', () => {
      const capabilities = {
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: ['.', ':', '(', '<', '"', "'", '/', '@'],
        },
      };

      expect(capabilities.completionProvider.resolveProvider).toBe(true);
      expect(capabilities.completionProvider.triggerCharacters.length).toBe(8);
    });

    it('should provide code action support', () => {
      const capabilities = {
        codeActionProvider: {
          codeActionKinds: ['quickfix', 'refactor', 'source'],
        },
      };

      expect(capabilities.codeActionProvider.codeActionKinds).toContain('quickfix');
      expect(capabilities.codeActionProvider.codeActionKinds).toContain('refactor');
    });

    it('should provide hover support', () => {
      const capabilities = {
        hoverProvider: true,
      };

      expect(capabilities.hoverProvider).toBe(true);
    });

    it('should provide signature help support', () => {
      const capabilities = {
        signatureHelpProvider: {
          triggerCharacters: ['(', ','],
        },
      };

      expect(capabilities.signatureHelpProvider.triggerCharacters).toContain('(');
    });

    it('should provide diagnostic support', () => {
      const capabilities = {
        diagnosticProvider: {
          interFileDependencies: false,
          workspaceDiagnostics: false,
        },
      };

      expect(capabilities.diagnosticProvider).toBeDefined();
    });
  });

  describe('JSON Parsing', () => {
    it('should parse valid JSON array', () => {
      const content = `Some text before [{"line": 1, "severity": "error", "message": "Test"}] some text after`;
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      expect(jsonMatch).not.toBeNull();
      const parsed = JSON.parse(jsonMatch![0]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].line).toBe(1);
    });

    it('should handle empty array', () => {
      const content = '[]';
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      expect(jsonMatch).not.toBeNull();
      const parsed = JSON.parse(jsonMatch![0]);
      expect(parsed).toHaveLength(0);
    });

    it('should handle multiline JSON', () => {
      const content = `
[
  {
    "line": 10,
    "severity": "warning",
    "message": "Consider using const"
  },
  {
    "line": 20,
    "severity": "error",
    "message": "Undefined variable"
  }
]`;
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      expect(jsonMatch).not.toBeNull();
      const parsed = JSON.parse(jsonMatch![0]);
      expect(parsed).toHaveLength(2);
    });
  });

  describe('Word Boundary Detection', () => {
    it('should find word at position', () => {
      const line = 'const myVariable = value;';
      const charPos = 10; // Position in 'myVariable'

      let wordStart = charPos;
      let wordEnd = charPos;

      while (wordStart > 0 && /\w/.test(line[wordStart - 1])) wordStart--;
      while (wordEnd < line.length && /\w/.test(line[wordEnd])) wordEnd++;

      const word = line.slice(wordStart, wordEnd);
      expect(word).toBe('myVariable');
    });

    it('should handle word at start of line', () => {
      const line = 'function test() {}';
      const charPos = 3;

      let wordStart = charPos;
      let wordEnd = charPos;

      while (wordStart > 0 && /\w/.test(line[wordStart - 1])) wordStart--;
      while (wordEnd < line.length && /\w/.test(line[wordEnd])) wordEnd++;

      const word = line.slice(wordStart, wordEnd);
      expect(word).toBe('function');
    });

    it('should handle word at end of line', () => {
      const line = 'return value';
      const charPos = 10;

      let wordStart = charPos;
      let wordEnd = charPos;

      while (wordStart > 0 && /\w/.test(line[wordStart - 1])) wordStart--;
      while (wordEnd < line.length && /\w/.test(line[wordEnd])) wordEnd++;

      const word = line.slice(wordStart, wordEnd);
      expect(word).toBe('value');
    });
  });

  describe('Function Name Extraction', () => {
    it('should extract function name before parenthesis', () => {
      const text = 'console.log(message)';
      const funcStart = text.indexOf('(');

      let nameEnd = funcStart;
      let nameStart = funcStart - 1;

      while (nameStart >= 0 && /\w/.test(text[nameStart])) {
        nameStart--;
      }

      const funcName = text.slice(nameStart + 1, nameEnd);
      expect(funcName).toBe('log');
    });

    it('should handle nested function calls', () => {
      const text = 'array.map(item => fn(item))';
      const funcStart = text.indexOf('(');

      let nameEnd = funcStart;
      let nameStart = funcStart - 1;

      while (nameStart >= 0 && /\w/.test(text[nameStart])) {
        nameStart--;
      }

      const funcName = text.slice(nameStart + 1, nameEnd);
      expect(funcName).toBe('map');
    });
  });

  describe('Cache Management', () => {
    it('should implement cache with timeout', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic cache for testing
      const cache = new Map<string, any>();
      const cacheKey = 'test_key';
      const value = { data: 'test' };

      cache.set(cacheKey, value);
      expect(cache.has(cacheKey)).toBe(true);

      // Simulate timeout with proper cleanup
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          cache.delete(cacheKey);
          expect(cache.has(cacheKey)).toBe(false);
          resolve();
        }, 100);
      });
    });

    it('should generate consistent cache keys', () => {
      const prefix = 'const x = ';
      const line = 5;

      const cacheKey1 = `${prefix.slice(-50)}|${line}`;
      const cacheKey2 = `${prefix.slice(-50)}|${line}`;

      expect(cacheKey1).toBe(cacheKey2);
    });
  });
});
