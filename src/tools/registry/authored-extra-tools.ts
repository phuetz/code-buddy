/**
 * Authored Extra Tools — ITool adapters for the 20 pre-authored tool classes.
 *
 * The 20 tool classes (10 in `authored-tools-manifest.ts`, 10 in
 * `authored-tools-manifest-2.ts`) only implement `name`, `description` and
 * `async execute()` — they are NOT `ITool` (no `getSchema()`), so they cannot be
 * registered in the `FormalToolRegistry` directly. This module wraps each
 * (class, `*_TOOL_DEFINITION`) pair in a lightweight `ITool` adapter that:
 *   - supplies `getSchema()` from the OpenAI function definition, and
 *   - lazily constructs the tool instance on first `execute()`.
 *
 * Registering these adapters in `ToolHandler.initializeRegistry()` makes the
 * tools DISPATCHABLE in interactive chat (the invariant-critical edit), keeping
 * `dispatch ⊇ exposed` (see tests/agent/tool-dispatch-exposure-invariant.test.ts).
 */

import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  ToolSchema,
  JsonSchema,
  IToolMetadata,
  ToolCategoryType,
  IToolExecutionContext,
} from './types.js';

// Manifest-1: string-ref manifest, so import the classes + definitions explicitly.
import { ScaffoldAppTool, SCAFFOLD_APP_TOOL_DEFINITION } from '../scaffold-app-tool.js';
import { ProjectMapTool, PROJECT_MAP_TOOL_DEFINITION } from '../project-map-tool.js';
import { DepInspectTool, DEP_INSPECT_TOOL_DEFINITION } from '../dep-inspect-tool.js';
import { CodeStatsTool, CODE_STATS_TOOL_DEFINITION } from '../code-stats-tool.js';
import { GitSummaryTool, GIT_SUMMARY_TOOL_DEFINITION } from '../git-summary-tool.js';
import { TodoScanTool, TODO_SCAN_TOOL_DEFINITION } from '../todo-scan-tool.js';
import { JsonQueryTool, JSON_QUERY_TOOL_DEFINITION } from '../json-query-tool.js';
import { CsvPreviewTool, CSV_PREVIEW_TOOL_DEFINITION } from '../csv-preview-tool.js';
import { EnvDoctorTool, ENV_DOCTOR_TOOL_DEFINITION } from '../env-doctor-tool.js';
import { PortCheckTool, PORT_CHECK_TOOL_DEFINITION } from '../port-check-tool.js';
import { AUTHORED_TOOLS } from '../authored-tools-manifest.js';

// Manifest-2: exposes live `toolClass` / `definition` fields — iterate directly.
import { AUTHORED_TOOLS_MANIFEST_2 } from '../authored-tools-manifest-2.js';

// ---------------------------------------------------------------------------
// Local structural shapes for the authored classes + definitions.
// ---------------------------------------------------------------------------

interface AuthoredExecutable {
  readonly name: string;
  readonly description: string;
  execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult>;
}

interface AuthoredToolCtor {
  new (): AuthoredExecutable;
}

interface OpenAiFunctionDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

interface AdapterMeta {
  category: ToolCategoryType;
  keywords: string[];
  priority: number;
  fleetSafe: boolean;
  modifiesFiles: boolean;
}

/**
 * Sensible category per tool for the registry metadata (cosmetic — the RAG /
 * BM25 metadata lives in `src/tools/metadata.ts`; this only feeds
 * `ITool.getMetadata()`).
 */
const CATEGORY_BY_NAME: Record<string, ToolCategoryType> = {
  scaffold_app: 'file_write',
  project_map: 'codebase',
  dep_inspect: 'codebase',
  code_stats: 'codebase',
  git_summary: 'git',
  todo_scan: 'codebase',
  json_query: 'utility',
  csv_preview: 'utility',
  env_doctor: 'system',
  port_check: 'system',
  lint_project: 'system',
  test_runner: 'system',
  format_project: 'system',
  bundle_analyze: 'codebase',
  build_project: 'system',
  license_check: 'codebase',
  sbom_generate: 'codebase',
  http_probe: 'web',
  file_search: 'file_search',
  diff_files: 'file_search',
};

/**
 * Build an `ITool` adapter over a bare authored tool class + its OpenAI-style
 * function definition. The instance is constructed lazily (once) on first call.
 */
function makeAuthoredTool(
  toolClass: unknown,
  definition: unknown,
  meta: AdapterMeta,
): ITool {
  const Ctor = toolClass as AuthoredToolCtor;
  const fn = (definition as OpenAiFunctionDefinition).function;
  let instance: AuthoredExecutable | undefined;
  const getInstance = (): AuthoredExecutable => (instance ??= new Ctor());

  return {
    name: fn.name,
    description: fn.description,
    async execute(
      input: Record<string, unknown>,
      context?: IToolExecutionContext,
    ): Promise<ToolResult> {
      return getInstance().execute(input, context);
    },
    getSchema(): ToolSchema {
      return {
        name: fn.name,
        description: fn.description,
        // The authored definitions are loosely-typed literals; the JSON shape
        // matches `JsonSchema` but the inferred literal types don't, so assert.
        parameters: fn.parameters as JsonSchema,
      };
    },
    getMetadata(): IToolMetadata {
      return {
        name: fn.name,
        description: fn.description,
        category: meta.category,
        keywords: meta.keywords,
        priority: meta.priority,
        fleetSafe: meta.fleetSafe,
        modifiesFiles: meta.modifiesFiles,
      };
    },
    isAvailable(): boolean {
      return true;
    },
  };
}

/**
 * The 20 authored tools as `ITool` adapters, ready to register.
 */
export function createAuthoredExtraTools(): ITool[] {
  const tools: ITool[] = [];

  // --- Manifest-1 (explicit class + definition imports) ---
  const manifest1: Array<[unknown, unknown]> = [
    [ScaffoldAppTool, SCAFFOLD_APP_TOOL_DEFINITION],
    [ProjectMapTool, PROJECT_MAP_TOOL_DEFINITION],
    [DepInspectTool, DEP_INSPECT_TOOL_DEFINITION],
    [CodeStatsTool, CODE_STATS_TOOL_DEFINITION],
    [GitSummaryTool, GIT_SUMMARY_TOOL_DEFINITION],
    [TodoScanTool, TODO_SCAN_TOOL_DEFINITION],
    [JsonQueryTool, JSON_QUERY_TOOL_DEFINITION],
    [CsvPreviewTool, CSV_PREVIEW_TOOL_DEFINITION],
    [EnvDoctorTool, ENV_DOCTOR_TOOL_DEFINITION],
    [PortCheckTool, PORT_CHECK_TOOL_DEFINITION],
  ];
  const meta1 = new Map(
    AUTHORED_TOOLS.map((t) => [
      t.name,
      {
        keywords: t.metadata.keywords,
        priority: t.metadata.priority,
        fleetSafe: t.metadata.fleetSafe,
        modifiesFiles: !t.readOnly,
      },
    ]),
  );
  for (const [cls, def] of manifest1) {
    const name = (def as OpenAiFunctionDefinition).function.name;
    const m = meta1.get(name);
    tools.push(
      makeAuthoredTool(cls, def, {
        category: CATEGORY_BY_NAME[name] ?? 'utility',
        keywords: m?.keywords ?? [name],
        priority: m?.priority ?? 5,
        fleetSafe: m?.fleetSafe ?? false,
        modifiesFiles: m?.modifiesFiles ?? false,
      }),
    );
  }

  // --- Manifest-2 (live `toolClass` / `definition` fields) ---
  for (const entry of AUTHORED_TOOLS_MANIFEST_2) {
    tools.push(
      makeAuthoredTool(entry.toolClass, entry.definition, {
        category: CATEGORY_BY_NAME[entry.name] ?? 'utility',
        keywords: entry.metadata.keywords,
        priority: entry.metadata.priority,
        fleetSafe: entry.metadata.fleetSafe,
        modifiesFiles: !entry.readOnly,
      }),
    );
  }

  return tools;
}
