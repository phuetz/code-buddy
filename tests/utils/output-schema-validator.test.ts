import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateOutputText } from '../../src/utils/output-schema-validator';

describe('output-schema-validator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-schema-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const runTest = (schema: unknown, outputText: string) => {
    const schemaPath = path.join(tmpDir, 'schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify(schema));
    return validateOutputText(outputText, schemaPath);
  };

  describe('integer validation', () => {
    it('should accept valid positive integers', () => {
      const schema = { type: 'object', properties: { n: { type: 'integer' } } };
      const res = runTest(schema, '{"n":3}');
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('should accept valid negative integers', () => {
      const schema = { type: 'object', properties: { n: { type: 'integer' } } };
      const res = runTest(schema, '{"n":-2}');
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('should reject floats for integer', () => {
      const schema = { type: 'object', properties: { n: { type: 'integer' } } };
      const res = runTest(schema, '{"n":1.5}');
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('$.n: expected type integer, got number (1.5 is not an integer)');
    });

    it('should reject strings for integer', () => {
      const schema = { type: 'object', properties: { n: { type: 'integer' } } };
      const res = runTest(schema, '{"n":"3"}');
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('$.n: expected type integer, got string');
    });

    it('should accept integers with multiple types [integer, null]', () => {
      const schema = { type: ['integer', 'null'] };

      const res1 = runTest(schema, '7');
      expect(res1.valid).toBe(true);

      const res2 = runTest(schema, 'null');
      expect(res2.valid).toBe(true);
    });

    it('should continue to accept integers and floats for type "number"', () => {
      const schema = { type: 'number' };

      const res1 = runTest(schema, '1.5');
      expect(res1.valid).toBe(true);

      const res2 = runTest(schema, '3');
      expect(res2.valid).toBe(true);
    });

    it('should apply minimum and maximum to integers', () => {
        const schema = { type: 'integer', minimum: 1, maximum: 5 };

        const res1 = runTest(schema, '3');
        expect(res1.valid).toBe(true);

        const res2 = runTest(schema, '0');
        expect(res2.valid).toBe(false);
        expect(res2.errors).toContain('$: value 0 is less than minimum 1');

        const res3 = runTest(schema, '6');
        expect(res3.valid).toBe(false);
        expect(res3.errors).toContain('$: value 6 exceeds maximum 5');
    });
  });
});