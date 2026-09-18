import type { ToolResult } from '../../types/index.js';
import { FigmaImportTool, FIGMA_IMPORT_TOOL_DEFINITION } from '../figma-import-tool.js';
import type { ITool, IToolMetadata, IValidationResult, ToolCategoryType, ToolSchema } from './types.js';

let instance: FigmaImportTool | null = null;

function getTool(): FigmaImportTool {
  if (!instance) instance = new FigmaImportTool();
  return instance;
}

export class FigmaImportExecuteTool implements ITool {
  readonly name = 'figma_import';
  readonly description = FIGMA_IMPORT_TOOL_DEFINITION.function.description;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getTool().execute(input);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: FIGMA_IMPORT_TOOL_DEFINITION.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    const jsonPath = data.jsonPath ?? data.json;
    const fileKey = data.fileKey ?? data.file_key;
    if ((jsonPath === undefined || jsonPath === '') && (fileKey === undefined || fileKey === '')) {
      return { valid: false, errors: ['Provide jsonPath (local export) or fileKey + token'] };
    }
    if (jsonPath !== undefined && typeof jsonPath !== 'string') {
      return { valid: false, errors: ['jsonPath must be a string'] };
    }
    if (fileKey !== undefined && typeof fileKey !== 'string') {
      return { valid: false, errors: ['fileKey must be a string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_write' as ToolCategoryType,
      keywords: ['figma', 'import', 'design', 'screen', 'frame', 'ui', 'react', 'maquette'],
      priority: 7,
      modifiesFiles: true,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createFigmaTools(): ITool[] {
  return [new FigmaImportExecuteTool()];
}
