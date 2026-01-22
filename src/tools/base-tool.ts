/**
 * Base Tool Abstract Class
 *
 * Provides a foundation for implementing tools with:
 * - ITool interface implementation
 * - Schema generation helpers
 * - Input validation
 * - Lifecycle management
 */

import type { ToolResult } from '../types/index.js';
import type {
  ITool,
  IToolMetadata,
  ToolSchema,
  JsonSchema,
  JsonSchemaProperty,
  IValidationResult,
  ToolCategoryType,
} from './registry/types.js';
import { registerDisposable, Disposable } from '../utils/disposable.js';

// ============================================================================
// Parameter Builder Types
// ============================================================================

/**
 * Parameter definition for building schemas
 */
export interface ParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  items?: ParameterDefinition;
  properties?: Record<string, ParameterDefinition>;
}

// ============================================================================
// Base Tool Abstract Class
// ============================================================================

/**
 * Abstract base class for tools.
 *
 * Subclasses must implement:
 * - `name`: Unique tool identifier
 * - `description`: Human-readable description
 * - `execute`: Main execution logic
 *
 * Optional overrides:
 * - `getParameters`: Define parameter schema
 * - `validate`: Custom input validation
 * - `getMetadata`: Additional metadata
 * - `isAvailable`: Check if tool can be used
 * - `dispose`: Cleanup resources
 */
export abstract class BaseTool implements ITool, Disposable {
  /**
   * Unique tool name (must be valid identifier)
   */
  abstract readonly name: string;

  /**
   * Human-readable description
   */
  abstract readonly description: string;

  /**
   * Tool category for classification
   */
  protected category: ToolCategoryType = 'utility';

  /**
   * Keywords for search/filtering
   */
  protected keywords: string[] = [];

  /**
   * Priority for tool selection (higher = more likely)
   */
  protected priority: number = 1;

  /**
   * Whether tool requires user confirmation
   */
  protected requiresConfirmation: boolean = false;

  /**
   * Whether tool modifies files
   */
  protected modifiesFiles: boolean = false;

  /**
   * Whether tool makes network requests
   */
  protected makesNetworkRequests: boolean = false;

  constructor() {
    registerDisposable(this);
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Execute the tool with given input.
   *
   * @param input - Tool parameters as key-value pairs
   * @returns Promise resolving to ToolResult
   */
  abstract execute(input: Record<string, unknown>): Promise<ToolResult>;

  // ============================================================================
  // Schema Generation
  // ============================================================================

  /**
   * Get parameter definitions for schema generation.
   *
   * Override this method to define tool parameters.
   *
   * @example
   * ```typescript
   * protected getParameters(): Record<string, ParameterDefinition> {
   *   return {
   *     path: {
   *       type: 'string',
   *       description: 'File path to read',
   *       required: true,
   *     },
   *     encoding: {
   *       type: 'string',
   *       description: 'File encoding',
   *       default: 'utf-8',
   *     },
   *   };
   * }
   * ```
   */
  protected getParameters(): Record<string, ParameterDefinition> {
    return {};
  }

  /**
   * Get the tool schema for LLM function calling.
   */
  getSchema(): ToolSchema {
    const parameters = this.getParameters();
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];

    for (const [name, def] of Object.entries(parameters)) {
      properties[name] = this.buildSchemaProperty(def);
      if (def.required) {
        required.push(name);
      }
    }

    const jsonSchema: JsonSchema = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };

    return {
      name: this.name,
      description: this.description,
      parameters: jsonSchema,
    };
  }

  /**
   * Build a JSON schema property from parameter definition
   */
  private buildSchemaProperty(def: ParameterDefinition): JsonSchemaProperty {
    const prop: JsonSchemaProperty = {
      type: def.type,
      description: def.description,
    };

    if (def.enum) {
      prop.enum = def.enum;
    }

    if (def.default !== undefined) {
      prop.default = def.default;
    }

    if (def.type === 'array' && def.items) {
      prop.items = this.buildSchemaProperty(def.items);
    }

    return prop;
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate input before execution.
   *
   * Default implementation checks required parameters.
   * Override for custom validation.
   */
  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object') {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const params = this.getParameters();
    const errors: string[] = [];
    const inputObj = input as Record<string, unknown>;

    // Check required parameters
    for (const [name, def] of Object.entries(params)) {
      if (def.required && !(name in inputObj)) {
        errors.push(`Missing required parameter: ${name}`);
      }
    }

    // Check types
    for (const [name, value] of Object.entries(inputObj)) {
      const def = params[name];
      if (def && !this.validateType(value, def.type)) {
        errors.push(`Invalid type for ${name}: expected ${def.type}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Validate a value's type
   */
  private validateType(value: unknown, expectedType: string): boolean {
    if (value === null || value === undefined) {
      return true; // Will be caught by required check
    }

    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && !Array.isArray(value);
      default:
        return true;
    }
  }

  // ============================================================================
  // Metadata
  // ============================================================================

  /**
   * Get tool metadata.
   */
  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      keywords: this.keywords,
      priority: this.priority,
      requiresConfirmation: this.requiresConfirmation,
      modifiesFiles: this.modifiesFiles,
      makesNetworkRequests: this.makesNetworkRequests,
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Check if tool is currently available.
   *
   * Override to add custom availability checks (e.g., required binaries).
   */
  isAvailable(): boolean {
    return true;
  }

  /**
   * Dispose of tool resources.
   *
   * Override to clean up resources (e.g., connections, file handles).
   */
  dispose(): void {
    // Default: no-op
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Create a success result
   */
  protected success(output: string, data?: unknown): ToolResult {
    return { success: true, output, data };
  }

  /**
   * Create an error result
   */
  protected error(message: string, data?: unknown): ToolResult {
    return { success: false, error: message, data };
  }

  /**
   * Wrap execution with error handling
   */
  protected async safeExecute(
    fn: () => Promise<ToolResult>
  ): Promise<ToolResult> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(message);
    }
  }
}

// ============================================================================
// Decorators (for future use)
// ============================================================================

/**
 * Decorator to mark a tool as requiring confirmation
 */
export function RequiresConfirmation() {
  return function <T extends BaseTool>(
    target: new (...args: unknown[]) => T
  ) {
    const original = target.prototype.requiresConfirmation;
    Object.defineProperty(target.prototype, 'requiresConfirmation', {
      get() {
        return true;
      },
    });
    return target;
  };
}

/**
 * Decorator to set tool category
 */
export function ToolCategory(category: ToolCategoryType) {
  return function <T extends BaseTool>(
    target: new (...args: unknown[]) => T
  ) {
    Object.defineProperty(target.prototype, 'category', {
      get() {
        return category;
      },
    });
    return target;
  };
}

/**
 * Decorator to add keywords
 */
export function Keywords(...keywords: string[]) {
  return function <T extends BaseTool>(
    target: new (...args: unknown[]) => T
  ) {
    const existing = target.prototype.keywords || [];
    Object.defineProperty(target.prototype, 'keywords', {
      get() {
        return [...existing, ...keywords];
      },
    });
    return target;
  };
}
