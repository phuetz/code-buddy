/**
 * Playwright Browser Tool Adapters
 *
 * ITool-compliant adapters for browser automation operations.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { BrowserTool } from '../browser/playwright-tool.js';

// ============================================================================
// Shared BrowserTool Instance
// ============================================================================

function getBrowser(): BrowserTool {
  return BrowserTool.getInstance();
}

/**
 * Reset the shared BrowserTool instance
 */
export async function resetBrowserInstance(): Promise<void> {
  await BrowserTool.resetInstance();
}

// ============================================================================
// BrowserLaunchTool
// ============================================================================

export class BrowserLaunchTool implements ITool {
  readonly name = 'browser_launch';
  readonly description = 'Launch a headless browser instance for automation.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const headless = input.headless !== false; // Default to true
    
    try {
      await getBrowser().launch({ headless });
      return { success: true, output: `Browser launched successfully (headless: ${headless}).` };
    } catch (error) {
      return { success: false, error: `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          headless: {
            type: 'boolean',
            description: 'Launch in headless mode (default: true)',
          },
        },
      },
    };
  }

  validate(input: unknown): IValidationResult {
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'browser' as ToolCategoryType,
      keywords: ['browser', 'launch', 'start', 'playwright'],
      priority: 8,
      modifiesFiles: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// BrowserNavigateTool
// ============================================================================

export class BrowserNavigateTool implements ITool {
  readonly name = 'browser_navigate';
  readonly description = 'Navigate the active browser tab to a specified URL.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    
    try {
      if (!getBrowser().isLaunched()) await getBrowser().launch();
      await getBrowser().navigate(url);
      return { success: true, output: `Navigated to ${url}` };
    } catch (error) {
      return { success: false, error: `Navigation failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to navigate to',
          },
        },
        required: ['url'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown>;
    if (typeof data?.url !== 'string' || data.url.trim() === '') {
      return { valid: false, errors: ['url is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'browser' as ToolCategoryType,
      keywords: ['browser', 'navigate', 'goto', 'url'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// BrowserActionTool (Click, Type, Extract)
// ============================================================================

export class BrowserActionTool implements ITool {
  readonly name = 'browser_action';
  readonly description = 'Perform actions like click, type, or extract HTML on the active browser page.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const selector = input.selector as string;
    const value = input.value as string;
    
    try {
      if (!getBrowser().isLaunched()) return { success: false, error: 'Browser is not launched.' };

      switch (action) {
        case 'click':
          await getBrowser().click(selector);
          return { success: true, output: `Clicked element: ${selector}` };
        case 'type':
          await getBrowser().type(selector, value);
          return { success: true, output: `Typed into element: ${selector}` };
        case 'html':
          const html = await getBrowser().getHtml();
          return { success: true, output: html.substring(0, 10000) + (html.length > 10000 ? '\\n... (truncated)' : '') };
        case 'screenshot':
          const path = await getBrowser().screenshot();
          return { success: true, output: `Screenshot saved to ${path}` };
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { success: false, error: `Browser action failed: ${error instanceof Error ? error.message : String(error)}` };
    }
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
            enum: ['click', 'type', 'html', 'screenshot'],
            description: 'The action to perform',
          },
          selector: {
            type: 'string',
            description: 'CSS selector of the target element (required for click and type)',
          },
          value: {
            type: 'string',
            description: 'Text to type (required for type action)',
          },
        },
        required: ['action'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown>;
    if (!['click', 'type', 'html', 'screenshot'].includes(data?.action as string)) {
      return { valid: false, errors: ['Invalid action type'] };
    }
    if ((data.action === 'click' || data.action === 'type') && typeof data.selector !== 'string') {
        return { valid: false, errors: ['Selector is required for click and type actions'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'browser' as ToolCategoryType,
      keywords: ['browser', 'click', 'type', 'interact', 'screenshot'],
      priority: 8,
      modifiesFiles: true, // Screenshot saves a file
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createBrowserTools(): ITool[] {
  return [
    new BrowserLaunchTool(),
    new BrowserNavigateTool(),
    new BrowserActionTool(),
  ];
}
