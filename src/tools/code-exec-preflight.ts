/**
 * TypeScript preflight validation for Code Mode (`code_exec`).
 *
 * Runs isolated TypeScript typechecking in a sandboxed worker/child process
 * against declarations derived exclusively from the runtime-scoped tool catalog.
 *
 * Invariants:
 * 1. Hard 5s deadline + 128MB heap isolation in a separate worker/child process.
 * 2. Lazy loading: TypeScript is NOT imported in the parent process or when typecheck is false.
 * 3. Bounded diagnostics: limited to 20 diagnostics and 16KB total formatted output.
 * 4. Zero guest filesystem access: virtual files only in-memory; no guest file reads/writes.
 * 5. No hidden tool/import exposure: declarations are generated strictly from `availableTools`.
 * 6. Fail-closed: invalid code or compiler/global errors are rejected before child process spawn or tool dispatch.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IToolExecutionContext } from './registry/types.js';
import {
  type CodeExecRuntime,
  type ToolCatalogEntry,
  type ToolBinding,
  buildToolBindings,
  sanitizeToolName,
  CODE_EXEC_LIMITS,
} from './code-exec-tool.js';
import { FormalToolRegistry } from './registry/tool-registry.js';
import { ToolRegistry } from './registry.js';
import type { PreflightDiagnostic, PreflightWorkerResult } from './code-exec-preflight-runner.js';

const PREFLIGHT_LIMITS = { timeoutMs: 5000, maxHeapMb: 128 } as const;

export type { PreflightDiagnostic, PreflightWorkerResult as PreflightResult };

export interface PreflightOptions {
  target?: string;
  strict?: boolean;
  catalog?: readonly ToolCatalogEntry[];
  signal?: AbortSignal;
}

function sanitizeJsDoc(text?: string): string {
  if (!text) return '';
  return text.replace(/\*\//g, '* /');
}

function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

function formatPropKey(name: string): string {
  return isValidIdentifier(name) ? name : JSON.stringify(name);
}

export function jsonSchemaPropertyToTs(prop: unknown, indent = '  '): string {
  if (!prop || typeof prop !== 'object') {
    return 'any';
  }

  const p = prop as Record<string, unknown>;

  if (Array.isArray(p.enum) && p.enum.length > 0) {
    return p.enum
      .map((item) => (typeof item === 'string' ? JSON.stringify(item) : String(item)))
      .join(' | ');
  }

  if (Array.isArray(p.oneOf) && p.oneOf.length > 0) {
    return p.oneOf.map((sub) => jsonSchemaPropertyToTs(sub, indent)).join(' | ');
  }
  if (Array.isArray(p.anyOf) && p.anyOf.length > 0) {
    return p.anyOf.map((sub) => jsonSchemaPropertyToTs(sub, indent)).join(' | ');
  }

  const type = p.type;

  if (Array.isArray(type)) {
    return type.map((t) => jsonSchemaPropertyToTs({ ...p, type: t }, indent)).join(' | ');
  }

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const items = p.items ? jsonSchemaPropertyToTs(p.items, indent) : 'any';
      return `Array<${items}>`;
    }
    case 'object': {
      const properties = p.properties as Record<string, unknown> | undefined;
      if (properties && typeof properties === 'object' && Object.keys(properties).length > 0) {
        const requiredList = Array.isArray(p.required) ? (p.required as string[]) : [];
        const lines: string[] = ['{'];
        const nextIndent = indent + '  ';
        for (const [key, propDef] of Object.entries(properties)) {
          const isReq =
            requiredList.includes(key) ||
            (propDef && typeof propDef === 'object' && (propDef as Record<string, unknown>).required === true);
          const propDesc =
            propDef && typeof propDef === 'object'
              ? (propDef as Record<string, unknown>).description
              : undefined;
          if (typeof propDesc === 'string' && propDesc) {
            lines.push(`${nextIndent}/** ${sanitizeJsDoc(propDesc)} */`);
          }
          const opt = isReq ? '' : '?';
          const typeStr = jsonSchemaPropertyToTs(propDef, nextIndent);
          lines.push(`${nextIndent}${formatPropKey(key)}${opt}: ${typeStr};`);
        }
        if (p.additionalProperties !== false) {
          lines.push(`${nextIndent}[key: string]: any;`);
        }
        lines.push(`${indent}}`);
        return lines.join('\n');
      }
      return 'Record<string, any>';
    }
    default:
      return 'any';
  }
}

interface ExtractedArgsType {
  typeName: string;
  typeDeclaration: string;
  hasRequiredProps: boolean;
}

export function extractToolArgsType(toolName: string, parameters: unknown, typeIndex: number): ExtractedArgsType {
  const typeName = `Args_${sanitizeToolName(toolName)}_${typeIndex}`;
  if (!parameters || typeof parameters !== 'object') {
    return {
      typeName,
      typeDeclaration: `export type ${typeName} = Record<string, any>;`,
      hasRequiredProps: false,
    };
  }

  const params = parameters as Record<string, unknown>;
  let properties = params.properties as Record<string, unknown> | undefined;
  let requiredList = Array.isArray(params.required) ? (params.required as string[]) : [];

  // Formal parameter definition dictionary (e.g. BaseTool getParameters format)
  if (!properties && !params.type && Object.keys(params).length > 0) {
    const firstVal = Object.values(params)[0];
    if (firstVal && typeof firstVal === 'object' && ('type' in firstVal || 'description' in firstVal)) {
      properties = params;
      requiredList = Object.entries(params)
        .filter(([, v]) => v && typeof v === 'object' && (v as Record<string, unknown>).required === true)
        .map(([k]) => k);
    }
  }

  if (!properties || Object.keys(properties).length === 0) {
    return {
      typeName,
      typeDeclaration: `export type ${typeName} = Record<string, any>;`,
      hasRequiredProps: false,
    };
  }

  let hasRequired = false;
  const lines: string[] = [`export interface ${typeName} {`];
  for (const [key, propDef] of Object.entries(properties)) {
    const isReq =
      requiredList.includes(key) ||
      (propDef && typeof propDef === 'object' && (propDef as Record<string, unknown>).required === true);
    if (isReq) hasRequired = true;

    const propDesc =
      propDef && typeof propDef === 'object'
        ? (propDef as Record<string, unknown>).description
        : undefined;
    if (typeof propDesc === 'string' && propDesc) {
      lines.push(`  /** ${sanitizeJsDoc(propDesc)} */`);
    }
    const opt = isReq ? '' : '?';
    const typeStr = jsonSchemaPropertyToTs(propDef, '  ');
    lines.push(`  ${formatPropKey(key)}${opt}: ${typeStr};`);
  }

  if (params.additionalProperties !== false) {
    lines.push('  [key: string]: any;');
  }

  lines.push('}');

  return {
    typeName,
    typeDeclaration: lines.join('\n'),
    hasRequiredProps: hasRequired,
  };
}

/**
 * Resolve tool catalog entries strictly scoped to `runtime.availableTools`.
 * Tools not in `runtime.availableTools` are never returned.
 */
export function resolveScopedToolCatalog(
  runtime: CodeExecRuntime,
  context?: IToolExecutionContext,
): ToolCatalogEntry[] {
  const entries: ToolCatalogEntry[] = [];
  const seen = new Set<string>();

  const explicitCatalog = runtime.toolCatalog;
  const contextCatalog = (context?.extra?.toolSearchCatalog ?? context?.extra?.toolCatalog) as
    | readonly ToolCatalogEntry[]
    | undefined;

  const catalogMap = new Map<string, ToolCatalogEntry>();
  if (Array.isArray(explicitCatalog)) {
    for (const entry of explicitCatalog) {
      if (entry && typeof entry.name === 'string') {
        catalogMap.set(entry.name, entry);
      }
    }
  }
  if (Array.isArray(contextCatalog)) {
    for (const entry of contextCatalog) {
      if (entry && typeof entry.name === 'string' && !catalogMap.has(entry.name)) {
        catalogMap.set(entry.name, entry);
      }
    }
  }

  const formalRegistry = FormalToolRegistry.getInstance();
  const legacyRegistry = ToolRegistry.getInstance();

  for (const toolName of runtime.availableTools) {
    if (
      typeof toolName !== 'string' ||
      !toolName ||
      toolName === 'code_exec' ||
      toolName === 'exec' ||
      seen.has(toolName)
    ) {
      continue;
    }
    seen.add(toolName);

    const fromCatalog = catalogMap.get(toolName);
    if (fromCatalog) {
      entries.push({
        name: toolName,
        description: fromCatalog.description ?? '',
        parameters: fromCatalog.parameters,
      });
      continue;
    }

    const formalTool = formalRegistry.get(toolName);
    if (formalTool) {
      try {
        const schema = formalTool.tool.getSchema();
        entries.push({
          name: toolName,
          description: schema.description ?? formalTool.metadata.description ?? '',
          parameters: schema.parameters,
        });
        continue;
      } catch {
        // Fallback to metadata
      }
    }

    const legacyTool = legacyRegistry.getTool(toolName);
    if (legacyTool) {
      entries.push({
        name: toolName,
        description:
          legacyTool.definition.function.description ?? legacyTool.metadata.description ?? '',
        parameters: legacyTool.definition.function.parameters,
      });
      continue;
    }

    const meta = runtime.toolMetadata?.find((t) => t.name === toolName);
    entries.push({
      name: toolName,
      description: meta?.description ?? '',
      parameters: undefined,
    });
  }

  return entries;
}

/**
 * Generate TypeScript declarations matching the scoped runtime environment.
 */
export function generateToolDeclarations(scopedTools: readonly ToolCatalogEntry[]): string {
  const bindings = buildToolBindings(scopedTools.map((t) => t.name));
  const bindingMap = new Map<string, string>(bindings.map((b: ToolBinding) => [b.toolName, b.exposedName]));

  const typeDecls: string[] = [];
  const directMethods: string[] = [];
  const callOverloads: string[] = [];

  let typeIndex = 0;
  for (const tool of scopedTools) {
    const exposedName = bindingMap.get(tool.name);
    const argsInfo = extractToolArgsType(tool.name, tool.parameters, ++typeIndex);
    typeDecls.push(argsInfo.typeDeclaration);

    const doc = tool.description ? `  /** ${sanitizeJsDoc(tool.description)} */\n` : '';
    const argsParam = argsInfo.hasRequiredProps
      ? `args: ${argsInfo.typeName}`
      : `args?: ${argsInfo.typeName}`;

    if (exposedName) {
      directMethods.push(`${doc}  ${exposedName}(${argsParam}): Promise<ToolResult>;`);
    }

    callOverloads.push(
      `${doc}  call(name: ${JSON.stringify(tool.name)}, ${argsParam}): Promise<ToolResult>;`,
    );
  }

  if (callOverloads.length === 0) {
    callOverloads.push('  call(name: never, args?: never): Promise<ToolResult>;');
  }

  return `
export interface ToolResult {
  success: boolean;
  output?: string;
  data?: any;
  error?: string;
  truncated?: boolean;
}

export interface ToolMetadataEntry {
  readonly name: string;
  readonly description: string;
}

${typeDecls.join('\n\n')}

export interface Tools {
${directMethods.join('\n')}

${callOverloads.join('\n')}
}

declare global {
  const tools: Tools;
  function text(content: unknown): void;
  function store(key: string, value: unknown): void;
  function load<T = unknown>(key: string): T | undefined;
  function yield_control(): Promise<void>;

  const ALL_TOOLS: ReadonlyArray<ToolMetadataEntry>;
  const ALL_TOOL_NAMES: ReadonlyArray<string>;

  const console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
  };
}

export {};
`;
}

function resolvePreflightRunnerPath(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.join(currentDir, 'code-exec-preflight-runner.js');
    if (fs.existsSync(distPath)) return distPath;
    const srcPath = path.join(currentDir, 'code-exec-preflight-runner.ts');
    if (fs.existsSync(srcPath)) return srcPath;
    throw new Error('Bundled preflight compiler is missing');
  } catch (error) {
    throw new Error(`Cannot resolve bundled preflight compiler: ${String(error)}`);
  }
}

function getRunnerSpawnArgs(runnerPath: string): string[] {
  const args = [`--max-old-space-size=${PREFLIGHT_LIMITS.maxHeapMb}`, '--no-warnings'];
  if (runnerPath.endsWith('.ts')) {
    args.push('--experimental-strip-types');
  }
  args.push(runnerPath);
  return args;
}

function terminateWorker(child: ChildProcess): void {
  try {
    if (child.connected) child.disconnect();
  } catch {
    /* already disconnected */
  }
  try {
    if (!child.killed) child.kill('SIGKILL');
  } catch {
    /* already terminated */
  }
}

/**
 * Execute isolated TypeScript preflight typechecking in a worker/child process.
 */
export async function runCodeExecPreflight(
  code: string,
  runtime: CodeExecRuntime,
  context?: IToolExecutionContext,
  options?: PreflightOptions,
): Promise<PreflightWorkerResult> {
  const activeSignal = options?.signal ?? runtime.abortSignal ?? context?.abortSignal;

  if (activeSignal?.aborted) {
    return {
      success: false,
      diagnostics: [{ message: 'TypeScript preflight validation cancelled', category: 'error' }],
      error: 'TypeScript preflight validation cancelled',
    };
  }

  if (code.length > CODE_EXEC_LIMITS.maxCodeChars) {
    return {
      success: false,
      diagnostics: [
        {
          message: `code exceeds the ${CODE_EXEC_LIMITS.maxCodeChars}-character limit`,
          category: 'error',
        },
      ],
      error: `code exceeds the ${CODE_EXEC_LIMITS.maxCodeChars}-character limit`,
    };
  }

  const scopedCatalog = options?.catalog ?? resolveScopedToolCatalog(runtime, context);
  if (scopedCatalog.length > 4096 || JSON.stringify(scopedCatalog).length > 1000000) return { success: false, diagnostics: [], error: 'Preflight catalog exceeds size limit' };
  const declarations = generateToolDeclarations(scopedCatalog);
  if (declarations.length > 1000000) return { success: false, diagnostics: [], error: 'Preflight declarations exceed size limit' };
  const runnerPath = resolvePreflightRunnerPath();

  return new Promise<PreflightWorkerResult>((resolve) => {
    let settled = false;
    let stderr = '';

    const child = spawn(process.execPath, getRunnerSpawnArgs(runnerPath), {
      cwd: runtime.cwd || process.cwd(),
      env: {
        HOME: '/nonexistent',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        NODE_NO_WARNINGS: '1',
        PATH: process.env.PATH ?? '',
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
      windowsHide: true,
    });

    const finish = (result: PreflightWorkerResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeSignal?.removeEventListener('abort', onAbort);
      terminateWorker(child);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        success: false,
        diagnostics: [
          {
            message: `TypeScript preflight validation timed out after ${PREFLIGHT_LIMITS.timeoutMs}ms`,
            category: 'error',
          },
        ],
        error: `TypeScript preflight validation timed out after ${PREFLIGHT_LIMITS.timeoutMs}ms`,
        declarations,
      });
    }, PREFLIGHT_LIMITS.timeoutMs);

    const onAbort = (): void => {
      finish({
        success: false,
        diagnostics: [
          {
            message: 'TypeScript preflight validation cancelled',
            category: 'error',
          },
        ],
        error: 'TypeScript preflight validation cancelled',
        declarations,
      });
    };

    if (activeSignal?.aborted) {
      onAbort();
      return;
    }
    activeSignal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < 4_096) {
        stderr += String(chunk).slice(0, 4_096 - stderr.length);
      }
    });

    child.on('error', (err) => {
      finish({
        success: false,
        diagnostics: [
          {
            message: `TypeScript preflight runner spawn failed: ${err.message}`,
            category: 'error',
          },
        ],
        error: `TypeScript preflight runner spawn failed: ${err.message}`,
        declarations,
      });
    });

    child.on('exit', (codeValue, signal) => {
      if (settled) return;
      const detail = stderr.trim() || `exit=${codeValue ?? 'null'} signal=${signal ?? 'none'}`;
      finish({
        success: false,
        diagnostics: [
          {
            message: `TypeScript preflight worker process terminated unexpectedly (heap limit ${PREFLIGHT_LIMITS.maxHeapMb}MB exceeded or crashed: ${detail})`,
            category: 'error',
          },
        ],
        error: `TypeScript preflight worker process terminated unexpectedly (${detail})`,
        declarations,
      });
    });

    child.on('message', (raw: unknown) => {
      const msg = raw as { type: string; result?: PreflightWorkerResult; error?: string };
      if (!msg || typeof msg !== 'object' || settled) return;

      if (msg.type === 'result' && msg.result) {
        finish(msg.result);
      } else if (msg.type === 'error') {
        finish({
          success: false,
          diagnostics: [{ message: msg.error || 'Preflight compilation error', category: 'error' }],
          error: msg.error || 'Preflight compilation error',
          declarations,
        });
      }
    });

    child.send(
      {
        type: 'compile',
        payload: {
          code,
          declarations,
          strict: options?.strict,
          target: options?.target,
        },
      },
      (err) => {
        if (err) {
          finish({
            success: false,
            diagnostics: [{ message: `Preflight IPC failed: ${err.message}`, category: 'error' }],
            error: `Preflight IPC failed: ${err.message}`,
            declarations,
          });
        }
      },
    );
  });
}
