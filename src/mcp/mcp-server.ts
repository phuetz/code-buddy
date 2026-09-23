/**
 * MCP Server - expose Code Buddy's real tool registry over stdio.
 *
 * The registry's `fleetSafe: true` metadata is the default allowlist. Tools
 * without that audited read-only contract are only registered after an
 * explicit `--allow-write` / `CODEBUDDY_MCP_ALLOW_WRITE=1` opt-in.
 *
 * `--allow-write` is not a silent yes. File tools still go through ToolHandler
 * (workspace, protected paths, confirmation). `bash` runs in the workspace
 * sandbox when one exists. If none does, this server refuses the unconfined
 * escalation — even when `CODEBUDDY_AUTO_CONFIRM=true` — because an unconfined
 * shell can write anywhere. Agent tools (`agent_task`, `agent_chat`,
 * `agent_plan`, session tools) construct the real agent with that same write
 * context: its tool handler refuses the unconfined escalation and keeps file
 * writes inside the server workspace, including write destinations named
 * `output_dir` or `outputDir`. `desktop_screenshot` confines `output_path` to
 * that same workspace. `memory_save` and `ckg_ingest` do not: they write the
 * profile memory file and the collective ledger, and the caller cannot choose
 * another path. The interactive agent and headless mode do not enter that
 * frame, so their escalation path is unchanged.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentModelClient } from '../agent/codebuddy-agent.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { initializeToolRegistry } from '../codebuddy/tools.js';
import type { ToolResult } from '../types/index.js';
import { getToolRegistry } from '../tools/registry.js';
import { createInteractiveToolAdapters } from '../tools/registry/interactive-adapters.js';
import { getFormalToolRegistry } from '../tools/registry/tool-registry.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
} from '../tools/registry/types.js';
import { matchAnyGlob } from '../utils/glob-matcher.js';
import { logger } from '../utils/logger.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { createMcpApprovalBridge } from '../server/mcp/approval-elicitation.js';
import { registerAgentTools } from './mcp-agent-tools.js';
import { registerCkgTools } from './mcp-ckg-tools.js';
import {
  desktopControlEnabled,
  registerDesktopTools,
} from './mcp-desktop-tools.js';
import { registerMemoryTools } from './mcp-memory-tools.js';
import { registerPrompts } from './mcp-prompts.js';
import { registerResources } from './mcp-resources.js';
import { registerSessionTools } from './mcp-session-tools.js';
import { runWithRefusedUnconfinedEscalation } from '../tools/bash/unconfined-escalation.js';

const PACKAGE_VERSION_FALLBACK = '0.1.0';
const WRITE_ENV = 'CODEBUDDY_MCP_ALLOW_WRITE';
const TOOLS_ENV = 'CODEBUDDY_MCP_TOOLS';

type JsonSchema = Record<string, unknown>;

/** Tool definition returned to CLI/tests without exposing its executor. */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
}

export interface CodeBuddyMCPServerOptions {
  /** Expose tools lacking the audited fleetSafe contract. */
  allowWrite?: boolean;
  /** One glob, a comma-separated list, or an array of globs. */
  tools?: string | string[];
  /** Working directory passed to every registry tool execution. */
  workingDirectory?: string;
  /**
   * Replaces the network model when this server constructs its agent.
   * The CLI leaves it unset. Tests pass a local fake that never opens a socket.
   * The MCP write context is still applied.
   */
  agentModelClient?: AgentModelClient;
}

export interface MCPToolExposureStats {
  /** Enabled tools with a real executable adapter and an existing schema. */
  registryTotal: number;
  /** Executable tools carrying fleetSafe and no modifiesFiles marker. */
  registryReadOnly: number;
}

export interface MCPExposureSummary extends MCPToolExposureStats {
  mode: 'read-only' | 'read-write';
  exposed: number;
  registryExposed: number;
  supplementalExposed: number;
  patterns: string[];
}

interface RegistryMCPTool {
  definition: MCPToolDefinition;
  adapter: ITool;
  metadata?: IToolMetadata;
}

interface RegistryCatalog {
  tools: RegistryMCPTool[];
  stats: MCPToolExposureStats;
}

function readPackageVersion(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packagePath = path.resolve(currentDir, '../../package.json');
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : PACKAGE_VERSION_FALLBACK;
  } catch {
    return PACKAGE_VERSION_FALLBACK;
  }
}

function envFlagEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function resolveAllowWrite(explicit: boolean | undefined): boolean {
  return explicit ?? envFlagEnabled(process.env[WRITE_ENV]);
}

function splitPatternList(value: string): string[] {
  const patterns: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '{' || character === '[') depth++;
    else if (character === '}' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      patterns.push(value.slice(start, index));
      start = index + 1;
    }
  }
  patterns.push(value.slice(start));
  return patterns;
}

function parseToolPatterns(value: string | string[] | undefined): string[] {
  const source = value === undefined ? process.env[TOOLS_ENV] : value;
  const values = Array.isArray(source) ? source : source ? [source] : [];
  return values
    .flatMap(splitPatternList)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function safeAdapterMetadata(adapter: ITool): IToolMetadata | undefined {
  try {
    return adapter.getMetadata?.();
  } catch {
    return undefined;
  }
}

function adapterIsAvailable(adapter: ITool): boolean {
  try {
    return adapter.isAvailable?.() ?? true;
  } catch {
    return false;
  }
}

function buildRegistryCatalog(
  allowWrite: boolean,
  patterns: string[],
): RegistryCatalog {
  initializeToolRegistry();

  const schemaRegistry = getToolRegistry();
  const adapters = new Map<string, ITool>();

  // Persisted authored tools can already be present in the formal registry.
  for (const registered of getFormalToolRegistry().getAll()) {
    adapters.set(registered.tool.name, registered.tool);
  }
  // Fresh built-in adapters avoid sharing mutable execution state with an
  // unrelated in-process agent while retaining exactly the production surface.
  for (const adapter of createInteractiveToolAdapters()) {
    adapters.set(adapter.name, adapter);
  }

  const candidates: RegistryMCPTool[] = [];
  const seen = new Set<string>();

  for (const tool of schemaRegistry.getAllTools()) {
    const name = tool.function.name;
    if (seen.has(name)) continue;
    seen.add(name);

    const registered = schemaRegistry.getTool(name);
    if (!registered) continue;

    let enabled = false;
    try {
      enabled = registered.isEnabled();
    } catch (error) {
      logger.debug(`MCP skipped tool whose availability check failed: ${name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!enabled) continue;

    const adapter = adapters.get(name);
    if (!adapter) {
      logger.debug(`MCP skipped schema without an executable registry adapter: ${name}`);
      continue;
    }
    if (!adapterIsAvailable(adapter)) continue;

    const adapterMetadata = safeAdapterMetadata(adapter);
    const fleetSafe = registered.metadata.fleetSafe === true;
    const readOnly = fleetSafe && adapterMetadata?.modifiesFiles !== true;

    candidates.push({
      definition: {
        name,
        description: tool.function.description || registered.metadata.description || adapter.description,
        inputSchema: tool.function.parameters as unknown as JsonSchema,
        readOnly,
      },
      adapter,
      metadata: adapterMetadata,
    });
  }

  // Some production adapters (notably apply_patch and canonical aliases) have
  // their schema on ITool#getSchema rather than in the legacy LLM registry.
  // Include those in write-enabled mode without duplicating either source.
  for (const [name, adapter] of adapters) {
    if (seen.has(name) || !adapterIsAvailable(adapter)) continue;

    try {
      const schema = adapter.getSchema();
      const adapterMetadata = safeAdapterMetadata(adapter);
      const readOnly =
        adapterMetadata?.fleetSafe === true && adapterMetadata.modifiesFiles !== true;
      candidates.push({
        definition: {
          name,
          description: schema.description || adapterMetadata?.description || adapter.description,
          inputSchema: schema.parameters as unknown as JsonSchema,
          readOnly,
        },
        adapter,
        metadata: adapterMetadata,
      });
      seen.add(name);
    } catch (error) {
      logger.debug(`MCP skipped adapter whose schema could not be read: ${name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const stats: MCPToolExposureStats = {
    registryTotal: candidates.length,
    registryReadOnly: candidates.filter((candidate) => candidate.definition.readOnly).length,
  };

  const tools = candidates
    .filter((candidate) => allowWrite || candidate.definition.readOnly)
    .filter((candidate) =>
      patterns.length === 0 || matchAnyGlob(candidate.definition.name, patterns),
    )
    .sort((left, right) => left.definition.name.localeCompare(right.definition.name));

  return { tools, stats };
}

function schemaRecord(schema: unknown): JsonSchema {
  return schema && typeof schema === 'object' && !Array.isArray(schema)
    ? schema as JsonSchema
    : {};
}

function literalSchema(value: unknown): z.ZodTypeAny {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return z.literal(value);
  }
  return z.unknown();
}

function unionSchemas(schemas: z.ZodTypeAny[]): z.ZodTypeAny {
  if (schemas.length === 0) return z.never();
  if (schemas.length === 1) return schemas[0]!;
  return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

/**
 * Convert the registry's existing JSON Schema into the Zod schema expected by
 * the MCP SDK. This is a mechanical bridge: descriptions, enums, object
 * shapes, required fields, arrays and common bounds remain sourced from the
 * canonical tool definition rather than being rewritten in this server.
 */
function jsonSchemaToZod(input: unknown): z.ZodTypeAny {
  const schema = schemaRecord(input);

  if ('const' in schema) return literalSchema(schema.const);
  if (Array.isArray(schema.enum)) {
    return unionSchemas(schema.enum.map(literalSchema));
  }

  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const alternatives = schema[keyword];
    if (Array.isArray(alternatives)) {
      return unionSchemas(alternatives.map(jsonSchemaToZod));
    }
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const parts = schema.allOf.map(jsonSchemaToZod);
    let intersection = parts[0]!;
    for (const part of parts.slice(1)) {
      intersection = z.intersection(intersection, part);
    }
    return intersection;
  }

  if (Array.isArray(schema.type)) {
    return unionSchemas(
      schema.type.map((type) => jsonSchemaToZod({ ...schema, type })),
    );
  }

  let result: z.ZodTypeAny;
  switch (schema.type) {
    case 'string': {
      let stringSchema = z.string();
      if (typeof schema.minLength === 'number') stringSchema = stringSchema.min(schema.minLength);
      if (typeof schema.maxLength === 'number') stringSchema = stringSchema.max(schema.maxLength);
      if (typeof schema.pattern === 'string') {
        try {
          stringSchema = stringSchema.regex(new RegExp(schema.pattern));
        } catch {
          // The canonical tool validator remains authoritative for an invalid regex.
        }
      }
      result = stringSchema;
      break;
    }
    case 'integer':
    case 'number': {
      let numberSchema = schema.type === 'integer' ? z.number().int() : z.number();
      if (typeof schema.minimum === 'number') numberSchema = numberSchema.min(schema.minimum);
      if (typeof schema.maximum === 'number') numberSchema = numberSchema.max(schema.maximum);
      result = numberSchema;
      break;
    }
    case 'boolean':
      result = z.boolean();
      break;
    case 'null':
      result = z.null();
      break;
    case 'array': {
      let arraySchema = z.array(jsonSchemaToZod(schema.items));
      if (typeof schema.minItems === 'number') arraySchema = arraySchema.min(schema.minItems);
      if (typeof schema.maxItems === 'number') arraySchema = arraySchema.max(schema.maxItems);
      result = arraySchema;
      break;
    }
    case 'object':
    default: {
      const properties = schemaRecord(schema.properties);
      const required = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter((name): name is string => typeof name === 'string')
          : [],
      );
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [name, property] of Object.entries(properties)) {
        const propertySchema = jsonSchemaToZod(property);
        shape[name] = required.has(name) ? propertySchema : propertySchema.optional();
      }

      let objectSchema: z.AnyZodObject = z.object(shape);
      if (schema.additionalProperties === false) {
        objectSchema = objectSchema.strict();
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object'
      ) {
        objectSchema = objectSchema.catchall(jsonSchemaToZod(schema.additionalProperties));
      } else {
        objectSchema = objectSchema.passthrough();
      }
      result = objectSchema;
      break;
    }
  }

  if (schema.nullable === true) result = result.nullable();
  if (typeof schema.description === 'string') result = result.describe(schema.description);
  return result;
}

function stringifyResultData(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shouldMatchPatterns(name: string, patterns: string[]): boolean {
  return patterns.length === 0 || matchAnyGlob(name, patterns);
}

/** MCP server exposing the live Code Buddy registry. */
export class CodeBuddyMCPServer {
  private readonly mcpServer: McpServer;
  private transport: StdioServerTransport | null = null;
  private running = false;
  private readonly allowWrite: boolean;
  private readonly patterns: string[];
  private readonly workingDirectory: string;
  private readonly agentModelClient: AgentModelClient | undefined;
  private readonly registryCatalog: RegistryCatalog;
  private readonly supplementalToolNames: string[] = [];
  private writeAccessInitialized = false;

  private agent: import('../agent/codebuddy-agent.js').CodeBuddyAgent | null = null;
  private agentInitPromise: Promise<import('../agent/codebuddy-agent.js').CodeBuddyAgent> | null = null;
  private guardedHandler: import('../agent/tool-handler.js').ToolHandler | null = null;
  private guardedHandlerPromise: Promise<import('../agent/tool-handler.js').ToolHandler> | null = null;

  constructor(options: CodeBuddyMCPServerOptions = {}) {
    this.allowWrite = resolveAllowWrite(options.allowWrite);
    this.patterns = parseToolPatterns(options.tools);
    this.workingDirectory = path.resolve(options.workingDirectory ?? process.cwd());
    this.agentModelClient = options.agentModelClient;
    this.registryCatalog = buildRegistryCatalog(this.allowWrite, this.patterns);

    this.mcpServer = new McpServer(
      { name: 'code-buddy', version: readPackageVersion() },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );

    this.registerTools();
    this.registerAgentLayer();
  }

  /** Definitions selected from the real registry for this exposure policy. */
  static getToolDefinitions(
    options: CodeBuddyMCPServerOptions = {},
  ): MCPToolDefinition[] {
    const allowWrite = resolveAllowWrite(options.allowWrite);
    const patterns = parseToolPatterns(options.tools);
    return buildRegistryCatalog(allowWrite, patterns).tools.map(({ definition }) => ({
      ...definition,
      inputSchema: { ...definition.inputSchema },
    }));
  }

  /** Registry-wide counts before `--tools` narrows the exposed surface. */
  static getToolExposureStats(): MCPToolExposureStats {
    return buildRegistryCatalog(true, []).stats;
  }

  getExposedToolDefinitions(): MCPToolDefinition[] {
    return this.registryCatalog.tools.map(({ definition }) => ({
      ...definition,
      inputSchema: { ...definition.inputSchema },
    }));
  }

  getExposedToolNames(): string[] {
    return [
      ...this.registryCatalog.tools.map(({ definition }) => definition.name),
      ...this.supplementalToolNames,
    ];
  }

  getExposureSummary(): MCPExposureSummary {
    return {
      ...this.registryCatalog.stats,
      mode: this.allowWrite ? 'read-write' : 'read-only',
      exposed: this.registryCatalog.tools.length + this.supplementalToolNames.length,
      registryExposed: this.registryCatalog.tools.length,
      supplementalExposed: this.supplementalToolNames.length,
      patterns: [...this.patterns],
    };
  }

  setupApprovalBridge(): void {
    ConfirmationService.getInstance().setMcpApprovalBridge(
      createMcpApprovalBridge(this.mcpServer, { cwd: this.workingDirectory }),
    );
  }

  private async ensureWriteAccess(): Promise<void> {
    if (!this.allowWrite) {
      throw new Error('Write-capable MCP tools require --allow-write');
    }
    if (this.writeAccessInitialized) return;

    this.setupApprovalBridge();
    this.writeAccessInitialized = true;
  }

  /**
   * Write tools must use the same authorization as the agent loop.
   * A full model client is not required: file guards do not call an LLM.
   */
  private async ensureGuardedHandler(): Promise<import('../agent/tool-handler.js').ToolHandler> {
    if (this.guardedHandler) return this.guardedHandler;
    if (this.guardedHandlerPromise) return this.guardedHandlerPromise;

    this.guardedHandlerPromise = (async () => {
      const [
        { ToolHandler },
        { CheckpointManager },
        { HooksManager },
        { PluginMarketplace },
        { RepairCoordinator },
      ] = await Promise.all([
        import('../agent/tool-handler.js'),
        import('../checkpoints/checkpoint-manager.js'),
        import('../hooks/lifecycle-hooks.js'),
        import('../plugins/marketplace.js'),
        import('../agent/execution/repair-coordinator.js'),
      ]);
      const handler = new ToolHandler({
        checkpointManager: new CheckpointManager(),
        hooksManager: new HooksManager(this.workingDirectory),
        marketplace: new PluginMarketplace({ autoUpdate: false }),
        repairCoordinator: new RepairCoordinator({ enabled: false }),
      });
      handler.setWorkingDirectory(this.workingDirectory);
      handler.refuseUnconfinedShellEscalation();
      this.guardedHandler = handler;
      return handler;
    })();

    return this.guardedHandlerPromise;
  }

  private async executeGuardedTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const handler = await this.ensureGuardedHandler();
    return runWithRefusedUnconfinedEscalation(() => handler.executeTool({
      id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    }, { refuseUnconfinedShellEscalation: true }));
  }

  private async ensureAgent(): Promise<import('../agent/codebuddy-agent.js').CodeBuddyAgent> {
    await this.ensureWriteAccess();
    if (this.agent) return this.agent;
    if (this.agentInitPromise) return this.agentInitPromise;

    this.agentInitPromise = (async () => {
      const { resolveActiveProviderApiKey } = await import('../config/env-schema.js');
      const injected = this.agentModelClient;
      const apiKey = injected ? 'local-model' : (resolveActiveProviderApiKey() || '');

      if (!apiKey) {
        throw new Error(
          'No API key found. Set GROK_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.',
        );
      }

      const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
      this.agent = new CodeBuddyAgent(
        injected ? 'local-model' : apiKey,
        process.env.GROK_BASE_URL,
        process.env.GROK_MODEL,
        undefined,
        true,
        undefined,
        this.workingDirectory,
        undefined,
        undefined,
        {
          mcpToolContext: {
            workspaceRoot: this.workingDirectory,
            refuseUnconfinedShellEscalation: true,
          },
          ...(injected ? { modelClient: injected } : {}),
        },
      );
      return this.agent;
    })();

    return this.agentInitPromise;
  }

  private registerAgentLayer(): void {
    // Resources and prompts are read-only protocol surfaces, so they remain
    // available in both modes. Legacy MCP-only tools lack fleetSafe metadata
    // and therefore stay behind the same explicit write-capable opt-in.
    registerResources(this.mcpServer);
    registerPrompts(this.mcpServer);
    if (!this.allowWrite) return;

    const dynamicNames = new Set(
      this.registryCatalog.tools.map(({ definition }) => definition.name),
    );
    const shouldRegister = (name: string): boolean =>
      !dynamicNames.has(name) && shouldMatchPatterns(name, this.patterns);
    const getAgent = () => this.ensureAgent();

    registerAgentTools(this.mcpServer, getAgent, shouldRegister, {
      workspaceRoot: this.workingDirectory,
    });
    registerMemoryTools(this.mcpServer, shouldRegister);
    registerCkgTools(this.mcpServer, shouldRegister);
    registerSessionTools(this.mcpServer, getAgent, shouldRegister);
    registerDesktopTools(this.mcpServer, shouldRegister, this.workingDirectory);

    const candidates = [
      'agent_chat',
      'agent_task',
      'agent_plan',
      'memory_search',
      'memory_save',
      'ckg_recall',
      'ckg_ingest',
      'session_list',
      'session_resume',
      'web_search',
      'desktop_screenshot',
      'desktop_snapshot',
      ...(desktopControlEnabled()
        ? ['desktop_click', 'desktop_type', 'desktop_move_mouse', 'desktop_key']
        : []),
    ];
    this.supplementalToolNames.push(...candidates.filter(shouldRegister));
  }

  private formatResult(
    result: ToolResult,
  ): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
    const text = result.success
      ? result.output ?? result.content ?? stringifyResultData(result.data ?? 'Done')
      : result.error ?? 'Unknown error';
    return {
      content: [{ type: 'text', text }],
      ...(result.success ? {} : { isError: true }),
    };
  }

  private registerTools(): void {
    for (const entry of this.registryCatalog.tools) {
      const { definition, adapter, metadata } = entry;
      this.mcpServer.registerTool(
        definition.name,
        {
          description: definition.description,
          inputSchema: jsonSchemaToZod(definition.inputSchema),
          annotations: {
            readOnlyHint: definition.readOnly,
            destructiveHint: !definition.readOnly,
            idempotentHint: definition.readOnly,
            openWorldHint: metadata?.makesNetworkRequests === true,
          },
        },
        async (rawArgs) => {
          try {
            const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
              ? rawArgs as Record<string, unknown>
              : {};
            const validation = adapter.validate?.(args);
            if (validation && !validation.valid) {
              return this.formatResult({
                success: false,
                error: `Validation failed: ${validation.errors?.join(', ') || 'invalid arguments'}`,
              });
            }

            // Read-only tools stay on the direct adapter path. Write tools keep
            // the explicit --allow-write check, then the agent ToolHandler
            // (workspace trust, protected paths, confirmation). A non-interactive
            // MCP client is refused unless an explicit policy already allows it.
            if (!definition.readOnly) {
              await this.ensureWriteAccess();
              return this.formatResult(await this.executeGuardedTool(definition.name, args));
            }

            const context: IToolExecutionContext = { cwd: this.workingDirectory };
            return this.formatResult(await adapter.execute(args, context));
          } catch (error) {
            return this.formatResult({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    }
  }

  /** Attach an already-built transport. Used by stdio start and in-process tests. */
  async connect(transport: Transport): Promise<void> {
    if (this.running) throw new Error('MCP server is already running');
    this.setupApprovalBridge();
    await this.mcpServer.connect(transport);
    this.running = true;
  }

  async start(): Promise<void> {
    if (this.running) throw new Error('MCP server is already running');
    this.transport = new StdioServerTransport();
    await this.connect(this.transport);
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    ConfirmationService.getInstance().setMcpApprovalBridge(null);

    if (this.agent) {
      try {
        this.agent.dispose();
      } catch {
        // Best-effort shutdown: the transport must still be closed.
      }
      this.agent = null;
      this.agentInitPromise = null;
    }
    this.guardedHandler = null;
    this.guardedHandlerPromise = null;

    await this.mcpServer.close();
    this.transport = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
