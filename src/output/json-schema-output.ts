/**
 * JSON Schema Output Validation
 *
 * Validates LLM output against a JSON Schema definition.
 * Includes JSON extraction from markdown code blocks and
 * a built-in schema validator (no external deps).
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface JsonSchemaConfig {
  schema: Record<string, unknown>;
  strict: boolean;
  extractFromMarkdown: boolean;
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  data?: unknown;
}

// ============================================================================
// JSON Schema Output
// ============================================================================

export class JsonSchemaOutput {
  private config: JsonSchemaConfig;

  constructor(config: JsonSchemaConfig) {
    this.config = config;
  }

  /**
   * Validate output against schema
   */
  validate(output: string): ValidationResult {
    // Try to extract JSON
    let jsonStr = this.extractJson(output);

    if (jsonStr === null) {
      return {
        valid: false,
        errors: [{ path: '', message: 'Could not extract valid JSON from output' }],
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      return {
        valid: false,
        errors: [{ path: '', message: `Invalid JSON: ${(e as Error).message}` }],
      };
    }

    const errors = this.validateSchema(data, this.config.schema, '');
    const valid = errors.length === 0;

    if (!valid && this.config.strict) {
      logger.warn(`Schema validation failed with ${errors.length} errors`);
    }

    return { valid, errors, data: valid ? data : undefined };
  }

  /**
   * Extract JSON from various formats
   */
  extractJson(text: string): string | null {
    const trimmed = text.trim();

    // Try direct parse
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // Not direct JSON
    }

    // Try markdown code blocks
    if (this.config.extractFromMarkdown) {
      const fromBlock = this.extractFromCodeBlock(text);
      if (fromBlock) return fromBlock;
    }

    // Try to find JSON object or array in text
    const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        JSON.parse(jsonMatch[1]);
        return jsonMatch[1];
      } catch {
        // Not valid JSON
      }
    }

    return null;
  }

  /**
   * Extract from markdown code blocks
   */
  private extractFromCodeBlock(text: string): string | null {
    // Match ```json ... ``` or ``` ... ```
    const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/;
    const match = text.match(codeBlockRegex);
    if (match) {
      try {
        JSON.parse(match[1].trim());
        return match[1].trim();
      } catch {
        // Not valid JSON in code block
      }
    }
    return null;
  }

  /**
   * Simple JSON Schema validator
   */
  private validateSchema(
    data: unknown,
    schema: Record<string, unknown>,
    path: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    const schemaType = schema.type as string | undefined;

    // Type check
    if (schemaType) {
      if (!this.checkType(data, schemaType)) {
        errors.push({
          path: path || '$',
          message: `Expected type "${schemaType}"`,
          expected: schemaType,
          actual: Array.isArray(data) ? 'array' : typeof data,
        });
        return errors; // Can't validate further if type is wrong
      }
    }

    // Enum check
    if (schema.enum) {
      const enumValues = schema.enum as unknown[];
      if (!this.checkEnum(data, enumValues)) {
        errors.push({
          path: path || '$',
          message: `Value must be one of: ${enumValues.join(', ')}`,
          expected: enumValues.join(' | '),
          actual: String(data),
        });
      }
    }

    // Object-specific validations
    if (schemaType === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      // Required fields
      if (schema.required) {
        const missing = this.checkRequired(obj, schema.required as string[]);
        for (const field of missing) {
          errors.push({
            path: path ? `${path}.${field}` : field,
            message: `Required field missing: ${field}`,
          });
        }
      }

      // Properties
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
          if (obj[key] !== undefined) {
            const propPath = path ? `${path}.${key}` : key;
            errors.push(...this.validateSchema(obj[key], propSchema as Record<string, unknown>, propPath));
          }
        }
      }
    }

    // Array-specific validations
    if (schemaType === 'array' && Array.isArray(data)) {
      if (schema.items) {
        for (let i = 0; i < data.length; i++) {
          const itemPath = `${path || '$'}[${i}]`;
          errors.push(...this.validateSchema(data[i], schema.items as Record<string, unknown>, itemPath));
        }
      }
      if (schema.minItems !== undefined && data.length < (schema.minItems as number)) {
        errors.push({
          path: path || '$',
          message: `Array must have at least ${schema.minItems} items`,
          expected: `>= ${schema.minItems} items`,
          actual: `${data.length} items`,
        });
      }
      if (schema.maxItems !== undefined && data.length > (schema.maxItems as number)) {
        errors.push({
          path: path || '$',
          message: `Array must have at most ${schema.maxItems} items`,
          expected: `<= ${schema.maxItems} items`,
          actual: `${data.length} items`,
        });
      }
    }

    // String-specific validations
    if (schemaType === 'string' && typeof data === 'string') {
      if (schema.minLength !== undefined && data.length < (schema.minLength as number)) {
        errors.push({
          path: path || '$',
          message: `String must be at least ${schema.minLength} characters`,
        });
      }
      if (schema.maxLength !== undefined && data.length > (schema.maxLength as number)) {
        errors.push({
          path: path || '$',
          message: `String must be at most ${schema.maxLength} characters`,
        });
      }
      if (schema.pattern) {
        if (!this.checkPattern(data, schema.pattern as string)) {
          errors.push({
            path: path || '$',
            message: `String does not match pattern: ${schema.pattern}`,
          });
        }
      }
    }

    // Number-specific validations
    if (schemaType === 'number' && typeof data === 'number') {
      if (schema.minimum !== undefined && data < (schema.minimum as number)) {
        errors.push({
          path: path || '$',
          message: `Number must be >= ${schema.minimum}`,
          expected: `>= ${schema.minimum}`,
          actual: String(data),
        });
      }
      if (schema.maximum !== undefined && data > (schema.maximum as number)) {
        errors.push({
          path: path || '$',
          message: `Number must be <= ${schema.maximum}`,
          expected: `<= ${schema.maximum}`,
          actual: String(data),
        });
      }
    }

    return errors;
  }

  /**
   * Check if value matches expected type
   */
  private checkType(value: unknown, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'null':
        return value === null;
      default:
        return true;
    }
  }

  /**
   * Check enum values
   */
  private checkEnum(value: unknown, enumValues: unknown[]): boolean {
    return enumValues.includes(value);
  }

  /**
   * Check required fields
   */
  private checkRequired(obj: Record<string, unknown>, required: string[]): string[] {
    return required.filter(field => obj[field] === undefined);
  }

  /**
   * Check pattern match
   */
  private checkPattern(value: string, pattern: string): boolean {
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return true; // Invalid pattern, skip
    }
  }

  /**
   * Format valid output as pretty JSON
   */
  formatValidOutput(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get the schema
   */
  getSchema(): Record<string, unknown> {
    return { ...this.config.schema };
  }
}
