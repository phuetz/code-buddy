/**
 * Text Editor Tool Adapters
 *
 * ITool-compliant adapters for TextEditorTool operations.
 * These adapters wrap the existing TextEditorTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import path from 'path';
import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType, IToolExecutionContext } from './types.js';
import { TextEditorTool } from '../index.js';
import { TOOL_ALIASES } from './tool-alias-map.js';

/** Recovery must use the schemas sent to this model round, not registry names. */
function existingFileRecovery(filePath: string, exposedToolNames: unknown): string {
  const names = Array.isArray(exposedToolNames)
    ? exposedToolNames.filter((name): name is string => typeof name === 'string')
    : [];
  const findPrimaryTool = (primaryName: string): string | undefined =>
    names.find(name => (TOOL_ALIASES[name] ?? name) === primaryName);
  const reader = findPrimaryTool('view_file');
  const readHint = reader
    ? `Use ${reader} with ${JSON.stringify({ path: filePath })} to read the existing text. `
    : '';
  const patcher = findPrimaryTool('apply_patch');
  if (patcher) {
    return `${readHint}Use ${patcher} with ${JSON.stringify({
      patch: `*** Begin Patch\n*** Update File: ${filePath}\n@@\n-old line\n+new line\n*** End Patch`,
    })}. Replace old line with an exact existing line and new line with the desired line.`;
  }
  const editor = findPrimaryTool('str_replace_editor');
  if (editor) {
    return `${readHint}Use ${editor} with ${JSON.stringify({
      path: filePath,
      old_str: '<exact existing text>',
      new_str: '<replacement text>',
    })}. Copy old_str exactly from the file and put the desired text in new_str; do not use the example placeholders literally.`;
  }
  const search = findPrimaryTool('tool_search');
  return search
    ? `Use ${search} with ${JSON.stringify({ query: 'edit existing file' })} to discover an editing tool, then use its returned schema.`
    : 'No editing tool is exposed in this round. Enable an editing tool before retrying; creation cannot overwrite an existing file.';
}

function extractPath(input: Record<string, unknown>): string | undefined {
  const candidate = input.path ?? input.file_path ?? input.target_file ?? input.file;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Resolve a (possibly relative) tool path against the execution context's cwd.
 *
 * Without this, relative paths resolve against `process.cwd()` — correct for
 * the CLI (launched from the workspace) but WRONG for embedded engines whose
 * session workingDirectory differs from the host process cwd. Proven live in
 * Cowork: an App Studio generation scoped to /tmp/e2e-meteo3 wrote
 * `index.html` into the Electron launch dir and overwrote cowork's own entry.
 */
function resolveAgainstCwd(p: string, context?: IToolExecutionContext): string {
  if (!p || path.isAbsolute(p) || !context?.cwd) return p;
  return path.resolve(context.cwd, p);
}

// ============================================================================
// Shared TextEditorTool Instance
// ============================================================================

// Lazy-loaded singleton for TextEditorTool
let textEditorInstance: TextEditorTool | null = null;

function getTextEditor(): TextEditorTool {
  if (!textEditorInstance) {
    textEditorInstance = new TextEditorTool();
  }
  return textEditorInstance;
}

/**
 * Reset the shared TextEditorTool instance (for testing)
 */
export function resetTextEditorInstance(): void {
  if (textEditorInstance) {
    textEditorInstance.dispose();
    textEditorInstance = null;
  }
}

// ============================================================================
// ViewFileTool
// ============================================================================

/**
 * ViewFileTool - ITool adapter for viewing file contents
 */
export class ViewFileTool implements ITool {
  readonly name = 'view_file';
  readonly description = 'View file contents with optional line range';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const path = resolveAgainstCwd(extractPath(input) as string, context);
    const startLine = input.start_line as number | undefined;
    const endLine = input.end_line as number | undefined;

    const range: [number, number] | undefined =
      startLine !== undefined && endLine !== undefined
        ? [startLine, endLine]
        : undefined;

    return await getTextEditor().view(path, range);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file or directory to view',
          },
          file_path: {
            type: 'string',
            description: 'Alias for path',
          },
          target_file: {
            type: 'string',
            description: 'Alias for path',
          },
          start_line: {
            type: 'number',
            description: 'Start line for partial view (1-indexed)',
          },
          end_line: {
            type: 'number',
            description: 'End line for partial view (1-indexed)',
          },
        },
        required: ['path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    const path = extractPath(data);
    if (typeof path !== 'string' || path.trim() === '') {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }

    if (data.start_line !== undefined && typeof data.start_line !== 'number') {
      return { valid: false, errors: ['start_line must be a number'] };
    }

    if (data.end_line !== undefined && typeof data.end_line !== 'number') {
      return { valid: false, errors: ['end_line must be a number'] };
    }

    if ((data.start_line !== undefined) !== (data.end_line !== undefined)) {
      return { valid: false, errors: ['Both start_line and end_line must be provided together'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_read' as ToolCategoryType,
      keywords: ['view', 'read', 'file', 'content', 'display'],
      priority: 10,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// CreateFileTool
// ============================================================================

/**
 * CreateFileTool - ITool adapter for creating new files
 */
export class CreateFileTool implements ITool {
  readonly name = 'create_file';
  readonly description = 'Create a new file with the specified content';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const path = resolveAgainstCwd(extractPath(input) as string, context);
    const content = input.content as string;

    const result = await getTextEditor().create(path, content);
    const data = result.data as { code?: string } | undefined;
    if (!result.success && data?.code === 'FILE_ALREADY_EXISTS') {
      return {
        ...result,
        error: `${result.error} ${existingFileRecovery(extractPath(input) as string, context?.extra?.exposedToolNames)}`,
      };
    }
    return result;
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path where the new file should be created',
          },
          file_path: {
            type: 'string',
            description: 'Alias for path',
          },
          target_file: {
            type: 'string',
            description: 'Alias for path',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    const path = extractPath(data);
    if (typeof path !== 'string' || path.trim() === '') {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }

    if (typeof data.content !== 'string') {
      return { valid: false, errors: ['content must be a string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_write' as ToolCategoryType,
      keywords: ['create', 'write', 'file', 'new'],
      priority: 8,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// StrReplaceEditorTool
// ============================================================================

/**
 * StrReplaceEditorTool - ITool adapter for string replacement in files
 */
export class StrReplaceEditorTool implements ITool {
  readonly name = 'str_replace_editor';
  readonly description = 'Replace text in a file using exact or fuzzy matching';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const path = resolveAgainstCwd(extractPath(input) as string, context);
    const oldStr = (input.old_str ?? input.old_text ?? input.old_content ?? input.find ?? input.old_string) as string;
    const newStr = (input.new_str ?? input.new_text ?? input.new_content ?? input.replace ?? input.new_string) as string;
    const replaceAll = (input.replace_all as boolean) ?? false;

    return await getTextEditor().strReplace(path, oldStr, newStr, replaceAll);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to edit',
          },
          file_path: {
            type: 'string',
            description: 'Alias for path',
          },
          target_file: {
            type: 'string',
            description: 'Alias for path',
          },
          old_str: {
            type: 'string',
            description: 'Text to find and replace',
          },
          old_text: {
            type: 'string',
            description: 'Alias for old_str',
          },
          old_content: {
            type: 'string',
            description: 'Alias for old_str',
          },
          find: {
            type: 'string',
            description: 'Alias for old_str',
          },
          old_string: {
            type: 'string',
            description: 'Alias for old_str',
          },
          new_str: {
            type: 'string',
            description: 'Replacement text',
          },
          new_text: {
            type: 'string',
            description: 'Alias for new_str',
          },
          new_content: {
            type: 'string',
            description: 'Alias for new_str',
          },
          replace: {
            type: 'string',
            description: 'Alias for new_str',
          },
          new_string: {
            type: 'string',
            description: 'Alias for new_str',
          },
          replace_all: {
            type: 'boolean',
            description: 'If true, replace all occurrences; otherwise only first',
            default: false,
          },
        },
        required: ['path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    const path = extractPath(data);
    if (typeof path !== 'string' || path.trim() === '') {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }

    const oldStr = data.old_str ?? data.old_text ?? data.old_content ?? data.find ?? data.old_string;
    if (typeof oldStr !== 'string') {
      return { valid: false, errors: ['old_str must be a string'] };
    }

    const newStr = data.new_str ?? data.new_text ?? data.new_content ?? data.replace ?? data.new_string;
    if (typeof newStr !== 'string') {
      return { valid: false, errors: ['new_str must be a string'] };
    }

    if (data.replace_all !== undefined && typeof data.replace_all !== 'boolean') {
      return { valid: false, errors: ['replace_all must be a boolean'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_write' as ToolCategoryType,
      keywords: ['edit', 'replace', 'modify', 'file', 'text', 'string'],
      priority: 9,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// ApplyPatchTool
// ============================================================================

// Lazy singleton for the diff-first patch applier (src/tools/apply-patch.ts).
let applyPatchInstance: InstanceType<typeof import('../apply-patch.js').ApplyPatchTool> | null = null;
async function getApplyPatchTool() {
  if (!applyPatchInstance) {
    const { ApplyPatchTool } = await import('../apply-patch.js');
    applyPatchInstance = new ApplyPatchTool();
  }
  return applyPatchInstance;
}

/**
 * ApplyPatchExecuteTool — ITool adapter for the diff-first patch applier.
 *
 * Registering this makes WritePolicy `strict` mode's diff-first path REAL:
 * strict blocks direct str_replace/create_file writes and points the agent at
 * apply_patch, which the write-policy gate always allows. Before this, the tool
 * was defined but never registered — so `buddy dev` (WritePolicy.strict by
 * default) was an edit DEADLOCK: apply_patch → "Unknown tool", any direct
 * editor → blocked by strict policy. When CODEBUDDY_DIFF_REVIEW is on, the
 * underlying tool routes through the review gate.
 */
export class ApplyPatchExecuteTool implements ITool {
  readonly name = 'apply_patch';
  readonly description =
    'Apply a patch to add, update, or delete files (diff-first). Use *** Begin Patch / *** End Patch with -/+ lines. Required by WritePolicy strict mode.';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const tool = await getApplyPatchTool();
    return tool.execute(input, context?.cwd);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          patch: {
            type: 'string',
            description: 'The patch in *** Begin Patch / *** End Patch format with -/+ lines.',
          },
          intent: {
            type: 'string',
            description: 'What this change achieves (used by the diff-review gate when enabled).',
          },
        },
        required: ['patch'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const patch = (input as Record<string, unknown>).patch;
    if (typeof patch !== 'string' || patch.trim() === '') {
      return { valid: false, errors: ['patch must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_write' as ToolCategoryType,
      keywords: ['patch', 'diff', 'apply', 'edit', 'unified', 'write', 'update'],
      priority: 8,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

/** Reset the shared ApplyPatchTool instance (for testing). */
export function resetApplyPatchInstance(): void {
  applyPatchInstance = null;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all text editor tool instances
 */
export function createTextEditorTools(): ITool[] {
  return [
    new ViewFileTool(),
    new CreateFileTool(),
    new StrReplaceEditorTool(),
    new ApplyPatchExecuteTool(),
  ];
}
