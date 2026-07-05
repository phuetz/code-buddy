import type { ToolResult } from '../../types/index.js';
import { DesignSystemTool } from '../design-system-tool.js';
import type { ITool, IToolMetadata, IValidationResult, ToolCategoryType, ToolSchema } from './types.js';

let designSystemInstance: DesignSystemTool | null = null;

function getDesignSystemTool(): DesignSystemTool {
  if (!designSystemInstance) designSystemInstance = new DesignSystemTool();
  return designSystemInstance;
}

export class DesignSystemExecuteTool implements ITool {
  readonly name = 'design_system';
  readonly description = 'List available brand design systems and read DESIGN.md guidance for UI generation.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getDesignSystemTool().execute({
      action: input.action as 'list' | 'get' | undefined,
      id: input.id as string | undefined,
      category: input.category as string | undefined,
      query: input.query as string | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'get'],
            description: "Use 'list' to browse styles, 'get' to read one style's DESIGN.md guidance.",
          },
          id: {
            type: 'string',
            description: "Design system id for action='get' (e.g. 'spotify', 'apple', 'brutalism').",
          },
          category: {
            type: 'string',
            description: "Optional category filter for action='list' (case-insensitive).",
          },
          query: {
            type: 'string',
            description: "Optional search over id, name, category, and tagline for action='list'.",
          },
        },
        required: ['action'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    if (data.action !== 'list' && data.action !== 'get') {
      return { valid: false, errors: ["action must be 'list' or 'get'"] };
    }

    if (data.action === 'get' && (typeof data.id !== 'string' || data.id.trim() === '')) {
      return { valid: false, errors: ["id must be a non-empty string for action='get'"] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['design', 'design system', 'ui', 'brand', 'branding', 'style', 'theme', 'spotify', 'apple', 'brutalism', 'interface', 'landing', 'esthétique', 'charte'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createDesignTools(): ITool[] {
  return [new DesignSystemExecuteTool()];
}
