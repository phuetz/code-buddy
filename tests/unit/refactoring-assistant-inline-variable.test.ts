import { describe, it, expect } from 'vitest';
import { RefactoringAssistant } from '../../src/tools/intelligence/refactoring-assistant.js';
import type { ASTParseResult, CodeSymbol } from '../../src/tools/intelligence/types.js';

function createVariableSymbol(name: string, line: number): CodeSymbol {
  return {
    id: `sym-${name}-${line}`,
    name,
    type: 'variable',
    language: 'typescript',
    filePath: 'src/example.ts',
    range: {
      start: { line, column: 0, offset: 0 },
      end: { line, column: 20, offset: 20 },
    },
    visibility: 'internal',
    scope: 'module',
    metadata: {},
  };
}

function createParseResult(symbols: CodeSymbol[]): ASTParseResult {
  return {
    filePath: 'src/example.ts',
    language: 'typescript',
    symbols,
    imports: [],
    exports: [],
    errors: [],
    parseTime: 0,
    metadata: {
      lineCount: 1,
      hasErrors: false,
    },
  };
}

describe('RefactoringAssistant inlineVariable', () => {
  it('inlines a simple const variable declaration', async () => {
    const content = [
      'const threshold = limit + 1;',
      'if (value > threshold) {',
      '  return threshold;',
      '}',
    ].join('\n');

    const parser = {
      parseFile: async () => createParseResult([createVariableSymbol('threshold', 1)]),
    };
    const symbolSearch = {};

    const assistant = new RefactoringAssistant(
      parser as unknown as import('../../src/tools/intelligence/ast-parser.js').ASTParser,
      symbolSearch as unknown as import('../../src/tools/intelligence/symbol-search.js').SymbolSearch
    );

    (assistant as unknown as { vfs: { readFile: (filePath: string, encoding: string) => Promise<string> } }).vfs = {
      readFile: async () => content,
    };

    const result = await assistant.refactor({
      type: 'inlineVariable',
      filePath: 'src/example.ts',
      range: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 10 },
      },
    });

    expect(result.success).toBe(true);
    expect(result.changes).toHaveLength(1);
    const updated = result.changes[0].newContent ?? '';
    expect(updated).not.toContain('const threshold =');
    expect(updated).toContain('if (value > (limit + 1)) {');
    expect(updated).toContain('return (limit + 1);');
  });

  it('rejects non-const variable inlining for safety', async () => {
    const content = [
      'let count = getCount();',
      'console.log(count);',
    ].join('\n');

    const parser = {
      parseFile: async () => createParseResult([createVariableSymbol('count', 1)]),
    };
    const assistant = new RefactoringAssistant(
      parser as unknown as import('../../src/tools/intelligence/ast-parser.js').ASTParser
    );

    (assistant as unknown as { vfs: { readFile: (filePath: string, encoding: string) => Promise<string> } }).vfs = {
      readFile: async () => content,
    };

    const result = await assistant.refactor({
      type: 'inlineVariable',
      filePath: 'src/example.ts',
      range: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 10 },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Only const variables can be safely inlined');
  });

  it('returns an error when no references are found', async () => {
    const content = [
      'const localValue = 42;',
      'console.log("done");',
    ].join('\n');

    const parser = {
      parseFile: async () => createParseResult([createVariableSymbol('localValue', 1)]),
    };
    const assistant = new RefactoringAssistant(
      parser as unknown as import('../../src/tools/intelligence/ast-parser.js').ASTParser
    );

    (assistant as unknown as { vfs: { readFile: (filePath: string, encoding: string) => Promise<string> } }).vfs = {
      readFile: async () => content,
    };

    const result = await assistant.refactor({
      type: 'inlineVariable',
      filePath: 'src/example.ts',
      range: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 10 },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No references found');
  });
});
