/**
 * Output Schema Validator
 *
 * Validates headless mode JSON output against a JSON Schema file (draft-07 subset).
 * Supports: type, properties, required, enum, pattern, minLength, maxLength,
 * minimum, maximum, items, additionalProperties.
 *
 * No external dependencies - uses basic manual JSON Schema validation.
 */

import fs from 'fs';
import path from 'path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: JSONSchema;
  additionalProperties?: boolean;
  description?: string;
}

/**
 * Load and parse a JSON Schema file from disk.
 */
export function loadSchema(schemaPath: string): JSONSchema {
  const resolved = path.resolve(schemaPath);
  const content = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(content) as JSONSchema;
}

/**
 * Validate a value against a JSON Schema (draft-07 subset).
 */
function validateValue(value: unknown, schema: JSONSchema, path: string): string[] {
  const errors: string[] = [];

  // Type check
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = getJSONType(value);
    if (!types.includes(actualType)) {
      errors.push(`${path}: expected type ${types.join(' | ')}, got ${actualType}`);
      return errors; // No point checking further if type is wrong
    }
  }

  // Enum check
  if (schema.enum !== undefined) {
    if (!schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) {
      errors.push(`${path}: value ${JSON.stringify(value)} not in enum [${schema.enum.map(e => JSON.stringify(e)).join(', ')}]`);
    }
  }

  // String-specific checks
  if (typeof value === 'string') {
    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push(`${path}: string "${value}" does not match pattern "${schema.pattern}"`);
      }
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string length ${value.length} is less than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: string length ${value.length} exceeds maxLength ${schema.maxLength}`);
    }
  }

  // Number-specific checks
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: value ${value} is less than minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: value ${value} exceeds maximum ${schema.maximum}`);
    }
  }

  // Object-specific checks
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // Required properties
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in obj)) {
          errors.push(`${path}: missing required property "${req}"`);
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(...validateValue(obj[key], propSchema, `${path}.${key}`));
        }
      }
    }

    // Additional properties check
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: unexpected additional property "${key}"`);
        }
      }
    }
  }

  // Array-specific checks
  if (Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateValue(value[i], schema.items, `${path}[${i}]`));
      }
    }
  }

  return errors;
}

/**
 * Get the JSON Schema type string for a value.
 */
function getJSONType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

/**
 * Validate output against a JSON Schema file.
 *
 * @param output - The parsed output value to validate
 * @param schemaPath - Path to the JSON Schema file
 * @returns Validation result with errors array
 */
export function validateOutputSchema(output: unknown, schemaPath: string): ValidationResult {
  try {
    const schema = loadSchema(schemaPath);
    const errors = validateValue(output, schema, '$');
    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`Failed to load or parse schema: ${message}`],
    };
  }
}
