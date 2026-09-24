/**
 * Tools allowed to write while a call runs in the MCP write context.
 *
 * A tool that is not read-only is refused in that context unless it is listed
 * here. Each entry names the argument keys that are write destinations. Those
 * keys are confined to the workspace even when the value is `..`. Bash has no
 * caller-chosen destination: the workspace sandbox confines the process.
 *
 * Outside the MCP write context this list is not consulted.
 */
import path from 'node:path';
import { isConfinedTarget } from '../agent/workspace-confine.js';
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';
import { TOOL_METADATA } from '../tools/metadata.js';

export function toLegacyName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

export interface McpWriteAllowlistEntry {
  tool: string;
  /** Argument names that carry a write destination. */
  destinationKeys: readonly string[];
  /** Also confine paths parsed from an apply_patch body. */
  patch?: boolean;
}

export const MCP_WRITE_ALLOWLIST: readonly McpWriteAllowlistEntry[] = [
  { tool: 'create_file', destinationKeys: ['path', 'file_path', 'target_file', 'file'] },
  { tool: 'str_replace_editor', destinationKeys: ['path', 'file_path', 'target_file', 'file'] },
  { tool: 'edit_file', destinationKeys: ['path', 'file_path', 'target_file', 'file'] },
  { tool: 'multi_edit', destinationKeys: ['path', 'file_path', 'target_file', 'file'] },
  { tool: 'apply_patch', destinationKeys: [], patch: true },
  { tool: 'bash', destinationKeys: [] },
  { tool: 'archive', destinationKeys: ['path', 'output_dir', 'outputDir'] },
  { tool: 'deploy', destinationKeys: ['outputDir', 'output_dir'] },
  { tool: 'document', destinationKeys: ['path', 'file_path', 'output_dir', 'output_path', 'outputPath'] },
  { tool: 'generate_document', destinationKeys: ['outputPath', 'output_path'] },
  { tool: 'markdown_convert', destinationKeys: ['output_path', 'outputPath'] },
  { tool: 'meeting_notes', destinationKeys: ['output_prefix'] },
  { tool: 'figma_import', destinationKeys: ['out', 'outDir'] },
  { tool: 'scaffold_app', destinationKeys: ['targetDir'] },
  { tool: 'object_detect', destinationKeys: ['annotated_output_path'] },
  { tool: 'video', destinationKeys: ['path', 'output_dir'] },
  { tool: 'video_stitch', destinationKeys: ['output'] },
  { tool: 'video_flow_handoff', destinationKeys: ['approved_asset_root', 'approvedAssetRoot'] },
  { tool: 'image_edit', destinationKeys: ['output_path', 'outputPath'] },
  { tool: 'text_to_speech', destinationKeys: ['output_path', 'outputPath'] },
];

const BY_NAME = new Map(MCP_WRITE_ALLOWLIST.map((entry) => [entry.tool, entry]));

export function lookupMcpWriteAllowlist(toolName: string): McpWriteAllowlistEntry | undefined {
  return BY_NAME.get(toolName) ?? BY_NAME.get(toLegacyName(toolName));
}

export function catalogFleetSafe(toolName: string): boolean {
  const legacy = toLegacyName(toolName);
  return TOOL_METADATA.some((entry) =>
    (entry.name === toolName || entry.name === legacy) && entry.fleetSafe === true);
}

export interface McpToolWriteFacts {
  effect: 'read' | 'reversible' | 'emission' | 'unknown';
  modifiesFiles: boolean;
  fleetSafe: boolean;
}

/**
 * Read-only for the MCP write gate: a pure read, or a fleet-safe tool that
 * does not modify files (the same shape the MCP catalog exposes without
 * --allow-write). A tool that modifies files is never read-only here, even
 * when its catalog effect says `read`.
 */
export function isMcpReadOnlyTool(facts: McpToolWriteFacts): boolean {
  if (facts.modifiesFiles) return false;
  if (facts.effect === 'read') return true;
  if (facts.fleetSafe) return true;
  return false;
}

export function mcpWriteAllowlistRefusal(toolName: string): string {
  return `MCP write allowlist refuses "${toolName}": a tool that is not read-only runs in MCP only when it is on the explicit allowlist of tools whose write destinations are known and confined to the workspace. This tool is not on that list, so the call was not executed.`;
}

function pushString(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.trim() !== '') out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) pushString(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) pushString(item, out);
  }
}

/**
 * Absolute path, or a value that contains a path separator and resolves
 * outside the workspace. Short tokens such as "yaml" and bare ".." are not
 * matched here: ".." is confined only when it is a listed destination key.
 */
export function stringEscapesWorkspace(root: string, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const absolute = path.isAbsolute(trimmed);
  const hasSeparator = trimmed.includes(path.sep) || trimmed.includes('/') || trimmed.includes('\\');
  if (!absolute && !hasSeparator) return false;
  return !isConfinedTarget(root, trimmed);
}

export async function confineAllowlistedWrite(
  root: string,
  args: Record<string, unknown>,
  entry: McpWriteAllowlistEntry,
): Promise<string | null> {
  const destinations: string[] = [];
  for (const key of entry.destinationKeys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '') destinations.push(value);
  }
  if (entry.patch && typeof args.patch === 'string') {
    try {
      const { parsePatch } = await import('../tools/apply-patch.js');
      for (const op of parsePatch(args.patch)) {
        if (typeof op.path === 'string' && op.path.trim() !== '') destinations.push(op.path);
        if (typeof op.moveTo === 'string' && op.moveTo.trim() !== '') destinations.push(op.moveTo);
      }
    } catch {
      return 'Path outside workspace not allowed: patch could not be read';
    }
  }
  for (const raw of destinations) {
    if (!isConfinedTarget(root, raw)) {
      return `Path outside workspace not allowed: ${raw}`;
    }
  }

  const strings: string[] = [];
  pushString(args, strings);
  for (const raw of strings) {
    if (stringEscapesWorkspace(root, raw)) {
      return `Path outside workspace not allowed: ${raw.trim()}`;
    }
  }
  return null;
}
