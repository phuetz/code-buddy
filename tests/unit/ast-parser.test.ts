/**
 * Unit Tests for AST Parser
 *
 * Tests code parsing and AST handling for multiple languages.
 */

// Increase Jest timeout for this memory-heavy test suite
vi.setConfig({ testTimeout: 60000 });

describe('AST Parser', () => {
  // Lazy import to avoid memory issues
  let ASTParser: any;
  let createASTParser: any;
  let getASTParser: any;
  let resetASTParser: any;

  beforeAll(async () => {
    const module = await import('../../src/tools/intelligence/ast-parser');
    ASTParser = module.ASTParser;
    createASTParser = module.createASTParser;
    getASTParser = module.getASTParser;
    resetASTParser = module.resetASTParser;
  });

  beforeEach(() => {
    if (resetASTParser) resetASTParser();
  });

  afterAll(() => {
    // Cleanup: reset singleton to free memory
    if (resetASTParser) resetASTParser();
  });

  describe('Factory Functions', () => {
    it('should create a new parser instance with createASTParser', () => {
      const p = createASTParser();
      expect(p).toBeInstanceOf(ASTParser);
    });

    it('should return singleton instance with getASTParser', () => {
      const p1 = getASTParser();
      const p2 = getASTParser();
      expect(p1).toBe(p2);
    });

    it('should reset singleton with resetASTParser', () => {
      const p1 = getASTParser();
      resetASTParser();
      const p2 = getASTParser();
      expect(p1).not.toBe(p2);
    });
  });

  describe('Language Detection', () => {
    it('should detect TypeScript from .ts extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.ts')).toBe('typescript');
    });

    it('should detect JavaScript from .js extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.js')).toBe('javascript');
    });

    it('should detect Python from .py extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.py')).toBe('python');
    });

    it('should detect Go from .go extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.go')).toBe('go');
    });

    it('should return unknown for unsupported extensions', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.xyz')).toBe('unknown');
    });
  });

  describe('TypeScript Parsing', () => {
    const tsCode = `
import { foo } from './foo';

export interface IUser {
  name: string;
}

export class UserService {
  async getUser(id: string) { return null; }
}

export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}
`;

    it('should parse TypeScript content correctly', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');

      expect(result.filePath).toBe('test.ts');
      expect(result.language).toBe('typescript');
      expect(result.errors).toHaveLength(0);
    });

    it('should extract class symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const classes = result.symbols.filter((s: any) => s.type === 'class');

      expect(classes.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract function symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const functions = result.symbols.filter((s: any) => s.type === 'function');

      expect(functions.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract imports', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');

      expect(result.imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      const parser = createASTParser();
      parser.clearCache();
      const stats = parser.getCacheStats();

      expect(stats.size).toBe(0);
    });

    it('should report cache stats', () => {
      const parser = createASTParser();
      const stats = parser.getCacheStats();

      expect(typeof stats.size).toBe('number');
      expect(Array.isArray(stats.entries)).toBe(true);
    });
  });
});
