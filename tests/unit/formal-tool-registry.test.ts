/**
 * Formal Tool Registry Tests
 *
 * Tests for FormalToolRegistry and BaseTool classes.
 */

import { FormalToolRegistry, getFormalToolRegistry, createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { BaseTool, ParameterDefinition } from '../../src/tools/base-tool.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult } from '../../src/tools/registry/types.js';
import type { ToolResult } from '../../src/types/index.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Simple test tool using BaseTool
 */
class EchoTool extends BaseTool {
  readonly name = 'echo';
  readonly description = 'Echoes input back';

  protected category = 'utility' as const;
  protected keywords = ['echo', 'test'];
  protected priority = 5;

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      message: {
        type: 'string',
        description: 'Message to echo',
        required: true,
      },
      uppercase: {
        type: 'boolean',
        description: 'Convert to uppercase',
        default: false,
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const message = input.message as string;
    const uppercase = input.uppercase as boolean;
    const result = uppercase ? message.toUpperCase() : message;
    return this.success(result);
  }
}

/**
 * File tool for testing categories
 */
class FileTool extends BaseTool {
  readonly name = 'file_reader';
  readonly description = 'Reads files';

  protected category = 'file_read' as const;
  protected keywords = ['file', 'read'];
  protected priority = 10;

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      path: {
        type: 'string',
        description: 'File path',
        required: true,
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.success(`Read file: ${input.path}`);
  }
}

/**
 * Tool that can be disabled
 */
class DisableableTool extends BaseTool {
  readonly name = 'disableable';
  readonly description = 'Can be disabled';
  private _available = true;

  setAvailable(available: boolean): void {
    this._available = available;
  }

  isAvailable(): boolean {
    return this._available;
  }

  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
    return this.success('executed');
  }
}

/**
 * Tool that throws errors
 */
class ErrorTool extends BaseTool {
  readonly name = 'error_tool';
  readonly description = 'Always throws';

  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
    throw new Error('Tool error');
  }
}

/**
 * Raw ITool implementation (not using BaseTool)
 */
class RawTool implements ITool {
  readonly name = 'raw_tool';
  readonly description = 'Raw ITool implementation';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return { success: true, output: `raw: ${input.data}` };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Data input' },
        },
        required: ['data'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object') {
      return { valid: false, errors: ['Input must be object'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility',
      keywords: ['raw'],
      priority: 1,
    };
  }
}

// ============================================================================
// FormalToolRegistry Tests
// ============================================================================

describe('FormalToolRegistry', () => {
  let registry: FormalToolRegistry;

  beforeEach(() => {
    // Use test registry to avoid singleton issues
    registry = createTestToolRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('singleton', () => {
    it('should return same instance with getInstance', () => {
      const instance1 = FormalToolRegistry.getInstance();
      const instance2 = FormalToolRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton with reset()', () => {
      const instance1 = FormalToolRegistry.getInstance();
      FormalToolRegistry.reset();
      const instance2 = FormalToolRegistry.getInstance();
      expect(instance1).not.toBe(instance2);
    });

    it('should return singleton with getFormalToolRegistry helper', () => {
      const instance = getFormalToolRegistry();
      expect(instance).toBe(FormalToolRegistry.getInstance());
    });
  });

  describe('registration', () => {
    it('should register a tool', () => {
      const tool = new EchoTool();
      registry.register(tool);
      expect(registry.has('echo')).toBe(true);
    });

    it('should throw when registering duplicate without override', () => {
      const tool = new EchoTool();
      registry.register(tool);
      expect(() => registry.register(tool)).toThrow('already registered');
    });

    it('should allow override with option', () => {
      const tool1 = new EchoTool();
      const tool2 = new EchoTool();
      registry.register(tool1);
      registry.register(tool2, { override: true });
      expect(registry.has('echo')).toBe(true);
    });

    it('should unregister a tool', () => {
      const tool = new EchoTool();
      registry.register(tool);
      const result = registry.unregister('echo');
      expect(result).toBe(true);
      expect(registry.has('echo')).toBe(false);
    });

    it('should return false when unregistering non-existent', () => {
      const result = registry.unregister('nonexistent');
      expect(result).toBe(false);
    });

    it('should register raw ITool implementation', () => {
      const tool = new RawTool();
      registry.register(tool);
      expect(registry.has('raw_tool')).toBe(true);
    });
  });

  describe('retrieval', () => {
    beforeEach(() => {
      registry.register(new EchoTool());
      registry.register(new FileTool());
    });

    it('should get tool by name', () => {
      const entry = registry.get('echo');
      expect(entry).toBeDefined();
      expect(entry!.tool.name).toBe('echo');
    });

    it('should return undefined for non-existent', () => {
      const entry = registry.get('nonexistent');
      expect(entry).toBeUndefined();
    });

    it('should return all tool names', () => {
      const names = registry.getNames();
      expect(names).toContain('echo');
      expect(names).toContain('file_reader');
    });

    it('should return all registered tools', () => {
      const tools = registry.getAll();
      expect(tools.length).toBe(2);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      registry.register(new EchoTool());
      registry.register(new FileTool());
      const disableable = new DisableableTool();
      disableable.setAvailable(false);
      registry.register(disableable);
    });

    it('should filter by category', () => {
      const results = registry.query({ category: 'file_read' });
      expect(results.length).toBe(1);
      expect(results[0].tool.name).toBe('file_reader');
    });

    it('should filter by enabled only', () => {
      const results = registry.query({ enabledOnly: true });
      expect(results.length).toBe(2); // disableable is disabled
    });

    it('should filter by keywords', () => {
      const results = registry.query({ keywords: ['file'] });
      expect(results.length).toBe(1);
      expect(results[0].tool.name).toBe('file_reader');
    });

    it('should filter by minimum priority', () => {
      const results = registry.query({ minPriority: 6 });
      expect(results.length).toBe(1);
      expect(results[0].tool.name).toBe('file_reader');
    });

    it('should limit results', () => {
      const results = registry.query({ limit: 1 });
      expect(results.length).toBe(1);
    });

    it('should sort by priority descending', () => {
      const results = registry.query({});
      expect(results[0].tool.name).toBe('file_reader'); // priority 10
      expect(results[1].tool.name).toBe('echo'); // priority 5
    });
  });

  describe('schemas', () => {
    beforeEach(() => {
      registry.register(new EchoTool());
      registry.register(new FileTool());
    });

    it('should get schemas for enabled tools', () => {
      const schemas = registry.getSchemas();
      expect(schemas.length).toBe(2);
      expect(schemas.map(s => s.name)).toContain('echo');
    });

    it('should filter schemas by query options', () => {
      const schemas = registry.getSchemas({ category: 'file_read' });
      expect(schemas.length).toBe(1);
      expect(schemas[0].name).toBe('file_reader');
    });
  });

  describe('execution', () => {
    beforeEach(() => {
      registry.register(new EchoTool());
      registry.register(new ErrorTool());
      const disableable = new DisableableTool();
      disableable.setAvailable(false);
      registry.register(disableable);
    });

    it('should execute tool successfully', async () => {
      const result = await registry.execute('echo', { message: 'hello' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello');
      expect(result.toolName).toBe('echo');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should fail for non-existent tool', async () => {
      const result = await registry.execute('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail for disabled tool', async () => {
      const result = await registry.execute('disableable', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should fail validation errors', async () => {
      const result = await registry.execute('echo', {}); // missing message
      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('should catch execution errors', async () => {
      const result = await registry.execute('error_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool error');
    });

    it('should include context in result', async () => {
      const context = { cwd: '/test', sessionId: 'test-123' };
      const result = await registry.execute('echo', { message: 'hi' }, context);
      expect(result.context).toEqual(context);
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      registry.register(new EchoTool());
      registry.register(new FileTool());
    });

    it('should track total tools', () => {
      const stats = registry.getStats();
      expect(stats.totalTools).toBe(2);
      expect(stats.enabledTools).toBe(2);
    });

    it('should track by category', () => {
      const stats = registry.getStats();
      expect(stats.byCategory.utility).toBe(1);
      expect(stats.byCategory.file_read).toBe(1);
    });

    it('should track executions', async () => {
      await registry.execute('echo', { message: 'test' });
      await registry.execute('echo', { message: 'test2' });
      const stats = registry.getStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.averageExecutionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('events', () => {
    it('should emit tool:registered event', (done) => {
      const tool = new EchoTool();
      registry.on('tool:registered', (data) => {
        expect(data.name).toBe('echo');
        expect(data.tool).toBe(tool);
        done();
      });
      registry.register(tool);
    });

    it('should emit tool:unregistered event', (done) => {
      const tool = new EchoTool();
      registry.register(tool);
      registry.on('tool:unregistered', (data) => {
        expect(data.name).toBe('echo');
        done();
      });
      registry.unregister('echo');
    });

    it('should emit tool:executed event', (done) => {
      registry.register(new EchoTool());
      registry.on('tool:executed', (result) => {
        expect(result.toolName).toBe('echo');
        expect(result.success).toBe(true);
        done();
      });
      registry.execute('echo', { message: 'test' });
    });

    it('should emit tool:error event on failure', (done) => {
      registry.on('tool:error', (data) => {
        expect(data.name).toBe('nonexistent');
        expect(data.error).toBeDefined();
        done();
      });
      registry.execute('nonexistent', {});
    });
  });

  describe('clear', () => {
    it('should clear all tools', () => {
      registry.register(new EchoTool());
      registry.register(new FileTool());
      registry.clear();
      expect(registry.getAll().length).toBe(0);
    });

    it('should reset statistics on clear', async () => {
      registry.register(new EchoTool());
      await registry.execute('echo', { message: 'test' });
      registry.clear();
      const stats = registry.getStats();
      expect(stats.totalExecutions).toBe(0);
    });
  });
});

// ============================================================================
// BaseTool Tests
// ============================================================================

describe('BaseTool', () => {
  describe('schema generation', () => {
    it('should generate valid schema', () => {
      const tool = new EchoTool();
      const schema = tool.getSchema();
      expect(schema.name).toBe('echo');
      expect(schema.description).toBe('Echoes input back');
      expect(schema.parameters.type).toBe('object');
    });

    it('should include required parameters', () => {
      const tool = new EchoTool();
      const schema = tool.getSchema();
      expect(schema.parameters.required).toContain('message');
      expect(schema.parameters.required).not.toContain('uppercase');
    });

    it('should include parameter properties', () => {
      const tool = new EchoTool();
      const schema = tool.getSchema();
      const props = schema.parameters.properties!;
      expect(props.message.type).toBe('string');
      expect(props.uppercase.type).toBe('boolean');
      expect(props.uppercase.default).toBe(false);
    });
  });

  describe('validation', () => {
    it('should pass valid input', () => {
      const tool = new EchoTool();
      const result = tool.validate({ message: 'hello' });
      expect(result.valid).toBe(true);
    });

    it('should fail missing required', () => {
      const tool = new EchoTool();
      const result = tool.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required parameter: message');
    });

    it('should fail wrong type', () => {
      const tool = new EchoTool();
      const result = tool.validate({ message: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Invalid type');
    });

    it('should fail non-object input', () => {
      const tool = new EchoTool();
      const result = tool.validate('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Input must be an object');
    });
  });

  describe('metadata', () => {
    it('should return tool metadata', () => {
      const tool = new EchoTool();
      const metadata = tool.getMetadata();
      expect(metadata.name).toBe('echo');
      expect(metadata.category).toBe('utility');
      expect(metadata.keywords).toContain('echo');
      expect(metadata.priority).toBe(5);
    });
  });

  describe('helpers', () => {
    it('should create success result', async () => {
      const tool = new EchoTool();
      const result = await tool.execute({ message: 'test' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('test');
    });

    it('should handle uppercase option', async () => {
      const tool = new EchoTool();
      const result = await tool.execute({ message: 'test', uppercase: true });
      expect(result.output).toBe('TEST');
    });
  });

  describe('availability', () => {
    it('should return true by default', () => {
      const tool = new EchoTool();
      expect(tool.isAvailable()).toBe(true);
    });

    it('should respect custom isAvailable', () => {
      const tool = new DisableableTool();
      expect(tool.isAvailable()).toBe(true);
      tool.setAvailable(false);
      expect(tool.isAvailable()).toBe(false);
    });
  });
});
