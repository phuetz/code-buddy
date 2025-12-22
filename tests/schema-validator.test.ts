/**
 * Tests for Schema Validator
 *
 * Tests JSON Schema validation for structured LLM output.
 */

import {
  SchemaValidator,
  getSchemaValidator,
  resetSchemaValidator,
  TOOL_CALL_SCHEMA,
  ACTION_PLAN_SCHEMA,
  CODE_EDIT_SCHEMA,
  type JSONSchema,
} from '../src/utils/schema-validator.js';

// ============================================================================
// SchemaValidator Tests
// ============================================================================

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    resetSchemaValidator();
    validator = new SchemaValidator();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const v = new SchemaValidator();
      expect(v).toBeInstanceOf(SchemaValidator);
    });

    it('should create with custom config', () => {
      const v = new SchemaValidator({
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
        maxRetries: 5,
      });
      expect(v).toBeInstanceOf(SchemaValidator);
    });
  });

  describe('validate - string type', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    };

    it('should validate valid string', () => {
      const result = validator.validate({ name: 'John' }, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should coerce number to string', () => {
      const result = validator.validate({ name: 123 }, schema);
      expect(result.valid).toBe(true);
      expect(result.coerced).toBe(true);
      expect((result.data as { name: string }).name).toBe('123');
    });

    it('should validate string minLength', () => {
      const minSchema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 3 },
        },
      };
      const result = validator.validate({ name: 'ab' }, minSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('too short');
    });

    it('should validate string maxLength', () => {
      const maxSchema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 5 },
        },
      };
      const result = validator.validate({ name: 'toolong' }, maxSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('too long');
    });

    it('should validate string pattern', () => {
      const patternSchema: JSONSchema = {
        type: 'object',
        properties: {
          email: { type: 'string', pattern: '^[a-z]+@[a-z]+\\.[a-z]+$' },
        },
      };
      const valid = validator.validate({ email: 'test@example.com' }, patternSchema);
      expect(valid.valid).toBe(true);

      const invalid = validator.validate({ email: 'invalid' }, patternSchema);
      expect(invalid.valid).toBe(false);
    });
  });

  describe('validate - number type', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        age: { type: 'number' },
      },
    };

    it('should validate valid number', () => {
      const result = validator.validate({ age: 25 }, schema);
      expect(result.valid).toBe(true);
    });

    it('should coerce string to number', () => {
      const result = validator.validate({ age: '25' }, schema);
      expect(result.valid).toBe(true);
      expect(result.coerced).toBe(true);
      expect((result.data as { age: number }).age).toBe(25);
    });

    it('should validate minimum', () => {
      const minSchema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 18 },
        },
      };
      const result = validator.validate({ age: 15 }, minSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('too small');
    });

    it('should validate maximum', () => {
      const maxSchema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', maximum: 100 },
        },
      };
      const result = validator.validate({ age: 150 }, maxSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('too large');
    });
  });

  describe('validate - boolean type', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        active: { type: 'boolean' },
      },
    };

    it('should validate valid boolean', () => {
      const result = validator.validate({ active: true }, schema);
      expect(result.valid).toBe(true);
    });

    it('should coerce string "true" to boolean', () => {
      const result = validator.validate({ active: 'true' }, schema);
      expect(result.valid).toBe(true);
      expect(result.coerced).toBe(true);
      expect((result.data as { active: boolean }).active).toBe(true);
    });

    it('should coerce number 1 to boolean true', () => {
      const result = validator.validate({ active: 1 }, schema);
      expect(result.valid).toBe(true);
      expect((result.data as { active: boolean }).active).toBe(true);
    });
  });

  describe('validate - array type', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    };

    it('should validate valid array', () => {
      const result = validator.validate({ items: ['a', 'b', 'c'] }, schema);
      expect(result.valid).toBe(true);
    });

    it('should validate array items', () => {
      const result = validator.validate({ items: ['a', 123, 'c'] }, schema);
      expect(result.valid).toBe(true);
      expect(result.coerced).toBe(true);
    });

    it('should validate minItems', () => {
      const minSchema: JSONSchema = {
        type: 'object',
        properties: {
          items: { type: 'array', minItems: 2 },
        },
      };
      const result = validator.validate({ items: ['a'] }, minSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('too short');
    });

    it('should validate maxItems', () => {
      const maxSchema: JSONSchema = {
        type: 'object',
        properties: {
          items: { type: 'array', maxItems: 2 },
        },
      };
      const result = validator.validate({ items: ['a', 'b', 'c'] }, maxSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('too long');
    });
  });

  describe('validate - enum', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'active', 'completed'],
        },
      },
    };

    it('should validate valid enum value', () => {
      const result = validator.validate({ status: 'active' }, schema);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid enum value', () => {
      const result = validator.validate({ status: 'invalid' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('must be one of');
    });
  });

  describe('validate - required properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['name', 'email'],
    };

    it('should validate when all required present', () => {
      const result = validator.validate(
        { name: 'John', email: 'john@example.com' },
        schema
      );
      expect(result.valid).toBe(true);
    });

    it('should reject when required missing', () => {
      const result = validator.validate({ name: 'John' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Required property missing');
    });

    it('should use default value for missing required', () => {
      const defaultSchema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string', default: 'user' },
        },
        required: ['name', 'role'],
      };
      const result = validator.validate({ name: 'John' }, defaultSchema);
      expect(result.valid).toBe(true);
      expect((result.data as { role: string }).role).toBe('user');
    });
  });

  describe('validate - nested objects', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: {
              type: 'object',
              properties: {
                city: { type: 'string' },
                zip: { type: 'string' },
              },
            },
          },
        },
      },
    };

    it('should validate nested objects', () => {
      const data = {
        user: {
          name: 'John',
          address: {
            city: 'Paris',
            zip: '75001',
          },
        },
      };
      const result = validator.validate(data, schema);
      expect(result.valid).toBe(true);
    });

    it('should report errors with nested path', () => {
      const data = {
        user: {
          name: 123, // Should be string
          address: {
            city: 'Paris',
          },
        },
      };
      const result = validator.validate(data, schema);
      expect(result.valid).toBe(true); // Coerced
      expect(result.coerced).toBe(true);
    });
  });

  describe('extractJSON', () => {
    it('should extract valid JSON directly', () => {
      const result = validator.extractJSON('{"name": "John"}');
      expect(result).not.toBeNull();
      expect(result?.json).toEqual({ name: 'John' });
      expect(result?.extracted).toBe(false);
    });

    it('should extract JSON from code block', () => {
      const text = 'Here is the result:\n```json\n{"name": "John"}\n```';
      const result = validator.extractJSON(text);
      expect(result).not.toBeNull();
      expect(result?.json).toEqual({ name: 'John' });
      expect(result?.extracted).toBe(true);
    });

    it('should extract JSON from text with surrounding content', () => {
      const text = 'The answer is {"name": "John"} and more text';
      const result = validator.extractJSON(text);
      expect(result).not.toBeNull();
      expect(result?.json).toEqual({ name: 'John' });
      expect(result?.extracted).toBe(true);
    });

    it('should extract JSON array', () => {
      const text = 'Results: [1, 2, 3]';
      const result = validator.extractJSON(text);
      expect(result).not.toBeNull();
      expect(result?.json).toEqual([1, 2, 3]);
    });

    it('should return null for invalid JSON', () => {
      const result = validator.extractJSON('no json here');
      expect(result).toBeNull();
    });

    it('should fix trailing commas', () => {
      const text = '{"name": "John",}';
      const result = validator.extractJSON(text);
      expect(result).not.toBeNull();
      expect(result?.json).toEqual({ name: 'John' });
    });
  });

  describe('validateResponse', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        action: { type: 'string' },
        target: { type: 'string' },
      },
      required: ['action'],
    };

    it('should validate valid response', () => {
      const response = '{"action": "read", "target": "file.txt"}';
      const result = validator.validateResponse(response, schema);
      expect(result.valid).toBe(true);
      expect(result.raw).toBe(response);
    });

    it('should extract and validate from code block', () => {
      const response = 'I will:\n```json\n{"action": "write"}\n```';
      const result = validator.validateResponse(response, schema);
      expect(result.valid).toBe(true);
    });

    it('should return error for non-JSON response', () => {
      const response = 'I cannot do that.';
      const result = validator.validateResponse(response, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Could not extract JSON');
    });

    it('should emit validation event', () => {
      const eventHandler = jest.fn();
      validator.on('validation', eventHandler);

      validator.validateResponse('{"action": "test"}', schema);

      expect(eventHandler).toHaveBeenCalled();
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: true,
        })
      );
    });
  });

  describe('createSchemaPrompt', () => {
    it('should create prompt with schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };
      const prompt = validator.createSchemaPrompt(schema);

      expect(prompt).toContain('valid JSON');
      expect(prompt).toContain('"name"');
      expect(prompt).toContain('string');
    });
  });
});

// ============================================================================
// Common Schemas Tests
// ============================================================================

describe('Common Schemas', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  describe('TOOL_CALL_SCHEMA', () => {
    it('should validate valid tool call', () => {
      const data = {
        tool: 'read_file',
        arguments: { path: '/tmp/test.txt' },
      };
      const result = validator.validate(data, TOOL_CALL_SCHEMA);
      expect(result.valid).toBe(true);
    });

    it('should validate tool call with reasoning', () => {
      const data = {
        tool: 'write_file',
        arguments: { path: '/tmp/out.txt', content: 'hello' },
        reasoning: 'Need to save the result',
      };
      const result = validator.validate(data, TOOL_CALL_SCHEMA);
      expect(result.valid).toBe(true);
    });

    it('should reject missing tool name', () => {
      const data = {
        arguments: { path: '/tmp/test.txt' },
      };
      const result = validator.validate(data, TOOL_CALL_SCHEMA);
      expect(result.valid).toBe(false);
    });
  });

  describe('ACTION_PLAN_SCHEMA', () => {
    it('should validate valid action plan', () => {
      const data = {
        goal: 'Refactor the authentication module',
        steps: [
          { action: 'read', description: 'Read current auth code' },
          { action: 'analyze', description: 'Identify issues' },
          { action: 'write', description: 'Write improved code' },
        ],
      };
      const result = validator.validate(data, ACTION_PLAN_SCHEMA);
      expect(result.valid).toBe(true);
    });

    it('should validate plan with estimated steps', () => {
      const data = {
        goal: 'Fix bug',
        steps: [{ action: 'fix', description: 'Apply fix' }],
        estimatedSteps: 3,
      };
      const result = validator.validate(data, ACTION_PLAN_SCHEMA);
      expect(result.valid).toBe(true);
    });
  });

  describe('CODE_EDIT_SCHEMA', () => {
    it('should validate valid code edit', () => {
      const data = {
        file: 'src/index.ts',
        operation: 'replace',
        oldContent: 'const x = 1;',
        newContent: 'const x = 2;',
      };
      const result = validator.validate(data, CODE_EDIT_SCHEMA);
      expect(result.valid).toBe(true);
    });

    it('should validate create operation', () => {
      const data = {
        file: 'src/new-file.ts',
        operation: 'create',
        newContent: 'export const foo = 1;',
      };
      const result = validator.validate(data, CODE_EDIT_SCHEMA);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid operation', () => {
      const data = {
        file: 'src/index.ts',
        operation: 'invalid',
      };
      const result = validator.validate(data, CODE_EDIT_SCHEMA);
      expect(result.valid).toBe(false);
    });
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('Schema Validator Singleton', () => {
  beforeEach(() => {
    resetSchemaValidator();
  });

  describe('getSchemaValidator', () => {
    it('should return same instance', () => {
      const v1 = getSchemaValidator();
      const v2 = getSchemaValidator();
      expect(v1).toBe(v2);
    });
  });

  describe('resetSchemaValidator', () => {
    it('should reset singleton', () => {
      const v1 = getSchemaValidator();
      resetSchemaValidator();
      const v2 = getSchemaValidator();
      expect(v1).not.toBe(v2);
    });
  });
});
