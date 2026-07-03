/**
 * Playwright Browser Tool Adapters
 *
 * ITool-compliant adapters for browser automation operations.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { BrowserTool } from '../browser/playwright-tool.js';
import { BrowserExecuteTool } from './misc-tools.js';

// ============================================================================
// Shared browser session — ALL adapters below go through the same
// BrowserManager (Layer B). The legacy playwright-tool BrowserTool is only
// referenced for reset (older code may still hold an instance).
// ============================================================================

const hermesBrowser = new BrowserExecuteTool();

async function executeHermesBrowser(input: Record<string, unknown>): Promise<ToolResult> {
  return hermesBrowser.execute(input);
}

async function ensureHermesBrowserLaunched(): Promise<ToolResult | null> {
  const result = await executeHermesBrowser({ action: 'launch' });
  return result.success ? null : result;
}

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function requireNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reset the shared BrowserTool instance
 */
export async function resetBrowserInstance(): Promise<void> {
  await BrowserTool.resetInstance();
  await hermesBrowser.dispose?.();
  const { resetBrowserManager, resetBrowserTool } = await import('../../browser-automation/index.js');
  resetBrowserTool();
  resetBrowserManager();
}

// ============================================================================
// BrowserLaunchTool
// ============================================================================

export class BrowserLaunchTool implements ITool {
  readonly name = 'browser_launch';
  readonly description = 'Launch a headless browser instance for automation.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const headless = input.headless !== false; // Default to true

    // Same BrowserManager session as browser_navigate/click/snapshot —
    // browser_launch used to open a SEPARATE legacy BrowserTool instance
    // that none of the other adapters saw.
    return executeHermesBrowser({ action: 'launch', headless });
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

  validate(_input: unknown): IValidationResult {
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
      const launchError = await ensureHermesBrowserLaunched();
      if (launchError) return launchError;
      return await executeHermesBrowser({
        action: 'navigate',
        url,
        waitUntil: input.waitUntil as string | undefined,
        timeout: input.timeout as number | undefined,
      });
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
          waitUntil: {
            type: 'string',
            enum: ['load', 'domcontentloaded', 'networkidle'],
            description: 'When to consider navigation complete',
          },
          timeout: {
            type: 'number',
            description: 'Navigation timeout in milliseconds',
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
// BrowserClickTool
// ============================================================================

export class BrowserClickTool implements ITool {
  readonly name = 'browser_click';
  readonly description = 'Click an element by numeric ref from browser_snapshot.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeHermesBrowser({
      action: 'click',
      ref: input.ref as number,
      button: input.button as string | undefined,
      clickCount: input.clickCount as number | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'number',
            description: 'Element reference number from browser_snapshot',
          },
          button: {
            type: 'string',
            enum: ['left', 'right', 'middle'],
            description: 'Mouse button. Defaults to left.',
          },
          clickCount: {
            type: 'number',
            description: 'Number of clicks. Defaults to 1.',
          },
        },
        required: ['ref'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = objectInput(input);
    if (requireNumber(data, 'ref') === null) {
      return { valid: false, errors: ['ref is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'click', 'ref', 'playwright', 'hermes'],
      priority: 8,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// BrowserTypeTool
// ============================================================================

export class BrowserTypeTool implements ITool {
  readonly name = 'browser_type';
  readonly description = 'Type text into an element by numeric ref from browser_snapshot.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeHermesBrowser({
      action: 'type',
      ref: input.ref as number,
      text: input.text as string,
      clear: input.clear as boolean | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'number',
            description: 'Element reference number from browser_snapshot',
          },
          text: {
            type: 'string',
            description: 'Text to type',
          },
          clear: {
            type: 'boolean',
            description: 'Clear the field before typing',
          },
        },
        required: ['ref', 'text'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = objectInput(input);
    if (requireNumber(data, 'ref') === null) {
      return { valid: false, errors: ['ref is required'] };
    }
    if (requireString(data, 'text') === null) {
      return { valid: false, errors: ['text is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'type', 'input', 'text', 'ref', 'playwright', 'hermes'],
      priority: 8,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// BrowserScrollTool
// ============================================================================

export class BrowserScrollTool implements ITool {
  readonly name = 'browser_scroll';
  readonly description = 'Scroll the active browser page or scroll to an element ref.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeHermesBrowser({
      action: 'scroll',
      direction: input.direction as string | undefined,
      amount: input.amount as number | undefined,
      toElement: input.toElement as number | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction. Defaults to down.',
          },
          amount: {
            type: 'number',
            description: 'Scroll amount in pixels. Defaults to 300.',
          },
          toElement: {
            type: 'number',
            description: 'Optional element ref to scroll into view.',
          },
        },
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = objectInput(input);
    if (data.direction !== undefined && !['up', 'down', 'left', 'right'].includes(data.direction as string)) {
      return { valid: false, errors: ['direction must be one of up, down, left, right'] };
    }
    if (data.amount !== undefined && requireNumber(data, 'amount') === null) {
      return { valid: false, errors: ['amount must be a number'] };
    }
    if (data.toElement !== undefined && requireNumber(data, 'toElement') === null) {
      return { valid: false, errors: ['toElement must be a number'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'scroll', 'page', 'viewport', 'ref', 'playwright', 'hermes'],
      priority: 7,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// BrowserBackTool
// ============================================================================

export class BrowserBackTool implements ITool {
  readonly name = 'browser_back';
  readonly description = 'Navigate the active browser page back in history.';

  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
    return await executeHermesBrowser({ action: 'go_back' });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {},
      },
    };
  }

  validate(_input: unknown): IValidationResult {
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'back', 'history', 'navigation', 'playwright', 'hermes'],
      priority: 7,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// BrowserPressTool
// ============================================================================

export class BrowserPressTool implements ITool {
  readonly name = 'browser_press';
  readonly description = 'Press a keyboard key in the active browser page.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeHermesBrowser({
      action: 'press',
      key: input.key as string,
      modifiers: input.modifiers as string[] | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Keyboard key to press, such as Enter, Tab, Escape, ArrowDown.',
          },
          modifiers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional modifier keys: Control, Alt, Shift, Meta.',
          },
        },
        required: ['key'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = objectInput(input);
    if (requireString(data, 'key') === null) {
      return { valid: false, errors: ['key is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'press', 'keyboard', 'key', 'playwright', 'hermes'],
      priority: 7,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: false,
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

    // Delegates to the shared BrowserManager session (same instance as
    // browser_navigate/click/snapshot). Selector-based click/type are
    // shimmed through evaluate — the ref-based `browser` tool is the
    // preferred path for interaction.
    switch (action) {
      case 'click': {
        if (!selector) return { success: false, error: 'selector is required for click' };
        const result = await executeHermesBrowser({
          action: 'evaluate',
          expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('No element matches selector: ' + ${JSON.stringify(selector)}); el.click(); return 'clicked'; })()`,
        });
        return result.success ? { success: true, output: `Clicked element: ${selector}` } : result;
      }
      case 'type': {
        if (!selector) return { success: false, error: 'selector is required for type' };
        const result = await executeHermesBrowser({
          action: 'evaluate',
          expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('No element matches selector: ' + ${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(value ?? '')}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'typed'; })()`,
        });
        return result.success ? { success: true, output: `Typed into element: ${selector}` } : result;
      }
      case 'html':
        return executeHermesBrowser({ action: 'get_content' });
      case 'screenshot':
        return executeHermesBrowser({ action: 'screenshot' });
      default:
        return { success: false, error: `Unknown action: ${action}` };
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
    new BrowserClickTool(),
    new BrowserTypeTool(),
    new BrowserScrollTool(),
    new BrowserBackTool(),
    new BrowserPressTool(),
    new BrowserActionTool(),
  ];
}
