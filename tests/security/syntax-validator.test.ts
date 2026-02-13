import { validateSyntax } from '../../src/security/syntax-validator.js';

describe('Syntax Validator', () => {
  describe('JSON', () => {
    it('should pass valid JSON', () => {
      const result = validateSyntax('{"key": "value"}', 'test.json');
      expect(result.valid).toBe(true);
    });

    it('should fail invalid JSON', () => {
      const result = validateSyntax('{key: value}', 'test.json');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('JSON syntax error');
    });
  });

  describe('TypeScript/JavaScript', () => {
    it('should pass valid code', () => {
      const result = validateSyntax('const x = { a: 1 };\nfunction foo() { return x; }', 'test.ts');
      expect(result.valid).toBe(true);
    });

    it('should detect unbalanced braces', () => {
      const result = validateSyntax('function foo() {\n  return 1;\n', 'test.ts');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Unclosed '{'"))).toBe(true);
    });

    it('should detect mismatched delimiters', () => {
      const result = validateSyntax('const x = [1, 2);', 'test.js');
      expect(result.valid).toBe(false);
    });
  });

  describe('Python', () => {
    it('should pass valid Python', () => {
      const result = validateSyntax('def foo():\n    return 1\n', 'test.py');
      expect(result.valid).toBe(true);
    });

    it('should detect mixed tabs and spaces', () => {
      const result = validateSyntax('def foo():\n    return 1\n\tpass\n', 'test.py');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Mixed tabs and spaces');
    });
  });

  describe('YAML', () => {
    it('should pass valid YAML', () => {
      const result = validateSyntax('key: value\nlist:\n  - item1\n', 'test.yaml');
      expect(result.valid).toBe(true);
    });

    it('should detect tabs in YAML', () => {
      const result = validateSyntax('key:\tvalue\n', 'test.yml');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('tabs');
    });

    it('should detect duplicate root keys', () => {
      const result = validateSyntax('name: foo\nversion: 1\nname: bar\n', 'test.yaml');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Duplicate root key 'name'");
    });
  });

  describe('Unknown languages', () => {
    it('should pass unknown file types', () => {
      const result = validateSyntax('whatever content', 'test.txt');
      expect(result.valid).toBe(true);
      expect(result.language).toBe('unknown');
    });
  });
});
