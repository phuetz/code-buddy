/**
 * Miscellaneous Tool Adapters
 *
 * ITool-compliant adapters for BrowserTool (accessibility-based),
 * ComputerControlTool, ScreenshotTool, and ReasoningTool.
 *
 * BrowserExecuteTool is wired to src/browser-automation/ (OpenClaw-inspired
 * accessibility tree + ref numbering) instead of the old CSS-selector-only
 * src/tools/browser-tool.ts.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { ReasoningTool } from '../index.js';

// Lazy-loaded browser-automation module (accessibility + refs)
import type { BrowserTool as BrowserAutomationTool, BrowserToolInput } from '../../browser-automation/index.js';

// ============================================================================
// Shared Tool Instances (lazy loaded)
// ============================================================================

let browserInstance: BrowserAutomationTool | null = null;
let reasoningInstance: ReasoningTool | null = null;
let computerControlInstance: InstanceType<typeof import('../computer-control-tool.js').ComputerControlTool> | null = null;
let screenshotInstance: InstanceType<typeof import('../screenshot-tool.js').ScreenshotTool> | null = null;

async function getBrowserAutomation(): Promise<BrowserAutomationTool> {
  if (!browserInstance) {
    const { BrowserTool } = await import('../../browser-automation/index.js');
    browserInstance = new BrowserTool();
  }
  return browserInstance;
}

function getReasoning(): ReasoningTool {
  if (!reasoningInstance) {
    reasoningInstance = new ReasoningTool();
  }
  return reasoningInstance;
}

async function getComputerControl() {
  if (!computerControlInstance) {
    const { getComputerControlTool } = await import('../computer-control-tool.js');
    computerControlInstance = getComputerControlTool();
  }
  return computerControlInstance;
}

async function getScreenshot() {
  if (!screenshotInstance) {
    const { ScreenshotTool } = await import('../screenshot-tool.js');
    screenshotInstance = new ScreenshotTool();
  }
  return screenshotInstance;
}

/**
 * Reset the shared instances (for testing)
 */
export function resetMiscInstances(): void {
  browserInstance = null;
  reasoningInstance = null;
  computerControlInstance = null;
  screenshotInstance = null;
}

// ============================================================================
// BrowserExecuteTool (rewired to browser-automation module)
// ============================================================================

const BROWSER_ACTIONS = [
  'launch', 'connect', 'close',
  'tabs', 'new_tab', 'focus_tab', 'close_tab',
  'snapshot', 'get_element', 'find_elements',
  'navigate', 'go_back', 'go_forward', 'reload',
  'click', 'double_click', 'right_click', 'type', 'fill', 'select', 'press', 'hover', 'scroll',
  'screenshot', 'pdf',
  'get_cookies', 'set_cookie', 'clear_cookies', 'set_headers', 'set_offline',
  'emulate_device', 'set_geolocation',
  'evaluate', 'get_content', 'get_url', 'get_title',
] as const;

/**
 * BrowserExecuteTool - ITool adapter for browser automation
 * Uses browser-automation module with accessibility tree + ref numbering
 */
export class BrowserExecuteTool implements ITool {
  readonly name = 'browser';
  readonly description = 'Automate web browser with accessibility-based element refs. Snapshot → ref-based click/type/fill.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const browser = await getBrowserAutomation();
    return await browser.execute(input as unknown as BrowserToolInput);
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
            description: 'Browser action to perform',
            enum: [...BROWSER_ACTIONS],
          },
          cdpUrl: { type: 'string', description: 'CDP WebSocket URL for connecting to existing browser' },
          headless: { type: 'boolean', description: 'Run browser in headless mode (default: true)' },
          tabId: { type: 'string', description: 'Tab ID for focus_tab/close_tab' },
          url: { type: 'string', description: 'URL to navigate to' },
          waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Navigation completion condition' },
          interactiveOnly: { type: 'boolean', description: 'Only include interactive elements in snapshot' },
          maxElements: { type: 'number', description: 'Max elements in snapshot' },
          ref: { type: 'number', description: 'Element reference number from snapshot' },
          role: { type: 'string', description: 'Element role to search for' },
          name: { type: 'string', description: 'Element name/text to search for' },
          text: { type: 'string', description: 'Text to type' },
          key: { type: 'string', description: 'Key to press (Enter, Tab, Escape, etc.)' },
          modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
          clear: { type: 'boolean', description: 'Clear field before typing' },
          fields: { type: 'object', description: 'Fields to fill: { "refNumber": "value", ... }' },
          submit: { type: 'boolean', description: 'Press Enter after filling fields' },
          value: { type: 'string', description: 'Value to select in dropdown' },
          label: { type: 'string', description: 'Label to select in dropdown' },
          index: { type: 'number', description: 'Index to select in dropdown' },
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
          amount: { type: 'number', description: 'Scroll amount in pixels' },
          toElement: { type: 'number', description: 'Element ref to scroll to' },
          fullPage: { type: 'boolean', description: 'Capture full page vs viewport only' },
          element: { type: 'number', description: 'Element ref to capture' },
          format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image format' },
          quality: { type: 'number', description: 'Image quality (0-100)' },
          expression: { type: 'string', description: 'JavaScript code to evaluate in page' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' },
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

    if (typeof data.action !== 'string' || data.action.trim() === '') {
      return { valid: false, errors: ['action must be a non-empty string'] };
    }

    if (!(BROWSER_ACTIONS as readonly string[]).includes(data.action)) {
      return { valid: false, errors: [`Unknown action: ${data.action}`] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'web', 'automation', 'playwright', 'screenshot', 'scrape', 'accessibility'],
      priority: 5,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  async dispose(): Promise<void> {
    if (browserInstance) {
      const { resetBrowserTool } = await import('../../browser-automation/index.js');
      resetBrowserTool();
      browserInstance = null;
    }
  }
}

// ============================================================================
// ComputerControlExecuteTool
// ============================================================================

const COMPUTER_CONTROL_ACTIONS = [
  'snapshot', 'snapshot_with_screenshot', 'get_element', 'find_elements',
  'click', 'double_click', 'right_click', 'move_mouse', 'drag', 'scroll',
  'type', 'key', 'hotkey',
  'get_windows', 'focus_window', 'close_window',
  'get_volume', 'set_volume', 'get_brightness', 'set_brightness',
  'notify', 'lock', 'sleep',
  'start_recording', 'stop_recording', 'recording_status',
  'system_info', 'battery_info', 'network_info', 'check_permission',
] as const;

/**
 * ComputerControlExecuteTool - ITool adapter for desktop computer control
 */
export class ComputerControlExecuteTool implements ITool {
  readonly name = 'computer_control';
  readonly description = 'Control the computer: mouse, keyboard, window management, system actions. Use snapshot to detect UI elements with refs.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getComputerControl();
    return await tool.execute(input as any);
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
            enum: [...COMPUTER_CONTROL_ACTIONS],
            description: 'The action to perform',
          },
          ref: { type: 'number', description: 'Element reference number from snapshot' },
          x: { type: 'number', description: 'X coordinate for mouse actions' },
          y: { type: 'number', description: 'Y coordinate for mouse actions' },
          text: { type: 'string', description: 'Text to type' },
          key: { type: 'string', description: 'Key to press' },
          modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys (ctrl, alt, shift, meta)' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
          deltaX: { type: 'number', description: 'Horizontal scroll amount' },
          deltaY: { type: 'number', description: 'Vertical scroll amount' },
          windowTitle: { type: 'string', description: 'Window title to find/focus' },
          level: { type: 'number', description: 'Volume or brightness level (0-100)' },
          role: { type: 'string', description: 'Element role to find' },
          name: { type: 'string', description: 'Element name to search for' },
          interactiveOnly: { type: 'boolean', description: 'Only include interactive elements in snapshot' },
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

    if (typeof data.action !== 'string' || data.action.trim() === '') {
      return { valid: false, errors: ['action must be a non-empty string'] };
    }

    if (!(COMPUTER_CONTROL_ACTIONS as readonly string[]).includes(data.action)) {
      return { valid: false, errors: [`Unknown action: ${data.action}`] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['computer', 'control', 'mouse', 'keyboard', 'desktop', 'automation', 'snapshot', 'click'],
      priority: 5,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// ScreenshotExecuteTool
// ============================================================================

/**
 * ScreenshotExecuteTool - ITool adapter for screen capture
 */
export class ScreenshotExecuteTool implements ITool {
  readonly name = 'screenshot';
  readonly description = 'Capture screenshots of the screen, a window, or a region. Supports LLM-optimized output.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getScreenshot();
    return await tool.capture({
      fullscreen: input.fullscreen as boolean | undefined,
      region: input.region as { x: number; y: number; width: number; height: number } | undefined,
      window: input.window as string | undefined,
      delay: input.delay as number | undefined,
      format: input.format as 'png' | 'jpg' | undefined,
      quality: input.quality as number | undefined,
      outputPath: input.outputPath as string | undefined,
      forLLM: input.forLLM as boolean | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          fullscreen: { type: 'boolean', description: 'Capture entire screen (default: true)' },
          window: { type: 'string', description: 'Window title or ID to capture' },
          region: {
            type: 'object',
            description: 'Screen region to capture: { x: number, y: number, width: number, height: number }',
          },
          delay: { type: 'number', description: 'Delay in seconds before capture' },
          format: { type: 'string', enum: ['png', 'jpg'], description: 'Image format' },
          quality: { type: 'number', description: 'JPEG quality (1-100)' },
          outputPath: { type: 'string', description: 'Custom output path' },
          forLLM: { type: 'boolean', description: 'Normalize screenshot for LLM consumption (resize + compress)' },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['screenshot', 'capture', 'screen', 'image', 'window'],
      priority: 4,
      requiresConfirmation: false,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// ReasoningExecuteTool
// ============================================================================

/**
 * ReasoningExecuteTool - ITool adapter for Tree-of-Thought reasoning
 */
export class ReasoningExecuteTool implements ITool {
  readonly name = 'reason';
  readonly description = 'Solve complex problems using Tree-of-Thought reasoning (MCTS) for planning, analysis, and difficult algorithmic problems';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getReasoning().execute({
      problem: input.problem as string,
      context: input.context as string | undefined,
      mode: input.mode as 'shallow' | 'medium' | 'deep' | 'exhaustive' | undefined,
      constraints: input.constraints as string[] | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          problem: {
            type: 'string',
            description: 'The problem statement or question to solve',
          },
          context: {
            type: 'string',
            description: 'Additional context or background information',
          },
          mode: {
            type: 'string',
            description: 'Depth of reasoning (default: medium)',
            enum: ['shallow', 'medium', 'deep', 'exhaustive'],
          },
          constraints: {
            type: 'array',
            description: 'List of constraints that must be satisfied',
            items: { type: 'string' },
          },
        },
        required: ['problem'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.problem !== 'string' || data.problem.trim() === '') {
      return { valid: false, errors: ['problem must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['reasoning', 'mcts', 'tree-of-thought', 'problem-solving', 'planning'],
      priority: 4,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all miscellaneous tool instances
 */
export function createMiscTools(): ITool[] {
  return [
    new BrowserExecuteTool(),
    new ComputerControlExecuteTool(),
    new ScreenshotExecuteTool(),
    new ReasoningExecuteTool(),
  ];
}
