import { describe, it, expect, vi } from 'vitest';
import {
  generateToolDeclarations,
  resolveScopedToolCatalog,
  runCodeExecPreflight,
  jsonSchemaPropertyToTs,
  extractToolArgsType,
} from '../../src/tools/code-exec-preflight.js';
import {
  CodeExecTool,
  attachCodeExecRuntime,
  type CodeExecRuntime,
  type ToolCatalogEntry,
} from '../../src/tools/code-exec-tool.js';
import { CODE_EXEC_TOOL } from '../../src/codebuddy/tool-definitions/code-exec-tools.js';
import { executePreflightCompilation } from '../../src/tools/code-exec-preflight-runner.js';

describe('code_exec TypeScript preflight', () => {
  const sampleCatalog: ToolCatalogEntry[] = [
    {
      name: 'read_file',
      description: 'Read file contents from disk',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          encoding: { type: 'string', enum: ['utf8', 'binary'], description: 'Encoding' },
        },
        required: ['path'],
      },
    },
    {
      name: 'optional_tool',
      description: 'Tool with all-optional arguments',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', description: 'Output format' },
          verbose: { type: 'boolean', description: 'Verbose flag' },
        },
      },
    },
    {
      name: 'custom.dot-tool',
      description: 'Tool with special characters in canonical name',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Iteration count' },
        },
        required: ['count'],
      },
    },
    {
      name: 'nested_tool',
      description: 'Tool with nested object parameters and JSON Schema required[]',
      parameters: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Target host' },
              retries: { type: 'number', description: 'Max retries' },
            },
            required: ['target'],
          },
        },
        required: ['config'],
      },
    },
    {
      name: 'unspecified_schema_tool',
      description: 'Tool without explicit property schemas',
      parameters: {
        type: 'object',
      },
    },
  ];

  describe('declaration generation & schema translation', () => {
    it('generates accurate TypeScript declarations with JSON Schema required[] arrays', () => {
      const dts = generateToolDeclarations(sampleCatalog);

      // Direct methods
      expect(dts).toContain('read_file(args: Args_read_file_1): Promise<ToolResult>;');
      expect(dts).toContain('optional_tool(args?: Args_optional_tool_2): Promise<ToolResult>;');
      expect(dts).toContain('custom_dot_tool(args: Args_custom_dot_tool_3): Promise<ToolResult>;');
      expect(dts).toContain('nested_tool(args: Args_nested_tool_4): Promise<ToolResult>;');
      expect(dts).toContain('unspecified_schema_tool(args?: Args_unspecified_schema_tool_5): Promise<ToolResult>;');

      // Canonical call overloads
      expect(dts).toContain('call(name: "read_file", args: Args_read_file_1): Promise<ToolResult>;');
      expect(dts).toContain('call(name: "optional_tool", args?: Args_optional_tool_2): Promise<ToolResult>;');
      expect(dts).toContain('call(name: "custom.dot-tool", args: Args_custom_dot_tool_3): Promise<ToolResult>;');
      expect(dts).toContain('call(name: "nested_tool", args: Args_nested_tool_4): Promise<ToolResult>;');

      // Types & properties
      expect(dts).toContain('path: string;');
      expect(dts).toContain('encoding?: "utf8" | "binary";');
      expect(dts).toContain('format?: string;');
      expect(dts).toContain('verbose?: boolean;');
      expect(dts).toContain('count: number;');

      // Nested schema translation
      expect(dts).toContain('target: string;');
      expect(dts).toContain('retries?: number;');

      // Environment helpers
      expect(dts).toContain('function text(content: unknown): void;');
      expect(dts).toContain('function store(key: string, value: unknown): void;');
      expect(dts).toContain('function load<T = unknown>(key: string): T | undefined;');
      expect(dts).toContain('function yield_control(): Promise<void>;');
      expect(dts).toContain('const ALL_TOOLS: ReadonlyArray<ToolMetadataEntry>;');
      expect(dts).toContain('const ALL_TOOL_NAMES: ReadonlyArray<string>;');
    });

    it('handles nested objects with required arrays in jsonSchemaPropertyToTs', () => {
      const nestedSchema = {
        type: 'object',
        properties: {
          user: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['user'],
      };
      const tsType = jsonSchemaPropertyToTs(nestedSchema);
      expect(tsType).toContain('user: string;');
      expect(tsType).toContain('age?: number;');
    });

    it('does not interpret missing or empty schemas as rigid certainty', () => {
      const argsInfo = extractToolArgsType('empty_tool', {}, 1);
      expect(argsInfo.hasRequiredProps).toBe(false);
      expect(argsInfo.typeDeclaration).toContain('Record<string, any>');

      const nullInfo = extractToolArgsType('null_tool', null, 2);
      expect(nullInfo.hasRequiredProps).toBe(false);
      expect(nullInfo.typeDeclaration).toContain('Record<string, any>');
    });

    it('strictly isolates declarations to scoped tools without exposing hidden tools', () => {
      const scoped = sampleCatalog.filter((t) => t.name === 'read_file');
      const dts = generateToolDeclarations(scoped);

      expect(dts).toContain('read_file');
      expect(dts).not.toContain('optional_tool');
      expect(dts).not.toContain('custom.dot-tool');
      expect(dts).not.toContain('bash');
    });

    it('resolves tool catalog strictly filtered to availableTools', () => {
      const runtime: CodeExecRuntime = {
        scopeId: 'scope-res-test',
        availableTools: ['read_file', 'custom.dot-tool'],
        toolCatalog: sampleCatalog,
        executor: vi.fn(),
      };
      const entries = resolveScopedToolCatalog(runtime);
      expect(entries.map((e) => e.name)).toEqual(['read_file', 'custom.dot-tool']);
      expect(entries.find((e) => e.name === 'optional_tool')).toBeUndefined();
    });
  });

  describe('runCodeExecPreflight worker isolation', () => {
    const mockRuntime: CodeExecRuntime = {
      scopeId: 'test-preflight-scope',
      availableTools: ['read_file', 'optional_tool', 'custom.dot-tool', 'nested_tool', 'unspecified_schema_tool'],
      toolCatalog: sampleCatalog,
      executor: vi.fn(),
    };

    it('passes for valid direct tool calls with required arguments', async () => {
      const code = `
        const res = await tools.read_file({ path: "test.txt" });
        text(res.output);
      `;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
      expect(result.transpiledCode).toBeDefined();
    });

    it('passes for valid tool calls with optional arguments included', async () => {
      const code = `
        const res = await tools.read_file({ path: "test.txt", encoding: "utf8" });
        text(res.output);
      `;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('passes for optional-arg tool called with or without arguments', async () => {
      const codeWithoutArgs = `await tools.optional_tool();`;
      const resultWithoutArgs = await runCodeExecPreflight(codeWithoutArgs, mockRuntime);
      expect(resultWithoutArgs.success).toBe(true);

      const codeWithArgs = `await tools.optional_tool({ format: "json", verbose: true });`;
      const resultWithArgs = await runCodeExecPreflight(codeWithArgs, mockRuntime);
      expect(resultWithArgs.success).toBe(true);
    });

    it('passes for canonical tools.call with valid arguments', async () => {
      const code = `
        const r1 = await tools.call("read_file", { path: "hello.txt" });
        const r2 = await tools.call("optional_tool");
        const r3 = await tools.call("custom.dot-tool", { count: 5 });
        text(r1.success && r2.success && r3.success);
      `;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('supports TypeScript type annotations and transpiles successfully', async () => {
      const code = `
        interface CustomData { id: number; label: string; }
        const item: CustomData = { id: 1, label: "sample" };
        const res = await tools.read_file({ path: item.label });
        text(res.output);
      `;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(true);
      expect(result.transpiledCode).toBeDefined();
      expect(result.transpiledCode).not.toContain('interface CustomData');
    });

    it('fails when a required argument is missing', async () => {
      const code = `await tools.read_file({});`;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.error).toContain('path');
    });

    it('fails when an argument has the wrong type', async () => {
      const code = `await tools.read_file({ path: 12345 });`;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.error).toContain("Type 'number' is not assignable to type 'string'");
    });

    it('fails when an invalid enum value is supplied', async () => {
      const code = `await tools.read_file({ path: "ok.txt", encoding: "invalid-encoding" });`;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('fails when attempting to call a hidden tool directly', async () => {
      const code = `await tools.hidden_danger_tool({ key: "secret" });`;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.error).toContain("Property 'hidden_danger_tool' does not exist on type 'Tools'");
    });

    it('fails when attempting to call a hidden tool canonically via tools.call', async () => {
      const code = `await tools.call("hidden_danger_tool", {});`;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.error).toContain('hidden_danger_tool');
    });

    it('fails on syntax errors in guest code', async () => {
      const code = `const a = ;`;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('fails on guest import statements without reading disk', async () => {
      const code = `import fs from 'node:fs'; text(fs);`;
      const result = await runCodeExecPreflight(code, mockRuntime);
      expect(result.success).toBe(false);
      expect(result.error).toContain('imports are not allowed');
    });

    it('fails on triple-slash reference directives and module declarations', async () => {
      const codeRef = `/// <reference path="secret.ts" />\ntext(1);`;
      const resRef = await runCodeExecPreflight(codeRef, mockRuntime);
      expect(resRef.success).toBe(false);
      expect(resRef.error).toContain('reference directives are not allowed');

      const codeMod = `declare module "foo" { export const x = 1; }\ntext(1);`;
      const resMod = await runCodeExecPreflight(codeMod, mockRuntime);
      expect(resMod.success).toBe(false);
      expect(resMod.error).toContain('module declarations are not allowed');
    });
  });

  describe('diagnostic bounding & compiler/global diagnostic handling', () => {
    it('bounds emitted diagnostics to at most 20 entries and caps error size to 16KB', () => {
      // Create code with 30 distinct syntax/type errors
      const errorLines = Array.from({ length: 30 }, (_, i) => `const err_${i}: number = "string_${i}";`).join('\n');
      const declarations = generateToolDeclarations([]);

      const result = executePreflightCompilation({
        code: errorLines,
        declarations,
      });

      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeLessThanOrEqual(20);
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeLessThanOrEqual(16 * 1024);
      expect(result.error).toContain('errors shown');
      expect(result.error).toContain('truncated');
    });

    it('rejects environment and global compiler errors too', () => {
      // Pass a broken declaration with syntax error
      const brokenDeclarations = 'export interface Tools { invalid syntax broken;;;;';
      const result = executePreflightCompilation({
        code: 'text(1);',
        declarations: brokenDeclarations,
      });

      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.error).toContain('[Environment');
    });
  });

  describe('cancellation and deadline isolation', () => {
    const mockRuntime: CodeExecRuntime = {
      scopeId: 'test-cancel-scope',
      availableTools: ['read_file'],
      toolCatalog: sampleCatalog,
      executor: vi.fn(),
    };

    it('cancels preflight immediately when AbortSignal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await runCodeExecPreflight('text(1);', mockRuntime, undefined, {
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });

    it('cancels preflight when AbortSignal fires during execution', async () => {
      const controller = new AbortController();
      const promise = runCodeExecPreflight('text(1);', mockRuntime, undefined, {
        signal: controller.signal,
      });
      controller.abort();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });
  });

  describe('CodeExecTool integration with typecheck', () => {
    it('executes valid code with typecheck: true and dispatches tools', async () => {
      const executorMock = vi.fn(async (name: string, args: Record<string, unknown>) => ({
        success: true,
        output: `Executed ${name} with path=${args.path}`,
      }));

      const tool = new CodeExecTool();
      const context = attachCodeExecRuntime(
        { cwd: process.cwd(), sessionId: 'test-session-1' },
        {
          scopeId: 'test-scope-1',
          availableTools: ['read_file'],
          toolCatalog: sampleCatalog,
          executor: executorMock,
        },
      );

      const res = await tool.execute(
        {
          code: `
            const r = await tools.read_file({ path: "report.md" });
            text(r.output);
          `,
          typecheck: true,
        },
        context,
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain('Executed read_file with path=report.md');
      expect(executorMock).toHaveBeenCalledTimes(1);
      expect(executorMock).toHaveBeenCalledWith('read_file', { path: 'report.md' }, expect.anything());
    });

    it('executes valid code using canonical tools.call with typecheck: true', async () => {
      const executorMock = vi.fn(async (name: string, args: Record<string, unknown>) => ({
        success: true,
        output: `Canonical ${name}: ${JSON.stringify(args)}`,
      }));

      const tool = new CodeExecTool();
      const context = attachCodeExecRuntime(
        { cwd: process.cwd(), sessionId: 'test-session-2' },
        {
          scopeId: 'test-scope-2',
          availableTools: ['custom.dot-tool'],
          toolCatalog: sampleCatalog,
          executor: executorMock,
        },
      );

      const res = await tool.execute(
        {
          code: `
            const r = await tools.call("custom.dot-tool", { count: 42 });
            text(r.output);
          `,
          typecheck: true,
        },
        context,
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain('Canonical custom.dot-tool: {"count":42}');
      expect(executorMock).toHaveBeenCalledWith('custom.dot-tool', { count: 42 }, expect.anything());
    });

    it('rejects invalid arguments and NEVER dispatches executor when typecheck: true', async () => {
      const executorMock = vi.fn(async () => ({ success: true, output: 'should not run' }));

      const tool = new CodeExecTool();
      const context = attachCodeExecRuntime(
        { cwd: process.cwd(), sessionId: 'test-session-3' },
        {
          scopeId: 'test-scope-3',
          availableTools: ['read_file'],
          toolCatalog: sampleCatalog,
          executor: executorMock,
        },
      );

      const res = await tool.execute(
        {
          code: `
            // Missing required 'path' property
            await tools.read_file({});
          `,
          typecheck: true,
        },
        context,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('TypeScript preflight validation failed');
      expect(res.error).toContain('path');
      // Invariant: no side effects, zero executor calls
      expect(executorMock).not.toHaveBeenCalled();
    });

    it('rejects hidden tools and NEVER dispatches executor when typecheck: true', async () => {
      const executorMock = vi.fn(async () => ({ success: true, output: 'should not run' }));

      const tool = new CodeExecTool();
      const context = attachCodeExecRuntime(
        { cwd: process.cwd(), sessionId: 'test-session-4' },
        {
          scopeId: 'test-scope-4',
          availableTools: ['read_file'], // only read_file is available
          toolCatalog: sampleCatalog,
          executor: executorMock,
        },
      );

      const res = await tool.execute(
        {
          code: `
            await tools.call("hidden_admin_tool", {});
          `,
          typecheck: true,
        },
        context,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('TypeScript preflight validation failed');
      expect(executorMock).not.toHaveBeenCalled();
    });

    it('cancels execution before dispatch when abort signal is active', async () => {
      const executorMock = vi.fn(async () => ({ success: true }));
      const controller = new AbortController();
      controller.abort();

      const tool = new CodeExecTool();
      const context = attachCodeExecRuntime(
        { cwd: process.cwd(), sessionId: 'test-session-abort', abortSignal: controller.signal },
        {
          scopeId: 'test-scope-abort',
          availableTools: ['read_file'],
          toolCatalog: sampleCatalog,
          executor: executorMock,
          abortSignal: controller.signal,
        },
      );

      const res = await tool.execute(
        {
          code: 'await tools.read_file({ path: "file.txt" });',
          typecheck: true,
        },
        context,
      );

      expect(res.success).toBe(false);
      expect(executorMock).not.toHaveBeenCalled();
    });

    it('runs TypeScript annotated code through transpiler when typecheck: true', async () => {
      const tool = new CodeExecTool();
      const context = attachCodeExecRuntime(
        { cwd: process.cwd(), sessionId: 'test-session-5' },
        {
          scopeId: 'test-scope-5',
          availableTools: [],
          toolCatalog: [],
          executor: vi.fn(),
        },
      );

      const res = await tool.execute(
        {
          code: `
            type Greeting = string;
            const greet: Greeting = "Hello from TypeScript preflight!";
            text(greet);
          `,
          typecheck: true,
        },
        context,
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain('Hello from TypeScript preflight!');
    });

    it('defaults typecheck to false, preserving runtime behavior with zero preflight overhead', async () => {
      const executorMock = vi.fn(async (name: string, args: Record<string, unknown>) => ({
        success: true,
        output: `legacy:${name}:${JSON.stringify(args)}`,
      }));

      const tool = new CodeExecTool();
      const context = attachCodeExecRuntime(
        { cwd: process.cwd(), sessionId: 'test-session-6' },
        {
          scopeId: 'test-scope-6',
          availableTools: ['read_file'],
          toolCatalog: sampleCatalog,
          executor: executorMock,
        },
      );

      // Without typecheck: true, preflight is skipped completely
      const res = await tool.execute(
        {
          code: `
            const r = await tools.read_file({ path: "default.txt" });
            text(r.output);
          `,
        },
        context,
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain('legacy:read_file:{"path":"default.txt"}');
      expect(executorMock).toHaveBeenCalledTimes(1);
    });

    it('validates typecheck input type', () => {
      const tool = new CodeExecTool();
      expect(tool.validate({ code: 'text(1);', typecheck: true }).valid).toBe(true);
      expect(tool.validate({ code: 'text(1);', typecheck: false }).valid).toBe(true);
      expect(tool.validate({ code: 'text(1);' }).valid).toBe(true);

      const invalid = tool.validate({ code: 'text(1);', typecheck: 'true' as unknown as boolean });
      expect(invalid.valid).toBe(false);
      expect(invalid.errors?.join(' ')).toContain('typecheck');
    });

    it('exposes typecheck in OpenAI tool schema definition conforming to JSON Schema', () => {
      const params = CODE_EXEC_TOOL.function.parameters as {
        type: string;
        properties: Record<string, { type: string }>;
        required: string[];
      };
      expect(params.type).toBe('object');
      expect(params.properties).toHaveProperty('typecheck');
      expect(params.properties.typecheck.type).toBe('boolean');
      expect(Array.isArray(params.required)).toBe(true);
      expect(params.required).toContain('code');
    });
  });
});

it('does not mistake ordinary text or identifiers for module imports', async () => {
  const result = await runCodeExecPreflight('const important = "import data"; text(important);', { scopeId: 'text-only', sessionId: 'text-only', availableTools: [], executor: async () => ({ success: true }) });
  expect(result.success, result.error).toBe(true);
});
