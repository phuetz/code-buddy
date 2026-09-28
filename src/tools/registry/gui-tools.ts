/**
 * GUI Control Tool Adapter
 *
 * ITool-compliant adapter for gui_control — screenshot, click, type, scroll, key.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { guiControl, type GuiElementTreeProvider } from '../gui-tool.js';

// ============================================================================
// GuiControlTool
// ============================================================================

export class GuiControlTool implements ITool {
  constructor(private readonly elementTreeProvider?: GuiElementTreeProvider) {}

  readonly name = 'gui_control';
  readonly description =
    'Control the desktop GUI: take screenshots, click buttons, type text, press key ' +
    'combinations, and scroll. Use action="screenshot" first to see the screen, then ' +
    'action="click" with x/y coordinates to interact. Supports Windows, macOS, and Linux.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return guiControl(input, { elementTreeProvider: this.elementTreeProvider });
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
            enum: ['screenshot', 'click', 'type', 'scroll', 'key', 'find_element'],
            description:
              'Action to perform: screenshot (capture screen), click (mouse click), ' +
              'type (keyboard text input), scroll (mouse wheel), key (key combination), ' +
              'find_element (screenshot + description for vision-based lookup)',
          },
          region: {
            type: 'object',
            description: 'Crop region for screenshot (optional)',
            properties: {
              x: { type: 'number', description: 'Left edge in pixels' },
              y: { type: 'number', description: 'Top edge in pixels' },
              width: { type: 'number', description: 'Width in pixels' },
              height: { type: 'number', description: 'Height in pixels' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          x: {
            type: 'number',
            description: 'X coordinate (pixels from left) for click or scroll',
          },
          y: {
            type: 'number',
            description: 'Y coordinate (pixels from top) for click or scroll',
          },
          button: {
            type: 'string',
            enum: ['left', 'right', 'middle'],
            description: 'Mouse button for click (default: left)',
          },
          doubleClick: {
            type: 'boolean',
            description: 'Whether to double-click (default: false)',
          },
          text: {
            type: 'string',
            description: 'Text to type (for action="type")',
          },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction (default: down)',
          },
          amount: {
            type: 'number',
            description: 'Scroll amount in lines/clicks (default: 3)',
          },
          keys: {
            type: 'string',
            description:
              'Key combination to press, e.g. "ctrl+c", "ctrl+shift+s", "enter", "tab", ' +
              '"escape", "f5". Modifiers: ctrl, alt, shift, meta/cmd/win.',
          },
          description: {
            type: 'string',
            description:
              'Natural-language description of the element to find (for action="find_element"). ' +
              'Returns a screenshot for the LLM to identify the element visually.',
          },
        },
        required: ['action'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown>;
    const validActions = ['screenshot', 'click', 'type', 'scroll', 'key', 'find_element'];

    if (typeof data?.action !== 'string' || !validActions.includes(data.action)) {
      return {
        valid: false,
        errors: [`action must be one of: ${validActions.join(', ')}`],
      };
    }

    if (data.action === 'click') {
      if (typeof data.x !== 'number' || typeof data.y !== 'number') {
        return { valid: false, errors: ['click requires numeric x and y'] };
      }
    }

    if (data.action === 'type' && typeof data.text !== 'string') {
      return { valid: false, errors: ['type requires text (string)'] };
    }

    if (data.action === 'key' && typeof data.keys !== 'string') {
      return { valid: false, errors: ['key requires keys (string)'] };
    }

    if (data.action === 'scroll') {
      if (typeof data.x !== 'number' || typeof data.y !== 'number') {
        return { valid: false, errors: ['scroll requires numeric x and y'] };
      }
    }

    if (data.action === 'find_element' && typeof data.description !== 'string') {
      return { valid: false, errors: ['find_element requires description (string)'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'computer_control' as ToolCategoryType,
      keywords: [
        'gui', 'screenshot', 'click', 'type', 'keyboard', 'mouse', 'scroll',
        'desktop', 'automation', 'screen', 'computer', 'control', 'window',
      ],
      priority: 7,
      modifiesFiles: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory
// ============================================================================

let instance: GuiControlTool | null = null;

export function createGuiTools(): GuiControlTool[] {
  if (!instance) instance = new GuiControlTool();
  return [instance];
}

export function resetGuiToolInstance(): void {
  instance = null;
}
